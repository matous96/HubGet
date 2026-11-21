/**
 * Které aktualizace se nabízejí (po vzoru UniGetUI). Uplatňuje se na seznam
 * nainstalovaných v useInstalled – skrytá aktualizace pak pro celou aplikaci
 * neexistuje (odznaky, počty, „Aktualizovat vše“, automatické aktualizace,
 * ikona u hodin):
 *  1. zámky uživatele – přeskočená verze, ignorované, odložené (store/updatePins.ts),
 *  2. minimální stáří aktualizací – nová verze se nabídne až po zadaném počtu
 *     dní od vydání. Datum vydání podle katalogu, u verzí, které katalog nezná,
 *     od chvíle, kdy ji HubGet poprvé uviděl (store/updateHolds.ts),
 *  3. neprojevené aktualizace – po N „úspěšných“ aktualizacích, po kterých
 *     správce verzi nabízí dál, se přestane nabízet,
 *  4. aplikace, které se aktualizují samy – po aktualizaci se samy vrátily na
 *     starší verzi (Discord), aktualizace přes správce se jim nenabízejí; známé aplikace
 *     s vlastním aktualizátorem (data/selfUpdating.ts – Chrome, Steam…) dostanou čas
 *     aktualizovat se samy a nabídnou se až po lhůtě (bezpečnostní oprava po kratší).
 * Bezpečnostní aktualizace (lib/securityUpdates.ts) pravidlo 2 obejdou (Nastavení →
 * Bezpečnostní aktualizace bez čekání).
 * „Nabídnout hned / znovu“ (store/updateHolds.ts → allowed) pravidla 2 a 3 obejde,
 * u pravidla 4 „Nabídnout znovu“ smaže záznam aplikace (releaseSelfUpdating).
 */
import { queryClient, queryKeys } from "@/app/queryClient";
import type { LoadedCatalog } from "@/services/catalog";
import { isSecurityRelease, type OsvFinding } from "@/lib/securityUpdates";
import { wingetBaseId } from "@/lib/wingetVariant";
import { SELF_UPDATE_GRACE_DAYS, SELF_UPDATE_SECURITY_GRACE_DAYS, SELF_UPDATING_WINGET } from "@/data/selfUpdating";
import type { InstalledPackage, SourceId } from "@/types";
import { minAgeFor, useAutoUpdates, type AutoUpdatesSettings } from "./autoUpdates";
import { useUpdateHolds, versionKey, type SelfUpdating } from "./updateHolds";
import { findingOf, useVulnerabilities } from "./vulnerabilities";
import { applyPins, pinKey, useUpdatePins, type UpdatePins } from "./updatePins";

const DAY_MS = 24 * 60 * 60_000;

export interface UpdateRules {
  pins: UpdatePins;
  minAge: (source: SourceId) => number;
  /** Datum vydání verze podle katalogu (ms), když ho katalog zná. */
  releasedAt: (pkg: InstalledPackage, version: string) => number | undefined;
  firstSeen: Record<string, string>;
  stuck: Record<string, number>;
  allowed: Record<string, string>;
  /** Aplikace, které se aktualizují samy (klíč pinKey). */
  selfUpdating: Record<string, SelfUpdating>;
  /** Známá aplikace s vlastním aktualizátorem (data/selfUpdating.ts), i nainstalovaná jiným správcem. */
  knownSelfUpdating: (pkg: InstalledPackage) => boolean;
  /** Známé aplikace, kterým uživatel aktualizace nabízí hned (klíč pinKey). */
  selfOffer: Record<string, string>;
  /** Nastavení: aplikacím, které se aktualizují samy, dát čas. */
  selfUpdatingWait: boolean;
  stuckLimit: number;
  now: number;
  /** Nabízená verze opravuje bezpečnostní chybu (poznámky k verzi, zranitelnost nainstalované verze z OSV.dev). */
  security: (pkg: InstalledPackage, version: string) => boolean;
  /** Bezpečnostní aktualizace nečekají na minimální stáří. */
  securityNoWait: boolean;
}

/** Datum vydání podle zdroje a id balíčku: verze ve zdroji a datum vydání nejnovější verze. */
const releaseIndexes = new WeakMap<LoadedCatalog, Map<string, { version: string; date: number }>>();

