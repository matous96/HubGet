//! Scoop – stav, nainstalované aplikace a operace.
//!
//! - Nainstalované aplikace se čtou přímo ze složek Scoopu
//!   (`apps\<aplikace>\current`) – bez spouštění PowerShellu. Novější verzi
//!   prozradí manifest v bucketu – buckety obnoví `scoop update` (kontrola aktualizací
//!   HubGetu ho spustí nejvýš jednou za 3 hodiny, `scoop_refresh_buckets`).
//!   Přenosné aplikace ze Scoopu v registru Windows nejsou, winget je nevidí.
//! - Operace: skript scoop.ps1 ve Windows PowerShellu, vždy bez práv správce
//!   (Scoop instaluje pro aktuálního uživatele). Instalace z bucketu, který
//!   ještě není přidaný („extras/aimp“), ho nejdřív přidá – jen oficiální buckety.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::operations::{self, InstallOptions, Kind, OpEvent, OperationRequest, OperationResult, Spec, Verdict};
use crate::powershell::{powershell_exe, ps_string};
use crate::process::background;

/// Oficiální buckety – `scoop bucket add <název>` je přidá bez adresy.
const KNOWN_BUCKETS: &[&str] =
    &["main", "extras", "versions", "nirsoft", "sysinternals", "php", "nerd-fonts", "nonportable", "java", "games"];

/// Složka Scoopu aktuálního uživatele.
pub(crate) fn root() -> PathBuf {
    // Vlastní cesta z Nastavení (je-li povolena) ke scoop.ps1 – „…\shims\scoop.ps1“
    // nebo „…\apps\scoop\current\bin\scoop.ps1“ → kořen Scoopu
    if let Some(script) = crate::security::manager_path("scoop", &["scoop.ps1"]) {
        let levels = if script.parent().and_then(Path::file_name).is_some_and(|n| n.eq_ignore_ascii_case("shims")) { 2 } else { 5 };
        if let Some(root) = script.ancestors().nth(levels) {
            return root.to_path_buf();
        }
    }
    if let Some(custom) = std::env::var_os("SCOOP") {
        return PathBuf::from(custom);
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default();
    home.join("scoop")
}

/// Složka aplikací nainstalovaných pro všechny uživatele (`scoop install --global`).
fn global_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("SCOOP_GLOBAL") {
        return PathBuf::from(custom);
    }
    std::env::var_os("ProgramData").map(|data| PathBuf::from(data).join("scoop")).unwrap_or_default()
}

/// Hlavní skript Scoopu.
fn script(root: &Path) -> PathBuf {
    root.join(r"apps\scoop\current\bin\scoop.ps1")
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

#[derive(Serialize)]
pub struct Status {
    available: bool,
    version: Option<String>,
}

/// Verze Scoopu z jeho CHANGELOG.md („## [v0.5.3](…) - 2025-08-11“ → „0.5.3“).
fn version(root: &Path) -> Option<String> {
    let changelog = std::fs::read_to_string(root.join(r"apps\scoop\current\CHANGELOG.md")).ok()?;
    let line = changelog.lines().find(|l| l.starts_with("## [v"))?;
    Some(line.trim_start_matches("## [v").split(']').next()?.to_string())
}

#[tauri::command]
pub async fn scoop_status() -> Result<Status, String> {
    background(|| {
        let root = root();
        let available = script(&root).is_file();
        Ok(Status { available, version: if available { version(&root) } else { None } })
    })
    .await
}

/// Nainstalovaná aplikace; `package_id` je „bucket/aplikace“ jako v katalogu.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    package_id: String,
    name: String,
    installed_version: String,
    available_version: Option<String>,
}

