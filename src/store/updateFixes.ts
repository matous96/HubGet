/**
 * Řešení neúspěšných aktualizací:
 *  - useUpdateDoctor – průvodce „Proč aktualizace selhala?“ (UpdateDoctorDialog) pro záznam historie,
 *  - useFailedBatch – neúspěšné operace poslední dávky („Zkusit neúspěšné znovu“, FailedRetryBanner),
 *  - useAfterBatch – po dokončení dávky uspat nebo vypnout počítač (PowerCountdownDialog),
 *  - useDeferredUpdates – dokončit při příštím přihlášení (DeferredUpdatesRunner; ukládá se).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HistoryEntry } from "./history";
import type { EnqueueRequest } from "./jobs";

interface UpdateDoctorState {
  entry: HistoryEntry | null;
  open: (entry: HistoryEntry) => void;
  close: () => void;
}

export const useUpdateDoctor = create<UpdateDoctorState>()((set) => ({
  entry: null,
  open: (entry) => set({ entry }),
  close: () => set({ entry: null }),
}));

/** Opakování z historie: stejná operace s hlídáním programů, které drží soubory aplikace. */
export function retryRequest(entry: Pick<HistoryEntry, "appId" | "appName" | "source" | "packageId" | "kind" | "version" | "options">, extra: EnqueueRequest["options"] = {}): EnqueueRequest {
  return {
    appId: entry.appId,
    appName: entry.appName,
    source: entry.source,
    packageId: entry.packageId,
    kind: entry.kind,
    version: entry.version,
    options: { ...entry.options, closeFileUsers: true, ...extra },
  };
}

interface FailedBatchState {
  /** Operace spuštěné uživatelem, které v poslední dávce selhaly. */
  items: EnqueueRequest[];
  set: (items: EnqueueRequest[]) => void;
  clear: () => void;
}

export const useFailedBatch = create<FailedBatchState>()((set) => ({
  items: [],
  set: (items) => set({ items }),
  clear: () => set({ items: [] }),
}));

export type AfterBatchAction = "none" | "sleep" | "shutdown";

interface AfterBatchState {
  /** Co udělat, až fronta doběhne (jen pro tuto dávku – po provedení zpět na „nic“). */
  action: AfterBatchAction;
  /** Běží odpočet před uspáním / vypnutím. */
  countdown: boolean;
  setAction: (action: AfterBatchAction) => void;
  /** Fronta doběhla – s nastavenou akcí spustit odpočet. */
  batchEnded: () => void;
  /** Odpočet doběhl nebo ho uživatel zrušil – akce se vrátí na „nic“. */
  reset: () => void;
}

export const useAfterBatch = create<AfterBatchState>()((set, get) => ({
  action: "none",
  countdown: false,
  setAction: (action) => set({ action }),
  batchEnded: () => {
    if (get().action !== "none") set({ countdown: true });
  },
  reset: () => set({ action: "none", countdown: false }),
}));

export interface DeferredUpdate {
  request: EnqueueRequest;
  /** Start počítače v době odložení (s od 1970, session_info) – po novém startu se dokončí. */
  boot: number;
  at: number;
}

interface DeferredUpdatesState {
  items: DeferredUpdate[];
  add: (item: DeferredUpdate) => void;
  /** Odebere a vrátí položky k dokončení. */
  take: (items: DeferredUpdate[]) => void;
}

export const useDeferredUpdates = create<DeferredUpdatesState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) => set({ items: [...get().items.filter((i) => i.request.appId !== item.request.appId), item] }),
      take: (taken) => set({ items: get().items.filter((i) => !taken.includes(i)) }),
    }),
    { name: "unibox-deferred-updates" },
  ),
);

/** Dokončit teď? Po přihlášení (HubGet spuštěný s Windows) nebo po novém startu počítače. */
export function deferredDue(items: DeferredUpdate[], session: { autostart: boolean; boot: number }): DeferredUpdate[] {
  return items.filter((i) => session.autostart || session.boot !== i.boot);
}
