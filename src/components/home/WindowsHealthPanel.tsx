/**
 * Stav Windows v Přehledu počítače: podpora verze Windows (endoflife.date), čekající
 * restart po aktualizacích, místo na systémovém disku a ochrana systému (body obnovení).
 * Každý řádek s barvou podle závažnosti a radou, co udělat.
 */
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { CircleAlert, CircleCheck, MonitorCog, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSystemInfo } from "@/hooks/useSystemInfo";
import { diskSpace } from "@/lib/diskSpace";
import { fetchCycles } from "@/lib/endOfLife";
import { cn, formatSizeText } from "@/lib/utils";
import { supportState, windowsCycle, type WindowsCycle } from "@/lib/windowsSupport";
import { useSettings } from "@/store/settings";

interface WindowsHealth {
  rebootPending: boolean;
  uptimeDays: number;
  systemProtection: boolean | null;
}

type Tone = "ok" | "warn" | "danger";

/** Málo místa: pod 10 % disku nebo pod 10 GB. */
const LOW_SHARE = 0.1;
const LOW_BYTES = 10 * 1024 ** 3;
/** Po tolika dnech bez restartu poradit restart. */
const LONG_UPTIME_DAYS = 14;

const formatDate = (date: string, language: string) => new Date(date).toLocaleDateString(language, { day: "numeric", month: "numeric", year: "numeric" });

export function WindowsHealthPanel({ action }: { action?: ReactNode }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const system = useSystemInfo();
  const health = useQuery({ queryKey: ["windows-health"], queryFn: () => invoke<WindowsHealth>("windows_health"), staleTime: 5 * 60_000 });
  const disk = useQuery({ queryKey: ["disk-space"], queryFn: diskSpace, staleTime: 60_000 });
  const cycles = useQuery({ queryKey: ["eol", "windows"], queryFn: () => fetchCycles("windows") as Promise<WindowsCycle[]>, staleTime: 24 * 3600_000, retry: false });

  const rows: { tone: Tone; text: string; hint?: string }[] = [];
  const cycle = system && cycles.data ? windowsCycle(cycles.data, system.osName, system.osBuild) : null;
  if (system && cycle) {
    const { state, until } = supportState(cycle);
    const version = cycle.releaseLabel ?? `${system.osName} ${system.osDisplayVersion ?? ""}`.trim();
    if (state === "ended") rows.push({ tone: "danger", text: t("windowsHealth.ended", { version, date: formatDate(until!, language) }), hint: t(system.osBuild < 22000 ? "windowsHealth.endedHint10" : "windowsHealth.endedHint") });
    else if (state === "ending") rows.push({ tone: "warn", text: t("windowsHealth.ending", { version, date: formatDate(until!, language) }), hint: t("windowsHealth.endingHint") });
    else rows.push({ tone: "ok", text: until ? t("windowsHealth.supported", { version, date: formatDate(until, language) }) : t("windowsHealth.supportedOpen", { version }) });
  }
  if (health.data?.rebootPending) rows.push({ tone: "warn", text: t("windowsHealth.reboot"), hint: t("windowsHealth.rebootHint") });
  else if (health.data && health.data.uptimeDays >= LONG_UPTIME_DAYS) rows.push({ tone: "warn", text: t("windowsHealth.uptime", { count: health.data.uptimeDays }), hint: t("windowsHealth.uptimeHint") });
  if (disk.data) {
    const low = disk.data.free < LOW_BYTES || disk.data.free / disk.data.total < LOW_SHARE;
    const text = t("windowsHealth.disk", { drive: disk.data.drive, free: formatSizeText(disk.data.free, language), total: formatSizeText(disk.data.total, language) });
    rows.push(low ? { tone: "warn", text, hint: t("windowsHealth.diskHint") } : { tone: "ok", text });
  }
  if (health.data?.systemProtection === false) rows.push({ tone: "warn", text: t("windowsHealth.protectionOff"), hint: t("windowsHealth.protectionHint") });
  else if (health.data?.systemProtection) rows.push({ tone: "ok", text: t("windowsHealth.protectionOn") });

  if (!rows.length) return null;
  const Icon = { ok: CircleCheck, warn: TriangleAlert, danger: CircleAlert };
  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <MonitorCog className="size-5 text-accent" />
          {t("windowsHealth.title")}
        </h2>
        {action}
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const RowIcon = Icon[row.tone];
          return (
            <li key={row.text} className="flex items-start gap-2.5 text-sm">
              <RowIcon className={cn("mt-0.5 size-4 shrink-0", row.tone === "ok" ? "text-success" : row.tone === "warn" ? "text-amber-500" : "text-danger")} />
              <span className="min-w-0">
                <span className={cn(row.tone !== "ok" && "font-medium")}>{row.text}</span>
                {row.hint && <span className="block text-xs text-muted">{row.hint}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
