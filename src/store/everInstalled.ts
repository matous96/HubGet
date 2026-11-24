/**
 * Aplikace, které tu někdy byly nainstalované (jako mráček v App Storu): karta
 * nenainstalované aplikace, kterou uživatel už dřív měl, ukáže místo Instalovat
 * mráček se šipkou – Nainstalovat znovu (PackageAction), a stránka Dříve
 * nainstalované (pages/PreviousPage.tsx) je vypíše.
 *
 * Plní se z indexu nainstalovaných (PackageIndexSync – každá aplikace z katalogu, kterou
 * HubGet viděl nainstalovanou, ať ji nainstaloval kdokoli) a jednou z historie operací
 * (instalace, aktualizace, oprava i odinstalace znamenají, že aplikace tu byla) – tak se
 * počítají i aplikace odinstalované před touto funkcí. Aplikace z ostatních počítačů na
 * účtu (Moje počítače, store/devices.ts) jsou v `elsewhere` – jako „Zakoupené“ v App Storu.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HistoryEntry } from "./history";

interface EverInstalledState {
  /** Id aplikace z katalogu → kdy ji tu HubGet poprvé zaznamenal (ms). */
  ids: Record<string, number>;
  /** Doplněno z historie operací (jednou). */
  seeded: boolean;
  /** Skryté na stránce Dříve nainstalované (jako „Skrýt nákup“ v App Storu). */
  hidden: string[];
  /** Aplikace z ostatních počítačů na účtu: id aplikace → názvy počítačů (nepersistuje se – počítá PackageIndexSync). */
  elsewhere: Record<string, string[]>;
  /** Zapamatuje nainstalované aplikace; poprvé doplní i aplikace z historie operací. */
  observe: (appIds: Iterable<string>, history: HistoryEntry[]) => void;
  /** Zapomene všechno kromě právě nainstalovaných (Vymazat historii). */
  reset: (installed: Iterable<string>) => void;
  hide: (appId: string) => void;
  unhide: (appId: string) => void;
  setElsewhere: (elsewhere: Record<string, string[]>) => void;
}

/** Id z katalogu – ne „zdroj:id balíčku“ (programy mimo katalog karty v obchodě nemají). */
const isCatalogId = (id: string) => !id.includes(":");

/** Operace, po které je jisté, že aplikace tu byla nainstalovaná. */
const PROVES_INSTALL = new Set(["install", "update", "repair", "uninstall"]);

export const useEverInstalled = create<EverInstalledState>()(
  persist(
    (set, get) => ({
      ids: {},
      seeded: false,
      hidden: [],
      elsewhere: {},
      observe: (appIds, history) => {
        const { ids, seeded } = get();
        let next: Record<string, number> | null = null;
        const now = Date.now();
        const add = (id: string, at: number) => {
          if (!isCatalogId(id) || id in ids || (next && id in next)) return;
          next ??= { ...ids };
          next[id] = at;
        };
        if (!seeded) {
          for (const entry of history) {
            if (entry.outcome === "success" && PROVES_INSTALL.has(entry.kind)) add(entry.appId, Date.parse(entry.finishedAt) || now);
          }
        }
        for (const id of appIds) add(id, now);
        if (next || !seeded) set({ ids: next ?? ids, seeded: true });
      },
      reset: (installed) => {
        const now = Date.now();
        set({ ids: Object.fromEntries([...installed].filter(isCatalogId).map((id) => [id, now])), seeded: true, hidden: [] });
      },
      hide: (appId) => {
        if (!get().hidden.includes(appId)) set({ hidden: [...get().hidden, appId] });
      },
      unhide: (appId) => set({ hidden: get().hidden.filter((id) => id !== appId) }),
      setElsewhere: (elsewhere) => {
        // Beze změny nepřekreslovat karty (počítá se při každé změně indexu)
        if (JSON.stringify(elsewhere) !== JSON.stringify(get().elsewhere)) set({ elsewhere });
      },
    }),
    {
      name: "unibox-ever-installed",
      partialize: ({ ids, seeded, hidden }) => ({ ids, seeded, hidden }),
    },
  ),
);

/** Byla aplikace tu (nebo na jiném počítači na účtu) někdy nainstalovaná? (karta se překreslí jen při změně své hodnoty) */
export const useWasInstalled = (appId: string) => useEverInstalled((s) => appId in s.ids || appId in s.elsewhere);
