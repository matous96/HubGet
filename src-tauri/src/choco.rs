//! Chocolatey – stav, nainstalované balíčky a operace přes choco CLI.
//!
//! - Nainstalované balíčky se čtou přímo z manifestů ve složce Chocolatey
//!   (`lib\<balíček>\<balíček>.nuspec`) – bez spouštění choco. Balíček
//!   s instalátorem (`Install-ChocolateyPackage`) má příznak `installer`: program
//!   vidí i winget v registru Windows a frontend rozhodne, pod kterým správcem ho
//!   ukázat (getAllInstalled); když ho winget nevidí, byl mezitím odinstalován
//!   jinak a záznam Chocolatey je zastaralý. Vynechají se závislosti (aktualizace
//!   Windows KB…, runtime), meta-balíčky a rozšíření Chocolatey.
//! - Dostupné aktualizace: `choco outdated` (dotaz na repozitář, trvá déle –
//!   frontend ho spouští zvlášť na pozadí a výsledek si pamatuje).
//! - Hledání a verze: `choco search` (repozitář Chocolatey Community, online).
//! - Instalace Chocolatey na jedno kliknutí: oficiální skript
//!   community.chocolatey.org/install.ps1 s právy správce.
//! - Instalace, aktualizace a odinstalace: `choco install|upgrade|uninstall --yes`.
//!   Chocolatey ve složce, kam uživatel smí zapisovat (např. přenosná instalace
//!   z UniGetUI), běží bez povýšení – instalátory si o práva správce řeknou samy.
//!   Klasická instalace v %ProgramData% potřebuje práva správce (UAC); spouští
//!   se tak jen chráněný choco.exe, do kterého běžný proces nezapíše.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::ipc::Channel;

use crate::operations::{self, InstallOptions, Kind, OpEvent, OperationRequest, OperationResult, Spec, Verdict};
use crate::process::{self, background, hidden_command};

/// Kořenová složka Chocolatey (choco.exe, lib\, bin\).
fn root() -> Option<PathBuf> {
    let candidates = [
        // Vlastní cesta z Nastavení (je-li povolena): …\choco.exe → jeho složka
        crate::security::manager_path("chocolatey", &["choco.exe"]).and_then(|exe| Some(exe.parent()?.to_path_buf())),
        std::env::var_os("ChocolateyInstall").map(PathBuf::from),
        // „…\Chocolatey\bin\choco.exe“ je jen zástupce – kořen je o složku výš
        process::find_in_path("choco.exe").and_then(|exe| Some(exe.parent()?.parent()?.to_path_buf())),
        std::env::var_os("ProgramData").map(|data| PathBuf::from(data).join("chocolatey")),
    ];
    candidates.into_iter().flatten().find(|root| root.join("choco.exe").is_file())
}

/// Smí aktuální uživatel zapisovat do složky balíčků (přenosná instalace)?
fn user_writable(root: &Path) -> bool {
    let probe = root.join("lib").join(format!(".unibox-{}", std::process::id()));
    let writable = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    writable
}

#[derive(Serialize)]
pub struct Status {
    available: bool,
    version: Option<String>,
}

#[tauri::command]
pub async fn choco_status() -> Result<Status, String> {
    background(|| {
        let Some(root) = root() else { return Ok(Status { available: false, version: None }) };
        let mut command = hidden_command(&root.join("choco.exe").to_string_lossy());
        command.arg("--version");
        // Verze je poslední řádek (před ní může být varování o právech)
        let version = process::run(command, Duration::from_secs(30))
            .ok()
            .filter(|output| output.code == 0)
            .and_then(|output| output.stdout.lines().map(str::trim).rev().find(|l| !l.is_empty()).map(str::to_string));
        Ok(Status { available: version.is_some(), version })
    })
    .await
}

/// Nainstalovaný balíček; `name` je název z manifestu („Thunderbird (Release)“).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    package_id: String,
    name: String,
    installed_version: String,
    /// Balíček spouští instalátor (program je i v registru Windows).
    installer: bool,
}

