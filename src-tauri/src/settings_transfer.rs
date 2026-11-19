//! Přenos nastavení aplikací na nový počítač (Nastavení → Záloha a katalog): složky
//! nastavení vybraných aplikací v AppData (stejné hledání jako záloha před aktualizací,
//! settings_backup.rs – bez mezipamětí a logů) se uloží do jednoho souboru
//! `.hubget-settings` zašifrovaného heslem, které zvolí uživatel. V AppData bývají
//! přihlašovací tokeny i hesla, proto soubor bez hesla nejde přečíst:
//!
//! - klíč z hesla PBKDF2-HMAC-SHA256 ([`ITERATIONS`] opakování, náhodná sůl),
//! - šifrování AES-256-GCM (náhodný nonce; hlavička souboru je součástí ověření),
//! - obsah: manifest (aplikace a jejich složky vůči %APPDATA% / %LOCALAPPDATA%)
//!   a soubory, zkomprimované (deflate) před zašifrováním.
//!
//! Obnovení přesune současnou složku aplikace do Koše (jde vrátit) a nahradí ji tou ze
//! souboru. Cesty ze souboru se ověří – nic se nezapíše mimo složku aplikace v AppData.
//! Soubor vybírá uživatel v systémovém dialogu; heslo se nikam neukládá.

use ring::aead::{self, Aad, LessSafeKey, Nonce, UnboundKey};
use ring::pbkdf2;
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::num::NonZeroU32;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::leftovers;
use crate::process::background;
use crate::settings_backup;

const MAGIC: &[u8; 8] = b"HUBGETS1";
const ITERATIONS: u32 = 600_000;
/// Celý přenos najednou (šifruje se v paměti).
const TOTAL_LIMIT: u64 = 256 * 1024 * 1024;
const BASES: [&str; 2] = ["APPDATA", "LOCALAPPDATA"];

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferApp {
    app_id: String,
    name: String,
    package_id: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannedApp {
    app_id: String,
    bytes: u64,
    /// Nastavení je větší než limit zálohy jedné aplikace.
    too_large: bool,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Folder {
    /// APPDATA / LOCALAPPDATA
    base: String,
    /// Cesta vůči základní složce, oddělená „/“ (VideoLAN/vlc).
    relative: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ManifestApp {
    app_id: String,
    name: String,
    folders: Vec<Folder>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    created: String,
    apps: Vec<ManifestApp>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    path: String,
    apps: usize,
    bytes: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Názvy aplikací, jejichž nastavení se obnovilo.
    restored: Vec<String>,
}

fn base_dir(base: &str) -> Option<PathBuf> {
    BASES.contains(&base).then(|| std::env::var_os(base).map(PathBuf::from)).flatten()
}

/// Složka vůči %APPDATA% / %LOCALAPPDATA%.
fn folder_spec(dir: &Path) -> Option<Folder> {
    BASES.iter().find_map(|base| {
        let root = base_dir(base)?;
        let relative = dir.strip_prefix(&root).ok()?;
        let parts: Vec<String> = relative.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        (!parts.is_empty()).then(|| Folder { base: (*base).into(), relative: parts.join("/") })
    })
}

/// Bezpečná relativní cesta ze souboru: jen běžné části (žádné „..“, disk, kořen, „:“).
fn safe_relative(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.contains(':') || path.contains('\\') {
        return None;
    }
    let relative = Path::new(path);
    relative.components().all(|c| matches!(c, Component::Normal(_))).then(|| relative.to_path_buf())
}

/// Soubory složky (bez vynechaných podsložek) – (cesta vůči složce s „/“, absolutní cesta).
fn files(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), String::new())];
    while let Some((current, prefix)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            let relative = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            if kind.is_symlink() {
                continue;
            } else if kind.is_dir() {
                if !settings_backup::skipped(&entry.path()) {
                    stack.push((entry.path(), relative));
                }
            } else {
                out.push((relative, entry.path()));
            }
        }
    }
    out
}

fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    out.extend_from_slice(bytes);
}

fn take_bytes<'a>(data: &'a [u8], at: &mut usize) -> Result<&'a [u8], String> {
    let bad = || "Poškozený soubor".to_string();
    let len = u64::from_le_bytes(data.get(*at..*at + 8).ok_or_else(bad)?.try_into().map_err(|_| bad())?) as usize;
    *at += 8;
    let slice = data.get(*at..at.checked_add(len).ok_or_else(bad)?).ok_or_else(bad)?;
    *at += len;
    Ok(slice)
}

