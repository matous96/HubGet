//! CLI motor: spouštění správců balíčků bez okna konzole a čtení jejich
//! výstupu po řádcích.
//!
//! Správci balíčků vypisují průběh stahování přepisováním jednoho řádku
//! (`\r`), točítkem s backspacy (`\b`) a escape sekvencemi terminálu –
//! [`LineSplitter`] z toho udělá čisté řádky textu. Zrušení ukončí celý
//! strom procesů (správce i instalátor, který spustil).

use std::io::Read;
use std::iter::Peekable;
use std::process::{Child, Command, Stdio};
use std::str::Chars;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// CREATE_NO_WINDOW – konzolový program se spustí bez okna.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Nástroj Windows ze System32 (ne přes PATH, ať ho nic nepodvrhne).
pub fn system_tool(name: &str) -> std::path::PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    std::path::Path::new(&root).join("System32").join(name)
}

/// Soubor programu z proměnné PATH (první nalezený), None = v PATH není.
pub fn find_in_path(file: &str) -> Option<std::path::PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths).map(|dir| dir.join(file)).find(|path| path.is_file())
}

/// Příkaz bez okna konzole se zachyceným výstupem a bez vstupu.
pub fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// Spustí blokující práci mimo vlákno uživatelského rozhraní.
pub async fn background<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

/// Výsledek krátkého příkazu (verze, výpis…).
pub struct Captured {
    pub code: i32,
    pub stdout: String,
}

/// Výsledek příkazu s binárním výstupem (stažený obrázek).
pub struct CapturedBytes {
    pub code: i32,
    pub stdout: Vec<u8>,
}

/// Spustí příkaz, počká na konec (nejdéle `timeout`) a vrátí jeho výstup jako text.
pub fn run(command: Command, timeout: Duration) -> Result<Captured, String> {
    let output = run_bytes(command, timeout)?;
    Ok(Captured { code: output.code, stdout: String::from_utf8_lossy(&output.stdout).into_owned() })
}

/// Spustí příkaz, počká na konec (nejdéle `timeout`) a vrátí jeho výstup.
pub fn run_bytes(mut command: Command, timeout: Duration) -> Result<CapturedBytes, String> {
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdout = read_to_end(child.stdout.take());
    let stderr = read_to_end(child.stderr.take()); // čte se i kvůli tomu, aby se roura nezaplnila
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > timeout {
            kill_tree(&mut child);
            return Err("Příkaz neodpověděl včas".into());
        }
        thread::sleep(Duration::from_millis(25));
    };
    let _ = stderr.join();
    Ok(CapturedBytes { code: status.code().unwrap_or(-1), stdout: stdout.join().unwrap_or_default() })
}

fn read_to_end<R: Read + Send + 'static>(stream: Option<R>) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut stream) = stream {
            let _ = stream.read_to_end(&mut buffer);
        }
        buffer
    })
}

/// Žádost o zrušení běžící operace (sdílená mezi příkazem a během procesu).
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Jak skončil proces spuštěný s průběžným výstupem.
pub struct Exit {
    pub code: i32,
    /// Ukončeno na žádost uživatele (nebo uživatel odmítl dialog UAC).
    pub cancelled: bool,
}

/// Událost během běhu procesu.
pub enum Output<'a> {
    /// Proces běží (u povýšeného procesu až po potvrzení dialogu UAC).
    Started,
    /// Jeden vyčištěný řádek výstupu.
    Line(&'a str),
}

/// Spustí příkaz a průběžně předává jeho výstup po řádcích. Při zrušení
/// ukončí proces i jeho potomky.
pub fn run_streaming(
    mut command: Command,
    cancel: &CancelToken,
    mut on_output: impl FnMut(Output),
) -> Result<Exit, String> {
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    on_output(Output::Started);

    // stdout i stderr čtou samostatná vlákna, obsah posílají sem
    let (tx, rx) = mpsc::channel::<(bool, Vec<u8>)>();
    if let Some(stdout) = child.stdout.take() {
        pump(stdout, false, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, true, tx.clone());
    }
    drop(tx);

    let mut out = LineSplitter::default();
    let mut err = LineSplitter::default();
    let mut emit = |line: &str| on_output(Output::Line(line));
    let mut killed = false;
    let mut exited_at: Option<Instant> = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok((false, chunk)) => out.feed(&chunk, &mut emit),
            Ok((true, chunk)) => err.feed(&chunk, &mut emit),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if cancel.is_cancelled() && !killed {
            kill_tree(&mut child);
            killed = true;
        }
        // Proces skončil, ale rouru drží otevřenou jeho potomek (instalátor) – dál nečekat
        if exited_at.is_none() && matches!(child.try_wait(), Ok(Some(_))) {
            exited_at = Some(Instant::now());
        }
        if exited_at.is_some_and(|at| at.elapsed() > Duration::from_secs(2)) {
            break;
        }
    }
    out.finish(&mut emit);
    err.finish(&mut emit);

    let status = child.wait().map_err(|e| e.to_string())?;
    Ok(Exit { code: status.code().unwrap_or(-1), cancelled: killed })
}

