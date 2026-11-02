/**
 * Hooky pro data: katalog, nainstalované balíčky ze všech správců
 * a jejich spojení do jednoho profilu aplikace.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, queryKeys } from "@/app/queryClient";
import { archFamilies, matchesArch } from "@/lib/arch";
import { eaIconSrc, steamIconSrc } from "@/lib/iconSrc";
import { installedNameKey } from "@/lib/nameKey";
import { isTauri } from "@/lib/tauri";
import { isWebOnly } from "@/lib/webOnly";
import { wingetBaseId } from "@/lib/wingetVariant";
import { normalize } from "@/lib/utils";
import { compareVersions } from "@/lib/version";
import { loadCatalog, type LoadedCatalog } from "@/services/catalog";
import { getAllInstalled, getSource, isEaGame, isSourceId, sortBySourceOrder, steamAppId } from "@/services/managers";
import { useJobs } from "@/store/jobs";
import { usePackageIndex } from "@/store/packageIndex";
import { activeSources, sourcePriority, useSettings } from "@/store/settings";
import { inLockedSource, useSourceScope } from "@/store/sourceLock";
import { applyUpdateRules, useUpdateRules, type UpdateRules } from "@/store/updateRules";
import type { CatalogEntry, InstalledPackage, Job, PackageSource, RepoSearchResult, SortMode, SourceId } from "@/types";

/** Klíč pro dohledání podle zdroje: "scoop:extras/firefox". */
export const sourceKey = (source: SourceId, packageId: string) => `${source}:${packageId}`;

/** Katalog (načte se jednou při startu, pak drží v cache). */
export function useCatalog() {
  return useQuery({
    queryKey: queryKeys.catalog,
    // Novější katalog stažený na pozadí po startu z uložené kopie
    queryFn: () => loadCatalog((fresh) => queryClient.setQueryData(queryKeys.catalog, fresh)),
    staleTime: Infinity,
  });
}

// Indexy nad katalogem (25 000+ aplikací) a nainstalovanými balíčky se počítají
// jednou pro každá data a sdílí je všechny komponenty. useMemo by je počítal
// v každé kartě zvlášť – desítky karet × několik hooků = sekundy při každém
// přechodu na stránku.
const catalogIndexes = new WeakMap<LoadedCatalog, Map<string, CatalogEntry>>();
const sourceIndexes = new WeakMap<LoadedCatalog, Map<string, CatalogEntry>>();
const installedIndexes = new WeakMap<
  InstalledPackage[],
  { links: Map<InstalledPackage, CatalogEntry | undefined>; index: Map<string, InstalledPackage> }
>();
const NO_ENTRIES = new Map<string, CatalogEntry>();
const NO_INSTALLED = new Map<string, InstalledPackage>();

