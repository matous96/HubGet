//! Firemní zásady (zásady skupiny, Intune, ruční zápis do registru; šablona ADMX ve složce
//! `policies/`): `HKLM\SOFTWARE\Policies\HubGet`, nepovinně i `HKCU\…` – hodnota pro počítač
//! má přednost. Čtou se jednou při startu HubGetu. Frontend podle nich zamkne nastavení
//! (store/orgPolicy.ts), backend je hlídá i sám – instalaci mimo povolené zdroje a aplikace
//! odmítne, vlastní argumenty a příkazy zahodí (security.rs), i kdyby frontend volbu nepromítl.
//!
//! | Hodnota                   | Typ                         | Význam                                        |
//! |---------------------------|-----------------------------|-----------------------------------------------|
//! | `AllowedSources`          | REG_SZ (`;` `,`) / MULTI_SZ | povolení správci („winget;scoop“)             |
//! | `AllowedApps`             | REG_SZ / MULTI_SZ / podklíč | povolené aplikace (id balíčku, `zdroj:id`)    |
//! | `DisableDeveloperMode`    | REG_DWORD 1                 | bez režimu Vývojář (npm, pip…)                |
//! | `DisableCustomCommands`   | REG_DWORD 1                 | bez vlastních argumentů a příkazů             |
//! | `DisableSignIn`           | REG_DWORD 1                 | bez přihlášení a synchronizace                |
//! | `ForceAutomaticUpdates`   | REG_DWORD 1                 | automatické aktualizace všech aplikací        |
//! | `MinimumUpdateAgeDays`    | REG_DWORD                   | minimální stáří aktualizací                   |
//! | `DisableSelfUpdate`       | REG_DWORD 1                 | HubGet se neaktualizuje sám (nasazení MSI)    |

use serde::Serialize;
use std::sync::LazyLock;

use crate::operations::{Kind, OperationRequest};

pub const KEY: &str = r"SOFTWARE\Policies\HubGet";

#[derive(Serialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrgPolicy {
    /// Nastavena aspoň jedna zásada (Nastavení ukáže „spravuje vaše organizace“).
    pub managed: bool,
    pub allowed_sources: Option<Vec<String>>,
    pub allowed_apps: Option<Vec<String>>,
    pub disable_developer_mode: bool,
    pub disable_custom_commands: bool,
    pub disable_sign_in: bool,
    pub force_automatic_updates: bool,
    pub minimum_update_age_days: Option<u32>,
    pub disable_self_update: bool,
}

/// Seznam z textu („winget; scoop“, po řádcích) – prázdné položky pryč, malými písmeny.
fn list(text: &str) -> Vec<String> {
    text.split([';', ',', '\n', '\r']).map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect()
}

/// Zdroj zásad – registr, v testech mapa.
trait Values {
    fn dword(&self, name: &str) -> Option<u32>;
    fn list(&self, name: &str) -> Option<Vec<String>>;
}

fn from_values(sources: &[&dyn Values]) -> OrgPolicy {
    let dword = |name: &str| sources.iter().find_map(|s| s.dword(name));
    let flag = |name: &str| dword(name).is_some_and(|v| v != 0);
    let list = |name: &str| sources.iter().find_map(|s| s.list(name)).filter(|l| !l.is_empty());
    let mut policy = OrgPolicy {
        managed: false,
        allowed_sources: list("AllowedSources"),
        allowed_apps: list("AllowedApps"),
        disable_developer_mode: flag("DisableDeveloperMode"),
        disable_custom_commands: flag("DisableCustomCommands"),
        disable_sign_in: flag("DisableSignIn"),
        force_automatic_updates: flag("ForceAutomaticUpdates"),
        minimum_update_age_days: dword("MinimumUpdateAgeDays").map(|d| d.min(365)),
        disable_self_update: flag("DisableSelfUpdate"),
    };
    policy.managed = policy != OrgPolicy::default();
    policy
}

#[cfg(windows)]
mod registry {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    pub struct Hive(pub Option<RegKey>);

    impl Hive {
        pub fn machine() -> Self {
            Hive(RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(super::KEY).ok())
        }
        pub fn user() -> Self {
            Hive(RegKey::predef(HKEY_CURRENT_USER).open_subkey(super::KEY).ok())
        }
    }

    impl super::Values for Hive {
        fn dword(&self, name: &str) -> Option<u32> {
            self.0.as_ref()?.get_value::<u32, _>(name).ok()
        }
        fn list(&self, name: &str) -> Option<Vec<String>> {
            let key = self.0.as_ref()?;
            // REG_MULTI_SZ, REG_SZ se středníky, nebo podklíč s hodnotami (seznam z šablony ADMX)
            if let Ok(items) = key.get_value::<Vec<String>, _>(name) {
                return Some(items.iter().flat_map(|i| super::list(i)).collect());
            }
            if let Ok(text) = key.get_value::<String, _>(name) {
                return Some(super::list(&text));
            }
            let sub = key.open_subkey(name).ok()?;
            Some(sub.enum_values().flatten().flat_map(|(_, value)| super::list(&value.to_string())).collect())
        }
    }
}

