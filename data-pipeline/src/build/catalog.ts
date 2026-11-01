/**
 * Sestavení katalogu (catalog.json, schéma 2) ze spárovaných záznamů:
 * popularita, podrobnosti z manifestů wingetu, ikony, kategorie,
 * velikosti instalátorů a souhrnné statistiky.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Arch,
  Catalog,
  CatalogEntry,
  CategoryId,
  Dependency,
  InstallerFeature,
  InstallerType,
  InstallScope,
  PackageSource,
  ScreenshotSource,
  SourceId,
} from "../../../src/types/index.ts";
import { CACHE_DIR, MAX_AGE, MAX_SCREENSHOTS, PIPELINE_DIR } from "../config.ts";
import { cachedFetch, Limiter, mapLimit } from "../lib/http.ts";
import { fixDeadCdn, fixWikimediaThumb, normalizeImageUrl } from "../lib/images.ts";
import { unigetKeys, type UnigetData } from "../sources/unigetui.ts";
import { log, progress } from "../lib/log.ts";
import { isOfficialPublisher } from "../../../src/lib/verified.ts";
import { wingetVariant } from "../../../src/lib/wingetVariant.ts";
import { cleanName, plainText, publisherFromId, siteKey, slugId, truncate } from "../lib/text.ts";
import type { WingetInstaller, WingetManifest } from "../sources/winget.ts";
import { loadWingetManifest } from "../sources/winget.ts";
import { loadWebOnly } from "../sources/webOnly.ts";
import { categorize, categorizeLegacy, legacyCategories } from "./categories.ts";
import { chooseSharpIcons, type IconChoice } from "./icons.ts";
import type { AppRecord } from "./match.ts";
import { LINK_WEIGHT, pickRepository, repositoryKey } from "./repository.ts";

export interface BuildOptions {
  /** Kolika nejpopulárnějším aplikacím stáhnout manifest wingetu (podrobnosti, ikony, SHA-256…). */
  details: number;
  /**
   * Kolika dalším aplikacím wingetu vzít z manifestu jen popis, štítky a vydavatele
   * (zařazení do kategorií, popis na kartě) – bez poznámek k vydání a údajů o instalátoru.
   */
  descriptions: number;
  /** Kolika z nich zjistit velikost instalátoru (požadavek HEAD na server vydavatele). */
  sizes: number;
  /** Omezit katalog na N nejpopulárnějších aplikací (pro testování). */
  limit?: number;
}

/** Ručně spravované údaje (doporučené aplikace, alternativy, části instalátoru…). */
interface Curated {
  featured?: boolean;
  /** Ikona místo té ze zdrojů (zastaralé logo, malé rozlišení) – nejlépe oficiální z repozitáře aplikace. */
  iconUrl?: string;
  brandColor?: string;
  categories?: CategoryId[];
  alternatives?: string[];
  installerFeatures?: InstallerFeature[];
}

/** Id aplikace v katalogu – podle wingetu, jinak podle Chocolatey / Scoopu. */
export function recordId(r: AppRecord): string {
  if (r.winget) return slugId(r.winget.id);
  if (r.choco) return `choco-${slugId(r.choco.id)}`;
  return `scoop-${r.scoop!.bucket}-${slugId(r.scoop!.name)}`;
}

/** Odhad popularity 0–100: stažení z Chocolatey (log), počet zdrojů, moniker wingetu. */
function popularity(r: AppRecord, maxDownloads: number, curated?: Curated): number {
  const downloads = r.choco?.downloadCount ?? 0;
  let score = downloads > 0 ? (Math.log10(downloads + 1) / Math.log10(maxDownloads + 1)) * 80 : 0;
  const sources = Number(!!r.winget) + Number(!!r.choco) + Number(!!r.scoop);
  score += (sources - 1) * 6;
  if (r.winget?.moniker) score += 10; // moniker mají známé aplikace
  if (r.scoop && (r.scoop.bucket === "main" || r.scoop.bucket === "extras")) score += 3;
  if (curated?.featured) score += 10;
  return Math.max(1, Math.min(100, Math.round(score + 4)));
}

