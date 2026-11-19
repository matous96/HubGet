/**
 * Průběh úlohy jako jedno procento (karta JobProgress, ikona na hlavním panelu):
 *  - instalace a odinstalace procenta nehlásí – odhad podle minulé délky (lib/phaseEstimate),
 *  - stahování a instalace jsou jedno procento 0–100 % za celou operaci,
 *  - zbývající čas: stahování podle dosavadní rychlosti (+ očekávaná instalace),
 *    instalace podle očekávané délky.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadShare, ESTIMATED_PHASES, estimatePercent, expectedPhaseMs, overallPercent } from "@/lib/phaseEstimate";
import type { Job } from "@/types";

export interface JobPercent {
  /** 0–99 za celou operaci, null = neurčitý průběh. */
  percent: number | null;
  /** Procenta jsou odhad (fáze je nehlásí). */
  estimated: boolean;
  /** Zbývající čas v ms, null = nejde odhadnout (nebo už jen chvíle). */
  remainingMs: number | null;
  /** Čeká se na uživatele (UAC, průvodce instalací, uložení práce a zavření aplikace). */
  needsUser: boolean;
}

/** Zbývající čas se ukáže až po chvíli (rychlost na začátku stahování skáče). */
const MIN_ELAPSED_MS = 2000;
const MIN_PERCENT = 3;
/** Méně už se neukazuje – „zbývá 0 s“ by jen blikalo. */
const MIN_REMAINING_MS = 3000;

export function useJobPercent(job: Job): JobPercent {
  const { phase, since, downloaded } = job.progress;
  const reported = job.progress.percent;
  const estimated = reported === null && since !== undefined && ESTIMATED_PHASES.has(phase);
  const timed = since !== undefined && (estimated || reported !== null);

  // Očekávané délky a podíl stahování jednou pro úlohu a fázi – ne při každém hlášení procent (hledá v katalogu)
  const expected = useMemo(() => (estimated ? expectedPhaseMs(job, phase) : 0), [estimated, job.id, phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const combined = job.kind !== "download" && (phase === "downloading" || (!!downloaded && phase === "installing"));
  const share = useMemo(() => (combined ? downloadShare(job) : 0), [combined, job.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const installAfter = useMemo(
    () => (phase === "downloading" && job.kind !== "download" ? expectedPhaseMs(job, "installing") : 0),
    [phase, job.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [timed]);

  const elapsed = Math.max(0, now - (since ?? now));
  const phasePercent = estimated ? estimatePercent(elapsed, expected) : reported;

  // Nikdy zpět: správce může stahovat víc souborů (závislosti) a každý začíná od nuly
  const highest = useRef({ id: job.id, value: 0 });
  if (highest.current.id !== job.id) highest.current = { id: job.id, value: 0 };
  let percent = phasePercent;
  if (combined && phasePercent !== null) {
    percent = Math.max(overallPercent(phase, phasePercent, share), highest.current.value);
    highest.current.value = percent;
  }

  let remainingMs: number | null = null;
  if (estimated) remainingMs = expected - elapsed;
  else if (reported !== null && reported >= MIN_PERCENT && elapsed >= MIN_ELAPSED_MS) {
    remainingMs = (elapsed * (100 - reported)) / reported + installAfter;
  }
  if (remainingMs !== null && remainingMs < MIN_REMAINING_MS) remainingMs = null;

  const needsUser = phase === "elevating" || phase === "interactive" || phase === "closingApp";
  return { percent, estimated, remainingMs, needsUser };
}

/** Zbývající čas zaokrouhlený, ať neposkakuje: do minuty po 5 s, pak po minutách. */
export function roundRemaining(ms: number): { seconds: number } | { minutes: number } {
  const seconds = ms / 1000;
  return seconds < 60 ? { seconds: Math.max(5, Math.ceil(seconds / 5) * 5) } : { minutes: Math.ceil(seconds / 60) };
}
