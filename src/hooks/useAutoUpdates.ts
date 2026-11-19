/**
 * Automatická kontrola a instalace aktualizací balíčků na pozadí (Nastavení →
 * Aktualizace balíčků, po vzoru UniGetUI). Běží, dokud je HubGet spuštěný –
 * i schovaný u hodin:
 *  - každou minutu se podívá, jestli je kontrola / instalace na řadě: v pevném
 *    intervalu, nebo každý den / ve vybrané dny v zadaný čas (lib/schedule.ts),
 *  - zmeškaný termín (HubGet neběžel, počítač spal) dožene se zpožděním, hned,
 *    nebo počká na další termín – podle nastavení,
 *  - kontrola = nové načtení seznamu nainstalovaných u správců (dostupné verze),
 *    během ní je ikona u hodin modrá (useTrayStatus),
 *  - nové aktualizace oznámí (Nastavení → Oznámení, bez vynechaných správců)
 *    a podle nastavení zařadí do fronty – všechny, nebo jen vybrané aplikace,
 *    s uloženými volbami instalace. Na baterii, při úspoře baterie a na měřeném
 *    připojení podle voleb ne – oznámí, že aktualizace čekají, a zkusí to znovu
 *    za čtvrt hodiny. Aktualizaci, jejíž instalátor se stahuje z jiného serveru
 *    než u nainstalované verze (winget), vynechá a oznámí. Chyby zapíše fronta
 *    do historie oznámení.
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { queryClient, queryKeys } from "@/app/queryClient";
import i18n from "@/i18n";
import { dueTime, type Schedule } from "@/lib/schedule";
import { isTauri } from "@/lib/tauri";
import { refreshChocoOutdated, refreshScoopBuckets } from "@/services/managers";
import { notifyEvent } from "@/services/notify";
import { IDLE_MINUTES, INTERVAL_MS, useAutoUpdates } from "@/store/autoUpdates";
import { updateOptionsFor } from "@/store/installOptions";
import { installerHostChange } from "@/store/installerUrls";
import { useJobs } from "@/store/jobs";
import { useNotificationPrefs } from "@/store/notificationPrefs";
import { useSettings } from "@/store/settings";
import { AUTO_FAILURE_LIMIT, useUpdateHolds, versionKey } from "@/store/updateHolds";
import { pinKey, useUpdatePins } from "@/store/updatePins";
import { applyUpdateRules, currentUpdateRules } from "@/store/updateRules";
import { isSecurityUpdate } from "./useSecurityUpdates";
import { holdByCommunity } from "@/store/reliability";
import { writeLog } from "@/store/logs";
import type { InstalledPackage } from "@/types";
import { isUnmanagedOrigin, useInstalledItems, type InstalledItem } from "./useInstalledItems";

/** Aktuální spárování nainstalovaných s katalogem (id karty a název) – z hooku níže. */
let currentItems: InstalledItem[] = [];

/** Proč se automatická instalace nespustila. */
export type SkipReason = "battery" | "saver" | "metered" | "busy" | "active";

/** Výsledek kontroly: počet dostupných aktualizací a kolik se jich zařadilo k instalaci. */
export interface CheckResult {
  available: number;
  queued: number;
  skipped?: SkipReason;
}

type Task = "check" | "install";

/** Zmeškaný termín „se zpožděním“ se dožene tolik po spuštění / probuzení. */
const MISSED_DELAY = 10 * 60_000;
/** Instalace odložená kvůli baterii nebo připojení se zkusí znovu za tuto dobu. */
const RETRY_DELAY = 15 * 60_000;

/** Od kdy plánovač běží bez přerušení (spuštění HubGetu, probuzení počítače). */
let aliveSince = Date.now();
let lastTick = Date.now();
/** Přeskočené termíny (podle úlohy) – další se počítá od nich. */
const skipped: Record<Task, number | null> = { check: null, install: null };
/** Kdy dohnat zmeškaný termín (zpoždění po spuštění). */
const catchUpAt: Record<Task, number | null> = { check: null, install: null };
/** Odložená automatická instalace – kdy to zkusit znovu. */
let retryAt: number | null = null;
/** Verze, u kterých už zaznělo varování o jiném serveru instalátoru („zdroj:id@verze“). */
const hostWarned = new Set<string>();
/** Verze, které automatické aktualizace přeskočily kvůli hlášením komunity (zápis do protokolu jednou). */
const communityWarned = new Set<string>();

