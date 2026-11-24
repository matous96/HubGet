//! Spuštění příkazu s právy správce (UAC).
//!
//! HubGet spustí sám sebe s parametrem [`ELEVATED_FLAG`] přes ShellExecuteEx
//! („runas“) – Windows zobrazí dialog UAC. Povýšený pomocný proces spustí
//! správce balíčků, jeho výstup zapisuje do dočasného souboru a skončí s jeho
//! návratovým kódem. Hlavní aplikace soubor průběžně čte, takže průběh
//! i protokol fungují stejně jako bez povýšení. Zrušení se předá souborem
//! `.cancel` (běžný proces nemůže povýšený proces ukončit přímo).
//!
//! „Požádat o práva správce jen jednou“ (nebezpečné nastavení, výchozí vypnuto):
//! první povýšená operace spustí pomocníka s [`ELEVATED_SESSION_FLAG`], který
//! běží do konce HubGetu a další operace bere ze souborů `<n>.job` ve složce
//! relace – bez dalšího dialogu UAC. Přijme jen povolené programy, operaci
//! s tajným klíčem relace a bezpečný tvar příkazu (instalace podle id, žádné
//! vlastní manifesty ani zdroje; moduly PowerShellu jen ve tvaru, jaký sestaví
//! HubGet); jiný příkaz jde přes běžné povýšení s UAC. Stejného pomocníka používá
//! i dávka „Čeká na potvrzení“ (jeden dialog UAC) – po jejím konci skončí.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::process::{CancelToken, Exit, Output};

/// Parametr, se kterým se HubGet spouští jako povýšený pomocný proces.
pub const ELEVATED_FLAG: &str = "--unibox-elevated";
/// Parametr povýšeného pomocníka pro celé spuštění HubGetu.
pub const ELEVATED_SESSION_FLAG: &str = "--unibox-elevated-session";

/// Programy, které smí pomocný proces spustit s právy správce.
const ALLOWED_PROGRAMS: &[&str] = &["winget", "choco"];

/// Oficiální instalace Chocolatey (choco.rs) – jediný příkaz PowerShellu,
/// který smí běžet s právy správce, a to jen přesně v této podobě.
pub const CHOCO_SETUP_ARGS: &[&str] = &[
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; \
     iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))",
];

/// Je to přesně oficiální instalace Chocolatey (powershell.exe se skriptem výše)?
fn is_setup_command(program: &str, args: &[String]) -> bool {
    let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    stem == "powershell" && args.len() == CHOCO_SETUP_ARGS.len() && args.iter().zip(CHOCO_SETUP_ARGS).all(|(a, b)| a == b)
}

/// Zadání pro povýšený proces (předává se v příkazové řádce, ne souborem,
/// aby ho jiný proces nemohl po potvrzení UAC podvrhnout).
#[derive(Serialize, Deserialize)]
struct Job {
    program: String,
    args: Vec<String>,
    log: PathBuf,
    cancel: PathBuf,
}

/// Smí příkaz běžet s právy správce? Povolené programy, oficiální instalace Chocolatey,
/// operace s moduly PowerShellu v podobě, jakou sestaví HubGet (dev.rs), a dokončení odložené
/// registrace připravené aktualizace MSIX (package_services.rs – jen balíček ve WindowsApps).
fn may_elevate(program: &str, args: &[String]) -> bool {
    is_allowed(program)
        || is_setup_command(program, args)
        || crate::dev::is_module_command(program, args)
        || crate::package_services::is_register_command(program, args)
        || crate::privacy::is_policy_command(program, args)
}

/// Je program na seznamu povolených („C:\…\winget.exe“ → „winget“)?
pub fn is_allowed(program: &str) -> bool {
    let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    ALLOWED_PROGRAMS.contains(&stem.as_str())
}

