/**
 * Porovnání aplikací vedle sebe (stránka Porovnat, /compare): údaje z katalogu shrnuté
 * přes všechny zdroje instalace a výběr nejlepší hodnoty v řádku (nejmenší instalátor,
 * nejnovější vydání, nejvíc hvězdiček…). Nejlepší se vyznačí jen tam, kde ji jde určit:
 * aspoň dvě aplikace s údajem a jedna jasně vede (žádná shoda na prvním místě).
 */
import type { Arch, CatalogEntry, SourceId } from "@/types";
import { licenseKind, type LicenseKind } from "./alternatives";

/** Nejvíc aplikací v porovnání (víc sloupců se do okna rozumně nevejde). */
export const COMPARE_MAX = 4;

export interface CompareFacts {
  /** Nejmenší instalátor ze zdrojů (bajty). */
  size: number | null;
  /** Místo na disku po instalaci (bajty, největší udaný údaj). */
  installedSize: number | null;
  architectures: Arch[];
  sources: SourceId[];
  /** Datum vydání nejnovější verze (ISO). */
  releaseDate: string | null;
  license: LicenseKind;
  /** Nejnižší minimální verze Windows ze zdrojů („10.0.17763.0“). */
  minOs: string | null;
}

const ARCH_ORDER: Arch[] = ["x64", "arm64", "x86"];

function minVersion(versions: string[]): string | null {
  const parse = (v: string) => v.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return (
    [...versions].sort((a, b) => {
      const [pa, pb] = [parse(a), parse(b)];
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
      return 0;
    })[0] ?? null
  );
}

export function compareFacts(entry: CatalogEntry): CompareFacts {
  const sizes = entry.sources.map((s) => s.size).filter((n): n is number => typeof n === "number" && n > 0);
  const installed = entry.sources.map((s) => s.installedSize).filter((n): n is number => typeof n === "number" && n > 0);
  const archs = new Set(entry.sources.flatMap((s) => s.architectures ?? []));
  return {
    size: sizes.length ? Math.min(...sizes) : null,
    installedSize: installed.length ? Math.max(...installed) : null,
    architectures: ARCH_ORDER.filter((a) => archs.has(a)),
    sources: [...new Set(entry.sources.map((s) => s.source))],
    releaseDate: entry.releaseDate ?? null,
    license: licenseKind(entry.license),
    minOs: minVersion(entry.sources.map((s) => s.minOsVersion).filter((v): v is string => !!v)),
  };
}

/**
 * Index nejlepší hodnoty (`higher` = víc je lépe), nebo null: méně než dvě hodnoty,
 * nebo shoda na prvním místě.
 */
export function bestIndex(values: readonly (number | null | undefined)[], higher: boolean): number | null {
  const known = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === "number" && Number.isFinite(x.v));
  if (known.length < 2) return null;
  const sorted = [...known].sort((a, b) => (higher ? b.v - a.v : a.v - b.v));
  return sorted[0].v === sorted[1].v ? null : sorted[0].i;
}
