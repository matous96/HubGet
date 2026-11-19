//! Aplikace spouštěné po přihlášení – stránka „Po spuštění“.
//!
//! Zdroje (jako Správce úloh a Autoruns):
//!  - registr: `Run` aktuálního uživatele (HKCU) a všech uživatelů (HKLM,
//!    64bitový i 32bitový pohled WOW6432Node),
//!  - složky Po spuštění: uživatele (`%AppData%\…\Startup`) a všech uživatelů
//!    (`%ProgramData%\…\StartUp`), zástupci se rozbalí na cílový program,
//!  - plánovač úloh: úlohy mimo `\Microsoft\` se spouštěčem při přihlášení
//!    nebo při startu počítače,
//!  - aplikace ze Storu / MSIX: spouštěcí úlohy z manifestu balíčku
//!    (`windows.startupTask` – Teams, WhatsApp, Terminál…), stav v registru
//!    `AppModel\SystemAppData\<rodina balíčku>\<TaskId>` (hodnota `State`).
//!
//! Zapnutí a vypnutí jako ve Správci úloh: položky registru a složek se
//! nemažou, jen se zapíše stav do `Explorer\StartupApproved` (první bajt sudý =
//! zapnuto, lichý = vypnuto); úlohy přes `schtasks /Change`; aplikace ze Storu
//! zapsáním `State` (2 = zapnuto, 1 = vypnul uživatel – aplikace si ji sama znovu
//! zapnout nemůže). Smazání: hodnota registru se předtím zazáloží (`reg export`
//! celého klíče Run), zástupce jde do Koše, úloha se uloží do XML; spouštěcí úlohu
//! aplikace ze Storu odstraní jen odinstalace aplikace (je součástí balíčku).
//! Položky pro všechny uživatele (HKLM, společná složka, úlohy správce) změní
//! povýšený pomocník (jedno potvrzení UAC), který si zadání sám znovu ověří.
//!
//! Vliv na spuštění: Windows při každém přihlášení měří prvních 90 sekund
//! (WDI StartupInfo – podle něj počítá vliv i Správce úloh). Soubory smí číst
//! jen správce, proto je „Změřit vliv“ jednou přečte povýšený pomocník;
//! výsledek se uloží a stupně se počítají jako ve Správci úloh: vysoký = přes
//! 1 s procesoru nebo 3 MB z disku, střední = přes 300 ms nebo 300 KB, jinak nízký.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::arp::expand;
use crate::process::{background, hidden_command, system_tool};

/// Parametr povýšeného pomocníka pro změny položek po spuštění a měření vlivu.
pub const ELEVATED_STARTUP_FLAG: &str = "--unibox-elevated-startup";

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_WOW: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";
/// Balíčky aplikací ze Storu / MSIX aktuálního uživatele (HKCU).
const APPMODEL: &str = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel";

// ── Položky ──────────────────────────────────────────────────────────────

/// Kde položka je – z toho vznikne i její id (`reg|HKCU|Run|Discord`).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Location {
    /// Hodnota v klíči Run: `machine` = HKLM, `wow` = 32bitový pohled (WOW6432Node).
    Run { machine: bool, wow: bool, value: String },
    /// Soubor ve složce Po spuštění: `common` = pro všechny uživatele.
    Folder { common: bool, file: String },
    /// Úloha plánovače (celá cesta, „\Vendor\Úloha“).
    Task { path: String },
    /// Spouštěcí úloha aplikace ze Storu: rodina balíčku („5319275A.WhatsAppDesktop_cv1g1gvanyjgm“) a TaskId.
    Package { family: String, task: String },
}

impl Location {
    fn id(&self) -> String {
        match self {
            Location::Run { machine, wow, value } => {
                format!("reg|{}|{}|{value}", if *machine { "HKLM" } else { "HKCU" }, if *wow { "Run32" } else { "Run" })
            }
            Location::Folder { common, file } => format!("folder|{}|{file}", if *common { "common" } else { "user" }),
            Location::Task { path } => format!("task|{path}"),
            Location::Package { family, task } => format!("app|{family}|{task}"),
        }
    }

    /// Rozebere id a ověří, že míří jen na povolená místa (id přichází z frontendu
    /// i v zadání povýšeného pomocníka).
    fn parse(id: &str) -> Option<Location> {
        let mut parts = id.splitn(4, '|');
        match parts.next()? {
            "reg" => {
                let machine = match parts.next()? {
                    "HKCU" => false,
                    "HKLM" => true,
                    _ => return None,
                };
                let wow = match parts.next()? {
                    "Run" => false,
                    "Run32" if machine => true,
                    _ => return None,
                };
                let value = parts.next()?.to_string();
                (!value.is_empty()).then_some(Location::Run { machine, wow, value })
            }
            "folder" => {
                let common = match parts.next()? {
                    "user" => false,
                    "common" => true,
                    _ => return None,
                };
                let rest: Vec<&str> = parts.collect();
                let file = rest.join("|");
                // Jen název souboru přímo ve složce – žádné cesty ani „..“
                let valid = !file.is_empty() && !file.contains(['\\', '/', ':']) && file != "." && file != ".." && !file.starts_with("..");
                valid.then_some(Location::Folder { common, file })
            }
            "task" => {
                let rest: Vec<&str> = parts.collect();
                let path = rest.join("|");
                let valid = path.starts_with('\\')
                    && path.len() > 1
                    && !path.to_ascii_lowercase().starts_with(r"\microsoft\")
                    && !path.contains("..")
                    && !path.chars().any(|c| c.is_control() || c == '"');
                valid.then_some(Location::Task { path })
            }
            "app" => {
                // Obojí míří do cesty v registru – jen znaky, které rodina balíčku a TaskId smí mít
                let family = parts.next()?.to_string();
                let task = parts.collect::<Vec<&str>>().join("|");
                let family_ok = family.contains('_')
                    && family.len() <= 128
                    && family.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
                let task_ok = !task.is_empty()
                    && task.len() <= 255
                    && task.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '{' | '}'));
                (family_ok && task_ok).then_some(Location::Package { family, task })
            }
            _ => None,
        }
    }

    /// Položka pro všechny uživatele (změna vyžaduje práva správce).
    fn machine(&self) -> bool {
        match self {
            Location::Run { machine, .. } => *machine,
            Location::Folder { common, .. } => *common,
            Location::Task { .. } | Location::Package { .. } => false,
        }
    }

    /// Klíč se stavem spouštěcí úlohy aplikace ze Storu (HKCU).
    fn package_state_key(&self) -> Option<String> {
        match self {
            Location::Package { family, task } => Some(format!(r"{APPMODEL}\SystemAppData\{family}\{task}")),
            _ => None,
        }
    }

    /// Klíč StartupApproved a název hodnoty (jen registr a složky).
    fn approved(&self) -> Option<(bool, String, &str)> {
        match self {
            Location::Run { machine, wow, value } => {
                Some((*machine, format!(r"{APPROVED}\{}", if *wow { "Run32" } else { "Run" }), value.as_str()))
            }
            Location::Folder { common, file } => Some((*common, format!(r"{APPROVED}\StartupFolder"), file.as_str())),
            Location::Task { .. } | Location::Package { .. } => None,
        }
    }
}

/// Odkud položka je.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Registry,
    Folder,
    Task,
    /// Aplikace ze Storu / MSIX (spouštěcí úloha z manifestu balíčku).
    Package,
}

/// Vliv na rychlost spuštění (stupně jako ve Správci úloh).
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Impact {
    High,
    Medium,
    Low,
}

/// Jedna položka po spuštění pro frontend.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    id: String,
    source: Source,
    /// Pro všechny uživatele počítače.
    machine: bool,
    /// Název hodnoty registru, zástupce nebo úlohy.
    name: String,
    /// Popis programu (FileDescription) – jako název ve Správci úloh.
    description: Option<String>,
    publisher: Option<String>,
    command: String,
    /// Spouštěný program (pro ikonu a „Otevřít umístění“).
    target: Option<String>,
    /// Kde položka je (klíč registru, složka, cesta úlohy).
    location: String,
    enabled: bool,
    /// Změna nejspíš vyžaduje práva správce.
    admin: bool,
    /// Spouštěný program na disku není (zbytek po odinstalaci).
    missing: bool,
    impact: Option<Impact>,
    cpu_ms: Option<u64>,
    disk_bytes: Option<u64>,
}