/// Spustí program s právy správce a průběžně předává jeho výstup.
/// Odmítnutí dialogu UAC se hlásí jako zrušení.
#[cfg(windows)]
pub fn run_elevated(
    program: &str,
    args: &[String],
    cancel: &CancelToken,
    mut on_output: impl FnMut(Output),
) -> Result<Exit, String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    if !may_elevate(program, args) {
        return Err(format!("{program} nelze spustit jako správce"));
    }

    // Soubor s výstupem založí běžný proces; povýšený do něj jen připisuje
    let dir = std::env::temp_dir().join("HubGet");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let log = dir.join(format!("elevated-{stamp}.log"));
    let cancel_file = log.with_extension("cancel");
    fs::write(&log, b"").map_err(|e| e.to_string())?;

    let job = Job { program: program.into(), args: args.to_vec(), log: log.clone(), cancel: cancel_file.clone() };
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&job).map_err(|e| e.to_string())?);
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    let wide = |text: &std::ffi::OsStr| {
        use std::os::windows::ffi::OsStrExt;
        text.encode_wide().chain(Some(0)).collect::<Vec<u16>>()
    };
    let file = wide(exe.as_os_str());
    let verb = wide("runas".as_ref());
    let params = wide(format!("{ELEVATED_FLAG} {payload}").as_ref());

    // SAFETY: struktura se vynuluje a vyplní platnými ukazateli na řetězce,
    // které žijí až do konce funkce.
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE;

    // Vrátí se, až uživatel dialog UAC potvrdí nebo odmítne
    let cleanup = || {
        let _ = fs::remove_file(&log);
        let _ = fs::remove_file(&cancel_file);
    };
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let error = unsafe { GetLastError() };
        cleanup();
        if error == ERROR_CANCELLED {
            return Ok(Exit { code: ERROR_CANCELLED as i32, cancelled: true });
        }
        return Err(format!("Spuštění s právy správce selhalo (chyba {error})"));
    }
    let process = info.hProcess;
    if process.is_null() {
        cleanup();
        return Err("Spuštění s právy správce selhalo".into());
    }
    on_output(Output::Started);

    let mut reader = LogTail::default();
    let mut cancel_sent = false;
    let mut emit = |line: &str| on_output(Output::Line(line));
    loop {
        // SAFETY: platný handle procesu z ShellExecuteEx (SEE_MASK_NOCLOSEPROCESS)
        let finished = unsafe { WaitForSingleObject(process, 150) } == WAIT_OBJECT_0;
        reader.read(&log, &mut emit);
        if cancel.is_cancelled() && !cancel_sent {
            let _ = fs::write(&cancel_file, b"");
            cancel_sent = true;
        }
        if finished {
            break;
        }
    }
    reader.finish(&mut emit);

    let mut code: u32 = 0;
    // SAFETY: platný handle, uzavře se právě jednou
    unsafe {
        GetExitCodeProcess(process, &mut code);
        CloseHandle(process);
    }
    cleanup();
    Ok(Exit { code: code as i32, cancelled: cancel_sent })
}

#[cfg(not(windows))]
pub fn run_elevated(
    _program: &str,
    _args: &[String],
    _cancel: &CancelToken,
    _on_output: impl FnMut(Output),
) -> Result<Exit, String> {
    Err("Spuštění jako správce je dostupné jen ve Windows".into())
}

/// Spustí HubGet s právy správce v pomocném režimu `flag` (např. úklid zbytků
/// po odinstalaci) a počká na něj. Vrátí jeho návratový kód, None = dialog UAC
/// odmítnut. Zadání `payload` si pomocník sám znovu ověří.
#[cfg(windows)]
pub fn run_self_elevated(flag: &str, payload: &str) -> Result<Option<u32>, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    if crate::security::policy().elevation_prohibited {
        return Err("Povýšení na správce je v Nastavení zakázané".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let wide = |text: &std::ffi::OsStr| {
        use std::os::windows::ffi::OsStrExt;
        text.encode_wide().chain(Some(0)).collect::<Vec<u16>>()
    };
    let file = wide(exe.as_os_str());
    let verb = wide("runas".as_ref());
    let params = wide(format!("{flag} {payload}").as_ref());
    // SAFETY: vynulovaná struktura s ukazateli na řetězce, které žijí do konce funkce
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE;
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let error = unsafe { GetLastError() };
        return if error == ERROR_CANCELLED { Ok(None) } else { Err(format!("Spuštění s právy správce selhalo (chyba {error})")) };
    }
    if info.hProcess.is_null() {
        return Err("Spuštění s právy správce selhalo".into());
    }
    let mut code: u32 = 0;
    // SAFETY: platný handle z ShellExecuteEx (SEE_MASK_NOCLOSEPROCESS), uzavře se právě jednou
    unsafe {
        WaitForSingleObject(info.hProcess, INFINITE);
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
    }
    Ok(Some(code))
}

