//! Záloha nastavení aplikace před aktualizací (Nastavení → Aktualizace balíčků):
//! složky aplikace v AppData (Roaming a Local – podle názvu a vydavatele jako u zbytků
//! po odinstalaci, leftovers.rs) se před aktualizací zkopírují do zálohy HubGetu. Když
//! pak uživatel aktualizaci vrátí (RollbackDialog), vrátí se i nastavení z doby před ní –
//! nová verze ho mohla převést do formátu, kterému stará nerozumí.
//!
//! Pro každou aplikaci se drží jen poslední záloha. Mezipaměti (Cache, GPUCache, logy…)
//! se nekopírují; aplikace s nastavením nad [`LIMIT`] (profil prohlížeče) se nezálohuje.
//! Obnovení přesune současnou složku do Koše (jde vrátit) a nahradí ji zálohou.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use crate::leftovers;
use crate::process::background;

/// Největší záloha jedné aplikace (bez mezipamětí).
pub(crate) const LIMIT: u64 = 200 * 1024 * 1024;

/// Podsložky, které se nekopírují (mezipaměti a logy – aplikace si je vytvoří znovu).
const SKIPPED: &[&str] = &[
    "cache", "caches", "code cache", "gpucache", "dawncache", "dawngraphitecache", "dawnwebgpucache", "grshadercache",
    "shadercache", "crashpad", "crashdumps", "crash reports", "logs", "log", "temp", "tmp", "service worker", "blob_storage",
    "updates", "update", "packages",
];

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct Meta {
    /// Verze aplikace, ke které nastavení patří (před aktualizací).
    version: String,
    created: String,
    /// Původní složky – záloha i-té je v podsložce `i`.
    folders: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BackupOutcome {
    Saved,
    /// Aplikace v AppData nic nemá.
    Nothing,
    /// Nastavení je větší než LIMIT.
    TooLarge,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    outcome: BackupOutcome,
    bytes: u64,
}

fn backups_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("settings-backups"))
}

pub(crate) fn skipped(dir: &Path) -> bool {
    dir.file_name().is_some_and(|n| SKIPPED.contains(&n.to_string_lossy().to_lowercase().as_str()))
}

/// Složka s programem (aplikace nainstalovaná do AppData – Discord, Teams…) není nastavení.
fn holds_program(dir: &Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|entries| {
        entries.flatten().any(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("exe") || x.eq_ignore_ascii_case("dll")))
    })
}

/// Složky nastavení aplikace v AppData (Roaming a Local, ne Local\Programs).
pub(crate) fn settings_folders(name: &str, package_id: &str) -> Vec<PathBuf> {
    let (apps, publisher) = leftovers::name_keys(name, package_id);
    if apps.is_empty() {
        return Vec::new();
    }
    let mut found = Vec::new();
    for root in ["APPDATA", "LOCALAPPDATA"].iter().filter_map(|v| std::env::var_os(v).map(PathBuf::from)) {
        for dir in leftovers::subdirectories(&root) {
            let key = leftovers::folder_key(&dir);
            if apps.contains(&key) {
                found.push(dir);
            } else if publisher.as_deref() == Some(key.as_str()) {
                // Podsložka vydavatele: Mozilla\Firefox, JetBrains\IntelliJ
                found.extend(leftovers::subdirectories(&dir).into_iter().filter(|sub| apps.contains(&leftovers::folder_key(sub))));
            }
        }
    }
    found.retain(|dir| !holds_program(dir));
    found
}

/// Velikost bez vynechaných podsložek; zastaví se nad `limit`.
pub(crate) fn size(dir: &Path, limit: u64) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if !skipped(&entry.path()) {
                    stack.push(entry.path());
                }
            } else {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                if total > limit {
                    return total;
                }
            }
        }
    }
    total
}

/// Kopie složky bez vynechaných podsložek; zamčené soubory se přeskočí.
fn copy(from: &Path, to: &Path) {
    let _ = std::fs::create_dir_all(to);
    let Ok(entries) = std::fs::read_dir(from) else { return };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        let target = to.join(entry.file_name());
        if kind.is_symlink() {
            continue;
        } else if kind.is_dir() {
            if !skipped(&entry.path()) {
                copy(&entry.path(), &target);
            }
        } else {
            let _ = std::fs::copy(entry.path(), &target);
        }
    }
}

fn app_dir(root: &Path, app_id: &str) -> PathBuf {
    root.join(leftovers::safe_file_name(app_id))
}

fn read_meta(dir: &Path) -> Option<Meta> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("meta.json")).ok()?).ok()
}

