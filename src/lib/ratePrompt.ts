/**
 * Výzva k hodnocení (components/home/RatePrompt): aplikace, kterou uživatel nainstaloval přes
 * HubGet před pár dny, ještě ji má a zatím se k ní nevyjádřil. Nejdřív po RATE_AFTER_DAYS
 * (stihne ji vyzkoušet), nejpozději do RATE_WITHIN_DAYS a nejvýš jedna výzva denně.
 */
import type { HistoryEntry } from "@/store/history";

export const RATE_AFTER_DAYS = 3;
export const RATE_WITHIN_DAYS = 60;
const DAY_MS = 24 * 60 * 60_000;

export function rateCandidate(
  history: readonly HistoryEntry[],
  installed: { has: (appId: string) => boolean },
  done: Readonly<Record<string, number>>,
  now = Date.now(),
): HistoryEntry | null {
  // Nejvýš jedna výzva denně – po hodnocení nebo „Teď ne“ den klid
  const last = Math.max(0, ...Object.values(done));
  if (now - last < DAY_MS) return null;
  for (const entry of history) {
    if (entry.kind !== "install" || entry.outcome !== "success" || entry.appId.includes(":")) continue;
    if (entry.appId in done || !installed.has(entry.appId)) continue;
    const age = now - Date.parse(entry.finishedAt);
    if (!(age >= RATE_AFTER_DAYS * DAY_MS)) continue;
    // Historie je od nejnovější – starší už jsou mimo okno
    if (age > RATE_WITHIN_DAYS * DAY_MS) return null;
    return entry;
  }
  return null;
}

/** Kolik dní je aplikace nainstalovaná (pro text výzvy). */
export const daysSince = (iso: string, now = Date.now()) => Math.max(1, Math.floor((now - Date.parse(iso)) / DAY_MS));