/** Aktualizace k instalaci z posledního načtení (s pravidly: zámky, minimální stáří…). */
function currentUpdatable(): InstalledPackage[] {
  const raw = queryClient.getQueriesData<InstalledPackage[]>({ queryKey: queryKeys.installed }).flatMap(([, d]) => d ?? []);
  const updatable = applyUpdateRules(raw, currentUpdateRules()).filter((p) => p.availableVersion && !isUnmanagedOrigin(p.origin));
  return [...new Map(updatable.map((p) => [pinKey(p), p])).values()];
}

/** Načte znovu seznam nainstalovaných u správců a zapíše nově viděné verze. */
async function refreshInstalled() {
  // Nejdřív dostupné verze od správců, výpis nainstalovaných je pak použije: dotaz na repozitář
  // Chocolatey a obnova bucketů Scoopu (jinak zůstanou ve stavu po posledním ručním `scoop update`)
  const enabled = useSettings.getState().enabledSources;
  if (isTauri()) {
    await Promise.all([
      enabled.includes("chocolatey") && refreshChocoOutdated().catch(() => undefined),
      enabled.includes("scoop") && refreshScoopBuckets().catch(() => undefined),
    ]);
  }
  await queryClient.refetchQueries({ queryKey: queryKeys.installed });
  const raw = queryClient.getQueriesData<InstalledPackage[]>({ queryKey: queryKeys.installed }).flatMap(([, d]) => d ?? []);
  const holds = useUpdateHolds.getState();
  holds.see(raw);
  // Pravidla (minimální stáří) podle aktuálního času
  holds.tick();
}

/** Zkontroluje aktualizace hned (tlačítko „Spustit tuto úlohu nyní“ i plánovač). */
export async function runUpdateCheck(): Promise<CheckResult> {
  const state = useAutoUpdates.getState();
  if (state.checking) return { available: 0, queued: 0 };
  state.set({ checking: true });
  try {
    await refreshInstalled();
    const unique = currentUpdatable();
    useAutoUpdates.getState().set({ lastCheck: new Date().toISOString() });

    // Oznámit jen nově nalezené aktualizace (stejné se neopakují každou hodinu) a ne od vynechaných správců
    const ignored = useNotificationPrefs.getState().updatesIgnoredSources;
    const announced = unique.filter((p) => !ignored.includes(p.source));
    const signature = announced.map((p) => `${pinKey(p)}@${p.availableVersion}`).sort().join("|");
    if (announced.length && signature !== useAutoUpdates.getState().lastNotified) {
      useAutoUpdates.getState().set({ lastNotified: signature });
      // Bezpečnostní aktualizace v oznámení první a zvlášť spočítané
      const security = announced.filter((p) => isSecurityUpdate(p));
      const names = [...security, ...announced.filter((p) => !security.includes(p))].slice(0, 3).map((p) => p.name).join(", ");
      notifyEvent({
        type: "updates",
        tone: security.length ? "error" : "info",
        title: null,
        message: security.length
          ? i18n.t("autoUpdates.foundSecurity", { total: announced.length, security: security.length, names })
          : i18n.t("autoUpdates.found", { count: announced.length, names }),
        record: true,
        // Tlačítka v oznámení Windows: Aktualizovat vše, Zobrazit
        actions: "updates",
      });
    }
    // Instalace po každé kontrole; jinak má vlastní plán
    const afterCheck = useAutoUpdates.getState().installRepeat === "afterCheck";
    return { available: unique.length, ...(afterCheck ? await installUpdates(unique) : { queued: 0 }) };
  } finally {
    useAutoUpdates.getState().set({ checking: false });
  }
}

