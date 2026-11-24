/**
 * Naplánovat instalaci (store/scheduled):
 *  - ScheduleInstallDialog – nabídka instalace → Nainstalovat později… (v noci, za hodinu, vlastní čas),
 *  - ScheduledInstallsRunner – v Layoutu: v čas instalace zařadí a dokud nějaká čeká, drží počítač
 *    vzhůru (system.rs → keep_awake),
 *  - ScheduledInstallsBanner – přehled naplánovaných instalací nad Nainstalovanými (jde zrušit).
 */
import { invoke } from "@tauri-apps/api/core";
import { AlarmClock, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { Button, IconButton } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { isTauri } from "@/lib/tauri";
import { notifyEvent } from "@/services/notify";
import { useJobs } from "@/store/jobs";
import { usePackageIndex } from "@/store/packageIndex";
import { dueScheduled, nextNight, useScheduled } from "@/store/scheduled";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry, SourceId } from "@/types";

interface Target {
  entry: CatalogEntry;
  source: SourceId;
  packageId: string;
}

interface ScheduleUiState {
  target: Target | null;
  open: (target: Target) => void;
  close: () => void;
}

export const useScheduleUi = create<ScheduleUiState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

/** „út 2:00“ – den a čas naplánované instalace v jazyce aplikace. */
export function formatScheduled(at: number, language: string) {
  return new Intl.DateTimeFormat(language, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);
}

/** Hodnota pro <input type="datetime-local"> v místním čase. */
const localInput = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

type Choice = "night" | "hour" | "custom";

export function ScheduleInstallDialog() {
  const target = useScheduleUi((s) => s.target);
  if (!target) return null;
  return <ScheduleDialog target={target} />;
}

function ScheduleDialog({ target }: { target: Target }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const close = useScheduleUi((s) => s.close);
  const [now] = useState(() => Date.now());
  const night = useMemo(() => nextNight(new Date(now)), [now]);
  const [choice, setChoice] = useState<Choice>("night");
  const [custom, setCustom] = useState(() => localInput(night));
  const customAt = Date.parse(custom);
  const at = choice === "night" ? night : choice === "hour" ? now + 60 * 60_000 : customAt;
  const valid = Number.isFinite(at) && at > Date.now();

  const submit = () => {
    if (!valid) return;
    const { entry, source, packageId } = target;
    useScheduled.getState().add({ appId: entry.id, appName: entry.name, source, packageId, kind: "install" }, at);
    useToasts.getState().push("success", t("schedule.done", { name: entry.name, when: formatScheduled(at, language) }));
    close();
  };

  const option = (value: Choice, label: string) => (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
      <input type="radio" name="schedule" checked={choice === value} onChange={() => setChoice(value)} className="size-4 accent-[var(--color-accent)]" />
      <span className="text-sm">{label}</span>
    </label>
  );

  return (
    <Modal
      open
      onClose={close}
      title={t("schedule.title", { name: target.entry.name })}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("package.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid}>
            <AlarmClock className="size-4" />
            {t("schedule.submit")}
          </Button>
        </>
      }
    >
      <div className="-mx-2 mb-3">
        {option("night", t("schedule.night", { when: formatScheduled(night, language) }))}
        {option("hour", t("schedule.hour"))}
        {option("custom", t("schedule.custom"))}
        {choice === "custom" && (
          <input
            type="datetime-local"
            value={custom}
            min={localInput(now)}
            onChange={(e) => setCustom(e.target.value)}
            aria-label={t("schedule.custom")}
            className="mt-1 ml-9 h-9 rounded-xl border border-line bg-surface-2 px-3 text-sm text-fg outline-none focus:border-accent/50"
          />
        )}
      </div>
      <p className="text-xs text-muted">{t("schedule.hint")}</p>
    </Modal>
  );
}

/** Zařadí naplánované instalace v čas a dokud nějaká čeká, nedovolí počítači usnout. */
export function ScheduledInstallsRunner() {
  const { t } = useTranslation();
  const items = useScheduled((s) => s.items);
  const waiting = items.length > 0;

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("keep_awake", { on: waiting }).catch(() => undefined);
  }, [waiting]);

  useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      const due = dueScheduled(useScheduled.getState().items);
      if (!due.length) return;
      useScheduled.getState().take(due.map((i) => i.id));
      const { enqueue, jobs } = useJobs.getState();
      const { installed } = usePackageIndex.getState();
      // Mezitím nainstalovaná (nebo právě instalovaná) aplikace se znovu neinstaluje
      const started = due.filter((i) => !jobs[i.request.appId] && !installed.has(i.request.appId));
      for (const item of started) enqueue(item.request);
      if (!started.length) return;
      const message = t("schedule.running", { count: started.length, names: started.map((i) => i.request.appName).join(", ") });
      notifyEvent({ type: "info", tone: "info", title: null, message, toast: message, record: true });
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [waiting, t]);

  return null;
}

/** Naplánované instalace nad Nainstalovanými – kdy se spustí a zrušení. */
export function ScheduledInstallsBanner() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const items = useScheduled((s) => s.items);
  const cancel = useScheduled((s) => s.cancel);
  if (!items.length) return null;
  return (
    <section aria-label={t("schedule.banner")} className="mb-5 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
      <h2 className="mb-1.5 flex items-center gap-2 font-semibold">
        <AlarmClock className="size-4 text-accent" />
        {t("schedule.banner")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-0.5 pl-3">
            <span>
              {item.request.appName} · <span className="text-muted tabular-nums">{formatScheduled(item.at, language)}</span>
            </span>
            <IconButton
              onClick={() => cancel(item.request.appId)}
              title={t("schedule.cancel", { name: item.request.appName })}
              aria-label={t("schedule.cancel", { name: item.request.appName })}
              className="size-7"
            >
              <X className="size-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
