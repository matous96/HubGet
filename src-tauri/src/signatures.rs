//! Kontrola digitálních podpisů nainstalovaných programů (Přehled počítače):
//! hlavní program aplikace (arp.rs `main_executable`) se ověří stejně jako při
//! spuštění staženého souboru – WinVerifyTrust, bez kontroly odvolání certifikátu
//! po síti (rychlé, offline). Nepodepsaný program nemusí být škodlivý (open source
//! projekty často podpis nemají), ale neplatný podpis znamená, že soubor po podpisu
//! někdo změnil, nebo certifikát není důvěryhodný.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::arp;
use crate::process::background;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRef {
    package_id: String,
    name: String,
}

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum SignatureStatus {
    Signed,
    Unsigned,
    /// Podpis je, ale neplatí (změněný soubor, nedůvěryhodný nebo odvolaný certifikát).
    Invalid,
    /// Program se nenašel (aplikace ze Storu, bez záznamu v registru).
    Unknown,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSignature {
    status: SignatureStatus,
    /// Ověřený soubor.
    file: Option<String>,
}

#[cfg(windows)]
fn verify(path: &Path) -> SignatureStatus {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{INVALID_HANDLE_VALUE, TRUST_E_NOSIGNATURE};
    use windows_sys::Win32::Security::WinTrust::{
        WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL,
        WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
    };

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut file = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: wide.as_ptr(),
        hFile: std::ptr::null_mut(),
        pgKnownSubject: std::ptr::null_mut(),
    };
    // SAFETY: vynulovaná struktura; ukazatele (soubor, cesta) žijí do konce funkce
    let mut data: WINTRUST_DATA = unsafe { std::mem::zeroed() };
    data.cbStruct = std::mem::size_of::<WINTRUST_DATA>() as u32;
    data.dwUIChoice = WTD_UI_NONE;
    data.fdwRevocationChecks = WTD_REVOKE_NONE;
    data.dwUnionChoice = WTD_CHOICE_FILE;
    data.Anonymous = WINTRUST_DATA_0 { pFile: &mut file };
    data.dwStateAction = WTD_STATEACTION_VERIFY;
    data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let window = INVALID_HANDLE_VALUE as _;
    // SAFETY: platné struktury podle dokumentace WinVerifyTrust; stav se po ověření uvolní
    let result = unsafe { WinVerifyTrust(window, &mut action, &mut data as *mut WINTRUST_DATA as *mut _) };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    unsafe { WinVerifyTrust(window, &mut action, &mut data as *mut WINTRUST_DATA as *mut _) };
    match result {
        0 => SignatureStatus::Signed,
        code if code == TRUST_E_NOSIGNATURE => SignatureStatus::Unsigned,
        _ => SignatureStatus::Invalid,
    }
}

#[cfg(not(windows))]
fn verify(_path: &Path) -> SignatureStatus {
    SignatureStatus::Unknown
}

/// Podpisy hlavních programů aplikací (pořadí jako `apps`).
#[tauri::command]
pub async fn check_signatures(apps: Vec<AppRef>) -> Result<Vec<AppSignature>, String> {
    background(move || {
        let registry = arp::Registry::load();
        Ok(apps
            .iter()
            .map(|app| {
                let file = registry.matching(&app.package_id, &app.name, "").into_iter().find_map(|entry| entry.main_executable());
                match file {
                    Some(file) => AppSignature { status: verify(&file), file: Some(file.to_string_lossy().to_string()) },
                    None => AppSignature { status: SignatureStatus::Unknown, file: None },
                }
            })
            .collect())
    })
    .await
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn podpis_systemoveho_programu() {
        // explorer.exe je podepsaný katalogem Windows (bez vloženého podpisu) – ověří se jako
        // podepsaný, nebo bez vloženého podpisu; nikdy ne „neplatný“
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let status = verify(Path::new(&format!(r"{windows}\explorer.exe")));
        assert_ne!(status, SignatureStatus::Invalid);
        // Soubor bez podpisu
        let plain = std::env::temp_dir().join(format!("hubget-unsigned-{}.exe", std::process::id()));
        std::fs::write(&plain, b"MZ not really a program").unwrap();
        assert_ne!(verify(&plain), SignatureStatus::Signed);
        let _ = std::fs::remove_file(&plain);
    }
}