static POLICY: LazyLock<OrgPolicy> = LazyLock::new(|| {
    #[cfg(windows)]
    {
        let (machine, user) = (registry::Hive::machine(), registry::Hive::user());
        from_values(&[&machine, &user])
    }
    #[cfg(not(windows))]
    {
        OrgPolicy::default()
    }
});

pub fn get() -> &'static OrgPolicy {
    &POLICY
}

/// Zásady pro frontend (zamčená nastavení).
#[tauri::command]
pub fn get_org_policy() -> OrgPolicy {
    get().clone()
}

/// Smí se tahle operace spustit? Odinstalace a stažení vždy, instalace jen z povoleného
/// zdroje a povolená aplikace, aktualizace jen z povoleného zdroje.
pub fn check(source: &str, request: &OperationRequest) -> Result<(), String> {
    check_with(get(), source, request.kind, &request.package_id)
}

fn check_with(policy: &OrgPolicy, source: &str, kind: Kind, package_id: &str) -> Result<(), String> {
    if !matches!(kind, Kind::Install | Kind::Update) {
        return Ok(());
    }
    let source = source.to_lowercase();
    let dev = !matches!(source.as_str(), "winget" | "chocolatey" | "scoop");
    if dev && policy.disable_developer_mode {
        return Err("Režim Vývojář zakázala vaše organizace (zásady HubGetu)".into());
    }
    if let Some(sources) = &policy.allowed_sources {
        if !sources.contains(&source) {
            return Err(format!("Správce {source} zakázala vaše organizace (zásady HubGetu)"));
        }
    }
    if kind == Kind::Install {
        if let Some(apps) = &policy.allowed_apps {
            let id = package_id.to_lowercase();
            let keyed = format!("{source}:{id}");
            if !apps.iter().any(|a| *a == id || *a == keyed) {
                return Err(format!("Aplikaci {package_id} vaše organizace neschválila (zásady HubGetu)"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Map(HashMap<&'static str, &'static str>);

    impl Values for Map {
        fn dword(&self, name: &str) -> Option<u32> {
            self.0.get(name)?.parse().ok()
        }
        fn list(&self, name: &str) -> Option<Vec<String>> {
            self.0.get(name).map(|t| super::list(t))
        }
    }

    #[test]
    fn bez_zasad_nic_nespravuje() {
        assert_eq!(from_values(&[&Map::default(), &Map::default()]), OrgPolicy::default());
    }

    #[test]
    fn pocitac_ma_prednost_pred_uzivatelem() {
        let machine = Map(HashMap::from([("AllowedSources", "WinGet; scoop"), ("ForceAutomaticUpdates", "1")]));
        let user = Map(HashMap::from([("AllowedSources", "chocolatey"), ("DisableSignIn", "1"), ("MinimumUpdateAgeDays", "900")]));
        let policy = from_values(&[&machine, &user]);
        assert!(policy.managed);
        assert_eq!(policy.allowed_sources, Some(vec!["winget".to_string(), "scoop".to_string()]));
        assert!(policy.force_automatic_updates && policy.disable_sign_in);
        assert_eq!(policy.minimum_update_age_days, Some(365));
    }

    #[test]
    fn kontrola_operaci() {
        let policy = OrgPolicy {
            allowed_sources: Some(vec!["winget".into(), "scoop".into()]),
            allowed_apps: Some(vec!["videolan.vlc".into(), "scoop:extras/vlc".into()]),
            disable_developer_mode: true,
            ..Default::default()
        };
        assert!(check_with(&policy, "winget", Kind::Install, "VideoLAN.VLC").is_ok());
        assert!(check_with(&policy, "scoop", Kind::Install, "extras/vlc").is_ok());
        assert!(check_with(&policy, "winget", Kind::Install, "Mozilla.Firefox").is_err());
        // Aktualizace a odinstalace už nainstalované aplikace projdou, jiný zdroj ne
        assert!(check_with(&policy, "winget", Kind::Update, "Mozilla.Firefox").is_ok());
        assert!(check_with(&policy, "chocolatey", Kind::Update, "vlc").is_err());
        assert!(check_with(&policy, "chocolatey", Kind::Uninstall, "vlc").is_ok());
        assert!(check_with(&policy, "npm", Kind::Install, "typescript").is_err());
    }
}
