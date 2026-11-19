//! Offline balíček ze sady (Sady balíčků → Připravit pro offline): HubGet stáhne
//! instalátory aplikací z WinGetu (`winget download` – ověří je kontrolním součtem
//! z manifestu) do vybrané složky (třeba na USB) a vedle nich uloží `install.cmd`,
//! který je na počítači bez internetu nainstaluje potichu, a `README.txt` se seznamem.
//! Přepínače tiché instalace bere z manifestu, který winget uloží vedle instalátoru
//! (InstallerType, InstallerSwitches) – jinak výchozí podle typu instalátoru jako winget.
//! Archivy a přenosné aplikace skript neinstaluje (seznam v README).
//!
//! Složku vybírá uživatel v systémovém dialogu – frontend cestu neposílá.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::process::{self, background, hidden_command};
use crate::winget;

/// Probíhá příprava (najednou jen jedna) a požadavek na zrušení.
static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OfflinePackage {
    package_id: String,
    name: String,
    /// Konkrétní verze ze sady (jinak nejnovější).
    version: Option<String>,
}

/// Texty skriptu a README v jazyce aplikace.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OfflineTexts {
    /// Název sady (nadpis, složka).
    title: String,
    /// „Instalace může vyžadovat práva správce…“
    admin_hint: String,
    done: String,
    /// Nadpis seznamu aplikací, které skript neinstaluje.
    manual: String,
    /// Úvod README.
    readme: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OfflineProgress {
    done: usize,
    total: usize,
    name: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OfflineFailure {
    name: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineResult {
    folder: String,
    /// Aplikace, které skript nainstaluje.
    saved: Vec<String>,
    /// Stažené, ale k ruční instalaci (archiv, přenosná aplikace).
    manual: Vec<String>,
    failed: Vec<OfflineFailure>,
    cancelled: bool,
}

/// Údaje z manifestu, který `winget download` uloží vedle instalátoru (jen vybraný instalátor).
#[derive(Debug, Default, PartialEq)]
struct ManifestInfo {
    installer_type: String,
    silent: Option<String>,
    custom: Option<String>,
}

/// Hodnota z YAML bez uvozovek (jednoduché '' a dvojité s \" – víc manifesty nepoužívají).
fn yaml_value(raw: &str) -> String {
    let raw = raw.trim();
    if raw.len() >= 2 && raw.starts_with('\'') && raw.ends_with('\'') {
        return raw[1..raw.len() - 1].replace("''", "'");
    }
    if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
        return raw[1..raw.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\");
    }
    raw.to_string()
}

/// Typ instalátoru a přepínače tiché instalace (první výskyt – manifest má jen jeden instalátor).
fn parse_manifest(text: &str) -> ManifestInfo {
    let mut info = ManifestInfo::default();
    // Jen část s instalátorem – v poznámkách k verzi nad ní může být cokoli („Silent: …“)
    let installers = text.lines().position(|l| l.trim_end() == "Installers:").map_or(0, |i| i + 1);
    for line in text.lines().skip(installers) {
        let line = line.trim_start().trim_start_matches("- ");
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = yaml_value(value);
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "InstallerType" if info.installer_type.is_empty() => info.installer_type = value.to_lowercase(),
            "Silent" if info.silent.is_none() => info.silent = Some(value),
            "Custom" if info.custom.is_none() => info.custom = Some(value),
            _ => {}
        }
    }
    info
}

/// `%` se v dávkovém souboru zdvojuje.
fn cmd_escape(text: &str) -> String {
    text.replace('%', "%%")
}

/// Text za `echo`: navíc znaky, které by cmd bral jako příkaz (`&`, `|`, přesměrování) –
/// název sady „Práce & škola“ by jinak spustil „škola“.
fn echo_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in cmd_escape(text).chars() {
        if matches!(c, '^' | '&' | '|' | '<' | '>') {
            out.push('^');
        }
        out.push(c);
    }
    out
}

/// Řádek install.cmd pro instalátor (cesta relativně ke složce skriptu); None = ručně.
fn install_line(file: &str, info: &ManifestInfo) -> Option<String> {
    let silent = |default: &str| info.silent.clone().unwrap_or_else(|| default.to_string());
    let custom = info.custom.as_deref().map(|c| format!(" {c}")).unwrap_or_default();
    let line = match info.installer_type.as_str() {
        "msi" | "wix" => format!("start \"\" /wait msiexec.exe /i \"{file}\" {}{custom}", silent("/quiet /norestart")),
        "burn" => format!("start \"\" /wait \"{file}\" {}{custom}", silent("/quiet /norestart")),
        "inno" => format!("start \"\" /wait \"{file}\" {}{custom}", silent("/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART")),
        "nullsoft" => format!("start \"\" /wait \"{file}\" {}{custom}", silent("/S")),
        // Obecný EXE: tiché přepínače jen z manifestu, jinak se instalátor ukáže
        "exe" => format!("start \"\" /wait \"{file}\"{}{custom}", info.silent.as_deref().map(|s| format!(" {s}")).unwrap_or_default()),
        "msix" | "appx" => format!(
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Add-AppxPackage -Path '{}'\"",
            file.replace('\'', "''")
        ),
        _ => return None,
    };
    Some(cmd_escape(&line))
}

