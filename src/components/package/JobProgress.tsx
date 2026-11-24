import { Pause, Play, X } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/Button";
import { roundRemaining, useJobPercent } from "@/hooks/useJobPercent";
import { cn } from "@/lib/utils";
import { useJobs } from "@/store/jobs";
import type { PausedJob } from "@/store/pausedJobs";
import type { Job } from "@/types";

interface JobProgressProps {
  job: Job;
  className?: string;
}

/** Klik uvnitř karty nesmí zároveň otevřít detail. */
const stop = (fn: () => void) => (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  fn();
};

/**
 * Živý průběh operace: popisek fáze, procenta, pruh a tlačítko Zrušit.
 * Instalace a odinstalace procenta nehlásí – ukáže se odhad (lib/phaseEstimate);
 * ostatní neurčitý průběh (fronta, UAC, průvodce) je běžící animace.
 * Stahování a instalace jsou jedno procento (0–100 % za celou operaci), popisek
 * ukazuje aktuální fázi, u procent i zbývající čas (hooks/useJobPercent).
 * Stahování instalátoru, které obstarává HubGet sám, jde pozastavit (progress.pausable).
 */
export function JobProgress({ job, className }: JobProgressProps) {
  const { t } = useTranslation();
  const cancel = useJobs((s) => s.cancel);
  const pause = useJobs((s) => s.pause);
  const { phase, pausable } = job.progress;
  const { percent, estimated, remainingMs, needsUser } = useJobPercent(job);
  const remaining = remainingMs !== null ? roundRemaining(remainingMs) : null;
  const waiting = phase === "queued" || needsUser;

  return (
    <div className={cn("@container flex w-full min-w-0 items-center gap-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className={cn("truncate font-medium", needsUser ? "text-amber-500" : "text-fg")}>
            {t(`phase.${phase}`)}
          </span>
          {percent !== null && (
            <span className="whitespace-nowrap tabular-nums text-muted" title={estimated ? t("phase.estimate") : undefined}>
              {percent} %
              {/* Zbývající čas – stahování podle rychlosti, instalace podle minulé délky */}
              {remaining && (
                <span className="ml-1.5 hidden @[16rem]:inline">
                  · {"seconds" in remaining ? t("phase.remainingSeconds", { count: remaining.seconds }) : t("phase.remainingMinutes", { count: remaining.minutes })}
                </span>
              )}
            </span>
          )}
        </div>
        <ProgressBar percent={percent} estimated={estimated} waiting={waiting} />
      </div>
      {pausable && phase === "downloading" && (
        <IconButton aria-label={t("package.pause")} title={t("package.pause")} className="relative z-10 size-7" onClick={stop(() => pause(job.appId))}>
          <Pause className="size-4" />
        </IconButton>
      )}
      <IconButton aria-label={t("package.cancel")} title={t("package.cancel")} className="relative z-10 size-7" onClick={stop(() => cancel(job.appId))}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

/** Pozastavené stahování: stojící pruh s procenty, Pokračovat a Zrušit (store/pausedJobs). */
export function PausedProgress({ appId, paused, className }: { appId: string; paused: PausedJob; className?: string }) {
  const { t } = useTranslation();
  const resume = useJobs((s) => s.resume);
  const discard = useJobs((s) => s.discardPaused);
  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-medium text-muted">{t("package.paused")}</span>
          {paused.percent !== null && <span className="whitespace-nowrap tabular-nums text-muted">{paused.percent} %</span>}
        </div>
        <ProgressBar percent={paused.percent ?? 0} estimated={false} waiting muted />
      </div>
      <IconButton aria-label={t("package.resume")} title={t("package.resume")} className="relative z-10 size-7 text-accent" onClick={stop(() => resume(appId))}>
        <Play className="size-4" />
      </IconButton>
      <IconButton aria-label={t("package.cancel")} title={t("package.cancel")} className="relative z-10 size-7" onClick={stop(() => discard(appId))}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

/** Pruh průběhu; `muted` = stojí (pozastaveno), `waiting` = neurčitý průběh čeká (fronta, UAC). */
function ProgressBar({ percent, estimated, waiting, muted }: { percent: number | null; estimated: boolean; waiting: boolean; muted?: boolean }) {
  return (
    <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
      {percent !== null ? (
        <div
          className={cn("h-full rounded-full transition-[width] ease-out", muted ? "bg-muted/60" : "bg-accent", estimated ? "duration-500" : "duration-200")}
          style={{ width: `${percent}%` }}
        />
      ) : (
        <div className={cn("animate-indeterminate absolute inset-y-0 w-2/5 rounded-full", waiting ? "bg-muted/50" : "bg-accent")} />
      )}
    </div>
  );
}
