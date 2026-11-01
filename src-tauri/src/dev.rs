//! Správci balíčků pro vývojáře: npm, Bun, pip, Cargo, vcpkg, .NET Tool,
//! PowerShell 7 (PSResourceGet) a Windows PowerShell 5.1 (PowerShellGet).
//!
//! - Nástroje se hledají v PATH z registru (nově nainstalovaný Node.js nebo
//!   Python je vidět bez restartu HubGetu – PATH procesu se doplní) a v obvyklých
//!   složkách (`%USERPROFILE%\.cargo\bin`, `Program Files\nodejs`…).
//! - Nainstalované balíčky vypíše nástroj sám (npm ls, pip list, cargo install
//!   --list, vcpkg list, dotnet tool list, Get-InstalledPSResource /
//!   Get-InstalledModule); novější verze prozradí registr (npm outdated, pip
//!   --outdated, crates.io, NuGet, PowerShell Gallery).
//! - Hledání: veřejná API registrů přes curl.exe (npm, crates.io, NuGet,
//!   PowerShell Gallery), u PyPI přesná shoda názvu (vyhledávací API nemá),
//!   u vcpkg `vcpkg search`.
//! - Operace: příkazy nástrojů bez shellu (každý argument zvlášť), PowerShell
//!   skriptem. Id balíčků a verze se ověřují – do příkazů jdou jen povolené znaky.
//! - Chybějící nástroj nainstaluje winget (Node.js, Bun, Python, Rustup, .NET SDK, PowerShell 7).

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::arp::expand;
use crate::operations::{self, InstallOptions, Kind, OpEvent, OperationRequest, OperationResult, Spec, Verdict};
use crate::powershell::{powershell_exe, ps_string};
use crate::process::{background, hidden_command, system_tool, Captured};

/// Správce pro vývojáře (stejné id jako SourceId ve frontendu).
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Dev {
    Npm,
    Bun,
    Pip,
    Cargo,
    Vcpkg,
    Dotnet,
    Pwsh,
    Powershell,
}

impl Dev {
    fn label(self) -> &'static str {
        match self {
            Dev::Npm => "npm",
            Dev::Bun => "Bun",
            Dev::Pip => "pip",
            Dev::Cargo => "Cargo",
            Dev::Vcpkg => "vcpkg",
            Dev::Dotnet => ".NET Tool",
            Dev::Pwsh => "PowerShell 7",
            Dev::Powershell => "Windows PowerShell",
        }
    }
}

const USER_AGENT: &str = "HubGet (https://github.com/unibox-app/unibox)";
const LIST_TIMEOUT: Duration = Duration::from_secs(60);

// ── Nalezení nástrojů ────────────────────────────────────────────────────

/// Složky z PATH: procesu a z registru (uživatel, systém). Nové složky z registru
/// se doplní i do PATH HubGetu – nástroje spuštěné z něj (npm skripty, rustc,
/// link.exe…) pak najdou své závislosti bez restartu.
fn refresh_path() -> Vec<PathBuf> {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&current).collect();
    let mut added = false;
    for dir in registry_path() {
        if !dirs.iter().any(|d| d.as_os_str().eq_ignore_ascii_case(dir.as_os_str())) {
            dirs.push(dir);
            added = true;
        }
    }
    if added {
        if let Ok(joined) = std::env::join_paths(&dirs) {
            std::env::set_var("PATH", joined);
        }
    }
    dirs
}

#[cfg(windows)]
fn registry_path() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let read = |root, key: &str| {
        RegKey::predef(root).open_subkey(key).ok().and_then(|k| k.get_value::<String, _>("Path").ok()).unwrap_or_default()
    };
    let system = read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
    let user = read(HKEY_CURRENT_USER, "Environment");
    format!("{system};{user}")
        .split(';')
        .map(|part| expand(part.trim()))
        .filter(|part| !part.is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(not(windows))]
fn registry_path() -> Vec<PathBuf> {
    Vec::new()
}

/// Proměnná prostředí – z procesu, jinak z registru uživatele (nastavená po spuštění HubGetu).
fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok().or_else(|| user_env(name))
}

#[cfg(windows)]
fn user_env(name: &str) -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment").ok()?.get_value::<String, _>(name).ok().map(|v| expand(&v))
}

#[cfg(not(windows))]
fn user_env(_name: &str) -> Option<String> {
    None
}

fn find(dirs: &[PathBuf], file: &str) -> Option<PathBuf> {
    dirs.iter().map(|dir| dir.join(file)).find(|path| path.is_file())
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default()
}

