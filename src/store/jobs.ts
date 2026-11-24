/**
 * Fronta operací nad balíčky.
 *
 * Operace běží postupně (správci balíčků spolehlivě zvládají jen jednu
 * instalaci najednou). Každá aplikace může mít v jednu chvíli nejvýš jednu
 * úlohu, klíčem je kanonické id aplikace – karta tak snadno najde svůj
 * průběh bez ohledu na to, ze kterého zdroje se instaluje.
 *
 * Výsledek každé operace (i kroky záložního zdroje) se zapíše do centra
 * oznámení (zvoneček v horní liště, store/notifications.ts) – chyby i s kódem.
 *
 * Záložní zdroj instalace: když instalace ze zvoleného zdroje selže tak, že by
 * jiný správce mohl pomoct (nefunkční odkaz v manifestu wingetu – chyba 404,
 * jiný soubor na stejné adrese, běžící jiná instalace…), HubGet nabídne
 * instalaci od dalších zapnutých správců, kteří aplikaci mají (FallbackOfferDialog).
 * Úlohy na pozadí (bez uživatele) zkusí ostatní nainstalované správce samy.
 *
 * Běžící aplikace: před instalací, aktualizací a odinstalací se zavřou její
 * procesy (prepareProcesses), po odinstalaci procesy, které ze složky aplikace
 * dál běží (endLeftoverProcesses) – instalátor by jinak narazil na chybu
 * „aplikace právě běží“ a soubory by zůstaly zamčené.
 *
 * Sledování instalace (Nastavení, nebo „Nainstalovat se sledováním“): snímek
 * disku a registru před instalací a po ní (services/tracker.ts) – po
 * odinstalaci se zaznamenané položky nabídnou ke smazání se zbytky.
 */
import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import { create } from "zustand";
import { queryClient, queryKeys } from "@/app/queryClient";
import i18n from "@/i18n";
import { getSource, managers, type OperationHandle, type OperationRequest, type OperationResult } from "@/services/managers";
import { adoptedIdOf } from "./adopted";
import { checksSigner, useSigners } from "./signers";
import type { LoadedCatalog } from "@/services/catalog";
import { notifyEvent, type NotifyEventType } from "@/services/notify";
import {
  appCloseState,
  closableInBackground,
  closeApp,
  closeProcesses,
  endProcesses,
  findAppProcesses,
  findFileUsers,
  type RunningProcess,
} from "@/services/processes";
import { traceBegin, traceDiscard, traceEnd, traceKey } from "@/services/tracker";
import { recordPhaseDuration } from "@/lib/phaseEstimate";
import { isTauri } from "@/lib/tauri";
import type { InstalledPackage, InstallOptions, Job, OperationKind, OperationOutcome, OperationPhase, PackageSource, SourceId } from "@/types";
import { refreshAfterOperation } from "./afterOperation";
import { appAllowed, sourceAllowed } from "./orgPolicy";
import { usePackageIndex } from "./packageIndex";
import { reportJobOutcome } from "./reliability";
import { reportInstall } from "./installStats";
import { useToasts } from "./toasts";
import { useHistory } from "./history";
import { useLeftovers } from "./leftovers";
import { useOffloaded } from "./offloaded";
import { usePausedJobs } from "./pausedJobs";
import { useAfterBatch, useFailedBatch } from "./updateFixes";
import { skipBadVersion } from "./rollback";
import { writeLog } from "./logs";
import { diskShortage } from "@/lib/diskSpace";
import { formatSizeText } from "@/lib/utils";
import { useAppInUse } from "./appInUse";
import { useFallbackOffer } from "./fallbackOffer";
import { useInstalledVia } from "./installedVia";
import { useManagerSetup } from "./managerSetup";
import { useNotificationPrefs } from "./notificationPrefs";
import { applySecurityPolicy } from "./security";
import { sourcePriority, useSettings } from "./settings";
import { sourceScope } from "./sourceLock";
import type { ToastTone } from "./toasts";
import { AUTO_FAILURE_LIMIT, useUpdateHolds, versionKey } from "./updateHolds";

export interface EnqueueRequest {
  appId: string;
  appName: string;
  source: SourceId;
  packageId: string;
  kind: OperationKind;
  /** Konkrétní verze (jen u instalace). */
  version?: string;
  /** Starší verze místo nainstalované novější – nejdřív odinstalovat (Job.replaceInstalled). */
  replaceInstalled?: boolean;
  /** Vrácení aktualizace: po úspěchu verzi přeskočit (Job.skipVersion). */
  skipVersion?: string;
  /** Volby instalace (jako správce, interaktivně…). */
  options?: InstallOptions;
  /** Automatická aktualizace na pozadí – bez dotazů (zavření běžící aplikace, instalace správce). */
  background?: boolean;
  /** Sledovat instalaci snímkem systému („Nainstalovat se sledováním“). */
  track?: boolean;
  /** Automatická aktualizace: nabízená verze. */
  targetVersion?: string;
  /** Uvolnit aplikaci – odinstalovat a nechat nastavení (Job.offload). */
  offload?: boolean;
}

interface JobsState {
  /** Aktivní a čekající úlohy podle id aplikace. */
  jobs: Record<string, Job>;
  enqueue: (request: EnqueueRequest) => void;
  cancel: (appId: string) => void;
  /** Pozastaví stahování instalátoru (jen když ho stahuje HubGet sám – progress.pausable). */
  pause: (appId: string) => void;
  /** Pozastavené stahování znovu do fronty – naváže, kde skončilo (store/pausedJobs). */
  resume: (appId: string) => void;
  /** Zahodí pozastavené stahování. */
  discardPaused: (appId: string) => void;
}

// Mimo React stav – nemusí vyvolávat překreslení.
const queue: string[] = [];
const handles = new Map<string, OperationHandle>();
let running = false;
/** Výsledky právě probíhající dávky operací (do vyprázdnění fronty) – pro souhrnné oznámení. */
let batch: Record<OperationOutcome, number> = { success: 0, error: 0, cancelled: 0 };
/**
 * Stahování dopředu (winget.rs → prefetch_ahead): zatímco běží jedna úloha, další dvě ve frontě si
 * stáhnou instalátor – postupně, jedna za druhou (souběžně s právě běžící operací). Úloha, která na
 * instalátor narazí během stahování, počká, až doběhne (operations.rs → IN_FLIGHT).
 */
const AHEAD_COUNT = 2;
const aheadStarted = new Set<string>();
let aheadChain: Promise<unknown> = Promise.resolve();