#[cfg(not(windows))]
pub fn run_self_elevated(_flag: &str, _payload: &str) -> Result<Option<u32>, String> {
    Err("Spuštění jako správce je dostupné jen ve Windows".into())
}

/// Průběžné čtení souboru, do kterého zapisuje povýšený proces.
#[derive(Default)]
struct LogTail {
    offset: u64,
    lines: crate::process::LineSplitter,
}

impl LogTail {
    fn read(&mut self, path: &Path, on_line: &mut impl FnMut(&str)) {
        use std::io::{Read, Seek, SeekFrom};
        let Ok(mut file) = std::fs::File::open(path) else { return };
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut chunk = Vec::new();
        if let Ok(n) = file.read_to_end(&mut chunk) {
            self.offset += n as u64;
            self.lines.feed(&chunk, on_line);
        }
    }

    fn finish(&mut self, on_line: &mut impl FnMut(&str)) {
        self.lines.finish(on_line);
    }
}

const ERROR_ACCESS_DENIED: i32 = 5;
const ERROR_INVALID_PARAMETER: i32 = 87;

/// Vstupní bod povýšeného pomocného procesu (`unibox.exe --unibox-elevated …`).
/// Vrací návratový kód spuštěného programu.
pub fn helper_main(payload: &str) -> i32 {
    let Some(job) = URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Job>(&bytes).ok())
    else {
        return ERROR_INVALID_PARAMETER;
    };
    if !may_elevate(&job.program, &job.args) {
        return ERROR_ACCESS_DENIED;
    }
    run_to_log(&job.program, &job.args, &job.log, &job.cancel)
}

/// Spustí program (v povýšeném pomocníkovi), výstup připisuje do souboru `log`
/// a skončí s jeho návratovým kódem; existence souboru `cancel` = zrušit.
fn run_to_log(program: &str, args: &[String], log_path: &Path, cancel: &Path) -> i32 {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::process::Stdio;
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    // Jen existující soubor a bez následování odkazů (reparse point) – povýšený
    // proces tak nepřepíše nic jiného než soubor, který připravila aplikace.
    let mut options = OpenOptions::new();
    options.append(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let Ok(log) = options.open(log_path) else {
        return ERROR_INVALID_PARAMETER;
    };
    let log = Arc::new(Mutex::new(log));

    let mut child = match crate::process::hidden_command(program).args(args).stdin(Stdio::null()).spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = writeln!(log.lock().unwrap_or_else(|e| e.into_inner()), "{e}");
            return e.raw_os_error().unwrap_or(1);
        }
    };

    // Výstup se zapisuje hned, jak přijde (soubor není bufferovaný)
    let (tx, rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        crate::process::pump(stdout, false, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        crate::process::pump(stderr, true, tx.clone());
    }
    drop(tx);
    let writer = {
        let log = Arc::clone(&log);
        thread::spawn(move || {
            for (_, chunk) in rx {
                let _ = log.lock().unwrap_or_else(|e| e.into_inner()).write_all(&chunk);
            }
        })
    };

    let status = loop {
        if let Ok(Some(status)) = child.try_wait() {
            break status;
        }
        if cancel.exists() {
            crate::process::kill_tree(&mut child);
        }
        thread::sleep(Duration::from_millis(200));
    };
    // Dopsat zbytek výstupu (nečekat na potomky, kteří drží rouru otevřenou)
    let deadline = Instant::now() + Duration::from_secs(2);
    while !writer.is_finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
    status.code().unwrap_or(1)
}

// ── Povýšení jen jednou za spuštění ─────────────────────────────────────

/// Zadání pro povýšeného pomocníka na celé spuštění (v příkazové řádce).
#[derive(Serialize, Deserialize)]
struct SessionStart {
    dir: PathBuf,
    token: String,
    /// Proces HubGetu – pomocník skončí spolu s ním.
    parent: u32,
}

