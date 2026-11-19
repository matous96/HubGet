//! Údaje o počítači: architektura procesoru a verze Windows.
//! Frontend podle nich ověřuje systémové požadavky aplikací
//! („poběží nativně / v emulaci“, minimální verze Windows).

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// Architektura počítače (ne této aplikace): „x64“, „x86“ nebo „arm64“.
    pub arch: String,
    /// Název systému, např. „Windows 11 Pro“.
    pub os_name: String,
    /// Označení verze, např. „24H2“ (u starších Windows chybí).
    pub os_display_version: Option<String>,
    /// Číslo sestavení, např. 26100.
    pub os_build: u32,
    /// Verze HubGetu.
    pub app_version: String,
    /// Název počítače (Moje počítače v Nastavení).
    pub computer_name: Option<String>,
}

/// Registr se čte mimo vlákno okna (synchronní příkaz by běžel na hlavním vlákně).
#[tauri::command]
pub async fn system_info(app: tauri::AppHandle) -> Result<SystemInfo, String> {
    let app_version = app.package_info().version.to_string();
    crate::process::background(move || {
        let (arch, os_name, os_display_version, os_build) = read_windows_info();
        let computer_name = std::env::var("COMPUTERNAME").ok().filter(|n| !n.is_empty());
        Ok(SystemInfo { arch, os_name, os_display_version, os_build, app_version, computer_name })
    })
    .await
}

/// Převod názvu architektury z Windows / Rustu na názvy používané v katalogu.
fn normalize_arch(value: &str) -> String {
    match value.to_ascii_lowercase().as_str() {
        "amd64" | "x86_64" | "x64" => "x64",
        "arm64" | "aarch64" => "arm64",
        "x86" | "i386" | "i686" => "x86",
        other => return other.to_string(),
    }
    .to_string()
}

#[cfg(windows)]
fn read_windows_info() -> (String, String, Option<String>, u32) {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // Skutečná architektura počítače – na ARM64 může aplikace běžet v emulaci x64,
    // proto se nebere z překladu aplikace, ale z prostředí systému.
    let arch = hklm
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
        .and_then(|key| key.get_value::<String, _>("PROCESSOR_ARCHITECTURE"))
        .map(|a| normalize_arch(&a))
        .unwrap_or_else(|_| normalize_arch(std::env::consts::ARCH));

    let version = hklm.open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion").ok();
    let get = |name: &str| version.as_ref().and_then(|key| key.get_value::<String, _>(name).ok());
    let build: u32 = get("CurrentBuildNumber").and_then(|b| b.parse().ok()).unwrap_or(0);
    let mut name = get("ProductName").unwrap_or_else(|| "Windows".to_string());
    // Windows 11 má v registru kvůli kompatibilitě stále „Windows 10 …“
    if build >= 22000 {
        name = name.replace("Windows 10", "Windows 11");
    }
    (arch, name, get("DisplayVersion"), build)
}

#[cfg(not(windows))]
fn read_windows_info() -> (String, String, Option<String>, u32) {
    (normalize_arch(std::env::consts::ARCH), std::env::consts::OS.to_string(), None, 0)
}

/// Podmínky pro automatickou instalaci aktualizací na pozadí.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerNetwork {
    /// Počítač běží z baterie (ne ze zásuvky).
    on_battery: bool,
    /// Připojení je měřené (mobilní data, hotspot, nastavené jako měřené).
    metered: bool,
    /// Zapnutá úspora baterie (Windows: Úspora energie / Battery saver).
    battery_saver: bool,
    /// Běží aplikace přes celou obrazovku (hra, video), prezentace nebo hra Direct3D –
    /// Windows v tu chvíli nepouští oznámení (SHQueryUserNotificationState).
    busy: bool,
    /// Jak dlouho uživatel nesáhl na klávesnici ani myš (s).
    idle_seconds: u64,
}