/// Výsledek výpisu.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupList {
    items: Vec<StartupItem>,
    /// Kdy Windows naposledy měřil vliv (sekundy od 1970), None = ještě neměřeno.
    measured_at: Option<u64>,
    /// Úlohy plánovače se nepodařilo načíst (zbytek seznamu platí).
    tasks_error: Option<String>,
}

/// Výsledek změny: hotovo, nebo jsou potřeba práva správce (povýšení zakázané / UAC odmítnut).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    done: bool,
    needs_admin: bool,
    /// Složka se zálohou (smazání).
    backup: Option<String>,
}

/// Programy z posledního výpisu – jen jejich ikony smí protokol icon:// číst
/// (u aplikací ze Storu i `shell:AppsFolder\<rodina>!<aplikace>` – program ve WindowsApps
/// shell jako položku neotevře, ikonu dá aplikace).
static TARGETS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Je soubor spouštěným programem (nebo aplikací ze Storu) některé položky po spuštění?
pub fn is_listed_target(path: &str) -> bool {
    TARGETS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|set| set.contains(&path.to_lowercase()))
}

/// Seznam položek po spuštění (registr, složky, plánovač, aplikace ze Storu) s vlivem z posledního měření.
#[tauri::command]
pub async fn startup_items(app: AppHandle) -> Result<StartupList, String> {
    let cache = impact_cache(&app);
    background(move || {
        let mut raw = run_entries();
        raw.extend(folder_entries());
        let tasks = task_entries();
        let tasks_error = tasks.as_ref().err().cloned();
        raw.extend(tasks.unwrap_or_default());
        raw.extend(package_entries());

        let measurement = cache.as_deref().and_then(load_measurement);
        let items: Vec<StartupItem> = raw.into_iter().map(|entry| entry.into_item(measurement.as_ref())).collect();
        let apps = items.iter().filter(|i| i.source == Source::Package && i.command.starts_with(r"shell:AppsFolder\")).map(|i| i.command.to_lowercase());
        let targets = items.iter().filter_map(|i| i.target.as_ref().map(|t| t.to_lowercase())).chain(apps).collect();
        *TARGETS.lock().unwrap_or_else(|e| e.into_inner()) = Some(targets);
        Ok(StartupList { items, measured_at: measurement.map(|m| m.measured_at), tasks_error })
    })
    .await
}

/// Položka před doplněním informací o programu a vlivu.
struct Entry {
    location: Location,
    name: String,
    command: String,
    /// Program a jeho argumenty.
    target: Option<(PathBuf, String)>,
    location_text: String,
    enabled: bool,
    admin: bool,
    /// Úloha: autor jako vydavatel, když program žádného nemá (aplikace ze Storu: vydavatel z manifestu).
    author: Option<String>,
    /// Úloha: popis, když program žádný nemá (aplikace ze Storu: název z manifestu – má přednost).
    description: Option<String>,
}

impl Entry {
    fn into_item(self, measurement: Option<&Measurement>) -> StartupItem {
        let (mut description, mut publisher) = self.target.as_ref().map(|(path, _)| version_strings(path)).unwrap_or((None, None));
        // Aplikace ze Storu: název a vydavatel z manifestu (jako Správce úloh), ne z popisu programu
        if matches!(self.location, Location::Package { .. }) {
            description = self.description.clone().or(description);
            publisher = self.author.clone().or(publisher);
        }
        let missing = self.target.as_ref().is_some_and(|(path, _)| path.is_absolute() && !path.exists());
        let usage = measurement.and_then(|m| {
            let (path, args) = self.target.as_ref()?;
            usage_for(path, args, &m.processes)
        });
        StartupItem {
            id: self.location.id(),
            source: match self.location {
                Location::Run { .. } => Source::Registry,
                Location::Folder { .. } => Source::Folder,
                Location::Task { .. } => Source::Task,
                Location::Package { .. } => Source::Package,
            },
            machine: self.location.machine() || (self.admin && matches!(self.location, Location::Task { .. })),
            name: self.name,
            description: description.or(self.description),
            publisher: publisher.or(self.author),
            command: self.command,
            target: self.target.map(|(path, _)| path.to_string_lossy().into_owned()),
            location: self.location_text,
            enabled: self.enabled,
            admin: self.admin,
            missing,
            // Vypnutá položka se při přihlášení nespustila – vliv nemá
            impact: usage.filter(|_| self.enabled).map(|(cpu, disk)| impact(cpu, disk)),
            cpu_ms: usage.map(|(cpu, _)| cpu / 1000),
            disk_bytes: usage.map(|(_, disk)| disk),
        }
    }
}

/// Program a argumenty z příkazové řádky („"C:\…\a.exe" --tray“, cesty bez uvozovek s mezerami,
/// proměnné prostředí, program ze System32 bez cesty).
pub(crate) fn command_target(command: &str) -> Option<(PathBuf, String)> {
    let line = expand(command.trim());
    if line.is_empty() {
        return None;
    }
    if let Some(rest) = line.strip_prefix('"') {
        let end = rest.find('"').unwrap_or(rest.len());
        let args = rest.get(end + 1..).unwrap_or("").trim().to_string();
        return Some((with_system_dir(&rest[..end]), args));
    }
    // Bez uvozovek: nejkratší začátek, který je existující soubor („C:\Program Files\X\x.exe /a“)
    let parts: Vec<&str> = line.split(' ').collect();
    for i in 1..=parts.len() {
        let candidate = parts[..i].join(" ");
        for path in [candidate.clone(), format!("{candidate}.exe")] {
            if Path::new(&path).is_file() {
                return Some((PathBuf::from(path), parts[i..].join(" ").trim().to_string()));
            }
        }
    }
    Some((with_system_dir(parts[0]), parts[1..].join(" ").trim().to_string()))
}

/// Program bez cesty („rundll32.exe“) je ze System32.
fn with_system_dir(program: &str) -> PathBuf {
    let path = Path::new(program);
    if path.is_absolute() || program.contains('\\') {
        return path.to_path_buf();
    }
    let file = if Path::new(program).extension().is_some() { program.to_string() } else { format!("{program}.exe") };
    let system = system_tool(&file);
    if system.is_file() {
        system
    } else {
        path.to_path_buf()
    }
}

// ── Registr ──────────────────────────────────────────────────────────────

/// Hodnoty klíčů Run (HKCU, HKLM, HKLM WOW6432Node).
fn run_entries() -> Vec<Entry> {
    let mut entries = Vec::new();
    for (machine, wow) in [(false, false), (true, false), (true, true)] {
        let key_path = if wow { RUN_WOW } else { RUN };
        for (value, command) in registry::string_values(machine, key_path) {
            let location = Location::Run { machine, wow, value: value.clone() };
            let enabled = approved_state(&location);
            entries.push(Entry {
                target: command_target(&command),
                name: value,
                command,
                location_text: format!(r"{}\{key_path}", if machine { "HKLM" } else { "HKCU" }),
                enabled,
                admin: machine,
                location,
                author: None,
                description: None,
            });
        }
    }
    entries
}

/// Zapnuto podle StartupApproved (hodnota chybí = zapnuto, lichý první bajt = vypnuto).
fn approved_state(location: &Location) -> bool {
    let Some((machine, key, value)) = location.approved() else { return true };
    registry::binary_value(machine, &key, value).map_or(true, |bytes| is_enabled_flag(&bytes))
}

/// Hodnota `value` v klíči Run je zapnutá (vypnutou nechávají Správce úloh i HubGet v klíči,
/// jen ji označí ve StartupApproved) – usage.rs.
pub(crate) fn run_value_enabled(machine: bool, wow: bool, value: &str) -> bool {
    approved_state(&Location::Run { machine, wow, value: value.to_string() })
}

fn is_enabled_flag(bytes: &[u8]) -> bool {
    bytes.first().map_or(true, |flag| flag & 1 == 0)
}

/// Hodnota StartupApproved: 02 = zapnuto, 03 + čas vypnutí (FILETIME) = vypnuto.
fn approved_bytes(enabled: bool) -> Vec<u8> {
    let mut bytes = vec![if enabled { 2 } else { 3 }, 0, 0, 0];
    let filetime = if enabled {
        0u64
    } else {
        // FILETIME: stovky nanosekund od 1. 1. 1601
        let since_1970 = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        (since_1970.as_nanos() / 100) as u64 + 116_444_736_000_000_000
    };
    bytes.extend_from_slice(&filetime.to_le_bytes());
    bytes
}

// ── Složky Po spuštění ───────────────────────────────────────────────────

fn startup_dir(common: bool) -> Option<PathBuf> {
    let (var, rest) = if common {
        ("ProgramData", r"Microsoft\Windows\Start Menu\Programs\StartUp")
    } else {
        ("APPDATA", r"Microsoft\Windows\Start Menu\Programs\Startup")
    };
    std::env::var_os(var).map(|root| PathBuf::from(root).join(rest))
}

/// Zástupci a programy ve složkách Po spuštění.
fn folder_entries() -> Vec<Entry> {
    let mut entries = Vec::new();
    for common in [false, true] {
        let Some(dir) = startup_dir(common) else { continue };
        let Ok(read) = std::fs::read_dir(&dir) else { continue };
        for file in read.flatten() {
            let path = file.path();
            let name = file.file_name().to_string_lossy().into_owned();
            if !path.is_file() || name.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            let is_link = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
            let (command, target) = if is_link {
                match shell_link(&path) {
                    Some((program, args)) => {
                        let command = if args.is_empty() { format!("\"{program}\"") } else { format!("\"{program}\" {args}") };
                        (command, Some((PathBuf::from(program), args)))
                    }
                    None => (path.to_string_lossy().into_owned(), None),
                }
            } else {
                (path.to_string_lossy().into_owned(), Some((path.clone(), String::new())))
            };
            let location = Location::Folder { common, file: name.clone() };
            entries.push(Entry {
                enabled: approved_state(&location),
                name: Path::new(&name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(name),
                command,
                target,
                location_text: dir.to_string_lossy().into_owned(),
                admin: common,
                location,
                author: None,
                description: None,
            });
        }
    }
    entries
}

/// Cíl a argumenty zástupce (.lnk) přes IShellLink.
#[cfg(windows)]
fn shell_link(path: &Path) -> Option<(String, String)> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    // SAFETY: COM se inicializuje v tomto vlákně a na konci uvolní; vyrovnávací
    // paměti mají pevnou délku a API do nich zapisuje nejvýš tolik znaků.
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<(String, String)> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.cast::<IPersistFile>()?.Load(&HSTRING::from(path.as_os_str()), STGM_READ)?;
            let mut target = [0u16; 1024];
            link.GetPath(&mut target, std::ptr::null_mut(), 0)?;
            let mut args = [0u16; 2048];
            link.GetArguments(&mut args)?;
            let text = |buffer: &[u16]| {
                let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
                String::from_utf16_lossy(&buffer[..len]).trim().to_string()
            };
            Ok((text(&target), text(&args)))
        })();
        if com.is_ok() {
            CoUninitialize();
        }
        result.ok().filter(|(target, _)| !target.is_empty())
    }
}