function releaseIndex(catalog: LoadedCatalog) {
  let index = releaseIndexes.get(catalog);
  if (!index) {
    index = new Map();
    for (const entry of catalog.catalog.packages) {
      const date = entry.releaseDate ? Date.parse(entry.releaseDate) : NaN;
      if (Number.isNaN(date)) continue;
      // Datum patří k nejnovější verzi aplikace – jen zdroje, které ji mají
      for (const s of entry.sources) {
        if (!entry.latestVersion || s.version === entry.latestVersion) index.set(`${s.source}:${s.packageId}`, { version: s.version, date });
      }
    }
    releaseIndexes.set(catalog, index);
  }
  return index;
}

/**
 * Balíčky známých aplikací s vlastním aktualizátorem: id wingetu ze seznamu a všechny zdroje
 * téhož profilu v katalogu (Chrome přes Chocolatey či Scoop se aktualizuje stejně sám).
 */
const selfIndexes = new WeakMap<LoadedCatalog, Set<string>>();

function selfIndex(catalog: LoadedCatalog | undefined): Set<string> {
  if (!catalog) return new Set();
  let index = selfIndexes.get(catalog);
  if (!index) {
    index = new Set();
    for (const entry of catalog.catalog.packages) {
      if (!entry.sources.some((s) => s.source === "winget" && SELF_UPDATING_WINGET.has(s.packageId.toLowerCase()))) continue;
      for (const s of entry.sources) index.add(`${s.source}:${s.packageId}`.toLowerCase());
    }
    selfIndexes.set(catalog, index);
  }
  return index;
}

export function isKnownSelfUpdating(pkg: Pick<InstalledPackage, "source" | "packageId">, index: Set<string>): boolean {
  if (pkg.source === "winget" && SELF_UPDATING_WINGET.has((wingetBaseId(pkg.packageId) ?? pkg.packageId).toLowerCase())) return true;
  return index.has(`${pkg.source}:${pkg.packageId}`.toLowerCase());
}

type Inputs = [
  UpdatePins,
  AutoUpdatesSettings["minAgeDays"],
  AutoUpdatesSettings["minAgeBySource"],
  number,
  Record<string, string>,
  Record<string, number>,
  Record<string, string>,
  Record<string, SelfUpdating>,
  number,
  LoadedCatalog | undefined,
  boolean,
  Record<string, OsvFinding>,
  Record<string, string>,
  boolean,
];

// Pro stejné vstupy vždy stejný objekt pravidel – všechny komponenty pak sdílí jeden výsledek
let memo: { inputs: Inputs; rules: UpdateRules } | null = null;

function rulesOf(inputs: Inputs): UpdateRules {
  if (memo && memo.inputs.every((value, i) => value === inputs[i])) return memo.rules;
  const [pins, minAgeDays, minAgeBySource, stuckLimit, firstSeen, stuck, allowed, selfUpdating, clock, catalog, securityNoWait, vulnerable, selfOffer, selfUpdatingWait] = inputs;
  const index = catalog ? releaseIndex(catalog) : undefined;
  const selfKnown = selfIndex(catalog);
  const rules: UpdateRules = {
    pins,
    minAge: (source) => minAgeFor({ minAgeDays, minAgeBySource }, source),
    releasedAt: (pkg, version) => {
      const known = index?.get(`${pkg.source}:${pkg.packageId}`);
      return known && known.version === version ? known.date : undefined;
    },
    firstSeen,
    stuck,
    allowed,
    selfUpdating,
    knownSelfUpdating: (pkg) => isKnownSelfUpdating(pkg, selfKnown),
    selfOffer,
    selfUpdatingWait,
    stuckLimit,
    now: clock,
    security: (pkg, version) => isSecurityRelease(catalog, pkg, version) || !!findingOf(vulnerable, pkg),
    securityNoWait,
  };
  memo = { inputs, rules };
  return rules;
}

