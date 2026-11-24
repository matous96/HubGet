//! Operace nad balíčky (instalace, aktualizace, odinstalace, stažení):
//! společné pro všechny správce.
//!
//! - Najednou běží jen jedna operace – instalátory spuštěné souběžně se
//!   navzájem blokují (MSI) nebo selžou. Další čekají ve frontě.
//! - Průběh (fáze, procenta) a výstup příkazu jdou do frontendu kanálem
//!   [`Channel`] zvlášť pro každou operaci.
//! - Operaci jde zrušit podle id, které přidělí frontend.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tauri::ipc::Channel;

use crate::download::{self, Fetch};
use crate::elevation;
use crate::process::{self, CancelToken, Exit, Output};
use crate::progress::Tracker;
use crate::security;

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Install,
    Update,
    Uninstall,
    Download,
    /// Oprava poškozené instalace (winget repair).
    Repair,
}

/// Volby instalace z frontendu (InstallOptions); neznámé položky se ignorují.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct InstallOptions {
    pub as_admin: bool,
    pub interactive: bool,
    pub skip_hash: bool,
    pub architecture: Option<String>,
    pub scope: Option<String>,
    pub location: Option<String>,
    /// Vlastní parametry instalátoru od uživatele – jen s povolením (security.rs).
    pub custom_args: Option<String>,
    /// Parametry instalátoru z voleb HubGetu (části instalátoru, bez restartu).
    pub installer_args: Option<String>,
    /// Příkaz před instalací / po ní (cmd) – jen s povolením (security.rs).
    pub pre_command: Option<String>,
    pub post_command: Option<String>,
    /// Při aktualizaci odinstalovat předchozí verzi (winget --uninstall-previous).
    pub uninstall_previous: bool,
    /// Kdo podepsal minulý instalátor aplikace (store/signers.ts; „“ = bez podpisu) – jiný
    /// vydavatel nebo chybějící podpis instalaci zastaví (signatures.rs → signer_verdict).
    pub expected_signer: Option<String>,
    /// Opakování po chybě „soubory aplikace drží jiný program“: po celou operaci ukončovat
    /// pomocné procesy bez okna, které soubory aplikace znovu načtou (running::HolderWatch).
    pub close_file_users: bool,
}

impl InstallOptions {
    /// Parametry instalátoru pro správce: vlastní (jen s povolením) a z voleb HubGetu.
    pub fn combined_args(&self) -> Option<String> {
        let allow_custom = security::policy().allow_custom_args;
        let parts: Vec<&str> = [self.custom_args.as_deref().filter(|_| allow_custom), self.installer_args.as_deref()]
            .into_iter()
            .flatten()
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect();
        (!parts.is_empty()).then(|| parts.join(" "))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRequest {
    pub kind: Kind,
    pub package_id: String,
    pub version: Option<String>,
    #[serde(default)]
    pub options: Option<InstallOptions>,
    /// Název aplikace – vodítko pro dohledání záznamu v registru (správce zná jen id).
    #[serde(default)]
    pub name: Option<String>,
    /// Automatická operace na pozadí (nikdo se nedívá) – bez dialogu UAC.
    #[serde(default)]
    pub background: bool,
}

/// Fáze průběhu – stejné názvy jako OperationPhase ve frontendu.
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Elevating,
    Downloading,
    Interactive,
    Installing,
    Uninstalling,
    Repairing,
    /// Microsoft Defender prověřuje stažený instalátor (defender.rs).
    Scanning,
}

/// Zpráva pro frontend během operace.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum OpEvent {
    Progress { phase: Phase, percent: Option<f64> },
    /// Stahování instalátoru jde pozastavit (stahuje ho HubGet sám – `pause_operation`).
    Pausable { pausable: bool },
    /// Řádek výstupu správce balíčků.
    Line { text: String },
    /// Hláška HubGetu pro protokol; text podle klíče přeloží frontend (logs.notice.*).
    Notice { key: &'static str, detail: Option<String> },
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Success,
    Cancelled,
    Error,
}

/// Výklad návratového kódu správcem balíčků.
pub struct Verdict {
    pub outcome: Outcome,
    /// Klíč chybové zprávy pro frontend (překlad), např. „hashMismatch“.
    pub error_key: Option<&'static str>,
    pub restart_required: bool,
    /// Chyba nejspíš kvůli chybějícím oprávněním – zkusit znovu jako správce.
    pub retry_elevated: bool,
}

impl Verdict {
    pub fn success(restart_required: bool) -> Self {
        Verdict { outcome: Outcome::Success, error_key: None, restart_required, retry_elevated: false }
    }
    pub fn cancelled() -> Self {
        Verdict { outcome: Outcome::Cancelled, error_key: None, restart_required: false, retry_elevated: false }
    }
    pub fn error(key: &'static str) -> Self {
        Verdict { outcome: Outcome::Error, error_key: Some(key), restart_required: false, retry_elevated: false }
    }
    /// Chyba, kterou může vyřešit spuštění s právy správce.
    pub fn retry_elevated(mut self) -> Self {
        self.retry_elevated = true;
        self
    }
}

/// Výsledek operace pro frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    outcome: Outcome,
    /// Návratový kód procesu (u wingetu HRESULT).
    code: i32,
    error_key: Option<&'static str>,
    restart_required: bool,
    /// Poslední řádek výstupu – vodítko u neznámé chyby.
    detail: Option<String>,
    /// Kdo podepsal stažený instalátor („“ = bez podpisu; None = nezjišťovalo se).
    #[serde(skip_serializing_if = "Option::is_none")]
    signer: Option<String>,
}

