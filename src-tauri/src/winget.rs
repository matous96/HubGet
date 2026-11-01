//! winget.
//!
//! - Stav, nainstalované balíčky, hledání a verze: PowerShell modul
//!   Microsoft.WinGet.Client – strukturovaná data nezávislá na jazyce Windows.
//! - Instalace, aktualizace, odinstalace a stažení: winget CLI – průběh
//!   stahování z výstupu a výsledek z návratového kódu (HRESULT).

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::operations::{
    self, InstallOptions, Kind, OpEvent, OperationRequest, OperationResult, Prefetch, Spec, Verdict,
};
use crate::apps;
use crate::arp;
use crate::disk;
use crate::powershell::{self, ps_string};
use crate::process::{self, background, hidden_command};

const MODULE: &str = "Microsoft.WinGet.Client";
/// Výpis nainstalovaných a hledání (první volání otevírá zdroj winget).
const QUERY_TIMEOUT: Duration = Duration::from_secs(90);
/// Instalace modulu z PowerShell Gallery.
const SETUP_TIMEOUT: Duration = Duration::from_secs(600);
/// Nejvýš tolik výsledků hledání.
const SEARCH_LIMIT: u32 = 60;

/// winget.exe – vlastní cesta z Nastavení (je-li povolena), alias aplikace
/// „App Installer“ ve WindowsApps, jinak z PATH.
pub(crate) fn winget_exe() -> String {
    if let Some(custom) = crate::security::manager_path("winget", &["winget.exe"]) {
        return custom.to_string_lossy().into_owned();
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let alias = Path::new(&local).join(r"Microsoft\WindowsApps\winget.exe");
        if alias.exists() {
            return alias.to_string_lossy().into_owned();
        }
    }
    "winget".into()
}

/// Verze winget CLI („v1.29.380“ → „1.29.380“), None = winget chybí.
fn cli_version() -> Option<String> {
    let mut command = hidden_command(&winget_exe());
    command.arg("--version");
    let output = process::run(command, Duration::from_secs(20)).ok()?;
    let version = output.stdout.trim().trim_start_matches('v').to_string();
    (output.code == 0 && !version.is_empty()).then_some(version)
}

/// Pole řetězců z odpovědi PowerShellu (prázdné hodnoty vynechá).
fn strings(value: serde_json::Value) -> Vec<String> {
    serde_json::from_value::<Vec<Option<String>>>(value)
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect()
}

// ── Stav a instalace modulu ──────────────────────────────────────────────

#[derive(Serialize)]
pub struct Status {
    available: bool,
    version: Option<String>,
}

/// winget je použitelný, pokud je nainstalované CLI i PowerShell modul.
#[tauri::command]
pub async fn winget_status() -> Result<Status, String> {
    background(|| {
        let version = cli_version();
        let module = powershell::call(
            &format!("[string](Get-Module -ListAvailable {MODULE} | Sort-Object Version -Descending | Select-Object -First 1).Version"),
            QUERY_TIMEOUT,
        )
        .map(strings)
        .unwrap_or_default();
        Ok(Status { available: version.is_some() && !module.is_empty(), version })
    })
    .await
}

/// Nainstaluje modul Microsoft.WinGet.Client pro aktuálního uživatele
/// a případně opraví / doinstaluje samotný winget.
const SETUP_SCRIPT: &str = r#"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if (-not (Get-Module -ListAvailable Microsoft.WinGet.Client)) {
  if (-not (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue)) {
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null
  }
  Install-Module -Name Microsoft.WinGet.Client -Repository PSGallery -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.WinGet.Client
if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { Repair-WinGetPackageManager -Latest | Out-Null }
"#;

#[tauri::command]
pub async fn winget_setup() -> Result<(), String> {
    background(|| powershell::call(SETUP_SCRIPT, SETUP_TIMEOUT).map(|_| ())).await
}

/// Načte modul hned po startu aplikace, ať první výpis nečeká na start PowerShellu.
pub fn warm_up() {
    std::thread::spawn(|| {
        let _ = powershell::call(&format!("Import-Module {MODULE}"), QUERY_TIMEOUT);
    });
}

// ── Nainstalované, hledání, verze ────────────────────────────────────────

#[derive(Deserialize)]
struct PsInstalled {
    id: String,
    name: String,
    version: String,
    source: String,
    update: String,
}

/// Nainstalovaný balíček; `winget_source` je „winget“, „msstore“, nebo None
/// u programů nainstalovaných mimo winget (původ určí frontend).
/// `disk_location` má program nalezený jen podle složky na disku (id „DISK\<složka>“),
/// `ea_game` hra z EA app (frontend ji ukáže jako hru se zdrojem EA app).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    package_id: String,
    name: String,
    installed_version: String,
    available_version: Option<String>,
    winget_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disk_location: Option<String>,
    /// Program rozbalený na ploše (Tor Browser): verze z jeho souborů, aktualizace
    /// instalací nové verze přes winget, odinstalace = složka do Koše.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    portable: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    ea_game: bool,
    /// Kdy byl program nainstalován (ms od 1. 1. 1970) – řazení Nově nainstalované.
    #[serde(skip_serializing_if = "Option::is_none")]
    installed_at: Option<i64>,
}