#[cfg(not(windows))]
fn shell_link(_path: &Path) -> Option<(String, String)> {
    None
}

// ── Plánovač úloh ────────────────────────────────────────────────────────

/// Úlohy mimo \Microsoft\ se spouštěčem při přihlášení nebo startu (PowerShell, ScheduledTasks).
const TASKS_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$tasks = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object {
  $kinds = @($_.Triggers | ForEach-Object { $_.CimClass.CimClassName })
  $logon = $kinds -contains 'MSFT_TaskLogonTrigger'
  $boot = $kinds -contains 'MSFT_TaskBootTrigger'
  if (-not ($logon -or $boot)) { return }
  $action = @($_.Actions | Where-Object { $_.Execute }) | Select-Object -First 1
  [pscustomobject]@{
    path = $_.TaskPath + $_.TaskName
    name = $_.TaskName
    enabled = ([string]$_.State -ne 'Disabled')
    execute = [string]$action.Execute
    arguments = [string]$action.Arguments
    author = [string]$_.Author
    description = [string]$_.Description
    user = [string]$_.Principal.UserId
    highest = ([string]$_.Principal.RunLevel -eq 'Highest')
  }
})
ConvertTo-Json -InputObject $tasks -Compress -Depth 3
"#;

#[derive(Deserialize)]
struct RawTask {
    path: String,
    name: String,
    enabled: bool,
    #[serde(default)]
    execute: String,
    #[serde(default)]
    arguments: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    user: String,
    #[serde(default)]
    highest: bool,
}

