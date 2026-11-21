/**
 * Předinstalované aplikace Windows, které uživatel odebral v HubGetu (Přehled počítače →
 * Předinstalované aplikace) – jde je vrátit z Microsoft Storu. Aplikace, která je zase
 * nainstalovaná, ze seznamu zmizí (PreinstalledDialog).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RemovedPreinstalled {
  /** Název balíčku („Microsoft.BingWeather“). */
  name: string;
  /** Rodina balíčku – stránka v Microsoft Storu. */
  family: string;
  displayName: string;
  removedAt: string;
}

interface PreinstalledState {
  removed: RemovedPreinstalled[];
  add: (apps: Omit<RemovedPreinstalled, "removedAt">[]) => void;
  /** Zapomenout aplikace, které jsou zase nainstalované (nebo je uživatel vrátil). */
  forget: (names: string[]) => void;
}

export const usePreinstalled = create<PreinstalledState>()(
  persist(
    (set, get) => ({
      removed: [],
      add: (apps) => {
        const at = new Date().toISOString();
        const names = new Set(apps.map((a) => a.name.toLowerCase()));
        set({ removed: [...apps.map((a) => ({ ...a, removedAt: at })), ...get().removed.filter((r) => !names.has(r.name.toLowerCase()))] });
      },
      forget: (names) => {
        const drop = new Set(names.map((n) => n.toLowerCase()));
        const removed = get().removed.filter((r) => !drop.has(r.name.toLowerCase()));
        if (removed.length !== get().removed.length) set({ removed });
      },
    }),
    { name: "unibox-preinstalled-removed" },
  ),
);
