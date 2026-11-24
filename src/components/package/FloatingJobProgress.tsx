/**
 * Plovoucí průběh v detailu aplikace (jako App Store na iPadu): když běží instalace,
 * aktualizace nebo odinstalace a tlačítko s průběhem v hlavičce zmizí při posunu dolů,
 * dole uprostřed okna se objeví „pilulka“ s ikonou, názvem, fází a kruhovým průběhem.
 * Klik na ni vrátí k hlavičce. Kruh: při stahování, které obstarává HubGet sám, pozastaví
 * (pauza), u pozastaveného pokračuje (play), jinak úlohu zruší (čtvereček); křížek zruší.
 */
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { roundRemaining, useJobPercent } from "@/hooks/useJobPercent";
import { cn } from "@/lib/utils";
import { useJobs } from "@/store/jobs";
import type { PausedJob } from "@/store/pausedJobs";
import { useSelection } from "@/store/selection";
import type { Job } from "@/types";
import { PackageIcon } from "./PackageIcon";

type Entry = { id: string; name: string; iconUrl: string | null };

interface FloatingJobProgressProps {
  entry: Entry;
  job: Job | undefined;
  /** Pozastavené stahování (store/pausedJobs). */
  paused?: PausedJob;
  /** Akce v hlavičce detailu – pilulka se ukáže, jen když nejsou vidět. */
  anchor: RefObject<HTMLElement | null>;
}

/** Je prvek vidět v posuvné oblasti okna? (IntersectionObserver počítá i s ořezem rodičů) */
function useInView(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, active]);
  return inView;
}

export function FloatingJobProgress({ entry, job, paused, anchor }: FloatingJobProgressProps) {
  const active = !!job || !!paused;
  const inView = useInView(anchor, active);
  // Lišta hromadného výběru je na stejném místě – pilulka se posune nad ni
  const selecting = useSelection((s) => Object.keys(s.items).length > 0);
  const reveal = () => anchor.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  return createPortal(
    <AnimatePresence>
      {active && !inView && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={cn("fixed left-1/2 z-40 -translate-x-1/2", selecting ? "bottom-20" : "bottom-6")}
        >
          {/* Skupina, ne živá oblast – čtečka obrazovky by jinak ohlašovala každé procento */}
          <div
            role="group"
            aria-label={entry.name}
            className="flex w-[min(26rem,calc(100vw-3rem))] items-center gap-1 rounded-full border border-line bg-surface/95 p-1.5 shadow-card-hover backdrop-blur"
          >
            {job ? <RunningPill entry={entry} job={job} onReveal={reveal} /> : paused && <PausedPill entry={entry} paused={paused} onReveal={reveal} />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Ikona, název a stav – klik vrátí k hlavičce detailu. */
function RevealButton({ entry, status, warn, onReveal }: { entry: Entry; status: string; warn?: boolean; onReveal: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onReveal}
      title={t("package.showProgress")}
      aria-label={`${t("package.showProgress")} – ${entry.name}: ${status}`}
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-full py-0.5 pr-2 pl-1 text-left transition-colors hover:bg-surface-2"
    >
      <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entry.name}</span>
        <span className={cn("block truncate text-xs tabular-nums", warn ? "text-amber-500" : "text-muted")}>{status}</span>
      </span>
    </button>
  );
}

const RING = "grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-accent transition-colors hover:bg-surface-2";
const CLOSE = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg";

function RunningPill({ entry, job, onReveal }: { entry: Entry; job: Job; onReveal: () => void }) {
  const { t } = useTranslation();
  const cancel = useJobs((s) => s.cancel);
  const pause = useJobs((s) => s.pause);
  const { percent, remainingMs, needsUser } = useJobPercent(job);
  const remaining = remainingMs !== null ? roundRemaining(remainingMs) : null;
  const pausable = !!job.progress.pausable && job.progress.phase === "downloading";
  const status = [
    t(`phase.${job.progress.phase}`),
    percent !== null ? `${percent} %` : null,
    remaining ? ("seconds" in remaining ? t("phase.remainingSeconds", { count: remaining.seconds }) : t("phase.remainingMinutes", { count: remaining.minutes })) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const cancelLabel = `${t("package.cancel")} – ${entry.name}`;

  return (
    <>
      <RevealButton entry={entry} status={status} warn={needsUser} onReveal={onReveal} />
      {pausable ? (
        <>
          <button type="button" onClick={() => pause(job.appId)} title={t("package.pause")} aria-label={`${t("package.pause")} – ${entry.name}`} className={RING}>
            <ProgressRing percent={percent} waiting={false} center="pause" />
          </button>
          <button type="button" onClick={() => cancel(job.appId)} title={t("package.cancel")} aria-label={cancelLabel} className={CLOSE}>
            <X className="size-4" />
          </button>
        </>
      ) : (
        <button type="button" onClick={() => cancel(job.appId)} title={t("package.cancel")} aria-label={cancelLabel} className={RING}>
          <ProgressRing percent={percent} waiting={job.progress.phase === "queued" || needsUser} center="stop" />
        </button>
      )}
    </>
  );
}

function PausedPill({ entry, paused, onReveal }: { entry: Entry; paused: PausedJob; onReveal: () => void }) {
  const { t } = useTranslation();
  const resume = useJobs((s) => s.resume);
  const discard = useJobs((s) => s.discardPaused);
  const status = [t("package.paused"), paused.percent !== null ? `${paused.percent} %` : null].filter(Boolean).join(" · ");
  return (
    <>
      <RevealButton entry={entry} status={status} onReveal={onReveal} />
      <button type="button" onClick={() => resume(entry.id)} title={t("package.resume")} aria-label={`${t("package.resume")} – ${entry.name}`} className={RING}>
        <ProgressRing percent={paused.percent ?? 0} waiting center="play" />
      </button>
      <button type="button" onClick={() => discard(entry.id)} title={t("package.cancel")} aria-label={`${t("package.cancel")} – ${entry.name}`} className={CLOSE}>
        <X className="size-4" />
      </button>
    </>
  );
}

/** Kruhový průběh se značkou uprostřed – zastavit, pozastavit, pokračovat (neurčitý průběh = točící se oblouk). */
function ProgressRing({ percent, waiting, center }: { percent: number | null; waiting: boolean; center: "stop" | "pause" | "play" }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true">
      <circle cx="16" cy="16" r={radius} fill="none" strokeWidth="2.5" className="stroke-surface-3" />
      {percent !== null ? (
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          transform="rotate(-90 16 16)"
          className={cn("transition-[stroke-dashoffset] duration-300 ease-out", waiting ? "stroke-muted" : "stroke-current")}
        />
      ) : (
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.3} ${circumference}`}
          className={cn("origin-center animate-spin", waiting ? "stroke-muted" : "stroke-current")}
          style={{ animationDuration: "1.2s" }}
        />
      )}
      {center === "stop" && <rect x="12" y="12" width="8" height="8" rx="1.5" className="fill-current" />}
      {center === "pause" && (
        <>
          <rect x="12" y="11" width="3" height="10" rx="1" className="fill-current" />
          <rect x="17" y="11" width="3" height="10" rx="1" className="fill-current" />
        </>
      )}
      {center === "play" && <path d="M13.5 10.8v10.4a.6.6 0 0 0 .9.5l8-5.2a.6.6 0 0 0 0-1l-8-5.2a.6.6 0 0 0-.9.5z" className="fill-current" />}
    </svg>
  );
}
