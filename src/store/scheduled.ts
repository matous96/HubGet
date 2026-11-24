/**
 * Naplánované instalace (nabídka instalace → Nainstalovat později…): velká aplikace nebo hra se
 * zařadí do fronty ve zvolený čas, třeba v noci. Dokud nějaká čeká, HubGet nedovolí počítači
 * usnout (system.rs → keep_awake); ScheduledInstallsRunner (components/package/ScheduleInstall)
 * je v čas zařadí. Instalace, jejíž čas propásl vypnutý počítač, se zařadí po spuštění HubGetu.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EnqueueRequest } from "./jobs";

export interface ScheduledInstall {
  id: string;
  /** Kdy zařadit do fronty (ms). */
  at: number;
  request: EnqueueRequest;
}

interface ScheduledState {
  items: ScheduledInstall[];
  /** Naplánuje instalaci – stejná aplikace nahradí dřívější čas. */
  add: (request: EnqueueRequest, at: number) => void;
  cancel: (appId: string) => void;
  /** Odebere zařazené (podle id). */
  take: (ids: string[]) => void;
}

export const useScheduled = create<ScheduledState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (request, at) =>
        set({ items: [...get().items.filter((i) => i.request.appId !== request.appId), { id: crypto.randomUUID(), at, request }].sort((a, b) => a.at - b.at) }),
      cancel: (appId) => set({ items: get().items.filter((i) => i.request.appId !== appId) }),
      take: (ids) => set({ items: get().items.filter((i) => !ids.includes(i.id)) }),
    }),
    { name: "unibox-scheduled" },
  ),
);

/** Instalace, jejichž čas nastal. */
export const dueScheduled = (items: ScheduledInstall[], now = Date.now()) => items.filter((i) => i.at <= now);

/** Nejbližší noc v `hour` hodin (dnes, když ještě nebyla, jinak zítra) – ms. */
export function nextNight(now = new Date(), hour = 2): number {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}
