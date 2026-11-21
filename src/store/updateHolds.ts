/**
 * Údaje pro automatická pravidla aktualizací (store/updateRules.ts):
 *  - firstSeen: kdy HubGet nabízenou verzi poprvé uviděl – pro minimální stáří
 *    aktualizací u verzí, jejichž datum vydání katalog nezná,
 *  - stuck: kolikrát aktualizace na verzi proběhla „úspěšně“, ale správce ji
 *    nabízí dál (winget u některých balíčků) – po N pokusech se přestane nabízet,
 *  - allowed: verze, které uživatel pustil i tak („Nabídnout hned / znovu“),
 *  - watched: úspěšné aktualizace, u kterých se pár dní hlídá, jestli se
 *    aplikace sama nevrátí na starší verzi (Discord: winget nainstaluje novější
 *    verzi, Discord ji po spuštění vlastním aktualizátorem vrátí na tu, kterou mu
 *    nabízí jeho server – a winget by aktualizaci nabízel pořád dokola),
 *  - selfUpdating: aplikace, které se takhle vrátily – aktualizují se samy,
 *    aktualizace přes správce se jim nenabízejí (klíč pinKey, „Nabídnout znovu“ ho smaže),
 *  - failed: kolikrát automatická aktualizace na verzi selhala – po AUTO_FAILURE_LIMIT
 *    pokusech se už automaticky nezkouší (ručně ano), nová verze začíná od nuly,
 *  - needsAdmin: verze, které automatická aktualizace odložila, protože potřebují práva
 *    správce (na pozadí bez dialogu UAC) – čekají na potvrzení v Dostupných aktualizacích.
 * Klíč ostatních: „zdroj:id@verze“ (versionKey).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { compareVersions } from "@/lib/version";
import type { InstalledPackage } from "@/types";
import { pinKey } from "./updatePins";

/** Klíč verze balíčku: „winget:Mozilla.Firefox@132.0“. */
export const versionKey = (pkg: Pick<InstalledPackage, "source" | "packageId">, version: string) => `${pinKey(pkg)}@${version}`;

const DAY_MS = 24 * 60 * 60_000;
/** Jak dlouho držet záznamy o viděných verzích (dny) – starší se smažou. */
const KEEP_DAYS = 120;
/** Jak dlouho po úspěšné aktualizaci hlídat návrat na starší verzi (dny) – aplikace se mohla spustit až později. */
const WATCH_DAYS = 7;
/** Po kolika neúspěšných automatických pokusech o stejnou verzi ji nechat na uživateli. */
export const AUTO_FAILURE_LIMIT = 3;

/** Hlídaná aktualizace: kdy proběhla a jestli už správce cílovou verzi ukázal jako nainstalovanou. */
export interface WatchedUpdate {
  at: string;
  reached?: boolean;
}

/** Aplikace se po aktualizaci na `target` sama vrátila na `version`. */
export interface SelfUpdating {
  version: string;
  target: string;
  at: string;
}

/** Zjištěný návrat na starší verzi. */
export interface Revert {
  pkg: InstalledPackage;
  version: string;
  target: string;
}

interface UpdateHoldsState {
  firstSeen: Record<string, string>;
  stuck: Record<string, number>;
  allowed: Record<string, string>;
  watched: Record<string, WatchedUpdate>;
  selfUpdating: Record<string, SelfUpdating>;
  /**
   * Známé aplikace, které se aktualizují samy (data/selfUpdating.ts), u kterých uživatel chce
   * aktualizace hned („Nabídnout znovu“): klíč pinKey → kdy.
   */
  selfOffer: Record<string, string>;
  failed: Record<string, number>;
  /** Odložené kvůli právům správce: klíč verze → kdy. */
  needsAdmin: Record<string, string>;
  /** Čas pro přepočet pravidel (mění se, když minimální stáří některé verze vyprší); neukládá se. */
  clock: number;
  /** Zapíše poprvé viděné nabízené verze a smaže staré záznamy. */
  see: (packages: InstalledPackage[]) => void;
  /** Aktualizace na verzi proběhla, ale správce ji nabízí dál. */
  recordStuck: (key: string) => void;
  /** Nabídnout verzi i přes pravidla (minimální stáří, neprojevená aktualizace). */
  allow: (key: string) => void;
  /** Aktualizace na verzi proběhla – hlídat, jestli se aplikace nevrátí na starší. */
  watchUpdate: (key: string) => void;
  /** Porovná hlídané aktualizace se seznamem od správce; vrátí nově zjištěné návraty. */
  checkReverts: (packages: InstalledPackage[]) => Revert[];
  /** Automatická aktualizace na verzi selhala; vrátí počet neúspěchů. */
  recordAutoFailure: (key: string) => number;
  /** Verzi nechat na potvrzení uživatelem (potřebuje práva správce); true = poprvé. */
  holdForManual: (key: string) => boolean;
  /** Aktualizace aplikace, která se aktualizuje sama, znovu nabízet. */
  releaseSelfUpdating: (key: string) => void;
  tick: () => void;
}