const ARCH: Record<string, Arch[]> = { x64: ["x64"], x86: ["x86"], arm64: ["arm64"], neutral: ["x64", "x86", "arm64"] };

const INSTALLER_TYPE: Record<string, InstallerType> = {
  msi: "msi",
  wix: "wix",
  inno: "inno",
  nullsoft: "nsis",
  burn: "burn",
  exe: "exe",
  msix: "msix",
  appx: "msix",
  portable: "portable",
  zip: "zip",
};

/** Preferovaný instalátor pro údaje na kartě: x64, pak neutrální, x86, ARM64. */
function preferredInstaller(installers: WingetInstaller[]): WingetInstaller | undefined {
  const order = ["x64", "neutral", "x86", "arm64"];
  return [...installers].sort((a, b) => order.indexOf(a.Architecture ?? "") - order.indexOf(b.Architecture ?? ""))[0];
}

/**
 * Kandidáti na ikonu v pořadí podle důvěryhodnosti zdroje – vybere se první
 * ostrá (build/icons.ts):
 *  1. z manifestu wingetu (PNG má přednost před ICO),
 *  2. z komunitní databáze UniGetUI (ručně vybrané, ~12 000 balíčků),
 *  3. z balíčku Chocolatey,
 *  4. ikony deklarované na webu aplikace (doplní se později, jen když předchozí nestačí).
 */
function iconCandidates(m: WingetManifest | null, unigetIcon: string | undefined, chocoIcon: string | null | undefined): string[] {
  const icons = m?.Icons ?? [];
  const light = icons.filter((i) => i.IconTheme !== "dark");
  const winget = [...light.filter((i) => i.IconFileType === "png"), ...light.filter((i) => i.IconFileType !== "png")];
  const uniget = unigetIcon ? normalizeImageUrl(unigetIcon) : null;
  // Zaniklá CDN (rawgit, staticaly) → jsDelivr; neopravitelná adresa se přeskočí
  const choco = chocoIcon ? fixDeadCdn(chocoIcon) : null;
  return [
    ...new Set([...(winget.length ? winget : icons).map((i) => i.IconUrl), uniget, choco && fixWikimediaThumb(choco)]),
  ].filter((url): url is string => !!url);
}

/** Web aplikace, jehož ikony připadají v úvahu (doména aplikace, ne repozitář na GitHubu). */
function iconSite(homepage: string | null): string | null {
  const site = siteKey(homepage);
  return homepage && site && !site.includes("/") ? homepage : null;
}

/**
 * Screenshoty aplikace: nejdřív z databáze UniGetUI (kurátorsky vybrané),
 * pak obrázky z popisu balíčku v Chocolatey. Bez duplicit a ikony, nejvýš
 * MAX_SCREENSHOTS. Vrací i seznam zdrojů (uvádí se u galerie).
 */
function screenshotsOf(
  r: AppRecord,
  keys: string[],
  /** Ikony aplikace – mezi screenshoty nepatří. */
  icons: (string | null)[],
  db: Map<string, string[]>,
): { screenshots: string[]; sources: ScreenshotSource[] } {
  const fromUniget = keys.map((k) => db.get(k)).find((images) => images?.length) ?? [];
  const screenshots: string[] = [];
  const sources: ScreenshotSource[] = [];
  const add = (urls: string[], source: ScreenshotSource) => {
    let added = false;
    for (const raw of urls) {
      const url = normalizeImageUrl(raw);
      if (!url || icons.includes(url) || screenshots.includes(url) || screenshots.length >= MAX_SCREENSHOTS) continue;
      screenshots.push(url);
      added = true;
    }
    if (added) sources.push(source);
  };
  add(fromUniget, "unigetui");
  add(r.choco?.screenshots ?? [], "chocolatey");
  return { screenshots, sources };
}