impl Installed {
    fn from_winget(p: PsInstalled) -> Self {
        // Verzi, kterou winget nezjistil, hlásí jako „Unknown“. Taková aplikace
        // vypadá vždy zastarale a ani po aktualizaci verzi nezíská – aktualizace
        // se proto nenabízí (stejně jako `winget upgrade` bez --include-unknown).
        let unknown = p.version.eq_ignore_ascii_case("unknown");
        Installed {
            installed_version: if unknown { String::new() } else { p.version },
            available_version: (!unknown && !p.update.is_empty()).then_some(p.update),
            winget_source: (!p.source.is_empty()).then_some(p.source),
            package_id: p.id,
            name: p.name,
            disk_location: None,
            portable: false,
            ea_game: false,
            installed_at: None,
        }
    }

    /// Program ze záznamu v registru – se stejným id, jaké by vypsal winget.
    fn from_arp(entry: &arp::ArpEntry) -> Self {
        Installed {
            package_id: entry.winget_id(),
            name: entry.name.clone(),
            installed_version: entry.version.clone(),
            available_version: None,
            winget_source: None,
            disk_location: None,
            portable: false,
            ea_game: entry.is_ea_game(),
            installed_at: entry.installed_at,
        }
    }

    fn from_disk(app: disk::DiskApp) -> Self {
        let location = app.folder.to_string_lossy().into_owned();
        Installed {
            package_id: format!(r"DISK\{location}"),
            name: app.name,
            // Verzi zná jen program rozbalený na ploše (frontend podle ní nabídne aktualizaci)
            installed_version: if app.desktop { disk::portable_version(&app.folder) } else { String::new() },
            available_version: None,
            winget_source: None,
            disk_location: Some(location),
            portable: app.desktop,
            ea_game: false,
            // Program bez záznamu v registru: kdy vznikla jeho složka
            installed_at: std::fs::metadata(&app.folder)
                .and_then(|meta| meta.created())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|age| age.as_millis() as i64),
        }
    }
}

/// Výpis Get-WinGetPackage. Smyčka foreach je proti ForEach-Object zhruba dvakrát
/// rychlejší. IsUpdateAvailable stojí ~1,6 ms na balíček – ptát se jen balíčků se
/// zdrojem (winget, msstore); programy mimo winget (2/3 seznamu) aktualizaci mít
/// nemůžou. Celkem ~0,9 s místo ~1,4 s. Chyba jednoho zdroje (msstore bez souhlasu
/// s podmínkami, výpadek sítě) ani jednoho balíčku nesmí shodit celý výpis.
fn winget_list() -> Result<Vec<PsInstalled>, String> {
    let script = format!(
        "Import-Module {MODULE}; foreach ($p in Get-WinGetPackage -ErrorAction SilentlyContinue) {{ $source = [string]$p.Source; \
         [pscustomobject]@{{ id = [string]$p.Id; name = [string]$p.Name; version = [string]$p.InstalledVersion; source = $source; \
         update = $(if ($source) {{ try {{ if ($p.IsUpdateAvailable) {{ [string]@($p.AvailableVersions)[0] }} else {{ '' }} }} catch {{ '' }} }} else {{ '' }}) }} }}"
    );
    let items: Vec<PsInstalled> =
        serde_json::from_value(powershell::call(&script, QUERY_TIMEOUT)?).map_err(|e| e.to_string())?;
    // Prázdný výpis znamená, že winget nic nenačetl (v registru je vždy aspoň něco)
    if items.is_empty() {
        return Err("Get-WinGetPackage nevrátil žádné balíčky".into());
    }
    Ok(items)
}

/// Je balíček z wingetu v systému opravdu? Aplikace ze Storu (MSIX v Programech
/// a funkcích nejsou) a balíčky bez záznamu v registru ověřit nejde a zůstanou;
/// jinak musí mít aspoň jeden záznam, jehož spustitelný soubor na disku existuje
/// (pozůstatky po odinstalaci se nepočítají).
fn verified(p: &PsInstalled, registry: &arp::Registry) -> bool {
    if p.source == "msstore" {
        return true;
    }
    let version = if p.version.eq_ignore_ascii_case("unknown") { "" } else { &p.version };
    let entries = registry.matching(&p.id, &p.name, version);
    entries.is_empty() || entries.iter().any(|entry| !arp::is_leftover(entry))
}

/// Kdy byl balíček nainstalován – nejnovější z jeho záznamů v registru (balíčky ze Storu záznam nemají).
fn installed_at(p: &PsInstalled, registry: &arp::Registry) -> Option<i64> {
    let version = if p.version.eq_ignore_ascii_case("unknown") { "" } else { &p.version };
    registry.matching(&p.id, &p.name, version).iter().filter_map(|entry| entry.installed_at).max()
}

/// Hra z EA app? Jen programy mimo winget (id „ARP\…“), podle jejich záznamu v registru.
fn is_ea_game(p: &PsInstalled, registry: &arp::Registry) -> bool {
    if !p.source.is_empty() {
        return false;
    }
    let version = if p.version.eq_ignore_ascii_case("unknown") { "" } else { &p.version };
    registry.matching(&p.id, &p.name, version).iter().any(|entry| entry.is_ea_game())
}

