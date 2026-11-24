/**
 * Pozastavená stahování (Pozastavit na kartě a v plovoucím průběhu detailu): backend ukončil
 * curl a nechal rozstažený instalátor (download.rs), úloha z fronty zmizela – fronta pokračuje
 * dalšími úlohami. Po „Pokračovat“ se úloha zařadí znovu a stahování naváže tam, kde skončilo
 * (useJobs.resume). Ukládá se – rozstažený soubor v %TEMP% přežije i restart HubGetu.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EnqueueRequest } from "./jobs";

export interface PausedJob {
  request: EnqueueRequest;
  /** Průběh v okamžiku pozastavení (celkové procento). */
  percent: number | null;
  at: number;
}

interface PausedJobsState {
  items: Record<string, PausedJob>;
  add: (appId: string, job: PausedJob) => void;
  remove: (appId: string) => void;
}

export const usePausedJobs = create<PausedJobsState>()(
  persist(
    (set, get) => ({
      items: {},
      add: (appId, job) => set({ items: { ...get().items, [appId]: job } }),
      remove: (appId) => {
        if (!(appId in get().items)) return;
        const items = { ...get().items };
        delete items[appId];
        set({ items });
      },
    }),
    { name: "unibox-paused-jobs" },
  ),
);