fn task_entries() -> Result<Vec<Entry>, String> {
    let encoded = base64::engine::general_purpose::STANDARD.encode(TASKS_SCRIPT.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
    let mut command = hidden_command(&crate::powershell::powershell_exe().to_string_lossy());
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
    let output = crate::process::run(command, Duration::from_secs(45))?;
    let text = output.stdout.trim().trim_start_matches('\u{feff}');
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let tasks: Vec<RawTask> = serde_json::from_str(text).map_err(|e| format!("Úlohy plánovače nejde přečíst: {e}"))?;
    let me = std::env::var("USERNAME").unwrap_or_default().to_lowercase();
    Ok(tasks
        .into_iter()
        .filter_map(|task| {
            let location = Location::parse(&format!("task|{}", task.path))?;
            let execute = task.execute.trim().trim_matches('"').to_string();
            let target = (!execute.is_empty()).then(|| (with_system_dir(&expand(&execute)), expand(&task.arguments)));
            let command = match (execute.is_empty(), task.arguments.trim().is_empty()) {
                (true, _) => String::new(),
                (false, true) => format!("\"{execute}\""),
                (false, false) => format!("\"{execute}\" {}", task.arguments.trim()),
            };
            // Úloha jiného účtu (SYSTEM, správci) nebo s nejvyššími právy – změna vyžaduje správce
            let user = task.user.rsplit('\\').next().unwrap_or("").to_lowercase();
            let admin = task.highest || user.is_empty() || user != me;
            Some(Entry {
                name: task.name,
                command,
                target,
                location_text: task.path.clone(),
                enabled: task.enabled,
                admin,
                location,
                author: Some(task.author).filter(|a| !a.is_empty() && !a.starts_with('$')),
                description: Some(task.description).filter(|d| !d.is_empty() && !d.starts_with('$')),
            })
        })
        .collect())
}

/// Spustí schtasks.exe; true = skončil úspěchem.
fn schtasks(args: &[&str]) -> bool {
    let mut command = hidden_command(&system_tool("schtasks.exe").to_string_lossy());
    command.args(args);
    crate::process::run(command, Duration::from_secs(30)).is_ok_and(|out| out.code == 0)
}

// ── Aplikace ze Storu ────────────────────────────────────────────────────

/// Spouštěcí úloha z manifestu balíčku (`windows.startupTask`).
#[derive(Debug, PartialEq)]
struct ManifestTask {
    id: String,
    /// Výchozí stav z manifestu (když ho Windows ještě nezapsal do registru).
    enabled: bool,
    display_name: Option<String>,
    /// Program relativně ke složce balíčku.
    executable: Option<String>,
    /// Id aplikace v balíčku (spuštění přes `shell:AppsFolder`).
    app_id: Option<String>,
}

/// Spouštěcí úlohy z AppxManifest.xml: rozšíření `Category="windows.startupTask"`
/// (program, jinak program aplikace) a v něm `…:StartupTask` (TaskId, Enabled, DisplayName).
fn manifest_startup_tasks(xml: &str) -> Vec<ManifestTask> {
    let mut tasks: Vec<ManifestTask> = Vec::new();
    let mut from = 0;
    while let Some(found) = xml[from..].find("\"windows.startupTask\"") {
        let at = from + found;
        from = at + 1;
        let (Some(open), Some(close)) = (xml[..at].rfind('<'), xml[at..].find('>').map(|i| at + i)) else { break };
        let extension = &xml[open..close];
        let Some(task_at) = xml[close..].find("StartupTask ").map(|i| close + i) else { continue };
        let Some(task_end) = xml[task_at..].find('>').map(|i| task_at + i) else { continue };
        let task = &xml[task_at..task_end];
        let Some(id) = attribute(task, "TaskId").filter(|id| !id.is_empty()) else { continue };
        // Stejnou úlohu můžou deklarovat dvě aplikace balíčku (Xbox) – stačí jednou
        if tasks.iter().any(|t| t.id == id) {
            continue;
        }
        let application = xml[..open].rfind("<Application ").and_then(|start| xml[start..].find('>').map(|end| &xml[start..start + end]));
        tasks.push(ManifestTask {
            id,
            enabled: attribute(task, "Enabled").is_some_and(|v| v.eq_ignore_ascii_case("true")),
            display_name: attribute(task, "DisplayName").filter(|n| !n.trim().is_empty()),
            executable: attribute(extension, "Executable").or_else(|| application.and_then(|a| attribute(a, "Executable"))),
            app_id: application.and_then(|a| attribute(a, "Id")),
        });
    }
    tasks
}

/// Rodina balíčku z plného názvu („Name_Verze_Arch_ResourceId_PublisherId“ → „Name_PublisherId“);
/// balíčky zdrojů (ResourceId – jazyky, měřítka) a neplatné názvy → None.
fn package_family(full_name: &str) -> Option<String> {
    let parts: Vec<&str> = full_name.split('_').collect();
    (parts.len() == 5 && !parts[0].is_empty() && parts[3].is_empty() && !parts[4].is_empty()).then(|| format!("{}_{}", parts[0], parts[4]))
}

/// Verze z plného názvu balíčku (výběr nejnovější nainstalované).
fn package_version(full_name: &str) -> Vec<u32> {
    full_name.split('_').nth(1).map(|v| v.split('.').map(|part| part.parse().unwrap_or(0)).collect()).unwrap_or_default()
}

/// Stav spouštěcí úlohy (StartupTaskState): 2 = zapnuto, 4 = zapnuto zásadou;
/// 0 = vypnuto, 1 = vypnul uživatel, 3 = vypnuto zásadou.
fn package_enabled(state: u32) -> bool {
    matches!(state, 2 | 4)
}

/// Text z prostředků balíčku („ms-resource:AppName“, „@{…}“) – jiný text beze změny.
fn package_string(full_name: &str, value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let name = full_name.split('_').next().unwrap_or_default();
    let source = if value.starts_with("@{") {
        value.to_string()
    } else if let Some(rest) = value.strip_prefix("ms-resource:") {
        let uri = if rest.starts_with("//") {
            format!("ms-resource:{rest}")
        } else if let Some(path) = rest.strip_prefix('/') {
            format!("ms-resource://{name}/{path}")
        } else if rest.contains('/') {
            format!("ms-resource://{name}/{rest}")
        } else {
            format!("ms-resource://{name}/Resources/{rest}")
        };
        format!("@{{{full_name}?{uri}}}")
    } else {
        return Some(value.to_string());
    };
    indirect_string(&source).filter(|s| !s.trim().is_empty() && !s.starts_with("ms-resource:") && !s.starts_with("@{"))
}

/// Přeloží odkaz na text z prostředků balíčku (SHLoadIndirectString).
#[cfg(windows)]
fn indirect_string(source: &str) -> Option<String> {
    use windows_sys::Win32::UI::Shell::SHLoadIndirectString;
    let wide: Vec<u16> = source.encode_utf16().chain(std::iter::once(0)).collect();
    let mut buffer = [0u16; 512];
    // SAFETY: zdroj je řetězec ukončený nulou, výstup je buffer se zadanou délkou
    let result = unsafe { SHLoadIndirectString(wide.as_ptr(), buffer.as_mut_ptr(), buffer.len() as u32, std::ptr::null()) };
    if result != 0 {
        return None;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(not(windows))]
fn indirect_string(_source: &str) -> Option<String> {
    None
}

/// Spouštěcí úlohy aplikací ze Storu aktuálního uživatele: stav z registru
/// (SystemAppData), název, vydavatel a program z manifestu nejnovějšího
/// nainstalovaného balíčku. Jen úlohy z aktuálního manifestu – v registru
/// zůstávají i úlohy starších verzí aplikace.
fn package_entries() -> Vec<Entry> {
    let repository = format!(r"{APPMODEL}\Repository\Packages");
    let states = format!(r"{APPMODEL}\SystemAppData");
    // Rodiny s aspoň jednou úlohou se stavem – manifesty ostatních balíčků se nečtou
    let families: HashSet<String> = registry::subkeys(false, &states)
        .into_iter()
        .filter(|family| {
            let key = format!(r"{states}\{family}");
            registry::subkeys(false, &key).iter().any(|sub| registry::dword_value(false, &format!(r"{key}\{sub}"), "State").is_some())
        })
        .collect();
    // Rodina → (plný název, složka programů, manifest). Balíček s externím umístěním (Copilot)
    // má programy jinde než manifest – ten je pak ve WindowsApps pod plným názvem.
    let windows_apps = std::env::var_os("ProgramW6432").or_else(|| std::env::var_os("ProgramFiles")).map(|dir| PathBuf::from(dir).join("WindowsApps"));
    let mut packages: HashMap<String, (String, PathBuf, PathBuf)> = HashMap::new();
    for full in registry::subkeys(false, &repository) {
        let Some(family) = package_family(&full).filter(|f| families.contains(f)) else { continue };
        let Some(root) = registry::string_value(false, &format!(r"{repository}\{full}"), "PackageRootFolder") else { continue };
        let root = PathBuf::from(root);
        let Some(manifest) = [Some(root.join("AppxManifest.xml")), windows_apps.as_ref().map(|dir| dir.join(&full).join("AppxManifest.xml"))]
            .into_iter()
            .flatten()
            .find(|path| path.is_file())
        else {
            continue;
        };
        // map_or místo is_none_or – MSRV 1.80 (is_none_or je až od 1.82)
        if packages.get(&family).map_or(true, |(current, _, _)| package_version(&full) > package_version(current)) {
            packages.insert(family, (full, root, manifest));
        }
    }

    let mut entries = Vec::new();
    for (family, (full, root, manifest)) in packages {
        let Ok(manifest) = std::fs::read_to_string(manifest) else { continue };
        let package_name = registry::string_value(false, &format!(r"{repository}\{full}"), "DisplayName").and_then(|n| package_string(&full, &n));
        let publisher = element(&manifest, "PublisherDisplayName").and_then(|p| package_string(&full, &p));
        for task in manifest_startup_tasks(&manifest) {
            let location = Location::Package { family: family.clone(), task: task.id.clone() };
            // Id, které by neprošlo kontrolou (neobvyklé znaky), by nešlo měnit – vynechat
            if Location::parse(&location.id()).as_ref() != Some(&location) {
                continue;
            }
            let Some(key) = location.package_state_key() else { continue };
            let enabled = registry::dword_value(false, &key, "State").map_or(task.enabled, package_enabled);
            let name = task
                .display_name
                .as_deref()
                .and_then(|n| package_string(&full, n))
                .or_else(|| package_name.clone())
                .unwrap_or_else(|| family.split('_').next().unwrap_or_default().to_string());
            let target = task.executable.as_ref().map(|exe| (root.join(exe.replace('/', "\\")), String::new()));
            let command = match (&task.app_id, &target) {
                (Some(app), _) => format!(r"shell:AppsFolder\{family}!{app}"),
                (None, Some((path, _))) => format!("\"{}\"", path.to_string_lossy()),
                (None, None) => String::new(),
            };
            entries.push(Entry {
                name: name.clone(),
                command,
                target,
                location_text: format!(r"{family}\{}", task.id),
                enabled,
                admin: false,
                location,
                author: publisher.clone(),
                description: Some(name),
            });
        }
    }
    entries
}

// ── Zapnutí, vypnutí, smazání ────────────────────────────────────────────

/// Proč změna nevyšla.
enum Failure {
    /// Bez práv správce to nejde.
    Admin,
    Other(String),
}

/// Zapne nebo vypne položku (bez povýšení).
fn toggle(location: &Location, enabled: bool) -> Result<(), Failure> {
    match location {
        Location::Task { path } => {
            if schtasks(&["/Change", "/TN", path, if enabled { "/ENABLE" } else { "/DISABLE" }]) {
                Ok(())
            } else {
                Err(Failure::Admin)
            }
        }
        // Aplikace ze Storu: stav v HKCU jako ve Správci úloh (1 = vypnul uživatel – aplikace
        // si úlohu sama znovu zapnout nemůže), práva správce nejsou potřeba
        Location::Package { .. } => {
            let key = location.package_state_key().ok_or(Failure::Other("neplatná položka".into()))?;
            match registry::dword_value(false, &key, "State") {
                None => Err(Failure::Other("položka už neexistuje".into())),
                Some(3 | 4) => Err(Failure::Other("Spouštění této aplikace určuje zásada organizace – v HubGetu ho změnit nejde.".into())),
                Some(_) => registry::set_dword(false, &key, "State", if enabled { 2 } else { 1 }).map_err(|e| Failure::Other(e.to_string())),
            }
        }
        _ => {
            let (machine, key, value) = location.approved().ok_or(Failure::Other("neplatná položka".into()))?;
            if !exists(location) {
                return Err(Failure::Other("položka už neexistuje".into()));
            }
            registry::set_binary(machine, &key, value, &approved_bytes(enabled)).map_err(|e| {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    Failure::Admin
                } else {
                    Failure::Other(e.to_string())
                }
            })
        }
    }
}

/// Smaže položku (bez povýšení). Zálohu dělá volající předem.
fn remove(location: &Location) -> Result<(), Failure> {
    let denied = |e: std::io::Error| if e.kind() == std::io::ErrorKind::PermissionDenied { Failure::Admin } else { Failure::Other(e.to_string()) };
    match location {
        Location::Run { machine, wow, value } => {
            registry::delete_value(*machine, if *wow { RUN_WOW } else { RUN }, value).map_err(denied)?;
        }
        Location::Folder { common, file } => {
            let dir = startup_dir(*common).ok_or(Failure::Other("složka Po spuštění chybí".into()))?;
            let path = dir.join(file);
            crate::leftovers::to_recycle_bin(&path).map_err(|e| if *common { Failure::Admin } else { Failure::Other(e) })?;
            if path.exists() {
                return Err(if *common { Failure::Admin } else { Failure::Other("soubor se nepodařilo smazat".into()) });
            }
        }
        Location::Task { path } => {
            if !schtasks(&["/Delete", "/TN", path, "/F"]) {
                return Err(Failure::Admin);
            }
        }
        Location::Package { .. } => {
            return Err(Failure::Other(
                "Spouštění aplikace ze Storu je součástí jejího balíčku – odstranit ho jde jen odinstalací aplikace. Vypnutá úloha se sama znovu nezapne.".into(),
            ));
        }
    }
    // Stav zapnutí po smazané položce nepotřebujeme
    if let Some((machine, key, value)) = location.approved() {
        let _ = registry::delete_value(machine, &key, value);
    }
    Ok(())
}

/// Existuje položka ještě?
fn exists(location: &Location) -> bool {
    match location {
        Location::Run { machine, wow, value } => registry::has_value(*machine, if *wow { RUN_WOW } else { RUN }, value),
        Location::Folder { common, file } => startup_dir(*common).is_some_and(|dir| dir.join(file).is_file()),
        Location::Task { path } => schtasks(&["/Query", "/TN", path]),
        Location::Package { .. } => location.package_state_key().is_some_and(|key| registry::dword_value(false, &key, "State").is_some()),
    }
}

/// Zapne nebo vypne položku; co vyžaduje správce, změní s `elevate` povýšený pomocník.
#[tauri::command]
pub async fn startup_set_enabled(id: String, enabled: bool, elevate: bool) -> Result<Outcome, String> {
    let location = Location::parse(&id).ok_or("neplatná položka")?;
    background(move || match toggle(&location, enabled) {
        Ok(()) => Ok(Outcome { done: true, ..Default::default() }),
        Err(Failure::Other(message)) => Err(message),
        Err(Failure::Admin) => elevated(&Request::Toggle { id, enabled }, elevate, None),
    })
    .await
}

/// Smaže položku po spuštění: hodnotu registru po záloze, zástupce do Koše, úlohu po uložení do XML.
#[tauri::command]
pub async fn startup_delete(app: AppHandle, id: String, elevate: bool) -> Result<Outcome, String> {
    let location = Location::parse(&id).ok_or("neplatná položka")?;
    let backup_root = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("startup-backup");
    background(move || {
        let backup = backup(&backup_root, &location)?;
        match remove(&location) {
            Ok(()) => Ok(Outcome { done: true, backup, ..Default::default() }),
            Err(Failure::Other(message)) => Err(message),
            Err(Failure::Admin) => elevated(&Request::Delete { id }, elevate, backup),
        }
    })
    .await
}

/// Záloha před smazáním (zástupce jde do Koše, ten zálohu nepotřebuje).
fn backup(root: &Path, location: &Location) -> Result<Option<String>, String> {
    let name = match location {
        Location::Run { value, .. } => value.clone(),
        Location::Task { path } => path.rsplit('\\').next().unwrap_or("task").to_string(),
        // Zástupce jde do Koše; úlohu aplikace ze Storu smazat nejde (remove to odmítne)
        Location::Folder { .. } | Location::Package { .. } => return Ok(None),
    };
    let dir = root.join(format!("{} {}", crate::leftovers::utc_stamp(), crate::leftovers::safe_file_name(&name)));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ok = match location {
        Location::Run { machine, wow, .. } => {
            let key = format!(r"{}\{}", if *machine { "HKLM" } else { "HKCU" }, if *wow { RUN_WOW } else { RUN });
            let file = dir.join("Run.reg");
            let mut command = hidden_command(&system_tool("reg.exe").to_string_lossy());
            command.args(["export", &key]).arg(&file).arg("/y");
            crate::process::run(command, Duration::from_secs(30)).is_ok_and(|out| out.code == 0) && file.exists()
        }
        Location::Task { path } => {
            let mut command = hidden_command(&system_tool("schtasks.exe").to_string_lossy());
            command.args(["/Query", "/TN", path, "/XML", "ONE"]);
            match crate::process::run(command, Duration::from_secs(30)) {
                Ok(out) if out.code == 0 && out.stdout.contains("<Task") => std::fs::write(dir.join("task.xml"), out.stdout.as_bytes()).is_ok(),
                _ => false,
            }
        }
        Location::Folder { .. } | Location::Package { .. } => true,
    };
    if !ok {
        let _ = std::fs::remove_dir_all(&dir);
        return Err("Zálohu se nepodařilo vytvořit – položka zůstala beze změny".into());
    }
    Ok(Some(dir.to_string_lossy().into_owned()))
}

// ── Povýšený pomocník ────────────────────────────────────────────────────

/// Zadání pro povýšeného pomocníka (v příkazové řádce, ověří si ho znovu).
#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    Toggle { id: String, enabled: bool },
    Delete { id: String },
    /// Přečíst měření WDI uživatele `sid` do souboru `out` (připravil ho běžný proces).
    Measure { sid: String, out: PathBuf },
}

