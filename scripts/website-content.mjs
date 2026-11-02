// Novinky a Co chystáme na webu z datových souborů ve website/content/ – upravuje je
// Pages CMS (konfigurace .pages.yml v kořeni repozitáře), ručně stačí upravit JSON.
// Ve stránkách přepíše oblasti mezi značkami <!--obsah:klíč--> … <!--/obsah:klíč-->:
//   novinky.html, en/changelog.html (vydání z content/novinky/*.json):
//     releases        historie změn, nejnovější verze nahoře,
//     versions        čipy verzí pod nadpisem,
//     highlights      karty „V kostce“ (body `highlights` všech vydání od nejstaršího),
//     version, updates, updates-words, updates-words-capital
//                     aktuální verze a počet aktualizací od první verze (číslem i slovy),
//   co-chystame.html, en/roadmap.html (content/co-chystame.json):
//     lead, roadmap   úvod a seznam plánů.
// Spouští ho workflow Katalog před zveřejněním webu (úprava v Pages CMS se tak projeví hned)
// a `pnpm release`; ručně `pnpm website:content`.
//
// Texty v datech jsou prosté s malým Markdownem: **tučně** a [odkaz](adresa) – adresa
// „@github“ / „@releases“ je odkaz z LINKS ve website/main.js. V češtině se za jednopísmenné
// předložky a spojky doplní nezlomitelná mezera.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Texty stránek pro jednotlivé jazyky webu. */
const PAGES = {
  cs: {
    changelog: "website/novinky.html",
    roadmap: "website/co-chystame.html",
    date: (y, m, d) => `${d}. ${m}. ${y}`,
    sections: { new: "Nové", improved: "Vylepšeno", fixed: "Opraveno" },
    latest: "Nejnovější",
    first: "První verze",
    versionLabel: (version) => `Verze ${version}`,
    words: czechNumber,
  },
  en: {
    changelog: "website/en/changelog.html",
    roadmap: "website/en/roadmap.html",
    date: (y, m, d) => `${MONTHS_EN[m - 1]} ${d}, ${y}`,
    sections: { new: "New", improved: "Improved", fixed: "Fixed" },
    latest: "Latest",
    first: "First release",
    versionLabel: (version) => `Version ${version}`,
    words: englishNumber,
  },
};

/** Části vydání v pořadí na stránce → třída bloku (changes--…). */
const SECTION_CLASSES = { new: "new", improved: "better", fixed: "fix" };

/** Počet slovy jen v jednom jazyce – česky malým písmenem uprostřed věty, anglicky velkým na začátku. */
const OPTIONAL_KEYS = new Set(["updates-words", "updates-words-capital"]);

/** Stav plánu → třída štítku (roadmap__status--…). */
const STATUSES = ["ready", "wait"];

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Česká typografie: jednopísmenné předložky a spojky se nenechávají na konci řádku (i dvě za sebou – „i s“). */
const typography = (text, lang) => (lang === "cs" ? text.replace(/(?<=^|\s)([AaIiKkOoSsUuVvZz]) /g, "$1&nbsp;") : text);

/** Text z editoru → HTML: **tučně**, [odkaz](adresa), nezlomitelné mezery jako &nbsp;. */
function inline(text, lang) {
  return typography(escapeHtml(text.trim()), lang)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s"]+)\)/g, (_, label, href) =>
      href.startsWith("@") ? `<a data-link="${href.slice(1)}" href="#">${label}</a>` : `<a href="${href}">${label}</a>`,
    )
    .replaceAll(" ", "&nbsp;");
}

/** Číslo slovy (do 99, větší číslicemi) – „dvaadvacet“. */
function czechNumber(n) {
  const units = ["nula", "jedna", "dva", "tři", "čtyři", "pět", "šest", "sedm", "osm", "devět", "deset", "jedenáct", "dvanáct",
    "třináct", "čtrnáct", "patnáct", "šestnáct", "sedmnáct", "osmnáct", "devatenáct"];
  const tens = ["", "", "dvacet", "třicet", "čtyřicet", "padesát", "šedesát", "sedmdesát", "osmdesát", "devadesát"];
  if (n < 20) return units[n];
  if (n > 99) return String(n);
  return n % 10 ? `${units[n % 10]}a${tens[Math.floor(n / 10)]}` : tens[n / 10];
}

