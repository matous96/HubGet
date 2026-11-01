/**
 * Kategorie, které mají aplikace. V Kategoriích, postranním panelu a Nejstahovanějších
 * se prázdné neukazují – katalog, který nové kategorie ještě nezná (vydání aplikace
 * předběhne denní katalog), nebo zamčený zdroj, který v kategorii nic nemá.
 */
import { useMemo } from "react";
import { useSortedCategories, type CategoryDef } from "@/data/categories";
import type { LoadedCatalog } from "@/services/catalog";
import { inLockedSource, useSourceScope } from "@/store/sourceLock";
import { useCatalog } from "./usePackages";

// Počty pro každý katalog a zamčený zdroj – sdílí je všechny komponenty (25 000 aplikací se nepočítá znovu)
const cache = new WeakMap<LoadedCatalog, Map<string, Map<string, number>>>();

/** Počet aplikací v každé kategorii (při zamčeném zdroji jen z něj; bez kategorie = Ostatní). */
export function useCategoryCounts(): Map<string, number> | undefined {
  const { data } = useCatalog();
  const { lock } = useSourceScope();
  if (!data) return undefined;
  let byLock = cache.get(data);
  if (!byLock) cache.set(data, (byLock = new Map()));
  let counts = byLock.get(lock ?? "");
  if (!counts) {
    counts = new Map();
    for (const p of data.catalog.packages) {
      if (!inLockedSource(p, lock)) continue;
      for (const c of p.categories.length ? p.categories : ["other"]) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    byLock.set(lock ?? "", counts);
  }
  return counts;
}

/** Seřazené kategorie bez prázdných (dokud se katalog načítá, všechny). */
export function useVisibleCategories(): CategoryDef[] {
  const categories = useSortedCategories();
  const counts = useCategoryCounts();
  return useMemo(() => (counts ? categories.filter((c) => (counts.get(c.id) ?? 0) > 0) : categories), [categories, counts]);
}
