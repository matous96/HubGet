/**
 * Řešení neúspěšných aktualizací (store/updateFixes):
 *  - FailedRetryBanner – po dávce s chybami „Zkusit neúspěšné znovu“ (nad aktualizacemi a v historii),
 *  - AfterBatchSelect – „Po dokončení: nic / uspat / vypnout“ u Aktualizovat vše,
 *  - PowerCountdownDialog – odpočet před uspáním / vypnutím (jde zrušit),
 *  - DeferredUpdatesRunner – po přihlášení (nebo novém startu počítače) dokončí odložené aktualizace.
 */
import { invoke } from "@tauri-apps/api/core";
import { Power, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useInstalled } from "@/hooks/usePackages";
import { isTauri } from "@/lib/tauri";
import { useAutoUpdates } from "@/store/autoUpdates";
import { useJobs } from "@/store/jobs";
import { notifyEvent } from "@/services/notify";
import { deferredDue, useAfterBatch, useDeferredUpdates, useFailedBatch, type AfterBatchAction } from "@/store/updateFixes";

export function FailedRetryBanner() {
  const { t } = useTranslation();
  const items = useFailedBatch((s) => s.items);
  const clear = useFailedBatch((s) => s.clear);
  const enqueue = useJobs((s) => s.enqueue);
  if (!items.length) return null;

  const retry = () => {
    // Opakování s hlídáním programů, které drží soubory aplikace (služba kamery, grafické procesy…)
    for (const item of items) enqueue({ ...item, options: { ...item.options, closeFileUsers: true } });
    clear();
  };

  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">{t("failedRetry.text", { count: items.length, names: items.map((i) => i.appName).join(", ") })}</span>
      <Button size="sm" onClick={retry}>
        <RotateCcw className="size-3.5" />
        {t("failedRetry.retry")}
      </Button>
      <IconButton onClick={clear} title={t("common.close")} aria-label={t("common.close")}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

const ACTIONS: AfterBatchAction[] = ["none", "sleep", "shutdown"];

export function AfterBatchSelect() {
  const { t } = useTranslation();
  const action = useAfterBatch((s) => s.action);
  const setAction = useAfterBatch((s) => s.setAction);
  if (!isTauri()) return null;
  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted">
      <Power className="size-4" />
      <span className="sr-only">{t("afterBatch.label")}</span>
      <select
        value={action}
        onChange={(e) => setAction(e.target.value as AfterBatchAction)}
        aria-label={t("afterBatch.label")}
        className="h-9 cursor-pointer rounded-full border border-line bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent/50"
      >
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {t(`afterBatch.${a}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Sekundy odpočtu před uspáním / vypnutím. */
const COUNTDOWN = 60;

export function PowerCountdownDialog() {
  const { t } = useTranslation();
  const { action, countdown, reset } = useAfterBatch();
  const [left, setLeft] = useState(COUNTDOWN);

  useEffect(() => {
    if (!countdown) return;
    setLeft(COUNTDOWN);
    const timer = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const run = () => {
    const kind = action;
    reset();
    if (kind !== "none") void invoke("power_action", { kind }).catch(() => undefined);
  };

  useEffect(() => {
    if (countdown && left <= 0) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, left]);

  if (!countdown || action === "none") return null;
  return (
    <Modal
      open
      onClose={reset}
      title={t(`afterBatch.title.${action}`)}
      footer={
        <>
          <Button variant="secondary" onClick={reset}>
            {t("package.cancel")}
          </Button>
          <Button onClick={run}>
            <Power className="size-4" />
            {t(`afterBatch.now.${action}`)}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t(`afterBatch.text.${action}`, { count: Math.max(0, left) })}</p>
    </Modal>
  );
}

/**
 * Stahovat aktualizace předem (Nastavení → Aktualizace balíčků): instalátory čekajících aktualizací
 * z wingetu se stáhnou na pozadí, jeden po druhém – „Aktualizovat vše“ pak skoro jen instaluje.
 * Ne na měřeném připojení a ne, dokud běží fronta úloh (ta si stahuje sama dopředu). Každá verze
 * jednou za běh HubGetu; zbytky stahování dorovná úklid mezipamětí (Přehled počítače).
 */
export function UpdatePrefetcher() {
  const enabled = useAutoUpdates((s) => s.prefetchUpdates);
  const { data } = useInstalled();
  const busy = useJobs((s) => Object.keys(s.jobs).length > 0);
  const done = useRef(new Set<string>());
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || !data || busy || running.current || !isTauri()) return;
    const pending = data.filter((p) => p.source === "winget" && p.availableVersion && !done.current.has(`${p.packageId}@${p.availableVersion}`));
    if (!pending.length) return;
    running.current = true;
    void (async () => {
      try {
        const status = await invoke<{ metered: boolean }>("power_network_status").catch(() => null);
        if (status?.metered) return;
        for (const pkg of pending) {
          // Mezitím se spustila fronta nebo se volba vypnula – pokračuje se příště
          if (Object.keys(useJobs.getState().jobs).length || !useAutoUpdates.getState().prefetchUpdates) break;
          done.current.add(`${pkg.packageId}@${pkg.availableVersion}`);
          await invoke("prefetch_ahead", { request: { kind: "update", packageId: pkg.packageId, name: pkg.name } }).catch(() => false);
        }
      } finally {
        running.current = false;
      }
    })();
  }, [enabled, data, busy]);

  return null;
}

/**
 * Dokončí odložené aktualizace (Proč aktualizace selhala? → Dokončit při příštím přihlášení):
 * po přihlášení (HubGet spuštěný s Windows) nebo po novém startu počítače – aplikace, které je
 * blokovaly, ještě neběží. Jednou po načtení nainstalovaných aplikací.
 */
export function DeferredUpdatesRunner() {
  const { t } = useTranslation();
  const { data } = useInstalled();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !data || !isTauri()) return;
    done.current = true;
    const { items, take } = useDeferredUpdates.getState();
    if (!items.length) return;
    void invoke<{ autostart: boolean; boot: number }>("session_info").then((session) => {
      const due = deferredDue(items, session);
      if (!due.length) return;
      take(due);
      const { enqueue } = useJobs.getState();
      for (const item of due) enqueue(item.request);
      const message = t("deferred.running", { count: due.length, names: due.map((i) => i.request.appName).join(", ") });
      notifyEvent({ type: "info", tone: "info", title: null, message, toast: message });
    });
  }, [data, t]);

  return null;
}