/// Jedna operace pro pomocníka (soubor `<n>.job` ve složce relace).
#[derive(Serialize, Deserialize)]
struct SessionJob {
    token: String,
    program: String,
    args: Vec<String>,
    log: PathBuf,
    cancel: PathBuf,
    /// Sem pomocník po skončení zapíše návratový kód.
    done: PathBuf,
}

/// Běžící povýšený pomocník: složka relace, tajný klíč a handle procesu.
struct Session {
    dir: PathBuf,
    token: String,
    process: isize,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static JOB_SEQ: AtomicU64 = AtomicU64::new(1);

/// Dávka s jediným dialogem UAC („Čeká na potvrzení“ → Aktualizovat jako správce): do jejího
/// konce povýšené operace obsluhuje pomocník relace, i když volba „pouze jednou“ vypnutá.
static BATCH: AtomicBool = AtomicBool::new(false);
/// Dialog UAC dávky odmítnut – další operace dávky se už neptají (skončí jako zrušené).
static BATCH_DECLINED: AtomicBool = AtomicBool::new(false);

/// Běží dávka s jediným dialogem UAC?
pub fn batch_active() -> bool {
    BATCH.load(Ordering::SeqCst)
}

pub fn begin_batch() {
    BATCH_DECLINED.store(false, Ordering::SeqCst);
    BATCH.store(true, Ordering::SeqCst);
}

/// Konec dávky: pomocník relace skončí, ledaže má běžet do konce HubGetu („pouze jednou“).
/// Volá se mezi operacemi – žádná ho zrovna nepoužívá.
pub fn end_batch() {
    BATCH.store(false, Ordering::SeqCst);
    BATCH_DECLINED.store(false, Ordering::SeqCst);
    if !crate::security::policy().cache_elevation {
        stop_session();
    }
}

#[cfg(windows)]
fn stop_session() {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::WaitForSingleObject;
    let Some(session) = SESSION.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return;
    };
    // Pomocník si soubor „stop“ přečte mezi operacemi, uklidí složku relace a skončí
    let _ = std::fs::write(session.dir.join("stop"), b"");
    // SAFETY: handle pomocníka z ShellExecuteEx; SESSION ho už nedrží, zavře se právě jednou
    unsafe {
        WaitForSingleObject(session.process as _, 3000);
        CloseHandle(session.process as _);
    }
}

#[cfg(not(windows))]
fn stop_session() {}

/// Bezpečný tvar příkazu pro pomocníka bez dialogu UAC: instalace, aktualizace
/// nebo odinstalace balíčku podle id z oficiálních zdrojů – žádný vlastní
/// manifest, zdroj ani adresa.
fn safe_session_args(program: &str, args: &[String]) -> bool {
    let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let verb_ok = matches!(args.first().map(String::as_str), Some("install" | "upgrade" | "uninstall"));
    let has = |flag: &str| args.iter().any(|a| a.eq_ignore_ascii_case(flag) || a.to_ascii_lowercase().starts_with(&format!("{flag}=")));
    match stem.as_str() {
        "winget" => {
            let source_ok = args
                .windows(2)
                .filter(|w| w[0] == "--source" || w[0] == "-s")
                .all(|w| w[1] == "winget" || w[1] == "msstore");
            verb_ok && has("--id") && !has("-m") && !has("--manifest") && source_ok
        }
        "choco" => verb_ok && !has("-s") && !has("--source"),
        _ => false,
    }
}

/// Příkaz, který smí obsloužit pomocník relace bez dalšího dialogu UAC: bezpečný tvar příkazu
/// wingetu či Chocolatey, nebo operace s modulem PowerShellu v podobě, jakou sestaví HubGet.
fn session_safe(program: &str, args: &[String]) -> bool {
    (is_allowed(program) && safe_session_args(program, args))
        || crate::dev::is_module_command(program, args)
        || crate::package_services::is_register_command(program, args)
        || crate::privacy::is_policy_command(program, args)
}