function cached<K extends object, V>(cache: WeakMap<K, V>, key: K, build: () => V): V {
  let value = cache.get(key);
  if (value === undefined) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

/** Mapa id aplikace → profil v katalogu. */
export function useCatalogIndex() {
  const { data } = useCatalog();
  if (!data) return NO_ENTRIES;
  return cached(catalogIndexes, data, () => new Map(data.catalog.packages.map((p) => [p.id, p])));
}

/** Mapa "zdroj:id balíčku" → profil v katalogu (spojení dat od správců s katalogem). */
export function useSourceIndex() {
  const { data } = useCatalog();
  if (!data) return NO_ENTRIES;
  return cached(sourceIndexes, data, () => {
    const map = new Map<string, CatalogEntry>();
    for (const entry of data.catalog.packages) {
      for (const s of entry.sources) map.set(sourceKey(s.source, s.packageId), entry);
    }
    return map;
  });
}

/**
 * Kolik aplikací jde přes HubGet nainstalovat ze zapnutých správců:
 *  - total: unikátní aplikace ze správců aplikací (aplikace z více zdrojů se počítá jednou;
 *    knihovny z npm, pip… se nepočítají, aby nepřebily počet aplikací),
 *  - bySource: počty v jednotlivých repozitářích (všichni zapnutí správci).
 *
 * Primárně z `catalog.stats` (čísla za celé repozitáře). Vypnutý správce ubere
 * aplikace, které jsou jen v něm. Bez statistik se počítá z aplikací v katalogu.
 */
export function useInstallableStats() {
  const { data } = useCatalog();
  const enabled = useSettings((s) => s.enabledSources);
  return useMemo(() => {
    const stats = data?.catalog.stats;
    const isApps = (id: SourceId) => getSource(id).group === "apps";
    const bySource = {} as Partial<Record<SourceId, number>>;
    let total = 0;

    if (stats) {
      total = stats.total;
      for (const id of Object.keys(stats.bySource).filter(isSourceId)) {
        if (enabled.includes(id)) bySource[id] = stats.bySource[id] ?? 0;
        else if (isApps(id)) total -= stats.exclusive[id] ?? 0;
      }
    } else {
      for (const id of enabled) bySource[id] = 0;
      for (const p of data?.catalog.packages ?? []) {
        const available = p.sources.filter((s) => enabled.includes(s.source));
        if (available.some((s) => isApps(s.source))) total++;
        for (const s of available) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
      }
    }

    return { total, bySource, loaded: !!data };
  }, [data, enabled]);
}


/**
 * Základní id varianty balíčku wingetu (jazyk, jiný typ instalátoru), nebo
 * null: „Google.Chrome.EXE“ → „Google.Chrome“, „Mozilla.Firefox.cs“ →
 * „Mozilla.Firefox“. Varianty katalog slučuje do karty základního balíčku
 * (stejné pravidlo v data-pipeline – src/lib/wingetVariant.ts).
 */
export { wingetBaseId };

const nameIndexes = new WeakMap<LoadedCatalog, Map<string, CatalogEntry>>();

/** Mapa „klíč názvu“ → nejpopulárnější profil s tímto názvem (katalog je seřazený podle popularity). */
function catalogNameIndex(data: LoadedCatalog) {
  return cached(nameIndexes, data, () => {
    const map = new Map<string, CatalogEntry>();
    for (const entry of data.catalog.packages) {
      const key = installedNameKey(entry.name);
      if (key.length >= 2 && !map.has(key)) map.set(key, entry);
    }
    return map;
  });
}

function useCatalogNameIndex() {
  const { data } = useCatalog();
  return data ? catalogNameIndex(data) : NO_ENTRIES;
}

type InstalledAlias = [pattern: RegExp, entry: CatalogEntry];
const aliasIndexes = new WeakMap<LoadedCatalog, InstalledAlias[]>();
const NO_ALIASES: InstalledAlias[] = [];

/**
 * Jiné názvy v registru u aplikací jen z webu výrobce (`installedNames` – regulární
 * výrazy): „VMware Workstation“ → VMware Workstation Pro, „NI LabVIEW 2025 Q3“ → LabVIEW.
 */
function installedAliases(data: LoadedCatalog) {
  return cached(aliasIndexes, data, () =>
    data.catalog.packages.flatMap((entry) =>
      (entry.installedNames ?? []).flatMap((pattern): InstalledAlias[] => {
        try {
          return [[new RegExp(pattern, "i"), entry]];
        } catch {
          return []; // neplatný výraz v katalogu – aplikace se jen nespáruje
        }
      }),
    ),
  );
}

function useInstalledAliases() {
  const { data } = useCatalog();
  return data ? installedAliases(data) : NO_ALIASES;
}

const wingetTailIndexes = new WeakMap<Map<string, CatalogEntry>, Map<string, CatalogEntry>>();

/** Mapa „klíč poslední části id wingetu“ → profil („ElectronicArts.EADesktop“ → „eadesktop“). */
function wingetTailIndex(sourceIndex: Map<string, CatalogEntry>) {
  return cached(wingetTailIndexes, sourceIndex, () => {
    const map = new Map<string, CatalogEntry>();
    for (const [key, entry] of sourceIndex) {
      if (!key.startsWith("winget:")) continue;
      const tail = installedNameKey(key.slice(key.lastIndexOf(".") + 1));
      if (tail.length >= 4 && !map.has(tail)) map.set(tail, entry);
    }
    return map;
  });
}

type InstalledLinks = Map<InstalledPackage, CatalogEntry | undefined>;
const installedLinks = new WeakMap<
  InstalledPackage[],
  { sourceIndex: unknown; nameIndex: unknown; aliases: unknown; links: InstalledLinks }
>();
const NO_LINKS: InstalledLinks = new Map();

/**
 * Profil v katalogu pro každý nainstalovaný balíček:
 *  1. podle zdroje a id balíčku (přesně),
 *  2. podle základního id varianty wingetu („Google.Chrome.EXE“ → karta
 *     „Google.Chrome“ – katalog varianty slučuje),
 *  3. jinak podle názvu – winget vidí řadu programů jen jako záznam v registru
 *     („ARP\User\X64\Discord“), bez vazby na balíček Discord.Discord; složka
 *     programu nalezeného jen na disku i bez hlavní verze („Audacity 4“)
 *     a podle poslední části id wingetu („EA Desktop“ → ElectronicArts.EADesktop),
 *  4. aplikace jen z webu výrobce i podle jiného názvu v registru (installedAliases).
 * Jeden profil patří nejvýš jednomu balíčku; shoda podle id má přednost
 * a programy nalezené jen na disku jsou na řadě poslední (getAllInstalled je řadí na konec).
 */
function useInstalledLinks(): InstalledLinks {
  const { data } = useInstalled();
  const sourceIndex = useSourceIndex();
  const nameIndex = useCatalogNameIndex();
  const aliases = useInstalledAliases();
  if (!data) return NO_LINKS;
  const known = installedLinks.get(data);
  if (known && known.sourceIndex === sourceIndex && known.nameIndex === nameIndex && known.aliases === aliases) return known.links;

  const links: InstalledLinks = new Map();
  const taken = new Set<string>();
  for (const p of data) {
    const entry = sourceIndex.get(sourceKey(p.source, p.packageId));
    links.set(p, entry);
    if (entry) taken.add(entry.id);
  }
  const linkFree = (p: InstalledPackage, entry: CatalogEntry | undefined) => {
    if (!entry || taken.has(entry.id)) return;
    // Aplikace jen z webu výrobce je program ve Windows – ne knihovna z npm či pip se stejným názvem
    if (isWebOnly(entry) && p.origin !== "local") return;
    links.set(p, entry);
    taken.add(entry.id);
  };
  for (const p of data) {
    const base = !links.get(p) && p.source === "winget" ? wingetBaseId(p.packageId) : null;
    if (base) linkFree(p, sourceIndex.get(sourceKey(p.source, base)));
  }
  for (const p of data) {
    if (!links.get(p)) linkFree(p, nameIndex.get(installedNameKey(p.name)));
  }
  for (const p of data) {
    if (!links.get(p) && !p.diskLocation) linkFree(p, aliases.find(([pattern]) => pattern.test(p.name))?.[1]);
  }
  for (const p of data) {
    if (links.get(p) || !p.diskLocation) continue;
    const bare = p.name.replace(/\s+\d+$/, "");
    if (bare !== p.name) linkFree(p, nameIndex.get(installedNameKey(bare)));
    if (!links.get(p)) linkFree(p, wingetTailIndex(sourceIndex).get(installedNameKey(p.name)));
  }
  installedLinks.set(data, { sourceIndex, nameIndex, aliases, links });
  return links;
}

/**
 * Patří balíček mezi nainstalované aplikace? Program nalezený jen podle složky
 * na disku jen se spárovaným profilem z katalogu – jinak by seznam zaplnily
 * nástroje a pomocné programy z Program Files.
 */
export const isListedInstalled = (p: InstalledPackage, links: InstalledLinks) => !p.diskLocation || links.get(p) !== undefined;

/** Profil v katalogu pro nainstalovaný balíček (podle id, jinak podle názvu). */
export function useInstalledEntries() {
  return useInstalledLinks();
}

/**
 * Selektor, který uplatní pravidla aktualizací (zámky, minimální stáří…). Pro
 * stejná pravidla je to vždy stejná funkce a pro stejná data vrátí stejné pole –
 * všechny komponenty tak dostanou jeden seznam a sdílené indexy (WeakMap výše)
 * se nepočítají znovu.
 */
let ruleSelector: {
  rules: UpdateRules;
  catalog: LoadedCatalog | undefined;
  select: (data: InstalledPackage[]) => InstalledPackage[];
} | null = null;

function selectWithRules(rules: UpdateRules, catalog: LoadedCatalog | undefined) {
  if (ruleSelector?.rules !== rules || ruleSelector.catalog !== catalog) {
    let last: { data: InstalledPackage[]; result: InstalledPackage[] } | null = null;
    const select = (data: InstalledPackage[]) => {
      if (last?.data !== data) last = { data, result: applyUpdateRules(withPortablePackages(data, catalog), rules) };
      return last.result;
    };
    ruleSelector = { rules, catalog, select };
  }
  return ruleSelector.select;
}

/**
 * Program rozbalený na ploše (Tor Browser) winget po instalaci nevidí. S profilem
 * v katalogu, který má balíček wingetu, se vede pod jeho id – aktualizace,
 * odinstalace i spuštění pak jdou přes winget a backend program pozná sám
 * (winget_operation, launch_info) – a novější verzi v katalogu nabídne jako aktualizaci.
 */
function withPortablePackages(data: InstalledPackage[], catalog: LoadedCatalog | undefined): InstalledPackage[] {
  if (!catalog || !data.some((p) => p.portable)) return data;
  const names = catalogNameIndex(catalog);
  return data.map((p) => {
    const winget = p.portable ? names.get(installedNameKey(p.name))?.sources.find((s) => s.source === "winget") : undefined;
    if (!winget) return p;
    const newer = !!p.installedVersion && compareVersions(winget.version, p.installedVersion) > 0;
    return { ...p, packageId: winget.packageId, origin: "winget", availableVersion: newer ? winget.version : null };
  });
}

/**
 * Nainstalované balíčky ze všech zapnutých správců (s uplatněnými pravidly
 * aktualizací); balíčky správců pro vývojáře jen v režimu Vývojář.
 */
export function useInstalled() {
  const enabledSources = useSettings((s) => s.enabledSources);
  const userMode = useSettings((s) => s.userMode);
  const enabled = useMemo(() => activeSources(enabledSources, userMode), [enabledSources, userMode]);
  const { data: catalog } = useCatalog();
  const rules = useUpdateRules(catalog);
  return useQuery({
    queryKey: [...queryKeys.installed, enabled],
    queryFn: () => getAllInstalled(enabled),
    select: selectWithRules(rules, catalog),
    // Bez strukturálního sdílení – jinak by každá komponenta dostala vlastní kopii pole
    structuralSharing: false,
  });
}

/**
 * Mapa id aplikace → nainstalovaný balíček. Balíčky z katalogu se mapují
 * na kanonické id, ostatní dostanou id ve tvaru "zdroj:id balíčku" – stejně
 * jako další instalace téže aplikace jiným správcem (Git přes winget i jako
 * závislost Scoopu), ať ji karta, detail i fronta úloh rozliší.
 *
 * Počítá ji jen PackageIndexSync (desítky odběrů dotazů a stavu); ostatní čtou
 * hotovou přes useInstalledIndex / useInstalledEntry (store/packageIndex.ts).
 */
export function useComputedInstalledIndex() {
  const { data } = useInstalled();
  const links = useInstalledLinks();
  if (!data) return NO_INSTALLED;
  let cachedIndex = installedIndexes.get(data);
  // Přepočítat i po načtení jiného katalogu (stejný seznam, nové párování)
  if (!cachedIndex || cachedIndex.links !== links) {
    const index = new Map<string, InstalledPackage>();
    for (const p of data) {
      if (!isListedInstalled(p, links)) continue;
      const appId = links.get(p)?.id ?? sourceKey(p.source, p.packageId);
      if (!index.has(appId)) index.set(appId, p);
      else if (links.get(p)) index.set(sourceKey(p.source, p.packageId), p);
    }
    cachedIndex = { links, index };
    installedIndexes.set(data, cachedIndex);
  }
  return cachedIndex.index;
}

/** Mapa id aplikace → nainstalovaný balíček (hotová, jeden odběr – viz useComputedInstalledIndex). */
export const useInstalledIndex = () => usePackageIndex((s) => s.installed);

/** Nainstalovaný balíček jedné aplikace – karta se překreslí jen při změně svého záznamu. */
export const useInstalledEntry = (appId: string) => usePackageIndex((s) => s.installed.get(appId));

/** Výsledný stav aplikace pro tlačítko akce. */
export type PackageStatus = "available" | "installed" | "updatable";

export interface PackageState {
  status: PackageStatus;
  installed: InstalledPackage | undefined;
  job: Job | undefined;
}

/** Spojí nainstalovaný stav a případnou běžící úlohu pro jednu aplikaci. */
export function usePackageState(appId: string): PackageState {
  const installed = useInstalledEntry(appId);
  const job = useJobs((s) => s.jobs[appId]);
  const status: PackageStatus = !installed ? "available" : installed.availableVersion ? "updatable" : "installed";
  return { status, installed, job };
}

/**
 * Zdroj, který se pro aplikaci použije: u nainstalované ten, přes který je
 * nainstalovaná; jinak výslovně zvolený, nebo první podle priority z nastavení.
 * Vrací undefined, pokud aplikace není v žádném zapnutém zdroji (ani
 * v zamčeném – režim jednoho zdroje v levém panelu).
 */
export function useEffectiveSource(entry: CatalogEntry, chosen?: SourceId): PackageSource | undefined {
  const installed = useInstalledEntry(entry.id);
  const { enabled, preferred } = useSourceScope();

  if (installed) {
    const catalogSource = entry.sources.find((s) => s.source === installed.source);
    if (catalogSource?.packageId.toLowerCase() === installed.packageId.toLowerCase()) return catalogSource;
    // Nainstalováno pod jiným id (varianta „Google.Chrome.EXE“, záznam v registru
    // „ARP\…\Discord“) – aktualizace a starší verze musí jít na nainstalovaný balíček.
    // Údaje o instalátoru z katalogu (typ, SHA-256) patří jinému balíčku, nepřebírají se.
    return {
      source: installed.source,
      packageId: installed.packageId,
      version: installed.availableVersion ?? installed.installedVersion,
    };
  }
  return pickSource(entry, enabled, preferred, chosen);
}

/**
 * Zdroj pro instalaci (bez hooků – použitelné i v cyklu, např. „Instalovat vše“):
 * výslovně zvolený, jinak první zapnutý podle priority.
 */
export function pickSource(
  entry: CatalogEntry,
  enabled: SourceId[],
  preferred: SourceId,
  chosen?: SourceId,
): PackageSource | undefined {
  const available = entry.sources.filter((s) => enabled.includes(s.source));
  if (chosen) {
    const match = available.find((s) => s.source === chosen);
    if (match) return match;
  }
  for (const id of sourcePriority(enabled, preferred)) {
    const match = available.find((s) => s.source === id);
    if (match) return match;
  }
  return undefined;
}

/**
 * Náhradní profil pro balíček, který v katalogu není (nalezený přímo
 * u správce nebo nainstalovaný mimo katalog). Karty tak pracují s jedním typem.
 */
export function fallbackEntry(source: SourceId, packageId: string, name: string, version: string): CatalogEntry {
  const bare = packageId.split("/").pop() ?? packageId;
  const base: CatalogEntry = {
    id: sourceKey(source, packageId),
    name,
    // winget id má tvar Vydavatel.Aplikace; u ostatních vydavatele neznáme
    publisher: source === "winget" && !packageId.startsWith("ARP\\") ? (packageId.split(".")[0] ?? "") : "",
    description: "",
    categories: [],
    tags: [],
    iconUrl: null,
    homepage: null,
    license: null,
    latestVersion: version,
    popularity: 0,
    addedAt: "",
    sources: [{ source, packageId, version }],
  };
  if (source !== "winget") return { ...base, publisher: bare };

  // Hra ze Steamu: kategorie Hry (banner jako u aplikací – ikona a název na vzorku herních
  // symbolů; obrázek hry ze Steamu má nízké rozlišení), ikona, kterou uložil Steam, a odkaz do obchodu
  const appId = steamAppId(packageId);
  if (appId) {
    return {
      ...base,
      publisher: "Steam",
      categories: ["games"],
      iconUrl: isTauri() ? steamIconSrc(appId) : null,
      homepage: `https://store.steampowered.com/app/${appId}`,
    };
  }
  // Hra z EA app: kategorie Hry a ikona hry z jejího záznamu v registru (stejně jako u Steamu)
  if (isEaGame(packageId)) {
    return { ...base, publisher: "EA app", categories: ["games"], iconUrl: isTauri() ? eaIconSrc(packageId) : null };
  }
  return base;
}

/**
 * Klíč pro porovnání názvů aplikací: bez ohledu na velikost písmen, diakritiku,
 * mezery a interpunkci („Spotify CLI“ = „Spotify Cli“, „spotify_player“ =
 * „Spotify Player“), ale „Spotify“ ≠ „Spotify CLI“ ≠ „Go Spotify Cli“.
 */
export const nameKey = (name: string) => normalize(name).replace(/[^\p{L}\p{N}]+/gu, "");

/** Aplikace z katalogu připravená k vyhledávání – texty už bez diakritiky, malými písmeny. */
export interface SearchRecord {
  entry: CatalogEntry;
  name: string;
  /** Id a vydavatel. */
  idPublisher: string;
  /** Štítky a popis. */
  extra: string;
}

const searchIndexes = new WeakMap<LoadedCatalog, SearchRecord[]>();
const nameKeyIndexes = new WeakMap<LoadedCatalog, Map<string, CatalogEntry>>();

/**
 * Index pro vyhledávání – normalizace 25 000 názvů, popisů a štítků (~100 ms)
 * proběhne jednou pro katalog, ne při každém stisku klávesy.
 */
export function catalogSearchIndex(data: LoadedCatalog): SearchRecord[] {
  return cached(searchIndexes, data, () =>
    data.catalog.packages.map((entry) => ({
      entry,
      name: normalize(entry.name),
      idPublisher: normalize(`${entry.id} ${entry.publisher}`),
      extra: normalize(`${entry.tags.join(" ")} ${entry.description}`),
    })),
  );
}

/** Aplikace z katalogu podle klíče názvu (nameKey) – jednou pro katalog. */
export function catalogByNameKey(data: LoadedCatalog): Map<string, CatalogEntry> {
  return cached(nameKeyIndexes, data, () => new Map(data.catalog.packages.map((p) => [nameKey(p.name), p])));
}

/** Jak „hezky“ je název zapsaný: velká písmena a mezery místo podtržítek / pomlček. */
const displayScore = (name: string) => Number(/\p{Lu}/u.test(name)) + Number(/\s/.test(name)) - Number(/[_]/.test(name));

/**
 * Sloučí výsledky hledání od více správců do profilů:
 *  - stejný název z různých správců = jeden profil s více zdroji,
 *  - jiný název = samostatný profil,
 *  - dva různé balíčky se stejným názvem v jednom správci zůstanou zvlášť
 *    (profil může mít z každého správce jen jeden zdroj).
 * Zdroje v profilu jsou seřazené podle pořadí správců (winget → Chocolatey → Scoop…).
 */
export function mergeRepoResults(results: RepoSearchResult[]): CatalogEntry[] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const r of results) {
    const key = nameKey(r.name) || r.packageId;
    const profiles = groups.get(key) ?? [];
    // Stejný balíček podruhé (např. z opakovaného hledání) nepřidávat
    if (profiles.some((e) => e.sources.some((s) => s.source === r.source && s.packageId === r.packageId))) continue;
    const target = profiles.find((e) => !e.sources.some((s) => s.source === r.source));
    if (target) {
      target.sources.push({ source: r.source, packageId: r.packageId, version: r.version });
      // Zobrazit čitelnější z obou zápisů názvu („Spotify Player“ místo „spotify_player“)
      if (displayScore(r.name) > displayScore(target.name)) target.name = r.name;
    } else profiles.push(fallbackEntry(r.source, r.packageId, r.name, r.version));
    groups.set(key, profiles);
  }
  return [...groups.values()].flat().map((e) => ({ ...e, sources: sortBySourceOrder(e.sources) }));
}

