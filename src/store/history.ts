/**
 * Historie operací – dokončené, zrušené i neúspěšné instalace, aktualizace
 * a odinstalace. Ukládá se mezi spuštěními.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isSourceId } from "@/services/managers/sources";
import type { InstallOptions, OperationKind, OperationOutcome, SourceId } from "@/types";

export interface HistoryEntry {
  id: string;
  appId: string;
  appName: string;
  source: SourceId;
  packageId: string;
  kind: OperationKind;
  version?: string;
  /** Aktualizace: verze před ní – kam se jde vrátit (useRollback). */
  fromVersion?: string;
  /** Aktualizace: verze, na kterou se aktualizovalo (pokud ji správce nabízel). */
  toVersion?: string;
  /** Volby instalace – kvůli zopakování operace se stejným nastavením. */
  options?: InstallOptions;
  outcome: OperationOutcome;
  error?: string;
  /** Automatická aktualizace na pozadí – její selhání se hlásí jen sem, ne na ikoně u hodin. */
  background?: boolean;
  startedAt: string;
  finishedAt: string;
}

interface HistoryState {
  items: HistoryEntry[];
  add: (entry: HistoryEntry) => void;
  clear: () => void;
}

/** Nejvýš tolik záznamů – nejstarší se zahazují. */
const MAX_ITEMS = 500;

export const useHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      // Nejnovější první
      add: (entry) => set({ items: [entry, ...get().items].slice(0, MAX_ITEMS) }),
      clear: () => set({ items: [] }),
    }),
    {
      name: "unibox-history",
      // Záznamy se zdrojem, který HubGet už nepodporuje, zahodit
      merge: (persisted, current) => {
        const saved = persisted as Partial<HistoryState> | undefined;
        return { ...current, ...saved, items: (saved?.items ?? []).filter((i) => isSourceId(i.source)) };
      },
    },
  ),
);
