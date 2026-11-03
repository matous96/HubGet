// Kontrola catalog.json před zveřejněním (workflow Katalog) a před přibalením
// k aplikaci (workflow Vydání): rozbitý nebo neúplný katalog by dostali všichni.
//   node scripts/check-catalog.mjs <catalog.json> [--previous <zveřejněný.json>] [--report <report.json>]
//
// S --previous porovná počty se zveřejněným katalogem: výrazný pokles aplikací nebo ikon
// (výpadek zdroje, chyba pipeline) katalog nezveřejní – CATALOG_ALLOW_DROP=1 ho pustí
// (workflow Katalog → Run workflow → povolit pokles). S --report doplní porovnání do výpisu
// z běhu pipeline (hubget.eu/catalog-report.json).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Méně aplikací znamená výpadek zdroje (celý katalog má přes 20 000). */
const MIN_PACKAGES = 10_000;
/** Pokles proti zveřejněnému katalogu, který ho nezveřejní (u počtů v BLOCKING). */
const BLOCKING_DROP = 0.1;
/** Pokles, na který jen upozorní (u všech počtů). */
const WARNING_DROP = 0.02;
const BLOCKING = ["packages", "winget", "chocolatey", "scoop", "icons"];

const LABELS = {
  packages: "aplikací",
  winget: "aplikací z wingetu",
  chocolatey: "aplikací z Chocolatey",
  scoop: "aplikací ze Scoopu",
  icons: "aplikací s ikonou",
  screenshots: "aplikací se snímky",
  webOnly: "aplikací jen z webu výrobce",
};

/** Vrátí popis chyby, nebo null, když je katalog v pořádku. */
function catalogProblem(catalog) {
  if (catalog?.schemaVersion !== 2) return `nepodporovaná verze schématu: ${catalog?.schemaVersion}`;
  if (!Array.isArray(catalog.packages)) return "chybí seznam aplikací";
  if (catalog.packages.length < MIN_PACKAGES) return `jen ${catalog.packages.length} aplikací (očekává se aspoň ${MIN_PACKAGES})`;
  return null;
}

/** Počty, které se mezi běhy nemají skokově měnit. */
function metrics(catalog) {
  const packages = catalog.packages;
  const from = (source) => packages.filter((p) => p.sources?.some((s) => s.source === source)).length;
  return {
    packages: packages.length,
    winget: from("winget"),
    chocolatey: from("chocolatey"),
    scoop: from("scoop"),
    icons: packages.filter((p) => p.iconUrl).length,
    screenshots: packages.filter((p) => p.screenshots?.length).length,
    webOnly: catalog.webOnly?.length ?? 0,
  };
}

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

function readCatalog(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Neplatný katalog ${file}: ${error.message}`);
    process.exit(1);
  }
}

// GitHub Actions ukáže chyby a upozornění i v přehledu běhu
const annotate = (kind, text) => (process.env.GITHUB_ACTIONS === "true" ? `::${kind}::${text}` : text);

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("Použití: node scripts/check-catalog.mjs <catalog.json> [--previous <zveřejněný.json>] [--report <report.json>]");
  process.exit(2);
}
const catalog = readCatalog(file);
const problem = catalogProblem(catalog);
if (problem) {
  console.error(annotate("error", `Neplatný katalog ${file}: ${problem}`));
  process.exit(1);
}
console.log(`Katalog v pořádku: ${catalog.packages.length} aplikací, vygenerováno ${catalog.generatedAt}`);

const previousFile = option("previous");
if (previousFile) {
  if (!existsSync(previousFile)) {
    console.log("Zveřejněný katalog není k dispozici – porovnání se přeskočí.");
  } else {
    const previous = readCatalog(previousFile);
    const before = metrics(previous);
    const now = metrics(catalog);
    const allowDrop = process.env.CATALOG_ALLOW_DROP === "1";
    const problems = [];
    const warnings = [];
    for (const key of Object.keys(now)) {
      const drop = before[key] ? (before[key] - now[key]) / before[key] : 0;
      const text = `${LABELS[key]}: ${before[key]} → ${now[key]} (${(-drop * 100).toFixed(1)} %)`;
      if (BLOCKING.includes(key) && drop >= BLOCKING_DROP) (allowDrop ? warnings : problems).push(text);
      else if (drop >= WARNING_DROP) warnings.push(text);
    }
    console.log(`Proti zveřejněnému katalogu (${previous.generatedAt}):`);
    for (const key of Object.keys(now)) console.log(`  ${LABELS[key]}: ${before[key]} → ${now[key]}`);
    for (const text of warnings) console.warn(annotate("warning", `Pokles ${text}`));
    for (const text of problems) console.error(annotate("error", `Výrazný pokles ${text} – katalog se nezveřejní (pustí ho CATALOG_ALLOW_DROP=1)`));

    const reportFile = option("report");
    if (reportFile) {
      const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : {};
      report.check = {
        previous: { generatedAt: previous.generatedAt, ...before },
        current: { generatedAt: catalog.generatedAt, ...now },
        problems,
        warnings,
      };
      writeFileSync(reportFile, JSON.stringify(report, null, 1));
    }
    if (problems.length) process.exit(1);
  }
}