/// Nainstalované programy ve třech úrovních:
///  1. winget (Get-WinGetPackage) – balíčky wingetu a Storu i programy z registru,
///     každý ověřený v registru a na disku,
///  2. když výpis wingetu selže (chybí modul, rozbitý zdroj, jiná verze wingetu),
///     přímo registr (HKLM i HKCU) – programy, jejichž spustitelný soubor existuje,
///  3. programy, které nezná winget ani registr, podle složek na disku (disk.rs) –
///     jen se zástupcem v nabídce Start, který odliší instalaci od složky
///     ponechané odinstalátorem.
#[tauri::command]
pub async fn winget_installed() -> Result<Vec<Installed>, String> {
    background(|| {
        let registry = arp::Registry::load();
        let mut items: Vec<Installed> = match winget_list() {
            Ok(items) => items
                .into_iter()
                .filter(|p| verified(p, &registry))
                .map(|p| {
                    let ea_game = is_ea_game(&p, &registry);
                    let installed_at = installed_at(&p, &registry);
                    Installed { ea_game, installed_at, ..Installed::from_winget(p) }
                })
                .collect(),
            Err(error) => {
                eprintln!("Výpis wingetu selhal, nainstalované podle registru: {error}");
                registry.installed().into_iter().map(Installed::from_arp).collect()
            }
        };
        let known: HashSet<String> = items.iter().map(|item| arp::name_key(&item.name)).collect();
        let found = disk::scan(&registry.folders(), &known);
        if !found.is_empty() {
            let targets = apps::launch_targets(Duration::from_secs(60)).unwrap_or_default();
            items.extend(disk::with_shortcut(found, &targets).into_iter().map(Installed::from_disk));
        }
        Ok(items)
    })
    .await
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    #[serde(alias = "id")]
    package_id: String,
    name: String,
    version: String,
}

/// Pořadí posledního hledání – starší hledání, které ještě čeká, se přeskočí.
static SEARCH_SEQ: AtomicU64 = AtomicU64::new(0);

/// Hledání vrací jen id a název. Vlastnost Version by u každého výsledku stáhla
/// údaje o verzích z CDN wingetu (zdroj stahuje verze až na vyžádání): 60 výsledků
/// = 15–30 s, po kterou by sdílený PowerShell blokoval i výpis nainstalovaných.
/// Samotné hledání v místním indexu trvá ~0,1 s; verze známých balíčků má katalog
/// a konkrétní verze nabídne až detail (winget_versions).
#[tauri::command]
pub async fn winget_search(query: String) -> Result<Vec<Found>, String> {
    let seq = SEARCH_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    background(move || {
        let script = format!(
            "Import-Module {MODULE}; Find-WinGetPackage -Query {} -Source winget -Count {SEARCH_LIMIT} | ForEach-Object {{ \
             [pscustomobject]@{{ id = [string]$_.Id; name = [string]$_.Name; version = '' }} }}",
            ps_string(query.trim())
        );
        let value = powershell::call_unless(&script, QUERY_TIMEOUT, || SEARCH_SEQ.load(Ordering::SeqCst) != seq)?;
        serde_json::from_value(value).map_err(|e| e.to_string())
    })
    .await
}

/// Dostupné verze balíčku od nejnovější.
#[tauri::command]
pub async fn winget_versions(package_id: String) -> Result<Vec<String>, String> {
    background(move || {
        let script = format!(
            "Import-Module {MODULE}; @((Find-WinGetPackage -Id {} -MatchOption EqualsCaseInsensitive -Source winget | \
             Select-Object -First 1).AvailableVersions) | ForEach-Object {{ [string]$_ }}",
            ps_string(&package_id)
        );
        Ok(strings(powershell::call(&script, QUERY_TIMEOUT)?))
    })
    .await
}

// ── Mezipaměť ────────────────────────────────────────────────────────────

/// winget si stahuje instalátory a manifesty do %TEMP%\WinGet.
fn cache_dir() -> PathBuf {
    std::env::temp_dir().join("WinGet")
}

