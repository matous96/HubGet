/**
 * Uvolněné aplikace (jako „Uvolnit aplikaci“ v iOS): HubGet aplikaci odinstaloval, ale její
 * nastavení a data nechal – předem je zálohoval (settings_backup.rs) a zbytky po odinstalaci
 * nenabízí smazat. Po „Nainstalovat znovu“ (mráček) nastavení ze zálohy vrátí na místo
 * (store/jobs.ts) a záznam zmizí.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OffloadedApp {
  /** Verze, ke které patří záloha nastavení. */
  version: string;
  /** Kdy byla aplikace uvolněna (ms). */
  at: number;
  /** Nastavení je zálohované (false = v AppData nic nebylo, nebo bylo moc velké – zůstalo jen na místě). */
  backup: boolean;
}

interface OffloadedState {
  items: Record<string, OffloadedApp>;
  add: (appId: string, app: OffloadedApp) => void;
  remove: (appId: string) => void;
}

export const useOffloaded = create<OffloadedState>()(
  persist(
    (set, get) => ({
      items: {},
      add: (appId, app) => set({ items: { ...get().items, [appId]: app } }),
      remove: (appId) => {
        if (!(appId in get().items)) return;
        const items = { ...get().items };
        delete items[appId];
        set({ items });
      },
    }),
    { name: "unibox-offloaded" },
  ),
);