/// Provede změnu povýšeným pomocníkem (jedno potvrzení UAC).
fn elevated(request: &Request, elevate: bool, backup: Option<String>) -> Result<Outcome, String> {
    if !elevate {
        return Ok(Outcome { needs_admin: true, backup, ..Default::default() });
    }
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(request).map_err(|e| e.to_string())?);
    match crate::elevation::run_self_elevated(ELEVATED_STARTUP_FLAG, &payload)? {
        None => Ok(Outcome { needs_admin: true, backup, ..Default::default() }),
        Some(0) => Ok(Outcome { done: true, backup, ..Default::default() }),
        Some(_) => Err("Změnu se nepodařilo provést ani s právy správce".into()),
    }
}

/// Vstupní bod povýšeného pomocníka (`unibox.exe --unibox-elevated-startup …`).
/// 0 = hotovo, 1 = nepodařilo se, -1 = neplatné zadání.
pub fn elevated_startup_main(payload: &str) -> i32 {
    let Some(request) = URL_SAFE_NO_PAD.decode(payload).ok().and_then(|bytes| serde_json::from_slice::<Request>(&bytes).ok()) else {
        return -1;
    };
    let done = match request {
        Request::Toggle { id, enabled } => Location::parse(&id).is_some_and(|location| toggle(&location, enabled).is_ok()),
        Request::Delete { id } => Location::parse(&id).is_some_and(|location| exists(&location) && remove(&location).is_ok()),
        Request::Measure { sid, out } => measure_to_file(&sid, &out).is_ok(),
    };
    if done {
        0
    } else {
        1
    }
}

