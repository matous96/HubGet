/**
 * Datová pipeline HubGetu – sestaví catalog.json ze skutečných zdrojů:
 * winget (CDN Microsoftu), Chocolatey Community Repository a buckety Scoopu.
 *
 * Spuštění:  pnpm pipeline [--details N|all] [--sizes N] [--limit N] [--local]
 * Podrobnosti v data-pipeline/README.md.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OUT_DIR, ROOT_DIR } from "./config.ts";
import { buildCatalog } from "./build/catalog.ts";
import { dedupeWinget, pairSources } from "./build/match.ts";
import { upscaleSmallIcons } from "./build/upscale.ts";
import { stats } from "./lib/http.ts";
import { log } from "./lib/log.ts";
import { reportMetric, writeReport } from "./lib/report.ts";
import { githubRepoOf } from "../../src/lib/github.ts";
import { loadChocolatey } from "./sources/chocolatey.ts";
import { loadGithubStars } from "./sources/github.ts";
import { loadRegistryCounts } from "./sources/registries.ts";
import { loadScoopBuckets } from "./sources/scoop.ts";
import { loadUnigetData } from "./sources/unigetui.ts";
import { loadWingetIndex, loadWingetSites } from "./sources/winget.ts";

/** Parametry příkazové řádky („--details 500“, „--local“). */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : "true";
}
const num = (name: string, fallback: number) => {
  const value = arg(name);
  if (value === "all") return Number.POSITIVE_INFINITY;
  return value && value !== "true" ? Number(value) : fallback;
};

const options = {
  details: num("details", 2500),
  // Popis, štítky a vydavatel z manifestu i u ostatních balíčků wingetu – bez nich se
  // většina nezařadí do kategorie (manifesty se ukládají natrvalo, stahují se jen nové verze)
  descriptions: num("descriptions", Number.POSITIVE_INFINITY),
  sizes: num("sizes", 300),
  limit: arg("limit") ? num("limit", 0) : undefined,
};

log.step("winget – index balíčků");
const wingetAll = await loadWingetIndex();
const { entries: winget, variants: wingetVariants } = dedupeWinget(wingetAll);
log.info(
  `winget: ${wingetAll.length} balíčků – ${winget.length} karet, ${wingetAll.length - winget.length} variant (jazyk, typ instalátoru) u karty základního balíčku`,
);

log.step("Scoop – buckety");
const scoop = arg("skip-scoop") ? { packages: [], total: 0 } : await loadScoopBuckets();

log.step("Chocolatey – Community Repository");
const choco = arg("skip-choco") ? { packages: [], total: 0 } : await loadChocolatey();

log.step("Registry pro vývojáře – počty balíčků");
const registryCounts = await loadRegistryCounts();

log.step("Ikony a screenshoty – databáze UniGetUI");
const uniget = await loadUnigetData();

log.step("Párování balíčků do karet aplikací");
// Weby z manifestů wingetu rozhodnou mezi stejně pojmenovanými aplikacemi různých vlastníků
const wingetSites = await loadWingetSites(winget);
const records = pairSources(winget, choco.packages, scoop.packages, wingetVariants, wingetSites);
const paired = {
  all3: records.filter((r) => r.winget && r.choco && r.scoop).length,
  wingetChoco: records.filter((r) => r.winget && r.choco).length,
  wingetScoop: records.filter((r) => r.winget && r.scoop).length,
};
log.info(
  `${records.length} aplikací · winget+Chocolatey ${paired.wingetChoco} · winget+Scoop ${paired.wingetScoop} · ve všech třech ${paired.all3}`,
);

log.step("Sestavení katalogu");
const catalog = await buildCatalog(
  records,
  // Počty za celé repozitáře – u wingetu všechny balíčky včetně variant (jsou dostupné v kartách)
  { winget: wingetAll.length, chocolatey: choco.total, scoop: scoop.total, ...registryCounts },
  options,
  uniget,
);

log.step("GitHub – hvězdičky repozitářů");
const repoOf = new Map(catalog.packages.map((p) => [p, githubRepoOf(p)]));
const githubStars = await loadGithubStars([...new Set([...repoOf.values()].filter((r): r is string => !!r))]);
for (const [entry, repo] of repoOf) {
  const stars = repo ? githubStars.get(repo) : undefined;
  if (stars !== undefined && stars !== null) entry.githubStars = stars;
}
log.info(`hvězdičky: ${catalog.packages.filter((p) => p.githubStars !== undefined).length} aplikací z ${githubStars.size} repozitářů`);

log.step("Zvětšení malých ikon");
try {
  await upscaleSmallIcons(catalog.packages);
} catch (error) {
  // Bez zvětšení zůstanou původní ikony – katalog se zveřejní i tak
  log.warn(`zvětšení ikon selhalo: ${error instanceof Error ? error.message : error}`);
}

await mkdir(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, "catalog.json");
const json = arg("pretty") ? JSON.stringify(catalog, null, 2) : JSON.stringify(catalog);
await writeFile(outFile, json);
log.step(`Hotovo: ${outFile}`);
log.info(`${catalog.packages.length} aplikací, ${(json.length / 1e6).toFixed(1)} MB`);
log.info(`ikony: ${catalog.packages.filter((p) => p.iconUrl).length} z ${catalog.packages.length} aplikací`);
const withScreenshots = catalog.packages.filter((p) => p.screenshots?.length);
log.info(
  `screenshoty: ${withScreenshots.length} aplikací, ${withScreenshots.reduce((n, p) => n + (p.screenshots?.length ?? 0), 0)} obrázků`,
);
log.info(
  `HTTP: ${stats.requests} požadavků, ${stats.cacheHits} z mezipaměti, ${stats.notModified}× beze změny (304), ` +
    `${(stats.downloadedBytes / 1e6).toFixed(1)} MB staženo, ${stats.retries} opakování`,
);
reportMetric("catalog", {
  packages: catalog.packages.length,
  webOnly: catalog.webOnly?.length ?? 0,
  icons: catalog.packages.filter((p) => p.iconUrl).length,
  screenshots: withScreenshots.length,
  megabytes: Number((json.length / 1e6).toFixed(1)),
});
reportMetric("http", { ...stats });
await writeReport(join(OUT_DIR, "report.json"), catalog.generatedAt);

// --local: zkopírovat do public/, odkud ho načte vývojový server aplikace
if (arg("local")) {
  const target = join(ROOT_DIR, "public", "catalog.json");
  await copyFile(outFile, target);
  log.info(`zkopírováno do ${target} – aplikace ho při pnpm dev načte místo ukázkového katalogu`);
}
