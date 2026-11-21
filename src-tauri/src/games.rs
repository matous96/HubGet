//! Hry z Epic Games Launcheru. Epic hry do Programů a funkcí nezapisuje – každá nainstalovaná
//! hra má manifest `<AppDataPath>\Manifests\<guid>.item` (JSON). AppDataPath je v registru
//! Epicu, výchozí `%ProgramData%\Epic\EpicGamesLauncher\Data`. Hra je nainstalovaná, dokud
//! manifest existuje a složka hry také; rozpracované instalace, DLC a doplňky se vynechají.
//!
//! Hry ostatních obchodů (EA app, GOG, Ubisoft Connect, Battle.net) v registru jsou –
//! pozná je `ArpEntry::game_store` v arp.rs, hry ze Steamu frontend podle id.

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Default)]
#[serde(rename_all = "PascalCase", default)]
struct Manifest {
    display_name: String,
    install_location: String,
    launch_executable: String,
    app_name: String,
    catalog_namespace: String,
    catalog_item_id: String,
    app_version_string: String,
    install_size: u64,
    main_game_app_name: String,
    #[serde(rename = "bIsIncompleteInstall")]
    incomplete: bool,
}

/// Nainstalovaná hra z Epic Games.
pub struct EpicGame {
    pub app_name: String,
    pub name: String,
    pub version: String,
    pub folder: PathBuf,
    /// Spustitelný soubor hry (jen pro ikonu – spouští ji Epic, viz `launch_uri`).
    pub exe: Option<PathBuf>,
    pub size: Option<u64>,
    /// Kdy manifest vznikl (ms od 1. 1. 1970) – řazení Nově nainstalované.
    pub installed_at: Option<i64>,
    namespace: String,
    item_id: String,
}

impl EpicGame {
    /// Id ve výpisu nainstalovaných („EPIC\Fortnite“).
    pub fn package_id(&self) -> String {
        format!(r"EPIC\{}", self.app_name)
    }

    /// Spuštění přes Epic Games Launcher (přihlášení, cloudová uložení, kontrola aktualizací).
    pub fn launch_uri(&self) -> String {
        format!(
            "com.epicgames.launcher://apps/{}%3A{}%3A{}?action=launch&silent=true",
            self.namespace, self.item_id, self.app_name
        )
    }
}

/// Id z katalogu Epicu: písmena, číslice, pomlčky, podtržítka a tečky (jdou do odkazu i id balíčku).
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Verze hry: Epic u některých her ukládá popisek sestavení
/// („++Fortnite+Release-33.20-CL-38773622-Windows“ → „33.20“).
fn clean_version(version: &str) -> String {
    let version = version.trim();
    if let Some(rest) = version.split("Release-").nth(1) {
        let release = rest.split("-CL").next().unwrap_or(rest);
        if !release.is_empty() {
            return release.to_string();
        }
    }
    version.to_string()
}

/// Hra z jednoho manifestu, pokud je opravdu nainstalovaná (ne DLC ani rozpracovaná instalace).
fn from_manifest(manifest: Manifest, created: Option<i64>) -> Option<EpicGame> {
    let is_dlc = !manifest.main_game_app_name.is_empty() && manifest.main_game_app_name != manifest.app_name;
    if manifest.incomplete || is_dlc || !valid_id(&manifest.app_name) || manifest.display_name.trim().is_empty() {
        return None;
    }
    if !valid_id(&manifest.catalog_namespace) || !valid_id(&manifest.catalog_item_id) {
        return None;
    }
    let folder = PathBuf::from(manifest.install_location.trim());
    if !folder.is_absolute() || !folder.is_dir() {
        return None;
    }
    // Jen soubor uvnitř složky hry (relativní cesta bez „..“)
    let relative = Path::new(manifest.launch_executable.trim());
    let exe = (!manifest.launch_executable.trim().is_empty()
        && relative.is_relative()
        && !relative.components().any(|c| matches!(c, std::path::Component::ParentDir)))
    .then(|| folder.join(relative))
    .filter(|exe| exe.is_file());
    Some(EpicGame {
        app_name: manifest.app_name,
        name: manifest.display_name.trim().to_string(),
        version: clean_version(&manifest.app_version_string),
        folder,
        exe,
        size: (manifest.install_size > 0).then_some(manifest.install_size),
        installed_at: created,
        namespace: manifest.catalog_namespace,
        item_id: manifest.catalog_item_id,
    })
}

/// Složka s manifesty: AppDataPath z registru Epicu, jinak výchozí v ProgramData.
fn manifests_dir() -> PathBuf {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY};
        use winreg::RegKey;
        let data: Option<String> = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags(r"SOFTWARE\Epic Games\EpicGamesLauncher", KEY_READ | KEY_WOW64_32KEY)
            .and_then(|key| key.get_value("AppDataPath"))
            .ok();
        if let Some(data) = data.filter(|d| !d.trim().is_empty()) {
            return PathBuf::from(data.trim()).join("Manifests");
        }
    }
    let program_data = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into());
    PathBuf::from(program_data).join(r"Epic\EpicGamesLauncher\Data\Manifests")
}

