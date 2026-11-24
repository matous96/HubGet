//! Kontrola instalátoru Microsoft Defenderem (Nastavení → Aktualizace balíčků → Prověřit
//! instalátory Defenderem): instalátor, který HubGet stáhl sám, se před spuštěním prověří
//! příkazem `MpCmdRun -Scan -ScanType 3 -File … -DisableRemediation` – v počítači, zdarma a bez
//! práv správce. Nález instalaci zastaví (soubor nechá na Defenderu); když Defender nejde použít
//! (jiný antivirus, vypnutá ochrana), instalace pokračuje a průběh to jen zmíní.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static ENABLED: AtomicBool = AtomicBool::new(true);

/// Volba z Nastavení (frontend ji pošle při startu a po změně).
#[tauri::command]
pub fn set_installer_scan(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Clean,
    /// Název hrozby podle Defenderu (prázdný, když ho výstup neuvádí).
    Threat(String),
    /// Defender nejde použít – kód nebo chyba.
    Unavailable(String),
}

/// MpCmdRun vrací 0 = bez nálezu, 2 = nalezená hrozba; jiný kód = sken neproběhl.
pub fn verdict(code: i32, output: &str) -> Verdict {
    match code {
        0 => Verdict::Clean,
        2 => Verdict::Threat(
            output
                .lines()
                .find_map(|line| line.trim_start().strip_prefix("Threat").and_then(|rest| rest.trim_start().strip_prefix(':')))
                .map(|name| name.trim().to_string())
                .unwrap_or_default(),
        ),
        other => Verdict::Unavailable(format!("MpCmdRun {other:#x}")),
    }
}

/// Prověří soubor Defenderem (nejdéle 10 minut – velké hry).
pub fn scan(file: &Path) -> Verdict {
    let program = std::env::var_os("ProgramFiles")
        .map(|dir| Path::new(&dir).join(r"Windows Defender\MpCmdRun.exe"))
        .filter(|path| path.is_file());
    let Some(program) = program else { return Verdict::Unavailable("MpCmdRun.exe".into()) };
    let mut command = crate::process::hidden_command(&program.to_string_lossy());
    command.arg("-Scan").arg("-ScanType").arg("3").arg("-File").arg(file).arg("-DisableRemediation");
    match crate::process::run(command, Duration::from_secs(600)) {
        Ok(output) => verdict(output.code, &output.stdout),
        Err(error) => Verdict::Unavailable(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vysledek_skenu() {
        assert_eq!(verdict(0, "Scanning C:\\a.exe found no threats."), Verdict::Clean);
        let found = "Scan starting...\nScan finished.\nScanning C:\\x.exe found 1 threats.\n\n----- Threat information -----\nThreat                  : Virus:DOS/EICAR_Test_File\nResources               : 1 total";
        assert_eq!(verdict(2, found), Verdict::Threat("Virus:DOS/EICAR_Test_File".into()));
        assert_eq!(verdict(2, "nic"), Verdict::Threat(String::new()));
        assert!(matches!(verdict(-2147024894, ""), Verdict::Unavailable(_)));
    }

    #[test]
    #[cfg(windows)]
    #[ignore = "spouští Microsoft Defender"]
    fn live_sken() {
        let file = std::env::current_exe().unwrap();
        assert!(matches!(scan(&file), Verdict::Clean | Verdict::Unavailable(_)));
    }
}