/// Hodnota prvku z manifestu NuGet („<version>2.3.0</version>“ → „2.3.0“).
fn xml_value(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = start + xml[start..].find(&format!("</{tag}>"))?;
    let value = xml[start..end].trim().replace("&amp;", "&");
    (!value.is_empty()).then_some(value)
}

/// Id závislostí z manifestu („<dependency id="vcredist140" version="…" />“), malými písmeny.
fn dependencies(xml: &str) -> impl Iterator<Item = String> + '_ {
    xml.split("<dependency ").skip(1).filter_map(|part| {
        let rest = part.split_once("id=\"")?.1;
        Some(rest.split('"').next()?.to_ascii_lowercase())
    })
}

/// Pomocné funkce Chocolatey, které spouští instalátor (program pak vidí winget v registru).
const INSTALLER_HELPERS: &[&str] = &["Install-ChocolateyPackage", "Install-ChocolateyInstallPackage"];

/// Balíčky ve složce `lib`, které uživatel nainstaloval (ne jako závislost jiného balíčku).
fn installed_in(root: &Path) -> Vec<Installed> {
    let Ok(entries) = std::fs::read_dir(root.join("lib")) else { return Vec::new() };
    let mut packages = Vec::new();
    let mut required = HashSet::new();
    for entry in entries.flatten() {
        let folder = entry.file_name().to_string_lossy().into_owned();
        let Ok(xml) = std::fs::read_to_string(entry.path().join(format!("{folder}.nuspec"))) else { continue };
        let deps: Vec<String> = dependencies(&xml).collect();
        let script = std::fs::read_to_string(entry.path().join(r"tools\chocolateyinstall.ps1")).ok();
        // Meta-balíček bez vlastního obsahu („git“ → „git.install“)
        if script.is_none() && !deps.is_empty() {
            required.extend(deps);
            continue;
        }
        required.extend(deps);
        let installer = script.is_some_and(|s| INSTALLER_HELPERS.iter().any(|helper| s.contains(helper)));
        let (Some(id), Some(version)) = (xml_value(&xml, "id"), xml_value(&xml, "version")) else { continue };
        let name = xml_value(&xml, "title").unwrap_or_else(|| id.clone());
        packages.push(Installed { package_id: id, name, installed_version: version, installer });
    }
    packages.retain(|p| {
        let id = p.package_id.to_ascii_lowercase();
        !required.contains(&id) && !id.ends_with(".extension") && id != "chocolatey"
    });
    packages
}

#[tauri::command]
pub async fn choco_installed() -> Result<Vec<Installed>, String> {
    background(|| Ok(root().map(|root| installed_in(&root)).unwrap_or_default())).await
}

/// Balíček s novější verzí v repozitáři (`choco outdated`).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outdated {
    package_id: String,
    installed_version: String,
    available_version: String,
}

/// Řádky `choco outdated --limit-output` („git.install|2.43.0|2.44.0|false“ –
/// id, nainstalovaná verze, dostupná verze, připnuto). Připnuté balíčky choco
/// neaktualizuje, proto se vynechají.
fn parse_outdated(stdout: &str) -> Vec<Outdated> {
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.trim().split('|').map(str::trim).collect();
            let [id, installed, available, pinned] = parts[..] else { return None };
            let usable = valid_id(id) && !installed.is_empty() && !available.is_empty() && installed != available;
            (usable && !pinned.eq_ignore_ascii_case("true")).then(|| Outdated {
                package_id: id.to_string(),
                installed_version: installed.to_string(),
                available_version: available.to_string(),
            })
        })
        .collect()
}

/// Dostupné aktualizace balíčků Chocolatey – dotaz na repozitář (podle počtu
/// balíčků i desítky sekund), proto zvlášť od rychlého výpisu nainstalovaných.
#[tauri::command]
pub async fn choco_outdated() -> Result<Vec<Outdated>, String> {
    background(|| {
        let Some(root) = root() else { return Ok(Vec::new()) };
        let mut command = hidden_command(&root.join("choco.exe").to_string_lossy());
        command.args(["outdated", "--limit-output", "--ignore-pinned", "--ignore-unfound", "--no-color"]);
        let output = process::run(command, Duration::from_secs(300))?;
        // Kód 2 = jsou dostupné aktualizace (se zapnutou volbou useEnhancedExitCodes), 0 = nic / starší choco
        if output.code != 0 && output.code != 2 {
            return Err(format!("choco outdated skončil s kódem {}", output.code));
        }
        Ok(parse_outdated(&output.stdout))
    })
    .await
}