/// Obsah přenosu: manifest a soubory „aplikace/složka/cesta“ → data.
fn pack(manifest: &Manifest, entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let mut raw = Vec::new();
    put_bytes(&mut raw, &serde_json::to_vec(manifest).map_err(|e| e.to_string())?);
    for (path, data) in entries {
        put_bytes(&mut raw, path.as_bytes());
        put_bytes(&mut raw, data);
    }
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&raw).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}

type Entries = Vec<(String, Vec<u8>)>;

fn unpack(compressed: &[u8]) -> Result<(Manifest, Entries), String> {
    let mut raw = Vec::new();
    flate2::read::DeflateDecoder::new(compressed)
        .take(TOTAL_LIMIT * 2)
        .read_to_end(&mut raw)
        .map_err(|_| "Poškozený soubor".to_string())?;
    let mut at = 0;
    let manifest: Manifest = serde_json::from_slice(take_bytes(&raw, &mut at)?).map_err(|_| "Poškozený soubor".to_string())?;
    let mut entries = Vec::new();
    while at < raw.len() {
        let path = String::from_utf8(take_bytes(&raw, &mut at)?.to_vec()).map_err(|_| "Poškozený soubor".to_string())?;
        let data = take_bytes(&raw, &mut at)?.to_vec();
        entries.push((path, data));
    }
    Ok((manifest, entries))
}

fn key(password: &str, salt: &[u8], iterations: u32) -> Result<LessSafeKey, String> {
    let mut bytes = [0u8; 32];
    let iterations = NonZeroU32::new(iterations).ok_or("Poškozený soubor")?;
    pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA256, iterations, salt, password.as_bytes(), &mut bytes);
    Ok(LessSafeKey::new(UnboundKey::new(&aead::AES_256_GCM, &bytes).map_err(|_| "Šifrování selhalo")?))
}

fn encrypt(password: &str, plain: Vec<u8>, iterations: u32) -> Result<Vec<u8>, String> {
    let rng = SystemRandom::new();
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rng.fill(&mut salt).map_err(|_| "Náhodná čísla nejsou k dispozici")?;
    rng.fill(&mut nonce).map_err(|_| "Náhodná čísla nejsou k dispozici")?;
    let mut header = MAGIC.to_vec();
    header.extend_from_slice(&iterations.to_le_bytes());
    header.extend_from_slice(&salt);
    let mut sealed = plain;
    key(password, &salt, iterations)?
        .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(&header), &mut sealed)
        .map_err(|_| "Šifrování selhalo")?;
    let mut out = header;
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

fn decrypt(password: &str, file: &[u8]) -> Result<Vec<u8>, String> {
    if file.len() < 8 + 4 + 16 + 12 + 16 || &file[..8] != MAGIC {
        return Err("Soubor není přenos nastavení z HubGetu".into());
    }
    let iterations = u32::from_le_bytes(file[8..12].try_into().map_err(|_| "Poškozený soubor")?);
    if !(100_000..=10_000_000).contains(&iterations) {
        return Err("Poškozený soubor".into());
    }
    let (header, rest) = file.split_at(28);
    let (nonce, sealed) = rest.split_at(12);
    let mut buffer = sealed.to_vec();
    let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| "Poškozený soubor")?;
    let plain = key(password, &header[12..28], iterations)?
        .open_in_place(nonce, Aad::from(header), &mut buffer)
        .map_err(|_| "Špatné heslo, nebo poškozený soubor".to_string())?;
    Ok(plain.to_vec())
}

/// Které z aplikací mají nastavení v AppData a kolik zabírá.
#[tauri::command]
pub async fn settings_transfer_scan(apps: Vec<TransferApp>) -> Result<Vec<ScannedApp>, String> {
    background(move || {
        Ok(apps
            .iter()
            .filter_map(|app| {
                let folders = settings_backup::settings_folders(&app.name, &app.package_id);
                if folders.is_empty() {
                    return None;
                }
                let bytes: u64 = folders.iter().map(|f| settings_backup::size(f, settings_backup::LIMIT)).sum();
                Some(ScannedApp { app_id: app.app_id.clone(), bytes, too_large: bytes > settings_backup::LIMIT })
            })
            .collect())
    })
    .await
}

