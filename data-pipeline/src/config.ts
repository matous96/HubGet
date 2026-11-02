/**
 * Nastavení datové pipeline: zdroje dat, cesty a limity.
 * Většinu lze změnit parametry příkazové řádky (viz README.md).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_DIR = join(PIPELINE_DIR, "..");
export const CACHE_DIR = join(PIPELINE_DIR, ".cache");
export const OUT_DIR = join(PIPELINE_DIR, "out");

/** Identifikace pro servery (slušnost vůči API – je vidět, kdo se ptá). */
export const USER_AGENT = "HubGet-data-pipeline/0.1 (+https://github.com/matous96/unibox)";

const HOUR = 3_600_000;

/** Jak dlouho platí stažená data, než se znovu ověří. */
export const MAX_AGE = {
  /** Index wingetu se vždy ověří (ETag) – stažení proběhne jen při změně. */
  wingetIndex: 0,
  /** Manifesty mají v adrese hash obsahu – nemění se. */
  wingetManifest: Number.POSITIVE_INFINITY,
  /** Stránky Chocolatey API – server má limity, proto stačí jednou denně. */
  chocolatey: 20 * HOUR,
  /** Archivy bucketů Scoopu se ověří (ETag). */
  scoop: 0,
  /** Počty balíčků v registrech pro vývojáře. */
  registries: 24 * HOUR,
  /** Velikosti instalátorů (adresa obsahuje verzi). */
  installerSize: 30 * 24 * HOUR,
  /** Databáze screenshotů UniGetUI. */
  unigetui: 24 * HOUR,
  /** Hvězdičky repozitářů na GitHubu (GraphQL s GITHUB_TOKEN, jinak deps.dev). */
  githubStars: 24 * HOUR,
  /** Rozlišení ikon (ikony se mění zřídka). */
  iconSizes: 30 * 24 * HOUR,
  /** Verze aplikací jen z webu výrobce (seznam stažení Blackmagic Design). */
  webOnly: 12 * HOUR,
};

/** Komunitní databáze ikon a screenshotů UniGetUI (repozitář Devolutions/UniGetUI). */
export const UNIGETUI_SCREENSHOTS_URL =
  "https://raw.githubusercontent.com/Devolutions/UniGetUI/main/WebBasedData/screenshot-database-v2.json";

/** Zvětšené malé ikony (build/upscale.ts) – zveřejňují se s katalogem na webu HubGetu. */
export const UPSCALED_ICONS_URL = process.env.HUBGET_ICONS_URL ?? "https://hubget.eu/icons";

/** Nejvýš tolik screenshotů u jedné aplikace. */
export const MAX_SCREENSHOTS = 8;

/** Buckety Scoopu, ze kterých se berou aplikace (repozitář na GitHubu a větev). */
export const SCOOP_BUCKETS = [
  { name: "main", repo: "ScoopInstaller/Main", branch: "master" },
  { name: "extras", repo: "ScoopInstaller/Extras", branch: "master" },
  { name: "games", repo: "Calinou/scoop-games", branch: "master" },
  { name: "nonportable", repo: "ScoopInstaller/Nonportable", branch: "master" },
];

export const WINGET_INDEX_URL = "https://cdn.winget.microsoft.com/cache/source.msix";
export const WINGET_CDN = "https://cdn.winget.microsoft.com/cache";
export const CHOCOLATEY_FEED = "https://community.chocolatey.org/api/v2/Packages()";

/**
 * Počty balíčků v registrech, které nemají jednoduché API pro celkový počet
 * (PyPI) – odhad se použije, dokud ho nenahradí proměnná prostředí.
 */
export const FALLBACK_COUNTS = { pypi: 650_000 };
