//! Příkaz `hubget` v terminálu.
//!
//! Nastavení → Desktopová aplikace zapíše do `%LOCALAPPDATA%\Microsoft\WindowsApps`
//! (složka je v PATH každého uživatele) malý skript `hubget.cmd`, který spustí
//! HubGet s příznakem [`CLI_FLAG`]. Takové spuštění neotevírá okno: připojí se ke
//! konzoli terminálu, příkaz zkontroluje a předá ho HubGetu – spustí HubGet znovu
//! s příznakem `--hubget-cli=<JSON>` (běžící HubGet ho dostane přes single-instance,
//! jinak se tím HubGet spustí) a hned skončí, terminál nečeká. Příkaz provede
//! frontend (hooks/useCliCommands.ts) přes frontu operací – s průběhem v aplikaci
//! a oznámením na konci.
//!
//! Testovací verze používá `hubget-test.cmd`, ať nepřepíše příkaz nainstalovaného HubGetu.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Příznak spuštění z terminálu (zapisuje ho skript `hubget.cmd`).
pub const CLI_FLAG: &str = "--cli";
/// Příkaz předávaný aplikaci (druhé spuštění → single-instance, nebo první spuštění).
const FORWARD_PREFIX: &str = "--hubget-cli=";
/// Událost pro frontend: čeká nový příkaz (vyzvedne si ho `take_cli_commands`).
const EVENT: &str = "hubget-cli";

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliCommand {
    /// install | update | search | show | updates | open
    pub command: String,
    pub args: Vec<String>,
}

/// Příkazy čekající na frontend (přišly dřív, než se načetl).
#[derive(Default)]
pub struct PendingCommands(Mutex<Vec<CliCommand>>);

enum Parsed {
    Forward(CliCommand),
    Help,
    Version,
    Error(String),
}

fn parse(args: &[String]) -> Parsed {
    let Some((first, rest)) = args.split_first() else {
        return Parsed::Forward(CliCommand { command: "open".into(), args: vec![] });
    };
    let rest: Vec<String> = rest.iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect();
    let forward = |command: &str, args: Vec<String>| Parsed::Forward(CliCommand { command: command.into(), args });
    match first.to_lowercase().as_str() {
        "help" | "--help" | "-h" | "/?" | "-?" => Parsed::Help,
        "version" | "--version" | "-v" => Parsed::Version,
        "install" | "add" | "i" => {
            if rest.is_empty() {
                Parsed::Error("install".into())
            } else {
                forward("install", rest)
            }
        }
        "update" | "upgrade" | "up" => {
            // Bez aplikací (nebo s --all) = všechny dostupné aktualizace
            let apps: Vec<String> = rest.into_iter().filter(|a| !matches!(a.as_str(), "--all" | "-a" | "all")).collect();
            forward("update", apps)
        }
        "search" | "find" | "s" => {
            if rest.is_empty() {
                Parsed::Error("search".into())
            } else {
                forward("search", vec![rest.join(" ")])
            }
        }
        "show" | "info" | "open" => match rest.first() {
            Some(app) => forward("show", vec![app.clone()]),
            None => forward("open", vec![]),
        },
        "updates" | "outdated" | "list" => forward("updates", vec![]),
        other => Parsed::Error(other.to_string()),
    }
}

/// Texty v jazyce Windows (čeština, jinak angličtina).
struct Texts {
    czech: bool,
}

impl Texts {
    fn new() -> Self {
        Texts { czech: windows_language_is_czech() }
    }

    fn pick<'a>(&self, cs: &'a str, en: &'a str) -> &'a str {
        if self.czech {
            cs
        } else {
            en
        }
    }

    fn usage(&self) -> String {
        let rows: [(&str, &str, &str); 7] = [
            ("hubget install <aplikace…>", "Nainstaluje aplikace (název, id z katalogu nebo balíček WinGetu)", "Installs apps (name, catalog id or WinGet package)"),
            ("hubget update [aplikace…]", "Aktualizuje aplikace, bez názvu všechny s aktualizací", "Updates apps; without a name all with an update"),
            ("hubget search <text>", "Vyhledá aplikace v HubGetu", "Searches for apps in HubGet"),
            ("hubget show <aplikace>", "Otevře detail aplikace", "Opens the app's details"),
            ("hubget updates", "Ukáže dostupné aktualizace", "Shows available updates"),
            ("hubget", "Otevře HubGet", "Opens HubGet"),
            ("hubget version", "Verze HubGetu", "HubGet version"),
        ];
        let mut text = format!(
            "{}\n\n",
            self.pick("HubGet – správa aplikací z terminálu", "HubGet – manage apps from the terminal")
        );
        for (command, cs, en) in rows {
            let command = if self.czech { command.to_string() } else { command.replace("aplikace…", "apps…").replace("aplikace", "app") };
            text.push_str(&format!("  {command:<30} {}\n", self.pick(cs, en)));
        }
        text.push_str(&format!(
            "\n{}\n",
            self.pick(
                "Příkaz provede HubGet: průběh uvidíte v aplikaci a na konci přijde oznámení.",
                "HubGet runs the command: progress is shown in the app and a notification arrives at the end."
            )
        ));
        text
    }

