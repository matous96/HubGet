//! Oprávnění správce a další nebezpečná nastavení (Nastavení → Oprávnění
//! správce ve frontendu, store/security.ts). Frontend je posílá příkazem
//! `set_security_policy` po startu a při každé změně; operace se podle nich
//! řídí i tehdy, kdyby frontend volbu nepromítl (obrana do hloubky):
//!
//! - zákaz povýšení – žádný dialog UAC, operace bez práv správce selže,
//! - povýšení každé operace (winget, Chocolatey) a povýšení jen jednou za běh
//!   (povýšený pomocník zůstane běžet – elevation.rs),
//! - vlastní argumenty instalátoru a příkazy před / po instalaci – bez povolení
//!   se zahodí,
//! - vlastní cesty ke spustitelným souborům správců balíčků.

use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct SecurityPolicy {
    pub elevation_prohibited: bool,
    pub always_elevate: bool,
    pub cache_elevation: bool,
    pub allow_custom_args: bool,
    pub allow_pre_post_commands: bool,
    /// „winget“ / „chocolatey“ / „scoop“ → cesta (jen s povolením ve frontendu).
    pub manager_paths: HashMap<String, String>,
}

static POLICY: LazyLock<RwLock<SecurityPolicy>> = LazyLock::new(Default::default);

#[tauri::command]
pub fn set_security_policy(policy: SecurityPolicy) {
    *POLICY.write().unwrap_or_else(|e| e.into_inner()) = policy;
}

/// Aktuální nastavení (kopie – zámek se nedrží během operace). Firemní zásady
/// (org_policy.rs) vlastní argumenty a příkazy zakážou i proti volbě ve frontendu.
pub fn policy() -> SecurityPolicy {
    let mut policy = POLICY.read().unwrap_or_else(|e| e.into_inner()).clone();
    if crate::org_policy::get().disable_custom_commands {
        policy.allow_custom_args = false;
        policy.allow_pre_post_commands = false;
    }
    policy
}

/// Vlastní cesta ke správci, pokud ji uživatel nastavil a soubor má očekávaný
/// název (`expected` – „winget.exe“, „choco.exe“, „scoop.ps1“…) a existuje.
pub fn manager_path(manager: &str, expected: &[&str]) -> Option<PathBuf> {
    let path = PathBuf::from(policy().manager_paths.get(manager)?.trim().trim_matches('"'));
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    (expected.contains(&name.as_str()) && path.is_file()).then_some(path)
}

/// Ověří vlastní cestu pro Nastavení: prázdná = výchozí, jinak musí existovat
/// a mít očekávaný název souboru. Asynchronně – síťová cesta může odpovídat dlouho.
#[tauri::command]
pub async fn check_manager_path(manager: String, path: String) -> Result<(), String> {
    crate::process::background(move || check_path(&manager, &path)).await
}

fn check_path(manager: &str, path: &str) -> Result<(), String> {
    let expected: &[&str] = match manager {
        "winget" => &["winget.exe"],
        "chocolatey" => &["choco.exe"],
        "scoop" => &["scoop.ps1"],
        _ => return Err("Neznámý správce".into()),
    };
    let path = Path::new(path.trim().trim_matches('"'));
    let name = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !expected.contains(&name.as_str()) {
        return Err(format!("Očekává se soubor {}", expected.join(" / ")));
    }
    if !path.is_file() {
        return Err("Soubor neexistuje".into());
    }
    Ok(())
}