/// Čte proud do konce a posílá ho po kouscích do kanálu.
pub fn pump(mut stream: impl Read + Send + 'static, is_stderr: bool, tx: mpsc::Sender<(bool, Vec<u8>)>) {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send((is_stderr, buffer[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Ukončí proces i všechny jeho potomky (správce balíčků spouští instalátory).
pub fn kill_tree(child: &mut Child) {
    kill_pid_tree(child.id());
    let _ = child.kill();
}

pub fn kill_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = hidden_command(&system_tool("taskkill.exe").to_string_lossy())
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// Skládá výstup z kousků do řádků. Řádek končí `\n` i `\r` – přepisovaný
/// řádek s průběhem tak přijde jako samostatný řádek při každé změně.
#[derive(Default)]
pub struct LineSplitter {
    buffer: Vec<u8>,
}

impl LineSplitter {
    pub fn feed(&mut self, chunk: &[u8], on_line: &mut impl FnMut(&str)) {
        for &byte in chunk {
            if byte == b'\n' || byte == b'\r' {
                self.flush(on_line);
            } else {
                self.buffer.push(byte);
            }
        }
    }

    /// Předá zbytek bez koncového odřádkování.
    pub fn finish(&mut self, on_line: &mut impl FnMut(&str)) {
        self.flush(on_line);
    }

    fn flush(&mut self, on_line: &mut impl FnMut(&str)) {
        if self.buffer.is_empty() {
            return;
        }
        // Kousky se skládají po bajtech, takže znak UTF-8 se nikdy nerozdělí
        let line = clean_line(&String::from_utf8_lossy(&self.buffer));
        self.buffer.clear();
        if !line.is_empty() {
            on_line(&line);
        }
    }
}

/// Odstraní escape sekvence terminálu a řídicí znaky, provede backspacy
/// a zahodí řádky, které obsahují jen točítko („-“, „\“, „|“, „/“).
pub fn clean_line(raw: &str) -> String {
    let mut out: Vec<char> = Vec::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => skip_escape(&mut chars),
            '\u{8}' => {
                out.pop();
            }
            '\t' => out.push(' '),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    let text: String = out.into_iter().collect();
    let text = text.trim();
    if text.chars().all(|c| matches!(c, '-' | '\\' | '|' | '/' | ' ')) {
        return String::new();
    }
    text.to_string()
}

/// Přeskočí escape sekvenci: CSI (`ESC [ … písmeno`) nebo OSC (`ESC ] … BEL / ESC \`).
fn skip_escape(chars: &mut Peekable<Chars>) {
    match chars.next() {
        Some('[') => {
            for c in chars.by_ref() {
                if ('@'..='~').contains(&c) {
                    break;
                }
            }
        }
        Some(']') => {
            while let Some(c) = chars.next() {
                if c == '\u{7}' {
                    break;
                }
                if c == '\u{1b}' {
                    chars.next();
                    break;
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn cancel_kills_process_tree() {
        // cmd spustí ping jako potomka – zrušení musí ukončit oba
        let mut command = hidden_command("cmd");
        command.args(["/c", "ping", "-n", "30", "127.0.0.1"]);
        let token = CancelToken::default();
        let canceller = token.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(800));
            canceller.cancel();
        });
        let started = Instant::now();
        let mut lines = 0;
        let exit = run_streaming(command, &token, |output| {
            if let Output::Line(_) = output {
                lines += 1;
            }
        })
        .unwrap();
        assert!(exit.cancelled);
        assert!(lines > 0);
        assert!(started.elapsed() < Duration::from_secs(10), "trvalo {:?}", started.elapsed());
    }

    #[test]
    fn splits_progress_and_spinner() {
        let mut lines = Vec::new();
        let mut splitter = LineSplitter::default();
        let mut push = |l: &str| lines.push(l.to_string());
        splitter.feed(b"  -\x08\\\x08|\x08\rFound \x1b[96mVLC\x1b[0m [VideoLAN.VLC]\r\n", &mut push);
        splitter.feed("  ██▒▒  1.00 MB / 2.00 MB\r  ████  2.00 MB / 2.00 MB\r\nHotovo ✓".as_bytes(), &mut push);
        splitter.finish(&mut push);
        assert_eq!(
            lines,
            ["Found VLC [VideoLAN.VLC]", "██▒▒  1.00 MB / 2.00 MB", "████  2.00 MB / 2.00 MB", "Hotovo ✓"]
        );
    }
}
