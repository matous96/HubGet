/**
 * Synchronizace mezi počítači: oblíbené, sada balíčků, předvolby, předvolby
 * oznámení a vlastní vzhled aplikací přihlášeného uživatele (services/sync.ts –
 * Supabase, bez něj ukázka).
 *
 * Průběh: načíst data účtu → u každé zapnuté oblasti 3cestně sloučit se stavem
 * tady (základ = stav po poslední synchronizaci tohoto počítače, lib/syncMerge.ts)
 * → výsledek uložit tady i do účtu. Když mezitím zapsal jiný počítač (revize
 * nesedí), načte se znovu a sloučí znovu. Základ se pamatuje zvlášť pro
 * každého uživatele.
 *
 * Kdy: po přihlášení (i obnovené relaci při startu), 3 s po změně dat,
 * při návratu do okna (nejvýš jednou za minutu) a každých 10 minut.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mergeMaps, sameValue, type SyncMap } from "@/lib/syncMerge";
import { SyncConflict, syncBackend, type RemoteRecord, type SyncKindId } from "@/services/sync";
import { useAuth } from "./auth";
import { SYNC_KIND_LIST, type SyncKind } from "./syncKinds";

type SyncStatus = "idle" | "syncing" | "error";

interface SyncState {
  /** Synchronizovat po přihlášení (výchozí zapnuto). */
  enabled: boolean;
  /** Které oblasti synchronizovat. */
  kinds: Record<SyncKindId, boolean>;
  status: SyncStatus;
  /** Poslední úspěšná synchronizace přihlášeného uživatele. */
  lastSyncedAt: string | null;
  setEnabled: (enabled: boolean) => void;
  setKind: (kind: SyncKindId, enabled: boolean) => void;
  syncNow: () => Promise<void>;
  /** Smaže data z účtu a synchronizaci vypne (jinak by se hned nahrála znovu). */
  clearAccount: () => Promise<void>;
}

/** Stav po poslední synchronizaci tohoto počítače (základ 3cestného sloučení). */
interface SyncBase {
  kinds: Partial<Record<SyncKindId, SyncMap>>;
  /**
   * Revize oblastí v účtu, se kterými se naposledy sloučilo. Stejná revize v účtu = v účtu je
   * pořád to, co je v `kinds` – data se nestahují znovu (vlastní ikony aplikací mají stovky kB).
   */
  revisions?: Partial<Record<SyncKindId, number>>;
  lastSyncedAt: string | null;
}

const BASE_KEY = (userId: string) => `unibox-sync-base:${userId}`;

function loadBase(userId: string): SyncBase {
  try {
    const raw = localStorage.getItem(BASE_KEY(userId));
    if (raw) return JSON.parse(raw) as SyncBase;
  } catch {
    // poškozený záznam – synchronizace začne jako první
  }
  return { kinds: {}, lastSyncedAt: null };
}

const saveBase = (userId: string, base: SyncBase) => localStorage.setItem(BASE_KEY(userId), JSON.stringify(base));

/** Kolikrát zkusit sloučit znovu, když mezitím zapsal jiný počítač. */
const CONFLICT_RETRIES = 3;

/** Právě se zapisují data z účtu – změny úložišť nespouštějí další synchronizaci. */
let applying = false;

