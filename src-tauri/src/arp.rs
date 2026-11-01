//! Záznamy „Programy a funkce“ (registr …\CurrentVersion\Uninstall) –
//! ověření, že program, který winget hlásí jako nainstalovaný, na disku
//! opravdu je, a záložní výpis nainstalovaných, když winget použít nejde.
//!
//! Záznam v registru sám nestačí. Po neúplné odinstalaci zůstane (a winget
//! program dál vypisuje), ale spouštěcí soubory chybí – třeba Ollama: zbyly
//! knihovny, `ollama app.exe` i odinstalátor jsou pryč. Program se proto počítá
//! jako nainstalovaný, jen když existuje jeho spustitelný soubor – ne
//! odinstalátor ani aktualizátor (Squirrel nechává `Update.exe`), viz [`presence`].

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Jeden záznam programu v registru.
#[derive(Debug, Clone, Default)]
pub struct ArpEntry {
    pub key: String,
    pub user: bool,
    /// 32bitový pohled registru (HKLM\…\WOW6432Node).
    pub x86: bool,
    pub name: String,
    pub version: String,
    install_location: String,
    display_icon: String,
    uninstall: String,
    quiet_uninstall: String,
    /// V Programech a funkcích se neukazuje: součást jiného programu
    /// (SystemComponent, ParentKeyName) nebo aktualizace.
    hidden: bool,
    /// Kdy byl program nainstalován (ms od 1. 1. 1970) – viz [`install_time`].
    pub installed_at: Option<i64>,
}

/// Milisekundy od 1. 1. 1970 pro datum a čas v UTC (bez knihovny – výpočet dne podle
/// proleptického gregoriánského kalendáře, algoritmus „days from civil“).
pub fn unix_ms(year: i64, month: i64, day: i64, hour: i64, minute: i64, second: i64) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000)
}

/// Čas instalace ze záznamu: InstallDate („20261031“, jen den) a poslední zápis klíče.
/// Zápis ze stejného dne upřesní čas; jiný den (klíč později přepsal jiný program) má
/// přednost InstallDate. Bez InstallDate (NSIS, Squirrel) jen poslední zápis.
fn install_time(install_date: &str, written: Option<i64>) -> Option<i64> {
    let date = install_date.trim();
    let parsed = (date.len() == 8 && date.bytes().all(|b| b.is_ascii_digit()))
        .then(|| unix_ms(date[..4].parse().ok()?, date[4..6].parse().ok()?, date[6..].parse().ok()?, 0, 0, 0))
        .flatten();
    const DAY: i64 = 86_400_000;
    match (parsed, written) {
        // InstallDate je místní datum – den zápisu se porovná s tolerancí časového pásma
        (Some(day), Some(at)) if (at - day).abs() < 2 * DAY => Some(at.max(day)),
        (Some(day), _) => Some(day),
        (None, at) => at,
    }
}

/// Všechny záznamy: počítač (64bit i 32bit pohled) a aktuální uživatel.
#[cfg(windows)]
pub fn load() -> Vec<ArpEntry> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;

    const PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    let sources = [
        (HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY, false, false),
        (HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY, false, true),
        (HKEY_CURRENT_USER, 0, true, false),
    ];
    let mut entries = Vec::new();
    for (hive, view, user, x86) in sources {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(PATH, KEY_READ | view) else { continue };
        for key in root.enum_keys().flatten() {
            let Ok(sub) = root.open_subkey_with_flags(&key, KEY_READ | view) else { continue };
            let get = |name: &str| sub.get_value::<String, _>(name).unwrap_or_default();
            let name = get("DisplayName");
            if name.is_empty() {
                continue;
            }
            let release = get("ReleaseType").to_ascii_lowercase();
            let hidden = sub.get_value::<u32, _>("SystemComponent").unwrap_or(0) == 1
                || !get("ParentKeyName").is_empty()
                || ["update", "hotfix", "service pack"].iter().any(|kind| release.contains(kind));
            // Poslední zápis klíče (UTC) – instalátor ho zapisuje při instalaci
            let written = sub.query_info().ok().and_then(|info| {
                let t = info.get_last_write_time_system();
                unix_ms(t.wYear.into(), t.wMonth.into(), t.wDay.into(), t.wHour.into(), t.wMinute.into(), t.wSecond.into())
            });
            entries.push(ArpEntry {
                key,
                user,
                x86,
                name,
                version: get("DisplayVersion"),
                install_location: get("InstallLocation"),
                display_icon: get("DisplayIcon"),
                uninstall: get("UninstallString"),
                quiet_uninstall: get("QuietUninstallString"),
                hidden,
                installed_at: install_time(&get("InstallDate"), written),
            });
        }
    }
    entries
}

