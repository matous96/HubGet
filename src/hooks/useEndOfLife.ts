/**
 * Nainstalované runtime a nástroje bez podpory (lib/endOfLife.ts): dotaz na
 * endoflife.date jednou za den pro každý produkt, který je v počítači.
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { endedOn, eolMatch, fetchCycles, newestSupported, type EolCycle, type EolMatch } from "@/lib/endOfLife";
import type { InstalledPackage } from "@/types";
import type { InstalledItem } from "./useInstalledItems";

export interface EndOfLife extends EolMatch {
  /** Datum konce podpory (YYYY-MM-DD). */
  ended: string;
  /** Nejnovější podporovaná řada. */
  newest: EolCycle | null;
}

const DAY_MS = 24 * 60 * 60_000;

function useCycles(products: string[]) {
  return useQueries({
    queries: products.map((product) => ({
      queryKey: ["end-of-life", product],
      queryFn: () => fetchCycles(product),
      staleTime: DAY_MS,
      gcTime: DAY_MS,
      retry: 1,
    })),
    combine: (results) => new Map(products.map((p, i) => [p, results[i]?.data])),
  });
}

/** Konec podpory jedné nainstalované aplikace (detail). */
export function useEndOfLifeOf(pkg: InstalledPackage | undefined): EndOfLife | null {
  const match = pkg && pkg.source === "winget" ? eolMatch(pkg.packageId, pkg.installedVersion) : null;
  const cycles = useCycles(match ? [match.product] : []);
  return useMemo(() => {
    if (!match) return null;
    const list = cycles.get(match.product);
    const ended = endedOn(list, match.cycle);
    return ended ? { ...match, ended, newest: newestSupported(list) } : null;
  }, [match, cycles]);
}

/** Nainstalované aplikace bez podpory (Nainstalované). */
export function useEndOfLife(items: InstalledItem[]): { item: InstalledItem; eol: EndOfLife }[] {
  const matched = useMemo(
    () =>
      items
        .filter((i) => i.pkg.source === "winget")
        .map((item) => ({ item, match: eolMatch(item.pkg.packageId, item.pkg.installedVersion) }))
        .filter((m): m is { item: InstalledItem; match: EolMatch } => m.match !== null),
    [items],
  );
  const products = useMemo(() => [...new Set(matched.map((m) => m.match.product))], [matched]);
  const cycles = useCycles(products);
  return useMemo(
    () =>
      matched.flatMap(({ item, match }) => {
        const list = cycles.get(match.product);
        const ended = endedOn(list, match.cycle);
        return ended ? [{ item, eol: { ...match, ended, newest: newestSupported(list) } }] : [];
      }),
    [matched, cycles],
  );
}
