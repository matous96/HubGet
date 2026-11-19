/**
 * Bezpečnostní aktualizace:
 *  - podle poznámek k verzi z katalogu – zmínka o CVE, opravě bezpečnostní chyby či
 *    zranitelnosti („Security fixes“, „fixed a security issue“, „vulnerability“…),
 *  - u balíčků režimu Vývojář (npm, Bun, pip, Cargo, .NET Tool) podle známých zranitelností
 *    nainstalované verze z OSV.dev (zdarma, open source, jen po zapnutí v Nastavení – posílá
 *    se tam název a verze balíčku; store/vulnerabilities.ts).
 * Bezpečnostní aktualizace jsou v Dostupných aktualizacích první, se štítkem a (podle
 * Nastavení) bez čekání na minimální stáří aktualizací (store/updateRules.ts).
 */
import type { LoadedCatalog } from "@/services/catalog";
import type { InstalledPackage, SourceId } from "@/types";

/**
 * Text poznámek, který mluví o bezpečnostní opravě. Jen jednoznačné obraty – samotné
 * „security“ bývá i v „Windows Security“ nebo „security key support“.
 */
const SECURITY_RE = new RegExp(
  [
    String.raw`\bCVE-\d{4}-\d{4,}`,
    String.raw`\bGHSA(?:-[23456789cfghjmpqrvwx]{4}){3}\b`,
    String.raw`\bsecurity[ -](?:fix|fixes|fixed|update|updates|release|issue|issues|patch|patches|bug|bugs|advisory|advisories|vulnerabilit\w*|problem|problems|flaw|flaws|hole|holes)\b`,
    String.raw`\bfix(?:es|ed)? (?:a |an |several |multiple |some |two |three )?(?:critical |important |potential )?security\b`,
    // „vulnerability“ jen s opravou – nástroje pro audit ho mají i v popisu nových funkcí
    String.raw`\b(?:fix|fixed|fixes|fixing|address|addresses|addressed|addressing|resolv\w*|patch\w*|remediat\w*|mitigat\w*)\b[^.\n]{0,60}\bvulnerabilit`,
    String.raw`\bvulnerabilit(?:y|ies)\b[^.\n]{0,40}\b(?:fix|fixed|resolved|patched|addressed|remediated)\b`,
    String.raw`\bzranitelnost`,
    String.raw`\bbezpečnostní (?:oprav|chyb|aktualizac|problém)`,
    String.raw`\bSicherheits(?:lücke|update|problem|fix)`,
  ].join("|"),
  "i",
);

export const isSecurityNote = (text: string | null | undefined) => !!text && SECURITY_RE.test(text);

/** „zdroj:id balíčku“ → verze, jejíž poznámky mluví o bezpečnostní opravě (nejnovější verze z katalogu). */
const indexes = new WeakMap<LoadedCatalog, Map<string, string>>();

function securityIndex(catalog: LoadedCatalog) {
  let index = indexes.get(catalog);
  if (!index) {
    index = new Map();
    for (const entry of catalog.catalog.packages) {
      if (!entry.latestVersion || !isSecurityNote(entry.releaseNotes)) continue;
      for (const s of entry.sources) if (s.version === entry.latestVersion) index.set(`${s.source}:${s.packageId}`, s.version);
    }
    indexes.set(catalog, index);
  }
  return index;
}

/** Nabízená verze podle poznámek z katalogu opravuje bezpečnostní chybu. */
export function isSecurityRelease(catalog: LoadedCatalog | undefined, pkg: Pick<InstalledPackage, "source" | "packageId">, version: string) {
  return !!catalog && securityIndex(catalog).get(`${pkg.source}:${pkg.packageId}`) === version;
}

/** Ekosystém OSV.dev pro správce režimu Vývojář (ostatní OSV nezná). */
export const OSV_ECOSYSTEMS: Partial<Record<SourceId, string>> = {
  npm: "npm",
  bun: "npm",
  pip: "PyPI",
  cargo: "crates.io",
  dotnet: "NuGet",
};

export interface OsvFinding {
  version: string;
  /** Id zranitelností (GHSA-…, PYSEC-…, RUSTSEC-…), seřazená, nejvýš 20. */
  ids: string[];
}

const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
/** OSV přijme nejvýš 1 000 dotazů najednou. */
const OSV_CHUNK = 1000;

/**
 * Známé zranitelnosti nainstalovaných verzí (klíč „zdroj:id balíčku“). Balíčky bez
 * nálezu ve výsledku nejsou. Chyba sítě = výjimka (volající zkusí později).
 */
export async function queryOsv(packages: Pick<InstalledPackage, "source" | "packageId" | "installedVersion">[]): Promise<Record<string, OsvFinding>> {
  const wanted = packages.filter((p) => OSV_ECOSYSTEMS[p.source] && p.installedVersion && /^\d/.test(p.installedVersion));
  const found: Record<string, OsvFinding> = {};
  for (let start = 0; start < wanted.length; start += OSV_CHUNK) {
    const chunk = wanted.slice(start, start + OSV_CHUNK);
    const response = await fetch(OSV_BATCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: chunk.map((p) => ({ package: { name: p.packageId, ecosystem: OSV_ECOSYSTEMS[p.source] }, version: p.installedVersion })),
      }),
    });
    if (!response.ok) throw new Error(`OSV.dev: HTTP ${response.status}`);
    const data = (await response.json()) as { results?: { vulns?: { id: string }[] }[] };
    (data.results ?? []).forEach((result, i) => {
      const ids = [...new Set((result.vulns ?? []).map((v) => v.id))].sort().slice(0, 20);
      const pkg = chunk[i];
      if (ids.length && pkg) found[`${pkg.source}:${pkg.packageId}`] = { version: pkg.installedVersion, ids };
    });
  }
  return found;
}

/** Odkaz na popis zranitelnosti. */
export const osvUrl = (id: string) => `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
