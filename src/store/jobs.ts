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
import { useMemo } from "react";
import { create } from "zustand";
import { queryClient, queryKeys } from "@/app/queryClient";
import i18n from "@/i18n";
import { getSource, managers, type OperationHandle, type OperationResult } from "@/services/managers";
import type { LoadedCatalog } from "@/services/catalog";
import { notifyEvent, type NotifyEventType } from "@/services/notify";
import { closableInBackground, closeProcesses, endProcesses, findAppProcesses } from "@/services/processes";
import { traceBegin, traceDiscard, traceEnd, traceKey } from "@/services/tracker";
import { recordPhaseDuration } from "@/lib/phaseEstimate";
import { isTauri } from "@/lib/tauri";
import type { InstallOptions, Job, OperationKind, OperationOutcome, OperationPhase, PackageSource, SourceId } from "@/types";
import { refreshAfterOperation } from "./afterOperation";
import { useHistory } from "./history";
import { useLeftovers } from "./leftovers";
import { writeLog } from "./logs";
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
  /** Volby instalace (jako správce, interaktivně…). */
  options?: InstallOptions;
  /** Automatická aktualizace na pozadí – bez dotazů (zavření běžící aplikace, instalace správce). */
  background?: boolean;
  /** Sledovat instalaci snímkem systému („Nainstalovat se sledováním“). */
  track?: boolean;
  /** Automatická aktualizace: nabízená verze. */
  targetVersion?: string;
}

interface JobsState {
  /** Aktivní a čekající úlohy podle id aplikace. */
  jobs: Record<string, Job>;
  enqueue: (request: EnqueueRequest) => void;
  cancel: (appId: string) => void;
}

// Mimo React stav – nemusí vyvolávat překreslení.
const queue: string[] = [];
const handles = new Map<string, OperationHandle>();
let running = false;
/** Výsledky právě probíhající dávky operací (do vyprázdnění fronty) – pro souhrnné oznámení. */
let batch: Record<OperationOutcome, number> = { success: 0, error: 0, cancelled: 0 };

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

/** Názvy procesů bez opakování („obs64.exe, obs-ffmpeg-mux.exe“). */
const processNames = (processes: { name: string }[]) => [...new Set(processes.map((p) => p.name))].join(", ");

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

/** Operace na pozadí, kterou backend nespustil (nebo nezopakoval), protože by potřebovala dialog UAC. */
const needsAdminLater = (job: Job, result: OperationResult) => !!job.background && result.errorKey === "needsAdmin";