/// Výsledek hledání v repozitáři Chocolatey.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    package_id: String,
    name: String,
    version: String,
}

/// Řádky `--limit-output` („aimp|5.40.2716“).
fn limit_output(stdout: &str) -> Vec<(String, String)> {
    stdout
        .lines()
        .filter_map(|line| {
            let (id, version) = line.trim().split_once('|')?;
            (valid_id(id) && !version.is_empty()).then(|| (id.to_string(), version.to_string()))
        })
        .collect()
}

/// Hledání v repozitáři Chocolatey Community (nejvýš 50 výsledků).
#[tauri::command]
pub async fn choco_search(query: String) -> Result<Vec<Found>, String> {
    background(move || {
        let root = root().ok_or("Chocolatey není nainstalovaný")?;
        // Dotaz jen ze znaků názvů balíčků – choco ho nesmí číst jako přepínač
        let query: String = query.chars().filter(|c| c.is_alphanumeric() || " ._-".contains(*c)).collect();
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let mut command = hidden_command(&root.join("choco.exe").to_string_lossy());
        command.args(["search", query.trim(), "--limit-output", "--page=0", "--page-size=50"]);
        let output = process::run(command, Duration::from_secs(60))?;
        Ok(limit_output(&output.stdout).into_iter().map(|(id, version)| Found { name: id.clone(), package_id: id, version }).collect())
    })
    .await
}

/// Dostupné verze balíčku (od nejnovější).
#[tauri::command]
pub async fn choco_versions(package_id: String) -> Result<Vec<String>, String> {
    background(move || {
        let root = root().ok_or("Chocolatey není nainstalovaný")?;
        if !valid_id(&package_id) {
            return Err(format!("Neplatné id balíčku Chocolatey: {package_id}"));
        }
        let mut command = hidden_command(&root.join("choco.exe").to_string_lossy());
        command.args(["search", &package_id, "--exact", "--all-versions", "--limit-output"]);
        let output = process::run(command, Duration::from_secs(60))?;
        let mut versions: Vec<String> = limit_output(&output.stdout).into_iter().map(|(_, v)| v).collect();
        // Novější první (choco řadí vzestupně podle data vydání)
        versions.sort_by(|a, b| compare_versions(b, a));
        versions.dedup();
        Ok(versions)
    })
    .await
}

/// Porovnání verzí po číselných částech („5.40.2716“ > „5.4.10“).
fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |v: &str| v.split(['.', '-']).map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parts(a).cmp(&parts(b))
}

/// Nainstaluje Chocolatey oficiálním skriptem s právy správce (dialog UAC).
#[tauri::command]
pub async fn choco_setup() -> Result<(), String> {
    background(|| {
        if crate::security::policy().elevation_prohibited {
            return Err("Instalace Chocolatey potřebuje práva správce – povýšení je v Nastavení zakázané".into());
        }
        let program = crate::powershell::powershell_exe().to_string_lossy().into_owned();
        let args: Vec<String> = crate::elevation::CHOCO_SETUP_ARGS.iter().map(|s| s.to_string()).collect();
        let mut last = String::new();
        let exit = crate::elevation::run_elevated(&program, &args, &process::CancelToken::default(), |output| {
            if let process::Output::Line(line) = output {
                last = line.to_string();
            }
        })?;
        if exit.cancelled {
            return Err("Instalace Chocolatey byla zrušena".into());
        }
        if exit.code != 0 || root().is_none() {
            return Err(format!("Instalace Chocolatey selhala ({}): {last}", exit.code));
        }
        Ok(())
    })
    .await
}