fn created_ms(path: &Path) -> Option<i64> {
    let meta = std::fs::metadata(path).ok()?;
    let time = meta.created().or_else(|_| meta.modified()).ok()?;
    time.duration_since(std::time::UNIX_EPOCH).ok().map(|age| age.as_millis() as i64)
}

fn scan_dir(dir: &Path) -> Vec<EpicGame> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut games: Vec<EpicGame> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("item")))
        .filter_map(|path| {
            let text = std::fs::read_to_string(&path).ok()?;
            let manifest: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
            from_manifest(manifest, created_ms(&path))
        })
        .collect();
    // Stejná hra ve dvou manifestech (přesunutá knihovna) jen jednou
    games.sort_by(|a, b| a.app_name.cmp(&b.app_name).then(b.installed_at.cmp(&a.installed_at)));
    games.dedup_by(|a, b| a.app_name == b.app_name);
    games
}

/// Nainstalované hry z Epic Games.
pub fn epic_games() -> Vec<EpicGame> {
    scan_dir(&manifests_dir())
}

/// Hra podle id ve výpisu nainstalovaných („EPIC\Fortnite“).
pub fn epic_game(package_id: &str) -> Option<EpicGame> {
    let app_name = package_id.strip_prefix(r"EPIC\").filter(|name| valid_id(name))?;
    epic_games().into_iter().find(|game| game.app_name.eq_ignore_ascii_case(app_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hubget-epic-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifest(dir: &Path, file: &str, json: &str) {
        std::fs::write(dir.join(file), json).unwrap();
    }

    #[test]
    fn reads_installed_games_only() {
        let root = temp_dir("scan");
        let game = root.join("Games").join("Hades");
        std::fs::create_dir_all(game.join("x64")).unwrap();
        std::fs::write(game.join("x64").join("Hades.exe"), b"MZ").unwrap();
        let manifests = root.join("Manifests");
        std::fs::create_dir_all(&manifests).unwrap();
        let location = game.to_string_lossy().replace('\\', "\\\\");
        manifest(
            &manifests,
            "A.item",
            &format!(
                r#"{{"DisplayName":"Hades","InstallLocation":"{location}","LaunchExecutable":"x64\\Hades.exe","AppName":"Min","CatalogNamespace":"min","CatalogItemId":"fb39158a","AppVersionString":"++Hades+Release-1.38-CL-123","InstallSize":15000000000,"MainGameAppName":"Min","bIsIncompleteInstall":false}}"#
            ),
        );
        // DLC, rozpracovaná instalace, smazaná složka a podvržená cesta k EXE se vynechají
        manifest(&manifests, "B.item", &format!(r#"{{"DisplayName":"Hades DLC","InstallLocation":"{location}","AppName":"MinDlc","CatalogNamespace":"min","CatalogItemId":"aa","MainGameAppName":"Min"}}"#));
        manifest(&manifests, "C.item", &format!(r#"{{"DisplayName":"Half","InstallLocation":"{location}","AppName":"Half","CatalogNamespace":"x","CatalogItemId":"y","bIsIncompleteInstall":true}}"#));
        manifest(&manifests, "D.item", r#"{"DisplayName":"Gone","InstallLocation":"C:\\Nope\\Gone","AppName":"Gone","CatalogNamespace":"x","CatalogItemId":"y"}"#);
        manifest(&manifests, "E.item", &format!(r#"{{"DisplayName":"Evil","InstallLocation":"{location}","LaunchExecutable":"..\\..\\evil.exe","AppName":"Evil","CatalogNamespace":"x","CatalogItemId":"y"}}"#));
        manifest(&manifests, "F.item", &format!(r#"{{"DisplayName":"Bad id","InstallLocation":"{location}","AppName":"a&b","CatalogNamespace":"x","CatalogItemId":"y"}}"#));
        manifest(&manifests, "broken.item", "{");

        let games = scan_dir(&manifests);
        let names: Vec<&str> = games.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["Evil", "Hades"]);
        let hades = games.iter().find(|g| g.app_name == "Min").unwrap();
        assert_eq!(hades.package_id(), r"EPIC\Min");
        assert_eq!(hades.version, "1.38");
        assert_eq!(hades.size, Some(15_000_000_000));
        assert!(hades.exe.as_ref().is_some_and(|exe| exe.ends_with(r"x64\Hades.exe")));
        assert_eq!(hades.launch_uri(), "com.epicgames.launcher://apps/min%3Afb39158a%3AMin?action=launch&silent=true");
        assert!(games.iter().find(|g| g.app_name == "Evil").unwrap().exe.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn versions() {
        assert_eq!(clean_version("++Fortnite+Release-33.20-CL-38773622-Windows"), "33.20");
        assert_eq!(clean_version("1.0.3"), "1.0.3");
        assert_eq!(clean_version(" 2.4 "), "2.4");
    }
}