function prefetchQueued() {
  if (!isTauri()) return;
  for (const appId of queue.slice(0, AHEAD_COUNT)) {
    const job = useJobs.getState().jobs[appId];
    if (!job || job.source !== "winget" || (job.kind !== "install" && job.kind !== "update") || aheadStarted.has(job.id)) continue;
    aheadStarted.add(job.id);
    const request = adoptedRequest(job, { kind: job.kind, packageId: job.packageId, version: job.version, options: applySecurityPolicy(job.options), name: job.appName });
    aheadChain = aheadChain.then(() => (useJobs.getState().jobs[appId] ? invoke("prefetch_ahead", { request }).catch(() => false) : false));
  }
}

/** Neúspěšné operace spuštěné uživatelem v této dávce – na konci do „Zkusit neúspěšné znovu“. */
let batchFailed: EnqueueRequest[] = [];

/**
 * Chyby, kdy instalátor ze zdroje nejde získat, ale jiný správce může aplikaci
 * mít: nefunkční odkaz (HTTP 403/404/410), jiný soubor na stejné adrese
 * (nesouhlasí kontrolní součet), jiné selhání stažení. Bez připojení
 * k internetu (network) by jiný zdroj nepomohl.
 */
const UNAVAILABLE_INSTALLER = new Set(["linkBroken", "hashMismatch", "downloadFailed"]);

/**
 * Chyby, po kterých má smysl nabídnout jiný zdroj: k nedostupnému instalátoru
 * i běžící jiná instalace (Scoop instaluje bez MSI), balíček ve zdroji chybí
 * nebo nemá instalátor pro tento počítač, instalátor sám selhal.
 * Běžící aplikaci (inUse) řeší AppInUseDialog – jiný správce by narazil taky.
 */
const OFFER_FALLBACK = new Set([...UNAVAILABLE_INSTALLER, "busy", "notFound", "noInstaller", "installerFailed", "installerCrashed"]);

/**
 * Je správce zdroje nainstalovaný? Když ne (Chocolatey, Scoop), zeptá se
 * uživatele, jestli ho nainstalovat (ManagerSetupDialog), a počká na odpověď.
 * Správce „připravujeme“ (vývojářské) nebo neznámý stav – operace to zkusí sama.
 */
async function managerReady(source: SourceId, background?: boolean): Promise<boolean> {
  const status = await queryClient
    .fetchQuery({ queryKey: queryKeys.managerStatus(source), queryFn: () => managers[source].getStatus(), staleTime: 60_000 })
    .catch(() => null);
  if (!status || status.available || status.planned) return true;
  if (background) return false;
  const installed = await useManagerSetup.getState().request(source);
  if (installed) await queryClient.invalidateQueries({ queryKey: queryKeys.managerStatus(source) });
  return installed;
}

/**
 * Další zdroje aplikace podle priority z nastavení: zapnutí správci aplikací
 * (Chocolatey, Scoop…), kteří aplikaci mají. Aplikace mimo katalog je nemá.
 */
function otherSources(job: Job): PackageSource[] {
  const entry = queryClient.getQueryData<LoadedCatalog>(queryKeys.catalog)?.catalog.packages.find((p) => p.id === job.appId);
  // Zamčený zdroj (režim jednoho zdroje v levém panelu) – jiné zdroje se nenabízejí
  if (!entry || sourceScope().lock) return [];
  const { enabledSources, preferredSource } = useSettings.getState();
  return sourcePriority(enabledSources, preferredSource)
    .filter((id) => id !== job.source && getSource(id).group === "apps")
    .map((id) => entry.sources.find((s) => s.source === id))
    .filter((s): s is PackageSource => !!s);
}

/** Je správce zdroje nainstalovaný? Stav sdílí s Nastavením (stejný klíč dotazu). */
async function managerAvailable(source: SourceId): Promise<boolean> {
  const status = await queryClient
    .fetchQuery({ queryKey: queryKeys.managerStatus(source), queryFn: () => managers[source].getStatus(), staleTime: 60_000 })
    .catch(() => null);
  return !!status?.available;
}

/** Záložní zdroje pro automatický pokus (úlohy na pozadí): jen nainstalovaní správci. */
async function fallbackSources(job: Job): Promise<PackageSource[]> {
  const usable: PackageSource[] = [];
  for (const candidate of otherSources(job)) if (await managerAvailable(candidate.source)) usable.push(candidate);
  return usable;
}

/** Názvy procesů bez opakování („obs64.exe, obs-ffmpeg-mux.exe“; cizí programy jménem – „Microsoft Edge“). */
const processNames = (processes: { name: string; description?: string }[]) => [...new Set(processes.map((p) => p.description ?? p.name))].join(", ");

/**
 * Před instalací, aktualizací a odinstalací zavře běžící procesy aplikace –
 * jinak instalátor běžící soubory nepřepíše (winget „inUse“, OBS u hodin):
 *  - procesy na pozadí, které aplikaci jistě patří (bez okna, okenní program),
 *    ukončí bez dotazu (Nastavení → Odinstalace a běžící aplikace) a zapíše to,
 *  - aplikaci s oknem, proces nalezený jen podle názvu a proces, který ukončit
 *    nešlo, nechá na uživateli (AppRunningDialog – zavřít jedním kliknutím).
 * Vrací false, když uživatel operaci zrušil. Úlohy na pozadí (automatické
 * aktualizace) aplikace nezavírají.
 */
/**
 * Automatická aktualizace: běží-li aplikace v okně, počká (nikdo ji nechce zavírat uprostřed
 * práce a instalátor by ji stejně nepřepsal) – zkusí se při příští kontrole. Procesy bez okna
 * (ikona u hodin, proces v paměti) se podle Nastavení ukončí jako u ruční aktualizace.
 */
async function backgroundReady(job: Job): Promise<boolean> {
  const found = await findAppProcesses(job.packageId, job.appName).catch(() => []);
  if (!found.length) return true;
  const quiet = useSettings.getState().closeBackgroundProcesses ? found.filter(closableInBackground) : [];
  if (quiet.length < found.length) return false;
  const alive = await endProcesses(quiet.map((p) => p.pid)).catch(() => quiet.map((p) => p.pid));
  if (alive.length) return false;
  writeLog(job.source, "warning", i18n.t("logs.msg.endedProcesses", { name: job.appName, processes: processNames(quiet) }));
  return true;
}

/** Nainstalovaný balíček úlohy podle posledního výpisu správců (mezipaměť dotazu „installed“). */
function installedPackageOf(job: Pick<Job, "source" | "packageId">): InstalledPackage | undefined {
  const adoptedFrom = adoptedIdOf(job);
  for (const [, data] of queryClient.getQueriesData<InstalledPackage[]>({ queryKey: queryKeys.installed })) {
    const found = data?.find((p) => p.source === job.source && (p.packageId === job.packageId || p.packageId === adoptedFrom));
    if (found) return found;
  }
  return undefined;
}