/// Zálohuje nastavení aplikace (před aktualizací z verze `version`).
#[tauri::command]
pub async fn settings_backup<R: Runtime>(app: AppHandle<R>, app_id: String, name: String, package_id: String, version: String) -> Result<BackupResult, String> {
    let root = backups_root(&app)?;
    background(move || {
        let folders = settings_folders(&name, &package_id);
        if folders.is_empty() {
            return Ok(BackupResult { outcome: BackupOutcome::Nothing, bytes: 0 });
        }
        let mut bytes = 0;
        for folder in &folders {
            bytes += size(folder, LIMIT.saturating_sub(bytes));
            if bytes > LIMIT {
                return Ok(BackupResult { outcome: BackupOutcome::TooLarge, bytes });
            }
        }
        let dir = app_dir(&root, &app_id);
        let _ = std::fs::remove_dir_all(&dir);
        for (i, folder) in folders.iter().enumerate() {
            copy(folder, &dir.join(i.to_string()));
        }
        let meta = Meta { version, created: leftovers::utc_stamp(), folders: folders.iter().map(|f| f.to_string_lossy().to_string()).collect() };
        std::fs::write(dir.join("meta.json"), serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        Ok(BackupResult { outcome: BackupOutcome::Saved, bytes })
    })
    .await
}

/// Verze, ke které patří záloha nastavení aplikace (RollbackDialog), jinak None.
#[tauri::command]
pub async fn settings_backup_version<R: Runtime>(app: AppHandle<R>, app_id: String) -> Result<Option<String>, String> {
    let root = backups_root(&app)?;
    Ok(read_meta(&app_dir(&root, &app_id)).map(|meta| meta.version))
}

/// Obnoví nastavení ze zálohy verze `version`: současné složky do Koše, záloha na jejich místo.
/// False = záloha k této verzi není.
#[tauri::command]
pub async fn settings_restore<R: Runtime>(app: AppHandle<R>, app_id: String, version: String) -> Result<bool, String> {
    let root = backups_root(&app)?;
    background(move || {
        let dir = app_dir(&root, &app_id);
        let Some(meta) = read_meta(&dir).filter(|meta| meta.version == version) else { return Ok(false) };
        for (i, original) in meta.folders.iter().enumerate() {
            let original = PathBuf::from(original);
            let stored = dir.join(i.to_string());
            if !stored.is_dir() {
                continue;
            }
            if original.exists() {
                leftovers::to_recycle_bin(&original)?;
            }
            copy(&stored, &original);
        }
        Ok(true)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupsInfo {
    count: usize,
    bytes: u64,
}

/// Kolik záloh nastavení je a kolik zabírají (Přehled počítače).
#[tauri::command]
pub async fn settings_backups_info<R: Runtime>(app: AppHandle<R>) -> Result<BackupsInfo, String> {
    let root = backups_root(&app)?;
    background(move || {
        let apps = leftovers::subdirectories(&root);
        Ok(BackupsInfo { count: apps.len(), bytes: apps.iter().map(|d| size(d, u64::MAX)).sum() })
    })
    .await
}

/// Smaže všechny zálohy nastavení.
#[tauri::command]
pub async fn settings_backups_clear<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let root = backups_root(&app)?;
    background(move || {
        if root.exists() {
            std::fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kopie_bez_mezipameti() {
        let base = std::env::temp_dir().join(format!("hubget-settings-test-{}", std::process::id()));
        let from = base.join("App");
        std::fs::create_dir_all(from.join("Cache")).unwrap();
        std::fs::create_dir_all(from.join("profile")).unwrap();
        std::fs::write(from.join("settings.json"), b"{}").unwrap();
        std::fs::write(from.join("profile").join("prefs.ini"), b"a=1").unwrap();
        std::fs::write(from.join("Cache").join("big.bin"), vec![0u8; 4096]).unwrap();
        assert_eq!(size(&from, u64::MAX), 5);
        copy(&from, &base.join("copy"));
        assert!(base.join("copy").join("settings.json").is_file());
        assert!(base.join("copy").join("profile").join("prefs.ini").is_file());
        assert!(!base.join("copy").join("Cache").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn slozka_s_programem_neni_nastaveni() {
        let base = std::env::temp_dir().join(format!("hubget-settings-prog-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        assert!(!holds_program(&base));
        std::fs::write(base.join("Update.exe"), b"MZ").unwrap();
        assert!(holds_program(&base));
        let _ = std::fs::remove_dir_all(&base);
    }
}