// ── Vliv na spuštění (WDI StartupInfo) ───────────────────────────────────

/// Jeden proces z měření Windows (prvních 90 s po přihlášení).
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
struct Usage {
    name: String,
    pid: u32,
    parent: u32,
    command: String,
    cpu_us: u64,
    disk_bytes: u64,
}

#[derive(Serialize, Deserialize, Debug, Default)]
struct Measurement {
    /// Čas souboru s měřením (sekundy od 1970).
    measured_at: u64,
    processes: Vec<Usage>,
}

fn impact_cache(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join("startup-impact.json"))
}

fn load_measurement(path: &Path) -> Option<Measurement> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Změří vliv: přečte poslední měření Windows (s `elevate` přes povýšeného
/// pomocníka – soubory smí číst jen správce) a uloží ho. Vrátí true, když se
/// měření načetlo; false = dialog UAC odmítnut nebo povýšení není povolené.
#[tauri::command]
pub async fn startup_measure_impact(app: AppHandle, elevate: bool) -> Result<bool, String> {
    let cache = impact_cache(&app).ok_or("úložiště aplikace není dostupné")?;
    background(move || {
        let sid = current_user_sid().ok_or("účet uživatele nejde zjistit")?;
        // Běží-li HubGet jako správce, přečte měření sám
        let measurement = match read_measurement(&sid) {
            Ok(measurement) => measurement,
            Err(_) if !elevate => return Ok(false),
            Err(_) => {
                let dir = std::env::temp_dir().join("HubGet");
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
                let out = dir.join(format!("startup-impact-{stamp}.json"));
                std::fs::write(&out, b"").map_err(|e| e.to_string())?;
                let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Request::Measure { sid, out: out.clone() }).map_err(|e| e.to_string())?);
                let code = crate::elevation::run_self_elevated(ELEVATED_STARTUP_FLAG, &payload);
                let text = std::fs::read(&out).unwrap_or_default();
                let _ = std::fs::remove_file(&out);
                match code? {
                    None => return Ok(false),
                    Some(0) => serde_json::from_slice::<Measurement>(&text).map_err(|e| e.to_string())?,
                    Some(_) => return Err("Měření Windows se nepodařilo přečíst – zatím žádné není (Windows měří při přihlášení).".into()),
                }
            }
        };
        if let Some(parent) = cache.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&cache, serde_json::to_vec(&measurement).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
}

fn wdi_dir() -> PathBuf {
    system_tool(r"WDI\LogFiles\StartupInfo")
}

/// Nejnovější měření uživatele `sid` (`<SID>_StartupInfo<N>.xml`).
fn read_measurement(sid: &str) -> Result<Measurement, String> {
    let prefix = format!("{}_startupinfo", sid.to_lowercase());
    let newest = std::fs::read_dir(wdi_dir())
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|f| {
            let name = f.file_name().to_string_lossy().to_lowercase();
            name.starts_with(&prefix) && name.ends_with(".xml")
        })
        .filter_map(|f| Some((f.metadata().ok()?.modified().ok()?, f.path())))
        .max_by_key(|(modified, _)| *modified)
        .ok_or("měření zatím není")?;
    let bytes = std::fs::read(&newest.1).map_err(|e| e.to_string())?;
    Ok(Measurement {
        measured_at: newest.0.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        processes: parse_startup_info(&decode_text(&bytes)),
    })
}

/// Pomocník: měření do připraveného souboru (jen existující soubor v dočasné složce HubGetu).
fn measure_to_file(sid: &str, out: &Path) -> Result<(), String> {
    use std::io::Write;
    let valid_sid = sid.starts_with("S-1-") && sid.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'S');
    let inside = out.parent() == Some(std::env::temp_dir().join("HubGet").as_path())
        && out.file_name().is_some_and(|n| n.to_string_lossy().starts_with("startup-impact-"));
    if !valid_sid || !inside {
        return Err("neplatné zadání".into());
    }
    let measurement = read_measurement(sid)?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).truncate(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Nenásledovat odkazy (reparse point) – zapsat jen do souboru, který připravila aplikace
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options.open(out).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(&measurement).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Text souboru WDI: UTF-16 LE (s BOM i bez), jinak UTF-8.
fn decode_text(bytes: &[u8]) -> String {
    let utf16 = bytes.starts_with(&[0xFF, 0xFE]) || (bytes.len() > 1 && bytes[1] == 0);
    if utf16 {
        let body = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
        let units: Vec<u16> = body.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').to_string()
    }
}

/// Procesy z XML StartupInfo: `<Process Name="…" PID="…">` s prvky
/// `ParentPID`, `CommandLine`, `DiskUsage` (bajty) a `CpuUsage` (µs).
fn parse_startup_info(xml: &str) -> Vec<Usage> {
    let mut processes = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<Process ") {
        let after = &rest[start..];
        let Some(head_end) = after.find('>') else { break };
        let head = &after[..head_end];
        let (body, next) = match after.find("</Process>") {
            Some(end) if !head.ends_with('/') => (&after[head_end + 1..end], &after[end + 10..]),
            _ => ("", &after[head_end + 1..]),
        };
        let number = |text: Option<String>| text.and_then(|t| t.trim().parse::<u64>().ok()).unwrap_or(0);
        processes.push(Usage {
            name: attribute(head, "Name").unwrap_or_default(),
            pid: number(attribute(head, "PID")) as u32,
            parent: number(element(body, "ParentPID")) as u32,
            command: element(body, "CommandLine").unwrap_or_default(),
            cpu_us: number(element(body, "CpuUsage")),
            disk_bytes: number(element(body, "DiskUsage")),
        });
        rest = next;
    }
    processes
}

fn attribute(head: &str, name: &str) -> Option<String> {
    let start = head.find(&format!(" {name}=\""))? + name.len() + 3;
    let end = head[start..].find('"')?;
    Some(unescape(&head[start..start + end]))
}

fn element(body: &str, name: &str) -> Option<String> {
    let open = body.find(&format!("<{name}"))?;
    let content_start = open + body[open..].find('>')? + 1;
    let end = body[content_start..].find(&format!("</{name}>"))?;
    Some(unescape(&body[content_start..content_start + end]))
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// Spouštěče, podle jejichž názvu nejde poznat konkrétní položku – musí sedět i argumenty.
const LAUNCHERS: &[&str] = &[
    "rundll32.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "cscript.exe", "mshta.exe", "conhost.exe", "explorer.exe",
];

/// Procesor (µs) a disk (bajty) procesů položky a jejich potomků; None = při
/// posledním přihlášení se nespustila.
fn usage_for(target: &Path, args: &str, processes: &[Usage]) -> Option<(u64, u64)> {
    let file = target.file_name()?.to_string_lossy().to_lowercase();
    // Začátek argumentů (po znacích – řez po bajtech by mohl rozdělit znak)
    let args: String = args.trim().to_lowercase().chars().take(60).collect();
    let launcher = LAUNCHERS.contains(&file.as_str());
    let file_of = |name: &str| name.rsplit(['\\', '/']).next().unwrap_or(name).to_lowercase();
    let mut pids: HashSet<u32> = processes
        .iter()
        .filter(|p| file_of(&p.name) == file && (!launcher || (!args.is_empty() && p.command.to_lowercase().contains(&args))))
        .map(|p| p.pid)
        .collect();
    if pids.is_empty() {
        return None;
    }
    // Potomci (instalátor aktualizací, pomocné procesy) se počítají k položce
    loop {
        let before = pids.len();
        for p in processes {
            if pids.contains(&p.parent) && p.pid != 0 {
                pids.insert(p.pid);
            }
        }
        if pids.len() == before {
            break;
        }
    }
    let matched = processes.iter().filter(|p| pids.contains(&p.pid));
    Some(matched.fold((0, 0), |(cpu, disk), p| (cpu + p.cpu_us, disk + p.disk_bytes)))
}

/// Stupeň vlivu jako ve Správci úloh.
fn impact(cpu_us: u64, disk_bytes: u64) -> Impact {
    if cpu_us > 1_000_000 || disk_bytes > 3 * 1024 * 1024 {
        Impact::High
    } else if cpu_us > 300_000 || disk_bytes > 300 * 1024 {
        Impact::Medium
    } else {
        Impact::Low
    }
}

// ── Windows: SID uživatele, informace o programu, registr ────────────────

/// SID přihlášeného uživatele („S-1-5-21-…“) – podle něj se hledá jeho měření.
#[cfg(windows)]
fn current_user_sid() -> Option<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // SAFETY: handle tokenu se zavře; vyrovnávací paměť je zarovnaná (u64) a dost
    // velká podle prvního dotazu; řetězec SID se uvolní přes LocalFree.
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let mut size = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
        let mut buffer = vec![0u64; (size as usize).div_ceil(8).max(1)];
        let ok = GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), size, &mut size) != 0;
        CloseHandle(token);
        if !ok {
            return None;
        }
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text: *mut u16 = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 || text.is_null() {
            return None;
        }
        let len = (0..).take_while(|&i| *text.add(i) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
        LocalFree(text.cast());
        Some(sid)
    }
}

