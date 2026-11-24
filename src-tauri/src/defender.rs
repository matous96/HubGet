//! Kontrola instalátoru Microsoft Defenderem (Nastavení → Aktualizace balíčků → Prověřit
//! instalátory Defenderem, výchozí vypnuto): instalátor, který HubGet stáhl sám, se před spuštěním
//! prověří příkazem `MpCmdRun -Scan -ScanType 3 -File … -DisableRemediation` – v počítači, zdarma
//! a bez práv správce. Vlastní sken rozbalí celý archiv instalátoru, takže velký instalátor trvá
//! i minuty (MSIX ChatGPT 774 MB ≈ 2,5 min) – proto jen na přání; ochrana v reálném čase prověřuje
//! instalátor při spuštění i bez toho. Sken jde zrušit. Nález instalaci zastaví (soubor nechá na
//! Defenderu); když Defender nejde použít (jiný antivirus), instalace pokračuje a průběh to zmíní.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::process::{CancelToken, Output};

/// Výchozí vypnuto – frontend pošle volbu z Nastavení při startu a po změně.
static ENABLED: AtomicBool = AtomicBool::new(false);

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
    /// Uživatel operaci zrušil během skenu.
    Cancelled,
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

/// Prověří soubor Defenderem; zrušení operace sken ukončí.
pub fn scan(file: &Path, cancel: &CancelToken) -> Verdict {
    let program = std::env::var_os("ProgramFiles")
        .map(|dir| Path::new(&dir).join(r"Windows Defender\MpCmdRun.exe"))
        .filter(|path| path.is_file());
    let Some(program) = program else { return Verdict::Unavailable("MpCmdRun.exe".into()) };
    let mut command = crate::process::hidden_command(&program.to_string_lossy());
    command.arg("-Scan").arg("-ScanType").arg("3").arg("-File").arg(file).arg("-DisableRemediation");
    let mut output = String::new();
    let collect = |event: Output| {
        if let Output::Line(line) = event {
            output.push_str(line);
            output.push('\n');
        }
    };
    match crate::process::run_streaming(command, cancel, collect) {
        Ok(exit) if exit.cancelled => Verdict::Cancelled,
        Ok(exit) => verdict(exit.code, &output),
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
        assert!(matches!(scan(&file, &CancelToken::default()), Verdict::Clean | Verdict::Unavailable(_)));
    }

    /// Zrušení dlouhého skenu – skončí hned, ne po minutách. HUBGET_SCAN_FILE = velký instalátor,
    /// který Defender ještě nezná (soubor v jeho mezipaměti doběhne dřív, než se stihne zrušit).
    #[test]
    #[cfg(windows)]
    #[ignore = "spouští Microsoft Defender na velkém souboru"]
    fn live_zruseni_skenu() {
        let Some(file) = std::env::var_os("HUBGET_SCAN_FILE") else { return };
        let cancel = CancelToken::default();
        let later = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            later.cancel();
        });
        let started = std::time::Instant::now();
        assert_eq!(scan(Path::new(&file), &cancel), Verdict::Cancelled);
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "{:?}", started.elapsed());
    }
}
