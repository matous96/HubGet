//! Programy nalezené jen podle souborů na disku – poslední úroveň detekce
//! nainstalovaných aplikací (po wingetu a registru).
//!
//! Některé programy záznam v registru nemají: rozbalené do Program Files,
//! instalace do profilu uživatele bez záznamu, záznam smazaný „čističem“.
//! Projdou se složky, kam se programy instalují – Program Files,
//! %LocalAppData%\Programs, %LocalAppData% a %AppData% – a za program se počítá
//! složka, v níž (nebo nejvýš o dvě úrovně níž) je EXE pojmenované stejně jako
//! složka: „Discord\app-1.0.9264\Discord.exe“, „Telegram Desktop\Telegram.exe“,
//! „Mozilla Firefox\firefox.exe“. Datové složky aplikací (bez EXE) a sdílené
//! složky výrobců („Microsoft“) programem nejsou. Složka výrobce v Program Files
//! se projde o úroveň hlouběji („VideoLAN\VLC\vlc.exe“); v AppData ne – tam
//! bývají o úroveň níž nástroje přibalené k jiné aplikaci (UniGetUI\Chocolatey).
//!
//! Složka s EXE sama nestačí – některé odinstalátory nechají celý program na
//! disku (EA app). Program se počítá, jen když na něj míří zástupce v nabídce
//! Start ([`with_shortcut`]): ten instalace vytvoří a odinstalace odstraní.
//!
//! Plocha je výjimka: Tor Browser se rozbalí do „Plocha\Tor Browser“ bez záznamu
//! v registru i bez zástupce v nabídce Start (odinstalace = smazání složky)
//! a jeho EXE je „Browser\firefox.exe“. Na ploše se proto program pozná i podle
//! popisu EXE (ProductName / FileDescription „Tor Browser“) a zástupce není potřeba.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::arp::{self, find_exe, folder_key, name_key};
use crate::version_info;

/// Složka programu na disku.
#[derive(Debug, Clone, PartialEq)]
pub struct DiskApp {
    /// Název složky („Discord“).
    pub name: String,
    pub folder: PathBuf,
    /// Program rozbalený na ploše – nemusí mít zástupce v nabídce Start.
    pub desktop: bool,
}

/// Složky, které programy nejsou a jejichž procházení by stálo čas (dočasné soubory, balíčky Storu…).
const SKIP: &[&str] = &[
    "temp", "tmp", "packages", "microsoft", "windowsapps", "modifiablewindowsapps", "common files", "programs",
    "crashdumps", "d3dscache", "package cache", "windows defender", "windows nt", "windowspowershell",
];

/// Složka výrobce se projde, jen když má nejvýš tolik podsložek (VideoLAN: VLC).
const VENDOR_LIMIT: usize = 16;
/// Kolik složek nejvýš projde hledání EXE v jedné složce programu.
const FOLDER_BUDGET: usize = 40;

/// Složka, do které se programy instalují; `vendors` = složky výrobců projít o úroveň hlouběji,
/// `desktop` = plocha (program i podle popisu EXE, bez zástupce v nabídce Start).
struct Base {
    dir: PathBuf,
    vendors: bool,
    desktop: bool,
}

fn bases() -> Vec<Base> {
    let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let local = var("LOCALAPPDATA");
    let mut candidates = vec![
        (var("ProgramW6432").or_else(|| var("ProgramFiles")), true, false),
        (var("ProgramFiles(x86)"), true, false),
        (local.as_ref().map(|dir| dir.join("Programs")), false, false),
        (local, false, false),
        (var("APPDATA"), false, false),
    ];
    candidates.extend(desktops().into_iter().map(|dir| (Some(dir), false, true)));
    let mut bases: Vec<Base> = Vec::new();
    for (dir, vendors, desktop) in candidates {
        let Some(dir) = dir else { continue };
        if !bases.iter().any(|known| folder_key(&known.dir) == folder_key(&dir)) {
            bases.push(Base { dir, vendors, desktop });
        }
    }
    bases
}