/**
 * Požadavek pro správce u převzatého programu: aktualizace = instalace nejnovější verze přes
 * winget (instalátor ji nainstaluje přes starou – winget program pod id balíčku nezná, `upgrade`
 * by ho nenašel), odinstalace a oprava přes původní záznam ve Windows.
 */
function adoptedRequest(job: Job, request: OperationRequest): OperationRequest {
  const arp = adoptedIdOf(job);
  if (!arp) return request;
  if (job.kind === "update") return { ...request, kind: "install", version: undefined };
  if (job.kind === "uninstall" || job.kind === "repair") return { ...request, packageId: arp };
  return request;
}

/**
 * Záloha nastavení aplikace (AppData) před aktualizací – při vrácení aktualizace se obnoví
 * i ono (settings_backup.rs). Nastavení „Zálohovat nastavení aplikací“; chyba aktualizaci nezastaví.
 */
async function backupSettings(job: Job) {
  const version = installedPackageOf(job)?.installedVersion;
  if (!isTauri() || !version || !useSettings.getState().backupSettings) return;
  await invoke("settings_backup", { appId: job.appId, name: job.appName, packageId: job.packageId, version }).catch((error) =>
    writeLog(job.source, "warning", i18n.t("logs.msg.settingsBackupFailed", { name: job.appName, error: String(error) })),
  );
}

/**
 * Uvolnit aplikaci: nastavení zálohovat vždy (i s vypnutou zálohou před aktualizací) –
 * odinstalátor ho mohl smazat; po Nainstalovat znovu se vrátí (restoreOffloaded).
 */
async function offloadBackup(job: Job): Promise<{ version: string; backup: boolean } | null> {
  const version = installedPackageOf(job)?.installedVersion;
  if (!version) return null;
  if (!isTauri()) return { version, backup: false };
  const result = await invoke<{ outcome: string }>("settings_backup", { appId: job.appId, name: job.appName, packageId: job.packageId, version }).catch((error) => {
    writeLog(job.source, "warning", i18n.t("logs.msg.settingsBackupFailed", { name: job.appName, error: String(error) }));
    return null;
  });
  return { version, backup: result?.outcome === "saved" };
}

/** Hlavní program aplikace a stav jeho podpisu (signatures.rs → check_signatures). */
interface AppSignature {
  status: "signed" | "unsigned" | "invalid" | "unknown";
  file: string | null;
}

async function mainProgram(job: Job): Promise<AppSignature | null> {
  if (!isTauri()) return null;
  const result = await invoke<AppSignature[]>("check_signatures", { apps: [{ packageId: job.packageId, name: job.appName }] }).catch(() => null);
  return result?.[0] ?? null;
}

/** Za jak dlouho po aktualizaci kontrolovat program (zápisy instalátoru, první spuštění aplikace). */
const POST_CHECK_MS = 15_000;

/**
 * Kontrola po aktualizaci: hlavní program aplikace, který před aktualizací existoval, musí být
 * na místě, a když byl podepsaný, musí mít platný podpis. Jinak varování s radou vrátit aplikaci
 * na předchozí verzi (detail aplikace → Vrátit). Bez nálezu jen záznam do protokolu.
 */
async function checkAfterUpdate(job: Job, before: AppSignature) {
  if (!before.file) return;
  await sleep(POST_CHECK_MS);
  const after = await mainProgram(job);
  if (!after) return;
  const problem = after.status === "unknown" || !after.file ? "missing" : before.status === "signed" && after.status === "invalid" ? "invalid" : before.status === "signed" && after.status === "unsigned" ? "unsigned" : null;
  if (!problem) {
    writeLog(job.source, "info", i18n.t("postCheck.ok", { name: job.appName }));
    return;
  }
  const message = i18n.t(`postCheck.${problem}`, { name: job.appName, file: before.file });
  writeLog(job.source, "warning", message);
  notifyEvent({ type: "info", tone: "error", title: job.appName, message, toast: message, record: { kind: job.kind, source: job.source, appId: job.appId } });
}

/** Uvolněná aplikace: zapamatovat a oznámit, že nastavení zůstalo. */
function reportOffloaded(job: Job, info: { version: string; backup: boolean }) {
  useOffloaded.getState().add(job.appId, { ...info, at: Date.now() });
  const message = i18n.t("offload.done", { name: job.appName });
  writeLog(job.source, "info", message);
  useToasts.getState().push("success", message);
}

/** Opětovná instalace uvolněné aplikace: nastavení ze zálohy zpět na místo. */
async function restoreOffloaded(job: Job) {
  const offloaded = useOffloaded.getState().items[job.appId];
  if (!offloaded) return;
  useOffloaded.getState().remove(job.appId);
  if (!offloaded.backup || !isTauri()) return;
  const restored = await invoke<boolean>("settings_restore", { appId: job.appId, version: offloaded.version }).catch(() => false);
  if (!restored) return;
  const message = i18n.t("offload.restored", { name: job.appName });
  writeLog(job.source, "info", message);
  notifyEvent({ type: "info", tone: "success", title: job.appName, message, toast: message, record: { kind: job.kind, source: job.source, appId: job.appId } });
}

/** Po vrácení aktualizace obnoví nastavení zálohované před ní (je-li záloha k této verzi). */
async function restoreSettings(job: Job, version: string) {
  if (!isTauri()) return;
  const restored = await invoke<boolean>("settings_restore", { appId: job.appId, version }).catch(() => false);
  if (restored) {
    const message = i18n.t("rollback.settingsRestored", { name: job.appName, version });
    writeLog(job.source, "info", message);
    notifyEvent({ type: "info", tone: "success", title: job.appName, message, toast: message, record: { kind: job.kind, source: job.source, appId: job.appId } });
  }
}

/** Operace na pozadí, kterou backend nespustil (nebo nezopakoval), protože by potřebovala dialog UAC. */
const needsAdminLater = (job: Job, result: OperationResult) => !!job.background && result.errorKey === "needsAdmin";

/**
 * Operace, které po chybě „aplikace běží“ (winget inUse) fronta sama zopakovala po zavření
 * aplikace – podruhé už se nezkouší, nabídne se dialog (AppInUseDialog).
 */
const inUseRetried = new Set<string>();
const inUseKey = (job: Job) => `${job.source}:${job.packageId}:${job.kind}`;