export const useUpdateHolds = create<UpdateHoldsState>()(
  persist(
    (set, get) => ({
      firstSeen: {},
      stuck: {},
      allowed: {},
      watched: {},
      selfUpdating: {},
      selfOffer: {},
      failed: {},
      needsAdmin: {},
      clock: Date.now(),
      see: (packages) => {
        const now = Date.now();
        const seen = get().firstSeen;
        const added: Record<string, string> = {};
        const offered = new Set<string>();
        for (const pkg of packages) {
          const version = pkg.availableVersion ?? pkg.heldVersion;
          if (!version) continue;
          const key = versionKey(pkg, version);
          offered.add(key);
          if (!seen[key]) added[key] = new Date(now).toISOString();
        }
        // Staré záznamy pryč, jen ne u verzí, které se pořád nabízejí (jinak by se jejich stáří vynulovalo)
        const limit = now - KEEP_DAYS * DAY_MS;
        const old = Object.keys(seen).filter((k) => Date.parse(seen[k]) < limit && !offered.has(k));
        // Odložená verze se už nenabízí, aplikace ale v seznamu je (aktualizovaná, novější verze) –
        // nečeká; u aplikace, která v seznamu chybí (výpis správce selhal), počká do vypršení
        const present = new Set(packages.map((p) => pinKey(p)));
        const held = get().needsAdmin;
        const settled = Object.keys(held).filter(
          (k) => !offered.has(k) && (present.has(k.slice(0, k.lastIndexOf("@"))) || Date.parse(held[k]) < limit),
        );
        if (!Object.keys(added).length && !old.length && !settled.length) return;
        const firstSeen = { ...seen, ...added };
        const stuck = { ...get().stuck };
        const allowed = { ...get().allowed };
        const failed = { ...get().failed };
        for (const key of old) {
          delete firstSeen[key];
          delete stuck[key];
          delete allowed[key];
          delete failed[key];
        }
        const needsAdmin = { ...held };
        for (const key of settled) delete needsAdmin[key];
        set({ firstSeen, stuck, allowed, failed, needsAdmin });
      },
      recordStuck: (key) => set({ stuck: { ...get().stuck, [key]: (get().stuck[key] ?? 0) + 1 } }),
      recordAutoFailure: (key) => {
        const count = (get().failed[key] ?? 0) + 1;
        set({ failed: { ...get().failed, [key]: count } });
        return count;
      },
      holdForManual: (key) => {
        if (get().needsAdmin[key]) return false;
        set({ needsAdmin: { ...get().needsAdmin, [key]: new Date().toISOString() } });
        return true;
      },
      allow: (key) => set({ allowed: { ...get().allowed, [key]: new Date().toISOString() } }),
      watchUpdate: (key) => set({ watched: { ...get().watched, [key]: { at: new Date().toISOString() } } }),
      checkReverts: (packages) => {
        const watched = get().watched;
        const keys = Object.keys(watched);
        if (!keys.length) return [];
        const now = Date.now();
        const byKey = new Map(packages.filter((p) => !p.diskLocation).map((p) => [pinKey(p), p]));
        const next = { ...watched };
        const selfUpdating = { ...get().selfUpdating };
        const reverts: Revert[] = [];
        let changed = false;
        for (const key of keys) {
          const entry = watched[key];
          // Id balíčku může obsahovat „@“ (npm:@scope/balíček) – verze je až za posledním
          const at = key.lastIndexOf("@");
          const [pkgKey, target] = [key.slice(0, at), key.slice(at + 1)];
          if (Date.parse(entry.at) < now - WATCH_DAYS * DAY_MS) {
            delete next[key];
            changed = true;
            continue;
          }
          const pkg = byKey.get(pkgKey);
          if (!pkg) continue;
          const order = compareVersions(pkg.installedVersion, target);
          if (order > 0) {
            // Mezitím novější verze – hlídání skončilo
            delete next[key];
            changed = true;
          } else if (order === 0) {
            if (!entry.reached) {
              next[key] = { ...entry, reached: true };
              changed = true;
            }
          } else if (entry.reached) {
            // Cílová verze už byla nainstalovaná a teď je zase starší → aplikace se vrátila sama.
            // (Bez „reached“ se aktualizace vůbec neprojevila – to řeší pravidlo „stuck“.)
            delete next[key];
            selfUpdating[pkgKey] = { version: pkg.installedVersion, target, at: new Date(now).toISOString() };
            reverts.push({ pkg, version: pkg.installedVersion, target });
            changed = true;
          }
        }
        if (changed) set({ watched: next, selfUpdating });
        return reverts;
      },
      releaseSelfUpdating: (key) => {
        const selfUpdating = { ...get().selfUpdating };
        delete selfUpdating[key];
        // I u známé aplikace ze seznamu (data/selfUpdating.ts) – aktualizace nabízet hned
        set({ selfUpdating, selfOffer: { ...get().selfOffer, [key]: new Date().toISOString() } });
      },
      tick: () => set({ clock: Date.now() }),
    }),
    {
      name: "unibox-update-holds",
      partialize: ({ firstSeen, stuck, allowed, watched, selfUpdating, selfOffer, failed, needsAdmin }) => ({
        firstSeen,
        stuck,
        allowed,
        watched,
        selfUpdating,
        selfOffer,
        failed,
        needsAdmin,
      }),
    },
  ),
);