/// Asynchronně: synchronní příkazy Tauri běží v hlavním vlákně okna a dotaz
/// WinRT na síť by ho mohl zdržet.
#[tauri::command]
pub async fn power_network_status() -> Result<PowerNetwork, String> {
    crate::process::background(|| {
        let (on_battery, battery_saver) = power();
        Ok(PowerNetwork { on_battery, metered: metered(), battery_saver, busy: busy(), idle_seconds: idle_seconds() })
    })
    .await
}

/// Aplikace přes celou obrazovku, hra Direct3D nebo prezentace.
#[cfg(windows)]
fn busy() -> bool {
    use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    let mut state = 0;
    // SAFETY: zápis do vlastní proměnné
    if unsafe { SHQueryUserNotificationState(&mut state) } != 0 {
        return false;
    }
    matches!(state, QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE)
}

/// Sekundy od posledního vstupu z klávesnice nebo myši.
#[cfg(windows)]
fn idle_seconds() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: zápis do vlastní struktury se správnou velikostí
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return 0;
    }
    // Obě hodnoty jsou 32bitové milisekundy od startu – rozdíl s přetečením
    (unsafe { GetTickCount() }.wrapping_sub(info.dwTime) / 1000) as u64
}

#[cfg(not(windows))]
fn busy() -> bool {
    false
}

#[cfg(not(windows))]
fn idle_seconds() -> u64 {
    0
}

/// Napájení: (běží z baterie, zapnutá úspora baterie).
#[cfg(windows)]
fn power() -> (bool, bool) {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    // SAFETY: zápis do vlastní struktury
    let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
        return (false, false);
    }
    // ACLineStatus 0 = baterie, 1 = zásuvka, 255 = neznámé (stolní počítač bez baterie hlásí 1);
    // SystemStatusFlag 1 = zapnutá úspora baterie
    (status.ACLineStatus == 0, status.SystemStatusFlag == 1)
}

#[cfg(windows)]
fn metered() -> bool {
    use windows::Networking::Connectivity::{NetworkCostType, NetworkInformation};
    let cost = || -> windows::core::Result<bool> {
        let profile = NetworkInformation::GetInternetConnectionProfile()?;
        let cost = profile.GetConnectionCost()?;
        Ok(cost.NetworkCostType()? != NetworkCostType::Unrestricted || cost.Roaming()? || cost.OverDataLimit()?)
    };
    // Bez připojení nebo bez údaje se bere jako neměřené (o instalaci rozhodne síť sama)
    cost().unwrap_or(false)
}

#[cfg(not(windows))]
fn power() -> (bool, bool) {
    (false, false)
}

#[cfg(not(windows))]
fn metered() -> bool {
    false
}

/// Stav Devolutions Agent (broker operací s balíčky) pro Nastavení → Oprávnění správce.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerStatus {
    installed: bool,
    running: bool,
    /// Název služby, pod kterou byl agent nalezen.
    service: Option<String>,
}

/// Asynchronně: dotaz na službu spouští sc.exe (až 10 s), v hlavním vlákně by zamrzlo okno.
#[tauri::command]
pub async fn devolutions_agent_status() -> Result<BrokerStatus, String> {
    crate::process::background(|| Ok(broker_status())).await
}

#[cfg(windows)]
fn broker_status() -> BrokerStatus {
    use std::time::Duration;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    const SERVICES: &[&str] = &["DevolutionsAgent", "Devolutions Agent"];
    let services = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SYSTEM\CurrentControlSet\Services").ok();
    let service = SERVICES.iter().find(|name| services.as_ref().is_some_and(|s| s.open_subkey(name).is_ok()));
    let running = service.is_some_and(|name| {
        let mut command = crate::process::hidden_command(&crate::process::system_tool("sc.exe").to_string_lossy());
        command.args(["query", name]);
        crate::process::run(command, Duration::from_secs(10)).is_ok_and(|o| o.stdout.contains("RUNNING"))
    });
    BrokerStatus { installed: service.is_some(), running, service: service.map(|s| s.to_string()) }
}

#[cfg(not(windows))]
fn broker_status() -> BrokerStatus {
    BrokerStatus { installed: false, running: false, service: None }
}
