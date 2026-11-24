/**
 * Váš rok s HubGetem (pages/YearPage.tsx): průběžné počty operací za každý rok – historie
 * operací drží jen posledních 500 záznamů, roční souhrn by se u častých aktualizací ořízl.
 * Zapisuje se s každým záznamem historie (store/history.ts → add); při prvním spuštění se
 * doplní z dosavadní historie. Jen v tomto počítači, nikam se neposílá.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HistoryEntry } from "./history";

export interface YearStats {
  installs: number;
  updates: number;
  uninstalls: number;
  repairs: number;
  /** Automatické aktualizace (na pozadí). */
  automatic: number;
  failed: number;
  /** Aktualizace po aplikacích: id → název a počet. */
  apps: Record<string, { name: string; updates: number }>;
  /** Úspěšné operace po měsících (0 = leden). */
  months: number[];
  /** První operace roku (ISO). */
  first: string;
}

interface YearStatsState {
  years: Record<string, YearStats>;
  /** Doplněno z historie (jednou). */
  seeded: boolean;
  record: (entry: HistoryEntry) => void;
  /** Odečte neúspěšnou operaci, kterou fronta hned zopakovala (zavřela, co blokovalo instalátor). */
  retract: (entry: HistoryEntry) => void;
  seed: (entries: HistoryEntry[]) => void;
}

const empty = (first: string): YearStats => ({ installs: 0, updates: 0, uninstalls: 0, repairs: 0, automatic: 0, failed: 0, apps: {}, months: Array(12).fill(0), first });

/** Započítá operaci do roku (čistá funkce – testy). */
export function addToYear(years: Record<string, YearStats>, entry: HistoryEntry): Record<string, YearStats> {
  if (entry.kind === "download" || entry.outcome === "cancelled") return years;
  const at = new Date(entry.finishedAt);
  if (Number.isNaN(at.getTime())) return years;
  const key = String(at.getFullYear());
  const current = years[key] ?? empty(entry.finishedAt);
  const stats: YearStats = { ...current, apps: { ...current.apps }, months: [...current.months] };
  if (Date.parse(entry.finishedAt) < Date.parse(stats.first)) stats.first = entry.finishedAt;
  if (entry.outcome === "error") {
    stats.failed++;
    return { ...years, [key]: stats };
  }
  stats.months[at.getMonth()]++;
  if (entry.kind === "install") stats.installs++;
  else if (entry.kind === "uninstall") stats.uninstalls++;
  else if (entry.kind === "repair") stats.repairs++;
  else if (entry.kind === "update") {
    stats.updates++;
    if (entry.background) stats.automatic++;
    const app = stats.apps[entry.appId] ?? { name: entry.appName, updates: 0 };
    stats.apps[entry.appId] = { name: entry.appName, updates: app.updates + 1 };
  }
  return { ...years, [key]: stats };
}

export const useYearStats = create<YearStatsState>()(
  persist(
    (set, get) => ({
      years: {},
      seeded: false,
      record: (entry) => set({ years: addToYear(get().years, entry) }),
      retract: (entry) => {
        const key = String(new Date(entry.finishedAt).getFullYear());
        const stats = get().years[key];
        if (entry.outcome !== "error" || !stats?.failed) return;
        set({ years: { ...get().years, [key]: { ...stats, failed: stats.failed - 1 } } });
      },
      seed: (entries) => {
        if (get().seeded) return;
        // Historie je od nejnovějšího – započítat od nejstaršího
        let years = get().years;
        for (const entry of [...entries].reverse()) years = addToYear(years, entry);
        set({ years, seeded: true });
      },
    }),
    { name: "unibox-year-stats" },
  ),
);

/** Odhad ušetřeného času v minutách: ruční stažení a instalace ~5 min, aktualizace ~3 min. */
export const savedMinutes = (s: YearStats) => s.installs * 5 + s.updates * 3 + s.uninstalls * 2 + s.repairs * 5;
