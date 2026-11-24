/**
 * Historie operací – dokončené, zrušené i neúspěšné instalace, aktualizace
 * a odinstalace. Ukládá se mezi spuštěními.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isSourceId } from "@/services/managers/sources";
import { useEverInstalled } from "./everInstalled";
import { usePackageIndex } from "./packageIndex";
import { useYearStats } from "./yearStats";
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
  /** Klíč chyby od backendu (inUseByOther, linkBroken…) – průvodce „Proč aktualizace selhala?“. */
  errorKey?: string;
  /** Automatická aktualizace na pozadí – její selhání se hlásí jen sem, ne na ikoně u hodin. */
  background?: boolean;
  startedAt: string;
  finishedAt: string;
}

interface HistoryState {
  items: HistoryEntry[];
  add: (entry: HistoryEntry) => void;
  /** Odebere neúspěšný pokus, který fronta hned zopakovala – v historii zůstane jen opakování. */
  remove: (id: string) => void;
  clear: () => void;
}

/** Nejvýš tolik záznamů – nejstarší se zahazují. */
const MAX_ITEMS = 500;

export const useHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      // Nejnovější první; roční souhrn se počítá průběžně (historie drží jen MAX_ITEMS záznamů)
      add: (entry) => {
        useYearStats.getState().record(entry);
        set({ items: [entry, ...get().items].slice(0, MAX_ITEMS) });
      },
      remove: (id) => {
        const entry = get().items.find((item) => item.id === id);
        if (!entry) return;
        useYearStats.getState().retract(entry);
        set({ items: get().items.filter((item) => item.id !== id) });
      },
      // Vymazaná historie = zapomenout i dřív nainstalované aplikace (mráček u karet), kromě právě nainstalovaných
      clear: () => {
        useEverInstalled.getState().reset(usePackageIndex.getState().installed.keys());
        set({ items: [] });
      },
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
