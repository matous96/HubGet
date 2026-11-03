/**
 * Načítání katalogu (catalog.json – vytváří ho data-pipeline).
 *
 * Pořadí zdrojů:
 *  1. vzdálená URL (VITE_CATALOG_URL; v sestavené aplikaci jinak katalog, který denně
 *     zveřejňuje workflow Katalog na GitHub Pages) – nejčerstvější data; při startu
 *     s uloženou kopií (3.) se nejdřív ukáže ona a vzdálený katalog se stáhne na pozadí,
 *     za běhu pak znovu po REFRESH_INTERVAL (watchRemote),
 *  2. ve vývoji místní /catalog.json (vygenerovaný příkazem `pnpm pipeline --local`),
 *  3. poslední úspěšně stažená kopie v mezipaměti prohlížeče (Cache Storage –
 *     katalog má přes 10 MB, do localStorage se nevejde; v Tauri později soubor v %APPDATA%),
 *  4. v produkčním sestavení /catalog.json přibalený k aplikaci (z public/ při sestavení),
 *  5. malý ukázkový katalog ze zdrojového kódu – funguje vždy.
 */
import type { Catalog } from "@/types";
import { sortBySourceOrder } from "@/services/managers/sources";

const CACHE_NAME = "unibox-catalog";
const CACHE_URL = "/__unibox/catalog.json";
// Ve vývoji bez nastavení žádný – načte se místní z pipeline. Web a katalog jsou na GitHub Pages
// s doménou hubget.eu; verze do 0.1.18 stahují z matous96.github.io/unibox, které po přejmenování
// repozitáře na HubGet (listopad 2026) nepřesměruje – zůstane jim uložený katalog, dokud se neaktualizují.
const REMOTE_URL: string | undefined =
  import.meta.env.VITE_CATALOG_URL || (import.meta.env.DEV ? undefined : "https://hubget.eu/catalog.json");
/** Katalog z public/ – ve vývoji „místní“, v sestavené aplikaci „přibalený“. */
const CATALOG_FILE = "/catalog.json";
/** Za jak dlouho po stažení zkusit novější katalog (workflow Katalog ho zveřejňuje denně a po změnách). */
const REFRESH_INTERVAL = 6 * 3600_000;
/** Po neúspěchu (offline) dřív. */
const RETRY_INTERVAL = 30 * 60_000;
/** Jak často se na pozadí kontroluje, jestli je obnova na řadě (časovače během spánku počítače stojí). */
const REFRESH_TICK = 15 * 60_000;

export type CatalogSource = "remote" | "local" | "cache" | "packaged" | "bundled";

export interface LoadedCatalog {
  catalog: Catalog;
  source: CatalogSource;
}

// Kontrola i verze schématu – starší katalog (v1, jen winget) nemá pole `sources`.
const isValid = (data: unknown): data is Catalog =>
  !!data &&
  typeof data === "object" &&
  (data as Catalog).schemaVersion === 2 &&
  Array.isArray((data as Catalog).packages);

/**
 * Načte katalog a seřadí zdroje každé aplikace podle pořadí správců v aplikaci.
 *
 * Při startu s uloženou kopií vrátí hned ji a čerstvý katalog (17 MB, komprimovaně ~4 MB)
 * stáhne na pozadí – start tak nečeká na síť (dřív až 15 s na pomalém připojení).
 * Novější katalog dostane `onFresh` – po startu i později za běhu (watchRemote). Další
 * načtení (Nastavení → Načíst znovu) jde rovnou na internet.
 */
export async function loadCatalog(onFresh?: (fresh: LoadedCatalog) => void): Promise<LoadedCatalog> {
  const cacheFirst = !!onFresh && !loadedOnce;
  loadedOnce = true;
  const loaded = await loadRawCatalog(cacheFirst);
  shown = loaded.catalog;
  if (loaded.source === "remote") nextAttempt = Date.now() + REFRESH_INTERVAL;
  if (cacheFirst && REMOTE_URL) watchRemote(REMOTE_URL, onFresh);
  return prepare(loaded);
}

let loadedOnce = false;
/** Zobrazený katalog – čerstvý se předá dál, jen když se od něj liší. */
let shown: Catalog | null = null;
/** Kdy je na řadě další pokus o stažení (0 = hned). */
let nextAttempt = 0;
let refreshing = false;
/** generatedAt katalogu v mezipaměti – stejný se znovu neukládá. */
let storedAt: string | undefined;

/**
 * Obnova katalogu za běhu. Zavřený HubGet běží dál v oznamovací oblasti, často celé dny,
 * a katalog by se jinak stáhl jen při startu. První pokus hned (po startu z uložené nebo
 * přibalené kopie), další po REFRESH_INTERVAL: když se uživatel k oknu vrátí, nebo na pozadí,
 * když okno nemá fokus – nové pořadí a data se tak nepřehodí pod rukama při práci.
 * Nezměněný katalog nechá zobrazená data beze změny (indexy nad 25 000 aplikacemi se
 * nepřepočítávají).
 */