/// Uloží nastavení vybraných aplikací do souboru zašifrovaného heslem. None = dialog zavřený.
#[tauri::command]
pub async fn settings_transfer_export<R: Runtime>(
    app: AppHandle<R>,
    apps: Vec<TransferApp>,
    password: String,
    file_name: String,
) -> Result<Option<ExportResult>, String> {
    if password.chars().count() < 8 {
        return Err("Heslo musí mít aspoň 8 znaků".into());
    }
    background(move || {
        let mut manifest = Manifest { version: 1, created: leftovers::utc_stamp(), apps: Vec::new() };
        let mut entries = Vec::new();
        let mut total = 0u64;
        for item in &apps {
            let folders = settings_backup::settings_folders(&item.name, &item.package_id);
            let mut specs = Vec::new();
            for folder in folders.iter().filter(|f| settings_backup::size(f, settings_backup::LIMIT) <= settings_backup::LIMIT) {
                let Some(spec) = folder_spec(folder) else { continue };
                let index = specs.len();
                for (relative, path) in files(folder) {
                    // Spustitelné soubory do nastavení nepatří (a import by je stejně nezapsal)
                    if executable(Path::new(&relative)) {
                        continue;
                    }
                    // Zamčený soubor (běžící aplikace) se přeskočí
                    let Ok(data) = std::fs::read(&path) else { continue };
                    total += data.len() as u64;
                    if total > TOTAL_LIMIT {
                        return Err("Nastavení vybraných aplikací je dohromady větší než 256 MB – vyberte méně aplikací".into());
                    }
                    entries.push((format!("{}/{index}/{relative}", manifest.apps.len()), data));
                }
                specs.push(spec);
            }
            if !specs.is_empty() {
                manifest.apps.push(ManifestApp { app_id: item.app_id.clone(), name: item.name.clone(), folders: specs });
            }
        }
        if manifest.apps.is_empty() {
            return Err("Vybrané aplikace nemají v AppData žádné nastavení".into());
        }
        let file = encrypt(&password, pack(&manifest, &entries)?, ITERATIONS)?;
        let mut dialog = app.dialog().file().set_file_name(&file_name).add_filter("HubGet", &["hubget-settings"]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(path) = dialog.blocking_save_file() else { return Ok(None) };
        let path = path.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, file).map_err(|e| e.to_string())?;
        Ok(Some(ExportResult { path: path.to_string_lossy().into_owned(), apps: manifest.apps.len(), bytes: total }))
    })
    .await
}

/// Obnoví nastavení ze souboru (výběr v dialogu): současné složky do Koše. None = dialog zavřený.
#[tauri::command]
pub async fn settings_transfer_import<R: Runtime>(app: AppHandle<R>, password: String) -> Result<Option<ImportResult>, String> {
    background(move || {
        let mut dialog = app.dialog().file().add_filter("HubGet", &["hubget-settings"]);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let Some(path) = dialog.blocking_pick_file() else { return Ok(None) };
        let path = path.into_path().map_err(|e| e.to_string())?;
        if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > TOTAL_LIMIT * 2 {
            return Err("Soubor je příliš velký".into());
        }
        let file = std::fs::read(&path).map_err(|e| e.to_string())?;
        let (manifest, entries) = unpack(&decrypt(&password, &file)?)?;
        restore(&manifest, &entries).map(|restored| Some(ImportResult { restored }))
    })
    .await
}

/// Složky v AppData, do kterých přenos nikdy nezapisuje: Windows (nabídka Start, Po spuštění,
/// pověření), programy instalované do AppData a data HubGetu samotného.
const PROTECTED: &[&str] = &["microsoft", "programs", "packages", "temp", "hubget", "unibox", "org.unibox.app", "org.unibox.dev"];

/// Soubory, které nastavení nepotřebuje a které by po podvrženém souboru mohly spustit kód.
const EXECUTABLE: &[&str] = &[
    "exe", "dll", "sys", "com", "scr", "pif", "cpl", "msi", "msp", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
    "hta", "lnk", "url", "reg",
];

fn executable(path: &Path) -> bool {
    path.extension().is_some_and(|e| EXECUTABLE.contains(&e.to_string_lossy().to_lowercase().as_str()))
}

/// Cíl složky aplikace na tomto počítači (ověřená cesta pod %APPDATA% / %LOCALAPPDATA%,
/// mimo chráněné složky).
fn target_of(folder: &Folder) -> Option<PathBuf> {
    let relative = safe_relative(&folder.relative)?;
    let first = relative.components().next()?.as_os_str().to_string_lossy().to_lowercase();
    if PROTECTED.contains(&first.as_str()) {
        return None;
    }
    Some(base_dir(&folder.base)?.join(relative))
}