/** Naplánovaná instalace (každý den / ve vybrané dny): čerstvý seznam a instalace podle nastavení. */
async function runScheduledInstall() {
  useAutoUpdates.getState().set({ lastInstall: new Date().toISOString() });
  await refreshInstalled();
  await installUpdates(currentUpdatable());
}

/** Zařadí aktualizace k instalaci podle nastavení (vše / vybrané, baterie, úspora, měřené připojení). */
async function installUpdates(updatable: InstalledPackage[]): Promise<Omit<CheckResult, "available">> {
  const { autoInstall, selected, skipOnBattery, skipOnSaver, skipOnMetered, skipWhileBusy, onlyWhenIdle } = useAutoUpdates.getState();
  // Verze, jejichž automatická aktualizace už AUTO_FAILURE_LIMIT× selhala nebo potřebuje práva
  // správce (Čeká na potvrzení), zůstanou na uživateli
  const { failed, needsAdmin } = useUpdateHolds.getState();
  const chosen = (autoInstall === "all" ? updatable : updatable.filter((p) => selected.includes(pinKey(p)))).filter((p) => {
    const key = versionKey(p, p.availableVersion!);
    // Verze, se kterou má komunita problémy (store/reliability.ts), počká – bezpečnostní ne
    if (holdByCommunity(p) && !isSecurityUpdate(p)) {
      if (!communityWarned.has(key)) {
        communityWarned.add(key);
        writeLog(p.source, "info", i18n.t("reliability.skippedAuto", { name: p.name, version: p.availableVersion }));
      }
      return false;
    }
    return (failed[key] ?? 0) < AUTO_FAILURE_LIMIT && !needsAdmin[key];
  });
  if (autoInstall === "off" || !chosen.length || !isTauri()) {
    retryAt = null;
    return { queued: 0 };
  }
  const status = await invoke<{ onBattery: boolean; metered: boolean; batterySaver: boolean; busy: boolean; idleSeconds: number }>(
    "power_network_status",
  ).catch(() => null);
  const blocked: SkipReason | undefined =
    status?.onBattery && skipOnBattery
      ? "battery"
      : status?.batterySaver && skipOnSaver
        ? "saver"
        : status?.metered && skipOnMetered
          ? "metered"
          : // Hra, video přes celou obrazovku, prezentace – instalace by zpomalila a vyskakovala oznámení
            status?.busy && skipWhileBusy
            ? "busy"
            : // Uživatel u počítače pracuje – počkat, až bude chvíli nečinný
              status && onlyWhenIdle && status.idleSeconds < IDLE_MINUTES * 60
              ? "active"
              : undefined;
  if (blocked) {
    // Poprvé oznámit, že aktualizace čekají; pak to zkoušet znovu
    if (retryAt === null) {
      notifyEvent({
        type: "updates",
        tone: "info",
        title: null,
        message: i18n.t(`autoUpdates.waiting_${blocked}`, { count: chosen.length }),
        record: true,
      });
    }
    retryAt = Date.now() + RETRY_DELAY;
    return { queued: 0, skipped: blocked };
  }
  retryAt = null;

  const { jobs, enqueue } = useJobs.getState();
  let queued = 0;
  for (const pkg of chosen) {
    // Karta z katalogu, pokud ji aplikace má (průběh na kartě), jinak zdroj:id
    const item = currentItems.find((i) => i.pkg.source === pkg.source && i.pkg.packageId === pkg.packageId);
    const appId = item?.entry.id ?? `${pkg.source}:${pkg.packageId}`;
    if (jobs[appId]) continue;
    // Instalátor nové verze z jiného serveru (winget) – automaticky ne, jen jednou oznámit
    const change = await installerHostChange(pkg);
    if (change) {
      const key = versionKey(pkg, pkg.availableVersion!);
      if (!hostWarned.has(key)) {
        hostWarned.add(key);
        notifyEvent({
          type: "updates",
          tone: "error",
          title: item?.entry.name ?? pkg.name,
          message: i18n.t("hostChange.skipped", { version: pkg.availableVersion, from: change.from, to: change.to }),
          record: true,
        });
      }
      continue;
    }
    enqueue({
      appId,
      appName: item?.entry.name ?? pkg.name,
      source: pkg.source,
      packageId: pkg.packageId,
      kind: "update",
      // Uložené volby aplikace (jako správce, parametry…) platí i pro automatickou aktualizaci
      options: updateOptionsFor(appId, pkg, item?.entry),
      background: true,
      targetVersion: pkg.availableVersion ?? undefined,
    });
    queued++;
  }
  return { queued };
}

