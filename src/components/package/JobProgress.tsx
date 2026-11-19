import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/Button";
import { ESTIMATED_PHASES, estimatePercent, expectedPhaseMs } from "@/lib/phaseEstimate";
import { cn } from "@/lib/utils";
import { useJobs } from "@/store/jobs";
import type { Job } from "@/types";

interface JobProgressProps {
  job: Job;
  className?: string;
}

/**
 * Živý průběh operace: popisek fáze, procenta, pruh a tlačítko Zrušit.
 * Instalace a odinstalace procenta nehlásí – ukáže se odhad (lib/phaseEstimate);
 * ostatní neurčitý průběh (fronta, UAC, průvodce) je běžící animace.
 */
export function JobProgress({ job, className }: JobProgressProps) {
  const { t } = useTranslation();
  const cancel = useJobs((s) => s.cancel);
  const { phase, since } = job.progress;
  const estimated = job.progress.percent === null && since !== undefined && ESTIMATED_PHASES.has(phase);
  const expected = useMemo(() => (estimated ? expectedPhaseMs(job, phase) : 0), [estimated, job, phase]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!estimated) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [estimated]);
  const percent = estimated ? estimatePercent(Math.max(0, now - (since ?? now)), expected) : job.progress.percent;
  // Fáze, kdy se čeká na uživatele (UAC, průvodce instalací, uložení práce a zavření aplikace) – zvýraznit
  const needsUser = phase === "elevating" || phase === "interactive" || phase === "closingApp";
  const waiting = phase === "queued" || needsUser;

  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className={cn("truncate font-medium", needsUser ? "text-amber-500" : "text-fg")}>
            {t(`phase.${phase}`)}
          </span>
          {percent !== null && (
            <span className="tabular-nums text-muted" title={estimated ? t("phase.estimate") : undefined}>
              {percent} %
            </span>
          )}
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
          {percent !== null ? (
            <div
              className={cn("h-full rounded-full bg-accent transition-[width] ease-out", estimated ? "duration-500" : "duration-200")}
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div
              className={cn(
                "animate-indeterminate absolute inset-y-0 w-2/5 rounded-full",
                waiting ? "bg-muted/50" : "bg-accent",
              )}
            />
          )}
        </div>
      </div>
      <IconButton
        aria-label={t("package.cancel")}
        title={t("package.cancel")}
        className="relative z-10 size-7"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          cancel(job.appId);
        }}
      >
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
