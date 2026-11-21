/**
 * Spolehlivost verzí od komunity (Nastavení → Aktualizace balíčků, výchozí vypnuto;
 * Supabase – supabase/migrations/20261120120000_update_reports.sql):
 *  - po aktualizaci HubGet anonymně nahlásí výsledek (povedla se / selhala chybou
 *    instalátoru / uživatel ji vrátil na předchozí verzi) – zdroj, id balíčku, verze
 *    a náhodné id této instalace HubGetu, nic dalšího,
 *  - pro nabízené aktualizace stáhne souhrn (components/package/ReliabilityWatcher.tsx):
 *    verze, se kterou má problém aspoň WARN_SHARE hlášení, dostane v Dostupných
 *    aktualizacích varování; od HOLD_REPORTS hlášení a HOLD_SHARE problémů ji automatické
 *    aktualizace přeskočí (ručně jde nainstalovat vždy, bezpečnostní aktualizace nikdy nečeká).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "@/services/supabase";
import type { OperationResult } from "@/services/managers";
import type { InstalledPackage, Job, SourceId } from "@/types";
import { useAutoUpdates } from "./autoUpdates";

export interface Reliability {
  reports: number;
  failed: number;
  rolledBack: number;
}

/** Varování od podílu problémů (souhrn přichází až od 5 hlášení – databáze). */
export const WARN_SHARE = 0.1;
/** Automatická aktualizace počká od tolika hlášení a podílu problémů. */
export const HOLD_REPORTS = 10;
export const HOLD_SHARE = 0.25;
/** Souhrn se obnoví po této době. */
export const FETCH_INTERVAL = 6 * 60 * 60_000;

export const reliabilityKey = (source: SourceId, packageId: string, version: string) => `${source}|${packageId}|${version}`;

interface ReliabilityState {
  /** Náhodné id této instalace HubGetu (vznikne s prvním hlášením). */
  reporter: string | null;
  /** Souhrn podle klíče „zdroj|id|verze“ (jen verze s dost hlášeními). */
  data: Record<string, Reliability>;
  fetchedAt: number | null;
  signature: string | null;
}

export const useReliability = create<ReliabilityState>()(
  persist(() => ({ reporter: null, data: {}, fetchedAt: null, signature: null }) as ReliabilityState, { name: "unibox-reliability" }),
);

/** Funkce je k dispozici (HubGet s nastaveným Supabase). */
export const reliabilityAvailable = () => !!supabase;

export const problemShare = (r: Reliability) => (r.reports ? (r.failed + r.rolledBack) / r.reports : 0);

/** Souhrn nabízené verze, když je co hlásit (aspoň WARN_SHARE problémů). */
export function reliabilityWarning(data: Record<string, Reliability>, pkg: InstalledPackage, version = pkg.availableVersion) {
  if (!version) return undefined;
  const r = data[reliabilityKey(pkg.source, pkg.packageId, version)];
  return r && problemShare(r) >= WARN_SHARE ? r : undefined;
}

/** Automatické aktualizace verzi přeskočí (dost hlášení a problémů). */
export function holdByCommunity(pkg: InstalledPackage) {
  if (!useAutoUpdates.getState().communityReliability || !pkg.availableVersion) return false;
  const r = useReliability.getState().data[reliabilityKey(pkg.source, pkg.packageId, pkg.availableVersion)];
  return !!r && r.reports >= HOLD_REPORTS && problemShare(r) >= HOLD_SHARE;
}

/** Chyby, které vypovídají o verzi (vadný instalátor, odkaz…), ne o počítači (síť, běžící aplikace…). */
const VERSION_ERRORS = new Set(["installerFailed", "hashMismatch", "linkBroken", "noInstaller", "dependencies", "unknown"]);

/** Náhodné id této instalace HubGetu pro anonymní hlášení (spolehlivost verzí, žebříček instalací). */
export function communityReporter(): string {
  let reporter = useReliability.getState().reporter;
  if (!reporter) {
    reporter = crypto.randomUUID();
    useReliability.setState({ reporter });
  }
  return reporter;
}

function report(source: SourceId, packageId: string, version: string, outcome: "success" | "failed" | "rolledBack") {
  if (!supabase) return;
  const reporter = communityReporter();
  void supabase
    .rpc("report_update_outcome", { p_source: source, p_package_id: packageId, p_version: version, p_outcome: outcome, p_reporter: reporter })
    .then(undefined, () => undefined);
}

/**
 * Výsledek dokončené operace (store/jobs.ts): aktualizace na `target`, nebo vrácení
 * aktualizace (instalace starší verze se `skipVersion` = vrácená verze).
 */
export function reportJobOutcome(job: Job, result: OperationResult, target: string | undefined) {
  if (!useAutoUpdates.getState().communityReliability || !supabase) return;
  if (job.kind === "install" && job.replaceInstalled && job.skipVersion) {
    if (result.outcome === "success") report(job.source, job.packageId, job.skipVersion, "rolledBack");
    return;
  }
  if (job.kind !== "update" || !target) return;
  if (result.outcome === "success") report(job.source, job.packageId, target, "success");
  else if (result.outcome === "error" && VERSION_ERRORS.has(result.errorKey ?? "unknown")) report(job.source, job.packageId, target, "failed");
}

/** Souhrn pro nabízené verze (nejvýš 500 najednou – databáze). */
export async function fetchReliability(packages: InstalledPackage[], signature: string) {
  if (!supabase) return;
  const keys = [...new Set(packages.flatMap((p) => {
    const version = p.availableVersion ?? p.heldVersion;
    return version ? [reliabilityKey(p.source, p.packageId, version)] : [];
  }))].slice(0, 500);
  if (!keys.length) {
    useReliability.setState({ data: {}, fetchedAt: Date.now(), signature });
    return;
  }
  const { data, error } = await supabase.rpc("update_reliability", { p_keys: keys });
  if (error) throw error;
  const rows = (data ?? []) as { source: SourceId; package_id: string; version: string; reports: number; failed: number; rolled_back: number }[];
  useReliability.setState({
    data: Object.fromEntries(rows.map((r) => [reliabilityKey(r.source, r.package_id, r.version), { reports: r.reports, failed: r.failed, rolledBack: r.rolled_back }])),
    fetchedAt: Date.now(),
    signature,
  });
}