/// Aplikace v jedné složce Scoopu (uživatelské nebo globální); buckety jsou vždy u uživatele.
fn installed_in(apps_root: &Path, buckets: &Path, out: &mut Vec<Installed>) {
    let Ok(entries) = std::fs::read_dir(apps_root.join("apps")) else { return };
    for entry in entries.flatten() {
        let app = entry.file_name().to_string_lossy().into_owned();
        let current = entry.path().join("current");
        if app == "scoop" || !current.is_dir() {
            continue;
        }
        // Verze z manifestu, jinak z názvu složky, na kterou ukazuje „current“
        let manifest_version = read_json(&current.join("manifest.json"))
            .and_then(|m| m.get("version")?.as_str().map(str::to_string));
        let Some(installed_version) = manifest_version
            .or_else(|| std::fs::read_link(&current).ok()?.file_name().map(|n| n.to_string_lossy().into_owned()))
        else {
            continue;
        };
        let install = read_json(&current.join("install.json"));
        let bucket = install.as_ref().and_then(|i| i.get("bucket")?.as_str().map(str::to_string));
        let held = install.as_ref().and_then(|i| i.get("hold")?.as_bool()).unwrap_or(false);
        // Manifest v bucketu: „bucket\<aplikace>.json“, u starších bucketů v kořeni
        let available_version = bucket.as_deref().filter(|_| !held).and_then(|b| {
            let dir = buckets.join(b);
            [dir.join("bucket").join(format!("{app}.json")), dir.join(format!("{app}.json"))]
                .iter()
                .find_map(|path| read_json(path))
                .and_then(|m| m.get("version")?.as_str().map(str::to_string))
                .filter(|latest| *latest != installed_version)
        });
        out.push(Installed {
            package_id: bucket.map_or_else(|| app.clone(), |b| format!("{b}/{app}")),
            name: app,
            installed_version,
            available_version,
        });
    }
}

#[tauri::command]
pub async fn scoop_installed() -> Result<Vec<Installed>, String> {
    background(|| {
        let root = root();
        let buckets = root.join("buckets");
        let mut out = Vec::new();
        installed_in(&root, &buckets, &mut out);
        installed_in(&global_root(), &buckets, &mut out);
        Ok(out)
    })
    .await
}

/// Výsledek hledání v bucketech.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    package_id: String,
    name: String,
    version: String,
}

/// Manifesty v bucketu: „bucket\*.json“, u starších bucketů v kořeni.
fn bucket_manifests(bucket: &Path) -> Vec<PathBuf> {
    [bucket.join("bucket"), bucket.to_path_buf()]
        .iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flat_map(|entries| entries.flatten().map(|e| e.path()))
        .filter(|path| path.extension().is_some_and(|e| e == "json"))
        .collect()
}

/// Hledání v přidaných bucketech podle názvu aplikace – přímo v souborech
/// (rychlejší než `scoop search`), nejvýš 60 výsledků.
#[tauri::command]
pub async fn scoop_search(query: String) -> Result<Vec<Found>, String> {
    background(move || {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Ok(Vec::new());
        }
        let Ok(buckets) = std::fs::read_dir(root().join("buckets")) else { return Ok(Vec::new()) };
        let mut found = Vec::new();
        for bucket in buckets.flatten() {
            let bucket_name = bucket.file_name().to_string_lossy().into_owned();
            for path in bucket_manifests(&bucket.path()) {
                let app = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                if !app.to_lowercase().contains(&needle) {
                    continue;
                }
                let version = read_json(&path).and_then(|m| m.get("version")?.as_str().map(str::to_string)).unwrap_or_default();
                found.push(Found { package_id: format!("{bucket_name}/{app}"), name: app, version });
            }
        }
        // Přesná shoda a kratší názvy první
        found.sort_by_key(|f| (f.name.to_lowercase() != needle, f.name.len()));
        found.truncate(60);
        Ok(found)
    })
    .await
}

/// Dostupná verze aplikace – Scoop má v bucketu jen aktuální manifest.
#[tauri::command]
pub async fn scoop_versions(package_id: String) -> Result<Vec<String>, String> {
    background(move || {
        let (bucket, app) = split_id(&package_id).ok_or_else(|| format!("Neplatné id aplikace Scoopu: {package_id}"))?;
        let buckets = root().join("buckets");
        let dirs: Vec<PathBuf> = match bucket {
            Some(b) => vec![buckets.join(b)],
            None => std::fs::read_dir(&buckets).map(|e| e.flatten().map(|d| d.path()).collect()).unwrap_or_default(),
        };
        Ok(dirs
            .iter()
            .flat_map(|dir| [dir.join("bucket").join(format!("{app}.json")), dir.join(format!("{app}.json"))])
            .find_map(|path| read_json(&path))
            .and_then(|m| m.get("version")?.as_str().map(str::to_string))
            .into_iter()
            .collect())
    })
    .await
}