#[cfg(not(windows))]
fn current_user_sid() -> Option<String> {
    None
}

/// Popis a vydavatel programu z informací o verzi (FileDescription, CompanyName).
fn version_strings(path: &Path) -> (Option<String>, Option<String>) {
    let mut fields = crate::version_info::fields(path, &["FileDescription", "CompanyName"]).into_iter();
    (fields.next().flatten(), fields.next().flatten())
}

#[cfg(windows)]
mod registry {
    use std::io;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, KEY_WOW64_64KEY, REG_BINARY};
    use winreg::{RegKey, RegValue};

    fn root(machine: bool) -> RegKey {
        RegKey::predef(if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER })
    }

    /// Textové hodnoty klíče (REG_SZ, REG_EXPAND_SZ) – název a obsah.
    pub fn string_values(machine: bool, path: &str) -> Vec<(String, String)> {
        let Ok(key) = root(machine).open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY) else { return Vec::new() };
        key.enum_values()
            .flatten()
            .filter(|(name, _)| !name.is_empty())
            .filter_map(|(name, _)| key.get_value::<String, _>(&name).ok().map(|value| (name, value)))
            .collect()
    }

    pub fn has_value(machine: bool, path: &str, name: &str) -> bool {
        root(machine)
            .open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY)
            .is_ok_and(|key| key.get_raw_value(name).is_ok())
    }

    pub fn binary_value(machine: bool, path: &str, name: &str) -> Option<Vec<u8>> {
        let key = root(machine).open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY).ok()?;
        key.get_raw_value(name).ok().map(|value| value.bytes)
    }

    pub fn set_binary(machine: bool, path: &str, name: &str, bytes: &[u8]) -> io::Result<()> {
        let (key, _) = root(machine).create_subkey_with_flags(path, KEY_SET_VALUE | KEY_WOW64_64KEY)?;
        key.set_raw_value(name, &RegValue { bytes: bytes.to_vec(), vtype: REG_BINARY })
    }

    pub fn delete_value(machine: bool, path: &str, name: &str) -> io::Result<()> {
        root(machine).open_subkey_with_flags(path, KEY_SET_VALUE | KEY_WOW64_64KEY)?.delete_value(name)
    }

    /// Názvy podklíčů (klíč chybí = žádné).
    pub fn subkeys(machine: bool, path: &str) -> Vec<String> {
        let Ok(key) = root(machine).open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY) else { return Vec::new() };
        key.enum_keys().flatten().collect()
    }

    pub fn string_value(machine: bool, path: &str, name: &str) -> Option<String> {
        root(machine).open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY).ok()?.get_value::<String, _>(name).ok()
    }

    pub fn dword_value(machine: bool, path: &str, name: &str) -> Option<u32> {
        root(machine).open_subkey_with_flags(path, KEY_READ | KEY_WOW64_64KEY).ok()?.get_value::<u32, _>(name).ok()
    }

    /// Zapíše DWORD do existujícího klíče (klíč nevytváří).
    pub fn set_dword(machine: bool, path: &str, name: &str, value: u32) -> io::Result<()> {
        root(machine).open_subkey_with_flags(path, KEY_SET_VALUE | KEY_WOW64_64KEY)?.set_value(name, &value)
    }
}