/** Štítky bez šumu (admin, foss…), nejvýš 6. */
const NOISE_TAGS = new Set(["admin", "foss", "cross-platform", "freeware", "notsilent", "trial", "embedded", "64bit", "32bit", "x64", "x86"]);
const pickTags = (...lists: (string[] | undefined)[]) =>
  [...new Set(lists.flatMap((l) => l ?? []).map((t) => t.toLowerCase()))].filter((t) => !NOISE_TAGS.has(t) && t.length < 30).slice(0, 6);

/** Datum ve tvaru ISO (manifest wingetu má jen „2026-08-25“). */
const isoDate = (value: string | Date | null | undefined) => {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export async function buildCatalog(
  records: AppRecord[],
  counts: Partial<Record<SourceId, number>>,
  options: BuildOptions,
  /** Ikony a screenshoty z databáze UniGetUI. */
  uniget: UnigetData = { icons: new Map(), screenshots: new Map() },
): Promise<Catalog> {
  const curated = await loadCurated();
  const maxDownloads = Math.max(1, ...records.map((r) => r.choco?.downloadCount ?? 0));

  // 1) Pořadí podle popularity
  const ranked = records
    .map((r) => ({ r, id: recordId(r) }))
    .map((x) => ({ ...x, popularity: popularity(x.r, maxDownloads, curated[x.id]) }))
    .sort((a, b) => b.popularity - a.popularity);
  const chosen = options.limit ? ranked.slice(0, options.limit) : ranked;

  // 2) Manifesty wingetu pro nejpopulárnější aplikace
  const detailTargets = chosen.filter((x) => x.r.winget).slice(0, options.details);
  log.step(`Manifesty wingetu: ${detailTargets.length} aplikací`);
  const tick = progress("manifesty", detailTargets.length);
  const manifests = new Map<string, WingetManifest>();
  await mapLimit(detailTargets, 16, async (x) => {
    const m = await loadWingetManifest(x.r.winget!);
    if (m) manifests.set(x.id, m);
    tick();
  });

  // 2b) Ostatní balíčky wingetu: z manifestu jen popis, štítky a vydavatel
  const briefTargets = chosen.filter((x) => x.r.winget && !manifests.has(x.id)).slice(0, options.descriptions);
  log.step(`Popisy z manifestů wingetu: ${briefTargets.length} dalších aplikací`);
  const tickBrief = progress("popisy", briefTargets.length);
  const briefs = new Map<string, Pick<WingetManifest, "ShortDescription" | "Tags" | "Publisher">>();
  await mapLimit(briefTargets, 16, async (x) => {
    const m = await loadWingetManifest(x.r.winget!);
    if (m) briefs.set(x.id, { ShortDescription: m.ShortDescription, Tags: m.Tags, Publisher: m.Publisher });
    tickBrief();
  });

  // 3) Velikosti instalátorů (HEAD na server vydavatele, s mezipamětí)
  const sizeTargets = detailTargets.slice(0, options.sizes);
  log.step(`Velikosti instalátorů: ${sizeTargets.length}`);
  const sizes = new Map<string, number>();
  const headLimiter = new Limiter(8);
  await mapLimit(sizeTargets, 8, async (x) => {
    const url = preferredInstaller(manifests.get(x.id)?.Installers ?? [])?.InstallerUrl;
    if (!url) return;
    const res = await cachedFetch(url, { method: "HEAD", maxAge: MAX_AGE.installerSize, limiter: headLimiter, retries: 1 });
    if (res.status === 200 && res.contentLength && res.contentLength > 50_000) sizes.set(x.id, res.contentLength);
  });

  // Názvy balíčků wingetu (pro závislosti) a id v katalogu
  const wingetNames = new Map(records.filter((r) => r.winget).map((r) => [r.winget!.id.toLowerCase(), cleanName(r.winget!.name)]));
  const catalogIds = new Set(chosen.map((x) => x.id));

  // 4) Záznamy katalogu
  const firstSeen = await loadFirstSeen();
  const now = new Date().toISOString();
  const iconChoices = new Map<string, IconChoice>();
  // Dnešní počty stažení z Chocolatey (historie pro „Skokany týdne“)
  const downloadsToday: Record<string, number> = {};
  const packages: CatalogEntry[] = chosen.map(({ r, id, popularity }) => {
    if (r.choco?.downloadCount) downloadsToday[id] = r.choco.downloadCount;
    const m = manifests.get(id) ?? null;
    const brief = briefs.get(id);
    const c = curated[id];
    const name = displayName(r, m);
    const homepage = m?.PackageUrl ?? m?.PublisherUrl ?? r.choco?.projectUrl ?? r.scoop?.homepage ?? null;
    const description = truncate(m?.ShortDescription ?? brief?.ShortDescription ?? r.choco?.summary ?? r.scoop?.description ?? "", 200);
    const tags = pickTags(m?.Tags ?? brief?.Tags, r.winget?.tags, r.choco?.tags);
    const support = m?.PublisherSupportUrl ?? null;
    // Repozitář podle všech odkazů – zastaralé zdroje a repozitáře instalátorů prohrají.
    // Web z Chocolatey / Scoopu zavede repozitář jen tam, kde by byl i webem aplikace
    // (jinak může pocházet ze špatně spárovaného balíčku, např. „warp“ u Cloudflare WARP).
    const wingetSite = !!(m?.PackageUrl ?? m?.PublisherUrl);
    const repo = pickRepository(
      [
        { url: m?.PackageUrl, weight: LINK_WEIGHT.wingetPackage },
        { url: m?.ReleaseNotesUrl, weight: LINK_WEIGHT.wingetReleaseNotes, introduces: "main" },
        { url: support, weight: LINK_WEIGHT.wingetSupport, introduces: support?.includes("/issues") ? "any" : "main" },
        { url: m?.PublisherUrl, weight: LINK_WEIGHT.wingetPublisher },
        { url: r.choco?.sourceUrl, weight: LINK_WEIGHT.chocoSource },
        { url: r.choco?.bugTrackerUrl, weight: LINK_WEIGHT.chocoBugTracker },
        { url: r.choco?.projectUrl, weight: LINK_WEIGHT.chocoProject, introduces: wingetSite ? "none" : "any" },
        { url: r.scoop?.homepage, weight: LINK_WEIGHT.scoopHomepage, introduces: wingetSite || r.choco?.projectUrl ? "none" : "any" },
      ],
      name,
    );
    // Hlášení chyb z Chocolatey jen u stejného repozitáře (jiný bývá zastaralý)
    const bugTracker = r.choco?.bugTrackerUrl ?? null;
    const bugTrackerKey = repositoryKey(bugTracker);
    const chocoIssues = bugTrackerKey && repo && bugTrackerKey !== repositoryKey(repo) ? null : bugTracker;

    if (!(id in firstSeen.ids)) firstSeen.ids[id] = firstSeen.initialized ? now : "";
    // Klíče v databázi UniGetUI (id z Chocolatey / Scoopu / wingetu, název)
    const unigetKey = unigetKeys(
      { chocolatey: r.choco?.id, scoop: r.scoop ? `${r.scoop.bucket}/${r.scoop.name}` : undefined, winget: r.winget?.id },
      name,
    );
    const unigetIcon = unigetKey.map((k) => uniget.icons.get(k)).find(Boolean);
    const candidates = iconCandidates(m, unigetIcon, r.choco?.iconUrl);
    // Ruční ikona z curated.json platí bez měření; ostatní vybere krok 5 (nejostřejší)
    if (!c?.iconUrl) iconChoices.set(id, { candidates, site: iconSite(homepage) });
    const iconUrl = c?.iconUrl ?? candidates[0] ?? null;
    const shots = screenshotsOf(r, unigetKey, [iconUrl, ...candidates], uniget.screenshots);

    const publisher = m?.Publisher ?? brief?.Publisher ?? (r.winget ? publisherFromId(r.winget.id) : (r.choco?.authors ?? ""));
    // Nové kategorie jen v categoriesV2 (a jen když se liší) – starší verze HubGetu znají jen původní
    const signals = { tags, name, description, ids: [r.winget?.id, r.choco?.id, r.scoop && `${r.scoop.bucket}/${r.scoop.name}`].filter((x): x is string => !!x) };
    const categories = c?.categories ?? categorize(signals);
    const legacy = c?.categories ? legacyCategories(c.categories) : categorizeLegacy(signals);
    const entry: CatalogEntry = {
      id,
      name,
      publisher,
      // Oficiální vydavatel ze seznamu (modrá fajfka) – stejné pravidlo jako v aplikaci
      verified: isOfficialPublisher(publisher) || undefined,
      description,
      categories: legacy,
      categoriesV2: categories.join() === legacy.join() ? undefined : categories,
      tags,
      iconUrl,
      homepage,
      license: m?.License ?? r.scoop?.license ?? null,
      latestVersion: r.winget?.version ?? r.choco?.version ?? r.scoop?.version ?? "",
      popularity,
      addedAt: firstSeen.ids[id],
      sources: sourcesOf(r, m, sizes.get(id)),
      releaseNotes: m?.ReleaseNotes ? truncate(plainText(m.ReleaseNotes), 600) : undefined,
      releaseNotesUrl: m?.ReleaseNotesUrl,
      releaseDate: isoDate(m?.ReleaseDate) ?? isoDate(r.choco?.published),
      supportUrl: support,
      privacyUrl: m?.PrivacyUrl,
      repositoryUrl: repo,
      issuesUrl: support?.includes("/issues") ? support : (chocoIssues ?? (repo?.includes("github.com/") ? `${repo}/issues` : null)),
      docsUrl: m?.Documentations?.find((d) => d.DocumentUrl)?.DocumentUrl ?? r.choco?.docsUrl,
      dependencies: dependenciesOf(m, wingetNames, catalogIds),
      featured: c?.featured,
      brandColor: c?.brandColor,
      alternatives: c?.alternatives?.filter((a) => catalogIds.has(a)),
      installerFeatures: c?.installerFeatures,
      screenshots: shots.screenshots,
      screenshotSources: shots.sources,
    };
    return stripEmpty(entry, REQUIRED_ENTRY_KEYS);
  });

  // 4b) Aplikace jen z webu výrobce (web-only.json) – starší verze HubGetu je nevidí
  const webOnly = (await loadWebOnly(now)).map((e) => {
    if (!(e.id in firstSeen.ids)) firstSeen.ids[e.id] = firstSeen.initialized ? now : "";
    const entry: CatalogEntry = { ...e, addedAt: firstSeen.ids[e.id], alternatives: e.alternatives?.filter((a) => catalogIds.has(a)) };
    return stripEmpty(entry, REQUIRED_ENTRY_KEYS);
  });
  if (webOnly.length) log.info(`jen z webu výrobce: ${webOnly.map((e) => `${e.name} ${e.latestVersion}`).join(", ")}`);
  await saveFirstSeen(firstSeen);
  await addWeeklyDownloads(packages, downloadsToday, now.slice(0, 10));

  // 5) Ostré ikony: změřit kandidáty, u aplikací bez ostré ikony zkusit i ikony z webu aplikace
  log.step("Ikony – rozlišení");
  await chooseSharpIcons(packages, iconChoices);

  // 6) Statistiky: aplikace ze správců aplikací + počty v repozitářích
  const exclusive: Partial<Record<SourceId, number>> = { winget: 0, chocolatey: 0, scoop: 0 };
  for (const r of records) {
    const present = [r.winget && "winget", r.choco && "chocolatey", r.scoop && "scoop"].filter(Boolean) as SourceId[];
    if (present.length === 1) exclusive[present[0]] = (exclusive[present[0]] ?? 0) + 1;
  }

  return {
    schemaVersion: 2,
    generatedAt: now,
    stats: { total: records.length, bySource: counts, exclusive },
    packages,
    webOnly: webOnly.length ? webOnly : undefined,
  };
}

/** Zdroje aplikace s údaji z manifestu (architektury, SHA-256, typ instalátoru, rozsah…). */
function sourcesOf(r: AppRecord, m: WingetManifest | null, size: number | undefined): PackageSource[] {
  const sources: PackageSource[] = [];
  if (r.winget) {
    const installers = m?.Installers ?? [];
    const preferred = preferredInstaller(installers);
    const type = preferred?.InstallerType ?? m?.InstallerType;
    const nested = preferred?.NestedInstallerType;
    const scopes = [...new Set(installers.map((i) => (i.Scope ?? m?.Scope)?.toLowerCase()).filter((s): s is InstallScope => s === "user" || s === "machine"))];
    const minOs = preferred?.MinimumOSVersion ?? m?.MinimumOSVersion;
    sources.push({
      source: "winget",
      packageId: r.winget.id,
      version: r.winget.version,
      size: size ?? undefined,
      architectures: m ? [...new Set(installers.flatMap((i) => ARCH[i.Architecture ?? ""] ?? []))] : undefined,
      sha256: preferred?.InstallerSha256?.toUpperCase(),
      installerType: type ? INSTALLER_TYPE[type === "zip" && nested ? nested : type] : undefined,
      scopes: scopes.length ? scopes : undefined,
      minOsVersion: minOs && minOs !== "10.0.0.0" ? minOs : undefined,
      // Jazykové verze a jiné typy instalátoru – výběr ve volbách instalace
      variants: r.wingetVariants
        ?.map((v) => ({ packageId: v.id, code: wingetVariant(v.id)?.code ?? v.id }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    });
  }
  if (r.choco) {
    sources.push({ source: "chocolatey", packageId: r.choco.id, version: r.choco.version, scopes: ["machine"] });
  }
  if (r.scoop) {
    sources.push({
      source: "scoop",
      packageId: `${r.scoop.bucket}/${r.scoop.name}`,
      version: r.scoop.version,
      architectures: r.scoop.architectures,
      sha256: r.scoop.sha256 ?? undefined,
      installerType: "zip",
      scopes: ["user", "machine"],
    });
  }
  return sources.map((s) => stripEmpty(s, ["source", "packageId", "version"]));
}

/** Závislosti z manifestu: balíčky wingetu (s odkazem do katalogu) a funkce Windows. */
function dependenciesOf(m: WingetManifest | null, names: Map<string, string>, catalogIds: Set<string>): Dependency[] | undefined {
  const deps = m?.Dependencies ?? preferredInstaller(m?.Installers ?? [])?.Dependencies;
  if (!deps) return undefined;
  const list: Dependency[] = [
    ...(deps.PackageDependencies ?? []).map((d) => {
      const appId = slugId(d.PackageIdentifier);
      return stripEmpty<Dependency>(
        {
          name: names.get(d.PackageIdentifier.toLowerCase()) ?? d.PackageIdentifier,
          appId: catalogIds.has(appId) ? appId : undefined,
          minVersion: d.MinimumVersion,
          kind: "package",
        },
        ["name", "kind"],
      );
    }),
    ...(deps.WindowsFeatures ?? []).map((f) => ({ name: f, kind: "feature" as const })),
  ];
  return list.length ? list : undefined;
}

/** Povinná pole záznamu katalogu – zůstanou i prázdná (aplikace s nimi počítá). */
const REQUIRED_ENTRY_KEYS = [
  "id", "name", "publisher", "description", "categories", "tags", "iconUrl", "homepage",
  "license", "latestVersion", "popularity", "addedAt", "sources",
];

/** Odstraní prázdné nepovinné hodnoty, ať je katalog co nejmenší. */
function stripEmpty<T extends object>(obj: T, keep: string[] = []): T {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([k, v]) => keep.includes(k) || (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)),
    ),
  ) as T;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Zobrazovaný název: z manifestu (bez přívěsků jako „(en-US)“); když je
 * v manifestu celý malými písmeny („blender“) a index má hezčí zápis, použije se ten.
 */
function displayName(r: AppRecord, m: WingetManifest | null): string {
  const fromIndex = r.winget ? cleanName(r.winget.name) : null;
  const fromManifest = m?.PackageName ? cleanName(m.PackageName) : null;
  if (fromManifest && !(fromManifest === fromManifest.toLowerCase() && fromIndex && fromIndex !== fromIndex.toLowerCase())) {
    return fromManifest;
  }
  return fromIndex ?? r.choco?.title ?? capitalize(r.scoop!.name);
}

async function loadCurated(): Promise<Record<string, Curated>> {
  try {
    return JSON.parse(await readFile(join(PIPELINE_DIR, "curated.json"), "utf8")) as Record<string, Curated>;
  } catch {
    return {};
  }
}

/**
 * Kdy se aplikace v katalogu objevila poprvé (pro záložku „Nové“). Při úplně
 * prvním běhu datum neznáme – zůstane prázdné; nové aplikace v dalších
 * bězích dostanou datum běhu.
 */
interface FirstSeen {
  initialized: boolean;
  ids: Record<string, string>;
}

const FIRST_SEEN = join(CACHE_DIR, "first-seen.json");

async function loadFirstSeen(): Promise<FirstSeen> {
  try {
    return { initialized: true, ids: JSON.parse(await readFile(FIRST_SEEN, "utf8")) as Record<string, string> };
  } catch {
    return { initialized: false, ids: {} };
  }
}

async function saveFirstSeen(data: FirstSeen) {
  await writeFile(FIRST_SEEN, JSON.stringify(data.ids));
}

/**
 * „Skokani týdne“: kolik stažení z Chocolatey aplikace získala za posledních
 * 7 dní a o kolik procent jí počet stažení vzrostl. Každý běh pipeline uloží
 * dnešní počty do historie v mezipaměti (GitHub Actions ji drží mezi běhy);
 * týdenní údaje vzniknou, jakmile je v historii snímek starý 5–10 dní
 * (nejblíž týdnu). Do té doby je katalog nemá a aplikace řadí podle trendů.
 */
const DOWNLOAD_HISTORY = join(CACHE_DIR, "download-history.json");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Nejmenší přírůstek, který se do katalogu zapíše – menší je šum. */
const MIN_WEEKLY_DOWNLOADS = 10;

async function addWeeklyDownloads(packages: CatalogEntry[], today: Record<string, number>, date: string) {
  let history: Record<string, Record<string, number>> = {};
  try {
    history = JSON.parse(await readFile(DOWNLOAD_HISTORY, "utf8")) as typeof history;
  } catch {
    // První běh – historie ještě není
  }
  const age = (day: string) => (Date.parse(date) - Date.parse(day)) / DAY_MS;
  const weekAgo = Object.keys(history)
    .filter((day) => age(day) >= 5 && age(day) <= 10)
    .sort((a, b) => Math.abs(age(a) - 7) - Math.abs(age(b) - 7))[0];
  if (weekAgo) {
    const before = history[weekAgo];
    let count = 0;
    for (const entry of packages) {
      const previous = before[entry.id];
      const current = today[entry.id];
      if (!previous || !current || current - previous < MIN_WEEKLY_DOWNLOADS) continue;
      entry.weeklyDownloads = current - previous;
      entry.weeklyGrowth = Math.round(((current - previous) / previous) * 10_000) / 100;
      count++;
    }
    log.info(`Skokani týdne: ${count} aplikací s přírůstkem stažení od ${weekAgo}`);
  } else {
    log.info("Skokani týdne: historie stažení zatím nemá snímek starý týden");
  }
  // Dnešní snímek; starší než dva týdny pryč
  history[date] = today;
  for (const day of Object.keys(history)) if (age(day) > 14) delete history[day];
  await writeFile(DOWNLOAD_HISTORY, JSON.stringify(history));
}