/// Proběhne povýšení bez dialogu UAC? Jen s volbou „Požádat … pouze jednou“, už běžícím
/// pomocníkem relace a příkazem, který pomocník přijme (automatické operace na pozadí).
pub fn elevates_silently(program: &str, args: &[String]) -> bool {
    crate::security::policy().cache_elevation && session_safe(program, args) && session_running()
}

#[cfg(windows)]
fn session_running() -> bool {
    use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
    use windows_sys::Win32::System::Threading::WaitForSingleObject;
    let session = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    // SAFETY: handle procesu pomocníka z ShellExecuteEx (drží ho SESSION po celou dobu běhu)
    session.as_ref().is_some_and(|s| unsafe { WaitForSingleObject(s.process as _, 0) } != WAIT_OBJECT_0)
}

#[cfg(not(windows))]
fn session_running() -> bool {
    false
}

/// Spustí program s právy správce přes povýšeného pomocníka relace (dialog UAC
/// jen poprvé). Jiný než bezpečný příkaz jde přes běžné povýšení s UAC.
#[cfg(windows)]
pub fn run_elevated_cached(
    program: &str,
    args: &[String],
    cancel: &CancelToken,
    mut on_output: impl FnMut(Output),
) -> Result<Exit, String> {
    use std::fs;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::WaitForSingleObject;

    let declined = Exit { code: ERROR_CANCELLED as i32, cancelled: true };
    // Dialog UAC dávky už jednou odmítnut – zbytek dávky bez dalšího dotazu zrušit
    if batch_active() && BATCH_DECLINED.load(Ordering::SeqCst) {
        return Ok(declined);
    }
    let remember_decline = |exit: &Exit| {
        if batch_active() && exit.cancelled && exit.code == ERROR_CANCELLED as i32 {
            BATCH_DECLINED.store(true, Ordering::SeqCst);
        }
    };
    if !session_safe(program, args) {
        let exit = run_elevated(program, args, cancel, on_output)?;
        remember_decline(&exit);
        return Ok(exit);
    }
    let Some((dir, token, process)) = ensure_session()? else {
        // Dialog UAC odmítnut
        remember_decline(&declined);
        return Ok(declined);
    };

    let n = JOB_SEQ.fetch_add(1, Ordering::SeqCst);
    let log = dir.join(format!("{n}.log"));
    let cancel_file = dir.join(format!("{n}.cancel"));
    let done = dir.join(format!("{n}.done"));
    fs::write(&log, b"").map_err(|e| e.to_string())?;
    let job = SessionJob { token, program: program.into(), args: args.to_vec(), log: log.clone(), cancel: cancel_file.clone(), done: done.clone() };
    // Soubor operace vznikne celý najednou (přejmenováním), pomocník nenačte rozepsaný
    let pending = dir.join(format!("{n}.tmp"));
    fs::write(&pending, serde_json::to_vec(&job).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&pending, dir.join(format!("{n}.job"))).map_err(|e| e.to_string())?;
    on_output(Output::Started);

    let mut reader = LogTail::default();
    let mut cancel_sent = false;
    let mut emit = |line: &str| on_output(Output::Line(line));
    let code = loop {
        reader.read(&log, &mut emit);
        if cancel.is_cancelled() && !cancel_sent {
            let _ = fs::write(&cancel_file, b"");
            cancel_sent = true;
        }
        if let Ok(text) = fs::read_to_string(&done) {
            if let Ok(code) = text.trim().parse::<i32>() {
                break code;
            }
        }
        // SAFETY: platný handle pomocníka (drží ho SESSION po celou dobu běhu)
        if unsafe { WaitForSingleObject(process as _, 0) } == WAIT_OBJECT_0 {
            return Err("Povýšený pomocník HubGetu skončil".into());
        }
        std::thread::sleep(Duration::from_millis(150));
    };
    reader.read(&log, &mut emit);
    reader.finish(&mut emit);
    for file in [&log, &cancel_file, &done] {
        let _ = fs::remove_file(file);
    }
    Ok(Exit { code, cancelled: cancel_sent })
}

#[cfg(not(windows))]
pub fn run_elevated_cached(program: &str, args: &[String], cancel: &CancelToken, on_output: impl FnMut(Output)) -> Result<Exit, String> {
    run_elevated(program, args, cancel, on_output)
}