#[cfg(not(windows))]
mod registry {
    use std::io;
    pub fn subkeys(_machine: bool, _path: &str) -> Vec<String> {
        Vec::new()
    }
    pub fn string_value(_machine: bool, _path: &str, _name: &str) -> Option<String> {
        None
    }
    pub fn dword_value(_machine: bool, _path: &str, _name: &str) -> Option<u32> {
        None
    }
    pub fn set_dword(_machine: bool, _path: &str, _name: &str, _value: u32) -> io::Result<()> {
        Err(io::Error::other("jen ve Windows"))
    }
    pub fn string_values(_machine: bool, _path: &str) -> Vec<(String, String)> {
        Vec::new()
    }
    pub fn has_value(_machine: bool, _path: &str, _name: &str) -> bool {
        false
    }
    pub fn binary_value(_machine: bool, _path: &str, _name: &str) -> Option<Vec<u8>> {
        None
    }
    pub fn set_binary(_machine: bool, _path: &str, _name: &str, _bytes: &[u8]) -> io::Result<()> {
        Err(io::Error::other("jen ve Windows"))
    }
    pub fn delete_value(_machine: bool, _path: &str, _name: &str) -> io::Result<()> {
        Err(io::Error::other("jen ve Windows"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_ids_round_trip() {
        for location in [
            Location::Run { machine: false, wow: false, value: "Discord".into() },
            Location::Run { machine: true, wow: true, value: "Steam|Client".into() },
            Location::Folder { common: true, file: "OneNote.lnk".into() },
            Location::Task { path: r"\Vendor\Updater Logon".into() },
            Location::Package { family: "5319275A.WhatsAppDesktop_cv1g1gvanyjgm".into(), task: "2defd21c-0b9e-4e4e-873a-2a68c47d7da5".into() },
            Location::Package { family: "Microsoft.WindowsTerminal_8wekyb3d8bbwe".into(), task: "StartTerminalOnLoginTask".into() },
        ] {
            assert_eq!(Location::parse(&location.id()), Some(location));
        }
    }

    #[test]
    fn package_ids_stay_inside_systemappdata() {
        // Rodina i TaskId jdou do cesty v registru – žádné „\“, „..“ jako cesta, mezery ani prázdné části
        assert_eq!(Location::parse(r"app|Vendor.App_abc|..\..\Run"), None);
        assert_eq!(Location::parse(r"app|Vendor.App_abc\x|Task"), None);
        assert_eq!(Location::parse("app|NoPublisherId|Task"), None);
        assert_eq!(Location::parse("app|Vendor.App_abc|"), None);
        assert_eq!(Location::parse("app|Vendor.App_abc|Task Id"), None);
        assert_eq!(
            Location::parse("app|Vendor.App_abc|Task").and_then(|l| l.package_state_key()),
            Some(format!(r"{APPMODEL}\SystemAppData\Vendor.App_abc\Task"))
        );
    }

    #[test]
    fn startup_tasks_from_manifest() {
        // Zkrácený manifest WhatsAppu (uap5) a Windows Terminálu (bez Executable u rozšíření)
        let whatsapp = r#"<Applications><Application Id="App" Executable="WhatsApp.Root.exe" EntryPoint="Windows.FullTrustApplication"><Extensions>
            <uap5:Extension Category="windows.startupTask" Executable="WhatsApp.Root.exe" EntryPoint="Windows.FullTrustApplication">
            <uap5:StartupTask TaskId="2defd21c-0b9e-4e4e-873a-2a68c47d7da5" Enabled="true" DisplayName="WhatsApp" /></uap5:Extension>
            </Extensions></Application></Applications>"#;
        assert_eq!(
            manifest_startup_tasks(whatsapp),
            [ManifestTask {
                id: "2defd21c-0b9e-4e4e-873a-2a68c47d7da5".into(),
                enabled: true,
                display_name: Some("WhatsApp".into()),
                executable: Some("WhatsApp.Root.exe".into()),
                app_id: Some("App".into()),
            }]
        );
        let terminal = r#"<Application Id="App" Executable="WindowsTerminal.exe"><Extensions>
            <uap5:Extension Category="windows.startupTask"><uap5:StartupTask TaskId="StartTerminalOnLoginTask" Enabled="false" DisplayName="ms-resource:AppName" /></uap5:Extension>
            </Extensions></Application>"#;
        let tasks = manifest_startup_tasks(terminal);
        assert_eq!(tasks.len(), 1);
        assert!(!tasks[0].enabled);
        assert_eq!(tasks[0].executable.as_deref(), Some("WindowsTerminal.exe"));
        assert_eq!(tasks[0].display_name.as_deref(), Some("ms-resource:AppName"));
        assert!(manifest_startup_tasks("<Package><Applications /></Package>").is_empty());
    }

    #[test]
    fn package_names() {
        assert_eq!(package_family("5319275A.WhatsAppDesktop_2.2641.101.0_x64__cv1g1gvanyjgm").as_deref(), Some("5319275A.WhatsAppDesktop_cv1g1gvanyjgm"));
        // Balíček zdrojů (jazyk / měřítko) spouštěcí úlohy nemá
        assert_eq!(package_family("Microsoft.WindowsTerminal_1.21.0.0_neutral_split.scale-200_8wekyb3d8bbwe"), None);
        assert!(package_version("A_1.10.0.0_x64__p") > package_version("A_1.9.5.0_x64__p"));
        assert!(package_enabled(2) && package_enabled(4));
        assert!(!package_enabled(0) && !package_enabled(1) && !package_enabled(3));
        // Text bez odkazu na prostředky zůstane, jak je
        assert_eq!(package_string("A_1.0.0.0_x64__p", " WhatsApp ").as_deref(), Some("WhatsApp"));
    }

    #[test]
    fn rejects_paths_outside_allowed_places() {
        assert_eq!(Location::parse(r"folder|user|..\..\Windows\notepad.exe"), None);
        assert_eq!(Location::parse("folder|user|C:/x.lnk"), None);
        assert_eq!(Location::parse("folder|other|a.lnk"), None);
        assert_eq!(Location::parse(r"task|\Microsoft\Windows\Defrag\ScheduledDefrag"), None);
        assert_eq!(Location::parse(r"task|Vendor\NoLeadingSlash"), None);
        assert_eq!(Location::parse(r"task|\Vendor\..\Microsoft\X"), None);
        assert_eq!(Location::parse("reg|HKCU|Run32|x"), None, "HKCU nemá 32bitový pohled");
        assert_eq!(Location::parse("reg|HKCR|Run|x"), None);
        assert_eq!(Location::parse("reg|HKCU|Run|"), None);
    }

    #[test]
    fn startup_approved_flags() {
        assert!(is_enabled_flag(&[2, 0, 0, 0]));
        assert!(is_enabled_flag(&[6, 0, 0, 0]));
        assert!(!is_enabled_flag(&[3, 0, 0, 0, 1, 2]));
        assert!(!is_enabled_flag(&[7]));
        assert!(is_enabled_flag(&[]));
        let off = approved_bytes(false);
        assert_eq!((off.len(), off[0]), (12, 3));
        assert!(u64::from_le_bytes(off[4..].try_into().unwrap()) > 116_444_736_000_000_000);
        assert_eq!(approved_bytes(true), vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn command_line_targets() {
        let dir = std::env::temp_dir().join(format!("unibox-startup-{}", std::process::id()));
        let spaced = dir.join("My App");
        std::fs::create_dir_all(&spaced).unwrap();
        let exe = spaced.join("app.exe");
        std::fs::write(&exe, b"MZ").unwrap();

        let quoted = format!("\"{}\" --tray", exe.display());
        assert_eq!(command_target(&quoted), Some((exe.clone(), "--tray".into())));
        // Bez uvozovek a s mezerou v cestě
        let unquoted = format!("{} /background", exe.display());
        assert_eq!(command_target(&unquoted), Some((exe.clone(), "/background".into())));
        // Program bez cesty je ze System32
        let (rundll, args) = command_target("rundll32.exe shell32.dll,Control_RunDLL").unwrap();
        assert!(rundll.is_absolute() && rundll.ends_with("rundll32.exe"));
        assert_eq!(args, "shell32.dll,Control_RunDLL");
        assert_eq!(command_target("   "), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-16"?>
<StartupData Version="2" StartTime="2026/10/26:07:12:01.1234567">
  <Process Name="C:\Users\u\AppData\Local\Discord\app-1.0\Discord.exe" PID="4100" StartedInTraceSec="12.5">
    <StartTime>2026/10/26:07:12:13.6000000</StartTime>
    <CommandLine>"C:\Users\u\AppData\Local\Discord\Update.exe" --processStart Discord.exe</CommandLine>
    <DiskUsage Units="bytes">2097152</DiskUsage>
    <CpuUsage Units="us">900000</CpuUsage>
    <ParentPID>3800</ParentPID>
    <ParentName>Update.exe</ParentName>
  </Process>
  <Process Name="Discord.exe" PID="4200" StartedInTraceSec="13.1">
    <CommandLine>Discord.exe --type=renderer</CommandLine>
    <DiskUsage Units="bytes">1048576</DiskUsage>
    <CpuUsage Units="us">200000</CpuUsage>
    <ParentPID>4100</ParentPID>
  </Process>
  <Process Name="rundll32.exe" PID="5000">
    <CommandLine>rundll32.exe C:\Tools\tray.dll,Start</CommandLine>
    <DiskUsage Units="bytes">1000</DiskUsage>
    <CpuUsage Units="us">1000</CpuUsage>
    <ParentPID>3000</ParentPID>
  </Process>
  <Process Name="Small &amp; Quiet.exe" PID="6000">
    <DiskUsage Units="bytes">10</DiskUsage>
    <CpuUsage Units="us">10</CpuUsage>
    <ParentPID>3000</ParentPID>
  </Process>
</StartupData>"#;

    #[test]
    fn parses_startup_info_xml() {
        // Windows soubory ukládá v UTF-16 LE s BOM
        let bytes: Vec<u8> = [0xFF, 0xFE].into_iter().chain(SAMPLE.encode_utf16().flat_map(u16::to_le_bytes)).collect();
        let processes = parse_startup_info(&decode_text(&bytes));
        assert_eq!(processes.len(), 4);
        assert_eq!(processes[0].pid, 4100);
        assert_eq!(processes[0].parent, 3800);
        assert_eq!(processes[0].cpu_us, 900_000);
        assert_eq!(processes[0].disk_bytes, 2_097_152);
        assert!(processes[0].command.contains("--processStart"));
        assert_eq!(processes[3].name, "Small & Quiet.exe");
    }

    #[test]
    fn usage_includes_children_and_needs_arguments_for_launchers() {
        let processes = parse_startup_info(SAMPLE);
        // Discord + jeho renderer (potomek): 1,1 s procesoru, 3 MB z disku
        let discord = usage_for(Path::new(r"C:\Users\u\AppData\Local\Discord\app-1.0\Discord.exe"), "", &processes);
        assert_eq!(discord, Some((1_100_000, 3_145_728)));
        assert_eq!(impact(discord.unwrap().0, discord.unwrap().1), Impact::High);
        // rundll32 jen se stejnými argumenty
        assert!(usage_for(Path::new(r"C:\Windows\System32\rundll32.exe"), r"C:\Tools\tray.dll,Start", &processes).is_some());
        assert_eq!(usage_for(Path::new(r"C:\Windows\System32\rundll32.exe"), r"C:\Other\x.dll,Run", &processes), None);
        assert_eq!(usage_for(Path::new(r"C:\Windows\System32\rundll32.exe"), "", &processes), None);
        // Nespuštěná položka
        assert_eq!(usage_for(Path::new(r"C:\X\notrunning.exe"), "", &processes), None);
    }

    #[test]
    fn impact_thresholds_match_task_manager() {
        assert_eq!(impact(1_000_001, 0), Impact::High);
        assert_eq!(impact(0, 3 * 1024 * 1024 + 1), Impact::High);
        assert_eq!(impact(300_001, 0), Impact::Medium);
        assert_eq!(impact(0, 300 * 1024 + 1), Impact::Medium);
        assert_eq!(impact(300_000, 300 * 1024), Impact::Low);
    }
}
