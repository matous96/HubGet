// Domovská stránka webu podle vydané verze – spouští ho `pnpm release` po sestavení,
// ručně `pnpm website:release`. Na domovské stránce a stránce Správci balíčků (CZ i EN)
// přepíše oblasti mezi značkami <!--release:klíč--> … <!--/release:klíč-->:
//   version             číslo verze (štítek nahoře, stažení, správci balíčků),
//   exe-file, msi-file  názvy instalátorů,
//   exe-size, msi-size  velikost instalátorů (ze sestavených souborů),
//   news                sekce „To nejlepší z verze“ – karty z `featured` nejnovějšího
//                       vydání v src/data/changelog.ts, jinak z prvních dvou bodů `highlights`.
// Ve website/main.js přepíše odkazy ke stažení (LINKS.downloadExe, downloadMsi) na instalátory
// vydání v<verze> na GitHubu. Podrobné Novinky (novinky.html, en/changelog.html) generuje
// scripts/website-content.mjs z website/content/ (upravují se v Pages CMS).
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Texty sekce a formát velikosti pro jednotlivé jazyky webu. */
const PAGES = {
  cs: {
    // Stránky se značkami: domovská (verze, stažení, novinky) a Správci balíčků (verze)
    files: ["website/index.html", "website/spravci.html"],
    changelog: "novinky.html",
    eyebrow: "Co je nového",
    title: (version) => `To nejlepší z&nbsp;verze ${version}.`,
    lead: (count) =>
      count > 1
        ? "Dvě největší novinky aktuální verze HubGetu. Všechny ostatní změny najdete v&nbsp;Novinkách."
        : "Největší novinka aktuální verze HubGetu. Všechny ostatní změny najdete v&nbsp;Novinkách.",
    more: "Všechny novinky",
    versionLabel: (version) => `Verze ${version}`,
    latest: "Nejnovější",
    size: (mib) => `${mib.toFixed(1).replace(".", ",")}&nbsp;MB`,
  },
  en: {
    files: ["website/en/index.html", "website/en/package-managers.html"],
    changelog: "changelog.html",
    eyebrow: "What’s new",
    title: (version) => `The best of version ${version}.`,
    lead: (count) =>
      count > 1
        ? "The two biggest new features in the current version of HubGet. Every other change is in What’s new."
        : "The biggest new feature in the current version of HubGet. Every other change is in What’s new.",
    more: "See all changes",
    versionLabel: (version) => `Version ${version}`,
    latest: "Latest",
    size: (mib) => `${mib.toFixed(1)}&nbsp;MB`,
  },
};

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Česká typografie: jednopísmenné předložky a spojky se nenechávají na konci řádku (i dvě za sebou – „i s“). */
const typography = (text, lang) => (lang === "cs" ? text.replace(/(?<=^|\s)([AaIiKkOoSsUuVvZz]) /g, "$1&nbsp;") : text);

const localize = (value, lang) => value[lang] ?? value.cs;

/** Karty nejnovějšího vydání: `featured`, jinak první dva body rozdělené na nadpis a text („Nadpis – text“, „Nadpis: text“). */
function cards(release, lang) {
  if (release.featured?.length) {
    // Odkaz je kotva domovské stránky, nebo podstránka s jiným souborem v každém jazyce
    const href = (f) => (typeof f.href === "string" ? f.href : f.href && localize(f.href, lang));
    return release.featured.slice(0, 2).map((f) => ({ title: localize(f.title, lang), text: localize(f.text, lang), href: href(f) }));
  }
  return release.highlights.slice(0, 2).map((h) => {
    const text = localize(h, lang);
    const match = /^(.{3,80}?)(?: – |: )(.+)$/.exec(text);
    if (!match) return { title: release.version, text };
    return { title: match[1], text: match[2].charAt(0).toUpperCase() + match[2].slice(1) };
  });
}