/** Rozloží id ve tvaru "zdroj:id balíčku" (balíčky mimo katalog). */
export function parseSourceKey(id: string): { source: SourceId; packageId: string } | null {
  const colon = id.indexOf(":");
  const source = id.slice(0, colon);
  return colon > 0 && isSourceId(source) ? { source, packageId: id.slice(colon + 1) } : null;
}

/** Balíček jen pro vývojáře (dostupný výhradně v npm, pip, Cargo…)? */
export const isDevOnly = (entry: CatalogEntry) =>
  entry.sources.length > 0 && entry.sources.every((s) => getSource(s.source).group === "dev");

/**
 * Filtr přehledů katalogu: běžný uživatel nevidí balíčky jen pro vývojáře
 * (knihovny a nástroje z npm, pip, Cargo…), vývojář vidí vše. Při zamčeném
 * zdroji (levý panel → WinGet / Chocolatey / Scoop) jen aplikace z něj.
 */
export function useModeFilter() {
  const developer = useSettings((s) => s.userMode === "developer");
  const { lock } = useSourceScope();
  return useMemo(
    () =>
      <T extends CatalogEntry>(entries: T[]): T[] =>
        entries.filter((e) => (developer || !isDevOnly(e)) && inLockedSource(e, lock)),
    [developer, lock],
  );
}