/** Pravidla podle aktuálního stavu (React). */
export function useUpdateRules(catalog: LoadedCatalog | undefined): UpdateRules {
  const pins = useUpdatePins((s) => s.pins);
  const minAgeDays = useAutoUpdates((s) => s.minAgeDays);
  const minAgeBySource = useAutoUpdates((s) => s.minAgeBySource);
  const stuckLimit = useAutoUpdates((s) => s.stuckLimit);
  const firstSeen = useUpdateHolds((s) => s.firstSeen);
  const stuck = useUpdateHolds((s) => s.stuck);
  const allowed = useUpdateHolds((s) => s.allowed);
  const selfUpdating = useUpdateHolds((s) => s.selfUpdating);
  const clock = useUpdateHolds((s) => s.clock);
  const securityNoWait = useAutoUpdates((s) => s.securityNoWait);
  const vulnerable = useVulnerabilities((s) => s.found);
  const selfOffer = useUpdateHolds((s) => s.selfOffer);
  const selfUpdatingWait = useAutoUpdates((s) => s.selfUpdatingWait);
  return rulesOf([pins, minAgeDays, minAgeBySource, stuckLimit, firstSeen, stuck, allowed, selfUpdating, clock, catalog, securityNoWait, vulnerable, selfOffer, selfUpdatingWait]);
}

/** Totéž mimo React (kontrola aktualizací na pozadí). */
export function currentUpdateRules(): UpdateRules {
  const { minAgeDays, minAgeBySource, stuckLimit, securityNoWait, selfUpdatingWait } = useAutoUpdates.getState();
  const { firstSeen, stuck, allowed, selfUpdating, selfOffer, clock } = useUpdateHolds.getState();
  const catalog = queryClient.getQueryData<LoadedCatalog>(queryKeys.catalog);
  const vulnerable = useVulnerabilities.getState().found;
  return rulesOf([useUpdatePins.getState().pins, minAgeDays, minAgeBySource, stuckLimit, firstSeen, stuck, allowed, selfUpdating, clock, catalog, securityNoWait, vulnerable, selfOffer, selfUpdatingWait]);
}

/**
 * Uplatní pravidla: skrytá aktualizace = availableVersion null, nabízená verze
 * zůstane v `heldVersion` a důvod v `pin` (u minimálního stáří i `pinUntil`).
 */
export function applyUpdateRules(data: InstalledPackage[], rules: UpdateRules): InstalledPackage[] {
  const pinned = applyPins(data, rules.pins, rules.now);
  return pinned.map((pkg) => {
    const version = pkg.availableVersion;
    if (!version) return pkg;
    const key = versionKey(pkg, version);
    if (rules.allowed[key]) return pkg;
    const hold = (pin: "age" | "stuck" | "self", until?: number): InstalledPackage => ({
      ...pkg,
      availableVersion: null,
      heldVersion: version,
      pin,
      ...(until ? { pinUntil: new Date(until).toISOString() } : {}),
    });
    if (rules.selfUpdating[pinKey(pkg)]) return hold("self");
    // Známá aplikace s vlastním aktualizátorem: čas aktualizovat se sama, pak ji nabídnout
    // (vypnutý aktualizátor, firemní zásady); bezpečnostní oprava po kratší lhůtě
    if (rules.selfUpdatingWait && !rules.selfOffer[pinKey(pkg)] && rules.knownSelfUpdating(pkg)) {
      const grace = rules.security(pkg, version) ? SELF_UPDATE_SECURITY_GRACE_DAYS : SELF_UPDATE_GRACE_DAYS;
      const seen = rules.firstSeen[key] ? Date.parse(rules.firstSeen[key]) : rules.now;
      const until = Math.min(rules.releasedAt(pkg, version) ?? seen, seen) + grace * DAY_MS;
      if (until > rules.now) return hold("self", until);
    }
    if (rules.stuckLimit > 0 && (rules.stuck[key] ?? 0) >= rules.stuckLimit) return hold("stuck");
    const days = rules.minAge(pkg.source);
    if (days > 0 && !(rules.securityNoWait && rules.security(pkg, version))) {
      const seen = rules.firstSeen[key] ? Date.parse(rules.firstSeen[key]) : rules.now;
      const released = Math.min(rules.releasedAt(pkg, version) ?? seen, seen);
      const until = released + days * DAY_MS;
      if (until > rules.now) return hold("age", until);
    }
    return pkg;
  });
}