/** Jak dlouho čekat, až uživatel uloží práci a aplikaci zavře; pak se operace zruší (fronta stojí). */
const CLOSE_WAIT_LIMIT_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Záznam do protokolu a oznámení (v rohu okna a ve zvonečku) o zavírání aplikace. */
function reportClosing(job: Job, key: "appClosed" | "otherAppsClosed" | "appClosing" | "appCloseTimeout", params: Record<string, string>) {
  writeLog(job.source, key === "appClosed" || key === "otherAppsClosed" ? "warning" : "info", i18n.t(`logs.msg.${key}`, params));
  notifyEvent({
    type: "info",
    tone: "info",
    title: job.appName,
    message: i18n.t(`notifications.${key}`, params),
    toast: i18n.t(`toast.${key}`, params),
    record: { kind: job.kind, source: job.source, appId: job.appId },
  });
}

/**
 * Zavře běžící aplikaci bez dialogu HubGetu a bez ztráty rozdělané práce
 * (Nastavení „Zavírat běžící aplikace bez dotazu“, výchozí): backend ji požádá
 * o zavření jako křížkem; co se schová k hodinám nebo zamrzne, ukončí natvrdo.
 * Aplikace, která se ptá na uložení (Word, grafický editor…), zůstane běžet –
 * karta ukazuje „Čeká na zavření aplikace“ a operace pokračuje, až ji uživatel
 * zavře (zbylé procesy bez okna pak natvrdo). `onWaiting` přepne kartu do čekání.
 * False = operace se nespustí (uživatel ji zrušil, nebo vypršelo čekání).
 * `retry`: po chybě „aplikace běží“ – aplikace se ptá na uložení → nečekat (nabídne se dialog).
 * `closed`: oznámení o zavření – aplikace sama, nebo cizí programy, které držely její soubory.
 */
async function closeRunningApp(
  job: Job,
  found: RunningProcess[],
  onWaiting?: () => void,
  closed: "appClosed" | "otherAppsClosed" = "appClosed",
): Promise<boolean> {
  const pids = found.map((p) => p.pid);
  let state = await closeApp(pids).catch(() => ({ alive: pids, waiting: [] as number[] }));
  const params = { name: job.appName, processes: "" };
  if (state.waiting.length) {
    if (!onWaiting) return false;
    onWaiting();
    reportClosing(job, "appClosing", params);
    const deadline = Date.now() + CLOSE_WAIT_LIMIT_MS;
    while (state.alive.length) {
      await sleep(1000);
      // Uživatel úlohu zrušil (karta zmizela)
      if (!useJobs.getState().jobs[job.appId]) return false;
      state = await appCloseState(state.alive).catch(() => state);
      // Okno zavřel (nebo zamrzlo) – co zůstalo bez okna (ikona u hodin, pomocné procesy), natvrdo
      if (state.alive.length && !state.waiting.length) {
        state = { alive: await closeProcesses(state.alive, true).catch(() => state.alive), waiting: [] };
        break;
      }
      if (Date.now() > deadline) {
        reportClosing(job, "appCloseTimeout", params);
        return false;
      }
    }
  }
  const ended = found.filter((p) => !state.alive.includes(p.pid));
  if (ended.length) reportClosing(job, closed, { ...params, processes: processNames(ended) });
  return true;
}

/**
 * Chyba „aplikace běží“ se zavíráním bez dotazu: aplikace mohla naběhnout až během
 * operace, nebo ji předem nešlo najít – zavřít ji a operaci jednou zopakovat, bez
 * dialogu. Když se aplikace ptá na uložení práce, nic se nezavře a nabídne se dialog.
 *
 * Chyba „soubory aplikace drží jiný program“ (inUseByOther): ten se zavře stejně a operace
 * se zopakuje. Nejčastěji je to jen pomocný proces bez okna – služba kamery v Edgi nebo
 * v aplikaci Claude s načtenou virtuální kamerou OBS; jeho ukončení okno programu nezavře
 * a program si službu spustí znovu. Takové procesy zavře i automatická aktualizace na pozadí;
 * program s oknem jen aktualizace spuštěná uživatelem (na pozadí se počká na příští pokus).
 * True = zařazeno znovu.
 */
async function retryAfterClosing(job: Job, result: OperationResult, enqueue: (request: EnqueueRequest) => void): Promise<boolean> {
  const retried = inUseRetried.delete(inUseKey(job));
  const otherApps = result.errorKey === "inUseByOther";
  if (retried || result.outcome !== "error" || (result.errorKey !== "inUse" && !otherApps)) return false;
  const settings = useSettings.getState();
  if (!(job.background ? settings.closeBackgroundProcesses : settings.forceCloseRunning)) return false;
  if (otherApps) {
    const found = await findFileUsers(job.packageId, job.appName).catch(() => []);
    if (!found.length || (job.background && found.some((p) => p.visible))) return false;
    if (!(await closeRunningApp(job, found, undefined, "otherAppsClosed"))) return false;
  } else {
    if (job.background) return false;
    const found = await findAppProcesses(job.packageId, job.appName).catch(() => []);
    if (!found.length || !(await closeRunningApp(job, found))) return false;
  }
  inUseRetried.add(inUseKey(job));
  // Neúspěšný pokus do historie nepatří – zapíše se až opakování
  useHistory.getState().remove(job.id);
  const { appId, appName, source, packageId, kind, version, options, track, targetVersion, background } = job;
  // Pomocné procesy (služba kamery v Edgi / Claude) se po ukončení do pár sekund spustí znovu –
  // při opakování je backend ukončuje po celou dobu operace (running::HolderWatch)
  const retryOptions = otherApps ? { ...options, closeFileUsers: true } : options;
  enqueue({ appId, appName, source, packageId, kind, version, options: retryOptions, track, targetVersion, background });
  return true;
}

async function prepareProcesses(job: Job, onWaiting: () => void): Promise<boolean> {
  if (job.background || job.kind === "download") return true;
  const found = await findAppProcesses(job.packageId, job.appName).catch(() => []);
  if (!found.length) return true;
  // „Zavírat běžící aplikace bez dotazu“ (výchozí): zavřít bez dialogu, s ohledem na neuloženou
  // práci – stejné procesy, jaké by dialog nabídl ukončit (i nalezené jen podle názvu: aplikace
  // v Electronu jako Claude nebo Discord nemají v registru složku instalace)
  if (useSettings.getState().forceCloseRunning) return closeRunningApp(job, found, onWaiting);
  let remaining = found;
  const quiet = useSettings.getState().closeBackgroundProcesses ? found.filter(closableInBackground) : [];
  if (quiet.length) {
    const alive = await endProcesses(quiet.map((p) => p.pid)).catch(() => quiet.map((p) => p.pid));
    const ended = quiet.filter((p) => !alive.includes(p.pid));
    if (ended.length) {
      const params = { name: job.appName, processes: processNames(ended) };
      writeLog(job.source, "warning", i18n.t("logs.msg.endedProcesses", params));
      notifyEvent({
        type: "info",
        tone: "info",
        title: job.appName,
        message: i18n.t("notifications.endedProcesses", params),
        toast: i18n.t("toast.endedProcesses", params),
        record: { kind: job.kind, source: job.source, appId: job.appId },
      });
    }
    remaining = found.filter((p) => !ended.includes(p));
  }
  if (!remaining.length) return true;
  return useAppInUse.getState().ask({ appName: job.appName, kind: job.kind, processes: remaining });
}

