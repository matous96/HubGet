/**
 * Hlídané aplikace (zvonek v detailu nenainstalované aplikace): HubGet dá vědět,
 * až aplikace z webu výrobce půjde nainstalovat přes správce balíčků (QR Generator
 * po schválení ve WinGetu), nebo až vyjde nová verze. Kontrola po každém načtení
 * katalogu (components/package/WatchlistWatcher.tsx); nainstalovaná aplikace se
 * přestane hlídat – o její aktualizace se starají Dostupné aktualizace.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WatchedApp {
  name: string;
  /** Nejnovější verze v katalogu, když se začala hlídat (nebo při posledním oznámení). */
  version: string;
  /** Aplikace jen z webu výrobce – hlídá se i to, kdy ji bude jde nainstalovat přes HubGet. */
  webOnly: boolean;
  at: string;
}

interface WatchlistState {
  items: Record<string, WatchedApp>;
  watch: (appId: string, app: Omit<WatchedApp, "at">) => void;
  update: (appId: string, changes: Partial<WatchedApp>) => void;
  remove: (appId: string) => void;
}

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      items: {},
      watch: (appId, app) => set({ items: { ...get().items, [appId]: { ...app, at: new Date().toISOString() } } }),
      update: (appId, changes) => {
        const current = get().items[appId];
        if (current) set({ items: { ...get().items, [appId]: { ...current, ...changes } } });
      },
      remove: (appId) => {
        const items = { ...get().items };
        delete items[appId];
        set({ items });
      },
    }),
    { name: "unibox-watchlist" },
  ),
);
