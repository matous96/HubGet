//! Průběh operace pro kartu aplikace: fáze a procenta.
//!
//! - Nejpřesnější průběh: instalátor předem stáhne HubGet (download.rs)
//!   a hlásí procenta z curl – viz `Tracker::prefetching`.
//! - Když předstažení nejde, stahuje správce sám. S přesměrovaným výstupem
//!   průběh většinou nevypisuje (winget kreslí pruh jen do konzole), fáze se
//!   proto určuje z výstupu nezávisle na jazyce: řádek končící adresou URL =
//!   začátek stahování, další řádek = staženo (následuje kontrola součtu
//!   a instalace). Přibližná procenta dopočítá [`DownloadWatch`] z rostoucího
//!   souboru v pracovní složce správce.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::ipc::Channel;

use crate::download::content_length;
use crate::operations::{Kind, OpEvent, Phase, Spec};

/// Odesílá průběh do frontendu; sdílí ho výstup procesu i hlídání stahování.
struct Sender {
    channel: Channel<OpEvent>,
    /// Naposledy odeslaná fáze a celé procento.
    last: Mutex<(Option<Phase>, Option<i64>)>,
}

impl Sender {
    fn phase(&self) -> Option<Phase> {
        self.last.lock().unwrap_or_else(|e| e.into_inner()).0
    }

    fn set(&self, phase: Phase, percent: Option<f64>) {
        self.send_if(phase, percent, |_| true);
    }

    /// Procenta stahování – jen dokud fáze stahování trvá (hlídání běží
    /// v jiném vlákně a nesmí přepsat pozdější fázi).
    fn download_percent(&self, percent: f64) {
        self.send_if(Phase::Downloading, Some(percent), |current| current == Some(Phase::Downloading));
    }

    /// Pošle průběh jen při změně fáze nebo celého procenta.
    fn send_if(&self, phase: Phase, percent: Option<f64>, allowed: impl Fn(Option<Phase>) -> bool) {
        let rounded = percent.map(|p| p.round() as i64);
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if !allowed(last.0) || *last == (Some(phase), rounded) {
            return;
        }
        *last = (Some(phase), rounded);
        let _ = self.channel.send(OpEvent::Progress { phase, percent: rounded.map(|p| p as f64) });
    }
}

/// Převádí výstup procesu na fáze a procenta; řádky výstupu posílá do protokolu.
pub struct Tracker<'a> {
    spec: &'a Spec,
    sender: Arc<Sender>,
    started_at: SystemTime,
    /// Správce průběh vypisuje sám (řádky s procenty).
    reported: bool,
    /// Stahování podle výstupu dosáhlo 100 %.
    downloaded: bool,
    /// Poslední řádek byl adresa stahování.
    after_url: bool,
    watch: Option<DownloadWatch>,
    /// Instalátor předem stáhl HubGet (download.rs) – správce už jen instaluje.
    prefetched: bool,
    last_line: Option<String>,
    /// Poslední řádek, který hlásí chybu (error_line) – lepší vodítko než poslední řádek.
    error_line: Option<String>,
    /// Instalátor spadl – kód výjimky Windows z výstupu správce (0xC0000005…).
    crash: Option<u32>,
}

/// Řádek s chybovou hláškou správce: Chocolatey „ERROR: Running […] was not successful. Exit
/// code was '1603'…“, Scoop a winget „Error: …“ / „error: …“, winget „Installer failed with
/// exit code: 1603“. Poslední řádek Chocolatey („See the log for details“) o příčině nic neříká.
fn error_line(text: &str) -> bool {
    let line = text.trim_start().to_ascii_lowercase();
    line.starts_with("error") || line.starts_with("installer failed") || line.starts_with("fatal")
}

impl<'a> Tracker<'a> {
    pub fn new(spec: &'a Spec, channel: Channel<OpEvent>) -> Self {
        Tracker {
            spec,
            sender: Arc::new(Sender { channel, last: Mutex::new((None, None)) }),
            started_at: SystemTime::now(),
            reported: false,
            downloaded: false,
            after_url: false,
            watch: None,
            prefetched: false,
            last_line: None,
            error_line: None,
            crash: None,
        }
    }

    /// Kód výjimky, se kterou instalátor spadl (z výstupu správce), jinak None.
    pub fn crash(&self) -> Option<u32> {
        self.crash
    }

    /// Fáze po stažení instalátoru.
    fn install_phase(&self) -> Phase {
        if self.spec.interactive {
            Phase::Interactive
        } else {
            Phase::Installing
        }
    }

    /// Čeká se na potvrzení dialogu UAC.
    pub fn elevating(&self) {
        self.sender.set(Phase::Elevating, None);
    }

    /// HubGet stahuje instalátor sám (průběh hlásí `download_percent`).
    pub fn prefetching(&self) {
        self.sender.set(Phase::Downloading, None);
    }

    pub fn download_percent(&self, percent: f64) {
        self.sender.download_percent(percent);
    }