/// Jak často nejvýš obnovovat buckety – stejně jako Scoop sám před instalací.
const BUCKETS_REFRESH: std::time::Duration = std::time::Duration::from_secs(3 * 60 * 60);

/// Kdy se buckety naposledy stáhly (`git fetch` v `scoop update` zapíše `.git\FETCH_HEAD`);
/// None = nikdy nebo neznámo.
fn buckets_fetched_at(buckets: &Path) -> Option<std::time::SystemTime> {
    std::fs::read_dir(buckets)
        .ok()?
        .flatten()
        .filter_map(|bucket| std::fs::metadata(bucket.path().join(".git").join("FETCH_HEAD")).ok()?.modified().ok())
        .max()
}

/// Obnoví Scoop a jeho buckety (`scoop update`), aby výpis nainstalovaných znal nové verze –
/// manifesty v bucketech jinak zůstanou ve stavu po posledním ručním `scoop update`.
/// Nejvýš jednou za 3 hodiny; vrátí, zda obnova proběhla.
#[tauri::command]
pub async fn scoop_refresh_buckets() -> Result<bool, String> {
    background(|| {
        let root = root();
        let buckets = root.join("buckets");
        if !script(&root).is_file() || !buckets.is_dir() {
            return Ok(false);
        }
        let fresh = buckets_fetched_at(&buckets)
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age < BUCKETS_REFRESH);
        if fresh {
            return Ok(false);
        }
        let script_text = [
            "$ErrorActionPreference = 'Continue'".to_string(),
            "$ProgressPreference = 'SilentlyContinue'".to_string(),
            format!("$scoop = {}", ps_string(&script(&root).to_string_lossy())),
            "& $scoop update *>&1".to_string(),
            "exit $LASTEXITCODE".to_string(),
        ]
        .join("\n");
        let encoded = BASE64.encode(script_text.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
        let mut command = crate::process::hidden_command(&powershell_exe().to_string_lossy());
        command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
        let output = crate::process::run(command, std::time::Duration::from_secs(180))?;
        Ok(output.code == 0)
    })
    .await
}

/// Nainstaluje Scoop oficiálním instalátorem (get.scoop.sh) pro aktuálního
/// uživatele – bez práv správce (Scoop je odmítá).
#[tauri::command]
pub async fn scoop_setup() -> Result<(), String> {
    background(|| {
        const SCRIPT: &str = "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; \
            $installer = Join-Path $env:TEMP 'install-scoop.ps1'; \
            Invoke-RestMethod -Uri 'https://get.scoop.sh' -OutFile $installer; \
            & $installer; exit $LASTEXITCODE";
        let encoded = BASE64.encode(SCRIPT.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
        let mut command = crate::process::hidden_command(&powershell_exe().to_string_lossy());
        command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
        let output = crate::process::run(command, std::time::Duration::from_secs(600))?;
        if !script(&root()).is_file() {
            let last = output.stdout.lines().map(str::trim).rev().find(|l| !l.is_empty()).unwrap_or_default().to_string();
            return Err(format!("Instalace Scoopu selhala ({}): {last}", output.code));
        }
        Ok(())
    })
    .await
}

/// Rozdělí id na bucket a aplikaci („extras/aimp“ → (extras, aimp)); None = neplatné id.
fn split_id(id: &str) -> Option<(Option<&str>, &str)> {
    let (bucket, app) = match id.split_once('/') {
        Some((bucket, app)) => (Some(bucket), app),
        None => (None, id),
    };
    // Jen znaky z názvů aplikací – hodnoty jdou do skriptu PowerShellu v apostrofech
    let valid = |s: &str| !s.is_empty() && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c));
    (valid(app) && bucket.map_or(true, valid)).then_some((bucket, app))
}

/// Architektura ve Scoopu.
fn scoop_arch(arch: &str) -> Option<&'static str> {
    match arch {
        "x64" => Some("64bit"),
        "x86" => Some("32bit"),
        "arm64" => Some("arm64"),
        _ => None,
    }
}

