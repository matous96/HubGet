/**
 * Vstupní bod vrstvy správců balíčků: výběr implementace a souhrnné
 * operace přes všechny zapnuté správce (nainstalované, vyhledávání).
 */
import { installedNameKey } from "@/lib/nameKey";
import { isTauri } from "@/lib/tauri";
import i18n from "@/i18n";
import { useInstalledVia, viaKey } from "@/store/installedVia";
import { useInstallSeen } from "@/store/installSeen";
import { useListFailures } from "@/store/listFailures";
import { useToasts } from "@/store/toasts";
import type { InstalledPackage, RepoSearchResult, SourceId } from "@/types";
import { chocoManager } from "./choco";
import { devManager } from "./dev";
import { withLogging } from "./logging";
import { mockManagers } from "./mock";
import { scoopManager } from "./scoop";
import { getSource } from "./sources";
import type { PackageManager } from "./types";
import { wingetManager } from "./winget";

export * from "./sources";
export type { CacheInfo, OperationHandle, OperationRequest, OperationResult, PackageManager } from "./types";
export { refreshChocoOutdated } from "./choco";
export { refreshScoopBuckets } from "./scoop";

/** Běží aplikace uvnitř Tauri (ne v obyčejném prohlížeči)? */
export { isTauri };

/** Správci aplikací v desktopové aplikaci; správci pro vývojáře mají společnou implementaci (dev.ts). */
const DESKTOP: Partial<Record<SourceId, PackageManager>> = { winget: wingetManager, chocolatey: chocoManager, scoop: scoopManager };

/**
 * Implementace jednotlivých správců (s protokolováním): ve webové verzi
 * ukázkové, v desktopové aplikaci skutečné.
 */
export const managers = Object.fromEntries(
  Object.entries(mockManagers).map(([id, mock]) => {
    const source = id as SourceId;
    if (!isTauri()) return [id, withLogging(mock)];
    return [id, withLogging(DESKTOP[source] ?? devManager(source))];
  }),
) as Record<SourceId, PackageManager>;

/** Kdy se naposledy oznámilo selhání správce (výpis nainstalovaných) – stejné nejvýš jednou za 10 minut. */
const failureReported = new Map<SourceId, number>();

/** Správce nevrátil seznam nainstalovaných (neodpovídá, nečekaný výstup…) – oznámit, ne mlčky vynechat. */
function reportListFailure(source: SourceId, reason: unknown) {
  const now = Date.now();
  if ((failureReported.get(source) ?? 0) > now - 10 * 60_000) return;
  failureReported.set(source, now);
  const error = reason instanceof Error ? reason.message : String(reason);
  console.warn(`Výpis nainstalovaných (${source}) selhal:`, reason);
  useToasts.getState().push("error", i18n.t("managerError.listFailed", { name: getSource(source).label, error }));
}

/**
 * Nainstalované balíčky ze všech zapnutých správců (chyba jednoho neshodí
 * ostatní – jen se oznámí). Programy nalezené jen podle složky na disku jsou
 * na konci – při párování s katalogem mají nejnižší přednost.
 */
export async function getAllInstalled(enabled: SourceId[]): Promise<InstalledPackage[]> {
  const results = await Promise.allSettled(enabled.map((id) => managers[id].getInstalled()));
  results.forEach((result, i) => {
    if (result.status === "rejected") reportListFailure(enabled[i], result.reason);
  });
  useListFailures.setState({ sources: enabled.filter((_, i) => results[i].status === "rejected") });
  const via = new Set(useInstalledVia.getState().keys);
  const merged = mergeChocolatey(results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])), via);
  // Kdy se který balíček objevil – řazení Nově nainstalované
  useInstallSeen.getState().observe(merged);
  return [...merged.filter((p) => !p.diskLocation), ...merged.filter((p) => p.diskLocation)];
}

/** Klíče, pod kterými winget program zná: název a poslední část id („Mozilla.Thunderbird“, „ARP\…\Spotify“). */
function wingetKeys(p: InstalledPackage): string[] {
  const idTail = p.packageId.split(/[.\\]/).pop() ?? "";
  return [installedNameKey(p.name), installedNameKey(idTail)].filter((key) => key.length >= 2);
}

/**
 * Chocolatey a winget často vidí stejný program (Chocolatey spouští běžné
 * instalátory, winget čte registr Windows) – v seznamu má být jednou:
 *  - přenosný balíček Chocolatey zůstane, jen když ho winget nevidí,
 *  - balíček s instalátorem musí winget vidět v registru – jinak byl program
 *    mezitím odinstalován jinak a záznam Chocolatey je zastaralý. Když ho
 *    winget zná jen jako záznam registru (bez vlastního balíčku), nebo ho HubGet
 *    nainstaloval přes Chocolatey (store/installedVia), ukáže se pod Chocolatey;
 *    jinak zůstane winget.
 * Shoda: název nebo id balíčku („thunderbird“) odpovídá názvu či id u wingetu,
 * případně jeho začátku nebo konci („TeamSpeak 3 Client“).
 */
function mergeChocolatey(list: InstalledPackage[], via: Set<string>): InstalledPackage[] {
  // Programy nalezené jen na disku winget nezná – o balíčcích Chocolatey nerozhodují
  const winget = list.filter((p) => p.source === "winget" && !p.diskLocation).map((p) => ({ p, keys: wingetKeys(p) }));
  const matching = (c: InstalledPackage) => {
    const keys = [installedNameKey(c.name), installedNameKey(c.packageId.replace(/\.(install|portable)$/i, ""))].filter((k) => k.length >= 2);
    return winget.find((w) => keys.some((k) => w.keys.includes(k) || (k.length >= 5 && w.keys.some((wk) => wk.startsWith(k) || wk.endsWith(k)))))?.p;
  };
  const dropped = new Set<InstalledPackage>();
  for (const c of list.filter((p) => p.source === "chocolatey")) {
    const match = matching(c);
    if (!c.installer) {
      if (match) dropped.add(c);
    } else if (!match) {
      dropped.add(c);
    } else if (match.origin === "local" || via.has(viaKey("chocolatey", c.packageId))) {
      dropped.add(match);
    } else {
      dropped.add(c);
    }
  }
  return list.filter((p) => !dropped.has(p));
}

/** Vyhledávání ve všech zapnutých správcích současně. */
export async function searchAll(query: string, enabled: SourceId[], signal?: AbortSignal): Promise<RepoSearchResult[]> {
  const results = await Promise.allSettled(enabled.map((id) => managers[id].search(query, signal)));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