fn dir_size(path: &Path) -> u64 {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| match entry.file_type() {
                    Ok(t) if t.is_dir() => dir_size(&entry.path()),
                    Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

#[derive(Serialize)]
pub struct CacheInfo {
    size: u64,
}

#[tauri::command]
pub async fn winget_cache() -> Result<Option<CacheInfo>, String> {
    background(|| Ok(Some(CacheInfo { size: dir_size(&cache_dir()) }))).await
}

/// Smaže obsah mezipaměti; právě používané soubory přeskočí.
#[tauri::command]
pub async fn winget_clear_cache() -> Result<(), String> {
    background(|| {
        if let Ok(entries) = std::fs::read_dir(cache_dir()) {
            for entry in entries.flatten() {
                let path = entry.path();
                let _ = if path.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
            }
        }
        Ok(())
    })
    .await
}

// ── Operace ──────────────────────────────────────────────────────────────

/// Aplikace z Microsoft Storu mají id produktu bez tečky („9NKSQGP7F2NH“,
/// „XP89DCGQ3K6VLD“); balíčky z repozitáře wingetu mají vždy tvar
/// Vydavatel.Balíček. Podle toho se volí zdroj (import ze `winget export`).
pub fn is_store_id(id: &str) -> bool {
    !id.contains('.') && (12..=14).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Argumenty winget CLI pro operaci – stejné volby jako příkaz, který si
/// uživatel může zkopírovat (sourceCommand ve frontendu).
fn operation_args(request: &OperationRequest, downloads: &Path) -> Vec<String> {
    let default_options = InstallOptions::default();
    let options = request.options.as_ref().unwrap_or(&default_options);
    let id = request.package_id.as_str();
    let source = if is_store_id(id) { "msstore" } else { "winget" };
    let downloads = downloads.to_string_lossy();
    let mut args: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| args.extend(items.iter().map(|s| s.to_string()));

    match request.kind {
        Kind::Install => {
            push(&["install", "--id", id, "--exact", "--source", source]);
            push(&[if options.interactive { "--interactive" } else { "--silent" }]);
        }
        // --include-unknown: i balíčky, u kterých winget nezná nainstalovanou verzi
        Kind::Update => {
            push(&["upgrade", "--id", id, "--exact", "--include-unknown"]);
            push(&[if options.interactive { "--interactive" } else { "--silent" }]);
        }
        Kind::Uninstall => push(&["uninstall", "--id", id, "--exact", "--silent"]),
        Kind::Download => {
            push(&["download", "--id", id, "--exact", "--source", source]);
            push(&["--download-directory", downloads.as_ref()]);
        }
    }

    // Volby instalace (a u stažení výběr instalátoru); uložené volby aplikace platí i pro aktualizace
    if matches!(request.kind, Kind::Install | Kind::Download) {
        if let Some(version) = request.version.as_deref().filter(|v| !v.is_empty()) {
            push(&["--version", version]);
        }
    }
    if request.kind != Kind::Uninstall {
        if let Some(arch) = options.architecture.as_deref().filter(|a| matches!(*a, "x64" | "x86" | "arm64")) {
            push(&["--architecture", arch]);
        }
        if let Some(scope) = options.scope.as_deref().filter(|s| matches!(*s, "user" | "machine")) {
            push(&["--scope", scope]);
        }
    }
    if matches!(request.kind, Kind::Install | Kind::Update) {
        // U aktualizace aplikace ve vlastní složce zůstane tam, kde je
        if let Some(location) = options.location.as_deref().filter(|l| !l.is_empty()) {
            push(&["--location", location]);
        }
        // Vlastní parametry (jen s povolením v Nastavení) a parametry z voleb HubGetu
        if let Some(custom) = options.combined_args() {
            push(&["--custom", custom.as_str()]);
        }
        if options.skip_hash {
            push(&["--ignore-security-hash"]);
        }
    }
    if request.kind == Kind::Update && options.uninstall_previous {
        push(&["--uninstall-previous"]);
    }

    if request.kind != Kind::Uninstall {
        push(&["--accept-package-agreements"]);
    }
    push(&["--accept-source-agreements", "--disable-interactivity"]);
    args
}

/// Průběh stahování z řádku výstupu wingetu:
/// „██████▒▒▒▒  12.0 MB / 40.2 MB“, „████▒▒  45%“ nebo jen pruh.
fn parse_progress(line: &str) -> Option<f64> {
    fn bytes(number: &str, unit: &str) -> Option<f64> {
        let value: f64 = number.replace(',', ".").parse().ok()?;
        let multiplier = match unit.to_ascii_uppercase().as_str() {
            "B" => 1.0,
            "KB" | "KIB" => 1024.0,
            "MB" | "MIB" => 1024.0 * 1024.0,
            "GB" | "GIB" => 1024.0 * 1024.0 * 1024.0,
            _ => return None,
        };
        Some(value * multiplier)
    }

    if let Some((left, right)) = line.rsplit_once(" / ") {
        let left: Vec<&str> = left.split_whitespace().collect();
        let right: Vec<&str> = right.split_whitespace().collect();
        if let ([.., number, unit], [total, total_unit, ..]) = (left.as_slice(), right.as_slice()) {
            if let (Some(done), Some(total)) = (bytes(number, unit), bytes(total, total_unit)) {
                if total > 0.0 {
                    return Some((done / total * 100.0).clamp(0.0, 100.0));
                }
            }
        }
    }
    if let Some(percent) = line.split_whitespace().last().and_then(|w| w.strip_suffix('%')) {
        if let Ok(value) = percent.replace(',', ".").parse::<f64>() {
            if (0.0..=100.0).contains(&value) {
                return Some(value);
            }
        }
    }
    let full = line.chars().filter(|&c| c == '█').count();
    let empty = line.chars().filter(|&c| c == '▒').count();
    (full + empty >= 10).then(|| full as f64 / (full + empty) as f64 * 100.0)
}

/// Výklad návratového kódu wingetu (HRESULT, viz returnCodes.md v winget-cli).
fn interpret(kind: Kind, code: i32) -> Verdict {
    match code as u32 {
        0 => Verdict::success(false),
        // Dokončení vyžaduje restart (winget i instalátory MSI)
        0x8A15_0109 | 0x8A15_010B | 3010 | 1641 => Verdict::success(true),
        // Instalace už nainstalovaného balíčku bez novější verze – cíl je splněn
        0x8A15_0061 | 0x8A15_010D | 0x8A15_002B if kind == Kind::Install => Verdict::success(false),
        // Instalátor zrušil uživatel / odmítnutý dialog UAC instalátoru
        0x8A15_010C | 1223 | 0x8007_04C7 => Verdict::cancelled(),
        // Chyby, které často způsobí chybějící oprávnění: tichá odinstalace MSI
        // nainstalovaného pro všechny uživatele (msiexec 1603), instalátor bez práv
        0x8A15_0019 => Verdict::error("requiresAdmin").retry_elevated(),
        0x8A15_0030 => Verdict::error("uninstallFailed").retry_elevated(),
        0x8A15_0006 => Verdict::error("installerFailed").retry_elevated(),
        // Instalace MSI selhala – mj. aplikace pro všechny uživatele bez ALLUSERS=1 (viz winget_operation)
        MSI_INSTALL_FAILED => Verdict::error("installerFailed").retry_elevated(),
        other => Verdict::error(match other {
            // Odkaz na instalátor v manifestu nefunguje (HRESULT 0x8019xxxx = stav HTTP):
            // 403 Forbidden, 404 Not Found, 410 Gone – jiný zdroj instalace ho může mít
            0x8019_0193 | 0x8019_0194 | 0x8019_019A => "linkBroken",
            0x8019_0000..=0x8019_FFFF => "downloadFailed",
            0x8A15_0011 => "hashMismatch",
            0x8A15_0014 | 0x8A15_0017 => "notFound",
            0x8A15_0010 | 0x8A15_0113 => "noInstaller",
            0x8A15_002B => "noUpdate",
            0x8A15_0115 => "installerFailed",
            0x8A15_0008 | 0x8A15_002E => "downloadFailed",
            0x8A15_0107 => "network",
            0x8A15_0041 | 0x8A15_0046 => "agreements",
            0x8A15_002F => "uninstallFailed",
            0x8A15_0101 | 0x8A15_0103 | 0x8A15_0111 => "inUse",
            0x8A15_0102 => "busy",
            0x8A15_0104 | 0x8A15_0110 => "dependencies",
            0x8A15_0105 => "diskFull",
            0x8A15_010A => "restartFirst",
            0x8A15_010E => "downgrade",
            0x8A15_010F | 0x8A15_003A => "policy",
            0x8A15_0016 => "multiple",
            _ => "unknown",
        }),
    }
}

/// Spustí operaci; `id` přidělí frontend (pro zrušení přes cancel_operation).
#[tauri::command]
pub async fn winget_operation(
    app: AppHandle,
    id: String,
    request: OperationRequest,
    on_event: Channel<OpEvent>,
) -> Result<OperationResult, String> {
    // Program rozbalený na ploše (Tor Browser) winget po instalaci nevidí: aktualizace
    // = instalace nové verze (instalátor ji rozbalí do stejné složky), odinstalace =
    // jeho složka do Koše (obnovitelná). Složku najde backend sám podle názvu.
    let portable = if matches!(request.kind, Kind::Update | Kind::Uninstall) && !is_store_id(&request.package_id) {
        let (package_id, name) = (request.package_id.clone(), request.name.clone().unwrap_or_default());
        crate::process::background(move || Ok(is_portable(&package_id, &name))).await?
    } else {
        false
    };
    if portable && request.kind == Kind::Uninstall {
        let name = request.name.clone().unwrap_or_default();
        return crate::process::background(move || Ok(OperationResult::done(remove_portable(&name)))).await;
    }
    let request = if portable { OperationRequest { kind: Kind::Install, version: None, ..request } } else { request };
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let options = request.options.as_ref();
    // Instalátory se stahují do %TEMP%\WinGet\<id>.<verze>, u stažení případně rovnou do cíle
    let mut download_dirs = vec![cache_dir()];
    if request.kind == Kind::Download {
        download_dirs.push(downloads.clone());
    }
    // Instalátor stáhne předem HubGet (přesný průběh, bez zasekávání Delivery
    // Optimization); winget ho najde ve své pracovní složce – při instalaci,
    // aktualizaci i „Stáhnout instalátor“
    // (aplikace z Microsoft Storu stahuje Store sám – předstažení nemá smysl)
    let prefetch: Option<Box<dyn FnOnce() -> Option<Prefetch> + Send>> = match request.kind {
        Kind::Install | Kind::Update | Kind::Download if !is_store_id(&request.package_id) => {
            let args = show_args(&request);
            Some(Box::new(move || resolve_installer(&args)))
        }
        _ => None,
    };
    let (pre_command, post_command) = operations::custom_commands(&request);
    let args = operation_args(&request, &downloads);
    // Aplikace pro všechny uživatele (rozsah z voleb, jinak podle registru – čte se mimo vlákno
    // asynchronního běhu): aktualizace a odinstalace rovnou jako správce, bez neúspěšného prvního pokusu
    let scope = options.and_then(|o| o.scope.as_deref()).filter(|s| matches!(*s, "user" | "machine"));
    let machine = match (request.kind, scope) {
        (Kind::Update | Kind::Uninstall, Some(scope)) => scope == "machine",
        (Kind::Update | Kind::Uninstall, None) if !is_store_id(&request.package_id) => {
            let (package_id, name) = (request.package_id.clone(), request.name.clone());
            crate::process::background(move || Ok(machine_only(&package_id, name.as_deref()))).await?
        }
        _ => false,
    };
    // Instalátor MSI bez určeného rozsahu se spustí jen pro aktuálního uživatele a instalaci pro všechny
    // odmítne přepsat („This app is already installed for everyone… pass ALLUSERS=1“, msiexec 1603 →
    // winget 0x8A150049) – po této chybě se aktualizace zopakuje s `--custom ALLUSERS=1`.
    // Jen bez rozsahu zvoleného ve volbách (jinak ho určí winget).
    let retry_args = (request.kind == Kind::Update && machine && scope.is_none()).then(|| (MSI_INSTALL_FAILED as i32, with_custom(&args, "ALLUSERS=1")));
    let spec = Spec {
        program: winget_exe(),
        args,
        retry_args,
        kind: request.kind,
        elevated: options.is_some_and(|o| o.as_admin) || machine,
        background: request.background,
        interactive: options.is_some_and(|o| o.interactive) && matches!(request.kind, Kind::Install | Kind::Update),
        parse_progress,
        download_dirs,
        interpret,
        prefetch,
        pre_command,
        post_command,
    };
    operations::execute(id, spec, on_event).await
}

/// Program rozbalený na ploše, který winget nevidí: v registru k balíčku nic
/// není, na ploše je jeho složka (disk::portable_folder) a ve výpisu wingetu
/// chybí – aplikace ze Storu (MSIX) v registru také nejsou a stejnojmenná složka
/// na ploše nesmí místo nich skončit v Koši.
fn is_portable(package_id: &str, name: &str) -> bool {
    arp::Registry::load().matching(package_id, name, "").is_empty()
        && disk::portable_folder(name).is_some()
        && winget_list().is_ok_and(|items| !items.iter().any(|p| p.id.eq_ignore_ascii_case(package_id)))
}

/// Odinstalace programu rozbaleného na ploše: složka do Koše. Běžící program
/// (zamčené soubory) nejdřív zavře dialog „Aplikace je spuštěná“ ve frontendu.
fn remove_portable(name: &str) -> Result<(), String> {
    let folder = disk::portable_folder(name).ok_or_else(|| format!("Složka programu {name} na ploše není"))?;
    // Běžící program by Koš přesunul jen napůl (zamčené soubory zůstanou)
    if crate::running::any_running_in(&folder) {
        return Err(format!("{name} je spuštěný – zavřete ho a zkuste to znovu"));
    }
    crate::leftovers::to_recycle_bin(&folder)?;
    if folder.exists() {
        return Err(format!("Složku {} se nepodařilo celou odstranit – nejspíš běží", folder.display()));
    }
    Ok(())
}

/// Zná registr aplikaci jen „pro počítač“ (nainstalovanou pro všechny uživatele)?
fn machine_only(package_id: &str, name: Option<&str>) -> bool {
    let registry = arp::Registry::load();
    let entries = registry.matching(package_id, name.unwrap_or_default(), "");
    !entries.is_empty() && entries.iter().all(|entry| !entry.user)
}

/// winget 0x8A150049 – instalace MSI selhala (APPINSTALLER_CLI_ERROR_MSI_INSTALL_FAILED).
const MSI_INSTALL_FAILED: u32 = 0x8A15_0049;

/// Přidá parametr instalátoru do `--custom` (winget přijme jen jeden), pokud tam ještě není.
fn with_custom(args: &[String], extra: &str) -> Vec<String> {
    let mut out = args.to_vec();
    let name = extra.split('=').next().unwrap_or(extra).to_ascii_uppercase();
    match out.iter().position(|arg| arg == "--custom") {
        Some(i) if i + 1 < out.len() => {
            if !out[i + 1].split_whitespace().any(|part| part.to_ascii_uppercase().starts_with(&format!("{name}="))) {
                out[i + 1] = format!("{} {extra}", out[i + 1]);
            }
        }
        _ => out.extend(["--custom".to_string(), extra.to_string()]),
    }
    out
}

/// `winget show` pro instalátor, který winget pro operaci vybere (stejná
/// verze, architektura a rozsah jako u instalace / stažení; aktualizace =
/// nejnovější verze).
fn show_args(request: &OperationRequest) -> Vec<String> {
    let mut args: Vec<String> = ["show", "--id", &request.package_id, "--exact", "--source", "winget"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if request.kind != Kind::Uninstall {
        let options = request.options.as_ref();
        if let Some(version) = request.version.as_deref().filter(|v| !v.is_empty() && request.kind != Kind::Update) {
            args.extend(["--version".into(), version.into()]);
        }
        if let Some(arch) = options.and_then(|o| o.architecture.as_deref()).filter(|a| matches!(*a, "x64" | "x86" | "arm64")) {
            args.extend(["--architecture".into(), arch.into()]);
        }
        if let Some(scope) = options.and_then(|o| o.scope.as_deref()).filter(|s| matches!(*s, "user" | "machine")) {
            args.extend(["--scope".into(), scope.into()]);
        }
    }
    args.extend(["--accept-source-agreements".into(), "--disable-interactivity".into()]);
    args
}

/// Kam instalátor stáhnout, aby ho winget našel: winget ho hledá v
/// `%TEMP%\WinGet\<id>.<verze>\<sha256>` a před použitím ověří kontrolní součet.
fn resolve_installer(show_args: &[String]) -> Option<Prefetch> {
    let mut command = hidden_command(&winget_exe());
    command.args(show_args);
    let output = process::run(command, Duration::from_secs(60)).ok()?;
    if output.code != 0 {
        return None;
    }
    let found = parse_show(&output.stdout)?;
    Some(Prefetch {
        url: found.url,
        target: cache_dir().join(format!("{}.{}", found.id, found.version)).join(&found.sha256),
        sha256: found.sha256,
    })
}

/// Id nebo verze pro `winget show` – nic, co by winget četl jako přepínač.
fn safe_show_arg(value: &str) -> bool {
    !value.is_empty() && !value.starts_with('-') && value.chars().all(|c| c.is_alphanumeric() || "._-+".contains(c))
}

/// Adresa instalátoru konkrétní verze balíčku (`winget show --version`) – pro
/// varování, když se mezi nainstalovanou a novou verzí změní server, odkud se
/// instalátor stahuje (po vzoru UniGetUI). Verze, kterou repozitář už nemá,
/// nebo aplikace z Microsoft Storu vrátí None.
#[tauri::command]
pub async fn winget_installer_url(package_id: String, version: String) -> Result<Option<String>, String> {
    if !safe_show_arg(&package_id) || !safe_show_arg(&version) || is_store_id(&package_id) {
        return Ok(None);
    }
    background(move || {
        let mut command = hidden_command(&winget_exe());
        command.args(["show", "--id", &package_id, "--exact", "--version", &version, "--source", "winget"]);
        command.args(["--accept-source-agreements", "--disable-interactivity"]);
        let output = process::run(command, Duration::from_secs(60))?;
        Ok(if output.code == 0 { parse_show(&output.stdout).map(|found| found.url) } else { None })
    })
    .await
}

/// Vybraný instalátor z výstupu `winget show`.
#[derive(Debug, PartialEq)]
struct ShowInstaller {
    id: String,
    version: String,
    url: String,
    sha256: String,
}

/// Z výstupu `winget show` vytáhne id, verzi, adresu a SHA-256 instalátoru.
/// Popisky jsou lokalizované, proto se hledá podle tvaru hodnot:
/// „Found VLC media player [VideoLAN.VLC]“, hned pod ním řádek s verzí,
/// v sekci instalátoru 64znakový SHA-256 a nad ním řádek končící adresou.
fn parse_show(output: &str) -> Option<ShowInstaller> {
    let lines: Vec<String> =
        output.split(['\n', '\r']).map(process::clean_line).filter(|l| !l.is_empty()).collect();
    let last_word = |line: &String| line.split_whitespace().last().map(str::to_string);
    // Id a verze tvoří název složky – nic, co by mohlo vést mimo ni
    let safe = |value: &str| {
        !value.is_empty() && !value.contains("..") && value.chars().all(|c| c.is_alphanumeric() || "._-+".contains(c))
    };

    let found = lines.iter().position(|l| l.ends_with(']') && l.contains('['))?;
    let id = lines[found].rsplit_once('[')?.1.trim_end_matches(']').to_string();
    let version = last_word(lines.get(found + 1)?)?;
    let is_sha256 = |word: &str| word.len() == 64 && word.chars().all(|c| c.is_ascii_hexdigit());
    let sha_line = lines.iter().rposition(|l| last_word(l).is_some_and(|w| is_sha256(&w)))?;
    let sha256 = last_word(&lines[sha_line])?.to_ascii_lowercase();
    let url = lines[..sha_line]
        .iter()
        .rev()
        .filter_map(last_word)
        .find(|w| w.starts_with("https://") || w.starts_with("http://"))?;

    (safe(&id) && safe(&version)).then_some(ShowInstaller { id, version, url, sha256 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_from_output() {
        assert_eq!(parse_progress("██████████▒▒▒▒▒▒▒▒▒▒  20.0 MB / 40.0 MB"), Some(50.0));
        assert_eq!(parse_progress("  1,5 KB / 3 KB"), Some(50.0));
        assert_eq!(parse_progress("███████▒▒▒  70%"), Some(70.0));
        assert_eq!(parse_progress("Found VLC media player [VideoLAN.VLC] Version 3.0.21"), None);
        assert_eq!(parse_progress("Downloading https://get.videolan.org/vlc/3.0.21/win64/vlc.exe"), None);
    }

    #[test]
    fn store_ids_use_msstore_source() {
        assert!(is_store_id("9NKSQGP7F2NH"));
        assert!(is_store_id("XP89DCGQ3K6VLD"));
        assert!(!is_store_id("Mozilla.Firefox"));
        assert!(!is_store_id("ARP\\User\\X64\\Discord"));
        let request = |id: &str| OperationRequest {
            kind: Kind::Install,
            package_id: id.into(),
            version: None,
            options: None,
            name: None,
            background: false,
        };
        let args = operation_args(&request("9NKSQGP7F2NH"), Path::new("C:\\Stažené"));
        assert!(args.windows(2).any(|w| w == ["--source", "msstore"]));
        let args = operation_args(&request("VideoLAN.VLC"), Path::new("C:\\Stažené"));
        assert!(args.windows(2).any(|w| w == ["--source", "winget"]));
    }

    #[test]
    fn update_uses_saved_options() {
        let update = |options: Option<InstallOptions>| OperationRequest {
            kind: Kind::Update,
            package_id: "VideoLAN.VLC".into(),
            version: Some("3.0.0".into()),
            options,
            name: None,
            background: false,
        };
        let plain = operation_args(&update(None), Path::new("C:\\Stažené"));
        assert!(plain.contains(&"--silent".to_string()) && !plain.contains(&"--version".to_string()));
        assert!(!plain.contains(&"--uninstall-previous".to_string()));
        let options = InstallOptions {
            interactive: true,
            architecture: Some("x64".into()),
            location: Some("D:\\Apps\\VLC".into()),
            skip_hash: true,
            uninstall_previous: true,
            ..Default::default()
        };
        let args = operation_args(&update(Some(options)), Path::new("C:\\Stažené"));
        assert!(args.contains(&"--interactive".to_string()) && !args.contains(&"--silent".to_string()));
        assert!(args.windows(2).any(|w| w == ["--architecture", "x64"]));
        assert!(args.windows(2).any(|w| w == ["--location", "D:\\Apps\\VLC"]));
        assert!(args.contains(&"--ignore-security-hash".to_string()));
        assert!(args.contains(&"--uninstall-previous".to_string()));
    }

    #[test]
    fn exit_codes() {
        assert!(interpret(Kind::Install, 0).outcome == operations::Outcome::Success);
        assert!(interpret(Kind::Install, 0x8A15_0109_u32 as i32).restart_required);
        assert_eq!(interpret(Kind::Install, 0x8A15_0011_u32 as i32).error_key, Some("hashMismatch"));
        assert!(interpret(Kind::Install, 0x8A15_002B_u32 as i32).outcome == operations::Outcome::Success);
        assert_eq!(interpret(Kind::Update, 0x8A15_002B_u32 as i32).error_key, Some("noUpdate"));
        // Neplatný odkaz na instalátor (AIMP 5.10: „0x80190194 : Not found (404)“)
        assert_eq!(interpret(Kind::Install, 0x8019_0194_u32 as i32).error_key, Some("linkBroken"));
        assert_eq!(interpret(Kind::Install, 0x8019_01F7_u32 as i32).error_key, Some("downloadFailed"));
        // Tichá odinstalace MSI bez práv správce → zkusit znovu jako správce
        let uninstall = interpret(Kind::Uninstall, 0x8A15_0030_u32 as i32);
        assert_eq!(uninstall.error_key, Some("uninstallFailed"));
        assert!(uninstall.retry_elevated);
        assert!(!interpret(Kind::Update, 0x8A15_0111_u32 as i32).retry_elevated);
        // Selhaná instalace MSI (EffectCraft 0.18.0 pro všechny uživatele bez ALLUSERS=1) → znovu jako správce
        let msi = interpret(Kind::Update, MSI_INSTALL_FAILED as i32);
        assert_eq!(msi.error_key, Some("installerFailed"));
        assert!(msi.retry_elevated);
    }

    #[test]
    fn custom_installer_argument() {
        let s = |items: &[&str]| items.iter().map(|i| i.to_string()).collect::<Vec<_>>();
        // Bez --custom se přidá
        assert_eq!(with_custom(&s(&["upgrade", "--silent"]), "ALLUSERS=1"), s(&["upgrade", "--silent", "--custom", "ALLUSERS=1"]));
        // Ke stávajícím vlastním parametrům se připojí (winget bere jen jeden --custom)
        assert_eq!(
            with_custom(&s(&["upgrade", "--custom", "ADDDESKTOPICON=0"]), "ALLUSERS=1"),
            s(&["upgrade", "--custom", "ADDDESKTOPICON=0 ALLUSERS=1"])
        );
        // Už zadaný ALLUSERS se nepřepíše
        assert_eq!(with_custom(&s(&["upgrade", "--custom", "allusers=2"]), "ALLUSERS=1"), s(&["upgrade", "--custom", "allusers=2"]));
    }

    #[test]
    fn installer_from_show() {
        let output = "   -\u{8}\\\u{8}\rFound VLC media player [VideoLAN.VLC]\r\nVersion: 3.0.24\r\nPublisher: VideoLAN\r\n\
            Publisher Url: https://www.videolan.org/\r\nInstaller:\r\n  Installer Type: wix\r\n  \
            Installer Url: https://download.videolan.org/vlc-3.0.24-win64.msi\r\n  \
            Installer SHA256: 22172095CE4C2D5F5B600BB4C142D78105DB29A77FA59A931941876F3B20F6D0\r\n  Release Date: 2026-09-21\r\n";
        assert_eq!(
            parse_show(output),
            Some(ShowInstaller {
                id: "VideoLAN.VLC".into(),
                version: "3.0.24".into(),
                url: "https://download.videolan.org/vlc-3.0.24-win64.msi".into(),
                sha256: "22172095ce4c2d5f5b600bb4c142d78105db29a77fa59a931941876f3b20f6d0".into(),
            })
        );
        // Bez kontrolního součtu (Microsoft Store) se nepředstahuje
        assert_eq!(parse_show("Found WhatsApp [9NKSQGP7F2NH]\nVersion: Unknown\n"), None);
        // Id mimo složku se odmítne
        assert_eq!(
            parse_show("Found X [..\\evil]\nVersion: 1\nUrl: https://a/b\nSHA256: 22172095ce4c2d5f5b600bb4c142d78105db29a77fa59a931941876f3b20f6d0"),
            None
        );
    }

    #[test]
    fn show_arguments_are_checked() {
        assert!(safe_show_arg("VideoLAN.VLC") && safe_show_arg("3.0.24") && safe_show_arg("1.0.0+build"));
        assert!(!safe_show_arg("--manifest") && !safe_show_arg("a b") && !safe_show_arg("x;calc") && !safe_show_arg(""));
    }
}