fn program_files() -> PathBuf {
    std::env::var_os("ProgramW6432").or_else(|| std::env::var_os("ProgramFiles")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Program Files"))
}

/// Spustitelný nástroj: program a pevné úvodní argumenty (node + npm-cli.js, py -3 -m pip…).
#[derive(Clone, Debug)]
struct Tool {
    program: PathBuf,
    prefix: Vec<String>,
}

impl Tool {
    fn new(program: PathBuf) -> Self {
        Tool { program, prefix: Vec::new() }
    }

    fn command(&self, args: &[String]) -> std::process::Command {
        let mut command = hidden_command(&self.program.to_string_lossy());
        command.args(&self.prefix).args(args);
        // Výpisy .NET v angličtině (čte je HubGet), bez uvítání při prvním spuštění
        command.env("DOTNET_CLI_UI_LANGUAGE", "en").env("DOTNET_NOLOGO", "1").env("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1");
        command
    }

    fn run(&self, args: &[&str], timeout: Duration) -> Result<Captured, String> {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        crate::process::run(self.command(&args), timeout)
    }
}

/// Najde nástroj správce; None = není nainstalovaný.
fn tool(dev: Dev) -> Option<Tool> {
    let dirs = refresh_path();
    match dev {
        Dev::Npm => {
            let npm = find(&dirs, "npm.cmd").or_else(|| Some(program_files().join(r"nodejs\npm.cmd")).filter(|p| p.is_file()))?;
            let dir = npm.parent()?.to_path_buf();
            // npm.cmd jen spouští node s npm-cli.js – přímo bez cmd.exe (argumenty bez escapování)
            let cli = dir.join(r"node_modules\npm\bin\npm-cli.js");
            let node = Some(dir.join("node.exe")).filter(|p| p.is_file()).or_else(|| find(&dirs, "node.exe"));
            match node {
                Some(node) if cli.is_file() => Some(Tool { program: node, prefix: vec![cli.to_string_lossy().into_owned()] }),
                _ => Some(Tool::new(npm)),
            }
        }
        Dev::Bun => find(&dirs, "bun.exe")
            .or_else(|| Some(env_var("BUN_INSTALL").map(PathBuf::from).unwrap_or_else(|| home().join(".bun")).join(r"bin\bun.exe")))
            .filter(|p| p.is_file())
            .map(Tool::new),
        Dev::Pip => python(&dirs),
        Dev::Cargo => find(&dirs, "cargo.exe")
            .or_else(|| Some(env_var("CARGO_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".cargo")).join(r"bin\cargo.exe")))
            .filter(|p| p.is_file())
            .map(Tool::new),
        Dev::Vcpkg => env_var("VCPKG_ROOT")
            .map(|root| PathBuf::from(root).join("vcpkg.exe"))
            .filter(|p| p.is_file())
            .or_else(|| find(&dirs, "vcpkg.exe"))
            .map(Tool::new),
        Dev::Dotnet => find(&dirs, "dotnet.exe").or_else(|| Some(program_files().join(r"dotnet\dotnet.exe")).filter(|p| p.is_file())).map(Tool::new),
        Dev::Pwsh => find(&dirs, "pwsh.exe").or_else(|| Some(program_files().join(r"PowerShell\7\pwsh.exe")).filter(|p| p.is_file())).map(Tool::new),
        Dev::Powershell => Some(Tool::new(powershell_exe())).filter(|t| t.program.is_file()),
    }
}

/// Python s pipem: spouštěč py.exe, jinak python.exe, který opravdu běží (ne zástupce
/// z Microsoft Storu, který místo Pythonu otevře obchod).
fn python(dirs: &[PathBuf]) -> Option<Tool> {
    let pip = |program: PathBuf, prefix: &[&str]| Tool { program, prefix: prefix.iter().chain(["-m", "pip"].iter()).map(|s| s.to_string()).collect() };
    let works = |tool: &Tool| tool.run(&["--version"], Duration::from_secs(15)).is_ok_and(|out| out.code == 0 && out.stdout.starts_with("pip "));
    let mut candidates = Vec::new();
    if let Some(py) = find(dirs, "py.exe").or_else(|| Some(PathBuf::from(r"C:\Windows\py.exe")).filter(|p| p.is_file())) {
        candidates.push(pip(py, &["-3"]));
    }
    if let Some(python) = find(dirs, "python.exe") {
        candidates.push(pip(python, &[]));
    }
    // Instalace pro uživatele: %LOCALAPPDATA%\Programs\Python\Python3xx\python.exe (nejnovější)
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let mut found: Vec<PathBuf> = std::fs::read_dir(PathBuf::from(local).join(r"Programs\Python"))
            .map(|entries| entries.flatten().map(|e| e.path().join("python.exe")).filter(|p| p.is_file()).collect())
            .unwrap_or_default();
        found.sort();
        candidates.extend(found.into_iter().rev().map(|p| pip(p, &[])));
    }
    candidates.into_iter().find(works)
}

// ── Stav ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct Status {
    available: bool,
    version: Option<String>,
}

/// Verze nástroje; None = nástroj sice existuje, ale balíčky instalovat neumí (.NET bez SDK).
fn tool_version(dev: Dev, tool: &Tool) -> Option<String> {
    let first_line = |args: &[&str]| -> Option<String> {
        let out = tool.run(args, Duration::from_secs(20)).ok().filter(|o| o.code == 0)?;
        out.stdout.lines().map(str::trim).find(|l| !l.is_empty()).map(str::to_string)
    };
    match dev {
        Dev::Npm | Dev::Bun => first_line(&["--version"]),
        // „pip 24.0 from … (python 3.12)“, „cargo 1.82.0 (…)“, „PowerShell 7.4.6“
        Dev::Pip | Dev::Cargo | Dev::Pwsh => first_line(&["--version"]).and_then(|l| l.split_whitespace().nth(1).map(str::to_string)),
        // „vcpkg package management program version 2024-11-12-…“
        Dev::Vcpkg => first_line(&["version"]).and_then(|l| l.rsplit("version ").next().map(|v| v.trim().to_string())),
        // Nástroje .NET potřebují SDK – bez něj jen runtime a `dotnet tool` nefunguje
        Dev::Dotnet => {
            let out = tool.run(&["--list-sdks"], Duration::from_secs(20)).ok().filter(|o| o.code == 0)?;
            out.stdout.lines().filter_map(|l| l.split_whitespace().next()).next_back().map(str::to_string)
        }
        Dev::Powershell => Some(windows_powershell_version().unwrap_or_else(|| "5.1".into())),
    }
}

#[cfg(windows)]
fn windows_powershell_version() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\PowerShell\3\PowerShellEngine")
        .ok()?
        .get_value::<String, _>("PowerShellVersion")
        .ok()
}

#[cfg(not(windows))]
fn windows_powershell_version() -> Option<String> {
    None
}

#[tauri::command]
pub async fn dev_status(source: Dev) -> Result<Status, String> {
    background(move || {
        let version = tool(source).and_then(|tool| tool_version(source, &tool));
        Ok(Status { available: version.is_some(), version })
    })
    .await
}

// ── Ověření id a verzí ───────────────────────────────────────────────────

/// Id balíčku, které smí jít do příkazu: jen znaky názvů balíčků daného registru.
fn valid_id(dev: Dev, id: &str) -> bool {
    let simple = |s: &str, extra: &str| {
        !s.is_empty() && s.len() <= 214 && s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && s.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
    };
    match dev {
        // npm: „název“ nebo „@scope/název“
        Dev::Npm | Dev::Bun => match id.strip_prefix('@') {
            Some(scoped) => scoped.split_once('/').is_some_and(|(scope, name)| simple(scope, "-._~") && simple(name, "-._~")),
            None => simple(id, "-._~"),
        },
        Dev::Pip | Dev::Dotnet | Dev::Pwsh | Dev::Powershell => simple(id, "-._"),
        Dev::Cargo => simple(id, "-_"),
        // vcpkg: port, u nainstalovaného i s tripletem („fmt:x64-windows“)
        Dev::Vcpkg => match id.split_once(':') {
            Some((port, triplet)) => simple(port, "-") && simple(triplet, "-"),
            None => simple(id, "-"),
        },
    }
}

fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && version.chars().all(|c| c.is_ascii_alphanumeric() || ".+-_".contains(c))
}

/// Klíč pro porovnání verzí: čísla v pořadí („1.10.0-beta“ → [1, 10, 0]).
fn version_key(version: &str) -> Vec<u64> {
    version.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).take(6).map(|s| s.parse().unwrap_or(0)).collect()
}

fn is_newer(candidate: &str, installed: &str) -> bool {
    version_key(candidate) > version_key(installed)
}

// ── Síť ──────────────────────────────────────────────────────────────────

/// GET přes curl.exe (součást Windows); None = chyba nebo HTTP 4xx/5xx.
fn http_get(url: &str, accept: Option<&str>) -> Option<String> {
    let mut command = hidden_command(&system_tool("curl.exe").to_string_lossy());
    command.args(["-sSL", "--fail", "--max-time", "20", "-A", USER_AGENT]);
    if let Some(accept) = accept {
        command.args(["-H", &format!("Accept: {accept}")]);
    }
    command.arg(url);
    let out = crate::process::run(command, Duration::from_secs(25)).ok()?;
    (out.code == 0).then_some(out.stdout)
}

fn http_json(url: &str) -> Option<Value> {
    serde_json::from_str(&http_get(url, Some("application/json"))?).ok()
}