/// Skript PowerShellu pro operaci – stejné volby jako příkaz ke zkopírování (sourceCommand ve frontendu).
fn operation_script(request: &OperationRequest, root: &Path, downloads: &Path) -> Result<String, String> {
    let id = request.package_id.as_str();
    let (bucket, app) = split_id(id).ok_or_else(|| format!("Neplatné id aplikace Scoopu: {id}"))?;
    let default_options = InstallOptions::default();
    let options = request.options.as_ref().unwrap_or(&default_options);
    let version = request.version.as_deref().filter(|v| split_id(v).is_some_and(|(b, _)| b.is_none()));
    // Instalace a stažení potřebují bucket a případně verzi („extras/aimp@5.40“)
    let target = match version {
        Some(version) if matches!(request.kind, Kind::Install | Kind::Download) => format!("{id}@{version}"),
        _ => id.to_string(),
    };

    // Hlášky Scoopu (Write-Host = informační proud) i chyby jako text na standardní výstup
    // (*>&1) – jinak je PowerShell spuštěný přes -EncodedCommand pošle jako CLIXML do chybového
    // výstupu a v historii by místo „Couldn't find manifest…“ bylo XML. Průběh modulů vypnutý.
    let mut lines = vec![
        "$ErrorActionPreference = 'Continue'".to_string(),
        "$ProgressPreference = 'SilentlyContinue'".to_string(),
        "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false".to_string(),
        format!("$scoop = {}", ps_string(&script(root).to_string_lossy())),
    ];
    if let Some(bucket) = bucket.filter(|b| matches!(request.kind, Kind::Install | Kind::Download) && !root.join("buckets").join(b).is_dir()) {
        if KNOWN_BUCKETS.contains(&bucket) {
            // Buckety se stahují přes Git – bez něj `bucket add` skončí chybou („Git is required for buckets“)
            lines.push("if (-not (Get-Command git -ErrorAction SilentlyContinue)) { & $scoop install git *>&1 }".to_string());
            lines.push(format!("& $scoop bucket add '{bucket}' *>&1"));
        }
    }
    lines.push("$global:LASTEXITCODE = 0".to_string());
    match request.kind {
        Kind::Install => {
            let mut command = format!("& $scoop install '{target}'");
            if let Some(arch) = options.architecture.as_deref().and_then(scoop_arch) {
                command.push_str(&format!(" --arch {arch}"));
            }
            if options.skip_hash {
                command.push_str(" --skip-hash");
            }
            command.push_str(" *>&1");
            lines.push(command);
        }
        Kind::Update => lines.push(format!("& $scoop update '{app}' *>&1")),
        Kind::Uninstall => lines.push(format!("& $scoop uninstall '{app}' *>&1")),
        Kind::Download => {
            let arch = options.architecture.as_deref().and_then(scoop_arch).map(|a| format!(" --arch {a}")).unwrap_or_default();
            lines.push(format!("& $scoop download '{target}'{arch} *>&1"));
            // Scoop stahuje do své mezipaměti („aimp#5.40.2727#<adresa>.zip“) – nejnovější
            // soubor aplikace se zkopíruje do Stažených souborů jako „aimp-5.40.2727.zip“
            lines.push(format!(
                "if ($LASTEXITCODE -eq 0) {{ \
                   $file = Get-ChildItem (Join-Path {cache} '*') -Include '{app}#*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1; \
                   if ($file) {{ $parts = $file.Name.Split('#'); \
                     $target = Join-Path {downloads} ($parts[0] + '-' + $parts[1] + [IO.Path]::GetExtension($parts[2])); \
                     Copy-Item -LiteralPath $file.FullName -Destination $target -Force; Write-Output $target }} }}",
                cache = ps_string(&root.join("cache").to_string_lossy()),
                downloads = ps_string(&downloads.to_string_lossy()),
            ));
        }
    }
    lines.push("exit $LASTEXITCODE".to_string());
    Ok(lines.join("\n"))
}

/// Průběh stahování: „aimp_5.40.2727_w64.zip (14,1 MB) [=====>   ]  56%“.
fn parse_progress(line: &str) -> Option<f64> {
    if !line.contains('[') {
        return None;
    }
    let percent: f64 = line.split_whitespace().last()?.strip_suffix('%')?.parse().ok()?;
    (0.0..=100.0).contains(&percent).then_some(percent)
}