    /// Instalátor je stažený – správce ho najde a jen ověří a nainstaluje
    /// (u „Stáhnout instalátor“ ho jen přesune do složky Stažené soubory).
    pub fn prefetched(&mut self) {
        self.prefetched = true;
        self.downloaded = true;
        let (phase, percent) = self.after_download();
        self.sender.set(phase, percent);
    }

    /// Fáze a procenta po stažení instalátoru.
    fn after_download(&self) -> (Phase, Option<f64>) {
        if self.spec.kind == Kind::Download {
            (Phase::Downloading, Some(100.0))
        } else {
            (self.install_phase(), None)
        }
    }

    /// Hláška pro protokol, kterou přeloží frontend (např. „retryElevated“).
    pub fn notice(&self, key: &'static str, detail: Option<String>) {
        let _ = self.sender.channel.send(OpEvent::Notice { key, detail });
    }

    /// Proces běží.
    pub fn started(&mut self) {
        let (phase, percent) = match self.spec.kind {
            Kind::Uninstall => (Phase::Uninstalling, None),
            _ if self.prefetched => self.after_download(),
            _ => (Phase::Downloading, None),
        };
        self.sender.set(phase, percent);
    }

    /// Vodítko k neznámé chybě: poslední řádek s chybovou hláškou, jinak poslední řádek výstupu.
    pub fn take_last_line(&mut self) -> Option<String> {
        self.error_line.take().or_else(|| self.last_line.take())
    }

    pub fn line(&mut self, text: &str) {
        // Výstup PowerShellu jako CLIXML („#< CLIXML“, „<Objs …>“) → jen čitelné hlášky
        if text.starts_with("#< CLIXML") {
            return;
        }
        if text.starts_with("<Objs") {
            for message in clixml_messages(text) {
                self.line(&message);
            }
            return;
        }
        let phase = self.sender.phase().unwrap_or(Phase::Downloading);

        if let Some(percent) = (self.spec.parse_progress)(text) {
            self.reported = true;
            self.watch = None; // správce hlásí průběh sám
            if phase == Phase::Downloading && percent >= 99.9 {
                self.downloaded = true;
            }
            self.sender.set(phase, Some(percent));
            return; // řádky s průběhem do protokolu nepatří
        }

        if self.spec.kind != Kind::Uninstall {
            if let Some(url) = download_url(text) {
                // Adresa až po přepnutí na instalaci: předchozí adresa nebyla stahováním
                // (třeba odkaz v licenčních podmínkách) – stahuje se teprve teď
                if matches!(phase, Phase::Installing | Phase::Interactive) && !self.reported {
                    self.sender.set(Phase::Downloading, None);
                }
                self.after_url = true;
                if !self.reported {
                    self.watch = Some(DownloadWatch::start(
                        url,
                        self.spec.download_dirs.clone(),
                        self.started_at,
                        Arc::clone(&self.sender),
                    ));
                }
            } else if phase == Phase::Downloading && (self.downloaded || self.after_url) {
                // Staženo – dál následuje ověření součtu a instalace
                self.watch = None;
                self.after_url = false;
                if self.spec.kind != Kind::Download {
                    self.sender.set(self.install_phase(), None);
                }
            }
        }

        if self.crash.is_none() {
            self.crash = installer_crash(text);
        }
        let _ = self.sender.channel.send(OpEvent::Line { text: text.to_string() });
        if error_line(text) {
            self.error_line = Some(text.trim().to_string());
        }
        self.last_line = Some(text.to_string());
    }
}

/// Kód výjimky Windows (NTSTATUS 0xC00xxxxx – narušení přístupu, přetečení
/// zásobníku…) v řádku výstupu: winget a další správci vypisují návratový kód
/// instalátoru, který spadl, jako číslo bez znaménka (3221225477), se znaménkem
/// (-1073741819) nebo šestnáctkově (0xC0000005) – v každém jazyce stejně.
pub fn installer_crash(line: &str) -> Option<u32> {
    const CRASH: std::ops::RangeInclusive<u32> = 0xC000_0000..=0xC00F_FFFF;
    line.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .filter_map(|word| {
            if let Some(hex) = word.strip_prefix("0x").or_else(|| word.strip_prefix("0X")) {
                u32::from_str_radix(hex, 16).ok()
            } else if word.len() >= 10 {
                // Desetinně: bez znaménka i se znaménkem (i32 jako u32)
                word.parse::<u32>().ok().or_else(|| word.parse::<i32>().ok().map(|v| v as u32))
            } else {
                None
            }
        })
        .find(|code| CRASH.contains(code))
}

/// Hlášky z CLIXML (serializované proudy PowerShellu): text informačních a chybových
/// záznamů (`<S N="Message">…</S>`, jinak `<ToString>…</ToString>`); průběh se vynechá.
fn clixml_messages(xml: &str) -> Vec<String> {
    let decode = |s: &str| {
        s.replace("_x000D_", "").replace("_x000A_", " ").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
    };
    let mut messages = Vec::new();
    for record in xml.split("<Obj S=\"").skip(1) {
        if record.starts_with("progress") {
            continue;
        }
        let between = |open: &str, close: &str| {
            let start = record.find(open)? + open.len();
            Some(&record[start..start + record[start..].find(close)?])
        };
        if let Some(text) = between("<S N=\"Message\">", "</S>").or_else(|| between("<ToString>", "</ToString>")) {
            let text = decode(text).trim().to_string();
            if !text.is_empty() {
                messages.push(text);
            }
        }
    }
    messages
}

