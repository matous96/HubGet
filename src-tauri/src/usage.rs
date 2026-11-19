//! Kdy byla aplikace naposledy spuštěna – pro „Nepoužívané aplikace“ (Nainstalované).
//!
//! Zdroj je záznam Windows UserAssist (HKCU\…\Explorer\UserAssist\{GUID}\Count):
//! Průzkumník si u každého uživatele pamatuje programy a zástupce spuštěné
//! z nabídky Start, hlavního panelu, plochy nebo Průzkumníka – názvy v ROT13, čas
//! posledního spuštění jako FILETIME. Bez práv správce a bez sledování na pozadí.
//!
//! Aplikace se spouštějí i jinak (po přihlášení, z jiného programu), proto se jako
//! používaná počítá i ta, která právě běží nebo se spouští po přihlášení (klíče Run).
//! Rozhodnutí, co je „nepoužívané“, dělá frontend – backend jen hlásí údaje.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::process::background;
use crate::{arp, leftovers, running};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    package_id: String,
    name: String,
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    /// Poslední spuštění podle UserAssist (ms od 1. 1. 1970), None = žádný záznam.
    last_used: Option<i64>,
    /// Právě běží, spouští se po přihlášení, nebo má rozšíření kontextové nabídky Průzkumníka –
    /// používá se, i když ji uživatel nespouští ručně.
    in_use: bool,
    /// Spouští se po přihlášení (klíče Run) – s dlouho prošlým `last_used` se spouští zbytečně.
    autostart: bool,
    /// Má zástupce v nabídce Start nebo záznam spuštění – je to aplikace, kterou jde spustit
    /// (ne knihovna, ovladač ani runtime – ty se do nepoužívaných nepočítají).
    launchable: bool,
    /// Velikost na disku podle instalátoru (bajty), None = neuvedl.
    size: Option<u64>,
}

/// Záznamy UserAssist: spustitelný soubor (cesta malými písmeny), zástupce (klíč názvu)
/// nebo aplikace ze Storu (AUMID malými písmeny) a čas posledního spuštění.
#[derive(Default)]
struct Launches {
    programs: Vec<(String, i64)>,
    shortcuts: Vec<(String, i64)>,
    store_apps: Vec<(String, i64)>,
}

/// ROT13 (názvy hodnot UserAssist).
fn rot13(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'a'..='z' => (((c as u8 - b'a') + 13) % 26 + b'a') as char,
            'A'..='Z' => (((c as u8 - b'A') + 13) % 26 + b'A') as char,
            _ => c,
        })
        .collect()
}

/// FILETIME (100 ns od 1. 1. 1601) → ms od 1. 1. 1970; nula = nikdy.
fn filetime_ms(filetime: u64) -> Option<i64> {
    (filetime > 0).then(|| (filetime / 10_000) as i64 - 11_644_473_600_000)
}

/// Čas posledního spuštění z dat hodnoty UserAssist (Windows 7+: 72 bajtů, FILETIME na pozici 60).
fn last_run(data: &[u8]) -> Option<i64> {
    let bytes: [u8; 8] = data.get(60..68)?.try_into().ok()?;
    filetime_ms(u64::from_le_bytes(bytes))
}

/// Známé složky, kterými UserAssist začíná cesty („{6D809377-…}\VideoLAN\VLC\vlc.exe“).
fn known_folder(guid: &str) -> Option<PathBuf> {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let root = || env("SystemRoot").unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    Some(match guid.to_ascii_uppercase().as_str() {
        "{6D809377-6AF0-444B-8957-A3773F02200E}" => env("ProgramW6432").or_else(|| env("ProgramFiles"))?,
        "{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}" => env("ProgramFiles(x86)")?,
        "{F38BF404-1D43-42F2-9305-67DE0B28FC23}" => root(),
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}" => root().join("System32"),
        "{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}" => root().join("SysWOW64"),
        "{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}" => env("LOCALAPPDATA")?,
        "{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}" => env("APPDATA")?,
        "{62AB5D82-FDC1-4DC3-A9DD-070D1D495D97}" => env("ProgramData")?,
        "{A77F5D77-2E2B-44C3-A6A2-ABA601054A51}" => env("APPDATA")?.join(r"Microsoft\Windows\Start Menu\Programs"),
        "{0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8}" => env("ProgramData")?.join(r"Microsoft\Windows\Start Menu\Programs"),
        "{9E3995AB-1F9C-4F13-B827-48B24B6C7174}" => env("APPDATA")?.join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned"),
        "{5E6C858F-0E22-4760-9AFE-EA3317B67173}" => env("USERPROFILE")?,
        _ => return None,
    })
}