impl OperationResult {
    /// Operace bez procesu správce (odinstalace rozbaleného programu): hotovo, nebo chyba s popisem.
    pub fn done(result: Result<(), String>) -> Self {
        match result {
            Ok(()) => OperationResult { outcome: Outcome::Success, code: 0, error_key: None, restart_required: false, detail: None, signer: None },
            Err(detail) => OperationResult { outcome: Outcome::Error, code: 1, error_key: None, restart_required: false, detail: Some(detail), signer: None },
        }
    }

    pub fn is_success(&self) -> bool {
        self.outcome == Outcome::Success
    }

    pub fn error_key(&self) -> Option<&'static str> {
        self.error_key
    }

    /// Chyba s upřesněním od správce (u „inUseByOther“ názvy programů, které drží soubory aplikace).
    pub fn with_detail(self, detail: Option<String>) -> Self {
        OperationResult { detail, ..self }
    }

    /// Přesnější výklad chyby, než dal návratový kód (návratový kód zůstává).
    pub fn with_error(self, key: &'static str, detail: Option<String>) -> Self {
        OperationResult { error_key: Some(key), detail, ..self }
    }

    /// Úspěch, který se projeví až po restartu (winget jen připravil novou verzi MSIX).
    pub fn with_restart_required(self) -> Self {
        OperationResult { restart_required: true, ..self }
    }

    /// Chyba, po které se ukázalo, že cíl operace už je splněný (winget: „není co
    /// aktualizovat“ u aplikace, která už nejnovější verzi má).
    pub fn into_success(self) -> Self {
        OperationResult { outcome: Outcome::Success, error_key: None, ..self }
    }
}

