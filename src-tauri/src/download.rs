//! Stažení souboru přes curl.exe (součást Windows 10/11) s průběhem v procentech.
//!
//! Používá se pro předstažení instalátoru: winget sám stahuje přes Delivery
//! Optimization, která soubor zapisuje až na konci (průběh nejde sledovat)
//! a umí se na desítky sekund zastavit. HubGet proto instalátor stáhne sám
//! tam, kde ho winget hledá, a winget po ověření kontrolního součtu rovnou
//! instaluje.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use crate::process::{self, hidden_command, system_tool, CancelToken, Output};

/// Jak stažení dopadlo.
pub enum Fetch {
    Done,
    Cancelled,
    Failed(String),
}

/// Rozstažený soubor vedle cíle (`.unibox-part`) – po pozastavení na něj stahování naváže.
pub fn partial_path(target: &Path) -> PathBuf {
    target.with_extension("unibox-part")
}

/// Zahodí rozstažený soubor (zrušené stahování).
pub fn discard_partial(target: &Path) {
    let _ = std::fs::remove_file(partial_path(target));
}

/// Omezení rychlosti stahování instalátorů v kB/s (0 = bez omezení) – Nastavení → Aktualizace
/// balíčků; frontend ho nastaví po spuštění a při změně (`set_download_limit`).
static LIMIT_KBPS: AtomicU32 = AtomicU32::new(0);

#[tauri::command]
pub fn set_download_limit(kbps: u32) {
    LIMIT_KBPS.store(kbps, Ordering::Relaxed);
}

/// curl: server neumí navázat stahování (HTTP range) – soubor se stáhne znovu celý.
const CURL_CANNOT_RESUME: i32 = 33;

/// Stáhne `url` do `target` (přes dočasný soubor `.unibox-part`).
/// `on_percent` dostává celkový průběh 0–100. Rozstažený soubor z dřívějška (pozastavené
/// stahování) naváže (`--continue-at -`); po zrušení rozstažený soubor zůstane – zahodí
/// ho volající (`discard_partial`), nebo na něj příště naváže.
pub fn fetch(url: &str, target: &Path, cancel: &CancelToken, mut on_percent: impl FnMut(f64)) -> Fetch {
    let Some(dir) = target.parent() else { return Fetch::Failed("neplatná cesta".into()) };
    if let Err(e) = std::fs::create_dir_all(dir) {
        return Fetch::Failed(e.to_string());
    }
    let part = partial_path(target);
    let resumed = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let (mut result, mut last_line) = run_curl(url, &part, resumed, cancel, &mut on_percent);
    // Server navázání neumí – celý soubor znovu
    if resumed > 0 && matches!(&result, Ok(exit) if exit.code == CURL_CANNOT_RESUME && !exit.cancelled) {
        let _ = std::fs::remove_file(&part);
        (result, last_line) = run_curl(url, &part, 0, cancel, &mut on_percent);
    }

    match result {
        Ok(exit) if exit.cancelled => Fetch::Cancelled,
        Ok(exit) if exit.code == 0 => {
            let _ = std::fs::remove_file(target);
            match std::fs::rename(&part, target) {
                Ok(()) => Fetch::Done,
                Err(e) => Fetch::Failed(e.to_string()),
            }
        }
        Ok(_) => {
            let _ = std::fs::remove_file(&part);
            Fetch::Failed(last_line)
        }
        Err(e) => Fetch::Failed(e),
    }
}

