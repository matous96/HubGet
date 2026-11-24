/**
 * Výzvy k hodnocení (components/home/RatePrompt): u kterých aplikací už výzva proběhla
 * (ohodnoceno, nebo „Teď ne“) a jestli je uživatel nevypnul úplně.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RatePromptsState {
  /** Id aplikace → kdy výzva skončila (ms). */
  done: Record<string, number>;
  /** Uživatel výzvy vypnul („Neptat se“). */
  off: boolean;
  finish: (appId: string) => void;
  /** Aplikace už je ohodnocená (v detailu) – bez výzvy a bez denní pauzy. */
  skip: (appId: string) => void;
  setOff: (off: boolean) => void;
}

export const useRatePrompts = create<RatePromptsState>()(
  persist(
    (set, get) => ({
      done: {},
      off: false,
      finish: (appId) => set({ done: { ...get().done, [appId]: Date.now() } }),
      skip: (appId) => set({ done: { ...get().done, [appId]: 0 } }),
      setOff: (off) => set({ off }),
    }),
    { name: "unibox-rate-prompts" },
  ),
);