/** Plán kontroly / instalace z nastavení. */
function scheduleOf(task: Task): Schedule {
  const s = useAutoUpdates.getState();
  if (task === "check") {
    return s.checkRepeat === "interval"
      ? { repeat: "interval", intervalMs: INTERVAL_MS[s.interval] }
      : { repeat: s.checkRepeat, time: s.checkTime, days: s.checkDays };
  }
  return { repeat: s.installRepeat === "days" ? "days" : "daily", time: s.installTime, days: s.installDays };
}

/** Spustí úlohu, je-li na řadě; zmeškaný termín podle nastavení dožene, nebo přeskočí. */
function runIfDue(task: Task, run: () => Promise<unknown>) {
  const now = Date.now();
  const s = useAutoUpdates.getState();
  const schedule = scheduleOf(task);
  const timed = schedule.repeat !== "interval";
  const times = [task === "check" ? s.lastCheck : s.lastInstall, timed ? (task === "check" ? s.checkPlannedAt : s.installPlannedAt) : null]
    .map((t) => (t ? Date.parse(t) : null))
    .concat(skipped[task]);
  const known = times.filter((t): t is number => t !== null && !Number.isNaN(t));
  // Úloha v čase, která ještě nikdy neběžela: první termín až od teď
  if (timed && !known.length) {
    skipped[task] = now;
    return;
  }
  const due = dueTime(schedule, known.length ? Math.max(...known) : null, now);
  if (due === null) {
    catchUpAt[task] = null;
    return;
  }
  // Termín propásnutý, když HubGet neběžel nebo počítač spal
  if (due < aliveSince - 60_000) {
    const policy = s.missed;
    if (policy === "skip") {
      skipped[task] = now;
      return;
    }
    if (policy === "delay") {
      catchUpAt[task] ??= aliveSince + MISSED_DELAY;
      if (now < catchUpAt[task]!) return;
    }
  }
  catchUpAt[task] = null;
  void run();
}

/** Plánovač – připojený v hlavním rozvržení (Layout). */
export function useAutoUpdateScheduler() {
  const { items } = useInstalledItems();
  currentItems = items;

  // Nově nabízené verze – od kdy je HubGet vidí (minimální stáří u verzí, které katalog nezná)
  useEffect(() => {
    if (items.length) useUpdateHolds.getState().see(items.map((i) => i.pkg));
  }, [items]);

  // Prošlá odložení aktualizací zrušit – aktualizace se tím zase nabídne
  useEffect(() => {
    const prune = () => useUpdatePins.getState().pruneExpired();
    prune();
    const timer = window.setInterval(prune, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const tick = () => {
      const now = Date.now();
      // Probuzení ze spánku: od minulé minuty uběhlo mnohem víc
      if (now - lastTick > 3 * 60_000) aliveSince = now;
      lastTick = now;
      // Minimální stáří aktualizací přepočítat jednou za hodinu
      const holds = useUpdateHolds.getState();
      if (now - holds.clock > 60 * 60_000) holds.tick();

      const s = useAutoUpdates.getState();
      if (s.checking) return;
      if (s.autoCheck) runIfDue("check", runUpdateCheck);
      if (s.autoInstall !== "off" && s.installRepeat !== "afterCheck") runIfDue("install", runScheduledInstall);
      // Odložená instalace (baterie, měřené připojení) – zkusit znovu
      if (retryAt !== null && now >= retryAt) void installUpdates(currentUpdatable());
    };
    // První kontrola chvíli po spuštění (ať nezdržuje načtení aplikace), pak každou minutu
    const first = window.setTimeout(tick, 30_000);
    const timer = window.setInterval(tick, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
}