/// Scoop končí 0 při úspěchu, jinak 1.
fn interpret(_kind: Kind, code: i32) -> Verdict {
    match code {
        0 => Verdict::success(false),
        _ => Verdict::error("failed"),
    }
}

/// Spustí operaci; `id` přidělí frontend (pro zrušení přes cancel_operation).
#[tauri::command]
pub async fn scoop_operation(
    app: AppHandle,
    id: String,
    request: OperationRequest,
    on_event: Channel<OpEvent>,
) -> Result<OperationResult, String> {
    let root = root();
    if !script(&root).is_file() {
        return Err("Scoop není nainstalovaný".into());
    }
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let script = operation_script(&request, &root, &downloads)?;
    let (pre_command, post_command) = operations::custom_commands(&request);
    // -EncodedCommand: skript v UTF-16LE base64 – na uvozovkách v příkazové řádce nezáleží
    let encoded = BASE64.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
    let spec = Spec {
        program: powershell_exe().to_string_lossy().into_owned(),
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        retry_args: None,
        kind: request.kind,
        elevated: false,
        background: request.background,
        interactive: false,
        parse_progress,
        download_dirs: vec![root.join("cache")],
        interpret,
        prefetch: None,
        pre_command,
        post_command,
    };
    operations::execute(id, spec, on_event).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: Kind, id: &str) -> OperationRequest {
        OperationRequest { kind, package_id: id.into(), version: None, options: None, name: None, background: false }
    }

    #[test]
    fn ids() {
        assert_eq!(split_id("extras/aimp"), Some((Some("extras"), "aimp")));
        assert_eq!(split_id("7zip"), Some((None, "7zip")));
        assert_eq!(split_id("extras/a'; calc"), None);
        assert_eq!(split_id("--global"), None);
    }

    #[test]
    fn scripts() {
        let root = std::env::temp_dir().join("unibox-scoop-test-missing");
        let install = operation_script(&request(Kind::Install, "extras/aimp"), &root, Path::new("C:\\Downloads")).unwrap();
        // Bucket extras chybí → nejdřív se přidá (a před ním Git, pokud chybí)
        assert!(install.contains("& $scoop install git *>&1"));
        assert!(install.contains("& $scoop bucket add 'extras' *>&1"));
        assert!(install.contains("& $scoop install 'extras/aimp' *>&1"));
        assert!(install.trim_end().ends_with("exit $LASTEXITCODE"));
        let uninstall = operation_script(&request(Kind::Uninstall, "extras/aimp"), &root, Path::new("C:\\Downloads")).unwrap();
        assert!(uninstall.contains("& $scoop uninstall 'aimp' *>&1") && !uninstall.contains("bucket add"));
        assert!(operation_script(&request(Kind::Install, "extras/x y"), &root, Path::new("C:\\")).is_err());
    }

    #[test]
    fn progress_from_output() {
        assert_eq!(parse_progress("aimp_5.40.2727_w64.zip (14,1 MB) [=====>     ]  56%"), Some(56.0));
        assert_eq!(parse_progress("Installing 'aimp' (5.40.2727) [64bit] from 'extras' bucket"), None);
    }

    #[test]
    fn installed_from_folders() {
        let base = std::env::temp_dir().join(format!("unibox-scoop-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let current = base.join(r"apps\aimp\current");
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(current.join("manifest.json"), r#"{ "version": "5.40.2700" }"#).unwrap();
        std::fs::write(current.join("install.json"), r#"{ "bucket": "extras" }"#).unwrap();
        let bucket = base.join(r"buckets\extras\bucket");
        std::fs::create_dir_all(&bucket).unwrap();
        std::fs::write(bucket.join("aimp.json"), r#"{ "version": "5.40.2727" }"#).unwrap();
        std::fs::create_dir_all(base.join(r"apps\scoop\current")).unwrap();

        let mut out = Vec::new();
        installed_in(&base, &base.join("buckets"), &mut out);
        let _ = std::fs::remove_dir_all(&base);
        assert_eq!(
            out,
            [Installed {
                package_id: "extras/aimp".into(),
                name: "aimp".into(),
                installed_version: "5.40.2700".into(),
                available_version: Some("5.40.2727".into()),
            }]
        );
    }
}