/**
 * Po odinstalaci ukončí procesy, které ze složky aplikace dál běží (rezidentní
 * proces, pomocník u hodin) – držely by soubory a příští instalace by narazila.
 * Jen procesy ze složky instalace (backend si ji pamatuje z doby před
 * odinstalací), ne procesy nalezené jen podle názvu.
 */
async function endLeftoverProcesses(job: Job) {
  const found = (await findAppProcesses(job.packageId, job.appName).catch(() => [])).filter((p) => p.certain);
  if (!found.length) return;
  const alive = await endProcesses(found.map((p) => p.pid)).catch(() => found.map((p) => p.pid));
  const ended = found.filter((p) => !alive.includes(p.pid));
  if (ended.length) writeLog(job.source, "warning", i18n.t("logs.msg.endedLeftoverProcesses", { name: job.appName, processes: processNames(ended) }));
}

/** Sledovat instalaci / aktualizaci snímkem systému? (Nastavení, nebo výslovně u úlohy) */
const shouldTrack = (job: Job) =>
  isTauri() && (job.kind === "install" || job.kind === "update") && (!!job.track || useSettings.getState().trackInstalls);

/**
 * Dokončí sledování: po úspěchu uloží rozdíl snímků k aplikaci, jinak snímek
 * zahodí. Instalátory (Squirrel, NSIS) dopisují ještě chvíli po návratu
 * správce – druhý snímek proto počká; fronta mezitím další instalaci nespustí.
 */
async function finishTrace(token: number, job: Job, success: boolean) {
  try {
    if (!success) return await traceDiscard(token);
    await new Promise((r) => setTimeout(r, 3000));
    const count = await traceEnd(token, traceKey(job.source, job.packageId), job.appName);
    if (count) writeLog(job.source, "info", i18n.t("logs.msg.traced", { name: job.appName, count }));
  } catch (error) {
    console.warn("Sledování instalace selhalo:", error);
  }
}

/** Nabídne instalaci z jiného zdroje (FallbackOfferDialog); u nenainstalovaného správce s poznámkou. */
async function offerFallback(job: Job, error: string, sources: PackageSource[]) {
  const candidates = await Promise.all(sources.map(async (source) => ({ source, ready: await managerAvailable(source.source) })));
  useFallbackOffer.getState().open({ appId: job.appId, appName: job.appName, failedSource: job.source, error, candidates });
}