/// Název ze záznamu UserAssist → cesta (známá složka nahrazená skutečnou).
fn resolve(name: &str) -> String {
    if let Some(rest) = name.strip_prefix('{') {
        if let Some(end) = rest.find('}') {
            if let Some(folder) = known_folder(&name[..end + 2]) {
                let tail = rest[end + 1..].trim_start_matches('\\');
                return folder.join(tail).to_string_lossy().to_string();
            }
        }
    }
    name.to_string()
}

/// Zařadí záznam UserAssist: zástupce, program, nebo aplikace ze Storu (AUMID „Rodina!App“).
fn classify(launches: &mut Launches, name: &str, at: i64) {
    let path = resolve(name);
    let lower = path.to_lowercase();
    if lower.ends_with(".lnk") {
        let stem = Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        launches.shortcuts.push((arp::name_key(&stem), at));
    } else if lower.ends_with(".exe") {
        launches.programs.push((lower, at));
    } else if lower.contains('!') && !lower.contains('\\') {
        launches.store_apps.push((lower, at));
    }
}

#[cfg(windows)]
fn read_user_assist() -> Launches {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;
    let mut launches = Launches::default();
    let Ok(root) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist", KEY_READ) else {
        return launches;
    };
    for guid in root.enum_keys().flatten() {
        let Ok(count) = root.open_subkey_with_flags(format!(r"{guid}\Count"), KEY_READ) else { continue };
        for (name, value) in count.enum_values().flatten() {
            if let Some(at) = last_run(&value.bytes) {
                classify(&mut launches, &rot13(&name), at);
            }
        }
    }
    launches
}

#[cfg(not(windows))]
fn read_user_assist() -> Launches {
    Launches::default()
}

/// Klíče názvů zástupců v nabídce Start (uživatele i společné, do hloubky 3).
fn start_menu_shortcuts() -> HashSet<String> {
    let mut keys = HashSet::new();
    let roots = [std::env::var_os("APPDATA").map(PathBuf::from), std::env::var_os("ProgramData").map(PathBuf::from)];
    for root in roots.into_iter().flatten() {
        walk(&root.join(r"Microsoft\Windows\Start Menu\Programs"), 0, &mut keys);
    }
    keys
}

fn walk(dir: &Path, depth: u32, keys: &mut HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && depth < 3 {
            walk(&path, depth + 1, keys);
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
            if let Some(stem) = path.file_stem() {
                keys.insert(arp::name_key(&stem.to_string_lossy()));
            }
        }
    }
}

/// Příkazy programů spouštěných po přihlášení (klíče Run uživatele i počítače), malými písmeny.
/// Bez vypnutých (Správce úloh, Po spuštění v HubGetu) – ty v klíči zůstávají.
#[cfg(windows)]
fn autostart_commands() -> Vec<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;
    let mut commands = Vec::new();
    let path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let views = [
        (HKEY_CURRENT_USER, KEY_READ, false, false),
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_64KEY, true, false),
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY, true, true),
    ];
    for (hive, flags, machine, wow) in views {
        if let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(path, flags) {
            for (name, value) in key.enum_values().flatten() {
                if crate::startup::run_value_enabled(machine, wow, &name) {
                    commands.push(value.to_string().to_lowercase());
                }
            }
        }
    }
    commands
}

#[cfg(not(windows))]
fn autostart_commands() -> Vec<String> {
    Vec::new()
}

/// Knihovny rozšíření kontextové nabídky Průzkumníka (WinRAR, 7-Zip, Mp3tag…), malými
/// písmeny – aplikace se používá přes pravé tlačítko, aniž by se spouštěl její program.
#[cfg(windows)]
fn shell_extension_dlls() -> Vec<String> {
    use winreg::enums::{HKEY_CLASSES_ROOT, KEY_READ};
    use winreg::RegKey;
    let classes = RegKey::predef(HKEY_CLASSES_ROOT);
    let mut dlls = Vec::new();
    for parent in [r"*\shellex\ContextMenuHandlers", r"Directory\shellex\ContextMenuHandlers", r"Folder\shellex\ContextMenuHandlers", r"AllFilesystemObjects\shellex\ContextMenuHandlers", r"Directory\Background\shellex\ContextMenuHandlers"] {
        let Ok(handlers) = classes.open_subkey_with_flags(parent, KEY_READ) else { continue };
        for name in handlers.enum_keys().flatten() {
            // CLSID je výchozí hodnota klíče, nebo přímo jeho název
            let clsid = handlers
                .open_subkey_with_flags(&name, KEY_READ)
                .ok()
                .and_then(|key| key.get_value::<String, _>("").ok())
                .filter(|v| v.starts_with('{'))
                .unwrap_or(name);
            if let Ok(server) = classes.open_subkey_with_flags(format!(r"CLSID\{clsid}\InprocServer32"), KEY_READ) {
                if let Ok(path) = server.get_value::<String, _>("") {
                    dlls.push(path.trim_matches('"').to_lowercase());
                }
            }
        }
    }
    dlls
}

