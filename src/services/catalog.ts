/**
 * Načítání katalogu (catalog.json – vytváří ho data-pipeline).
 *
 * Pořadí zdrojů:
 *  1. vzdálená URL (VITE_CATALOG_URL; v sestavené aplikaci jinak katalog, který denně
 *     zveřejňuje workflow Katalog na GitHub Pages) – nejčerstvější data; při startu
 *     s uloženou kopií (3.) se nejdřív ukáže ona a vzdálený katalog se stáhne na pozadí,
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
// s doménou hubget.eu; starší verze stahují z matous96.github.io/unibox, které na ni přesměruje.
const REMOTE_URL: string | undefined =
  import.meta.env.VITE_CATALOG_URL || (import.meta.env.DEV ? undefined : "https://hubget.eu/catalog.json");
/** Katalog z public/ – ve vývoji „místní“, v sestavené aplikaci „přibalený“. */
const CATALOG_FILE = "/catalog.json";

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
 * Novější katalog dostane `onFresh`. Další načtení (Nastavení → Načíst znovu) jde rovnou
 * na internet.
 */
export async function loadCatalog(onFresh?: (fresh: LoadedCatalog) => void): Promise<LoadedCatalog> {
  const cacheFirst = !!onFresh && !loadedOnce;
  loadedOnce = true;
  return prepare(await loadRawCatalog(cacheFirst ? (fresh) => onFresh(prepare(fresh)) : undefined));
}

let loadedOnce = false;

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

/** Čerstvý katalog na pozadí: uloží ho a předá dál, jen když je jiný než zobrazená kopie. */
async function refreshFromRemote(url: string, shown: Catalog, onFresh: (fresh: LoadedCatalog) => void) {
  // Na pozadí nic nespěchá – delší limit i pro pomalé připojení
  const remote = await fetchCatalog(url, 120_000);
  if (!remote) return; // offline – zůstane uložená kopie
  void saveToCache(remote.text);
  if (remote.data.generatedAt !== shown.generatedAt) onFresh({ catalog: remote.data, source: "remote" });
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

async function saveToCache(text: string) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CACHE_URL, new Response(text, { headers: { "Content-Type": "application/json" } }));
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
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}

async function loadRawCatalog(onFresh?: (fresh: LoadedCatalog) => void): Promise<LoadedCatalog> {
  // 1) Vzdálený katalog – při startu s uloženou kopií se stáhne až na pozadí
  if (REMOTE_URL) {
    const cached = onFresh ? await loadFromCache() : null;
    if (cached && onFresh) {
      void refreshFromRemote(REMOTE_URL, cached, onFresh);
      return { catalog: cached, source: "cache" };
    }
    const remote = await fetchCatalog(REMOTE_URL, 15_000);
    if (remote) {
      void saveToCache(remote.text);
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