/// Plochy: uživatelova – i přesměrovaná do OneDrive (User Shell Folders), kam ji
/// instalátory zapisují – a veřejná.
fn desktops() -> Vec<PathBuf> {
    let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let mut dirs = Vec::new();
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        let shell = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders");
        if let Ok(desktop) = shell.and_then(|key| key.get_value::<String, _>("Desktop")) {
            dirs.push(PathBuf::from(arp::expand(&desktop)));
        }
    }
    dirs.extend(var("USERPROFILE").map(|dir| dir.join("Desktop")));
    dirs.extend(var("PUBLIC").map(|dir| dir.join("Desktop")));
    dirs
}

/// Odpovídá název EXE názvu složky? Stejný klíč, nebo jeden začíná či končí
/// druhým (aspoň 4 znaky): „Telegram Desktop“ – „Telegram“, „Mozilla Firefox“ – „firefox“.
fn named_like(exe_key: &str, folder_key: &str) -> bool {
    if exe_key.is_empty() || folder_key.is_empty() {
        return false;
    }
    if exe_key == folder_key {
        return true;
    }
    let (short, long) = if exe_key.len() < folder_key.len() { (exe_key, folder_key) } else { (folder_key, exe_key) };
    short.len() >= 4 && (long.starts_with(short) || long.ends_with(short))
}

/// EXE programu pojmenované jako složka (ve složce nebo nejvýš o dvě úrovně níž).
fn program_exe(folder: &Path, key: &str) -> Option<PathBuf> {
    find_exe(folder, 2, FOLDER_BUDGET, |file| {
        arp::is_app_exe(file) && named_like(&name_key(file.rsplit_once('.').map_or(file, |(stem, _)| stem)), key)
    })
}

/// EXE, které se v informacích o verzi představuje názvem složky
/// („Tor Browser\Browser\firefox.exe“ – ProductName „Tor Browser“).
fn described_exe(folder: &Path, key: &str) -> Option<PathBuf> {
    arp::find_file(folder, 2, FOLDER_BUDGET, |path| {
        path.file_name().is_some_and(|file| arp::is_app_exe(&file.to_string_lossy()))
            && version_info::fields(path, &["ProductName", "FileDescription"]).into_iter().flatten().any(|text| name_key(&text) == key)
    })
}

/// Základní složka, ve které hledání na disku `folder` najde (přímo v ní, nebo
/// u složky výrobce o úroveň níž). Cesty s „..“ ani jiné složky nevrátí.
fn base_of(folder: &Path) -> Option<Base> {
    if folder.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return None;
    }
    let parent = folder.parent()?;
    let grand = parent.parent();
    bases().into_iter().find(|base| {
        folder_key(&base.dir) == folder_key(parent) || (base.vendors && grand.is_some_and(|dir| folder_key(&base.dir) == folder_key(dir)))
    })
}

/// EXE programu nalezeného jen na disku (id „DISK\<složka>“) – jen pro složku,
/// kterou by našlo hledání ([`scan`]); pro jinou cestu od frontendu nic.
pub fn program_exe_of(folder: &Path) -> Option<PathBuf> {
    let base = base_of(folder)?;
    let key = name_key(&folder.file_name()?.to_string_lossy());
    program_exe(folder, &key).or_else(|| if base.desktop { described_exe(folder, &key) } else { None })
}

/// EXE programu ve složce: pojmenované jako program, nebo s jeho názvem v informacích o verzi.
pub fn named_exe(folder: &Path, key: &str) -> Option<PathBuf> {
    program_exe(folder, key).or_else(|| described_exe(folder, key))
}

/// Složka programu rozbaleného na ploše podle názvu aplikace („Tor Browser“).
pub fn portable_folder(name: &str) -> Option<PathBuf> {
    let key = name_key(name);
    if key.len() < 2 {
        return None;
    }
    bases()
        .into_iter()
        .filter(|base| base.desktop)
        .flat_map(|base| subfolders(&base.dir))
        .find(|folder| folder.file_name().is_some_and(|n| name_key(&n.to_string_lossy()) == key) && named_exe(folder, &key).is_some())
}