#[cfg(not(windows))]
pub fn load() -> Vec<ArpEntry> {
    Vec::new()
}

/// Výsledek ověření záznamu na disku.
#[derive(Debug, Clone, PartialEq)]
pub enum Presence {
    /// Spustitelný soubor programu (u hry ze Steamu její manifest) existuje.
    Found(PathBuf),
    /// Záznam odkazuje na soubory, ale spustitelný soubor programu chybí – pozůstatek.
    Missing,
    /// Není co ověřit (MSI bez složky instalace, odinstalace systémovým nástrojem).
    Unknown,
}

/// Nejvýš tolik složek projde ověření jednoho programu (velké hry, sady nástrojů).
const SEARCH_BUDGET: usize = 300;
/// Hloubka hledání pod složkou instalace (Epic Games: Launcher\Portal\Binaries\Win64).
const SEARCH_DEPTH: usize = 4;

/// Je program na disku? Hledá jeho spustitelný soubor:
///  1. ikona záznamu, je-li to EXE programu (ne odinstalátor),
///  2. složka instalace – je-li uvedená, rozhoduje jen ona i s podsložkami
///     (Squirrel – Discord – má aplikaci v `app-<verze>`; hra ze Steamu má
///     odinstalátor steam.exe, ten hru nedokazuje),
///  3. jinak složka ikony a odinstalátoru (NSIS, Inno Setup bez InstallLocation).
///
/// Bez spustitelného souboru je program pozůstatkem, když chybí složka
/// instalace, chybí vlastní odinstalátor (Ollama: zbyly knihovny a záznam),
/// nebo ve složce zbyl jen odinstalátor (Squirrel `Update.exe`, `unins000.exe`).
/// Záznamy, které odinstaluje systémový nástroj (MSI, ovladače NVIDIA přes
/// rundll32 se složkou instalátoru místo složky aplikace), ověřit nejde.
/// Soubory ve složce Windows (ikony MSI v C:\Windows\Installer) nic nedokazují.
pub fn presence(entry: &ArpEntry) -> Presence {
    let icon = executable_path(&entry.display_icon).filter(|path| !in_windows(path));
    if let Some(path) = icon.as_ref().filter(|path| is_app_file(path) && path.is_file()) {
        return Presence::Found(path.clone());
    }
    let uninstallers: Vec<PathBuf> = [&entry.uninstall, &entry.quiet_uninstall]
        .into_iter()
        .filter_map(|value| executable_path(value))
        .filter(|path| !in_windows(path))
        .collect();
    let uninstaller_gone = !uninstallers.is_empty() && !uninstallers.iter().any(|path| path.is_file());

    let location = PathBuf::from(expand(entry.install_location.trim().trim_matches('"')));
    if let Some(manifest) = steam_manifest(entry, &location) {
        return if manifest.is_file() { Presence::Found(manifest) } else { Presence::Missing };
    }
    if own_folder(&location) {
        if let Some(exe) = find_app_exe(&location, SEARCH_DEPTH) {
            return Presence::Found(exe);
        }
        let inside = format!("{}\\", folder_key(&location));
        let own_uninstaller = uninstallers.iter().any(|path| folder_key(path).starts_with(&inside));
        return if !location.is_dir() || uninstaller_gone || own_uninstaller { Presence::Missing } else { Presence::Unknown };
    }

    let mut folders: Vec<PathBuf> = Vec::new();
    for path in icon.iter().chain(&uninstallers) {
        if let Some(dir) = path.parent().filter(|dir| own_folder(dir)) {
            if !folders.iter().any(|known| known == dir) {
                folders.push(dir.to_path_buf());
            }
        }
    }
    if let Some(exe) = folders.iter().find_map(|dir| find_app_exe(dir, 2)) {
        return Presence::Found(exe);
    }
    // Odinstalátor bez programu, chybějící odinstalátor, nebo chybějící ikona programu
    if !uninstallers.is_empty() || icon.is_some_and(|path| !path.exists()) {
        Presence::Missing
    } else {
        Presence::Unknown
    }
}

