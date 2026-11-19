/**
 * Export a import profilu počítače – seznamu nainstalovaných aplikací a jejich
 * nastavení pro přenos na nový počítač:
 *  - formát HubGetu (.json / .ubundle) = sada balíčků se všemi spravovanými
 *    aplikacemi, volbami instalace a nastavením aktualizací (ignorované,
 *    odložené, automatické), po importu se nainstaluje jedním kliknutím,
 *  - přehledná stránka (.html) se seznamem aplikací a příkazy pro ruční
 *    instalaci; uvnitř nese stejná data, takže jde i importovat,
 *  - formát `winget export` (.json), který umí i samotný winget: `winget import -i soubor.json`.
 */
import type { InstalledItem } from "@/hooks/useInstalledItems";
import { isUnmanagedOrigin } from "@/hooks/useInstalledItems";
import { encodeBundle } from "@/lib/bundleShare";
import { getSource, SOURCE_IDS, unattendedInstallCommand } from "@/services/managers";
import { parseBundleFile, type BundleFile, type BundleItem, type ProfileConfig } from "@/store/bundle";
import type { UpdatePins } from "@/store/updatePins";

/** Aplikace, které jde přenést (bez her ze Steamu a programů mimo správce). */
export function portableItems(items: InstalledItem[]): BundleItem[] {
  return items
    .filter((i) => !isUnmanagedOrigin(i.pkg.origin))
    .map((i) => ({ appId: i.entry.id, name: i.entry.name, source: i.pkg.source, packageId: i.pkg.packageId }));
}

/** Profil ve formátu sady balíčků HubGetu. */
export function buildProfile(items: InstalledItem[], name: string): BundleFile {
  return { format: "unibox-bundle", version: 1, name, createdAt: new Date().toISOString(), packages: portableItems(items) };
}

/**
 * Nastavení přenesených aplikací: jen zámky a automatické aktualizace těch,
 * které jsou v profilu (ne starých, dávno odinstalovaných).
 */
export function profileConfig(packages: BundleItem[], pins: UpdatePins, autoUpdate: string[]): ProfileConfig | undefined {
  const keys = new Set(packages.map((p) => `${p.source}:${p.packageId}`));
  const config: ProfileConfig = {};
  const keptPins = Object.entries(pins).filter(([key]) => keys.has(key));
  if (keptPins.length) config.pins = Object.fromEntries(keptPins);
  const keptAuto = autoUpdate.filter((key) => keys.has(key));
  if (keptAuto.length) config.autoUpdate = keptAuto;
  return config.pins || config.autoUpdate ? config : undefined;
}

const WINGET_SOURCE = {
  Argument: "https://cdn.winget.microsoft.com/cache",
  Identifier: "Microsoft.Winget.Source_8wekyb3d8bbwe",
  Name: "winget",
  Type: "Microsoft.PreIndexed.Package",
};

const MSSTORE_SOURCE = {
  Argument: "https://storeedgefd.dsx.mp.microsoft.com/v9.0",
  Identifier: "StoreEdgeFD",
  Name: "msstore",
  Type: "Microsoft.Rest",
};

/** Export ve formátu `winget export` (jen aplikace z wingetu a Microsoft Storu). */
export function buildWingetExport(items: InstalledItem[], wingetVersion = "1.11.430") {
  const ids = (origin: string) =>
    items.filter((i) => i.pkg.source === "winget" && i.pkg.origin === origin).map((i) => ({ PackageIdentifier: i.pkg.packageId }));
  const sources = [
    { Packages: ids("winget"), SourceDetails: WINGET_SOURCE },
    { Packages: ids("msstore"), SourceDetails: MSSTORE_SOURCE },
  ].filter((s) => s.Packages.length > 0);
  return {
    $schema: "https://aka.ms/winget-packages.schema.2.0.json",
    CreationDate: new Date().toISOString(),
    Sources: sources,
    WinGetVersion: wingetVersion,
  };
}

/** Id aplikace z Microsoft Storu (12 znaků, bez tečky – „9NKSQGP7F2NH“). */
export const isStoreId = (id: string) => /^[0-9A-Z]{12}$/i.test(id) && !id.includes(".");

/**
 * Konfigurace pro `winget configure` (WinGet Configuration / DSC, YAML): standardní formát
 * pro přípravu nového počítače, se kterým pracují i firmy a Microsoft Dev Box. Jen aplikace
 * z wingetu a Microsoft Storu – ostatní správci zdroj DSC nemají. Hodnoty jsou v JSON zápisu
 * (platný řetězec YAML, ať název s dvojtečkou nebo uvozovkami soubor nerozbije).
 */