/** Číslo slovy (do 99, větší číslicemi) – „twenty-two“. */
function englishNumber(n) {
  const units = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 20) return units[n];
  if (n > 99) return String(n);
  return n % 10 ? `${tens[Math.floor(n / 10)]}-${units[n % 10]}` : tens[n / 10];
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const anchor = (version) => `v${version.replaceAll(".", "-")}`;
const compareVersions = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
};
const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : []);

/** Vydání z content/novinky/*.json seřazená od nejnovějšího; vadné soubory přeskočí s varováním. */
function loadReleases(root, warn) {
  const dir = join(root, "website", "content", "novinky");
  const releases = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const where = `website/content/novinky/${file}`;
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      warn(where, `nejde přečíst (${error.message}) – vydání se přeskočí`);
      continue;
    }
    if (!/^\d+\.\d+\.\d+$/.test(data.version ?? "")) {
      warn(where, "chybí číslo verze ve tvaru 0.1.23 – vydání se přeskočí");
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "")) {
      warn(where, "chybí datum vydání – vydání se přeskočí");
      continue;
    }
    if (!data.cs?.title?.trim()) {
      warn(where, "chybí český nadpis – vydání se přeskočí");
      continue;
    }
    if (releases.some((r) => r.version === data.version)) {
      warn(where, `verze ${data.version} už je v jiném souboru – vydání se přeskočí`);
      continue;
    }
    if (!data.en?.title?.trim()) warn(where, "chybí anglický text – anglická stránka ukáže český");
    releases.push(data);
  }
  return releases.sort((a, b) => compareVersions(b.version, a.version));
}

/** Text v jazyce `lang` a jazyk, ve kterém opravdu je (bez anglického překladu český). */
const localized = (entry, lang) => (entry[lang]?.title?.trim() ? [entry[lang], lang] : [entry.cs, "cs"]);

/** HTML jednoho vydání v historii změn (odsazení vůči značce). */
function releaseBlock(release, lang, { latest, first }) {
  const page = PAGES[lang];
  const [text, textLang] = localized(release, lang);
  const [y, m, d] = release.date.split("-").map(Number);
  const badge = latest
    ? `<span class="badge badge--live">${page.latest}</span>`
    : first
      ? `<span class="badge badge--accent">${page.first}</span>`
      : null;
  const changes = Object.entries(SECTION_CLASSES)
    .map(([key, className]) => [className, page.sections[key], list(text[key])])
    .filter(([, , items]) => items.length)
    .flatMap(([className, heading, items]) => [
      `    <div class="changes changes--${className}">`,
      `      <h3>${heading}</h3>`,
      `      <ul>`,
      ...items.map((item) => `        <li>${inline(item, textLang)}</li>`),
      `      </ul>`,
      `    </div>`,
    ]);
  return [
    `<!-- ${release.version} -->`,
    `<article class="release${first ? " release--first" : ""}" id="${anchor(release.version)}">`,
    `  <div class="release__meta">`,
    `    <span class="release__ver">${release.version}</span>`,
    `    <time class="release__date" datetime="${release.date}">${page.date(y, m, d)}</time>`,
    `  </div>`,
    `  <div class="card release__body">`,
    `    <div class="release__head">`,
    `      <h2>${inline(text.title, textLang)}</h2>`,
    ...(badge ? [`      ${badge}`] : []),
    `    </div>`,
    ...(text.lead?.trim() ? [`    <p class="release__lead">${inline(text.lead, textLang)}</p>`] : []),
    ...changes,
    `  </div>`,
    `</article>`,
  ];
}

/** Hodnoty značek stránky Novinky v jazyce `lang`. */
function changelogValues(releases, lang) {
  const page = PAGES[lang];
  const updates = releases.length - 1;
  const highlights = releases.toReversed().flatMap((release) => {
    const [text, textLang] = localized(release, lang);
    return (text.highlights ?? []).filter((h) => h?.title?.trim()).map((h) => ({ ...h, version: release.version, lang: textLang }));
  });
  return {
    version: releases[0].version,
    updates: String(updates),
    "updates-words": page.words(updates),
    "updates-words-capital": capitalize(page.words(updates)),
    versions: releases.map((r) => `<a class="chip" href="#${anchor(r.version)}">${r.version}</a>`),
    highlights: highlights.flatMap((h) => [
      `<article class="card highlight reveal">`,
      `  <span class="highlight__ver">${page.versionLabel(h.version)}</span>`,
      `  <h3>${inline(h.title, h.lang)}</h3>`,
      ...(h.text?.trim() ? [`  <p>${inline(h.text, h.lang)}</p>`] : []),
      `</article>`,
    ]),
    releases: releases.flatMap((release, i) => [
      ...(i ? [""] : []),
      ...releaseBlock(release, lang, { latest: i === 0, first: i === releases.length - 1 && releases.length > 1 }),
    ]),
  };
}