/// Manifest hry ze Steamu (`steamapps\appmanifest_<id>.acf` vedle `steamapps\common\<hra>`).
/// Hra je nainstalovaná, dokud ho Steam má – spolehlivější než složka hry, jejíž
/// název Steam do registru občas zapíše s poškozenými znaky (emoji v názvu).
fn steam_manifest(entry: &ArpEntry, location: &Path) -> Option<PathBuf> {
    let id = entry.key.strip_prefix("Steam App ").filter(|_| is_steam_key(&entry.key))?;
    let common = location.parent().filter(|dir| dir.file_name().is_some_and(|n| n.eq_ignore_ascii_case("common")))?;
    let steamapps = common.parent().filter(|dir| dir.is_dir())?;
    Some(steamapps.join(format!("appmanifest_{id}.acf")))
}

/// Je program jen pozůstatkem po odinstalaci (záznam zůstal, spustitelný soubor ne)?
pub fn is_leftover(entry: &ArpEntry) -> bool {
    presence(entry) == Presence::Missing
}

/// Cesty, na které záznam odkazuje (složka instalace, ikona, odinstalátor) –
/// složky s nimi patří nainstalovanému programu (leftovers.rs je nenabídne ke smazání).
pub fn referenced_paths(entry: &ArpEntry) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = [&entry.display_icon, &entry.uninstall, &entry.quiet_uninstall]
        .into_iter()
        .filter_map(|value| executable_path(value))
        .collect();
    let location = expand(entry.install_location.trim().trim_matches('"'));
    if !location.is_empty() {
        paths.push(PathBuf::from(location));
    }
    paths
}

/// Programy, které ověřit nejde (systémové nástroje volané z odinstalace).
const SYSTEM_TOOLS: &[&str] = &["msiexec.exe", "rundll32.exe", "cmd.exe", "powershell.exe", "wscript.exe", "explorer.exe"];

/// Cesta ke spustitelnému souboru z hodnoty registru:
/// `"C:\…\app.exe",0`, `C:\…\Update.exe --uninstall`, `"C:\…\unins000.exe" /SILENT`.
fn executable_path(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let raw = if let Some(rest) = value.strip_prefix('"') {
        rest.split('"').next()?
    } else {
        let lower = value.to_ascii_lowercase();
        match lower.find(".exe") {
            Some(end) => &value[..end + 4],
            // DisplayIcon bez .exe („C:\…\app.ico,0“) – cesta před čárkou
            None => value.rsplit_once(',').map_or(value, |(path, _)| path),
        }
    };
    let path = PathBuf::from(expand(raw.trim()));
    let file = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    let absolute = path.to_string_lossy().as_bytes().get(1) == Some(&b':');
    (absolute && !SYSTEM_TOOLS.contains(&file.as_str())).then_some(path)
}