export function buildWingetConfiguration(packages: Pick<BundleItem, "source" | "packageId" | "name">[], title: string): { yaml: string; count: number } {
  const winget = packages.filter((p) => p.source === "winget");
  const seen = new Set<string>();
  const lines = [
    "# yaml-language-server: $schema=https://aka.ms/configuration-dsc-schema/0.2",
    `# ${title.replace(/[\r\n]+/g, " ")} – HubGet`,
    "# winget configure -f <tento soubor>",
    "properties:",
    "  configurationVersion: 0.2.0",
    "  resources:",
  ];
  for (const p of winget) {
    if (seen.has(p.packageId.toLowerCase())) continue;
    seen.add(p.packageId.toLowerCase());
    const id = JSON.stringify(p.packageId);
    lines.push(
      "    - resource: Microsoft.WinGet.DSC/WinGetPackage",
      `      id: ${id}`,
      "      directives:",
      `        description: ${JSON.stringify(p.name)}`,
      "        allowPrerelease: true",
      "      settings:",
      `        id: ${id}`,
      `        source: ${isStoreId(p.packageId) ? "msstore" : "winget"}`,
    );
  }
  return { yaml: lines.join("\n") + "\n", count: seen.size };
}

interface WingetExport {
  Sources?: { Packages?: { PackageIdentifier?: string; Version?: string }[] }[];
}

/** Id značky <script>, ve které stránka profilu nese data pro import. */
const EMBED_ID = "unibox-profile";

/** Data profilu vložená do stránky .html (null = stránka žádná nemá). */
export function extractEmbeddedProfile(html: string): string | null {
  const match = new RegExp(`<script[^>]*id=["']${EMBED_ID}["'][^>]*>([\\s\\S]*?)</script>`, "i").exec(html);
  return match ? match[1].trim() : null;
}

/**
 * Načte profil ze souboru: sadu či profil HubGetu (.ubundle / .json),
 * stránku profilu (.html), nebo export wingetu (`winget export`, i s verzemi
 * z `--include-versions`). Aplikace z Microsoft Storu (id bez tečky) instaluje
 * backend ze zdroje msstore. `resolve` dohledá kanonické id a název aplikace v katalogu.
 */
export function parseProfileFile(text: string, resolve: (packageId: string) => { appId: string; name: string }): BundleFile {
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("<")) {
    const embedded = extractEmbeddedProfile(trimmed);
    if (!embedded) throw new Error("invalid profile");
    return parseBundleFile(embedded);
  }
  const data = JSON.parse(trimmed) as { format?: string } & WingetExport;
  if (data.format === "unibox-bundle") return parseBundleFile(trimmed);
  if (Array.isArray(data.Sources)) {
    const packages: BundleItem[] = data.Sources.flatMap((s) => s.Packages ?? [])
      .filter((p): p is { PackageIdentifier: string; Version?: string } => typeof p.PackageIdentifier === "string")
      .map((p) => ({
        ...resolve(p.PackageIdentifier),
        source: "winget" as const,
        packageId: p.PackageIdentifier,
        ...(typeof p.Version === "string" && p.Version ? { version: p.Version } : {}),
      }));
    return { format: "unibox-bundle", version: 1, name: "WinGet export", createdAt: new Date().toISOString(), packages };
  }
  throw new Error("invalid profile");
}

/* ── Stránka profilu (.html) ─────────────────────────────────────────── */

