/**
 * Zdroj winget – stejná data, jaká používá samotný winget:
 *  1. index všech balíčků (source.msix → Public/index.db, SQLite) z CDN Microsoftu,
 *     stahuje se jen při změně (ETag),
 *  2. sloučené manifesty jednotlivých verzí (YAML) z téže CDN – adresa obsahuje
 *     hash obsahu, takže se stahují jen jednou a pak se berou z mezipaměti.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CACHE_DIR, MAX_AGE, WINGET_CDN, WINGET_INDEX_URL } from "../config.ts";
import { readZip } from "../lib/archive.ts";
import { cachedFetch, Limiter, mapLimit } from "../lib/http.ts";
import { log, progress } from "../lib/log.ts";
import { compareVersions } from "../lib/text.ts";

/** Balíček z indexu (nejnovější verze). */
export interface WingetIndexEntry {
  id: string;
  name: string;
  version: string;
  moniker: string | null;
  tags: string[];
  /** Normalizovaný vydavatel z indexu (malá písmena bez interpunkce). */
  publisherNorm: string | null;
  /** Relativní cesta k manifestu na CDN. */
  manifestPath: string;
}

export async function loadWingetIndex(): Promise<WingetIndexEntry[]> {
  const res = await cachedFetch(WINGET_INDEX_URL, { maxAge: MAX_AGE.wingetIndex });
  if (res.status !== 200) throw new Error(`winget index: ${res.status}`);
  log.info(`index wingetu ${(res.body.length / 1e6).toFixed(1)} MB ${res.fromCache ? "(beze změny)" : "(stažen)"}`);

  // SQLite potřebuje soubor – index.db se rozbalí do mezipaměti
  const db = readZip(res.body, (name) => name === "Public/index.db").get("Public/index.db");
  if (!db) throw new Error("winget index: v balíčku chybí Public/index.db");
  await mkdir(CACHE_DIR, { recursive: true });
  const dbPath = join(CACHE_DIR, "winget-index.db");
  await writeFile(dbPath, db);

  const sql = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // Strom částí cest k manifestům (rowid → rodič + část)
    const parts = new Map<number, { parent: number | null; part: string }>();
    for (const row of sql.prepare("SELECT rowid, parent, pathpart FROM pathparts").all() as { rowid: number; parent: number | null; pathpart: string }[]) {
      parts.set(row.rowid, { parent: row.parent, part: row.pathpart });
    }
    const pathOf = (rowid: number) => {
      const out: string[] = [];
      for (let r: number | null = rowid; r != null; ) {
        const p = parts.get(r);
        if (!p) break;
        out.unshift(p.part);
        r = p.parent;
      }
      return out.join("/");
    };

    // Všechny verze všech balíčků → pro každý balíček nejnovější
    const rows = sql
      .prepare(
        `SELECT m.rowid AS manifest, i.id AS id, n.name AS name, v.version AS version, mo.moniker AS moniker, m.pathpart AS pathpart
         FROM manifest m
         JOIN ids i ON i.rowid = m.id
         JOIN names n ON n.rowid = m.name
         JOIN versions v ON v.rowid = m.version
         LEFT JOIN monikers mo ON mo.rowid = m.moniker`,
      )
      .all() as { manifest: number; id: string; name: string; version: string; moniker: string | null; pathpart: number }[];

    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = latest.get(row.id);
      if (!current || compareVersions(row.version, current.version) > 0) latest.set(row.id, row);
    }

    // Štítky a vydavatelé k vybraným manifestům
    const tagsOf = sql.prepare("SELECT t.tag AS tag FROM tags_map tm JOIN tags t ON t.rowid = tm.tag WHERE tm.manifest = ?");
    const publisherOf = sql.prepare(
      "SELECT p.norm_publisher AS publisher FROM norm_publishers_map pm JOIN norm_publishers p ON p.rowid = pm.norm_publisher WHERE pm.manifest = ? LIMIT 1",
    );

    const entries: WingetIndexEntry[] = [];
    for (const row of latest.values()) {
      entries.push({
        id: row.id,
        name: row.name,
        version: row.version,
        moniker: row.moniker || null,
        tags: (tagsOf.all(row.manifest) as { tag: string }[]).map((t) => t.tag.toLowerCase()),
        publisherNorm: (publisherOf.get(row.manifest) as { publisher: string } | undefined)?.publisher ?? null,
        manifestPath: pathOf(row.pathpart),
      });
    }
    return entries;
  } finally {
    sql.close();
  }
}

/** Údaje z manifestu, které HubGet používá (sloučený manifest – výchozí jazyk). */
export interface WingetManifest {
  PackageName?: string;
  Publisher?: string;
  ShortDescription?: string;
  Description?: string;
  License?: string;
  PackageUrl?: string;
  PublisherUrl?: string;
  PublisherSupportUrl?: string;
  PrivacyUrl?: string;
  ReleaseNotes?: string;
  ReleaseNotesUrl?: string;
  ReleaseDate?: string | Date;
  Tags?: string[];
  Icons?: { IconUrl: string; IconFileType?: string; IconResolution?: string; IconTheme?: string }[];
  Documentations?: { DocumentLabel?: string; DocumentUrl?: string }[];
  InstallerType?: string;
  Scope?: string;
  MinimumOSVersion?: string;
  Dependencies?: WingetDependencies;
  Installers?: WingetInstaller[];
}

export interface WingetDependencies {
  PackageDependencies?: { PackageIdentifier: string; MinimumVersion?: string }[];
  WindowsFeatures?: string[];
}

export interface WingetInstaller {
  Architecture?: string;
  InstallerType?: string;
  NestedInstallerType?: string;
  Scope?: string;
  InstallerUrl?: string;
  InstallerSha256?: string;
  MinimumOSVersion?: string;
  Dependencies?: WingetDependencies;
}

const cdnLimiter = new Limiter(16);

/** Stáhne a přečte manifest (null, když ho CDN nemá nebo nejde přečíst). */
export async function loadWingetManifest(entry: WingetIndexEntry): Promise<WingetManifest | null> {
  const res = await cachedFetch(`${WINGET_CDN}/${entry.manifestPath}`, { maxAge: MAX_AGE.wingetManifest, limiter: cdnLimiter });
  if (res.status !== 200) return null;
  try {
    // Data (ReleaseDate) a čísla verzí ponechat jako text
    return parseYaml(res.body.toString("utf8"), { schema: "failsafe" }) as WingetManifest;
  } catch (error) {
    log.warn(`manifest ${entry.id}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Weby balíčků z manifestů (PackageUrl, PublisherUrl) podle id malými písmeny – při
 * párování s Chocolatey a Scoopem rozhodnou mezi stejně pojmenovanými aplikacemi
 * (build/match.ts). Manifesty se stejně čtou kvůli popisům, jsou v mezipaměti.
 */
export async function loadWingetSites(entries: WingetIndexEntry[]): Promise<Map<string, string[]>> {
  const sites = new Map<string, string[]>();
  const tick = progress("weby z manifestů", entries.length);
  await mapLimit(entries, 16, async (entry) => {
    const m = await loadWingetManifest(entry);
    const urls = [m?.PackageUrl, m?.PublisherUrl].filter((url): url is string => !!url);
    if (urls.length) sites.set(entry.id.toLowerCase(), urls);
    tick();
  });
  return sites;
}