/// Rozbalí proměnné prostředí ve tvaru %NAZEV%.
pub fn expand(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%")));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Je soubor spustitelným souborem programu? Odinstalátory, aktualizátory
/// (Squirrel `Update.exe` zůstane i po smazání aplikace) a hlášení pádů program nedokazují.
pub fn is_app_exe(file: &str) -> bool {
    let name = file.to_ascii_lowercase();
    name.ends_with(".exe")
        && !name.starts_with("unins")
        && !name.contains("uninst")
        && !name.contains("updat")
        && !name.contains("crash")
}

fn is_app_file(path: &Path) -> bool {
    path.file_name().is_some_and(|file| is_app_exe(&file.to_string_lossy()))
}

/// První spustitelný soubor programu ve složce nebo v podsložkách (nejvýš
/// `depth` úrovní) – po úrovních, nejbližší nejdřív. Odkazy (junction) nesleduje.
pub fn find_app_exe(dir: &Path, depth: usize) -> Option<PathBuf> {
    find_exe(dir, depth, SEARCH_BUDGET, is_app_exe)
}

/// Spustitelný soubor, který vyhovuje podmínce, ve složce a podsložkách.
pub fn find_exe(dir: &Path, depth: usize, budget: usize, accept: impl Fn(&str) -> bool) -> Option<PathBuf> {
    find_file(dir, depth, budget, |path| path.file_name().is_some_and(|file| accept(&file.to_string_lossy())))
}

/// Jako [`find_exe`], jen `accept` dostane celou cestu (třeba kvůli informacím o verzi).
pub fn find_file(dir: &Path, depth: usize, mut budget: usize, accept: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let mut level = vec![dir.to_path_buf()];
    for _ in 0..=depth {
        let mut next = Vec::new();
        for folder in level {
            if budget == 0 {
                return None;
            }
            budget -= 1;
            let Ok(entries) = std::fs::read_dir(&folder) else { continue };
            for entry in entries.flatten() {
                let Ok(kind) = entry.file_type() else { continue };
                if kind.is_file() && accept(&entry.path()) {
                    return Some(entry.path());
                }
                if kind.is_dir() {
                    next.push(entry.path());
                }
            }
        }
        level = next;
    }
    None
}

/// Cesta bez koncového lomítka, malými písmeny (pro porovnání složek).
pub fn folder_key(path: &Path) -> String {
    path.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase()
}

/// Leží cesta ve složce Windows?
fn in_windows(path: &Path) -> bool {
    let Ok(root) = std::env::var("SystemRoot") else { return false };
    let path = folder_key(path);
    let root = root.trim_end_matches('\\').to_lowercase();
    path == root || path.starts_with(&format!("{root}\\"))
}

/// Je složka vlastní složkou programu? Ne kořen disku ani společná složka
/// (Program Files, AppData…) – některé instalátory do InstallLocation zapíšou právě ji.
fn own_folder(path: &Path) -> bool {
    let path = folder_key(path);
    if path.len() <= 3 {
        return false;
    }
    let var = |name: &str| std::env::var(name).ok();
    let shared = [
        var("ProgramFiles"),
        var("ProgramFiles(x86)"),
        var("ProgramW6432"),
        var("ProgramData"),
        var("APPDATA"),
        var("LOCALAPPDATA"),
        var("LOCALAPPDATA").map(|local| format!(r"{local}\Programs")),
        var("USERPROFILE"),
        var("PUBLIC"),
        var("SystemRoot"),
        var("SystemRoot").map(|root| format!(r"{root}\System32")),
    ];
    !shared.into_iter().flatten().any(|dir| folder_key(Path::new(&dir)) == path)
}

/// Klíč hry ze Steamu („Steam App <číslo>“).
fn is_steam_key(key: &str) -> bool {
    key.strip_prefix("Steam App ").is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

/// Název pro porovnání: bez závorek, verzí („version 0.40.2“, „v3.36.1“),
/// architektury a interpunkce. „Ollama version 0.40.2“ = „Ollama“,
/// „Mp3tag v3.36.1“ = „Mp3tag“, „7-Zip 25.01 (x64)“ = „7-Zip“.
pub fn name_key(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut without_parens = String::new();
    let mut depth = 0;
    for c in lower.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = (depth - 1).max(0),
            _ if depth == 0 => without_parens.push(c),
            _ => {}
        }
    }
    const NOISE: &[&str] = &["version", "verze", "x64", "x86", "arm64", "64-bit", "32-bit", "64bit", "32bit"];
    let is_version = |word: &str| {
        let digits = word.strip_prefix('v').unwrap_or(word);
        digits.contains('.') && digits.chars().all(|c| c.is_ascii_digit() || c == '.')
    };
    without_parens
        .split_whitespace()
        .filter(|word| !NOISE.contains(word) && !is_version(word))
        .flat_map(|word| word.chars().filter(|c| c.is_alphanumeric()))
        .collect()
}

impl ArpEntry {
    /// Id, pod kterým program vypisuje winget: „ARP\Machine|User\X64|X86\<klíč>“
    /// (hry ze Steamu „ARP\Machine\X64\Steam App <číslo>“).
    pub fn winget_id(&self) -> String {
        let scope = if self.user { "User" } else { "Machine" };
        let arch = if self.x86 { "X86" } else { "X64" };
        format!(r"ARP\{scope}\{arch}\{}", self.key)
    }

    /// Číslo hry ze Steamu („Steam App 1091500“ → „1091500“).
    pub fn steam_id(&self) -> Option<String> {
        is_steam_key(&self.key).then(|| self.key["Steam App ".len()..].to_string())
    }

    /// Hra z EA app (dříve Origin): EA do složky každé hry ukládá `__Installer\installerdata.xml`
    /// – platí, ať je knihovna her kdekoli (D:\Games\EA app, C:\Program Files\EA Games…).
    pub fn is_ea_game(&self) -> bool {
        let location = expand(self.install_location.trim().trim_matches('"'));
        !location.is_empty() && Path::new(&location).join("__Installer").join("installerdata.xml").is_file()
    }