/// Co a jak spustit; dodává konkrétní správce.
pub struct Spec {
    pub program: String,
    pub args: Vec<String>,
    /// Jiné argumenty pro opakování s právy správce po konkrétním návratovém kódu
    /// (kód, argumenty); jinak se opakuje s `args`.
    pub retry_args: Option<(i32, Vec<String>)>,
    pub kind: Kind,
    pub elevated: bool,
    /// Automatická operace na pozadí: s právy správce jen bez dialogu UAC, jinak ji nechat na uživateli.
    pub background: bool,
    pub interactive: bool,
    /// Průběh v procentech z řádku výstupu (None = běžný řádek).
    pub parse_progress: fn(&str) -> Option<f64>,
    /// Kam správce stahuje – podle růstu souboru se počítají procenta,
    /// když průběh nevypisuje (viz progress.rs).
    pub download_dirs: Vec<PathBuf>,
    /// Výklad návratového kódu.
    pub interpret: fn(Kind, i32) -> Verdict,
    /// Zjistí, kam instalátor předem stáhnout, aby ho správce našel (běží až
    /// na řadě ve frontě; None = správce stahuje sám).
    pub prefetch: Option<Box<dyn FnOnce() -> Option<Prefetch> + Send>>,
    /// Vlastní příkazy před operací a po jejím úspěchu (z voleb instalace).
    pub pre_command: Option<String>,
    pub post_command: Option<String>,
    /// Kontrola podpisu instalátoru staženého předem (`prefetch`): None = nekontrolovat,
    /// Some(None) = jen zjistit vydavatele, Some(Some(jméno)) = musí ho podepsat on.
    pub signer_check: Option<Option<String>>,
}

/// Příkazy před / po instalaci z voleb – jen u instalace a aktualizace.
pub fn custom_commands(request: &OperationRequest) -> (Option<String>, Option<String>) {
    let Some(options) = request.options.as_ref().filter(|_| matches!(request.kind, Kind::Install | Kind::Update)) else {
        return (None, None);
    };
    let clean = |command: &Option<String>| command.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(str::to_string);
    (clean(&options.pre_command), clean(&options.post_command))
}

/// Instalátor ke stažení předem: adresa a soubor, kde ho správce hledá.
pub struct Prefetch {
    pub url: String,
    pub target: PathBuf,
    /// Očekávaný SHA-256 (malými písmeny) – stažený soubor se ověří.
    pub sha256: String,
}

/// Běžící a čekající operace podle id (kvůli zrušení).
static OPERATIONS: LazyLock<Mutex<HashMap<String, CancelToken>>> = LazyLock::new(Default::default);
/// Drží ho právě běžící operace – další čekají.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Začátek dávky s jediným dialogem UAC („Čeká na potvrzení“ → Aktualizovat jako správce).
#[tauri::command]
pub fn elevated_batch_begin() {
    elevation::begin_batch();
}

/// Konec dávky – až po právě běžící operaci, která může pomocníka relace používat.
#[tauri::command]
pub async fn elevated_batch_end() -> Result<(), String> {
    process::background(|| {
        let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        elevation::end_batch();
        Ok(())
    })
    .await
}

/// Operace, které právě stahují instalátor samy (jde je pozastavit), a ty, které uživatel pozastavil.
static PAUSABLE: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static PAUSED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// Pozastaví stahování instalátoru: curl se ukončí, rozstažený soubor zůstane a operace skončí
/// jako „paused“ – fronta pokračuje dalšími úlohami a po „Pokračovat“ stahování naváže
/// (download::fetch). False = operace teď nestahuje (instaluje, stahuje správce sám).
#[tauri::command]
pub fn pause_operation(id: String) -> bool {
    if !PAUSABLE.lock().unwrap_or_else(|e| e.into_inner()).contains(&id) {
        return false;
    }
    let Some(token) = OPERATIONS.lock().unwrap_or_else(|e| e.into_inner()).get(&id).cloned() else { return false };
    PAUSED.lock().unwrap_or_else(|e| e.into_inner()).insert(id);
    token.cancel();
    true
}

#[tauri::command]
pub fn cancel_operation(id: String) {
    if let Some(token) = OPERATIONS.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
        token.cancel();
    }
}