/** HTML sekce „To nejlepší z verze“ (odsazení jako v souboru). */
export function newsBlock(release, lang) {
  const page = PAGES[lang];
  // Novinky mají jeden záznam na řadu verzí (0.2.0, 0.2.1… → „0.2“, website/content/novinky)
  const anchor = `${page.changelog}#v${release.version.split(".").slice(0, 2).join("-")}`;
  const list = cards(release, lang);
  const card = (c, i) => [
    `          <a class="card news-card reveal" href="${c.href ?? anchor}">`,
    `            <span class="news-card__top"><span class="news-card__ver">${page.versionLabel(release.version)}</span>${i === 0 ? `<span class="badge badge--live">${page.latest}</span>` : ""}</span>`,
    `            <h3>${typography(escapeHtml(c.title), lang)}</h3>`,
    `            <p>${typography(escapeHtml(c.text), lang)}</p>`,
    `          </a>`,
  ];
  return [
    "",
    `        <div class="news__head reveal">`,
    `          <p class="eyebrow">${page.eyebrow}</p>`,
    `          <h2>${page.title(release.version)}</h2>`,
    `          <p class="section__lead">${page.lead(list.length)}</p>`,
    `          <a class="btn btn--ghost" href="${page.changelog}">${page.more}</a>`,
    `        </div>`,
    `        <div class="news__grid">`,
    ...list.flatMap(card),
    `        </div>`,
    `        `,
  ].join("\n");
}

/** Velikost souboru v MiB (null = soubor neexistuje). */
const mebibytes = (path) => (existsSync(path) ? statSync(path).size / 1024 / 1024 : null);

/**
 * Přepíše domovskou stránku (CZ i EN) podle verze `version` a nejnovějšího
 * vydání v changelogu. Vrátí seznam varování (chybějící značky, vydání, instalátory).
 */
export async function updateWebsite(root, version) {
  const warnings = [];
  const { CHANGELOG } = await import(pathToFileURL(join(root, "src", "data", "changelog.ts")).href);
  const release = CHANGELOG.find((r) => r.version === version);
  if (!release) warnings.push(`V src/data/changelog.ts chybí vydání ${version} – sekce „To nejlepší z verze“ zůstala beze změny.`);

  const exe = `HubGet_${version}_x64-setup.exe`;
  const msi = `HubGet_${version}_x64_en-US.msi`;
  const bundle = join(root, "src-tauri", "target", "release", "bundle");
  const exeSize = mebibytes(join(bundle, "nsis", exe));
  const msiSize = mebibytes(join(bundle, "msi", msi));
  if (exeSize === null || msiSize === null) warnings.push("Instalátory nejsou sestavené – velikost na webu zůstala beze změny.");

  for (const [lang, page] of Object.entries(PAGES)) {
    const values = { version, "exe-file": exe, "msi-file": msi };
    if (exeSize !== null) values["exe-size"] = page.size(exeSize);
    if (msiSize !== null) values["msi-size"] = page.size(msiSize);
    if (release) values.news = newsBlock(release, lang);

    // Každá značka musí být aspoň na jedné stránce daného jazyka
    const found = new Set();
    for (const file of page.files) {
      const path = join(root, file);
      const html = readFileSync(path, "utf8").replace(/<!--release:([\w-]+)-->([\s\S]*?)<!--\/release:\1-->/g, (whole, key) => {
        found.add(key);
        return key in values ? `<!--release:${key}-->${values[key]}<!--/release:${key}-->` : whole;
      });
      writeFileSync(path, html);
    }
    for (const key of Object.keys(values)) if (!found.has(key)) warnings.push(`${page.files.join(", ")}: chybí značka <!--release:${key}-->.`);
  }

  // Odkazy ke stažení ve website/main.js – instalátory vydání v<verze> v repozitáři z LINKS.github
  const mainJs = join(root, "website", "main.js");
  const script = readFileSync(mainJs, "utf8");
  const repo = /github:\s*"([^"]+)"/.exec(script)?.[1];
  if (!repo) {
    warnings.push("website/main.js: chybí LINKS.github – odkazy ke stažení zůstaly beze změny.");
  } else {
    const url = (file) => `${repo}/releases/download/v${version}/${file}`;
    const updated = script
      .replace(/downloadExe:\s*"[^"]*"/, `downloadExe: "${url(exe)}"`)
      .replace(/downloadMsi:\s*"[^"]*"/, `downloadMsi: "${url(msi)}"`);
    writeFileSync(mainJs, updated);
  }
  return warnings;
}

// Spuštění samostatně: verze z tauri.conf.json
if (resolve(process.argv[1] ?? "").toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const warnings = await updateWebsite(root, version);
  console.log(`Web: domovská stránka aktualizována na verzi ${version}.`);
  for (const warning of warnings) console.warn(`! ${warning}`);
}
