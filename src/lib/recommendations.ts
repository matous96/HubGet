/**
 * Doporučeno pro vás (components/home/ForYou): police „Protože máte OBS Studio“ s aplikacemi
 * ze stejné kategorie, které uživatel nemá. Počítá se jen místně z nainstalovaných aplikací –
 * nic se nikam neposílá.
 *
 * Výchozí aplikace (seeds): nejdřív ty nainstalované přes HubGet (nejnovější první), pak
 * ostatní nainstalované podle popularity. Každá kategorie jen jednou, ať se police neopakují;
 * kategorie Systém (ovladače, knihovny) se nedoporučuje.
 */
import type { CatalogEntry, CategoryId } from "@/types";

export interface Recommendation {
  /** Nainstalovaná aplikace, podle které police vznikla. */
  seed: CatalogEntry;
  items: CatalogEntry[];
}

/** Kategorie, ze kterých se nedoporučuje (ovladače, běhová prostředí, knihovny). */
const SKIPPED: ReadonlySet<CategoryId> = new Set(["system", "other"]);

export function becauseYouHave(
  seeds: readonly CatalogEntry[],
  all: readonly CatalogEntry[],
  exclude: (entry: CatalogEntry) => boolean,
  { shelves = 3, perShelf = 10, minItems = 4 } = {},
): Recommendation[] {
  const result: Recommendation[] = [];
  const usedCategories = new Set<CategoryId>();
  const shown = new Set<string>();
  for (const seed of seeds) {
    if (result.length >= shelves) break;
    const main = seed.categories[0];
    if (!main || SKIPPED.has(main) || usedCategories.has(main)) continue;
    const seedTags = new Set(seed.tags.map((t) => t.toLowerCase()));
    const items = all
      .filter((e) => e.id !== seed.id && e.categories[0] === main && !shown.has(e.id) && !exclude(e))
      // Víc společných štítků (střih videa, streamování…) = podobnější; jinak popularita
      .map((e) => ({ e, shared: e.tags.reduce((n, t) => n + (seedTags.has(t.toLowerCase()) ? 1 : 0), 0) }))
      .sort((a, b) => b.shared - a.shared || b.e.popularity - a.e.popularity)
      .slice(0, perShelf)
      .map(({ e }) => e);
    if (items.length < minItems) continue;
    usedCategories.add(main);
    for (const item of items) shown.add(item.id);
    result.push({ seed, items });
  }
  return result;
}