/// Spustí operaci (počká, až doběhne předchozí) a vrátí její výsledek.
pub async fn execute(id: String, spec: Spec, channel: Channel<OpEvent>) -> Result<OperationResult, String> {
    let token = CancelToken::default();
    OPERATIONS.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), token.clone());

    let op_id = id.clone();
    let result = process::background(move || {
        let mut spec = spec;
        let prefetch = spec.prefetch.take();
        let policy = security::policy();
        // Oprávnění správce podle Nastavení: zákaz má přednost, „vždy“ jen u správců,
        // které jde povýšit (winget, Chocolatey – Scoop běží vždy bez práv správce)
        if policy.elevation_prohibited {
            spec.elevated = false;
        } else if policy.always_elevate && elevation::is_allowed(&spec.program) {
            spec.elevated = true;
        }
        if !policy.allow_pre_post_commands {
            spec.pre_command = None;
            spec.post_command = None;
        }
        let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let cancelled = |spec: &Spec| Ok(finish(spec, Exit { code: 0, cancelled: true }, None, None));
        if token.is_cancelled() {
            return cancelled(&spec);
        }
        let mut tracker = Tracker::new(&spec, channel);

        // Na pozadí (automatická aktualizace) žádný dialog UAC – operaci s právy správce nechat
        // na uživateli, ledaže ji tiše převezme už povýšený pomocník („Požádat … pouze jednou“)
        if spec.elevated && spec.background && !elevation::elevates_silently(&spec.program, &spec.args) {
            return Ok(needs_admin(&tracker, 0));
        }

        // 0) Vlastní příkaz před instalací – když selže, instalace se nespustí
        if let Some(command) = spec.pre_command.clone() {
            tracker.notice("preCommand", Some(command.clone()));
            let exit = run_command(&command, &token, &mut tracker)?;
            if exit.cancelled {
                return cancelled(&spec);
            }
            if exit.code != 0 {
                return Ok(OperationResult {
                    outcome: Outcome::Error,
                    code: exit.code,
                    error_key: Some("preCommandFailed"),
                    restart_required: false,
                    detail: tracker.take_last_line(),
                    signer: None,
                });
            }
        }

        // 1) Instalátor stáhne HubGet sám (přesný průběh); když to nejde, stáhne ho správce
        let mut signer: Option<String> = None;
        if let Some(resolve) = prefetch {
            tracker.prefetching();
            if let Some(job) = resolve() {
                PAUSABLE.lock().unwrap_or_else(|e| e.into_inner()).insert(op_id.clone());
                tracker.pausable(true);
                let fetched = prefetch_installer(&job, &token, &tracker);
                PAUSABLE.lock().unwrap_or_else(|e| e.into_inner()).remove(&op_id);
                tracker.pausable(false);
                // Pozastaveno: rozstažený soubor zůstane, operace skončí – po „Pokračovat“ se naváže
                if matches!(fetched, Fetch::Cancelled) && PAUSED.lock().unwrap_or_else(|e| e.into_inner()).remove(&op_id) {
                    return Ok(OperationResult { outcome: Outcome::Cancelled, code: 0, error_key: Some("paused"), restart_required: false, detail: None, signer: None });
                }
                if matches!(fetched, Fetch::Cancelled) {
                    download::discard_partial(&job.target);
                }
                match fetched {
                    Fetch::Done => {
                        tracker.prefetched();
                        // 1b) Podpis instalátoru před spuštěním: kdo ho podepsal – a jestli stejný
                        //     vydavatel jako minule (jinak se instalátor nespustí)
                        if let Some(expected) = spec.signer_check.clone() {
                            if let Some(signature) = crate::signatures::installer_signature(&job.target) {
                                let shown = if signature.signer.is_empty() { None } else { Some(signature.signer.clone()) };
                                tracker.notice(if shown.is_some() { "signedBy" } else { "unsigned" }, shown);
                                if let Some((key, detail)) = crate::signatures::signer_verdict(&signature, expected.as_deref()) {
                                    return Ok(OperationResult {
                                        outcome: Outcome::Error,
                                        code: 0,
                                        error_key: Some(key),
                                        restart_required: false,
                                        detail: Some(detail),
                                        signer: Some(signature.signer),
                                    });
                                }
                                signer = Some(signature.signer);
                            }
                        }
                        // 1c) Kontrola Microsoft Defenderem – nález instalaci zastaví, nedostupný
                        //     Defender (jiný antivirus) jen zmíní průběh
                        if crate::defender::enabled() {
                            tracker.scanning();
                            let verdict = crate::defender::scan(&job.target);
                            tracker.prefetched();
                            match verdict {
                                crate::defender::Verdict::Clean => tracker.notice("scanClean", None),
                                crate::defender::Verdict::Threat(name) => {
                                    return Ok(OperationResult {
                                        outcome: Outcome::Error,
                                        code: 0,
                                        error_key: Some("threatFound"),
                                        restart_required: false,
                                        detail: Some(name),
                                        signer,
                                    });
                                }
                                crate::defender::Verdict::Unavailable(reason) => tracker.notice("scanUnavailable", Some(reason)),
                            }
                        }
                    }
                    Fetch::Cancelled => return cancelled(&spec),
                    Fetch::Failed(reason) => tracker.notice("prefetchFailed", Some(reason)),
                }
            }
        }

        // 2) Správce balíčků
        let mut exit = run(&spec, &spec.args, spec.elevated, &token, &mut tracker)?;

        // 3) Selhání kvůli oprávněním (např. odinstalace MSI pro všechny uživatele) → znovu jako správce;
        //    operace spuštěná rovnou jako správce znovu jen s upravenými argumenty (MSI s ALLUSERS=1)
        //    (ne se zákazem povýšení v Nastavení; ne po pádu instalátoru – ten práva správce nespraví)
        let retry_args = match &spec.retry_args {
            Some((code, args)) if *code == exit.code => Some(args.clone()),
            _ => None,
        };
        if (!spec.elevated || retry_args.is_some())
            && !policy.elevation_prohibited
            && !exit.cancelled
            && tracker.crash().is_none()
            && (spec.interpret)(spec.kind, exit.code).retry_elevated
        {
            let args = retry_args.unwrap_or_else(|| spec.args.clone());
            if spec.background && !elevation::elevates_silently(&spec.program, &args) {
                return Ok(needs_admin(&tracker, exit.code));
            }
            tracker.notice("retryElevated", None);
            exit = run(&spec, &args, true, &token, &mut tracker)?;
        }

        let detail = tracker.take_last_line();
        // Vydavatel instalátoru jde do výsledku – frontend si ho zapamatuje pro příští aktualizaci
        let result = OperationResult { signer, ..finish(&spec, exit, detail, tracker.crash()) };

        // 4) Vlastní příkaz po úspěšné instalaci – jeho selhání operaci nezmění, jen se zapíše
        if let (Some(command), Outcome::Success) = (spec.post_command.clone(), result.outcome) {
            tracker.notice("postCommand", Some(command.clone()));
            match run_command(&command, &token, &mut tracker) {
                Ok(exit) if exit.code != 0 && !exit.cancelled => tracker.notice("postCommandFailed", Some(exit.code.to_string())),
                Err(e) => tracker.notice("postCommandFailed", Some(e)),
                _ => {}
            }
        }
        Ok(result)
    })
    .await;

    OPERATIONS.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    // Pozastavení přišlo, až když stahování skončilo – nic nečeká
    PAUSED.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    result
}