#[cfg(not(windows))]
fn shell_extension_dlls() -> Vec<String> {
    Vec::new()
}

/// Rodina balíčku MSIX z id ve výpisu wingetu („MSIX\Microsoft.WindowsTerminal_1.21…_x64__8wekyb3d8bbwe“
/// → „microsoft.windowsterminal_8wekyb3d8bbwe“) – začátek AUMID aplikace ze Storu.
fn msix_family(package_id: &str) -> Option<String> {
    let full = package_id.strip_prefix("MSIX\\")?;
    let name = full.split('_').next()?;
    let publisher = full.rsplit("__").next().filter(|p| !p.is_empty() && *p != full)?;
    Some(format!("{name}_{publisher}").to_lowercase())
}

/// Využití aplikací (pořadí jako `apps`).
#[tauri::command]
pub async fn app_last_used(apps: Vec<AppRef>) -> Result<Vec<AppUsage>, String> {
    background(move || {
        let launches = read_user_assist();
        let shortcuts = start_menu_shortcuts();
        let autostart = autostart_commands();
        let extensions = shell_extension_dlls();
        let running: Vec<String> = running::processes().into_iter().map(|p| p.path.to_lowercase()).collect();
        let registry = arp::Registry::load();
        Ok(apps
            .iter()
            .map(|app| {
                let matched = registry.matching(&app.package_id, &app.name, "");
                let size = matched.iter().filter_map(|entry| entry.estimated_size).max();
                let dirs: Vec<String> = matched
                    .into_iter()
                    .flat_map(running::install_dirs)
                    .map(|d| format!("{}\\", d.to_string_lossy().trim_end_matches('\\').to_lowercase()))
                    .collect();
                let (keys, _) = leftovers::name_keys(&app.name, &app.package_id);
                let in_dirs = |path: &str| dirs.iter().any(|dir| path.starts_with(dir.as_str()));
                let family = msix_family(&app.package_id);
                let last_used = launches
                    .programs
                    .iter()
                    .filter(|(path, _)| in_dirs(path) || running::named_like_app(path, &keys))
                    .chain(launches.shortcuts.iter().filter(|(key, _)| keys.contains(key)))
                    .chain(launches.store_apps.iter().filter(|(aumid, _)| family.as_deref().is_some_and(|f| aumid.starts_with(f))))
                    .map(|&(_, at)| at)
                    .max();
                let starts_with_windows = autostart.iter().any(|command| dirs.iter().any(|dir| command.contains(dir.as_str())));
                let in_use = running.iter().any(|path| in_dirs(path)) || starts_with_windows || extensions.iter().any(|dll| in_dirs(dll));
                let launchable = last_used.is_some() || keys.iter().any(|key| shortcuts.contains(key));
                AppUsage { last_used, in_use, autostart: starts_with_windows, launchable, size }
            })
            .collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn userassist_nazvy_a_casy() {
        assert_eq!(rot13("Zvpebfbsg.JvaqbjfGrezvany_8jrxlo3q8oojr!Ncc"), "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App");
        assert_eq!(rot13(&rot13("C:\\Program Files\\VLC\\vlc.exe")), "C:\\Program Files\\VLC\\vlc.exe");
        // 1. 1. 2026 00:00 UTC
        assert_eq!(filetime_ms(134_116_992_000_000_000), Some(1_767_225_600_000));
        assert_eq!(filetime_ms(0), None);
        let mut data = vec![0u8; 72];
        data[60..68].copy_from_slice(&134_116_992_000_000_000u64.to_le_bytes());
        assert_eq!(last_run(&data), Some(1_767_225_600_000));
        assert_eq!(last_run(&[0u8; 16]), None);
    }

    #[test]
    fn rodina_msix() {
        assert_eq!(
            msix_family(r"MSIX\Microsoft.WindowsTerminal_1.21.2361.0_x64__8wekyb3d8bbwe").as_deref(),
            Some("microsoft.windowsterminal_8wekyb3d8bbwe")
        );
        assert_eq!(msix_family("Mozilla.Firefox"), None);
    }

    #[test]
    fn trideni_zaznamu() {
        let mut launches = Launches::default();
        classify(&mut launches, "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", 1);
        classify(&mut launches, r"{0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8}\VLC media player.lnk", 2);
        classify(&mut launches, r"C:\Tools\app.exe", 3);
        assert_eq!(launches.store_apps, vec![("microsoft.windowsterminal_8wekyb3d8bbwe!app".to_string(), 1)]);
        assert_eq!(launches.shortcuts, vec![(arp::name_key("VLC media player"), 2)]);
        assert_eq!(launches.programs, vec![(r"c:\tools\app.exe".to_string(), 3)]);
    }
}