/// Id balíčku Chocolatey („aimp“, „git.install“) – nic, co by choco četl jako přepínač.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && !id.starts_with('-') && id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// Argumenty choco pro operaci – stejné volby jako příkaz ke zkopírování (sourceCommand ve frontendu).
fn operation_args(request: &OperationRequest) -> Result<Vec<String>, String> {
    let id = request.package_id.as_str();
    if !valid_id(id) {
        return Err(format!("Neplatné id balíčku Chocolatey: {id}"));
    }
    let verb = match request.kind {
        Kind::Install => "install",
        Kind::Update => "upgrade",
        Kind::Uninstall => "uninstall",
        // `choco download` je jen v placených edicích
        Kind::Download => return Err("Stažení instalátoru Chocolatey neumí".into()),
        Kind::Repair => return Err("Opravu aplikace Chocolatey neumí".into()),
    };
    let mut args: Vec<String> = vec![verb.into(), id.into(), "--yes".into()];
    // Uložené volby aplikace platí i pro aktualizace
    if matches!(request.kind, Kind::Install | Kind::Update) {
        let default_options = InstallOptions::default();
        let options = request.options.as_ref().unwrap_or(&default_options);
        if let Some(version) = request.version.as_deref().filter(|v| valid_id(v) && request.kind == Kind::Install) {
            args.extend(["--version".into(), version.into()]);
        }
        if options.interactive {
            args.push("--not-silent".into());
        }
        if options.skip_hash {
            args.push("--ignore-checksums".into());
        }
        // Vlastní parametry (jen s povolením v Nastavení) a parametry z voleb HubGetu
        if let Some(custom) = options.combined_args() {
            args.push(format!("--install-arguments={custom}"));
        }
    }
    Ok(args)
}

/// Průběh stahování: „Progress: 92% - Saving 936.5 KB of 1011 KB“
/// (starší verze: „Progress: Downloading aimp 5.40.2716... 45%“).
fn parse_progress(line: &str) -> Option<f64> {
    let rest = line.strip_prefix("Progress:")?;
    let percent: f64 = rest.split_whitespace().find_map(|word| word.strip_suffix('%')?.parse().ok())?;
    (0.0..=100.0).contains(&percent).then_some(percent)
}

/// Výklad návratového kódu choco (viz docs.chocolatey.org – exit codes).
fn interpret(_kind: Kind, code: i32) -> Verdict {
    match code {
        0 => Verdict::success(false),
        // Dokončení vyžaduje restart (instalátory MSI a další)
        1641 | 3010 => Verdict::success(true),
        // Odmítnutý dialog UAC instalátoru
        1223 => Verdict::cancelled(),
        // Čeká se na restart z dřívější instalace – nic se neprovedlo
        350 => Verdict::error("restartFirst"),
        _ => Verdict::error("failed"),
    }
}