fn restore(manifest: &Manifest, entries: &Entries) -> Result<Vec<String>, String> {
    let mut restored = Vec::new();
    for (app_index, app) in manifest.apps.iter().enumerate() {
        let targets: Vec<Option<PathBuf>> = app.folders.iter().map(target_of).collect();
        // Současné nastavení do Koše (jde vrátit), pak soubory ze přenosu
        for target in targets.iter().flatten() {
            if target.exists() {
                leftovers::to_recycle_bin(target)?;
            }
        }
        let mut written = false;
        for (path, data) in entries {
            let mut parts = path.splitn(3, '/');
            let (Some(a), Some(f), Some(relative)) = (parts.next(), parts.next(), parts.next()) else { continue };
            if a.parse::<usize>().ok() != Some(app_index) {
                continue;
            }
            let Some(Some(target)) = f.parse::<usize>().ok().and_then(|i| targets.get(i)) else { continue };
            let Some(relative) = safe_relative(relative).filter(|r| !executable(r)) else { continue };
            let file = target.join(relative);
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::write(&file, data).is_ok() {
                written = true;
            }
        }
        if written {
            restored.push(app.name.clone());
        }
    }
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sifrovani_tam_a_zpet() {
        let manifest = Manifest {
            version: 1,
            created: "2026-11-20T10:00:00Z".into(),
            apps: vec![ManifestApp { app_id: "videolan-vlc".into(), name: "VLC".into(), folders: vec![Folder { base: "APPDATA".into(), relative: "vlc".into() }] }],
        };
        let entries = vec![("0/0/vlcrc".to_string(), b"volume=50".to_vec()), ("0/0/sub/a b.txt".to_string(), vec![0, 1, 2])];
        // Méně opakování – test nemusí čekat
        let file = encrypt("tajne-heslo", pack(&manifest, &entries).unwrap(), 100_000).unwrap();
        assert_eq!(&file[..8], MAGIC);
        assert!(decrypt("jine-heslo", &file).is_err());
        let (back, files) = unpack(&decrypt("tajne-heslo", &file).unwrap()).unwrap();
        assert_eq!(back.apps[0].folders, manifest.apps[0].folders);
        assert_eq!(files, entries);
        // Změněný bajt hlavičky (ověřená data) = chyba
        let mut tampered = file.clone();
        tampered[20] ^= 1;
        assert!(decrypt("tajne-heslo", &tampered).is_err());
    }

    /// Obnovení do dočasné složky místo AppData (mění proměnnou prostředí – spouštět samostatně:
    /// `cargo test --lib obnoveni_do_docasne_slozky -- --ignored --test-threads=1`).
    #[test]
    #[ignore = "mění APPDATA procesu testů"]
    fn obnoveni_do_docasne_slozky() {
        let root = std::env::temp_dir().join(format!("hubget-transfer-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::env::set_var("APPDATA", &root);
        let manifest = Manifest {
            version: 1,
            created: String::new(),
            apps: vec![
                ManifestApp { app_id: "a".into(), name: "Aplikace".into(), folders: vec![Folder { base: "APPDATA".into(), relative: "Vydavatel/Aplikace".into() }] },
                ManifestApp { app_id: "b".into(), name: "Podvrh".into(), folders: vec![Folder { base: "APPDATA".into(), relative: "Microsoft/Windows/Start Menu/Programs/Startup".into() }] },
            ],
        };
        let entries = vec![
            ("0/0/config.json".to_string(), b"{}".to_vec()),
            ("0/0/sub/data.db".to_string(), vec![1, 2, 3]),
            ("0/0/spust.exe".to_string(), b"MZ".to_vec()),
            ("0/0/../uniknout.txt".to_string(), b"x".to_vec()),
            ("1/0/zlo.cmd".to_string(), b"echo".to_vec()),
        ];
        let restored = restore(&manifest, &entries).unwrap();
        let app = root.join("Vydavatel").join("Aplikace");
        assert_eq!(restored, vec!["Aplikace".to_string()]);
        assert_eq!(std::fs::read(app.join("config.json")).unwrap(), b"{}");
        assert_eq!(std::fs::read(app.join("sub").join("data.db")).unwrap(), vec![1, 2, 3]);
        assert!(!app.join("spust.exe").exists());
        assert!(!root.join("Vydavatel").join("uniknout.txt").exists());
        assert!(!root.join("Microsoft").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cesty_ze_souboru_se_overi() {
        assert!(safe_relative("VideoLAN/vlc").is_some());
        for bad in ["", "../x", "a/../../x", "C:/Windows", "/abs", "a\\b", "x:stream"] {
            assert!(safe_relative(bad).is_none(), "{bad}");
        }
        assert!(target_of(&Folder { base: "WINDIR".into(), relative: "x".into() }).is_none());
        // Nabídka Start / Po spuštění, programy v AppData a spustitelné soubory se nezapíšou
        assert!(target_of(&Folder { base: "APPDATA".into(), relative: "Microsoft/Windows/Start Menu/Programs/Startup".into() }).is_none());
        assert!(target_of(&Folder { base: "LOCALAPPDATA".into(), relative: "Programs/x".into() }).is_none());
        assert!(executable(Path::new("a/run.EXE")) && executable(Path::new("x.lnk")) && !executable(Path::new("vlcrc")));
    }
}