export const useJobs = create<JobsState>()((set, get) => {
  /** Upraví jednu úlohu (pokud ještě existuje). */
  const patch = (appId: string, changes: Partial<Job>) => {
    const job = get().jobs[appId];
    if (job) set({ jobs: { ...get().jobs, [appId]: { ...job, ...changes } } });
  };

  const remove = (appId: string) => {
    const rest = { ...get().jobs };
    delete rest[appId];
    set({ jobs: rest });
  };

  /** Jeden pokus úlohy u správce jejího zdroje; zapíše se do historie operací. */
  const attempt = async (job: Job): Promise<OperationResult> => {
    const startedAt = new Date().toISOString();
    // Aktualizace: verze před ní a nabízená verze – v historii kvůli „Vrátit na předchozí verzi“
    const before = job.kind === "update" ? installedPackageOf(job) : undefined;
    // Tiché oznámení o běžící operaci (jen s předvolbou, v okně nic – průběh je na kartě)
    notifyEvent({
      type: "progress",
      tone: "info",
      title: job.appName,
      message: i18n.t("notifications.progress", { kind: i18n.t(`history.kind.${job.kind}`), source: getSource(job.source).label }),
      toast: false,
    });
    // Začátek aktuální fáze – odhad procent u instalace a její skutečná délka pro příště
    // (bez zúžení typu na null – mění se v callbacku)
    let phase = null as OperationPhase | null;
    let phaseSince = Date.now();
    // Stahovalo se – instalace na kartě pokračuje v jednom procentu za stahováním
    let downloaded = false;
    // Vydavatel minulého instalátoru (store/signers.ts) – jiný nebo chybějící podpis backend zastaví
    const signerKey = `${job.source}:${job.packageId}`;
    const expectedSigner = checksSigner(job.source, job.kind) ? useSigners.getState().known[signerKey] : undefined;
    const options = expectedSigner !== undefined ? { ...job.options, expectedSigner } : job.options;
    const handle = managers[job.source].startOperation(
      // Vlastní argumenty, příkazy před / po instalaci a „jako správce“ jen podle Nastavení → Oprávnění správce
      adoptedRequest(job, {
        kind: job.kind,
        packageId: job.packageId,
        version: job.version,
        options: applySecurityPolicy(options),
        name: job.appName,
        background: job.background,
      }),
      (progress) => {
        if (progress.phase !== phase) {
          // Délka stahování pro příště – podíl stahování na celkovém procentu
          if (phase === "downloading") recordPhaseDuration(job, phase, Date.now() - phaseSince);
          phase = progress.phase;
          phaseSince = Date.now();
        }
        if (progress.phase === "downloading") downloaded = true;
        patch(job.appId, { progress: { ...progress, since: phaseSince, downloaded } });
      },
    );
    handles.set(job.appId, handle);
    const result = await handle.done;
    handles.delete(job.appId);
    // Vydavatel instalátoru: zapamatovat po úspěchu, zastavenou změnu nabídnout k přijetí v detailu
    if (checksSigner(job.source, job.kind) && result.signer !== undefined) {
      if (result.outcome === "success") useSigners.getState().remember(signerKey, result.signer);
      else if (expectedSigner !== undefined && (result.errorKey === "signerChanged" || result.errorKey === "signatureMissing")) {
        useSigners.getState().markChanged(signerKey, { from: expectedSigner, to: result.signer, version: job.targetVersion ?? before?.availableVersion ?? undefined });
      }
    }
    if (result.outcome === "success" && phase) recordPhaseDuration(job, phase, Date.now() - phaseSince);
    // Na pozadí přeskočeno kvůli právům správce – nic neproběhlo, do historie operací nepatří
    if (needsAdminLater(job, result)) return result;
    // Pozastavené stahování do historie nepatří – úloha bude pokračovat
    if (result.paused) return result;

    useHistory.getState().add({
      id: job.id,
      appId: job.appId,
      appName: job.appName,
      source: job.source,
      packageId: job.packageId,
      kind: job.kind,
      version: job.version,
      ...(before?.installedVersion && { fromVersion: before.installedVersion }),
      ...((job.targetVersion ?? before?.availableVersion) && { toVersion: job.targetVersion ?? before?.availableVersion ?? undefined }),
      options: job.options,
      outcome: result.outcome,
      error: result.error,
      ...(result.errorKey && { errorKey: result.errorKey }),
      background: job.background,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    return result;
  };

  /**
   * Vezme další úlohu z fronty a spustí ji. Nečekaná chyba (dialog, oznámení…) frontu
   * nezastaví: úloha se vyřadí a pokračuje se další – jinak by zůstalo `running` a žádná
   * další instalace by do restartu HubGetu neproběhla.
   */
  const processNext = async () => {
    if (running) return;
    const appId = queue[0];
    try {
      await runNext();
    } catch (error) {
      console.error("Fronta operací:", error);
      if (appId) {
        handles.delete(appId);
        remove(appId);
      }
      running = false;
      void processNext();
    }
  };

  const runNext = async () => {
    const appId = queue.shift();
    if (!appId) return;
    let job = get().jobs[appId];
    if (!job) return processNext();

    running = true;
    // Další úlohy ve frontě si zatím stáhnou instalátor (winget) – pak se jen ověří a nainstalují
    prefetchQueued();
    // Automatická aktualizace běžící aplikace počká na příští kontrolu – bez oznámení
    if (job.background && job.kind === "update" && !(await backgroundReady(job))) {
      writeLog(job.source, "info", i18n.t("logs.msg.skippedRunning", { name: job.appName }));
      remove(appId);
      running = false;
      return processNext();
    }
    const first = job;
    // Verze, na kterou se aktualizuje – pro hlášení spolehlivosti verzí (store/reliability.ts)
    const updateTarget = job.kind === "update" ? (job.targetVersion ?? usePackageIndex.getState().installed.get(job.appId)?.availableVersion ?? undefined) : undefined;
    // Chybějící správce (Chocolatey, Scoop) – nejdřív výzva k jeho instalaci;
    // běžící aplikaci zavřít (nebo se zeptat), ať ji instalátor může přepsat
    let result: OperationResult = { outcome: "cancelled" };
    // Uvolnění aplikace: verze a jestli se nastavení podařilo zálohovat (po úspěchu do store/offloaded)
    let offloadInfo: { version: string; backup: boolean } | null = null;
    // Kontrola po aktualizaci: hlavní program a jeho podpis před aktualizací (checkAfterUpdate)
    let beforeSignature: AppSignature | null = null;
    // Snímek systému před instalací (sledování instalace)
    let trace: number | null = null;
    // Čekání, až uživatel uloží práci a zavře běžící aplikaci – fáze na kartě (zrušit jde křížkem)
    const waitingForApp = () => patch(appId, { progress: { phase: "closingApp", percent: null, since: Date.now() } });
    // Málo místa na disku: operaci nespustit (instalátor by spadl v polovině) a poradit úklid
    const shortage = await diskShortage(job);
    if (shortage) {
      const size = (bytes: number) => formatSizeText(bytes, i18n.language);
      result = {
        outcome: "error",
        errorKey: "diskFull",
        error: i18n.t("disk.shortage", { drive: shortage.drive, free: size(shortage.free), needed: size(shortage.needed) }),
      };
      writeLog(job.source, "warning", `${job.appName}: ${result.error}`);
    } else if ((await managerReady(job.source, job.background)) && (await prepareProcesses(job, waitingForApp))) {
      // Aplikace je zavřená – do hlášení průběhu od správce zase „ve frontě“
      if (get().jobs[appId]?.progress.phase === "closingApp") patch(appId, { progress: { phase: "queued", percent: null } });
      if (shouldTrack(job)) trace = await traceBegin().catch(() => null);
      // Uživatel úlohu zrušil během přípravy (snímek systému, zjišťování běžících procesů) – úloha
      // z karty zmizela, operace se tedy nespustí (jinak by proběhla bez průběhu na kartě)
      if (!get().jobs[appId]) {
        if (trace !== null) await traceDiscard(trace).catch(() => undefined);
        running = false;
        return processNext();
      }
      if (job.replaceInstalled && job.kind === "install") {
        // Starší verze místo novější: správce downgrade odmítá – nejdřív odinstalovat (nastavení
        // a data aplikace odinstalátor obvykle nechá), pak nainstalovat zvolenou verzi
        const removed = await attempt({ ...job, id: crypto.randomUUID(), kind: "uninstall", version: undefined, options: undefined });
        if (removed.outcome !== "success") result = removed;
        // Zrušeno po odinstalaci – ohlásit zrušení, ne úspěch odinstalace jako instalaci
        else if (!get().jobs[appId]) result = { outcome: "cancelled" };
        else {
          result = await attempt(job);
          // Zvolená verze nejde nainstalovat (už není ke stažení…) – aplikace by zůstala
          // odinstalovaná: vrátit aspoň nejnovější verzi (chyba vrácení se ohlásí i tak)
          if (result.outcome === "error" && get().jobs[appId]) {
            await attempt({ ...job, id: crypto.randomUUID(), version: undefined, replaceInstalled: undefined, skipVersion: undefined });
          }
        }
        if (result.outcome === "success" && job.skipVersion) {
          skipBadVersion(job, job.skipVersion, job.appName);
          // Vrácená aktualizace: i nastavení z doby před ní (záloha před aktualizací)
          if (job.version) await restoreSettings(job, job.version);
        }
      } else {
        if (job.kind === "update") await backupSettings(job);
        if (job.kind === "update") beforeSignature = await mainProgram(job);
        if (job.kind === "uninstall" && job.offload) offloadInfo = await offloadBackup(job);
        result = await attempt(job);
      }
    }
    // Spolehlivost verzí od komunity (jen se zapnutým sdílením): výsledek aktualizace, vrácená verze
    reportJobOutcome(job, result, updateTarget);
    // Žebříček instalací v HubGetu (dobrovolně, anonymně – store/installStats.ts)
    reportInstall(job, result);

    // Úloha na pozadí (nikdo se nedívá): instalátor ze zdroje nejde stáhnout → stejná
    // aplikace u dalších nainstalovaných správců, dokud se instalace nepovede.
    // V popředí se místo toho nabídne výběr zdroje (offerFallback níže).
    const fallbacks: SourceId[] = [];
    if (job.background && job.kind === "install" && result.outcome === "error" && UNAVAILABLE_INSTALLER.has(result.errorKey ?? "")) {
      for (const next of await fallbackSources(job)) {
        // Uživatel úlohu mezitím zrušil (mezi pokusy žádný proces neběží)
        if (!get().jobs[appId]) {
          result = { outcome: "cancelled" };
          break;
        }
        const labels = { name: job.appName, from: getSource(job.source).label, to: getSource(next.source).label };
        // Poprvé instalátor nešel stáhnout, potom selhala i předchozí záložní instalace
        const key = fallbacks.length === 0 ? "fallback" : "fallbackNext";
        writeLog(job.source, "warning", i18n.t(`logs.msg.${key}`, labels));
        notifyEvent({
          type: "info",
          tone: "info",
          title: job.appName,
          message: i18n.t(`notifications.${key}`, { ...labels, error: result.error ?? "" }),
          toast: i18n.t(`toast.${key}`, labels),
          record: { kind: job.kind, source: job.source, appId },
        });
        // Volby a verze patřily původnímu zdroji – záložní instaluje nejnovější verzi s výchozími volbami
        job = {
          ...job,
          id: crypto.randomUUID(),
          source: next.source,
          packageId: next.packageId,
          version: undefined,
          options: undefined,
          progress: { phase: "queued", percent: null },
        };
        patch(appId, job);
        fallbacks.push(next.source);
        result = await attempt(job);
        if (result.outcome !== "error") break;
      }
    }

    // Druhý snímek a uložení rozdílu (zdroj a id podle toho, přes kterého správce se instalovalo)
    if (trace !== null) await finishTrace(trace, job, result.outcome === "success");

    const lastProgress = get().jobs[appId]?.progress;
    remove(appId);
    running = false;

    // Pozastavené stahování: úloha čeká mimo frontu na Pokračovat (rozstažený instalátor zůstal).
    // Starší verze místo novější už je po odinstalaci – pokračuje se jen instalací.
    if (result.paused) {
      const { appName, source, packageId, kind, version, options, track, targetVersion } = job;
      const request: EnqueueRequest = { appId, appName, source, packageId, kind, version, options, track, targetVersion };
      usePausedJobs.getState().add(appId, { request, percent: lastProgress?.percent ?? null, at: Date.now() });
      writeLog(job.source, "info", i18n.t("logs.msg.paused", { name: job.appName }));
      return processNext();
    }

    // Aplikace naběhla během operace (nebo ji předem nešlo najít) a instalátor ji nemohl přepsat –
    // se zavíráním bez dotazu ji zavřít a operaci jednou zopakovat, bez dialogu
    if (await retryAfterClosing(job, result, get().enqueue)) return processNext();

    // Automatická aktualizace, která potřebuje práva správce: na pozadí bez dialogu UAC – verze
    // počká na ruční aktualizaci (Dostupné aktualizace) a jednou se to klidně oznámí do zvonečku
    if (needsAdminLater(job, result)) {
      writeLog(job.source, "info", i18n.t("logs.msg.needsAdmin", { name: job.appName }));
      if (job.kind === "update" && job.targetVersion && useUpdateHolds.getState().holdForManual(versionKey(job, job.targetVersion))) {
        notifyEvent({
          type: "info",
          tone: "info",
          title: job.appName,
          message: i18n.t("autoUpdates.needsAdmin", { version: job.targetVersion }),
          record: { kind: job.kind, source: job.source, appId },
          popup: false,
        });
      }
      return processNext();
    }

    // Oznámení výsledku (včetně zdroje, přes který se instalovalo) podle Nastavení → Oznámení:
    // krátce v rohu okna / ve Windows a trvale v historii (zvoneček) – tam bez názvu aplikace,
    // ten má záznam zvlášť
    const { outcome, error, restartRequired } = result;
    // U konkrétní verze ji uvedeme v názvu („Steam 2.10.91.85“)
    const params = {
      name: job.version ? `${job.appName} ${job.version}` : job.appName,
      source: getSource(job.source).label,
      kind: i18n.t(`history.kind.${job.kind}`),
      from: getSource(first.source).label,
      sources: fallbacks.map((s) => getSource(s).label).join(", "),
      error: error ?? "",
    };
    // [druh události, tón, klíč oznámení v rohu, klíč záznamu v historii]
    const [type, tone, toastKey, noteKey]: [NotifyEventType, ToastTone, string, string] =
      outcome === "success" && restartRequired
        ? ["success", "info", "toast.restartRequired", "notifications.restartRequired"]
        : outcome === "success"
          ? ["success", "success", `toast.${job.kind}Done`, `notifications.${job.kind}Done`]
          : outcome === "cancelled"
            ? ["info", "info", "toast.cancelled", "notifications.cancelled"]
            : fallbacks.length > 0
              ? ["failure", "error", "toast.fallbackFailed", "notifications.fallbackFailed"]
              : ["failure", "error", "toast.failed", "notifications.failed"];
    // Selhání automatické aktualizace jen do historie (zvoneček) – HubGet to zkusí příště;
    // po AUTO_FAILURE_LIMIT pokusech o stejnou verzi ji nechá na uživateli a jednou to klidně oznámí
    const quietFailure = !!job.background && outcome === "error";
    if (quietFailure && job.kind === "update" && job.targetVersion) {
      const failures = useUpdateHolds.getState().recordAutoFailure(versionKey(job, job.targetVersion));
      if (failures === AUTO_FAILURE_LIMIT) {
        notifyEvent({
          type: "failure",
          tone: "info",
          title: job.appName,
          message: i18n.t("autoUpdates.gaveUp", { version: job.targetVersion }),
          record: { kind: job.kind, source: job.source, appId },
        });
      }
    }
    if (!quietFailure) batch[outcome]++;
    if (outcome === "error" && !job.background) {
      const { appName, source, packageId, kind, version, options } = job;
      batchFailed.push({ appId, appName, source, packageId, kind, version, options });
    }
    const batchTotal = batch.success + batch.error + batch.cancelled;
    const more = queue.length > 0;
    // Během dávky víc operací jednotlivé úspěchy jen do historie – na konci přijde souhrn
    const summarize = useNotificationPrefs.getState().batchSummary && (more || batchTotal > 1);
    // Instalace v popředí selhala, ale aplikace je i u jiných správců → nabídnout je
    const alternatives =
      job.kind === "install" && outcome === "error" && !job.background && OFFER_FALLBACK.has(result.errorKey ?? "")
        ? otherSources(job)
        : [];
    notifyEvent({
      type,
      // Selhání na pozadí do zvonečku jako informace – bez červeného počtu nových chyb
      tone: quietFailure ? "info" : tone,
      title: params.name,
      message: i18n.t(noteKey, params),
      // S nabídkou jiného zdroje chybu vysvětlí dialog – v rohu okna se neopakuje
      toast: alternatives.length ? false : i18n.t(toastKey, params),
      record: { kind: job.kind, source: job.source, appId },
      popup: !(summarize && outcome === "success") && !quietFailure,
      // Tlačítka v oznámení Windows: po instalaci či aktualizaci Otevřít, po chybě Podrobnosti
      actions: outcome === "success" ? (job.kind === "install" || job.kind === "update" ? "installed" : undefined) : outcome === "error" ? "failed" : undefined,
      appId,
    });
    if (alternatives.length) void offerFallback(job, error ?? "", alternatives);
    if (!more) {
      if (summarize) {
        notifyEvent({
          type: "summary",
          tone: batch.error ? "error" : "success",
          title: null,
          message: i18n.t("notifications.summary", { success: batch.success, failed: batch.error, cancelled: batch.cancelled }),
        });
      }
      batch = { success: 0, error: 0, cancelled: 0 };
      // Zkusit neúspěšné znovu (s hlídáním programů, které drží soubory) – nabídka nad aktualizacemi
      if (batchFailed.length) useFailedBatch.getState().set(batchFailed);
      batchFailed = [];
      // Po dokončení uspat / vypnout počítač (Aktualizovat vše → Po dokončení)
      useAfterBatch.getState().batchEnded();
    }

    // Přes kterého správce je aplikace nainstalovaná (štítek a správa i po restartu)
    if (outcome === "success" && job.kind === "install") useInstalledVia.getState().installed(job.source, job.packageId);
    if (outcome === "success" && job.kind === "uninstall") useInstalledVia.getState().removed(job.source, job.packageId);
    // Uvolněná aplikace: zapamatovat (Dříve nainstalované); po opětovné instalaci vrátit nastavení
    if (outcome === "success" && job.kind === "uninstall" && job.offload && offloadInfo) reportOffloaded(job, offloadInfo);
    if (outcome === "success" && job.kind === "install") void restoreOffloaded(job);
    // Aplikace běží (OBS při aktualizaci…) – nabídnout ji zavřít a zkusit znovu; soubory aplikace
    // drží jiný program (virtuální kamera OBS v prohlížeči) – nabídnout zavřít ten
    const inUse = result.errorKey === "inUse" || result.errorKey === "inUseByOther";
    if (outcome === "error" && inUse && !job.background) {
      const { appId: id, appName, source, packageId, kind, version, options } = job;
      useAppInUse.getState().open({ appId: id, appName, source, packageId, kind, version, options }, result.errorKey === "inUseByOther");
    }

    // Stav v UI hned podle výsledku, pak ověření u správce (na pozadí – další úloha nečeká)
    void refreshAfterOperation(job, outcome === "success");
    // Po aktualizaci ověřit, že hlavní program je na místě a jeho podpis platí
    if (outcome === "success" && job.kind === "update" && beforeSignature) void checkAfterUpdate(job, beforeSignature);
    // Po odinstalaci ukončit procesy, které ze složky aplikace dál běží, pak najít zbytky
    // (složky, při pokročilé odinstalaci i registr) a nabídnout je smazat / smazat je
    if (job.kind === "uninstall" && outcome === "success") {
      // Uvolněná aplikace si nastavení a data nechává – zbytky se nenabízejí ke smazání
      void endLeftoverProcesses(job).then(() => {
        if (!job.offload) return useLeftovers.getState().check(job.appName, job.packageId, job.source);
      });
    }
    void processNext();
  };

  return {
    jobs: {},

    enqueue: ({ appId, appName, source, packageId, kind, version, replaceInstalled, skipVersion, options, background, track, targetVersion, offload }) => {
      if (get().jobs[appId]) return; // už ve frontě nebo běží
      // Firemní zásady: neschválená aplikace / zakázaný správce (backend ji odmítne i sám)
      if ((kind === "install" || kind === "update") && (!sourceAllowed(source) || (kind === "install" && !appAllowed(source, packageId)))) {
        useToasts.getState().push("error", i18n.t(sourceAllowed(source) ? "orgPolicy.appBlocked" : "orgPolicy.sourceBlocked", { name: appName, source: getSource(source).label }));
        return;
      }
      set({
        jobs: {
          ...get().jobs,
          [appId]: {
            id: crypto.randomUUID(),
            appId,
            appName,
            source,
            packageId,
            kind,
            version,
            replaceInstalled,
            skipVersion,
            options,
            background,
            track,
            targetVersion,
            offload,
            progress: { phase: "queued", percent: null },
          },
        },
      });
      // Pozastavené stahování téže aplikace: nová úloha na rozstažený instalátor naváže sama
      usePausedJobs.getState().remove(appId);
      queue.push(appId);
      void processNext();
    },

    pause: (appId) => {
      void handles.get(appId)?.pause?.();
    },

    resume: (appId) => {
      const paused = usePausedJobs.getState().items[appId];
      if (!paused) return;
      usePausedJobs.getState().remove(appId);
      get().enqueue(paused.request);
    },

    discardPaused: (appId) => usePausedJobs.getState().remove(appId),

    cancel: (appId) => {
      const handle = handles.get(appId);
      if (handle) {
        handle.cancel(); // běžící úloha – výsledek dořeší processNext
        return;
      }
      // Čekající úloha – jen ji vyřadíme z fronty (a zastavíme stahování dopředu)
      const index = queue.indexOf(appId);
      if (index >= 0) queue.splice(index, 1);
      const waiting = get().jobs[appId];
      if (waiting && isTauri()) void invoke("cancel_prefetch_ahead", { packageId: waiting.packageId }).catch(() => undefined);
      remove(appId);
    },
  };
});

/** Id aplikací s úlohou jako jeden řetězec – při změně průběhu (procent) zůstane stejný. */
const busyKey = (s: JobsState) => Object.keys(s.jobs).join("\n");

/**
 * Aplikace, které mají ve frontě úlohu. Pro komponenty, které potřebují jen
 * vědět „už se instaluje“: na rozdíl od celého `jobs` se nepřekreslí při každé
 * změně průběhu stahování (několikrát za sekundu), jen když úloha přibude nebo skončí.
 */
export function useBusyAppIds(): ReadonlySet<string> {
  const key = useJobs(busyKey);
  return useMemo(() => new Set(key ? key.split("\n") : []), [key]);
}