async function prepareProcesses(job: Job): Promise<boolean> {
  if (job.background || job.kind === "download") return true;
  const found = await findAppProcesses(job.packageId, job.appName).catch(() => []);
  if (!found.length) return true;
  // Nastavení „Ukončit běžící aplikaci natvrdo bez dotazu“: hned natvrdo, i s oknem, bez dialogu –
  // stejné procesy, jaké by dialog nabídl ukončit (i nalezené jen podle názvu: aplikace v Electronu
  // jako Claude nebo Discord nemají v registru složku instalace)
  if (useSettings.getState().forceCloseRunning) {
    const alive = await closeProcesses(found.map((p) => p.pid), true).catch(() => found.map((p) => p.pid));
    const ended = found.filter((p) => !alive.includes(p.pid));
    if (ended.length) {
      const params = { name: job.appName, processes: processNames(ended) };
      writeLog(job.source, "warning", i18n.t("logs.msg.forceClosed", params));
      notifyEvent({
        type: "info",
        tone: "info",
        title: job.appName,
        message: i18n.t("notifications.forceClosed", params),
        toast: i18n.t("toast.forceClosed", params),
        record: { kind: job.kind, source: job.source, appId: job.appId },
      });
    }
    return true;
  }
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
    const handle = managers[job.source].startOperation(
      // Vlastní argumenty, příkazy před / po instalaci a „jako správce“ jen podle Nastavení → Oprávnění správce
      {
        kind: job.kind,
        packageId: job.packageId,
        version: job.version,
        options: applySecurityPolicy(job.options),
        name: job.appName,
        background: job.background,
      },
      (progress) => {
        if (progress.phase !== phase) {
          phase = progress.phase;
          phaseSince = Date.now();
        }
        patch(job.appId, { progress: { ...progress, since: phaseSince } });
      },
    );
    handles.set(job.appId, handle);
    const result = await handle.done;
    handles.delete(job.appId);
    if (result.outcome === "success" && phase) recordPhaseDuration(job, phase, Date.now() - phaseSince);
    // Na pozadí přeskočeno kvůli právům správce – nic neproběhlo, do historie operací nepatří
    if (needsAdminLater(job, result)) return result;

    useHistory.getState().add({
      id: job.id,
      appId: job.appId,
      appName: job.appName,
      source: job.source,
      packageId: job.packageId,
      kind: job.kind,
      version: job.version,
      options: job.options,
      outcome: result.outcome,
      error: result.error,
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
    // Automatická aktualizace běžící aplikace počká na příští kontrolu – bez oznámení
    if (job.background && job.kind === "update" && !(await backgroundReady(job))) {
      writeLog(job.source, "info", i18n.t("logs.msg.skippedRunning", { name: job.appName }));
      remove(appId);
      running = false;
      return processNext();
    }
    const first = job;
    // Chybějící správce (Chocolatey, Scoop) – nejdřív výzva k jeho instalaci;
    // běžící aplikaci zavřít (nebo se zeptat), ať ji instalátor může přepsat
    let result: OperationResult = { outcome: "cancelled" };
    // Snímek systému před instalací (sledování instalace)
    let trace: number | null = null;
    if ((await managerReady(job.source, job.background)) && (await prepareProcesses(job))) {
      if (shouldTrack(job)) trace = await traceBegin().catch(() => null);
      // Uživatel úlohu zrušil během přípravy (snímek systému, zjišťování běžících procesů) – úloha
      // z karty zmizela, operace se tedy nespustí (jinak by proběhla bez průběhu na kartě)
      if (!get().jobs[appId]) {
        if (trace !== null) await traceDiscard(trace).catch(() => undefined);
        running = false;
        return processNext();
      }
      result = await attempt(job);
    }

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

    remove(appId);
    running = false;

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
    }

    // Přes kterého správce je aplikace nainstalovaná (štítek a správa i po restartu)
    if (outcome === "success" && job.kind === "install") useInstalledVia.getState().installed(job.source, job.packageId);
    if (outcome === "success" && job.kind === "uninstall") useInstalledVia.getState().removed(job.source, job.packageId);
    // Aplikace běží (OBS při aktualizaci…) – nabídnout ji zavřít a zkusit znovu
    if (outcome === "error" && result.errorKey === "inUse" && !job.background) {
      const { appId: id, appName, source, packageId, kind, version, options } = job;
      useAppInUse.getState().open({ appId: id, appName, source, packageId, kind, version, options });
    }

    // Stav v UI hned podle výsledku, pak ověření u správce (na pozadí – další úloha nečeká)
    void refreshAfterOperation(job, outcome === "success");
    // Po odinstalaci ukončit procesy, které ze složky aplikace dál běží, pak najít zbytky
    // (složky, při pokročilé odinstalaci i registr) a nabídnout je smazat / smazat je
    if (job.kind === "uninstall" && outcome === "success") {
      void endLeftoverProcesses(job).then(() => useLeftovers.getState().check(job.appName, job.packageId, job.source));
    }
    void processNext();
  };

  return {
    jobs: {},

    enqueue: ({ appId, appName, source, packageId, kind, version, options, background, track, targetVersion }) => {
      if (get().jobs[appId]) return; // už ve frontě nebo běží
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
            options,
            background,
            track,
            targetVersion,
            progress: { phase: "queued", percent: null },
          },
        },
      });
      queue.push(appId);
      void processNext();
    },

    cancel: (appId) => {
      const handle = handles.get(appId);
      if (handle) {
        handle.cancel(); // běžící úloha – výsledek dořeší processNext
        return;
      }
      // Čekající úloha – jen ji vyřadíme z fronty
      const index = queue.indexOf(appId);
      if (index >= 0) queue.splice(index, 1);
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
