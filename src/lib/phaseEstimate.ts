/**
 * Odhad průběhu fáze, kterou instalátor nehlásí (instalace, odinstalace).
 * Očekávaná délka: jak dlouho stejná fáze u stejného balíčku trvala minule
 * (pamatuje se v localStorage), jinak odhad z velikosti instalátoru v katalogu.
 * Procenta rostou plynule, ke konci zpomalují a 100 % nedosáhnou – skočí
 * na hotovo, až správce operaci opravdu dokončí.
 *
 * Instalace se stahováním ukazuje jedno procento za obě fáze (overallPercent): podíl
 * stahování podle toho, jak dlouho obě fáze trvaly minule (nebo podle velikosti).
 */
import { queryClient, queryKeys } from "@/app/queryClient";
import type { LoadedCatalog } from "@/services/catalog";
import type { Job, OperationPhase } from "@/types";

/** Fáze s odhadem (ostatní buď procenta hlásí, nebo čekají na uživatele). */
export const ESTIMATED_PHASES: ReadonlySet<OperationPhase> = new Set(["installing", "uninstalling"]);

/** Fáze, jejichž skutečná délka se pamatuje (odhad instalace, podíl stahování na celku). */
const RECORDED_PHASES: ReadonlySet<OperationPhase> = new Set(["downloading", "installing", "uninstalling"]);

const STORAGE_KEY = "unibox-phase-durations";
/** Kolik balíčků si pamatovat (nejstarší záznamy odpadnou). */
const MAX_ENTRIES = 300;

const keyOf = (job: Pick<Job, "source" | "packageId">, phase: OperationPhase) => `${job.source}:${job.packageId}:${phase}`;

function readDurations(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Zapamatuje skutečnou délku fáze (průměr s minulou, ať jeden výkyv odhad nerozhodí). */
export function recordPhaseDuration(job: Pick<Job, "source" | "packageId">, phase: OperationPhase, ms: number) {
  if (!RECORDED_PHASES.has(phase) || ms < 1000) return;
  const durations = readDurations();
  const key = keyOf(job, phase);
  const previous = durations[key];
  // Smazat a vložit znovu = záznam na konec (nejnověji použitý)
  delete durations[key];
  durations[key] = Math.round(previous ? (previous + ms) / 2 : ms);
  const keys = Object.keys(durations);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete durations[old];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(durations));
  } catch {
    // Plné nebo nedostupné úložiště – odhad pak vyjde z velikosti
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Očekávaná délka fáze v ms. */
export function expectedPhaseMs(job: Job, phase: OperationPhase): number {
  const known = readDurations()[keyOf(job, phase)];
  if (known) return known;
  const entry = queryClient.getQueryData<LoadedCatalog>(queryKeys.catalog)?.catalog.packages.find((p) => p.id === job.appId);
  const source = entry?.sources.find((s) => s.source === job.source && s.packageId === job.packageId) ?? entry?.sources.find((s) => s.source === job.source);
  // Velikost instalátoru, jinak čtvrtina místa na disku (instalátory bývají komprimované)
  const bytes = source?.size ?? (source?.installedSize ? source.installedSize / 4 : null);
  const mb = bytes ? bytes / 1_000_000 : null;
  if (phase === "uninstalling") return mb === null ? 15_000 : clamp(5_000 + mb * 100, 5_000, 90_000);
  // Stahování zhruba 5 MB/s
  if (phase === "downloading") return mb === null ? 15_000 : clamp(2_000 + mb * 200, 3_000, 300_000);
  return mb === null ? 30_000 : clamp(8_000 + mb * 300, 8_000, 180_000);
}

/** Podíl stahování na celkovém průběhu instalace (0,2–0,8) podle očekávané délky obou fází. */
export function downloadShare(job: Job): number {
  const download = expectedPhaseMs(job, "downloading");
  const install = expectedPhaseMs(job, "installing");
  return clamp(download / (download + install), 0.2, 0.8);
}

/**
 * Jedno procento za stahování i instalaci: stahování vyplní pruh do `share`, instalace zbytek.
 * `phasePercent` = procenta aktuální fáze (hlášená nebo odhad).
 */
export function overallPercent(phase: OperationPhase, phasePercent: number, share: number): number {
  return Math.min(99, Math.round(phase === "downloading" ? phasePercent * share : share * 100 + phasePercent * (1 - share)));
}

/** Odhad procent po `elapsed` ms fáze, která má trvat `expected` ms (v očekávaném čase ~86 %, nejvýš 99 %). */
export function estimatePercent(elapsed: number, expected: number): number {
  return Math.min(99, Math.floor(99 * (1 - Math.exp((-2 * elapsed) / expected))));
}