/// Operace na pozadí potřebuje práva správce – bez dialogu UAC ji nechat na uživateli.
fn needs_admin(tracker: &Tracker, code: i32) -> OperationResult {
    tracker.notice("needsAdmin", None);
    OperationResult { outcome: Outcome::Error, code, error_key: Some("needsAdmin"), restart_required: false, detail: None, signer: None }
}

/// Spustí příkaz správce – normálně, nebo s právy správce (UAC).
fn run(spec: &Spec, args: &[String], elevated: bool, token: &CancelToken, tracker: &mut Tracker) -> Result<Exit, String> {
    if elevated {
        tracker.elevating();
    }
    let on_output = |output: Output| match output {
        Output::Started => tracker.started(),
        Output::Line(line) => tracker.line(line),
    };
    if elevated {
        // „Požádat o práva správce jen jednou“ a dávka s jediným dialogem UAC – další operace
        // obslouží už povýšený pomocník
        if security::policy().cache_elevation || elevation::batch_active() {
            elevation::run_elevated_cached(&spec.program, args, token, on_output)
        } else {
            elevation::run_elevated(&spec.program, args, token, on_output)
        }
    } else {
        let mut command = process::hidden_command(&spec.program);
        command.args(args);
        process::run_streaming(command, token, on_output)
    }
}

