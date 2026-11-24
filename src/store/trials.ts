/**
 * Vyzkoušet na týden (nabídka instalace): aplikace se nainstaluje s připomínkou. Po TRIAL_DAYS
 * dnech TrialWatcher (components/home/TrialPrompt) zjistí podle záznamů Windows (usage.rs →
 * app_last_used), jestli ji uživatel od instalace spustil: spuštěná zůstane bez ptaní, nespuštěná
 * dostane na Domů nabídku Ponechat / Odinstalovat. Odinstalovaná aplikace se ze seznamu jen vyřadí.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceId } from "@/types";

/** Za kolik dní se zeptat. */
export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

export interface Trial {
  name: string;
  /** Kdy zkouška začala (ms). */
  at: number;
  source: SourceId;
  packageId: string;
  /** Aplikace se za zkoušku nespustila – nabídka Ponechat / Odinstalovat čeká na Domů. */
  asked?: boolean;
}

interface TrialsState {
  items: Record<string, Trial>;
  add: (appId: string, trial: Omit<Trial, "at" | "asked">) => void;
  remove: (appId: string) => void;
  ask: (appId: string) => void;
}

export const useTrials = create<TrialsState>()(
  persist(
    (set, get) => ({
      items: {},
      add: (appId, trial) => set({ items: { ...get().items, [appId]: { ...trial, at: Date.now() } } }),
      remove: (appId) => {
        const { [appId]: _, ...rest } = get().items;
        set({ items: rest });
      },
      ask: (appId) => {
        const trial = get().items[appId];
        if (trial) set({ items: { ...get().items, [appId]: { ...trial, asked: true } } });
      },
    }),
    { name: "unibox-trials" },
  ),
);

/** Zkoušky, kterým uplynulo TRIAL_DAYS dní a ještě se neptalo. */
export function dueTrials(items: Record<string, Trial>, now = Date.now()): [string, Trial][] {
  return Object.entries(items).filter(([, t]) => !t.asked && now - t.at >= TRIAL_DAYS * DAY_MS);
}

/** Spustil uživatel aplikaci od začátku zkoušky? (lastUsed z app_last_used, ms nebo null) */
export const usedDuringTrial = (trial: Trial, lastUsed: number | null) => lastUsed !== null && lastUsed > trial.at;