function watchRemote(url: string, onFresh: (fresh: LoadedCatalog) => void) {
  const refresh = async () => {
    if (refreshing || !shown || Date.now() < nextAttempt) return;
    refreshing = true;
    const ok = await refreshFromRemote(url, shown, (fresh) => {
      shown = fresh.catalog;
      onFresh(prepare(fresh));
    });
    nextAttempt = Date.now() + (ok ? REFRESH_INTERVAL : RETRY_INTERVAL);
    refreshing = false;
  };
  window.addEventListener("focus", () => void refresh());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
  setInterval(() => {
    if (!document.hasFocus()) void refresh();
  }, REFRESH_TICK);
  void refresh();
}

function prepare(loaded: LoadedCatalog): LoadedCatalog {
  // Kategorie z verze 0.1.20 (AI, cloud…) jsou jen v categoriesV2 – `categories` je pro starší verze
  const packages = loaded.catalog.packages.map((p) => ({
    ...p,
    categories: p.categoriesV2 ?? p.categories,
    sources: sortBySourceOrder(p.sources),
  }));
  // Aplikace jen z webu výrobce mezi ostatní podle popularity (katalog je podle ní seřazený)
  for (const web of loaded.catalog.webOnly ?? []) {
    if (!web.downloadUrl || packages.some((p) => p.id === web.id)) continue;
    const at = packages.findIndex((p) => p.popularity < web.popularity);
    packages.splice(at < 0 ? packages.length : at, 0, { ...web, sources: [] });
  }
  return { ...loaded, catalog: { ...loaded.catalog, packages } };
}

/**
 * Čerstvý katalog na pozadí: uloží ho a předá dál, jen když je jiný než zobrazená kopie.
 * Vrátí, jestli se ho podařilo stáhnout.
 */
async function refreshFromRemote(url: string, current: Catalog, onFresh: (fresh: LoadedCatalog) => void): Promise<boolean> {
  // Na pozadí nic nespěchá – delší limit i pro pomalé připojení
  const remote = await fetchCatalog(url, 120_000);
  if (!remote) return false; // offline – zůstane uložená kopie
  if (remote.data.generatedAt !== storedAt) void saveToCache(remote.text, remote.data.generatedAt);
  if (remote.data.generatedAt !== current.generatedAt) onFresh({ catalog: remote.data, source: "remote" });
  return true;
}

/** Stáhne a ověří katalog z adresy; null při chybě nebo neplatných datech. */
async function fetchCatalog(url: string, timeoutMs: number): Promise<{ data: Catalog; text: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const text = await res.text();
    const data: unknown = JSON.parse(text);
    return isValid(data) ? { data, text } : null;
  } catch {
    return null; // offline, chyba sítě nebo soubor neexistuje
  }
}

async function saveToCache(text: string, generatedAt: string) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CACHE_URL, new Response(text, { headers: { "Content-Type": "application/json" } }));
    storedAt = generatedAt;
  } catch {
    /* mezipaměť nedostupná – příště se použije přibalená kopie */
  }
}

async function loadFromCache(): Promise<Catalog | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(CACHE_URL);
    if (!res) return null;
    const data: unknown = await res.json();
    if (!isValid(data)) return null;
    storedAt = data.generatedAt;
    return data;
  } catch {
    return null;
  }
}

async function loadRawCatalog(cacheFirst: boolean): Promise<LoadedCatalog> {
  // 1) Vzdálený katalog – při startu s uloženou kopií se stáhne až na pozadí (watchRemote)
  if (REMOTE_URL) {
    const cached = cacheFirst ? await loadFromCache() : null;
    if (cached) return { catalog: cached, source: "cache" };
    // První spuštění (žádná uložená kopie): katalog přibalený k aplikaci hned (ve vývoji místní
    // z pipeline), čerstvý se stáhne na pozadí – start nečeká na 4 MB z internetu
    const packaged = cacheFirst ? await fetchCatalog(CATALOG_FILE, 15_000) : null;
    if (packaged) return { catalog: packaged.data, source: "packaged" };
    const remote = await fetchCatalog(REMOTE_URL, 15_000);
    if (remote) {
      void saveToCache(remote.text, remote.data.generatedAt);
      return { catalog: remote.data, source: "remote" };
    }
  }

  // 2) Místní katalog z pipeline (jen ve vývoji)
  if (import.meta.env.DEV) {
    const local = await fetchCatalog(CATALOG_FILE, 15_000);
    if (local) return { catalog: local.data, source: "local" };
  }

  // 3) Kopie z posledního úspěšného stažení
  const cached = await loadFromCache();
  if (cached) return { catalog: cached, source: "cache" };

  // 4) Katalog přibalený k sestavené aplikaci
  if (!import.meta.env.DEV) {
    const packaged = await fetchCatalog(CATALOG_FILE, 15_000);
    if (packaged) return { catalog: packaged.data, source: "packaged" };
  }

  // 5) Ukázkový katalog ze zdrojového kódu – načte se až teď (480 kB, jinak by zdržel každý start)
  const { default: bundled } = await import("@/data/catalog.sample.json");
  return { catalog: bundled as Catalog, source: "bundled" };
}