/// Běžící pomocník relace, nebo ho spustí (dialog UAC). None = UAC odmítnut.
#[cfg(windows)]
fn ensure_session() -> Result<Option<(PathBuf, String, isize)>, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
    use windows_sys::Win32::System::Threading::WaitForSingleObject;
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let mut session = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(s) = session.as_ref() {
        // SAFETY: handle procesu pomocníka z ShellExecuteEx
        if unsafe { WaitForSingleObject(s.process as _, 0) } != WAIT_OBJECT_0 {
            return Ok(Some((s.dir.clone(), s.token.clone(), s.process)));
        }
    }

    // Tajný klíč relace z kryptografického generátoru Windows
    let mut random = [0u8; 32];
    // SAFETY: zápis do vlastního pole se správnou délkou
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), random.as_mut_ptr(), random.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status != 0 {
        return Err("Nepodařilo se vytvořit klíč relace".into());
    }
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let dir = std::env::temp_dir().join("HubGet").join(format!("session-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let start = SessionStart { dir: dir.clone(), token: token.clone(), parent: std::process::id() };
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&start).map_err(|e| e.to_string())?);
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let wide = |text: &std::ffi::OsStr| {
        use std::os::windows::ffi::OsStrExt;
        text.encode_wide().chain(Some(0)).collect::<Vec<u16>>()
    };
    let file = wide(exe.as_os_str());
    let verb = wide("runas".as_ref());
    let params = wide(format!("{ELEVATED_SESSION_FLAG} {payload}").as_ref());

    // SAFETY: vynulovaná struktura s ukazateli na řetězce, které žijí do konce funkce
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE;
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let error = unsafe { GetLastError() };
        let _ = std::fs::remove_dir_all(&dir);
        return if error == ERROR_CANCELLED { Ok(None) } else { Err(format!("Spuštění s právy správce selhalo (chyba {error})")) };
    }
    if info.hProcess.is_null() {
        return Err("Spuštění s právy správce selhalo".into());
    }
    let process = info.hProcess as isize;
    *session = Some(Session { dir: dir.clone(), token: token.clone(), process });
    Ok(Some((dir, token, process)))
}

/// Vstupní bod povýšeného pomocníka relace: obsluhuje operace ze souborů
/// `<n>.job`, dokud běží HubGet, který ho spustil (u dávky s jediným dialogem UAC
/// do jejího konce).
pub fn session_main(payload: &str) -> i32 {
    use std::time::Duration;

    let Some(start) = URL_SAFE_NO_PAD
        .decode(payload)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionStart>(&bytes).ok())
    else {
        return ERROR_INVALID_PARAMETER;
    };
    loop {
        // HubGet skončil, nebo skončila dávka s jediným dialogem UAC (soubor „stop“)
        if !process_alive(start.parent) || start.dir.join("stop").exists() {
            let _ = std::fs::remove_dir_all(&start.dir);
            return 0;
        }
        let Ok(entries) = std::fs::read_dir(&start.dir) else { return ERROR_INVALID_PARAMETER };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "job") {
                continue;
            }
            let job = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<SessionJob>(&bytes).ok());
            let _ = std::fs::remove_file(&path);
            let Some(job) = job else { continue };
            // Jen operace s klíčem relace, povolený program a bezpečný tvar příkazu;
            // soubory jen uvnitř složky relace
            let inside = |p: &Path| p.parent() == Some(start.dir.as_path());
            let valid = job.token == start.token
                && session_safe(&job.program, &job.args)
                && inside(&job.log)
                && inside(&job.cancel)
                && inside(&job.done);
            let code = if valid { run_to_log(&job.program, &job.args, &job.log, &job.cancel) } else { ERROR_ACCESS_DENIED };
            if inside(&job.done) {
                let _ = std::fs::write(&job.done, code.to_string());
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Běží ještě proces s daným id?
#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    // SAFETY: handle se po dotazu zavře
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let alive = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
        CloseHandle(handle);
        alive
    }
}

#[cfg(not(windows))]
fn process_alive(_pid: u32) -> bool {
    false
}