    /// Existující soubor ikony programu z DisplayIcon (.ico nebo spustitelný soubor).
    pub fn icon_file(&self) -> Option<PathBuf> {
        executable_path(&self.display_icon).filter(|path| path.is_file())
    }

    /// Složky, které záznamu patří (instalace, ikona, odinstalátor) – bez společných složek a Windows.
    pub fn folders(&self) -> Vec<PathBuf> {
        referenced_paths(self)
            .into_iter()
            .map(|path| if path.extension().is_some() { path.parent().map(Path::to_path_buf).unwrap_or(path) } else { path })
            .filter(|dir| own_folder(dir) && !in_windows(dir))
            .collect()
    }
}

/// Záznamy registru s předpočítanými klíči názvů – párování stovek balíčků
/// pak nepočítá klíč každého záznamu znovu pro každý balíček.
pub struct Registry {
    entries: Vec<ArpEntry>,
    keys: Vec<String>,
}

impl Registry {
    pub fn load() -> Self {
        Self::from_entries(load())
    }

    /// Všechny záznamy (i skryté a pozůstatky).
    pub fn entries(&self) -> &[ArpEntry] {
        &self.entries
    }

    /// Záznam podle id, jaké vypisuje winget („ARP\Machine\X86\{…}“).
    pub fn by_winget_id(&self, package_id: &str) -> Option<&ArpEntry> {
        self.entries.iter().find(|entry| entry.winget_id().eq_ignore_ascii_case(package_id))
    }

    fn from_entries(entries: Vec<ArpEntry>) -> Self {
        let keys = entries.iter().map(|e| name_key(&e.name)).collect();
        Registry { entries, keys }
    }

    /// Záznamy v registru k balíčku z wingetu:
    ///  - „ARP\Machine|User\X64|X86\<klíč>“ – přímo podle klíče,
    ///  - jinak podle názvu nebo poslední části id („Ollama.Ollama“) bez verze
    ///    a závorek, se shodnou verzí (chybí-li některá, verze se neporovná),
    ///  - nenajde-li se nic, částečně: jeden název začíná druhým („Ollama“ –
    ///    „Ollama app“), ale jen při přesně stejné verzi – „Discord“ tak nesplyne
    ///    s „Discord PTB“ jen proto, že začíná stejně.
    pub fn matching(&self, package_id: &str, name: &str, version: &str) -> Vec<&ArpEntry> {
        let parts: Vec<&str> = package_id.splitn(4, '\\').collect();
        if parts.len() == 4 && parts[0].eq_ignore_ascii_case("ARP") {
            let user = parts[1].eq_ignore_ascii_case("User");
            return self.entries.iter().filter(|e| e.user == user && e.key.eq_ignore_ascii_case(parts[3])).collect();
        }
        let tail = package_id.rsplit('.').next().unwrap_or_default();
        let mut keys: Vec<String> = Vec::new();
        for key in [name_key(name), name_key(tail)] {
            if key.len() >= 2 && !keys.contains(&key) {
                keys.push(key);
            }
        }
        let same_version = |e: &ArpEntry| version.is_empty() || e.version.is_empty() || e.version == version;
        let exact: Vec<&ArpEntry> = self
            .entries
            .iter()
            .zip(&self.keys)
            .filter(|(e, k)| keys.contains(k) && same_version(e))
            .map(|(e, _)| e)
            .collect();
        if !exact.is_empty() || version.is_empty() {
            return exact;
        }
        let partial = |k: &str| {
            keys.iter().any(|key| key.len() >= 4 && k.len() >= 4 && (k.starts_with(key.as_str()) || key.starts_with(k)))
        };
        self.entries
            .iter()
            .zip(&self.keys)
            .filter(|(e, k)| e.version == version && partial(k))
            .map(|(e, _)| e)
            .collect()
    }

    /// Nainstalované programy jen podle registru (když výpis wingetu selže):
    /// záznamy, které ukazují Programy a funkce (s odinstalací, bez součástí
    /// systému a aktualizací) a nejsou pozůstatkem. Stejný program zapsaný
    /// v 64bit i 32bit pohledu se vrátí jednou.
    pub fn installed(&self) -> Vec<&ArpEntry> {
        let mut seen = HashSet::new();
        self.entries
            .iter()
            .zip(&self.keys)
            .filter(|(e, _)| !e.hidden && !e.uninstall.trim().is_empty() && !is_leftover(e))
            .filter(|(e, k)| seen.insert((k.as_str(), e.version.as_str())))
            .map(|(e, _)| e)
            .collect()
    }