    fn forwarded(&self, command: &CliCommand) -> String {
        let list = command.args.join(", ");
        match command.command.as_str() {
            "install" => format!("{} {list}", self.pick("HubGet instaluje:", "HubGet is installing:")),
            "update" if command.args.is_empty() => self.pick("HubGet aktualizuje všechny aplikace s aktualizací.", "HubGet is updating all apps with an update.").into(),
            "update" => format!("{} {list}", self.pick("HubGet aktualizuje:", "HubGet is updating:")),
            "search" => format!("{} {list}", self.pick("HubGet hledá:", "HubGet is searching for:")),
            "show" => format!("{} {list}", self.pick("HubGet otevírá:", "HubGet is opening:")),
            "updates" => self.pick("HubGet ukazuje dostupné aktualizace.", "HubGet is showing available updates.").into(),
            _ => self.pick("HubGet se otevírá.", "HubGet is opening.").into(),
        }
    }
}

#[cfg(windows)]
fn windows_language_is_czech() -> bool {
    // SAFETY: bez parametrů
    let language = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
    language & 0x3ff == 0x05 // LANG_CZECH
}

#[cfg(not(windows))]
fn windows_language_is_czech() -> bool {
    false
}

/// Výstup do konzole terminálu: HubGet je okenní aplikace bez vlastní konzole – připojí se
/// ke konzoli, ze které ho terminál spustil (bez přesměrování výstupu do souboru).
#[cfg(windows)]
fn attach_console() {
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
    use windows_sys::Win32::System::Console::{AttachConsole, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE};
    // SAFETY: standardní volání konzole; otevřený CONOUT$ zůstává po dobu běhu procesu
    unsafe {
        let redirected = |kind| {
            let handle = GetStdHandle(kind);
            !handle.is_null() && handle != INVALID_HANDLE_VALUE
        };
        if redirected(STD_OUTPUT_HANDLE) || AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return;
        }
        if !redirected(STD_OUTPUT_HANDLE) {
            let name: Vec<u16> = "CONOUT$".encode_utf16().chain(Some(0)).collect();
            let handle = CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            );
            if handle != INVALID_HANDLE_VALUE {
                SetStdHandle(STD_OUTPUT_HANDLE, handle);
                SetStdHandle(STD_ERROR_HANDLE, handle);
            }
        }
    }
}

#[cfg(not(windows))]
fn attach_console() {}

/// Spuštění z terminálu (`HubGet.exe --cli …`): zkontroluje příkaz, předá ho HubGetu a skončí.
pub fn cli_main(args: &[String]) -> i32 {
    attach_console();
    let texts = Texts::new();
    // Konzole po skončení programu nevypíše nový řádek sama – výstup začíná na novém řádku
    match parse(args) {
        Parsed::Help => {
            println!("\n{}", texts.usage());
            0
        }
        Parsed::Version => {
            println!("\nHubGet {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Parsed::Error(what) => {
            let message = match what.as_str() {
                "install" => texts.pick("Zadejte, co nainstalovat: hubget install <aplikace>", "Specify what to install: hubget install <app>").to_string(),
                "search" => texts.pick("Zadejte, co hledat: hubget search <text>", "Specify what to search for: hubget search <text>").to_string(),
                other => format!("{} „{other}“", texts.pick("Neznámý příkaz", "Unknown command")),
            };
            eprintln!("\n{message}\n\n{}", texts.usage());
            2
        }
        Parsed::Forward(command) => match forward(&command) {
            Ok(()) => {
                println!("\n{}", texts.forwarded(&command));
                0
            }
            Err(error) => {
                eprintln!("\n{} {error}", texts.pick("HubGet se nepodařilo spustit:", "HubGet could not be started:"));
                1
            }
        },
    }
}

/// Spustí HubGet s příkazem – běžící HubGet ho dostane přes single-instance, jinak se tím spustí.
fn forward(command: &CliCommand) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let json = serde_json::to_string(command).map_err(|e| e.to_string())?;
    let mut child = std::process::Command::new(exe);
    child.arg(format!("{FORWARD_PREFIX}{json}"));
    // Bez zděděných rukojetí: terminál (i roura v PowerShellu) nesmí čekat na okno HubGetu
    child.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    child.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Příkaz z parametrů spuštění (`--hubget-cli=<JSON>`).
fn command_from_args<S: AsRef<str>>(args: &[S]) -> Option<CliCommand> {
    args.iter().find_map(|arg| arg.as_ref().strip_prefix(FORWARD_PREFIX)).and_then(|json| serde_json::from_str(json).ok())
}

/// Parametry spuštění HubGetu (první spuštění i druhé přes single-instance) – příkaz z terminálu
/// uloží pro frontend a dá mu vědět. Vrací, jestli šlo o příkaz.
pub fn receive<R: Runtime, S: AsRef<str>>(app: &AppHandle<R>, args: &[S]) -> bool {
    let Some(command) = command_from_args(args) else { return false };
    if let Some(pending) = app.try_state::<PendingCommands>() {
        pending.0.lock().unwrap_or_else(|e| e.into_inner()).push(command);
    }
    let _ = app.emit(EVENT, ());
    true
}

/// Příkazy z terminálu, které ještě frontend nezpracoval.
#[tauri::command]
pub fn take_cli_commands(pending: tauri::State<'_, PendingCommands>) -> Vec<CliCommand> {
    std::mem::take(&mut *pending.0.lock().unwrap_or_else(|e| e.into_inner()))
}

fn shim_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let name = if crate::tray::is_test_build(app) { "hubget-test.cmd" } else { "hubget.cmd" };
    let local = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(local).join("Microsoft").join("WindowsApps").join(name))
}

