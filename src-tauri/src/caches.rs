//! Mezipaměti správců balíčků (Přehled počítače → Uvolnit místo): stažené
//! instalátory a balíčky, které po instalaci už nejsou potřeba.
//!
//!  - WinGet: %TEMP%\WinGet (instalátory wingetu i předem stažené HubGetem),
//!  - Chocolatey: %TEMP%\chocolatey (stažené balíčky a instalátory),
//!  - Scoop: …\scoop\cache (stažené archivy) a starší verze aplikací v …\scoop\apps\<app>
//!    (všechny kromě té, na kterou ukazuje „current“) – jako `scoop cleanup * --cache`,
//!  - npm: %LOCALAPPDATA%\npm-cache\_cacache, pip: %LOCALAPPDATA%\pip\cache.
//!
//! Mažou se jen tyto složky (pevné cesty, z okna jde jen id mezipaměti); soubory, které
//! právě něco používá, zůstanou. Během operací ve frontě frontend úklid nenabízí.

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::process::background;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    id: &'static str,
    /// Složka (pro zobrazení – u Scoopu mezipaměť bez starších verzí).
    path: String,
    bytes: u64,
}

const IDS: &[&str] = &["winget", "chocolatey", "scoop", "npm", "pip"];

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

/// Složky mezipaměti podle id (u Scoopu i starší verze aplikací).
fn dirs(id: &str) -> Vec<PathBuf> {
    match id {
        "winget" => vec![std::env::temp_dir().join("WinGet")],
        "chocolatey" => vec![std::env::temp_dir().join("chocolatey")],
        "scoop" => {
            let root = crate::scoop::root();
            let mut dirs = vec![root.join("cache")];
            dirs.extend(old_scoop_versions(&root.join("apps")));
            dirs
        }
        "npm" => env_dir("LOCALAPPDATA").map(|d| d.join(r"npm-cache\_cacache")).into_iter().collect(),
        "pip" => env_dir("LOCALAPPDATA").map(|d| d.join(r"pip\cache")).into_iter().collect(),
        _ => Vec::new(),
    }
}

/// Starší verze aplikací Scoopu: složky verzí kromě té, na kterou ukazuje „current“.
fn old_scoop_versions(apps: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(apps) else { return Vec::new() };
    let mut old = Vec::new();
    for app in entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        // Scoop sám se neuklízí (jeho „current“ je jeho instalace)
        if app.file_name().is_some_and(|n| n.eq_ignore_ascii_case("scoop")) {
            continue;
        }
        let Ok(current) = std::fs::read_link(app.join("current")) else { continue };
        let current_name = current.file_name().map(|n| n.to_os_string());
        let Ok(versions) = std::fs::read_dir(&app) else { continue };
        for version in versions.flatten() {
            let name = version.file_name();
            if name.eq_ignore_ascii_case("current") || Some(&name) == current_name.as_ref() {
                continue;
            }
            if version.path().is_dir() {
                old.push(version.path());
            }
        }
    }
    old
}

/// Velikost složky (rekurzivně, bez následování odkazů).
fn size(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if meta.file_type().is_symlink() {
        return 0;
    }
    if meta.is_file() {
        return meta.len();
    }
    std::fs::read_dir(path).map(|entries| entries.flatten().map(|e| size(&e.path())).sum()).unwrap_or(0)
}

/// Velikosti mezipamětí, které na počítači jsou (prázdné a chybějící se vynechají).
#[tauri::command]
pub async fn cache_info() -> Result<Vec<CacheInfo>, String> {
    background(|| {
        Ok(IDS
            .iter()
            .filter_map(|&id| {
                let dirs = dirs(id);
                let bytes: u64 = dirs.iter().map(|d| size(d)).sum();
                (bytes > 0).then(|| CacheInfo { id, path: dirs[0].to_string_lossy().to_string(), bytes })
            })
            .collect())
    })
    .await
}

/// Smaže obsah složky (u starší verze Scoopu celou složku); soubory v použití zůstanou.
fn clear(path: &Path, remove_self: bool) {
    let Ok(entries) = std::fs::read_dir(path) else { return };
    for entry in entries.flatten() {
        let item = entry.path();
        let is_link = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
        let _ = if item.is_dir() && !is_link { std::fs::remove_dir_all(&item) } else { std::fs::remove_file(&item) };
    }
    if remove_self {
        let _ = std::fs::remove_dir(path);
    }
}

/// Vyčistí mezipaměť; vrátí, kolik bajtů se uvolnilo.
#[tauri::command]
pub async fn clean_cache(id: String) -> Result<u64, String> {
    if !IDS.contains(&id.as_str()) {
        return Err(format!("Neznámá mezipaměť: {id}"));
    }
    background(move || {
        let dirs = dirs(&id);
        let before: u64 = dirs.iter().map(|d| size(d)).sum();
        for (i, dir) in dirs.iter().enumerate() {
            // U Scoopu je první mezipaměť (obsah), další jsou celé složky starších verzí
            clear(dir, id == "scoop" && i > 0);
        }
        let after: u64 = dirs.iter().map(|d| size(d)).sum();
        Ok(before.saturating_sub(after))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starsi_verze_scoopu() {
        let root = std::env::temp_dir().join(format!("hubget-scoop-test-{}", std::process::id()));
        let app = root.join("apps").join("demo");
        for version in ["1.0", "2.0"] {
            std::fs::create_dir_all(app.join(version)).unwrap();
            std::fs::write(app.join(version).join("demo.exe"), b"x").unwrap();
        }
        // „current“ jako odkaz na 2.0 – na Windows bez práv vývojáře symlink nejde, pak test nic neověří
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(app.join("2.0"), app.join("current")).is_ok();
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(app.join("2.0"), app.join("current")).is_ok();
        if linked {
            assert_eq!(old_scoop_versions(&root.join("apps")), vec![app.join("1.0")]);
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn velikost_slozky() {
        let dir = std::env::temp_dir().join(format!("hubget-size-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("a")).unwrap();
        std::fs::write(dir.join("a").join("f"), vec![0u8; 1500]).unwrap();
        std::fs::write(dir.join("g"), vec![0u8; 500]).unwrap();
        assert_eq!(size(&dir), 2000);
        clear(&dir, false);
        assert_eq!(size(&dir), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