/// Adresa na konci řádku („Downloading https://…/setup.exe“ v jakémkoli jazyce).
fn download_url(line: &str) -> Option<&str> {
    let last = line.split_whitespace().last()?;
    (last.starts_with("https://") || last.starts_with("http://")).then_some(last)
}

/// Hlídá stahování na pozadí: procenta = velikost rostoucího souboru / celková
/// velikost z hlaviček. Skončí, když se zahodí.
struct DownloadWatch {
    stop: Arc<AtomicBool>,
}

impl DownloadWatch {
    fn start(url: &str, dirs: Vec<PathBuf>, since: SystemTime, sender: Arc<Sender>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = Arc::clone(&stop);
        let url = url.to_string();
        thread::spawn(move || {
            let Some(total) = content_length(&url) else { return };
            while !stopped.load(Ordering::SeqCst) {
                if let Some(size) = largest_new_file(&dirs, since) {
                    // 100 % až po ověření souboru (další řádek výstupu)
                    sender.download_percent((size as f64 / total as f64 * 100.0).min(99.0));
                }
                thread::sleep(Duration::from_millis(250));
            }
        });
        DownloadWatch { stop }
    }
}

impl Drop for DownloadWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Největší soubor změněný od začátku operace (stahovaný instalátor).
/// Podsložka „cache“ (manifesty wingetu) se přeskakuje.
fn largest_new_file(dirs: &[PathBuf], since: SystemTime) -> Option<u64> {
    fn walk(dir: &Path, since: SystemTime, depth: u32, best: &mut Option<u64>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if depth < 3 && entry.file_name() != "cache" {
                    walk(&entry.path(), since, depth + 1, best);
                }
            } else if meta.modified().is_ok_and(|m| m >= since) && best.map_or(true, |b| meta.len() > b) {
                *best = Some(meta.len());
            }
        }
    }
    let mut best = None;
    for dir in dirs {
        walk(dir, since, 0, &mut best);
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_lines_from_managers() {
        assert!(error_line("ERROR: Running [\"C:\\aimp.exe\" /SILENT] was not successful. Exit code was '1603'."));
        assert!(error_line("  Error: Couldn't find manifest for 'foo'."));
        assert!(error_line("Installer failed with exit code: 1603"));
        assert!(!error_line("Chocolatey installed 0/1 packages. 1 packages failed."));
        assert!(!error_line(" See the log for details (C:\\ProgramData\\chocolatey\\logs\\chocolatey.log)."));
        assert!(!error_line("No errors found"));
    }

    #[test]
    fn clixml_to_messages() {
        // Zkrácený skutečný výstup Scoopu: průběh se vynechá, hlášky zůstanou čitelné
        let xml = r#"<Objs Version="1.1.0.1"><Obj S="progress" RefId="0"><MS><PR N="Record"><AV>Preparing modules for first use.</AV></PR></MS></Obj><Obj S="information" RefId="4"><ToString>ERROR Git is required for buckets.</ToString><Props><Obj N="MessageData" RefId="5"><Props><S N="Message">ERROR Git is required for buckets.</S></Props></Obj></Props></Obj><Obj S="information" RefId="15"><ToString>Couldn&apos;t find manifest for &apos;x&apos; from &apos;extras&apos; bucket.</ToString></Obj></Objs>"#;
        assert_eq!(
            clixml_messages(xml),
            ["ERROR Git is required for buckets.", "Couldn't find manifest for 'x' from 'extras' bucket."]
        );
    }

    #[test]
    fn url_at_line_end() {
        assert_eq!(download_url("Downloading https://a.b/setup.exe"), Some("https://a.b/setup.exe"));
        assert_eq!(download_url("Wird heruntergeladen http://x.y/z.msi"), Some("http://x.y/z.msi"));
        assert_eq!(download_url("Successfully verified installer hash"), None);
    }

    #[test]
    fn crash_codes_in_output() {
        // Skutečný výstup wingetu (GeForce NOW) a jiné zápisy téhož kódu
        assert_eq!(installer_crash("Installer failed with exit code: 3221225477"), Some(0xC000_0005));
        assert_eq!(installer_crash("Instalační program selhal s ukončovacím kódem: -1073741819"), Some(0xC000_0005));
        assert_eq!(installer_crash("exit code 0xC0000409"), Some(0xC000_0409));
        // Běžné kódy chyb instalátorů ani HRESULT wingetu za pád nepovažovat
        assert_eq!(installer_crash("Installer failed with exit code: 1603"), None);
        assert_eq!(installer_crash("0x8A150006 : Running ShellExecute failed"), None);
        assert_eq!(installer_crash("Downloading 2147483648 bytes"), None);
    }
}