/// Spustí operaci; `id` přidělí frontend (pro zrušení přes cancel_operation).
#[tauri::command]
pub async fn choco_operation(id: String, request: OperationRequest, on_event: Channel<OpEvent>) -> Result<OperationResult, String> {
    // Firemní zásady: povolené zdroje a aplikace (org_policy.rs)
    crate::org_policy::check("chocolatey", &request)?;
    let root = root().ok_or("Chocolatey není nainstalovaný")?;
    let args = operation_args(&request)?;
    let options = request.options.as_ref();
    let (pre_command, post_command) = operations::custom_commands(&request);
    let spec = Spec {
        program: root.join("choco.exe").to_string_lossy().into_owned(),
        args,
        retry_args: None,
        kind: request.kind,
        elevated: options.is_some_and(|o| o.as_admin) || !user_writable(&root),
        background: request.background,
        interactive: options.is_some_and(|o| o.interactive) && request.kind == Kind::Install,
        parse_progress,
        // Chocolatey stahuje instalátory do %TEMP%\chocolatey\<balíček>\<verze>
        download_dirs: vec![std::env::temp_dir().join("chocolatey")],
        interpret,
        prefetch: None,
        pre_command,
        post_command,
        signer_check: None,
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
    fn progress_from_output() {
        assert_eq!(parse_progress("Progress: 92% - Saving 936.5 KB of 1011 KB"), Some(92.0));
        assert_eq!(parse_progress("Progress: Downloading aimp 5.40.2716... 45%"), Some(45.0));
        assert_eq!(parse_progress("Downloading aimp 64 bit"), None);
    }

    #[test]
    fn installed_without_dependencies() {
        let root = std::env::temp_dir().join(format!("unibox-choco-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let package = |id: &str, title: &str, deps: &[&str], script: Option<&str>| {
            let dir = root.join("lib").join(id);
            std::fs::create_dir_all(dir.join("tools")).unwrap();
            if let Some(script) = script {
                std::fs::write(dir.join(r"tools\chocolateyinstall.ps1"), script).unwrap();
            }
            let deps: String = deps.iter().map(|d| format!(r#"<dependency id="{d}" version="1.0" />"#)).collect();
            let xml = format!(
                "<?xml version=\"1.0\"?><package><metadata><id>{id}</id><version>1.2.3</version>\
                 <title>{title}</title><dependencies>{deps}</dependencies></metadata></package>"
            );
            std::fs::write(dir.join(format!("{id}.nuspec")), xml).unwrap();
        };
        let installer = Some("Install-ChocolateyPackage @packageArgs");
        package("thunderbird", "Thunderbird (Release)", &["chocolatey-core.extension"], installer);
        package("powertoys", "PowerToys", &["vcredist140"], installer);
        package("vcredist140", "Microsoft Visual C++ Redistributable", &["KB2919355"], installer);
        package("KB2919355", "Update for Windows (KB2919355)", &[], Some("Install-WindowsUpdate"));
        package("chocolatey-core.extension", "Chocolatey Core Extensions", &[], None);
        package("git", "Git", &["git.install"], None);
        package("jq", "jq", &[], Some("Get-ChocolateyWebFile @packageArgs"));
        package("sdio", "Snappy Driver Installer Origin", &[], Some("Install-ChocolateyZipPackage @packageArgs"));

        let mut found: Vec<(String, bool)> = installed_in(&root).into_iter().map(|p| (p.package_id, p.installer)).collect();
        found.sort();
        let _ = std::fs::remove_dir_all(&root);
        // Závislosti (vcredist140, KB…), rozšíření a meta-balíček (git) se nevypisují;
        // balíček s instalátorem (thunderbird) má příznak – rozhodne frontend
        let expected = [("jq", false), ("powertoys", true), ("sdio", false), ("thunderbird", true)];
        assert_eq!(found, expected.map(|(id, installer)| (id.to_string(), installer)));
    }

    #[test]
    fn outdated_from_limit_output() {
        let output = "git.install|2.43.0|2.44.0|false\r\nnotepadplusplus|8.6|8.6|false\nkeepassxc|2.7.9|2.7.10|true\n\
            Chocolatey detected you are not running from an elevated command shell\nbad id|1|2|false\n7zip|23.1.0|24.8.0|false";
        assert_eq!(
            parse_outdated(output),
            vec![
                Outdated { package_id: "git.install".into(), installed_version: "2.43.0".into(), available_version: "2.44.0".into() },
                Outdated { package_id: "7zip".into(), installed_version: "23.1.0".into(), available_version: "24.8.0".into() },
            ]
        );
    }

    #[test]
    fn arguments_and_ids() {
        assert_eq!(operation_args(&request(Kind::Install, "aimp")).unwrap(), ["install", "aimp", "--yes"]);
        assert_eq!(operation_args(&request(Kind::Update, "git.install")).unwrap(), ["upgrade", "git.install", "--yes"]);
        assert!(operation_args(&request(Kind::Install, "--force")).is_err());
        assert!(operation_args(&request(Kind::Install, "aimp & calc")).is_err());
        assert!(operation_args(&request(Kind::Download, "aimp")).is_err());
    }

    #[test]
    fn exit_codes() {
        assert!(interpret(Kind::Install, 0).outcome == operations::Outcome::Success);
        assert!(interpret(Kind::Install, 3010).restart_required);
        assert_eq!(interpret(Kind::Install, 1).error_key, Some("failed"));
    }
}