/** Texty stránky (otevírá se mimo aplikaci, proto ne přes i18next). */
const HTML_TEXTS = {
  cs: {
    title: "Profil aplikací",
    apps: (n: number) => `${n} ${n >= 1 && n <= 4 ? "aplikace" : "aplikací"}`,
    created: "Vytvořeno",
    howTo:
      "Na novém počítači otevřete HubGet → Nastavení → Záloha a katalog → Importovat a nainstalovat a vyberte tento soubor. HubGet ukáže seznam a všechny aplikace nainstaluje jedním kliknutím – i s nastavením.",
    openInHubGet: "Otevřít seznam v HubGetu",
    search: "Hledat aplikaci…",
    name: "Aplikace",
    publisher: "Vydavatel",
    version: "Verze",
    packageId: "Id balíčku",
    settings: "Nastavení",
    asAdmin: "jako správce",
    scopeMachine: "pro všechny uživatele",
    location: "vlastní složka",
    lock: "ignorovat aktualizace",
    skip: (v: string) => `přeskočit verzi ${v}`,
    snooze: (d: string) => `odloženo do ${d}`,
    autoUpdate: "automatické aktualizace",
    commands: "Příkazy pro ruční instalaci",
    commandsHint: "Bez HubGetu: spusťte je v PowerShellu (Chocolatey jako správce).",
    footer: (v: string) => `Vytvořeno v HubGetu ${v}. Soubor obsahuje jen seznam aplikací a jejich nastavení – žádná osobní data.`,
    noMatch: "Nic nenalezeno.",
  },
  en: {
    title: "App profile",
    apps: (n: number) => `${n} ${n === 1 ? "app" : "apps"}`,
    created: "Created",
    howTo:
      "On the new PC, open HubGet → Settings → Backup and catalog → Import and install and pick this file. HubGet shows the list and installs every app in one click – settings included.",
    openInHubGet: "Open the list in HubGet",
    search: "Search apps…",
    name: "App",
    publisher: "Publisher",
    version: "Version",
    packageId: "Package ID",
    settings: "Settings",
    asAdmin: "as administrator",
    scopeMachine: "for all users",
    location: "custom folder",
    lock: "ignore updates",
    skip: (v: string) => `skip version ${v}`,
    snooze: (d: string) => `postponed until ${d}`,
    autoUpdate: "automatic updates",
    commands: "Commands for a manual install",
    commandsHint: "Without HubGet: run them in PowerShell (Chocolatey as administrator).",
    footer: (v: string) => `Created in HubGet ${v}. The file holds only the list of apps and their settings – no personal data.`,
    noMatch: "Nothing found.",
  },
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Nejdelší odkaz unibox://, který Windows ještě předá aplikaci (příkazový řádek). */
const MAX_DEEP_LINK = 30_000;

/**
 * Přehledná stránka profilu: seznam aplikací podle správců, jejich nastavení
 * a příkazy pro ruční instalaci. Data pro import nese ve značce
 * <script type="application/json"> – HubGet ji načte jako běžný profil.
 */
export function buildProfileHtml(profile: BundleFile, items: InstalledItem[], locale: string, appVersion: string): string {
  const text = locale.startsWith("cs") ? HTML_TEXTS.cs : HTML_TEXTS.en;
  const byKey = new Map(items.map((i) => [`${i.pkg.source}:${i.pkg.packageId}`, i]));
  const pins = profile.config?.pins ?? {};
  const auto = new Set(profile.config?.autoUpdate ?? []);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);

  const settingsOf = (p: BundleItem) => {
    const key = `${p.source}:${p.packageId}`;
    const tags: string[] = [];
    const pin = pins[key];
    if (pin?.kind === "lock") tags.push(text.lock);
    if (pin?.kind === "skip") tags.push(text.skip(pin.version));
    if (pin?.kind === "snooze") tags.push(text.snooze(date(pin.until)));
    if (auto.has(key)) tags.push(text.autoUpdate);
    if (p.options?.asAdmin) tags.push(text.asAdmin);
    if (p.options?.scope === "machine") tags.push(text.scopeMachine);
    if (p.options?.location) tags.push(text.location);
    return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  };

  const groups = SOURCE_IDS.map((source) => {
    const group = profile.packages.filter((p) => p.source === source).sort((a, b) => a.name.localeCompare(b.name, locale));
    if (!group.length) return "";
    const rows = group
      .map((p) => {
        const item = byKey.get(`${p.source}:${p.packageId}`);
        const search = `${p.name} ${p.packageId} ${item?.entry.publisher ?? ""}`.toLowerCase();
        return `<tr data-search="${escapeHtml(search)}">
<td><div class="app"><span class="avatar">${escapeHtml(p.name.trim().charAt(0).toUpperCase() || "?")}</span><span>${escapeHtml(p.name)}</span></div></td>
<td class="muted">${escapeHtml(item?.entry.publisher ?? "")}</td>
<td class="num">${escapeHtml(p.version ?? item?.pkg.installedVersion ?? "")}</td>
<td><code>${escapeHtml(p.packageId)}</code></td>
<td>${settingsOf(p)}</td>
</tr>`;
      })
      .join("\n");
    return `<section class="group" data-group>
<h2><span class="dot"></span>${escapeHtml(getSource(source).label)} <span class="count">${group.length}</span></h2>
<div class="table"><table>
<thead><tr><th>${text.name}</th><th>${text.publisher}</th><th>${text.version}</th><th>${text.packageId}</th><th>${text.settings}</th></tr></thead>
<tbody>
${rows}
</tbody></table></div></section>`;
  }).join("\n");

  const commands = profile.packages.map((p) => unattendedInstallCommand(p.source, p.packageId, p.version)).join("\n");
  const deepLink = `unibox://bundle?d=${encodeBundle(profile.name, profile.packages)}`;
  // JSON uvnitř <script>: „<“ jako <, ať data nemohou značku ukončit
  const embedded = JSON.stringify(profile).replace(/</g, "\\u003c");
  const title = `HubGet – ${text.title}${profile.name ? ` · ${profile.name}` : ""}`;

  return `<!doctype html>
<html lang="${locale.startsWith("cs") ? "cs" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="HubGet ${escapeHtml(appVersion)}">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#f6f7fb;--surface:#fff;--line:#e3e6ee;--fg:#141824;--muted:#646b7d;--accent:#3b6cf6;--tag:#eef2ff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--surface:#171b24;--line:#272d3a;--fg:#e8ebf2;--muted:#959cad;--accent:#7096ff;--tag:#1f2740}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:40px 20px 56px}
header{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end;justify-content:space-between;margin-bottom:24px}
.brand{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{margin:4px 0 2px;font-size:32px;line-height:1.15}
.meta{color:var(--muted)}
.how{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:24px}
.how a{display:inline-flex;margin-top:10px;padding:8px 16px;border-radius:999px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none}
input[type=search]{width:280px;max-width:100%;height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:inherit;font:inherit}
.group{margin-top:28px}
h2{display:flex;align-items:center;gap:10px;font-size:18px;margin:0 0 10px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.count{color:var(--muted);font-weight:500;font-size:14px}
.table{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:16px}
table{width:100%;border-collapse:collapse;min-width:720px}
th,td{padding:10px 14px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--line)}
th{font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
tr:last-child td{border-bottom:0}
.app{display:flex;align-items:center;gap:10px;font-weight:600}
.avatar{flex:none;display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;border-radius:9px;background:var(--tag);color:var(--accent);font-weight:700}
.muted{color:var(--muted)}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
code{font:13px/1.4 "Cascadia Mono",Consolas,monospace;color:var(--muted)}
.tag{display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:999px;background:var(--tag);font-size:12px;white-space:nowrap}
details{margin-top:32px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px 18px}
summary{cursor:pointer;font-weight:600}
pre{overflow-x:auto;margin:12px 0 0;padding:14px;border-radius:12px;background:var(--bg);font:13px/1.6 "Cascadia Mono",Consolas,monospace}
.empty{display:none;color:var(--muted);margin-top:24px}
footer{margin-top:32px;color:var(--muted);font-size:13px}
@media (max-width:640px){main{padding:24px 16px 40px}h1{font-size:26px}input[type=search]{width:100%}}
</style>
</head>
<body>
<main>
<header>
<div>
<div class="brand">HubGet</div>
<h1>${escapeHtml(profile.name || text.title)}</h1>
<div class="meta">${text.apps(profile.packages.length)} · ${text.created} ${escapeHtml(date(profile.createdAt || new Date().toISOString()))}</div>
</div>
<input type="search" id="filter" placeholder="${text.search}" aria-label="${text.search}">
</header>
<div class="how">${escapeHtml(text.howTo)}${deepLink.length <= MAX_DEEP_LINK ? `<br><a href="${escapeHtml(deepLink)}">${text.openInHubGet}</a>` : ""}</div>
${groups}
<p class="empty" id="empty">${text.noMatch}</p>
<details>
<summary>${text.commands}</summary>
<p class="muted">${text.commandsHint}</p>
<pre>${escapeHtml(commands)}</pre>
</details>
<footer>${escapeHtml(text.footer(appVersion))}</footer>
</main>
<script type="application/json" id="${EMBED_ID}">${embedded}</script>
<script>
(function(){var input=document.getElementById("filter"),empty=document.getElementById("empty");
input.addEventListener("input",function(){var q=input.value.trim().toLowerCase(),any=false;
document.querySelectorAll("[data-group]").forEach(function(g){var shown=0;g.querySelectorAll("tbody tr").forEach(function(r){var ok=!q||r.dataset.search.indexOf(q)>=0;r.style.display=ok?"":"none";if(ok)shown++;});g.style.display=shown?"":"none";if(shown)any=true;});
empty.style.display=any?"none":"block";});})();
</script>
</body>
</html>
`;
}
