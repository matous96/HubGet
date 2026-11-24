//! Soukromí aplikací (Přehled počítače → Soukromí aplikací, detail aplikace): vypnutí telemetrie
//! známých aplikací jejich oficiálními, zdokumentovanými zásadami a nastaveními – nic jiného.
//! Uživatelská nastavení (HKCU\Software\Policies, proměnné prostředí uživatele) zapíše HubGet sám;
//! zásady pro celý počítač (HKLM\SOFTWARE\Policies) přes PowerShell s právy správce. Povýšit jde
//! jen skript přesně podle tohoto seznamu (`is_policy_command`). Vypnutí smaže jen hodnoty, které
//! HubGet nastavuje – jiné zásady v klíči (třeba od správce firmy) zůstanou.

use serde::Serialize;

#[derive(Clone, Copy, PartialEq)]
enum Scope {
    User,
    Machine,
}

#[derive(Clone, Copy)]
enum Data {
    Dword(u32),
    Text(&'static str),
}

enum Kind {
    /// Hodnoty v klíči zásad (HKCU nebo HKLM podle rozsahu).
    Policy { scope: Scope, key: &'static str, values: &'static [(&'static str, Data)] },
    /// Proměnná prostředí uživatele (HKCU\Environment) s hodnotou „1“.
    Env(&'static str),
}

struct Setting {
    id: &'static str,
    kind: Kind,
}

/// Zdokumentované zásady výrobců (Firefox/Thunderbird enterprise policies, Chrome a Edge zásady,
/// Brave group policy, VS Code policies, Visual Studio SQM, Office privacy controls, .NET SDK
/// a PowerShell telemetry opt-out).
const SETTINGS: &[Setting] = &[
    Setting { id: "firefox", kind: Kind::Policy { scope: Scope::Machine, key: r"SOFTWARE\Policies\Mozilla\Firefox", values: &[("DisableTelemetry", Data::Dword(1))] } },
    Setting { id: "thunderbird", kind: Kind::Policy { scope: Scope::Machine, key: r"SOFTWARE\Policies\Mozilla\Thunderbird", values: &[("DisableTelemetry", Data::Dword(1))] } },
    Setting { id: "chrome", kind: Kind::Policy { scope: Scope::Machine, key: r"SOFTWARE\Policies\Google\Chrome", values: &[("MetricsReportingEnabled", Data::Dword(0))] } },
    Setting { id: "edge", kind: Kind::Policy { scope: Scope::Machine, key: r"SOFTWARE\Policies\Microsoft\Edge", values: &[("DiagnosticData", Data::Dword(0))] } },
    Setting {
        id: "brave",
        kind: Kind::Policy {
            scope: Scope::Machine,
            key: r"SOFTWARE\Policies\BraveSoftware\Brave",
            values: &[("MetricsReportingEnabled", Data::Dword(0)), ("BraveP3AEnabled", Data::Dword(0)), ("BraveStatsPingEnabled", Data::Dword(0))],
        },
    },
    Setting { id: "vscode", kind: Kind::Policy { scope: Scope::User, key: r"Software\Policies\Microsoft\VSCode", values: &[("TelemetryLevel", Data::Text("off"))] } },
    Setting { id: "visualStudio", kind: Kind::Policy { scope: Scope::Machine, key: r"SOFTWARE\Policies\Microsoft\VisualStudio\SQM", values: &[("OptIn", Data::Dword(0))] } },
    Setting { id: "office", kind: Kind::Policy { scope: Scope::User, key: r"Software\Policies\Microsoft\Office\Common\ClientTelemetry", values: &[("SendTelemetry", Data::Dword(3))] } },
    Setting { id: "dotnet", kind: Kind::Env("DOTNET_CLI_TELEMETRY_OPTOUT") },
    Setting { id: "powershell", kind: Kind::Env("POWERSHELL_TELEMETRY_OPTOUT") },
];

fn setting(id: &str) -> Option<&'static Setting> {
    SETTINGS.iter().find(|s| s.id == id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyState {
    id: &'static str,
    /// Telemetrie je vypnutá (všechny hodnoty nastavené).
    off: bool,
    /// Zásada pro celý počítač – změna potřebuje práva správce.
    machine: bool,
}

/// Skript PowerShellu, který zásadu pro celý počítač zapne (`off` = vypnout telemetrii) nebo vrátí.
fn policy_script(key: &str, values: &[(&str, Data)], off: bool) -> String {
    let path = format!("HKLM:\\{key}");
    if off {
        let mut script = format!("New-Item -Path '{path}' -Force | Out-Null");
        for (name, data) in values {
            let (value, kind) = match data {
                Data::Dword(n) => (n.to_string(), "DWord"),
                Data::Text(t) => (format!("'{t}'"), "String"),
            };
            script.push_str(&format!("; New-ItemProperty -Path '{path}' -Name '{name}' -Value {value} -PropertyType {kind} -Force | Out-Null"));
        }
        script
    } else {
        values
            .iter()
            .map(|(name, _)| format!("Remove-ItemProperty -Path '{path}' -Name '{name}' -ErrorAction SilentlyContinue"))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

fn powershell() -> std::path::PathBuf {
    crate::process::system_tool(r"WindowsPowerShell\v1.0\powershell.exe")
}

fn policy_command(key: &str, values: &[(&str, Data)], off: bool) -> (String, Vec<String>) {
    let args = ["-NoProfile", "-NonInteractive", "-Command"].iter().map(|s| s.to_string()).chain([policy_script(key, values, off)]).collect();
    (powershell().to_string_lossy().into_owned(), args)
}

/// Smí se příkaz spustit jako správce? Jen PowerShell ze System32 se skriptem přesně podle
/// některé zásady pro celý počítač ze seznamu (zapnutí nebo vrácení).
pub(crate) fn is_policy_command(program: &str, args: &[String]) -> bool {
    if !program.eq_ignore_ascii_case(&powershell().to_string_lossy()) {
        return false;
    }
    SETTINGS.iter().any(|s| match s.kind {
        Kind::Policy { scope: Scope::Machine, key, values } => [true, false].iter().any(|&off| policy_command(key, values, off).1 == args),
        _ => false,
    })
}

#[cfg(windows)]
fn read_state(setting: &Setting) -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;
    match setting.kind {
        Kind::Policy { scope, key, values } => {
            let root = RegKey::predef(if scope == Scope::Machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER });
            let Ok(key) = root.open_subkey_with_flags(key, KEY_READ) else { return false };
            values.iter().all(|(name, data)| match data {
                Data::Dword(n) => key.get_value::<u32, _>(name).is_ok_and(|v| v == *n),
                Data::Text(t) => key.get_value::<String, _>(name).is_ok_and(|v| v.eq_ignore_ascii_case(t)),
            })
        }
        Kind::Env(name) => {
            // I proměnná pro celý počítač (nastavená správcem) se počítá
            let user = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", KEY_READ).ok();
            let machine = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment", KEY_READ).ok();
            [user, machine].into_iter().flatten().any(|key| key.get_value::<String, _>(name).is_ok_and(|v| v.trim() == "1" || v.trim().eq_ignore_ascii_case("true")))
        }
    }
}

#[cfg(not(windows))]
fn read_state(_setting: &Setting) -> bool {
    false
}

/// Stav všech nastavení ze seznamu (frontend ukáže jen ty u nainstalovaných aplikací).
#[tauri::command]
pub async fn privacy_status() -> Result<Vec<PrivacyState>, String> {
    crate::process::background(|| {
        Ok(SETTINGS
            .iter()
            .map(|s| PrivacyState { id: s.id, off: read_state(s), machine: matches!(s.kind, Kind::Policy { scope: Scope::Machine, .. }) })
            .collect())
    })
    .await
}

/// Proměnné prostředí se změnily – Průzkumník a nově spuštěné programy si je načtou znovu.
#[cfg(windows)]
fn broadcast_environment() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
    let name: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result = 0usize;
    // SAFETY: řetězec je platný a ukončený nulou po celou dobu volání; výsledek je lokální proměnná
    unsafe {
        SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, name.as_ptr() as isize, SMTO_ABORTIFHUNG, 2000, &mut result);
    }
}

#[cfg(windows)]
fn write_user(setting: &Setting, off: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match setting.kind {
        Kind::Policy { key, values, .. } => {
            if off {
                let (key, _) = hkcu.create_subkey(key).map_err(|e| e.to_string())?;
                for (name, data) in values {
                    match data {
                        Data::Dword(n) => key.set_value(name, n),
                        Data::Text(t) => key.set_value(name, &t.to_string()),
                    }
                    .map_err(|e| e.to_string())?;
                }
            } else if let Ok(key) = hkcu.open_subkey_with_flags(key, KEY_SET_VALUE) {
                for (name, _) in values {
                    let _ = key.delete_value(name);
                }
            }
        }
        Kind::Env(name) => {
            let (key, _) = hkcu.create_subkey("Environment").map_err(|e| e.to_string())?;
            if off {
                key.set_value(name, &"1".to_string()).map_err(|e| e.to_string())?;
            } else {
                let _ = key.delete_value(name);
            }
            broadcast_environment();
        }
    }
    Ok(())
}

/// Vypne (`off` = true) nebo vrátí telemetrii aplikace. Vrací nový stav; zásada pro celý počítač
/// se zeptá dialogem UAC (odmítnutí = chyba „cancelled“).
#[tauri::command]
pub async fn privacy_set(id: String, off: bool) -> Result<bool, String> {
    let setting = setting(&id).ok_or_else(|| format!("Neznámé nastavení {id}"))?;
    crate::process::background(move || {
        match setting.kind {
            Kind::Policy { scope: Scope::Machine, key, values } => {
                let (program, args) = policy_command(key, values, off);
                let cancel = crate::process::CancelToken::default();
                let exit = if crate::security::policy().cache_elevation || crate::elevation::batch_active() {
                    crate::elevation::run_elevated_cached(&program, &args, &cancel, |_| {})
                } else {
                    crate::elevation::run_elevated(&program, &args, &cancel, |_| {})
                }?;
                if exit.cancelled {
                    return Err("cancelled".into());
                }
                if exit.code != 0 {
                    return Err(format!("PowerShell skončil s kódem {}", exit.code));
                }
            }
            #[cfg(windows)]
            _ => write_user(setting, off)?,
            #[cfg(not(windows))]
            _ => return Err("Jen ve Windows".into()),
        }
        Ok(read_state(setting))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skript_zasady_pro_pocitac() {
        let brave = setting("brave").unwrap();
        let Kind::Policy { key, values, .. } = brave.kind else { panic!() };
        let on = policy_script(key, values, true);
        assert!(on.starts_with(r"New-Item -Path 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave' -Force | Out-Null; New-ItemProperty"));
        assert_eq!(on.matches("-PropertyType DWord").count(), 3);
        let off = policy_script(key, values, false);
        assert_eq!(off.matches("Remove-ItemProperty").count(), 3);
        assert!(!off.contains("Remove-Item -Path"), "klíč se nesmaže – může mít jiné zásady");
    }

    #[test]
    fn povyseni_jen_pro_zasady_ze_seznamu() {
        let program = powershell().to_string_lossy().into_owned();
        let Kind::Policy { key, values, .. } = setting("firefox").unwrap().kind else { panic!() };
        let (_, args) = policy_command(key, values, true);
        assert!(is_policy_command(&program, &args));
        assert!(is_policy_command(&program, &policy_command(key, values, false).1));
        // Pozměněný skript, jiný program nebo uživatelská zásada (VS Code) povýšit nejde
        let mut tampered = args.clone();
        tampered[3].push_str("; Remove-Item C:\\ -Recurse");
        assert!(!is_policy_command(&program, &tampered));
        assert!(!is_policy_command(r"C:\Windows\System32\cmd.exe", &args));
        let Kind::Policy { key, values, .. } = setting("vscode").unwrap().kind else { panic!() };
        assert!(!is_policy_command(&program, &policy_command(key, values, true).1));
    }
}
