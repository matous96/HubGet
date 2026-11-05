/**
 * Úložiště dat účtu pro synchronizaci mezi počítači (store/sync.ts).
 *
 * Supabase (tabulka user_data, supabase/migrations): 1 řádek = 1 oblast dat
 * přihlášeného uživatele jako JSON. Revizi zvyšuje databáze; zápis s podmínkou
 * na revizi odhalí změnu z jiného počítače mezi načtením a zápisem – aplikace
 * pak načte a sloučí znovu. Data vidí jen jejich vlastník (RLS).
 *
 * Bez nastaveného Supabase je přihlášení jen ukázkové a „účet“ je složka
 * v localStorage tohoto počítače – synchronizaci jde vyzkoušet, ale nic
 * neopustí počítač (UI to označí).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncMap } from "@/lib/syncMerge";
import { supabase } from "./supabase";

/**
 * Oblasti dat účtu (stejný výčet hlídá databáze). Bezpečnostní volby mezi nimi záměrně nejsou.
 * „looks“ = vlastní vzhled aplikací (store/appLooks.ts) – migrace 20261105120000_user_data_looks.sql.
 */
export const SYNC_KINDS = ["settings", "favorites", "bundle", "notifications", "looks"] as const;
export type SyncKindId = (typeof SYNC_KINDS)[number];

export interface RemoteRecord {
  data: SyncMap;
  revision: number;
}

/** Zápis se nepovedl, protože data mezitím změnil jiný počítač. */
export class SyncConflict extends Error {}

export interface SyncBackend {
  /** true = ukázka bez serveru (data zůstávají v tomto počítači). */
  readonly isSample: boolean;
  /** Revize oblastí v účtu (bez dat) – podle nich se stahují jen změněné oblasti. */
  revisions(userId: string): Promise<Partial<Record<SyncKindId, number>>>;
  /** Data účtu – všech oblastí, nebo jen vybraných. */
  pull(userId: string, kinds?: readonly SyncKindId[]): Promise<Partial<Record<SyncKindId, RemoteRecord>>>;
  /** Zapíše oblast; `revision` = revize, ze které se slučovalo (null = v účtu ještě není). Vrací novou revizi. */
  push(userId: string, kind: SyncKindId, data: SyncMap, revision: number | null): Promise<number>;
  /** Smaže všechna data účtu (předvolby, oblíbené… v počítačích zůstanou). */
  clear(userId: string): Promise<void>;
}

// ── Ukázka bez serveru ───────────────────────────────────────────────────

const SAMPLE_KEY = (userId: string) => `unibox-sync-sample:${userId}`;

function sampleRead(userId: string): Partial<Record<SyncKindId, RemoteRecord>> {
  try {
    return JSON.parse(localStorage.getItem(SAMPLE_KEY(userId)) ?? "{}");
  } catch {
    return {};
  }
}

export const sampleSyncBackend: SyncBackend = {
  isSample: true,
  async revisions(userId) {
    return Object.fromEntries(Object.entries(sampleRead(userId)).map(([kind, record]) => [kind, record.revision]));
  },
  async pull(userId, kinds) {
    const all = sampleRead(userId);
    return kinds ? Object.fromEntries(kinds.flatMap((kind) => (all[kind] ? [[kind, all[kind]]] : []))) : all;
  },
  async push(userId, kind, data, revision) {
    const all = sampleRead(userId);
    if ((all[kind]?.revision ?? null) !== revision) throw new SyncConflict();
    const next = (revision ?? 0) + 1;
    all[kind] = { data, revision: next };
    localStorage.setItem(SAMPLE_KEY(userId), JSON.stringify(all));
    return next;
  },
  async clear(userId) {
    localStorage.removeItem(SAMPLE_KEY(userId));
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────

interface UserDataRow {
  kind: SyncKindId;
  data: SyncMap;
  revision: number;
}

/** Chyba Postgresu „unikátní klíč už existuje“ – oblast mezitím založil jiný počítač. */
const UNIQUE_VIOLATION = "23505";

export function supabaseSyncBackend(client: SupabaseClient): SyncBackend {
  return {
    isSample: false,

    async revisions(userId) {
      const { data, error } = await client.from("user_data").select("kind, revision").eq("user_id", userId);
      if (error) throw error;
      const revisions: Partial<Record<SyncKindId, number>> = {};
      for (const row of data as Pick<UserDataRow, "kind" | "revision">[]) {
        if ((SYNC_KINDS as readonly string[]).includes(row.kind)) revisions[row.kind] = row.revision;
      }
      return revisions;
    },

    async pull(userId, kinds) {
      let query = client.from("user_data").select("kind, data, revision").eq("user_id", userId);
      if (kinds) query = query.in("kind", [...kinds]);
      const { data, error } = await query;
      if (error) throw error;
      const records: Partial<Record<SyncKindId, RemoteRecord>> = {};
      for (const row of data as UserDataRow[]) {
        if ((SYNC_KINDS as readonly string[]).includes(row.kind)) records[row.kind] = { data: row.data, revision: row.revision };
      }
      return records;
    },

    async push(userId, kind, data, revision) {
      if (revision === null) {
        const { data: row, error } = await client.from("user_data").insert({ kind, data }).select("revision").single<{ revision: number }>();
        if (error?.code === UNIQUE_VIOLATION) throw new SyncConflict();
        if (error) throw error;
        return row.revision;
      }
      // Zapsat jen, pokud mezitím nikdo jiný nezapsal (revizi zvýší databáze)
      const { data: rows, error } = await client
        .from("user_data")
        .update({ data })
        .eq("user_id", userId)
        .eq("kind", kind)
        .eq("revision", revision)
        .select("revision");
      if (error) throw error;
      if (!rows?.length) throw new SyncConflict();
      return (rows[0] as { revision: number }).revision;
    },

    async clear(userId) {
      const { error } = await client.from("user_data").delete().eq("user_id", userId);
      if (error) throw error;
    },
  };
}

/** Vybraná implementace: Supabase, je-li nastavený, jinak ukázka. */
export const syncBackend: SyncBackend = supabase ? supabaseSyncBackend(supabase) : sampleSyncBackend;