    /// Složky všech záznamů (i pozůstatků) – hledání na disku je přeskočí.
    pub fn folders(&self) -> Vec<String> {
        self.entries.iter().flat_map(ArpEntry::folders).map(|dir| folder_key(&dir)).collect()
    }
}

#[cfg(test)]
impl ArpEntry {
    /// Záznam jen se složkou instalace a ikonou (pro testy jiných modulů).
    pub fn with_paths(install_location: &str, display_icon: &str) -> Self {
        ArpEntry { install_location: install_location.into(), display_icon: display_icon.into(), ..Default::default() }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Dočasná složka s prázdnými soubory (cesty relativně k ní).
    pub(crate) fn temp_tree(name: &str, files: &[&str]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("unibox-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for file in files {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"").unwrap();
        }
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn install_times() {
        assert_eq!(unix_ms(1970, 1, 1, 0, 0, 0), Some(0));
        assert_eq!(unix_ms(2026, 10, 31, 22, 25, 53), Some(1_793_485_553_000));
        assert_eq!(unix_ms(2024, 2, 29, 0, 0, 0), Some(1_709_164_800_000));
        let day = unix_ms(2026, 10, 31, 0, 0, 0);
        let written = unix_ms(2026, 10, 31, 22, 25, 53);
        // Zápis ze stejného dne upřesní čas, pozdější přepis klíče datum instalace nezmění
        assert_eq!(install_time("20261031", written), written);
        assert_eq!(install_time("20261020", written), unix_ms(2026, 10, 20, 0, 0, 0));
        assert_eq!(install_time("", written), written);
        assert_eq!(install_time("31.10.2026", None), None);
        assert_eq!(install_time("20261031", None), day);
    }

    #[test]
    fn name_keys() {
        assert_eq!(name_key("Ollama version 0.40.2"), "ollama");
        assert_eq!(name_key("Mp3tag v3.36.1"), "mp3tag");
        assert_eq!(name_key("7-Zip 25.01 (x64)"), "7zip");
        assert_eq!(name_key("Mozilla Thunderbird (cs)"), "mozillathunderbird");
        assert_eq!(name_key("Ollama"), "ollama");
    }

    #[test]
    fn executable_paths() {
        assert_eq!(executable_path(r#""C:\App\unins001.exe""#), Some(PathBuf::from(r"C:\App\unins001.exe")));
        assert_eq!(executable_path(r"C:\Users\x\Discord\Update.exe --uninstall"), Some(PathBuf::from(r"C:\Users\x\Discord\Update.exe")));
        assert_eq!(executable_path(r"C:\Program Files\Mp3tag\Mp3tag.exe,0"), Some(PathBuf::from(r"C:\Program Files\Mp3tag\Mp3tag.exe")));
        assert_eq!(executable_path("MsiExec.exe /I{C2622085-ABD2-49E5-8AB9-D3D6A642C091}"), None);
    }

    #[test]
    fn app_executables() {
        assert!(is_app_exe("Discord.exe"));
        assert!(is_app_exe("ollama app.exe"));
        assert!(!is_app_exe("unins001.exe"));
        assert!(!is_app_exe("Uninstall Foo.exe"));
        assert!(!is_app_exe("Update.exe"));
        assert!(!is_app_exe("FooUpdater.exe"));
        assert!(!is_app_exe("crashpad_handler.exe"));
        assert!(!is_app_exe("app.dll"));
    }

    #[test]
    fn leftover_detection() {
        // Odinstalátor i ikona chybí, složka neexistuje → pozůstatek
        let leftover = ArpEntry {
            name: "Ollama version 0.40.2".into(),
            display_icon: r"C:\Neexistujici HubGet\unins001.exe".into(),
            uninstall: r#""C:\Neexistujici HubGet\unins001.exe""#.into(),
            install_location: r"C:\Neexistujici HubGet\".into(),
            ..Default::default()
        };
        assert!(is_leftover(&leftover));
        // MSI bez odkazů na soubory ověřit nejde
        let msi = ArpEntry { name: "EA app".into(), uninstall: "MsiExec.exe /I{C2622085}".into(), ..Default::default() };
        assert_eq!(presence(&msi), Presence::Unknown);
        // Ikona MSI v C:\Windows\Installer program nedokazuje ani nevyvrací
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let cached_icon = ArpEntry { display_icon: format!(r"{windows}\Installer\{{X}}\icon.exe"), ..msi.clone() };
        assert_eq!(presence(&cached_icon), Presence::Unknown);
    }

    #[test]
    fn only_uninstaller_left() {
        // Ollama: zbyly knihovny a odinstalátor, spouštěcí EXE chybí → pozůstatek
        let dir = temp_tree("ollama", &["unins001.exe", r"lib\ollama\ggml.dll"]);
        let entry = ArpEntry {
            display_icon: format!(r"{}\unins001.exe", dir.display()),
            uninstall: format!(r#""{}\unins001.exe""#, dir.display()),
            install_location: format!(r"{}\", dir.display()),
            ..Default::default()
        };
        assert!(is_leftover(&entry));
        std::fs::write(dir.join("ollama app.exe"), b"").unwrap();
        assert_eq!(presence(&entry), Presence::Found(dir.join("ollama app.exe")));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn library_only_software() {
        // Ollama po přerušené odinstalaci: knihovny zbyly, odinstalátor ne → pozůstatek
        let dir = temp_tree("libs", &[r"lib\ggml.dll", "app.ico"]);
        let ollama = ArpEntry {
            install_location: dir.display().to_string(),
            uninstall: format!(r#""{}\unins001.exe""#, dir.display()),
            ..Default::default()
        };
        assert!(is_leftover(&ollama));
        // Ovladač NVIDIA: složka instalátoru bez EXE, odinstalace přes rundll32 → ověřit nejde
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let driver = ArpEntry {
            install_location: dir.display().to_string(),
            display_icon: format!(r"{}\lib\ggml.dll,0", dir.display()),
            uninstall: format!(r#""{windows}\SysWOW64\RunDll32.EXE" "{}\lib\ggml.dll",UninstallPackage X"#, dir.display()),
            ..Default::default()
        };
        assert_eq!(presence(&driver), Presence::Unknown);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn steam_games_by_manifest() {
        // Složka hry v registru s poškozenými znaky – rozhoduje manifest Steamu
        let dir = temp_tree("steam", &[r"steamapps\appmanifest_730.acf", r"steamapps\common\Game\game.exe"]);
        let game = ArpEntry {
            key: "Steam App 730".into(),
            install_location: format!(r"{}\steamapps\common\Gamă đź”ž", dir.display()),
            uninstall: r#""C:\Program Files (x86)\Steam\steam.exe" steam://uninstall/730"#.into(),
            ..Default::default()
        };
        assert!(matches!(presence(&game), Presence::Found(_)));
        std::fs::remove_file(dir.join(r"steamapps\appmanifest_730.acf")).unwrap();
        assert!(is_leftover(&game));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn squirrel_app_in_subfolder() {
        // Discord: v kořeni jen Update.exe, aplikace v app-<verze>
        let dir = temp_tree("discord", &["Update.exe", r"app-1.0.9264\Discord.exe"]);
        let entry = ArpEntry {
            install_location: dir.display().to_string(),
            uninstall: format!(r"{}\Update.exe --uninstall", dir.display()),
            ..Default::default()
        };
        assert_eq!(presence(&entry), Presence::Found(dir.join(r"app-1.0.9264\Discord.exe")));
        // Bez InstallLocation se hledá ve složce odinstalátoru
        let without_location = ArpEntry { install_location: String::new(), ..entry.clone() };
        assert!(matches!(presence(&without_location), Presence::Found(_)));
        // Smazaná aplikace, zbyl jen Update.exe → pozůstatek
        std::fs::remove_dir_all(dir.join("app-1.0.9264")).unwrap();
        assert!(is_leftover(&entry));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn shared_folder_is_no_evidence() {
        // InstallLocation = celé Program Files → rozhoduje složka odinstalátoru
        let dir = temp_tree("shared", &["unins000.exe"]);
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let entry = ArpEntry {
            install_location: format!(r"{program_files}\"),
            uninstall: format!(r#""{}\unins000.exe""#, dir.display()),
            ..Default::default()
        };
        assert!(is_leftover(&entry));
        let _ = std::fs::remove_dir_all(dir);
    }

    fn entry(key: &str, name: &str, version: &str) -> ArpEntry {
        ArpEntry { key: key.into(), name: name.into(), version: version.into(), uninstall: "msiexec /x".into(), ..Default::default() }
    }

    #[test]
    fn registry_matching() {
        let registry = Registry::from_entries(vec![
            entry("{44E8}_is1", "Ollama version 0.40.2", "0.40.2"),
            entry("Discord", "Discord", "1.0.9264"),
            entry("DiscordPTB", "Discord PTB", "1.0.1100"),
            entry("Steam App 730", "Counter-Strike 2", ""),
            ArpEntry { user: true, ..entry("Spotify", "Spotify", "1.2") },
        ]);
        let keys = |found: Vec<&ArpEntry>| found.into_iter().map(|e| e.key.clone()).collect::<Vec<_>>();
        assert_eq!(keys(registry.matching("Ollama.Ollama", "Ollama", "0.40.2")), ["{44E8}_is1"]);
        // Podle poslední části id, když se název liší
        assert_eq!(keys(registry.matching("Ollama.Ollama", "Ollama Desktop", "0.40.2")), ["{44E8}_is1"]);
        assert_eq!(keys(registry.matching("Discord.Discord", "Discord", "")), ["Discord"]);
        assert_eq!(keys(registry.matching(r"ARP\User\X64\Spotify", "Spotify", "")), ["Spotify"]);
        assert_eq!(keys(registry.matching(r"ARP\Machine\X64\Steam App 730", "Counter-Strike 2", "")), ["Steam App 730"]);
        // Částečná shoda jen se stejnou verzí
        assert_eq!(keys(registry.matching("Contoso.DiscordTool", "Discord Tool", "1.0.9264")), ["Discord"]);
        assert!(registry.matching("Contoso.DiscordTool", "Discord Tool", "2.0").is_empty());
    }

    #[test]
    fn winget_ids() {
        assert_eq!(entry("Discord", "Discord", "").winget_id(), r"ARP\Machine\X64\Discord");
        assert_eq!(ArpEntry { user: true, ..entry("Discord", "Discord", "") }.winget_id(), r"ARP\User\X64\Discord");
        assert_eq!(ArpEntry { x86: true, ..entry("7-Zip", "7-Zip", "") }.winget_id(), r"ARP\Machine\X86\7-Zip");
        assert_eq!(entry("Steam App 730", "Counter-Strike 2", "").winget_id(), r"ARP\Machine\X64\Steam App 730");
    }

    #[test]
    fn registry_installed_list() {
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let registry = Registry::from_entries(vec![
            entry("{A}", "Microsoft Visual C++ 2022 X64 Runtime", "14.40"),
            ArpEntry { hidden: true, ..entry("{B}", "Součást", "1.0") },
            ArpEntry { x86: true, ..entry("{A}", "Microsoft Visual C++ 2022 X64 Runtime", "14.40") },
            ArpEntry { uninstall: String::new(), ..entry("{C}", "Bez odinstalace", "1.0") },
            ArpEntry { uninstall: format!(r"{windows}\regedit.exe /x"), ..entry("Reg", "Editor", "1.0") },
            ArpEntry {
                install_location: r"C:\Neexistujici HubGet".into(),
                uninstall: r#""C:\Neexistujici HubGet\unins000.exe""#.into(),
                ..entry("Gone", "Pozůstatek", "1.0")
            },
        ]);
        let names: Vec<&str> = registry.installed().into_iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Microsoft Visual C++ 2022 X64 Runtime", "Editor"]);
    }

    /// Přehled záznamů tohoto počítače: `cargo test arp::tests::survey -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn survey() {
        let started = std::time::Instant::now();
        let entries = load();
        let mut missing = Vec::new();
        let mut unknown = 0;
        for entry in entries.iter().filter(|e| !e.hidden) {
            match presence(entry) {
                Presence::Missing => missing.push(format!("{} [{}]", entry.name, entry.winget_id())),
                Presence::Unknown => unknown += 1,
                Presence::Found(_) => {}
            }
        }
        println!("{} záznamů, neověřitelných {unknown}, pozůstatků {}: {missing:#?}", entries.len(), missing.len());
        println!("záložní výpis: {} programů za {:?}", Registry::load().installed().len(), started.elapsed());
    }
}