/// Vlastní příkaz před / po instalaci: `cmd /D /C <příkaz>` bez okna, výstup do protokolu.
fn run_command(command: &str, token: &CancelToken, tracker: &mut Tracker) -> Result<Exit, String> {
    let mut cmd = process::hidden_command(&process::system_tool("cmd.exe").to_string_lossy());
    cmd.args(["/D", "/C"]).arg(command);
    process::run_streaming(cmd, token, |output| {
        if let Output::Line(line) = output {
            tracker.line(line);
        }
    })
}

/// Instalátory, které se právě stahují předem (stahování dopředu – winget.rs `prefetch_ahead`):
/// operace, která na takový instalátor narazí, počká na jeho dokončení místo druhého stahování.
static IN_FLIGHT: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(Default::default);

/// Začne stahování dopředu; false = tentýž instalátor se už stahuje.
pub fn begin_prefetch(target: &Path) -> bool {
    IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner()).insert(target.to_path_buf())
}

pub fn end_prefetch(target: &Path) {
    IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner()).remove(target);
}

/// Stáhne instalátor (bez spuštění) a ověří SHA-256 – stahování dopředu.
pub fn prefetch_only(job: &Prefetch, token: &CancelToken) -> bool {
    if download::sha256_matches(&job.target, &job.sha256) || download::reuse_renamed(&job.target, &job.sha256) {
        return true;
    }
    if !begin_prefetch(&job.target) {
        return false;
    }
    let done = match download::fetch(&job.url, &job.target, token, |_| {}) {
        Fetch::Done => download::sha256_matches(&job.target, &job.sha256),
        // Zrušené / nepovedené: rozstažený soubor zůstane – operace na něj naváže
        _ => false,
    };
    if !done && job.target.exists() && !download::sha256_matches(&job.target, &job.sha256) {
        let _ = std::fs::remove_file(&job.target);
    }
    end_prefetch(&job.target);
    done
}

/// Stáhne instalátor předem a ověří jeho SHA-256. Už stažený (stejný) soubor
/// se nestahuje znovu – třeba při opakování operace.
fn prefetch_installer(job: &Prefetch, token: &CancelToken, tracker: &Tracker) -> Fetch {
    // Tentýž instalátor se právě stahuje dopředu – počkat na něj (průběh jako stahování)
    while IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner()).contains(&job.target) {
        if token.is_cancelled() {
            return Fetch::Cancelled;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    if download::sha256_matches(&job.target, &job.sha256) || download::reuse_renamed(&job.target, &job.sha256) {
        return Fetch::Done;
    }
    match download::fetch(&job.url, &job.target, token, |percent| tracker.download_percent(percent)) {
        Fetch::Done if !download::sha256_matches(&job.target, &job.sha256) => {
            let _ = std::fs::remove_file(&job.target);
            Fetch::Failed("SHA-256".into())
        }
        other => other,
    }
}

/// Výsledek operace. Spadl-li instalátor (`crash` – kód výjimky z výstupu), je to
/// chyba „installerCrashed“ s kódem pádu v `detail` – ne obecné „instalátor skončil s chybou“.
fn finish(spec: &Spec, exit: Exit, detail: Option<String>, crash: Option<u32>) -> OperationResult {
    let verdict = if exit.cancelled { Verdict::cancelled() } else { (spec.interpret)(spec.kind, exit.code) };
    let error = verdict.outcome == Outcome::Error;
    let crash = crash.filter(|_| error);
    OperationResult {
        outcome: verdict.outcome,
        code: exit.code,
        error_key: if crash.is_some() { Some("installerCrashed") } else { verdict.error_key },
        restart_required: verdict.restart_required,
        detail: match crash {
            Some(code) => Some(format!("0x{code:08X}")),
            None if error => detail,
            None => None,
        },
        signer: None,
    }
}