/// Verze programu rozbaleného na ploše: Tor Browser ji má v `Browser\tbb_version.json`
/// (EXE nese verzi Firefoxu, z něhož vychází), jinak verze produktu z EXE.
pub fn portable_version(folder: &Path) -> String {
    let tor = std::fs::read_to_string(folder.join(r"Browser\tbb_version.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| json.get("version").and_then(|v| v.as_str()).map(str::to_string));
    tor.or_else(|| {
        let exe = program_exe_of(folder)?;
        version_info::fields(&exe, &["ProductVersion"]).remove(0)
    })
    .map(|version| version.trim().to_string())
    .unwrap_or_default()
}

/// Podsložky (bez odkazů – junction).
fn subfolders(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect()
}

/// Programy ve složkách `bases`. Složky, které `covered` (patří programu
/// z registru, i s podsložkami), se neprocházejí; programy, jejichž klíč
/// názvu je `known` (nalezené wingetem / v registru), se vynechají.
fn scan_in(bases: &[Base], covered: impl Fn(&Path) -> bool, known: impl Fn(&str) -> bool) -> Vec<DiskApp> {
    let mut apps = Vec::new();
    let mut visited = HashSet::new();
    // Je složka program? (Nový program přidá do seznamu.)
    let mut program = |folder: &Path, desktop: bool, apps: &mut Vec<DiskApp>| -> bool {
        let name = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let key = name_key(&name);
        if key.len() < 2 || !visited.insert(folder_key(folder)) {
            return false;
        }
        if program_exe(folder, &key).is_none() && !(desktop && described_exe(folder, &key).is_some()) {
            return false;
        }
        if !known(&key) {
            apps.push(DiskApp { name, folder: folder.to_path_buf(), desktop });
        }
        true
    };
    for base in bases {
        for folder in subfolders(&base.dir) {
            let lower = folder.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if SKIP.contains(&lower.as_str()) || lower.starts_with('.') || lower.starts_with("windows") || covered(&folder) {
                continue;
            }
            if program(&folder, base.desktop, &mut apps) || !base.vendors {
                continue;
            }
            // Složka výrobce („VideoLAN“) – programy o úroveň níž
            let nested = subfolders(&folder);
            if nested.len() <= VENDOR_LIMIT {
                for inner in nested.iter().filter(|inner| !covered(inner)) {
                    program(inner, false, &mut apps);
                }
            }
        }
    }
    apps
}

/// Programy na disku, které nezná winget ani registr: vynechá složky, na které
/// odkazuje některý záznam registru (i pozůstatek – jeho složka už EXE nemá),
/// a programy se stejným klíčem názvu jako `known` (už nalezené).
pub fn scan(registry_folders: &[String], known: &HashSet<String>) -> Vec<DiskApp> {
    let covered = |folder: &Path| {
        let folder = folder_key(folder);
        registry_folders.iter().any(|dir| {
            dir == &folder || dir.starts_with(&format!("{folder}\\")) || folder.starts_with(&format!("{dir}\\"))
        })
    };
    scan_in(&bases(), covered, |key| known.contains(key))
}

/// Jen programy, do jejichž složky míří některý ze spouštěcích souborů
/// nabídky Start (`targets`, cesty malými písmeny – apps::launch_targets);
/// programy na ploše zůstanou i bez něj.
pub fn with_shortcut(apps: Vec<DiskApp>, targets: &[String]) -> Vec<DiskApp> {
    apps.into_iter()
        .filter(|app| {
            let inside = format!("{}\\", folder_key(&app.folder));
            app.desktop || targets.iter().any(|target| target.starts_with(&inside))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arp::tests::temp_tree;

    #[test]
    fn exe_names() {
        assert!(named_like("discord", "discord"));
        assert!(named_like("telegram", "telegramdesktop"));
        assert!(named_like("firefox", "mozillafirefox"));
        assert!(named_like("ollamaapp", "ollama"));
        assert!(!named_like("obs64", "obsstudio"));
        assert!(!named_like("onedrive", "microsoft"));
        // Krátké názvy jen přesně
        assert!(!named_like("vlc", "vlcplayer"));
        assert!(named_like("vlc", "vlc"));
    }

    #[test]
    fn finds_programs() {
        let base = temp_tree(
            "disk",
            &[
                r"Discord\Update.exe",
                r"Discord\app-1.0.9264\Discord.exe",
                r"Telegram Desktop\Telegram.exe",
                r"VideoLAN\VLC\vlc.exe",
                r"Code\User\settings.json",
                r"Leftover\Update.exe",
                r"Microsoft\Teams\Teams.exe",
                r"Known\Known.exe",
                r"Registered\Tool\Tool.exe",
            ],
        );
        let registered = base.join("Registered");
        let covered = |folder: &Path| folder.starts_with(&registered);
        let names = |vendors: bool| {
            let apps = scan_in(&[Base { dir: base.clone(), vendors, desktop: false }], covered, |key| key == "known");
            let mut names: Vec<String> = apps.into_iter().map(|app| app.name).collect();
            names.sort();
            names
        };
        // Program Files: složka výrobce o úroveň hlouběji
        assert_eq!(names(true), ["Discord", "Telegram Desktop", "VLC"]);
        // AppData: jen přímé podsložky
        assert_eq!(names(false), ["Discord", "Telegram Desktop"]);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn requires_start_menu_shortcut() {
        let app = |folder: &str, desktop: bool| DiskApp { name: String::new(), folder: PathBuf::from(folder), desktop };
        let apps = vec![
            app(r"C:\Program Files\Electronic Arts\EA Desktop", false),
            app(r"C:\Users\X\AppData\Local\PCHealthCheck", false),
            app(r"C:\Users\X\Desktop\Tor Browser", true),
        ];
        let targets = [r"c:\users\x\appdata\local\pchealthcheck\pchealthcheck.exe".to_string()];
        let kept = with_shortcut(apps, &targets);
        assert_eq!(kept, [app(r"C:\Users\X\AppData\Local\PCHealthCheck", false), app(r"C:\Users\X\Desktop\Tor Browser", true)]);
    }

    /// Na ploše se program pozná i podle popisu EXE (Tor Browser: „Browser\firefox.exe“
    /// s ProductName „Tor Browser“) – tady Poznámkový blok přejmenovaný v jiné složce.
    #[cfg(windows)]
    #[test]
    fn desktop_programs_by_description() {
        let notepad = PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())).join(r"System32\notepad.exe");
        let base = temp_tree("desktop", &[r"Portable Tool\PortableTool.exe"]);
        // Popis kopie (bez souboru .mui vedle ní bývá jiný než u originálu)
        let staged = base.join("staged");
        std::fs::create_dir_all(staged.join("Browser")).unwrap();
        std::fs::copy(&notepad, staged.join(r"Browser\firefox.exe")).unwrap();
        let Some(description) = version_info::fields(&staged.join(r"Browser\firefox.exe"), &["FileDescription"]).remove(0) else {
            let _ = std::fs::remove_dir_all(base);
            return;
        };
        std::fs::rename(&staged, base.join(&description)).unwrap();
        let names = |desktop: bool| {
            let mut names: Vec<String> =
                scan_in(&[Base { dir: base.clone(), vendors: false, desktop }], |_| false, |_| false).into_iter().map(|app| app.name).collect();
            names.sort();
            names
        };
        let mut expected = vec![description.clone(), "Portable Tool".to_string()];
        expected.sort();
        assert_eq!(names(true), expected);
        // Mimo plochu jen EXE pojmenované jako složka
        assert_eq!(names(false), ["Portable Tool"]);
        let _ = std::fs::remove_dir_all(base);
    }

    /// Programy nalezené jen na disku na tomto počítači:
    /// `cargo test disk::tests::survey -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn survey() {
        let started = std::time::Instant::now();
        let registry = arp::Registry::load();
        let known: HashSet<String> = registry.installed().iter().map(|e| name_key(&e.name)).collect();
        let apps = scan(&registry.folders(), &known);
        println!("{} programů jen na disku za {:?}: {apps:#?}", apps.len(), started.elapsed());
    }
}