function applyQuietly(kind: SyncKind, map: SyncMap) {
  applying = true;
  try {
    kind.apply(map);
  } finally {
    applying = false;
  }
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Data oblastí z účtu: nejdřív jen revize, data se stáhnou jen u oblastí, které se od
 * poslední synchronizace změnily – u ostatních je v účtu pořád stav ze základu.
 */
async function pullChanged(userId: string, base: SyncBase, kinds: SyncKindId[]): Promise<Partial<Record<SyncKindId, RemoteRecord>>> {
  const revisions = await syncBackend.revisions(userId);
  const unchanged = (id: SyncKindId) => revisions[id] !== undefined && revisions[id] === base.revisions?.[id] && !!base.kinds[id];
  const stale = kinds.filter((id) => revisions[id] !== undefined && !unchanged(id));
  const remote = stale.length ? await syncBackend.pull(userId, stale) : {};
  for (const id of kinds) if (unchanged(id)) remote[id] = { data: base.kinds[id]!, revision: revisions[id]! };
  return remote;
}

/** Jeden průběh synchronizace. Oblast, která se nepovede, nezdrží ostatní. */
async function run(get: () => SyncState, set: (s: Partial<SyncState>) => void) {
  const user = useAuth.getState().user;
  if (!user || !get().enabled) return;
  set({ status: "syncing" });
  let failed = false;
  try {
    const base = loadBase(user.id);
    base.revisions ??= {};
    const kinds = SYNC_KIND_LIST.filter((kind) => get().kinds[kind.id]);
    const remote = await pullChanged(user.id, base, kinds.map((kind) => kind.id));
    for (const kind of kinds) {
      try {
        for (let attempt = 0; ; attempt++) {
          const local = kind.snapshot();
          const record = remote[kind.id] ?? null;
          const merged = mergeMaps(base.kinds[kind.id] ?? null, local, record?.data ?? null);
          if (!sameValue(merged, local)) applyQuietly(kind, merged);
          let revision = record?.revision;
          // Prázdnou oblast (nikdo si ještě nenastavil vzhled aplikací) do účtu nezakládat
          const nothing = !record && Object.keys(merged).length === 0;
          if (!nothing && (!record || !sameValue(merged, record.data))) {
            try {
              revision = await syncBackend.push(user.id, kind.id, merged, record?.revision ?? null);
            } catch (error) {
              // Jiný počítač zapsal mezi načtením a zápisem – načíst a sloučit znovu
              if (error instanceof SyncConflict && attempt < CONFLICT_RETRIES) {
                const fresh = (await syncBackend.pull(user.id, [kind.id]))[kind.id];
                if (fresh) remote[kind.id] = fresh;
                else delete remote[kind.id];
                continue;
              }
              throw error;
            }
          }
          base.kinds[kind.id] = merged;
          if (revision !== undefined) base.revisions[kind.id] = revision;
          break;
        }
      } catch (error) {
        // Např. oblast, kterou databáze ještě nezná (chybí migrace) – ostatní oblasti pokračují
        console.error(`[HubGet] Synchronizace oblasti ${kind.id} se nepovedla:`, error);
        failed = true;
      }
    }
    base.lastSyncedAt = new Date().toISOString();
    // Uživatel se mezitím mohl odhlásit nebo přepnout
    if (useAuth.getState().user?.id === user.id) {
      saveBase(user.id, base);
      set({ status: failed ? "error" : "idle", lastSyncedAt: base.lastSyncedAt });
    }
  } catch (error) {
    console.error("[HubGet] Synchronizace se nepovedla:", error);
    set({ status: "error" });
  }
}

export const useSync = create<SyncState>()(
  persist(
    (set, get) => ({
      enabled: true,
      kinds: { favorites: true, bundle: true, settings: true, notifications: true, looks: true },
      status: "idle",
      lastSyncedAt: null,

      setEnabled: (enabled) => {
        set({ enabled });
        if (enabled) scheduleSync(0);
      },
      setKind: (kind, enabled) => {
        set({ kinds: { ...get().kinds, [kind]: enabled } });
        if (enabled) scheduleSync(0);
      },

      syncNow: () => {
        // Jen jeden průběh najednou; požadavek během něj spustí ještě jeden
        if (running) {
          again = true;
          return running;
        }
        running = run(get, set).finally(() => {
          running = null;
          if (again) {
            again = false;
            void get().syncNow();
          }
        });
        return running;
      },

      clearAccount: async () => {
        const user = useAuth.getState().user;
        if (!user) return;
        await running;
        await syncBackend.clear(user.id);
        localStorage.removeItem(BASE_KEY(user.id));
        set({ enabled: false, lastSyncedAt: null, status: "idle" });
      },
    }),
    {
      name: "unibox-sync",
      // Stav průběhu se neukládá – po startu se zjistí znovu
      partialize: ({ enabled, kinds }) => ({ enabled, kinds }),
      // Oblast přidaná v novější verzi (vzhled aplikací) je zapnutá jako ostatní výchozí
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Pick<SyncState, "enabled" | "kinds">>;
        return { ...current, ...saved, kinds: { ...current.kinds, ...saved.kinds } };
      },
    },
  ),
);

// ── Spouštění ─────────────────────────────────────────────────────────────

/** Po změně dat počkat, ať se víc změn za sebou pošle najednou. */
const CHANGE_DELAY = 3000;
const INTERVAL = 10 * 60_000;
/** Při návratu do okna nejvýš jednou za tolik. */
const FOCUS_GAP = 60_000;

let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void useSync.getState().syncNow(), delay);
}

const active = () => !!useAuth.getState().user && useSync.getState().enabled;

// Změna dat tady – jen když se liší od stavu po poslední synchronizaci
for (const kind of SYNC_KIND_LIST) {
  kind.subscribe(() => {
    const user = useAuth.getState().user;
    if (applying || !user || !active() || !useSync.getState().kinds[kind.id]) return;
    if (sameValue(kind.snapshot(), loadBase(user.id).kinds[kind.id])) return;
    scheduleSync(CHANGE_DELAY);
  });
}

// Přihlášení, obnovená relace při startu, přepnutí účtu
useAuth.subscribe((state, prev) => {
  if (state.user?.id === prev.user?.id) return;
  useSync.setState({ status: "idle", lastSyncedAt: state.user ? loadBase(state.user.id).lastSyncedAt : null });
  if (state.user) scheduleSync(0);
});

setInterval(() => {
  if (active()) void useSync.getState().syncNow();
}, INTERVAL);

window.addEventListener("focus", () => {
  const last = useSync.getState().lastSyncedAt;
  if (active() && (!last || Date.now() - Date.parse(last) > FOCUS_GAP)) scheduleSync(0);
});