/**
 * Filtr platformy z nastavení (x64 / ARM64 / x86 / všechny) a test, zda mu aplikace odpovídá.
 * Rodiny verzí pro jiné procesory se berou z celého katalogu (`Discord.Discord` vedle `.arm64` a `.x86` = x64).
 */
export function useArchFilter() {
  const filter = useSettings((s) => s.archFilter);
  const { data } = useCatalog();
  return useMemo(() => {
    const families = data ? archFamilies(data.catalog.packages) : undefined;
    return { filter, fits: (entry: Pick<CatalogEntry, "sources">) => matchesArch(entry.sources, filter, families) };
  }, [filter, data]);
}

/** Seřadí balíčky podle aktuálního nastavení řazení. */
export function sortPackages(packages: CatalogEntry[], mode: SortMode, locale: string) {
  const sorted = [...packages];
  if (mode === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, locale));
  // „recent“ (nově nainstalované) řadí jen Nainstalované (useInstallOrder) – jinde popularita
  else sorted.sort((a, b) => b.popularity - a.popularity);
  return sorted;
}

/** Seřazený seznam podle uživatelova nastavení. */
export function useSortedPackages(packages: CatalogEntry[]) {
  const sortMode = useSettings((s) => s.sortMode);
  const language = useSettings((s) => s.language);
  return useMemo(() => sortPackages(packages, sortMode, language), [packages, sortMode, language]);
}
