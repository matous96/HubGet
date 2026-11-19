/**
 * Open-source alternativy k uzavřeným aplikacím (placené, proprietární, freeware):
 * detail aplikace (police „Open-source alternativy“) a Přehled počítače. Kandidáti jsou
 * aplikace s otevřenou licencí ve stejné kategorii, seřazené podle společných štítků
 * (vzácný štítek – „pdf“, „archiver“ – váží víc než obecný jako „tool“); kurátorské
 * alternativy z katalogu (`alternatives`) s otevřenou licencí mají přednost.
 */
import type { CatalogEntry } from "@/types";

export type LicenseKind = "licenseOpen" | "licenseProprietary" | "licenseFree" | null;

/** Druh licence podle textu z katalogu (SPDX, „Proprietary“, „Freeware“…). */
export function licenseKind(license: string | null | undefined): LicenseKind {
  if (!license) return null;
  if (/proprietary|shareware|trial|commercial|eula/i.test(license)) return "licenseProprietary";
  if (/freeware/i.test(license)) return "licenseFree";
  if (/MIT|GPL|GNU|MPL|Apache|BSD|PSF|ISC|Unlicense|Zlib|CC0|EPL|Artistic|WTFPL|EUPL|MS-PL|OFL/i.test(license)) return "licenseOpen";
  return null;
}

/**
 * Uzavřená aplikace, ke které má smysl hledat open-source náhradu. Hry a herní obchody ne –
 * hra náhradu nemá a ke Steamu by se nabízely spouštěče jiných her.
 */
export const isClosed = (entry: CatalogEntry) => {
  if (entry.categories.includes("games")) return false;
  const kind = licenseKind(entry.license);
  return kind === "licenseProprietary" || kind === "licenseFree";
};

const MAX = 4;
/** Nejmenší shoda štítků a podíl nejlepší shody, aby šlo o skutečnou náhradu. */
const MIN_SCORE = 0.3;
const RELATIVE = 0.5;

/** Četnost štítků a aplikace s otevřenou licencí – jednou pro každý katalog (25 000 aplikací). */
const prepared = new WeakMap<CatalogEntry[], { frequency: Map<string, number>; open: CatalogEntry[] }>();

function prepare(catalog: CatalogEntry[]) {
  let data = prepared.get(catalog);
  if (!data) {
    const frequency = new Map<string, number>();
    for (const entry of catalog) for (const tag of entry.tags ?? []) frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
    data = { frequency, open: catalog.filter((e) => e.tags?.length && licenseKind(e.license) === "licenseOpen") };
    prepared.set(catalog, data);
  }
  return data;
}

export function openSourceAlternatives(entry: CatalogEntry, catalog: CatalogEntry[], byId: Map<string, CatalogEntry>): CatalogEntry[] {
  const curated = (entry.alternatives ?? [])
    .map((id) => byId.get(id))
    .filter((p): p is CatalogEntry => !!p && licenseKind(p.license) === "licenseOpen");
  const tags = new Set(entry.tags ?? []);
  const categories = new Set(entry.categories);
  const { frequency, open } = prepare(catalog);
  const scored: { entry: CatalogEntry; score: number }[] = [];
  if (tags.size) {
    for (const candidate of open) {
      if (candidate.id === entry.id || !candidate.categories.some((c) => categories.has(c))) continue;
      let score = 0;
      let shared = 0;
      for (const tag of candidate.tags ?? []) {
        if (!tags.has(tag)) continue;
        shared++;
        score += 1 / Math.log2(2 + (frequency.get(tag) ?? 0));
      }
      if (shared >= 2 && score >= MIN_SCORE) scored.push({ entry: candidate, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.entry.popularity - a.entry.popularity);
  const best = scored[0]?.score ?? 0;
  const matched = scored.filter((s) => s.score >= best * RELATIVE).map((s) => s.entry);
  return [...new Set([...curated, ...matched])].slice(0, MAX);
}