/// Stažený instalátor a manifest ve složce aplikace.
fn downloaded(folder: &Path) -> Option<(PathBuf, Option<PathBuf>)> {
    let files: Vec<PathBuf> = std::fs::read_dir(folder).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
    let is_yaml = |p: &PathBuf| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("yaml"));
    let manifest = files.iter().find(|p| is_yaml(p)).cloned();
    let installer = files.into_iter().filter(|p| !is_yaml(p)).max_by_key(|p| p.metadata().map(|m| m.len()).unwrap_or(0))?;
    Some((installer, manifest))
}

/// Jedna aplikace: stáhnout do podsložky, vrátit řádek skriptu (None = ruční instalace).
fn download_one(root: &Path, package: &OfflinePackage) -> Result<(String, Option<String>), String> {
    let folder_name = crate::leftovers::safe_file_name(&package.name);
    let folder = root.join(&folder_name);
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut command = hidden_command(&winget::winget_exe());
    command.args(["download", "--id", &package.package_id, "--exact", "--source", "winget"]);
    if let Some(version) = package.version.as_deref().filter(|v| winget::safe_show_arg(v)) {
        command.args(["--version", version]);
    }
    command.arg("--download-directory").arg(&folder);
    command.args(["--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"]);
    let output = process::run(command, Duration::from_secs(20 * 60))?;
    let (installer, manifest) = downloaded(&folder).filter(|_| output.code == 0).ok_or_else(|| {
        let detail = output.stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or_default().trim().to_string();
        format!("winget download ({}): {detail}", output.code)
    })?;
    let info = manifest.and_then(|m| std::fs::read_to_string(m).ok()).map(|t| parse_manifest(&t)).unwrap_or_default();
    let file = format!("{folder_name}\\{}", installer.file_name().unwrap_or_default().to_string_lossy());
    Ok((file.clone(), install_line(&file, &info)))
}

fn script(texts: &OfflineTexts, lines: &[(String, String)]) -> String {
    let mut out = String::from("@echo off\r\nchcp 65001 >nul\r\ncd /d \"%~dp0\"\r\n");
    out += &format!("echo HubGet - {}\r\necho {}\r\necho.\r\n", echo_escape(&texts.title), echo_escape(&texts.admin_hint));
    for (i, (name, line)) in lines.iter().enumerate() {
        out += &format!("echo [{}/{}] {}\r\n{line}\r\n", i + 1, lines.len(), echo_escape(name));
    }
    out += &format!("echo.\r\necho {}\r\npause\r\n", echo_escape(&texts.done));
    out
}

fn readme(texts: &OfflineTexts, saved: &[String], manual: &[(String, String)]) -> String {
    let mut out = format!("HubGet - {}\r\n\r\n{}\r\n\r\n", texts.title, texts.readme);
    for name in saved {
        out += &format!("  - {name}\r\n");
    }
    if !manual.is_empty() {
        out += &format!("\r\n{}\r\n", texts.manual);
        for (name, file) in manual {
            out += &format!("  - {name}: {file}\r\n");
        }
    }
    out
}

/// Vybere složku a připraví do ní offline balíček. None = dialog zavřený.
#[tauri::command]
pub async fn offline_bundle<R: Runtime>(
    app: AppHandle<R>,
    packages: Vec<OfflinePackage>,
    texts: OfflineTexts,
) -> Result<Option<OfflineResult>, String> {
    if let Some(bad) = packages.iter().find(|p| !winget::safe_show_arg(&p.package_id) || winget::is_store_id(&p.package_id)) {
        return Err(format!("Balíček {} nejde stáhnout", bad.package_id));
    }
    if packages.is_empty() {
        return Err("Sada nemá žádnou aplikaci z WinGetu".into());
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Offline balíček se už připravuje".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let result = background(move || {
        let mut dialog = app.dialog().file();
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(picked) = dialog.blocking_pick_folder() else { return Ok(None) };
        let picked = picked.into_path().map_err(|e| e.to_string())?;
        let root = picked.join(crate::leftovers::safe_file_name(&format!("HubGet - {}", texts.title)));
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

        let total = packages.len();
        let mut lines = Vec::new();
        let mut manual = Vec::new();
        let mut failed = Vec::new();
        let mut cancelled = false;
        for (i, package) in packages.iter().enumerate() {
            if CANCEL.load(Ordering::SeqCst) {
                cancelled = true;
                break;
            }
            let _ = app.emit("offline-progress", OfflineProgress { done: i, total, name: package.name.clone() });
            match download_one(&root, package) {
                Ok((_, Some(line))) => lines.push((package.name.clone(), line)),
                Ok((file, None)) => manual.push((package.name.clone(), file)),
                Err(error) => failed.push(OfflineFailure { name: package.name.clone(), error }),
            }
        }
        let saved: Vec<String> = lines.iter().map(|(name, _)| name.clone()).collect();
        std::fs::write(root.join("install.cmd"), script(&texts, &lines)).map_err(|e| e.to_string())?;
        std::fs::write(root.join("README.txt"), readme(&texts, &saved, &manual)).map_err(|e| e.to_string())?;
        Ok(Some(OfflineResult {
            folder: root.to_string_lossy().into_owned(),
            saved,
            manual: manual.into_iter().map(|(name, _)| name).collect(),
            failed,
            cancelled,
        }))
    })
    .await;
    RUNNING.store(false, Ordering::SeqCst);
    result
}