/// Kódování části adresy (dotaz, název balíčku).
fn url_encode(text: &str) -> String {
    text.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// Spustí `lookup` pro každý název souběžně (nejvýš 8 najednou).
fn parallel<T: Send>(names: &[String], lookup: impl Fn(&str) -> Option<T> + Sync) -> HashMap<String, T> {
    let results = Mutex::new(HashMap::new());
    for chunk in names.chunks(8) {
        std::thread::scope(|scope| {
            for name in chunk {
                let (results, lookup) = (&results, &lookup);
                scope.spawn(move || {
                    if let Some(value) = lookup(name) {
                        results.lock().unwrap_or_else(|e| e.into_inner()).insert(name.clone(), value);
                    }
                });
            }
        });
    }
    results.into_inner().unwrap_or_else(|e| e.into_inner())
}

/// Nejnovější verze balíčku z registru npm (Bun nemá `outdated` pro globální balíčky).
fn npm_registry_latest(name: &str) -> Option<String> {
    let encoded = name.replacen('/', "%2F", 1);
    http_json(&format!("https://registry.npmjs.org/{encoded}/latest"))?.get("version")?.as_str().map(str::to_string)
}

fn crates_latest(name: &str) -> Option<String> {
    let json = http_json(&format!("https://crates.io/api/v1/crates/{}", url_encode(name)))?;
    let krate = json.get("crate")?;
    krate.get("max_stable_version").or_else(|| krate.get("newest_version"))?.as_str().map(str::to_string)
}

/// Verze balíčku v NuGetu (od nejstarší) z plochého indexu.
fn nuget_versions(id: &str) -> Vec<String> {
    http_json(&format!("https://api.nuget.org/v3-flatcontainer/{}/index.json", url_encode(&id.to_lowercase())))
        .and_then(|json| json.get("versions")?.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

fn nuget_latest(id: &str) -> Option<String> {
    nuget_versions(id).into_iter().rfind(|v| !v.contains('-'))
}

// ── Nainstalované balíčky ────────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    package_id: String,
    name: String,
    installed_version: String,
    available_version: Option<String>,
}

fn installed(package_id: impl Into<String>, name: impl Into<String>, version: impl Into<String>) -> Installed {
    Installed { package_id: package_id.into(), name: name.into(), installed_version: version.into(), available_version: None }
}

/// Doplní novější verze (jen opravdu novější než nainstalovaná).
fn with_latest(mut list: Vec<Installed>, latest: &HashMap<String, String>) -> Vec<Installed> {
    for item in &mut list {
        item.available_version = latest.get(&item.package_id).filter(|l| is_newer(l, &item.installed_version)).cloned();
    }
    list
}

/// `npm ls -g --depth=0 --json` → (název, verze).
fn parse_npm_ls(json: &str) -> Vec<Installed> {
    let Ok(value) = serde_json::from_str::<Value>(json) else { return Vec::new() };
    value
        .get("dependencies")
        .and_then(Value::as_object)
        .map(|deps| {
            deps.iter()
                .filter_map(|(name, info)| Some(installed(name, name, info.get("version")?.as_str()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// `npm outdated -g --json` → název → nejnovější verze.
fn parse_npm_outdated(json: &str) -> HashMap<String, String> {
    serde_json::from_str::<Value>(json)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .map(|map| map.into_iter().filter_map(|(name, info)| Some((name, info.get("latest")?.as_str()?.to_string()))).collect())
        .unwrap_or_default()
}

/// Globální balíčky Bunu: `~/.bun/install/global/package.json` a verze z node_modules.
fn bun_installed() -> Vec<Installed> {
    let global = env_var("BUN_INSTALL").map(PathBuf::from).unwrap_or_else(|| home().join(".bun")).join(r"install\global");
    let Some(manifest) = std::fs::read_to_string(global.join("package.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return Vec::new();
    };
    manifest
        .get("dependencies")
        .and_then(Value::as_object)
        .map(|deps| {
            deps.keys()
                .filter_map(|name| {
                    let package = std::fs::read_to_string(global.join("node_modules").join(name).join("package.json")).ok()?;
                    let version = serde_json::from_str::<Value>(&package).ok()?.get("version")?.as_str()?.to_string();
                    Some(installed(name, name, version))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `pip list --format=json` (i `--outdated`) → seznam a nejnovější verze.
fn parse_pip_list(json: &str) -> (Vec<Installed>, HashMap<String, String>) {
    let items = serde_json::from_str::<Value>(json).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let mut list = Vec::new();
    let mut latest = HashMap::new();
    for item in items {
        let (Some(name), Some(version)) = (item.get("name").and_then(Value::as_str), item.get("version").and_then(Value::as_str)) else { continue };
        if let Some(newer) = item.get("latest_version").and_then(Value::as_str) {
            latest.insert(name.to_string(), newer.to_string());
        }
        list.push(installed(name, name, version));
    }
    (list, latest)
}

/// `cargo install --list`: „ripgrep v14.1.1:“ (z crates.io), „foo v0.1.0 (C:\…):“ (místní).
/// Vrací balíčky a které jsou z crates.io (jen u nich jde zjistit novější verzi).
fn parse_cargo_list(text: &str) -> (Vec<Installed>, Vec<String>) {
    let mut list = Vec::new();
    let mut registry = Vec::new();
    for line in text.lines().filter(|l| !l.starts_with(char::is_whitespace)) {
        let Some(head) = line.trim().strip_suffix(':') else { continue };
        let mut parts = head.splitn(3, ' ');
        let (Some(name), Some(version)) = (parts.next(), parts.next()) else { continue };
        let version = version.trim_start_matches('v');
        if parts.next().is_none() {
            registry.push(name.to_string());
        }
        list.push(installed(name, name, version));
    }
    (list, registry)
}

/// `vcpkg list --x-json` → „port:triplet“ s verzí (a revizí portu).
fn parse_vcpkg_list(json: &str) -> Vec<Installed> {
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(json) else { return Vec::new() };
    map.iter()
        .filter_map(|(spec, info)| {
            let name = info.get("package_name")?.as_str()?;
            let version = info.get("version")?.as_str()?;
            let port = info.get("port_version").and_then(Value::as_u64).unwrap_or(0);
            Some(installed(spec, name, if port > 0 { format!("{version}#{port}") } else { version.to_string() }))
        })
        .collect()
}

/// `vcpkg update`: „    fmt:x64-windows    10.1.1 -> 10.2.1“ → spec → nová verze.
fn parse_vcpkg_update(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let spec = parts.next()?;
            let _old = parts.next()?;
            (parts.next()? == "->").then_some(())?;
            Some((spec.to_string(), parts.next()?.to_string()))
        })
        .collect()
}

/// `dotnet tool list --global`: tabulka „Package Id  Version  Commands“, pod ní čára
/// z pomlček. Řádek nástroje: platné id a verze začínající číslicí.
fn parse_dotnet_list(text: &str) -> Vec<Installed> {
    text.lines()
        .skip_while(|l| !(l.trim().len() >= 10 && l.trim().chars().all(|c| c == '-')))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let (id, version) = (parts.next()?, parts.next()?);
            (valid_id(Dev::Dotnet, id) && version.starts_with(|c: char| c.is_ascii_digit())).then(|| installed(id, id, version))
        })
        .collect()
}

/// Výpis modulů PowerShellu (skript níže): [{ name, version, latest }].
fn parse_ps_list(json: &str) -> Vec<Installed> {
    let value: Value = serde_json::from_str(json.trim().trim_start_matches('\u{feff}')).unwrap_or(Value::Null);
    let items = match value {
        Value::Array(items) => items,
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("name")?.as_str()?;
            let version = item.get("version")?.as_str()?;
            let latest = item.get("latest").and_then(Value::as_str).filter(|l| is_newer(l, version)).map(str::to_string);
            Some(Installed { available_version: latest, ..installed(name, name, version) })
        })
        .collect()
}

/// Úvod skriptů PowerShellu: tichý běh, výstup v UTF-8, TLS 1.2 pro PowerShell Gallery.
const PS_PRELUDE: &str = "$ErrorActionPreference = 'SilentlyContinue'\n$ProgressPreference = 'SilentlyContinue'\n\
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false\n\
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072\n";

/// Hledání nových verzí v PowerShell Gallery – zvlášť a s vlastním limitem: pomalá
/// galerie nesmí shodit výpis nainstalovaných (moduly by z HubGetu zmizely).
const PS_FIND_TIMEOUT: Duration = Duration::from_secs(45);

/// Skript PowerShellu: nainstalované moduly (jen z disku – rychle).
fn ps_list_script(dev: Dev) -> String {
    let list = match dev {
        Dev::Pwsh => "if (Get-Command Get-InstalledPSResource -ErrorAction SilentlyContinue) { @(Get-InstalledPSResource | Sort-Object Name, Version -Descending | Group-Object Name | ForEach-Object { $_.Group[0] }) } else { @(Get-InstalledModule) }",
        _ => "@(Get-InstalledModule)",
    };
    format!(
        "{PS_PRELUDE}$items = {list}\n\
         $out = @($items | ForEach-Object {{ [pscustomobject]@{{ name = $_.Name; version = [string]$_.Version }} }})\n\
         ConvertTo-Json -InputObject $out -Compress"
    )
}

/// Skript PowerShellu: nejnovější verze modulů `names` v PowerShell Gallery.
fn ps_find_script(dev: Dev, names: &[String]) -> String {
    let find = match dev {
        Dev::Pwsh => "if (Get-Command Find-PSResource -ErrorAction SilentlyContinue) { Find-PSResource -Name $names -Repository PSGallery } else { Find-Module -Name $names -Repository PSGallery }",
        // PowerShellGet 1.x hledá přes poskytovatele NuGet – bez něj by se ptal, proto jen když už je
        _ => "if (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue) { Find-Module -Name $names -Repository PSGallery }",
    };
    let names = names.iter().map(|name| format!("'{}'", name.replace('\'', "''"))).collect::<Vec<_>>().join(", ");
    format!(
        "{PS_PRELUDE}$names = @({names})\n\
         $out = @(@({find}) | ForEach-Object {{ [pscustomobject]@{{ name = $_.Name; version = [string]$_.Version }} }})\n\
         ConvertTo-Json -InputObject $out -Compress"
    )
}

/// Jak dlouho platí nejnovější verze z PowerShell Gallery – dotaz trvá 4–7 s a nové
/// verze modulů vycházejí zřídka; obnovení seznamu pak čeká jen na výpis z disku (~1,5 s).
const PS_LATEST_TTL: Duration = Duration::from_secs(60 * 60);

/// Poslední odpověď galerie: správce a názvy modulů → kdy a jaké nejnovější verze.
type PsLatest = (Dev, Vec<String>, Instant, HashMap<String, String>);
static PS_LATEST: Mutex<Option<PsLatest>> = Mutex::new(None);

/// Nainstalované moduly PowerShellu a jejich nové verze (když galerie odpoví včas).
fn ps_installed(tool: &Tool, dev: Dev) -> Result<Vec<Installed>, String> {
    let list = parse_ps_list(&run_ps(tool, &ps_list_script(dev), LIST_TIMEOUT)?.stdout);
    if list.is_empty() {
        return Ok(list);
    }
    let mut names: Vec<String> = list.iter().map(|item| item.package_id.clone()).collect();
    names.sort();
    let cached = PS_LATEST
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .filter(|(d, n, at, _)| *d == dev && *n == names && at.elapsed() < PS_LATEST_TTL)
        .map(|(.., latest)| latest.clone());
    let latest = match cached {
        Some(latest) => latest,
        None => match run_ps(tool, &ps_find_script(dev, &names), PS_FIND_TIMEOUT) {
            Ok(found) => {
                let latest: HashMap<String, String> =
                    parse_ps_list(&found.stdout).into_iter().map(|f| (f.package_id, f.installed_version)).collect();
                *PS_LATEST.lock().unwrap_or_else(|e| e.into_inner()) = Some((dev, names, Instant::now(), latest.clone()));
                latest
            }
            // Galerie nedostupná nebo pomalá – moduly zůstanou v seznamu, jen bez nové verze
            Err(_) => HashMap::new(),
        },
    };
    Ok(with_latest(list, &latest))
}

/// Spustí skript PowerShellu nástrojem (pwsh / powershell) a vrátí výstup.
fn run_ps(tool: &Tool, script: &str, timeout: Duration) -> Result<Captured, String> {
    let encoded = BASE64.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
    tool.run(&["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded], timeout)
}

fn list_installed(dev: Dev) -> Result<Vec<Installed>, String> {
    let Some(tool) = tool(dev) else { return Ok(Vec::new()) };
    let output = |args: &[&str]| tool.run(args, LIST_TIMEOUT).map(|o| o.stdout);
    Ok(match dev {
        Dev::Npm => {
            let list = parse_npm_ls(&output(&["ls", "-g", "--depth=0", "--json"])?);
            // `npm outdated` končí kódem 1, když něco zastaralého najde – výstup platí
            let latest = output(&["outdated", "-g", "--json"]).map(|o| parse_npm_outdated(&o)).unwrap_or_default();
            with_latest(list, &latest)
        }
        Dev::Bun => {
            let list = bun_installed();
            let names: Vec<String> = list.iter().map(|i| i.package_id.clone()).collect();
            with_latest(list, &parallel(&names, npm_registry_latest))
        }
        Dev::Pip => {
            let flags = ["list", "--format=json", "--disable-pip-version-check"];
            let (list, _) = parse_pip_list(&output(&flags)?);
            let outdated = [&flags[..], &["--outdated"][..]].concat();
            let (_, latest) = output(&outdated).map(|o| parse_pip_list(&o)).unwrap_or_default();
            with_latest(list, &latest)
        }
        Dev::Cargo => {
            let (list, registry) = parse_cargo_list(&output(&["install", "--list"])?);
            with_latest(list, &parallel(&registry, crates_latest))
        }
        Dev::Vcpkg => {
            let list = parse_vcpkg_list(&output(&["list", "--x-json"])?);
            let latest = output(&["update"]).map(|o| parse_vcpkg_update(&o)).unwrap_or_default();
            with_latest(list, &latest)
        }
        Dev::Dotnet => {
            let list = parse_dotnet_list(&output(&["tool", "list", "--global"])?);
            let names: Vec<String> = list.iter().map(|i| i.package_id.clone()).collect();
            with_latest(list, &parallel(&names, nuget_latest))
        }
        Dev::Pwsh | Dev::Powershell => ps_installed(&tool, dev)?,
    })
}

#[tauri::command]
pub async fn dev_installed(source: Dev) -> Result<Vec<Installed>, String> {
    background(move || list_installed(source)).await
}

// ── Hledání a verze ──────────────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    package_id: String,
    name: String,
    version: String,
}

fn found(id: &str, version: &str) -> Found {
    Found { package_id: id.to_string(), name: id.to_string(), version: version.to_string() }
}

fn parse_npm_search(json: &str) -> Vec<Found> {
    let value: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    value
        .get("objects")
        .and_then(Value::as_array)
        .map(|objects| {
            objects
                .iter()
                .filter_map(|o| {
                    let package = o.get("package")?;
                    Some(found(package.get("name")?.as_str()?, package.get("version")?.as_str()?))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_crates_search(json: &str) -> Vec<Found> {
    let value: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    value
        .get("crates")
        .and_then(Value::as_array)
        .map(|crates| {
            crates
                .iter()
                .filter_map(|c| {
                    let version = c.get("max_stable_version").and_then(Value::as_str).or_else(|| c.get("newest_version")?.as_str())?;
                    Some(found(c.get("name")?.as_str()?, version))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_nuget_search(json: &str) -> Vec<Found> {
    let value: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    value
        .get("data")
        .and_then(Value::as_array)
        .map(|data| data.iter().filter_map(|p| Some(found(p.get("id")?.as_str()?, p.get("version")?.as_str()?))).collect())
        .unwrap_or_default()
}

/// Položky kanálu Atom z PowerShell Gallery: název (`<title …>`) a `<d:Version>`.
fn parse_psgallery_feed(xml: &str) -> Vec<Found> {
    let between = |text: &str, start: &str, end: &str| -> Option<String> {
        let from = text.find(start)? + start.len();
        let from = from + text[from..].find('>')? + 1;
        let to = from + text[from..].find(end)?;
        Some(text[from..to].trim().to_string())
    };
    xml.split("<entry")
        .skip(1)
        .filter_map(|entry| {
            let name = between(entry, "<title", "</title>")?;
            let version = between(entry, "<d:Version", "</d:Version>")?;
            Some(found(&name, &version))
        })
        .collect()
}

/// `vcpkg search … --x-json` → { port: { version, port_version } }.
fn parse_vcpkg_search(json: &str) -> Vec<Found> {
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(json) else { return Vec::new() };
    map.iter().filter_map(|(name, info)| Some(found(name, info.get("version")?.as_str()?))).collect()
}

fn search(dev: Dev, query: &str) -> Vec<Found> {
    let q = url_encode(query.trim());
    let mut results = match dev {
        Dev::Npm | Dev::Bun => http_get(&format!("https://registry.npmjs.org/-/v1/search?text={q}&size=20"), None)
            .map(|j| parse_npm_search(&j))
            .unwrap_or_default(),
        // PyPI vyhledávací API nemá – jen přesná shoda názvu
        Dev::Pip => http_json(&format!("https://pypi.org/pypi/{q}/json"))
            .and_then(|j| {
                let info = j.get("info")?;
                Some(vec![found(info.get("name")?.as_str()?, info.get("version")?.as_str()?)])
            })
            .unwrap_or_default(),
        Dev::Cargo => http_get(&format!("https://crates.io/api/v1/crates?q={q}&per_page=20"), Some("application/json"))
            .map(|j| parse_crates_search(&j))
            .unwrap_or_default(),
        Dev::Vcpkg => {
            let valid = query.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
            match tool(dev).filter(|_| valid) {
                Some(tool) => tool.run(&["search", query.trim(), "--x-json"], LIST_TIMEOUT).map(|o| parse_vcpkg_search(&o.stdout)).unwrap_or_default(),
                None => Vec::new(),
            }
        }
        Dev::Dotnet => http_get(&format!("https://azuresearch-usnc.nuget.org/query?q={q}&packageType=dotnettool&take=20"), None)
            .map(|j| parse_nuget_search(&j))
            .unwrap_or_default(),
        Dev::Pwsh | Dev::Powershell => http_get(
            &format!("https://www.powershellgallery.com/api/v2/Search()?$filter=IsLatestVersion&searchTerm='{q}'&targetFramework=''&includePrerelease=false&$top=20"),
            None,
        )
        .map(|x| parse_psgallery_feed(&x))
        .unwrap_or_default(),
    };
    // Do příkazů smí jen platná id
    results.retain(|f| valid_id(dev, &f.package_id));
    results.truncate(20);
    results
}

#[tauri::command]
pub async fn dev_search(source: Dev, query: String) -> Result<Vec<Found>, String> {
    background(move || Ok(if query.trim().len() < 2 { Vec::new() } else { search(source, &query) })).await
}

/// Verze seřazené od nejnovější (nejvýš 60), bez předběžných.
fn sorted_versions(mut versions: Vec<String>) -> Vec<String> {
    versions.retain(|v| valid_version(v) && !v.contains('-'));
    versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    versions.dedup();
    versions.truncate(60);
    versions
}

fn versions(dev: Dev, id: &str) -> Vec<String> {
    if !valid_id(dev, id) {
        return Vec::new();
    }
    let keys = |json: Option<Value>, field: &str| -> Vec<String> {
        json.and_then(|j| j.get(field)?.as_object().map(|m| m.keys().cloned().collect())).unwrap_or_default()
    };
    sorted_versions(match dev {
        Dev::Npm | Dev::Bun => {
            let abbreviated = http_get(&format!("https://registry.npmjs.org/{}", id.replacen('/', "%2F", 1)), Some("application/vnd.npm.install-v1+json"));
            keys(abbreviated.and_then(|t| serde_json::from_str(&t).ok()), "versions")
        }
        Dev::Pip => keys(http_json(&format!("https://pypi.org/pypi/{}/json", url_encode(id))), "releases"),
        Dev::Cargo => http_json(&format!("https://crates.io/api/v1/crates/{}/versions", url_encode(id)))
            .and_then(|j| j.get("versions")?.as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter(|v| !v.get("yanked").and_then(Value::as_bool).unwrap_or(false))
            .filter_map(|v| v.get("num")?.as_str().map(str::to_string))
            .collect(),
        // vcpkg v klasickém režimu instaluje jen verzi z aktuálního stavu portů
        Dev::Vcpkg => Vec::new(),
        Dev::Dotnet => nuget_versions(id),
        Dev::Pwsh | Dev::Powershell => http_get(&format!("https://www.powershellgallery.com/api/v2/FindPackagesById()?id='{}'", url_encode(id)), None)
            .map(|x| parse_psgallery_feed(&x).into_iter().map(|f| f.version).collect())
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn dev_versions(source: Dev, package_id: String) -> Result<Vec<String>, String> {
    background(move || Ok(versions(source, &package_id))).await
}

// ── Instalace chybějícího nástroje ───────────────────────────────────────

/// Balíček wingetu, který nástroj přinese; None = winget ho nemá.
fn setup_package(dev: Dev) -> Option<&'static str> {
    match dev {
        Dev::Npm => Some("OpenJS.NodeJS.LTS"),
        Dev::Bun => Some("Oven-sh.Bun"),
        Dev::Pip => Some("Python.Python.3.13"),
        Dev::Cargo => Some("Rustlang.Rustup"),
        Dev::Dotnet => Some("Microsoft.DotNet.SDK.10"),
        Dev::Pwsh => Some("Microsoft.PowerShell"),
        Dev::Vcpkg | Dev::Powershell => None,
    }
}

#[tauri::command]
pub async fn dev_setup(source: Dev) -> Result<(), String> {
    background(move || {
        let Some(package) = setup_package(source) else {
            return Err(match source {
                Dev::Vcpkg => "vcpkg nainstalujte podle návodu na vcpkg.io (git clone https://github.com/microsoft/vcpkg a bootstrap-vcpkg.bat) a nastavte proměnnou VCPKG_ROOT.".into(),
                _ => format!("{} je součástí Windows.", source.label()),
            });
        };
        let mut command = hidden_command(&crate::winget::winget_exe());
        command.args(["install", "--id", package, "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]);
        let output = crate::process::run(command, Duration::from_secs(900))?;
        if tool(source).and_then(|t| tool_version(source, &t)).is_none() {
            let last = output.stdout.lines().map(str::trim).rev().find(|l| !l.is_empty()).unwrap_or_default().to_string();
            return Err(format!("Instalace {} se nepovedla ({}): {last}", source.label(), output.code));
        }
        Ok(())
    })
    .await
}

// ── Operace ──────────────────────────────────────────────────────────────

/// PowerShell: příkaz modulu podle operace (PSResourceGet v PowerShellu 7, jinak PowerShellGet).
fn ps_operation_script(dev: Dev, request: &OperationRequest, version: Option<&str>, downloads: &Path) -> String {
    let default_options = InstallOptions::default();
    let options = request.options.as_ref().unwrap_or(&default_options);
    let all_users = options.scope.as_deref() == Some("machine");
    ps_module_script(dev, request.kind, &request.package_id, version, all_users, downloads)
}

/// Návratový kód skriptu, když operace potřebuje práva správce (ERROR_ELEVATION_REQUIRED).
const PS_NEEDS_ADMIN: i32 = 740;

/// Pevné argumenty PowerShellu před zakódovaným skriptem operace.
const PS_ARGS: [&str; 6] = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"];

fn ps_module_script(dev: Dev, kind: Kind, id: &str, version: Option<&str>, all_users: bool, downloads: &Path) -> String {
    let scope = if all_users { "AllUsers" } else { "CurrentUser" };
    let path = ps_string(&downloads.to_string_lossy());
    let (resource, module) = match kind {
        Kind::Install => (
            format!("Install-PSResource -Name '{id}' -Repository PSGallery -TrustRepository -Scope {scope}{}", version.map(|v| format!(" -Version '{v}'")).unwrap_or_default()),
            format!("Install-Module -Name '{id}' -Repository PSGallery -Scope {scope} -Force -AllowClobber{}", version.map(|v| format!(" -RequiredVersion '{v}'")).unwrap_or_default()),
        ),
        Kind::Update => (format!("Update-PSResource -Name '{id}' -TrustRepository"), format!("Update-Module -Name '{id}' -Force")),
        Kind::Uninstall => (format!("Uninstall-PSResource -Name '{id}'"), format!("Uninstall-Module -Name '{id}' -AllVersions -Force")),
        Kind::Download => (
            format!("Save-PSResource -Name '{id}' -Repository PSGallery -TrustRepository -Path {path}{}", version.map(|v| format!(" -Version '{v}'")).unwrap_or_default()),
            format!("Save-Module -Name '{id}' -Repository PSGallery -Path {path} -Force{}", version.map(|v| format!(" -RequiredVersion '{v}'")).unwrap_or_default()),
        ),
    };
    let command = match dev {
        Dev::Pwsh => format!("if (Get-Command Install-PSResource -ErrorAction SilentlyContinue) {{ {resource} }} else {{ {module} }}"),
        // Windows PowerShell: PowerShellGet 1.x potřebuje poskytovatele NuGet – doinstalovat bez dotazu
        _ => format!(
            "if (-not (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue)) {{ Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null }}\n{module}"
        ),
    };
    // Instalace pro všechny uživatele a změna modulu v Program Files (nainstalovaného pro všechny)
    // potřebují práva správce – bez nich skript skončí kódem 740 a HubGet operaci zopakuje s UAC
    let needs_admin = match kind {
        Kind::Install if all_users => Some("$true".to_string()),
        Kind::Update | Kind::Uninstall => {
            let installed = match dev {
                Dev::Pwsh => format!("if (Get-Command Get-InstalledPSResource -ErrorAction SilentlyContinue) {{ Get-InstalledPSResource -Name '{id}' -ErrorAction SilentlyContinue }} else {{ Get-InstalledModule -Name '{id}' -AllVersions -ErrorAction SilentlyContinue }}"),
                _ => format!("Get-InstalledModule -Name '{id}' -AllVersions -ErrorAction SilentlyContinue"),
            };
            Some(format!("@(@({installed}) | Where-Object {{ $_.InstalledLocation -and ([string]$_.InstalledLocation).StartsWith($env:ProgramFiles, [StringComparison]::OrdinalIgnoreCase) }}).Count -gt 0"))
        }
        _ => None,
    };
    let admin_check = needs_admin
        .map(|needs| {
            format!(
                "$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)\n\
                 if (-not $admin -and ({needs})) {{ Write-Output 'Module is installed for all users - administrator rights are required.'; exit {PS_NEEDS_ADMIN} }}\n"
            )
        })
        .unwrap_or_default();
    format!(
        "$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n\
         [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false\n\
         [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072\n\
         try {{\n{admin_check}{command} *>&1\nexit 0\n}} catch {{ Write-Output $_.Exception.Message; exit 1 }}"
    )
}

/// Modul PowerShellu, se kterým jde pracovat jen jako správce: instalace pro všechny uživatele,
/// aktualizace či odinstalace modulu, který PowerShellGet nainstaloval do Program Files
/// (verze se souborem PSGetModuleInfo.xml – moduly dodané s Windows ho nemají a jejich novější
/// verze bývá u uživatele). Ostatní případy pozná skript sám (kód 740 → opakování s UAC).
fn ps_needs_admin(dev: Dev, kind: Kind, id: &str, all_users: bool) -> bool {
    let modules = match dev {
        Dev::Pwsh => r"PowerShell\Modules",
        _ => r"WindowsPowerShell\Modules",
    };
    match kind {
        Kind::Install => all_users,
        Kind::Update | Kind::Uninstall => std::fs::read_dir(program_files().join(modules).join(id))
            .map(|versions| versions.flatten().any(|v| v.path().join("PSGetModuleInfo.xml").is_file()))
            .unwrap_or(false),
        Kind::Download => false,
    }
}

/// Argumenty PowerShellu pro skript operace (zakódovaný v UTF-16, na uvozovkách nezáleží).
fn ps_args(script: &str) -> Vec<String> {
    let encoded = BASE64.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
    PS_ARGS.iter().map(|a| a.to_string()).chain([encoded]).collect()
}

/// Text mezi „prefix“ a následujícím apostrofem („-Name 'Pester'“ → „Pester“).
fn quoted_after<'a>(script: &'a str, prefix: &str) -> Option<&'a str> {
    let rest = &script[script.find(prefix)? + prefix.len()..];
    rest.find('\'').map(|end| &rest[..end])
}

/// Smí běžet s právy správce? Jen operace s modulem PowerShellu přesně v podobě, jakou sestaví
/// HubGet (instalace, aktualizace, odinstalace z PowerShell Gallery podle ověřeného id a verze),
/// a jen systémovým Windows PowerShellem nebo PowerShellem 7 v Program Files – spustitelný
/// soubor ve složce, kam smí zapisovat běžný uživatel, by se dal podvrhnout.
pub fn is_module_command(program: &str, args: &[String]) -> bool {
    let path = Path::new(program);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let dev = match stem.as_str() {
        "powershell" if path.to_string_lossy().eq_ignore_ascii_case(&powershell_exe().to_string_lossy()) => Dev::Powershell,
        "pwsh" if path.starts_with(program_files()) => Dev::Pwsh,
        _ => return false,
    };
    if args.len() != PS_ARGS.len() + 1 || args.iter().zip(PS_ARGS).any(|(a, b)| a != b) {
        return false;
    }
    let Some(script) = BASE64
        .decode(&args[PS_ARGS.len()])
        .ok()
        .filter(|bytes| bytes.len() % 2 == 0)
        .and_then(|bytes| String::from_utf16(&bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<u16>>()).ok())
    else {
        return false;
    };
    let Some(id) = quoted_after(&script, "-Name '").filter(|id| valid_id(dev, id)) else {
        return false;
    };
    let version = quoted_after(&script, "-RequiredVersion '").or_else(|| quoted_after(&script, "-Version '"));
    if version.is_some_and(|v| !valid_version(v)) {
        return false;
    }
    // Stažení (Save-Module) práva správce nepotřebuje – cesta ke složce se proto neověřuje
    [Kind::Install, Kind::Update, Kind::Uninstall]
        .into_iter()
        .flat_map(|kind| [false, true].map(|all_users| (kind, all_users)))
        .any(|(kind, all_users)| ps_module_script(dev, kind, id, version, all_users, Path::new("")) == script)
}

/// Argumenty nástroje pro operaci (bez úvodních argumentů nástroje).
fn operation_args(dev: Dev, request: &OperationRequest, version: Option<&str>, downloads: &Path) -> Result<Vec<String>, String> {
    let id = request.package_id.as_str();
    let default_options = InstallOptions::default();
    let options = request.options.as_ref().unwrap_or(&default_options);
    let location = options.location.as_deref().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('-'));
    let arch = options.architecture.as_deref().filter(|a| matches!(*a, "x64" | "x86" | "arm64"));
    let downloads = downloads.to_string_lossy().into_owned();
    let s = |items: &[&str]| items.iter().map(|i| i.to_string()).collect::<Vec<String>>();
    let mut args = match (dev, request.kind) {
        (Dev::Npm, Kind::Install) => s(&["install", "-g", &version.map_or(id.to_string(), |v| format!("{id}@{v}"))]),
        (Dev::Npm, Kind::Update) => s(&["install", "-g", &format!("{id}@latest")]),
        (Dev::Npm, Kind::Uninstall) => s(&["uninstall", "-g", id]),
        (Dev::Npm, Kind::Download) => s(&["pack", &version.map_or(id.to_string(), |v| format!("{id}@{v}")), "--pack-destination", &downloads]),
        (Dev::Bun, Kind::Install) => s(&["add", "-g", &format!("{id}@{}", version.unwrap_or("latest"))]),
        (Dev::Bun, Kind::Update) => s(&["add", "-g", &format!("{id}@latest")]),
        (Dev::Bun, Kind::Uninstall) => s(&["remove", "-g", id]),
        (Dev::Pip, Kind::Install) => {
            let mut args = s(&["install", &version.map_or(id.to_string(), |v| format!("{id}=={v}"))]);
            if options.scope.as_deref() == Some("user") {
                args.push("--user".into());
            }
            if let Some(location) = location {
                args.extend(s(&["--target", location]));
            }
            args
        }
        (Dev::Pip, Kind::Update) => s(&["install", "--upgrade", id]),
        (Dev::Pip, Kind::Uninstall) => s(&["uninstall", "-y", id]),
        (Dev::Pip, Kind::Download) => s(&["download", &version.map_or(id.to_string(), |v| format!("{id}=={v}")), "--no-deps", "-d", &downloads]),
        (Dev::Cargo, Kind::Install) => {
            let mut args = s(&["install", id]);
            if let Some(version) = version {
                args.extend(s(&["--version", version]));
            }
            if let Some(location) = location {
                args.extend(s(&["--root", location]));
            }
            args
        }
        // `cargo install` nainstaluje novější verzi přes starší
        (Dev::Cargo, Kind::Update) => s(&["install", id]),
        (Dev::Cargo, Kind::Uninstall) => s(&["uninstall", id]),
        (Dev::Vcpkg, Kind::Install) => {
            // Architektura = triplet („fmt:x64-windows“)
            let spec = match arch.filter(|_| !id.contains(':')) {
                Some(arch) => format!("{id}:{arch}-windows"),
                None => id.to_string(),
            };
            s(&["install", &spec])
        }
        (Dev::Vcpkg, Kind::Update) => s(&["upgrade", id, "--no-dry-run"]),
        (Dev::Vcpkg, Kind::Uninstall) => s(&["remove", id]),
        (Dev::Dotnet, kind @ (Kind::Install | Kind::Update | Kind::Uninstall)) => {
            let verb = match kind {
                Kind::Install => "install",
                Kind::Update => "update",
                _ => "uninstall",
            };
            let mut args = s(&["tool", verb]);
            match location {
                Some(location) => args.extend(s(&["--tool-path", location])),
                None => args.push("--global".into()),
            }
            args.push(id.to_string());
            if kind == Kind::Install {
                if let Some(version) = version {
                    args.extend(s(&["--version", version]));
                }
                if let Some(arch) = arch {
                    args.extend(s(&["--arch", arch]));
                }
            }
            args
        }
        _ => return Err(format!("{} tuto operaci neumí", dev.label())),
    };
    // Méně šumu ve výstupu a žádné dotazy
    match dev {
        Dev::Npm => args.extend(s(&["--no-fund", "--no-audit"])),
        Dev::Pip => args.extend(s(&["--disable-pip-version-check", "--no-input", "--progress-bar", "off"])),
        _ => {}
    }
    Ok(args)
}

fn interpret(_kind: Kind, code: i32) -> Verdict {
    match code {
        0 => Verdict::success(false),
        // Modul PowerShellu pro všechny uživatele bez práv správce – zopakovat s UAC
        PS_NEEDS_ADMIN => Verdict::error("requiresAdmin").retry_elevated(),
        _ => Verdict::error("failed"),
    }
}

fn no_progress(_line: &str) -> Option<f64> {
    None
}

/// Spustí operaci; `id` přidělí frontend (pro zrušení přes cancel_operation).
#[tauri::command]
pub async fn dev_operation(
    app: AppHandle,
    id: String,
    source: Dev,
    request: OperationRequest,
    on_event: Channel<OpEvent>,
) -> Result<OperationResult, String> {
    if !valid_id(source, &request.package_id) {
        return Err(format!("Neplatné id balíčku: {}", request.package_id));
    }
    let version = match request.version.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) if valid_version(v) => Some(v.to_string()),
        Some(v) => return Err(format!("Neplatná verze: {v}")),
        None => None,
    };
    let tool = background(move || Ok(tool(source))).await?.ok_or_else(|| format!("{} není nainstalovaný", source.label()))?;
    if source == Dev::Dotnet {
        // Bez uvítání .NET při prvním spuštění (operace dědí prostředí HubGetu)
        std::env::set_var("DOTNET_NOLOGO", "1");
        std::env::set_var("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1");
    }
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let (program, args) = match source {
        Dev::Pwsh | Dev::Powershell => {
            let script = ps_operation_script(source, &request, version.as_deref(), &downloads);
            (tool.program, ps_args(&script))
        }
        _ => {
            let mut args = tool.prefix.clone();
            args.extend(operation_args(source, &request, version.as_deref(), &downloads)?);
            (tool.program, args)
        }
    };
    // Modul PowerShellu pro všechny uživatele: rovnou jako správce (mimo vlákno asynchronního běhu)
    let elevated = match source {
        Dev::Pwsh | Dev::Powershell => {
            let (kind, id) = (request.kind, request.package_id.clone());
            let all_users = request.options.as_ref().is_some_and(|o| o.scope.as_deref() == Some("machine"));
            background(move || Ok(ps_needs_admin(source, kind, &id, all_users))).await?
        }
        _ => false,
    };
    let (pre_command, post_command) = operations::custom_commands(&request);
    let spec = Spec {
        program: program.to_string_lossy().into_owned(),
        args,
        retry_args: None,
        kind: request.kind,
        elevated,
        background: request.background,
        interactive: false,
        parse_progress: no_progress,
        download_dirs: Vec::new(),
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
    fn ids_are_validated() {
        assert!(valid_id(Dev::Npm, "typescript"));
        assert!(valid_id(Dev::Npm, "@angular/cli"));
        assert!(!valid_id(Dev::Npm, "@angular"));
        assert!(!valid_id(Dev::Npm, "-g"));
        assert!(!valid_id(Dev::Npm, "a b"));
        assert!(!valid_id(Dev::Npm, "x;calc"));
        assert!(valid_id(Dev::Pip, "requests"));
        assert!(!valid_id(Dev::Pip, "requests==1.0"));
        assert!(valid_id(Dev::Cargo, "cargo-edit"));
        assert!(!valid_id(Dev::Cargo, "a.b"));
        assert!(valid_id(Dev::Vcpkg, "fmt:x64-windows"));
        assert!(!valid_id(Dev::Vcpkg, "fmt:x64 windows"));
        assert!(valid_id(Dev::Pwsh, "PSReadLine"));
        assert!(!valid_id(Dev::Powershell, "Az'; calc"));
        assert!(valid_version("1.2.3-beta.1"));
        assert!(!valid_version("-1"));
        assert!(!valid_version("1.0 && calc"));
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(is_newer("1.10.0", "1.9.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(is_newer("2.0.0", "1.99"));
        assert_eq!(sorted_versions(vec!["1.2.0".into(), "1.10.0".into(), "1.9.0".into(), "2.0.0-rc1".into()]), ["1.10.0", "1.9.0", "1.2.0"]);
    }

    #[test]
    fn npm_listing() {
        let list = parse_npm_ls(r#"{"dependencies":{"typescript":{"version":"5.4.5"},"@angular/cli":{"version":"17.0.0"}}}"#);
        assert_eq!(list.len(), 2);
        let latest = parse_npm_outdated(r#"{"typescript":{"current":"5.4.5","wanted":"5.4.5","latest":"5.6.3"}}"#);
        let list = with_latest(list, &latest);
        let ts = list.iter().find(|i| i.package_id == "typescript").unwrap();
        assert_eq!(ts.available_version.as_deref(), Some("5.6.3"));
    }

    #[test]
    fn pip_cargo_vcpkg_dotnet_listing() {
        let (list, latest) = parse_pip_list(r#"[{"name":"requests","version":"2.31.0","latest_version":"2.32.3","latest_filetype":"wheel"}]"#);
        assert_eq!((list.len(), latest.get("requests").map(String::as_str)), (1, Some("2.32.3")));

        let (list, registry) = parse_cargo_list("ripgrep v14.1.0:\n    rg.exe\nmytool v0.1.0 (C:\\src\\mytool):\n    mytool.exe\n");
        assert_eq!(list.iter().map(|i| (i.package_id.as_str(), i.installed_version.as_str())).collect::<Vec<_>>(), [("ripgrep", "14.1.0"), ("mytool", "0.1.0")]);
        assert_eq!(registry, ["ripgrep"]);

        let list = parse_vcpkg_list(r#"{"fmt:x64-windows":{"package_name":"fmt","triplet":"x64-windows","version":"10.2.1","port_version":2}}"#);
        assert_eq!(list, [installed("fmt:x64-windows", "fmt", "10.2.1#2")]);
        let updates = parse_vcpkg_update("The following packages differ from their port versions:\n    fmt:x64-windows        10.2.1#2 -> 11.0.2\n");
        assert_eq!(updates.get("fmt:x64-windows").map(String::as_str), Some("11.0.2"));

        let list = parse_dotnet_list("Package Id      Version      Commands\n-------------------------------------\ndotnet-ef       8.0.4        dotnet-ef\n");
        assert_eq!(list, [installed("dotnet-ef", "dotnet-ef", "8.0.4")]);
        // Uvítání .NET před tabulkou (i s pomlčkami v textu) se nepočítá
        let banner = "Welcome to .NET 9.0!\n---------------------\nSDK Version: 9.0.320\n\nPackage Id      Version      Commands\n-------------------------------------\n";
        assert!(parse_dotnet_list(banner).is_empty());
    }

    #[test]
    fn powershell_listing() {
        let list = parse_ps_list(r#"[{"name":"PSReadLine","version":"2.3.4","latest":"2.3.5"},{"name":"Pester","version":"5.6.1","latest":null}]"#);
        assert_eq!(list[0].available_version.as_deref(), Some("2.3.5"));
        assert_eq!(list[1].available_version, None);
        // Jeden modul = objekt, ne pole
        assert_eq!(parse_ps_list(r#"{"name":"Pester","version":"5.6.1","latest":"5.6.1"}"#).len(), 1);
        // Výpis nainstalovaných se na galerii neptá; hledání dostane názvy jako řetězce PowerShellu
        assert!(!ps_list_script(Dev::Powershell).contains("Find-Module"));
        assert!(ps_find_script(Dev::Powershell, &["Pester".into(), "It's".into()]).contains("$names = @('Pester', 'It''s')"));
    }

    #[test]
    fn search_results() {
        assert_eq!(parse_npm_search(r#"{"objects":[{"package":{"name":"typescript","version":"5.6.3"}}]}"#), [found("typescript", "5.6.3")]);
        assert_eq!(parse_crates_search(r#"{"crates":[{"name":"ripgrep","max_stable_version":"14.1.1","newest_version":"14.1.1"}]}"#), [found("ripgrep", "14.1.1")]);
        assert_eq!(parse_nuget_search(r#"{"data":[{"id":"dotnet-ef","version":"9.0.0"}]}"#), [found("dotnet-ef", "9.0.0")]);
        let feed = r#"<feed><entry><id>x</id><title type="text">PSReadLine</title><m:properties><d:Version>2.3.5</d:Version></m:properties></entry></feed>"#;
        assert_eq!(parse_psgallery_feed(feed), [found("PSReadLine", "2.3.5")]);
        assert_eq!(parse_vcpkg_search(r#"{"fmt":{"package_name":"fmt","version":"11.0.2","port_version":0}}"#), [found("fmt", "11.0.2")]);
    }

    #[test]
    fn operation_arguments() {
        let downloads = Path::new(r"C:\Users\u\Downloads");
        assert_eq!(
            operation_args(Dev::Npm, &request(Kind::Install, "typescript"), Some("5.4.5"), downloads).unwrap(),
            ["install", "-g", "typescript@5.4.5", "--no-fund", "--no-audit"]
        );
        assert_eq!(operation_args(Dev::Bun, &request(Kind::Update, "prettier"), None, downloads).unwrap(), ["add", "-g", "prettier@latest"]);
        let mut pip = request(Kind::Install, "requests");
        pip.options = Some(InstallOptions { scope: Some("user".into()), ..Default::default() });
        assert_eq!(
            operation_args(Dev::Pip, &pip, Some("2.32.3"), downloads).unwrap(),
            ["install", "requests==2.32.3", "--user", "--disable-pip-version-check", "--no-input", "--progress-bar", "off"]
        );
        let mut vcpkg = request(Kind::Install, "fmt");
        vcpkg.options = Some(InstallOptions { architecture: Some("x64".into()), ..Default::default() });
        assert_eq!(operation_args(Dev::Vcpkg, &vcpkg, None, downloads).unwrap(), ["install", "fmt:x64-windows"]);
        assert_eq!(operation_args(Dev::Dotnet, &request(Kind::Update, "dotnet-ef"), None, downloads).unwrap(), ["tool", "update", "--global", "dotnet-ef"]);
        assert!(operation_args(Dev::Cargo, &request(Kind::Download, "ripgrep"), None, downloads).is_err());
        let script = ps_operation_script(Dev::Powershell, &request(Kind::Install, "Pester"), None, downloads);
        assert!(script.contains("Install-PackageProvider -Name NuGet") && script.contains("Install-Module -Name 'Pester' -Repository PSGallery -Scope CurrentUser -Force -AllowClobber"));
        let script = ps_operation_script(Dev::Pwsh, &request(Kind::Uninstall, "Pester"), None, downloads);
        assert!(script.contains("Uninstall-PSResource -Name 'Pester'") && script.contains("Uninstall-Module -Name 'Pester' -AllVersions -Force"));
    }

    #[test]
    fn ps_modules_for_all_users_need_admin() {
        let downloads = Path::new(r"C:\Users\u\Downloads");
        let update = ps_operation_script(Dev::Powershell, &request(Kind::Update, "Microsoft.WinGet.Client"), None, downloads);
        assert!(update.contains("Get-InstalledModule -Name 'Microsoft.WinGet.Client' -AllVersions") && update.contains("exit 740"));
        assert!(!ps_operation_script(Dev::Pwsh, &request(Kind::Install, "Pester"), None, downloads).contains("exit 740"));
        let mut machine = request(Kind::Install, "Pester");
        machine.options = Some(InstallOptions { scope: Some("machine".into()), ..Default::default() });
        assert!(ps_operation_script(Dev::Powershell, &machine, Some("5.6.1"), downloads).contains("if (-not $admin -and ($true))"));
        assert!(interpret(Kind::Update, PS_NEEDS_ADMIN).retry_elevated);
        assert!(!interpret(Kind::Update, 1).retry_elevated);

        // Rovnou jako správce: instalace pro všechny uživatele; neexistující modul ani stažení ne
        assert!(ps_needs_admin(Dev::Powershell, Kind::Install, "Pester", true));
        assert!(!ps_needs_admin(Dev::Powershell, Kind::Install, "Pester", false));
        assert!(!ps_needs_admin(Dev::Powershell, Kind::Update, "HubGet.Nonexistent.Module", false));
        assert!(!ps_needs_admin(Dev::Pwsh, Kind::Download, "Pester", true));
        assert!(!crate::elevation::elevates_silently(&powershell_exe().to_string_lossy(), &ps_args(&update)));
    }

    #[test]
    fn only_unibox_module_scripts_may_elevate() {
        let ps = powershell_exe().to_string_lossy().into_owned();
        let pwsh = program_files().join(r"PowerShell\7\pwsh.exe").to_string_lossy().into_owned();
        let downloads = Path::new(r"C:\Users\u\Downloads");
        let script = |dev: Dev, kind: Kind, id: &str| ps_operation_script(dev, &request(kind, id), None, downloads);
        let mut machine = request(Kind::Install, "Pester");
        machine.options = Some(InstallOptions { scope: Some("machine".into()), ..Default::default() });
        assert!(is_module_command(&ps, &ps_args(&script(Dev::Powershell, Kind::Update, "Microsoft.WinGet.Client"))));
        assert!(is_module_command(&ps, &ps_args(&script(Dev::Powershell, Kind::Uninstall, "Az.Accounts"))));
        assert!(is_module_command(&ps, &ps_args(&ps_operation_script(Dev::Powershell, &machine, Some("5.6.1"), downloads))));
        assert!(is_module_command(&pwsh, &ps_args(&script(Dev::Pwsh, Kind::Update, "Pester"))));

        // Program mimo chráněné složky, upravený skript, jiné argumenty, stažení do složky → ne
        let update = script(Dev::Powershell, Kind::Update, "Pester");
        assert!(!is_module_command(r"C:\Users\u\scoop\shims\powershell.exe", &ps_args(&update)));
        assert!(!is_module_command(r"C:\Users\u\scoop\apps\pwsh\current\pwsh.exe", &ps_args(&script(Dev::Pwsh, Kind::Update, "Pester"))));
        assert!(!is_module_command(&ps, &ps_args(&format!("{update}\nStart-Process calc"))));
        assert!(!is_module_command(&ps, &ps_args(&update.replace("'Pester'", "'Pester'; calc; '"))));
        let mut args = ps_args(&update);
        args[3] = "RemoteSigned".into();
        assert!(!is_module_command(&ps, &args));
        assert!(!is_module_command(&ps, &ps_args(&script(Dev::Powershell, Kind::Download, "Pester"))));
        assert!(!is_module_command(&ps, &["-Command".into(), "calc".into()]));
    }

    #[test]
    fn url_encoding() {
        assert_eq!(url_encode("a b/c"), "a%20b%2Fc");
        assert_eq!(url_encode("@types/node"), "%40types%2Fnode");
    }

    /// Ruční kontrola na vývojářském počítači: `cargo test dev::tests::live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live() {
        for dev in [Dev::Npm, Dev::Bun, Dev::Pip, Dev::Cargo, Dev::Vcpkg, Dev::Dotnet, Dev::Pwsh, Dev::Powershell] {
            let tool = tool(dev);
            let version = tool.as_ref().and_then(|t| tool_version(dev, t));
            println!("{dev:?}: {version:?} {:?}", tool.map(|t| t.program));
            if version.is_some() {
                println!("  installed: {:?}", list_installed(dev).map(|l| l.into_iter().take(5).collect::<Vec<_>>()));
            }
            println!("  search: {:?}", search(dev, "json").into_iter().take(3).collect::<Vec<_>>());
        }
    }
}