/** Hodnoty značek stránky Co chystáme v jazyce `lang`. */
function roadmapValues(roadmap, lang, warn) {
  const items = (roadmap.items ?? []).filter((item, i) => {
    if (item?.cs?.title?.trim()) return true;
    if (lang === "cs") warn("website/content/co-chystame.json", `plán č. ${i + 1} nemá český nadpis – přeskočí se`);
    return false;
  });
  const lead = roadmap.lead?.[lang]?.trim() ? [roadmap.lead[lang], lang] : [roadmap.lead?.cs ?? "", "cs"];
  return {
    lead: inline(...lead),
    roadmap: items.flatMap((item) => {
      const [text, textLang] = localized(item, lang);
      const status = STATUSES.includes(item.status) ? item.status : "wait";
      return [
        `<li>`,
        `  <strong>${inline(text.title, textLang)}</strong>`,
        ...(text.text?.trim() ? [`  <span>${inline(text.text, textLang)}</span>`] : []),
        ...(text.label?.trim() ? [`  <em class="roadmap__status roadmap__status--${status}">${inline(text.label, textLang)}</em>`] : []),
        `</li>`,
      ];
    }),
  };
}

/**
 * Přepíše značky v souboru: text se vloží, jak je, pole řádků jako blok odsazený podle
 * otevírací značky. Vrátí klíče, které v souboru chybí.
 */
function fill(path, values) {
  const html = readFileSync(path, "utf8");
  const found = new Set();
  const next = html.replace(/<!--obsah:([\w-]+)-->([\s\S]*?)<!--\/obsah:\1-->/g, (whole, key, _content, offset) => {
    found.add(key);
    if (!(key in values)) return whole;
    const value = values[key];
    let body = value;
    if (Array.isArray(value)) {
      const indent = /[ \t]*$/.exec(html.slice(html.lastIndexOf("\n", offset) + 1, offset))[0];
      body = `\n${value.map((line) => (line ? indent + line : line)).join("\n")}\n${indent}`;
    }
    return `<!--obsah:${key}-->${body}<!--/obsah:${key}-->`;
  });
  if (next !== html) writeFileSync(path, next);
  return Object.keys(values).filter((key) => !found.has(key) && !OPTIONAL_KEYS.has(key));
}

/**
 * Vygeneruje Novinky a Co chystáme (CZ i EN) z website/content/. Vrátí seznam varování
 * (vadná data, chybějící značky), vygenerované verze a počet plánů.
 */
export function updateContent(root) {
  const warnings = [];
  const warn = (file, message) => warnings.push({ file, message });
  const releases = loadReleases(root, warn);
  const roadmap = JSON.parse(readFileSync(join(root, "website", "content", "co-chystame.json"), "utf8"));
  for (const [lang, page] of Object.entries(PAGES)) {
    if (releases.length) {
      for (const key of fill(join(root, page.changelog), changelogValues(releases, lang))) warn(page.changelog, `chybí značka <!--obsah:${key}-->`);
    } else {
      warn("website/content/novinky", "žádné platné vydání – Novinky zůstaly beze změny");
    }
    for (const key of fill(join(root, page.roadmap), roadmapValues(roadmap, lang, warn))) warn(page.roadmap, `chybí značka <!--obsah:${key}-->`);
  }
  return { warnings, versions: releases.map((r) => r.version), plans: roadmap.items?.length ?? 0 };
}

// Spuštění samostatně (pnpm website:content, workflow Katalog)
if (resolve(process.argv[1] ?? "").toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { warnings, versions, plans } = updateContent(root);
  console.log(`Web: Novinky (${versions.length} verzí) a Co chystáme (${plans} plánů) vygenerované z website/content/.`);
  // V GitHub Actions jako upozornění u běhu – web se zveřejní i tak, bez vadných záznamů
  for (const { file, message } of warnings) {
    console.warn(process.env.GITHUB_ACTIONS ? `::warning file=${file}::${message}` : `! ${file}: ${message}`);
  }
}