/// Zruší přípravu po právě stahované aplikaci.
#[tauri::command]
pub fn offline_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = "PackageIdentifier: 7zip.7zip\nInstallers:\n- Architecture: x64\n  InstallerType: wix\n  InstallerSwitches:\n    Silent: /quiet /norestart\n    SilentWithProgress: /passive /norestart\n    Log: /log \"<LOGPATH>\"\nManifestType: merged\n";

    #[test]
    fn manifest_z_winget_download() {
        let info = parse_manifest(MANIFEST);
        assert_eq!(info, ManifestInfo { installer_type: "wix".into(), silent: Some("/quiet /norestart".into()), custom: None });
        let info = parse_manifest("Installers:\n- InstallerType: inno\n  InstallerSwitches:\n    Custom: '/MERGETASKS=!runcode'\n");
        assert_eq!(info.custom.as_deref(), Some("/MERGETASKS=!runcode"));
    }

    #[test]
    fn poznamky_nad_instalatorem_se_preskoci() {
        let text = "ReleaseNotes: |-\n  Silent: ne\n  InstallerType: ne\nInstallers:\n- InstallerType: nullsoft\n";
        assert_eq!(parse_manifest(text), ManifestInfo { installer_type: "nullsoft".into(), silent: None, custom: None });
    }

    #[test]
    fn radky_skriptu() {
        let info = parse_manifest(MANIFEST);
        assert_eq!(install_line(r"7-Zip\7z.msi", &info).unwrap(), r#"start "" /wait msiexec.exe /i "7-Zip\7z.msi" /quiet /norestart"#);
        let nsis = ManifestInfo { installer_type: "nullsoft".into(), ..Default::default() };
        assert_eq!(install_line(r"VLC\vlc 100%.exe", &nsis).unwrap(), r#"start "" /wait "VLC\vlc 100%%.exe" /S"#);
        let exe = ManifestInfo { installer_type: "exe".into(), ..Default::default() };
        assert_eq!(install_line(r"A\setup.exe", &exe).unwrap(), r#"start "" /wait "A\setup.exe""#);
        let msix = ManifestInfo { installer_type: "msix".into(), ..Default::default() };
        assert!(install_line(r"O'K\app.msix", &msix).unwrap().contains("-Path 'O''K\\app.msix'"));
        for kind in ["zip", "portable", ""] {
            assert!(install_line("x\\y", &ManifestInfo { installer_type: kind.into(), ..Default::default() }).is_none());
        }
    }

    /// Skutečné `winget download` (síť, ~2 MB): `cargo test --lib offline_7zip -- --ignored`.
    #[test]
    #[ignore = "stahuje instalátor 7-Zipu"]
    fn offline_7zip() {
        let root = std::env::temp_dir().join(format!("hubget-offline-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let package = OfflinePackage { package_id: "7zip.7zip".into(), name: "7-Zip".into(), version: None };
        let (file, line) = download_one(&root, &package).unwrap();
        assert!(root.join(&file).is_file(), "{file}");
        let line = line.unwrap();
        assert!(line.starts_with("start \"\" /wait msiexec.exe /i \"7-Zip\\") && line.contains("/quiet"), "{line}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn skript_a_readme() {
        let texts = OfflineTexts {
            title: "Nový počítač 100%".into(),
            admin_hint: "Spusťte jako správce.".into(),
            done: "Hotovo.".into(),
            manual: "Ručně:".into(),
            readme: "Úvod".into(),
        };
        let text = script(&texts, &[("7-Zip".into(), "start \"\" /wait x".into())]);
        assert!(text.starts_with("@echo off\r\nchcp 65001"));
        assert!(text.contains("echo HubGet - Nový počítač 100%%"));
        assert_eq!(echo_escape("Práce & škola <3"), "Práce ^& škola ^<3");
        assert!(text.contains("echo [1/1] 7-Zip\r\nstart \"\" /wait x\r\n"));
        let text = readme(&texts, &["7-Zip".into()], &[("Tor".into(), r"Tor\tor.zip".into())]);
        assert!(text.contains("  - 7-Zip\r\n") && text.contains("Ručně:\r\n  - Tor: Tor\\tor.zip"));
    }
}