fn shim_content() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // %* předá parametry beze změny; uvozovky kvůli mezerám v cestě (Program Files)
    Ok(format!("@echo off\r\nrem Prikaz hubget - zapsal HubGet (Nastaveni, Desktopova aplikace)\r\n\"{}\" {CLI_FLAG} %*\r\n", exe.display()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShimStatus {
    /// Název příkazu v terminálu (hubget, u testovací verze hubget-test).
    command: String,
    installed: bool,
}

/// Zapne nebo vypne příkaz `hubget` (skript ve složce WindowsApps). Zapnutý příkaz se
/// zapíše znovu, když se HubGet mezitím přesunul (cesta ve skriptu nesedí).
#[tauri::command]
pub async fn set_cli_command<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<ShimStatus, String> {
    let path = shim_path(&app).ok_or("Složka LOCALAPPDATA není nastavená")?;
    let command = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    // Cizí soubor stejného názvu (jiný program) HubGet nepřepíše ani nesmaže
    let ours = |text: &str| text.contains(CLI_FLAG) && text.to_lowercase().contains("hubget");
    let existing = std::fs::read_to_string(&path).ok();
    if let Some(text) = &existing {
        if !ours(text) {
            return Err(format!("{} už existuje a nepatří HubGetu", path.display()));
        }
    }
    if enabled {
        let content = shim_content()?;
        if existing.as_deref() != Some(content.as_str()) {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
        }
    } else if existing.is_some() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(ShimStatus { command, installed: enabled })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(text: &str) -> Vec<String> {
        text.split_whitespace().map(String::from).collect()
    }

    fn forwarded(text: &str) -> Option<CliCommand> {
        match parse(&args(text)) {
            Parsed::Forward(command) => Some(command),
            _ => None,
        }
    }

    #[test]
    fn rozbor_prikazu() {
        assert_eq!(forwarded("install vlc 7zip"), Some(CliCommand { command: "install".into(), args: args("vlc 7zip") }));
        assert_eq!(forwarded("i Git.Git").unwrap().args, args("Git.Git"));
        assert!(matches!(parse(&args("install")), Parsed::Error(_)));
        // update bez aplikací i s --all = všechny
        assert_eq!(forwarded("update").unwrap().args, Vec::<String>::new());
        assert_eq!(forwarded("upgrade --all").unwrap().args, Vec::<String>::new());
        assert_eq!(forwarded("update firefox").unwrap().args, args("firefox"));
        assert_eq!(forwarded("search visual studio code").unwrap().args, vec!["visual studio code".to_string()]);
        assert_eq!(forwarded("show vlc").unwrap().command, "show");
        assert_eq!(forwarded("").unwrap().command, "open");
        assert_eq!(forwarded("UPDATES").unwrap().command, "updates");
        assert!(matches!(parse(&args("--help")), Parsed::Help));
        assert!(matches!(parse(&args("-v")), Parsed::Version));
        assert!(matches!(parse(&args("smazat vse")), Parsed::Error(_)));
    }

    #[test]
    fn prikaz_z_parametru_spusteni() {
        let command = CliCommand { command: "install".into(), args: vec!["Notepad++.Notepad++".into()] };
        let arg = format!("{FORWARD_PREFIX}{}", serde_json::to_string(&command).unwrap());
        assert_eq!(command_from_args(&["HubGet.exe".to_string(), arg]), Some(command));
        assert_eq!(command_from_args(&["HubGet.exe", "--autostart"]), None);
        assert_eq!(command_from_args(&["HubGet.exe", "--hubget-cli=nesmysl"]), None);
    }

    #[test]
    fn napoveda_v_obou_jazycich() {
        assert!(Texts { czech: true }.usage().contains("hubget install <aplikace…>"));
        let english = Texts { czech: false }.usage();
        assert!(english.contains("hubget install <apps…>") && english.contains("hubget show <app>"));
    }
}