/// Jedno spuštění curl; `resumed` = bajty už stažené dřív (naváže se na ně).
fn run_curl(url: &str, part: &Path, resumed: u64, cancel: &CancelToken, on_percent: &mut impl FnMut(f64)) -> (Result<process::Exit, String>, String) {
    let curl = system_tool("curl.exe");
    let mut command = hidden_command(&curl.to_string_lossy());
    command.args([
        "--location",
        "--fail",
        "--show-error",
        "--retry",
        "2",
        "--connect-timeout",
        "30",
        // Zaseknuté stahování (méně než 1 kB/s po dobu minuty) vzdát – stáhne winget
        "--speed-limit",
        "1024",
        "--speed-time",
        "60",
    ]);
    if resumed > 0 {
        command.args(["--continue-at", "-"]);
    }
    let limit = LIMIT_KBPS.load(Ordering::Relaxed);
    if limit > 0 {
        command.arg("--limit-rate").arg(format!("{limit}k"));
    }
    command.arg("--output").arg(part).arg(url);

    let mut largest_total = 0.0;
    let mut last_line = String::new();
    let result = process::run_streaming(command, cancel, |output| {
        if let Output::Line(line) = output {
            match meter_percent(line, &mut largest_total) {
                Some((percent, total)) => on_percent(overall_percent(resumed as f64, percent, total)),
                None => last_line = line.to_string(),
            }
        }
    });
    (result, last_line)
}

/// Celkové procento po navázání: curl ukazuje procenta jen ze zbývající části
/// (ověřeno: po 2 MB stažených dřív končí na „100 % z 5.55M“) – připočte se už stažené.
fn overall_percent(resumed: f64, percent: f64, remaining_total: f64) -> f64 {
    if resumed <= 0.0 {
        return percent;
    }
    ((resumed + remaining_total * percent / 100.0) / (resumed + remaining_total) * 100.0).clamp(0.0, 100.0)
}

/// Instalátor stažený dřív, který winget po ověření přejmenoval na jméno ze serveru
/// („OBS-Studio-33.0.3-Windows-x64-Installer.exe“) – při opakování operace se najde podle
/// SHA-256 ve stejné složce a vrátí se pod jméno, kde ho winget hledá (místo nového stahování).
pub fn reuse_renamed(target: &Path, sha256: &str) -> bool {
    let Some(dir) = target.parent() else { return false };
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    let part = partial_path(target);
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path != target && path != &part && path.is_file())
        .find(|path| sha256_matches(path, sha256))
        .is_some_and(|path| std::fs::rename(&path, target).is_ok())
}

/// Má soubor očekávaný SHA-256 (hex, na velikosti písmen nezáleží)?
pub fn sha256_matches(path: &Path, expected: &str) -> bool {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            Err(_) => return false,
        }
    }
    let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    actual.eq_ignore_ascii_case(expected)
}

/// Procenta z řádku ukazatele průběhu curl:
/// „ 11 60.45M  11  6.76M   0      0  3.23M      0   00:18   00:02   00:16  6.76M“.
/// Přesměrování (pár bajtů s „100 %“) se přeskakují – platí jen řádky
/// s největší dosud viděnou celkovou velikostí, nejméně 256 kB.
fn meter_percent(line: &str, largest_total: &mut f64) -> Option<(f64, f64)> {
    let columns: Vec<&str> = line.split_whitespace().collect();
    if columns.len() < 4 {
        return None;
    }
    let percent: f64 = columns[0].parse().ok()?;
    let total = size_bytes(columns[1])?;
    if total < 256.0 * 1024.0 || total < *largest_total || !(0.0..=100.0).contains(&percent) {
        return None;
    }
    *largest_total = total;
    Some((percent, total))
}

/// „60.45M“ → bajty (curl používá násobky 1024: k, M, G, T).
fn size_bytes(text: &str) -> Option<f64> {
    let (number, multiplier) = match text.chars().last()? {
        'k' => (&text[..text.len() - 1], 1024.0),
        'M' => (&text[..text.len() - 1], 1024.0 * 1024.0),
        'G' => (&text[..text.len() - 1], 1024.0 * 1024.0 * 1024.0),
        'T' => (&text[..text.len() - 1], 1024.0 * 1024.0 * 1024.0 * 1024.0),
        _ => (text, 1.0),
    };
    number.parse::<f64>().ok().map(|n| n * multiplier)
}

/// Velikost souboru podle hlaviček odpovědi (s přesměrováními). Server bez
/// HEAD se zeptá na první bajt a velikost vyčte z Content-Range.
pub fn content_length(url: &str) -> Option<u64> {
    let curl = system_tool("curl.exe");
    let run = |args: &[&str]| {
        let mut command = hidden_command(&curl.to_string_lossy());
        command.args(args);
        process::run(command, Duration::from_secs(20)).ok().map(|output| output.stdout)
    };

    let head = run(&["-sIL", "--max-time", "15", url])?;
    if let Some(length) = final_header(&head, "content-length").and_then(|v| v.parse().ok()).filter(|&n| n > 0) {
        return Some(length);
    }
    let ranged = run(&["-sL", "--max-time", "15", "-r", "0-0", "-D", "-", "-o", "NUL", url])?;
    final_header(&ranged, "content-range")?.rsplit('/').next()?.trim().parse().ok()
}

/// Hlavička poslední odpovědi (po přesměrováních).
fn final_header(headers: &str, name: &str) -> Option<String> {
    let mut value = None;
    for line in headers.lines() {
        if line.starts_with("HTTP/") {
            value = None; // nová odpověď
        } else if let Some((key, rest)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case(name) {
                value = Some(rest.trim().to_string());
            }
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curl_meter() {
        let mut largest = 0.0;
        assert_eq!(meter_percent("  % Total    % Received % Xferd  Average Speed", &mut largest), None);
        // Tělo přesměrování – 145 bajtů, „100 %“ se ignoruje
        assert_eq!(meter_percent("100    145 100    145   0      0    318      0      0", &mut largest), None);
        assert_eq!(meter_percent(" 11 60.45M  11  6.76M   0      0  3.23M      0   00:18", &mut largest).map(|(p, _)| p), Some(11.0));
        assert_eq!(meter_percent("100 60.45M 100 60.45M   0      0  5.1M      0   00:12", &mut largest).map(|(p, _)| p), Some(100.0));
        assert_eq!(size_bytes("1234k"), Some(1234.0 * 1024.0));
    }

    #[test]
    fn prejmenovany_instalator() {
        let dir = std::env::temp_dir().join(format!("hubget-reuse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Setup-1.0.exe"), b"hubget").unwrap();
        std::fs::write(dir.join("jiny.exe"), b"jine").unwrap();
        let sha = "f6b2b81d1ef7a1d1d4ec8a1c3f6c9e7b1d1dbb4e8ebab2f0b9b1c8f7a74f5f2d";
        let target = dir.join("0123abcd");
        // Jiný obsah – nic
        assert!(!reuse_renamed(&target, sha));
        // Shodný SHA-256 – přejmenuje se zpět
        let real: String = {
            use sha2::{Digest, Sha256};
            Sha256::digest(b"hubget").iter().map(|b| format!("{b:02x}")).collect()
        };
        assert!(reuse_renamed(&target, &real));
        assert!(target.exists() && !dir.join("Setup-1.0.exe").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn procenta_po_navazani() {
        // Bez navázání beze změny
        assert_eq!(overall_percent(0.0, 40.0, 1000.0), 40.0);
        // 2 MB staženo dřív, zbývá 6 MB: začátek navázání = 25 %, konec = 100 %
        let mb = 1024.0 * 1024.0;
        assert_eq!(overall_percent(2.0 * mb, 0.0, 6.0 * mb), 25.0);
        assert_eq!(overall_percent(2.0 * mb, 50.0, 6.0 * mb), 62.5);
        assert_eq!(overall_percent(2.0 * mb, 100.0, 6.0 * mb), 100.0);
    }

    #[test]
    fn final_header_after_redirect() {
        let headers = "HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: x\r\n\r\nHTTP/1.1 200 OK\r\ncontent-length: 46269360\r\n";
        assert_eq!(final_header(headers, "Content-Length").as_deref(), Some("46269360"));
        assert_eq!(final_header("HTTP/1.1 302 Found\r\nContent-Length: 0\r\n\r\nHTTP/1.1 200 OK\r\n", "content-length"), None);
    }
}
