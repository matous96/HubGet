/**
 * Ostré ikony: každá aplikace má několik kandidátů (manifest wingetu, databáze
 * UniGetUI, balíček Chocolatey, ikony webu) a vybere se první dost velký –
 * malá ikona (favicon 16–32 px) by se v kartě a v detailu rozmazala.
 *
 * Rozlišení se zjistí z hlavičky obrázku (stačí začátek souboru, lib/imageSize.ts)
 * a ukládá se do .cache/icon-sizes.json (platí MAX_AGE.iconSizes).
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogEntry } from "../../../src/types/index.ts";
import { CACHE_DIR, MAX_AGE, USER_AGENT } from "../config.ts";
import { imageSize, type ImageSize } from "../lib/imageSize.ts";
import { Limiter, mapLimit } from "../lib/http.ts";
import { log, progress } from "../lib/log.ts";

/** Ikona aspoň takhle velká je ostrá v kartě i v detailu aplikace (dlaždice 150 px, obrázek ~100 px při 150 % DPI). */
export const SHARP_ICON = 128;
/**
 * Menší ikona se nepoužije (zobrazí se avatar s iniciálami) – favicon 16–32 px by
 * byl rozmazaný všude. Ikonu 48–127 px aplikace nezvětší víc než 2× (PackageIcon).
 */
export const MIN_ICON = 48;

const CACHE_FILE = join(CACHE_DIR, "icon-sizes.json");
/** Kolik bajtů ze začátku souboru stáhnout – na hlavičku obrázku (i adresář ICO) stačí. */
const HEAD_BYTES = 128 * 1024;

/**
 * Obecné obrázky místo ikony (rozměry a SHA-256 souboru). Chocolatey za balíček bez vlastní
 * ikony vrací modrou krabičku s bublinami – v katalogu ji měly desítky aplikací (gnuplot,
 * Fiddler, Sonic Pi, Gitea, neoficiální klient ChatGPT, se kterým se spojil i oficiální).
 * Taková ikona se počítá jako nefunkční a vybere se další kandidát.
 */
const PLACEHOLDERS = [{ w: 128, h: 128, sha256: "f75147f3739646fcd8705bae8e581206fa2bb0b08ac85a7357a7c1b479fc961e" }];

const isPlaceholder = (size: ImageSize, body: Buffer) =>
  PLACEHOLDERS.some(
    (p) => p.w === size.width && p.h === size.height && p.sha256 === createHash("sha256").update(body).digest("hex"),
  );

/**
 * Výsledek měření: rozměry, nebo chyba – trvalá (404, HTML místo obrázku, obecný obrázek)
 * nebo dočasná (přetížený či nedostupný server; zkusí se znovu příští den).
 * `checked` = obsah porovnaný s PLACEHOLDERS (starší záznamy s jejich rozměry se změří znovu).
 */
type Measured = { w: number; h: number; vector?: true; checked?: true; at: number } | { error: string; at: number };

/** Dočasnou chybu zkusit znovu po dni (trvalé výsledky platí MAX_AGE.iconSizes). */
const TRANSIENT_AGE = 24 * 3_600_000;
/** Chyba, která pomine: limit požadavků, chyba serveru, časový limit, výpadek sítě. */
const isTransient = (m: Measured | undefined) => !!m && "error" in m && /^(429|5\d\d|timeout|network)$/.test(m.error);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readCache(): Promise<Record<string, Measured>> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as Record<string, Measured>;
  } catch {
    return {};
  }
}

interface HeadOptions {
  /** Nejvýš tolik bajtů (server nemusí znát Range – čtení se pak přeruší). */
  maxBytes?: number;
  /** Přestat číst, jakmile se objeví tento text (konec hlavičky HTML). */
  until?: string;
  accept?: string;
  timeoutMs?: number;
}

/** Začátek souboru (obrázku nebo stránky). */
async function fetchHead(url: string, options: HeadOptions = {}): Promise<{ status: number; body: Buffer; url: string }> {
  const { maxBytes = HEAD_BYTES, until, accept = "image/*,*/*;q=0.5", timeoutMs = 20_000 } = options;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Range: `bytes=0-${maxBytes - 1}`, Accept: accept },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) return { status: res.status, body: Buffer.alloc(0), url: res.url };
  const chunks: Buffer[] = [];
  let length = 0;
  let tail = Buffer.alloc(0);
  const reader = res.body.getReader();
  while (length < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    length += chunk.length;
    if (until) {
      // Hledaný text může ležet přes hranici dvou kusů
      const window = Buffer.concat([tail, chunk]);
      if (window.includes(until)) break;
      tail = window.subarray(Math.max(0, window.length - until.length));
    }
  }
  await reader.cancel().catch(() => {});
  // Konečná adresa po přesměrování (http → https) – vůči ní se doplní relativní odkazy
  return { status: res.status, body: Buffer.concat(chunks), url: res.url || url };
}

async function measureOnce(url: string): Promise<Measured> {
  const at = Date.now();
  try {
    const { status, body } = await fetchHead(url);
    if (status >= 400) return { error: String(status), at };
    const size = imageSize(body);
    if (!size) return { error: "format", at };
    if (size.vector) return { w: 0, h: 0, vector: true, at };
    if (isPlaceholder(size, body)) return { error: "placeholder", at };
    return { w: size.width, h: size.height, checked: true, at };
  } catch (error) {
    return { error: (error as Error).name === "TimeoutError" ? "timeout" : "network", at };
  }
}

/** Měření s opakováním při dočasné chybě (přetížený server, výpadek sítě). */
async function measure(url: string): Promise<Measured> {
  let result = await measureOnce(url);
  for (let attempt = 1; attempt <= 2 && isTransient(result); attempt++) {
    await sleep(2000 * attempt);
    result = await measureOnce(url);
  }
  return result;
}

/** Změřeno před kontrolou obecných obrázků a se stejnými rozměry – mohl by to být on. */
const unchecked = (m: Measured) => !("error" in m) && !m.checked && PLACEHOLDERS.some((p) => p.w === m.w && p.h === m.h);

const expired = (m: Measured | undefined, now: number) =>
  !m || unchecked(m) || now - m.at > (isTransient(m) ? TRANSIENT_AGE : MAX_AGE.iconSizes);

/** Fronty po serverech – na jeden server nejvýš `max` požadavků najednou. */
function hostLimiters(max: number) {
  const perHost = new Map<string, Limiter>();
  return (url: string) => {
    const host = new URL(url).hostname;
    if (!perHost.has(host)) perHost.set(host, new Limiter(max));
    return perHost.get(host)!;
  };
}

/**
 * Změří ikony (z mezipaměti, nové a staré stáhne) – adresa → rozměry,
 * null = nejde načíst, undefined = server je teď nedostupný (rozměr neznámý).
 */
export async function measureIcons(urls: string[]): Promise<Map<string, ImageSize | null | undefined>> {
  const cache = await readCache();
  const now = Date.now();
  const todo = [...new Set(urls)].filter((url) => expired(cache[url], now));
  if (todo.length) {
    log.info(`ikony k změření: ${todo.length} (${urls.length - todo.length} z mezipaměti)`);
    const tick = progress("ikony", todo.length);
    // Na jeden server nejvýš 4 požadavky najednou (CDN Chocolatey, jsDelivr…)
    const limiterOf = hostLimiters(4);
    let unsaved = 0;
    await mapLimit(todo, 48, async (url) => {
      cache[url] = await limiterOf(url).run(() => measure(url));
      tick();
      // Průběžně ukládat – přerušený běh nezačíná od nuly
      if (++unsaved >= 1000) {
        unsaved = 0;
        await writeFile(CACHE_FILE, JSON.stringify(cache));
      }
    });
    await writeFile(CACHE_FILE, JSON.stringify(cache));
  }
  const placeholders = new Set(
    urls.filter((url) => {
      const m = cache[url];
      return !!m && "error" in m && m.error === "placeholder";
    }),
  );
  if (placeholders.size) log.info(`ikony: ${placeholders.size} obecných obrázků místo ikony (Chocolatey) vyřazeno`);
  return new Map(
    urls.map((url) => {
      const m = cache[url];
      if (!m || isTransient(m)) return [url, undefined];
      return [url, "error" in m ? null : { width: m.w, height: m.h, vector: m.vector }];
    }),
  );
}

// ── Ikony webu aplikace ────────────────────────────────────────────────

const WEB_CACHE_FILE = join(CACHE_DIR, "web-icons.json");

/**
 * Weby, kde ikona patří webu, ne aplikaci: repozitáře kódu, obchody, katalogy
 * programů, blogovací služby (stejný seznam jako u faviconů v aplikaci – lib/icons.ts – a pár dalších).
 */
const GENERIC_HOSTS =
  /(^|\.)(github\.com|gitlab\.com|sourceforge\.net|sf\.net|bitbucket\.org|codeberg\.org|microsoft\.com|google\.com|apple\.com|steampowered\.com|steamcommunity\.com|itch\.io|portableapps\.com|npmjs\.com|pypi\.org|nuget\.org|chocolatey\.org|scoop\.sh|visualstudio\.com|mozilla\.org|softpedia\.com|majorgeeks\.com|blogspot\.com|wordpress\.com|medium\.com|youtube\.com|reddit\.com|twitter\.com|x\.com|facebook\.com|discord\.com|discord\.gg|telegram\.org|t\.me|archive\.org|wikipedia\.org|amazon\.com|jetbrains\.com|nirsoft\.net)$/;

/** Entity v hodnotě atributu HTML („…?size=medium&amp;theme=light“). */
const decodeEntities = (value: string) =>
  value.replace(/&(amp|#0*38|quot|#0*34|apos|#0*39);/gi, (_, e: string) => (/amp|38/i.test(e) ? "&" : /quot|34/i.test(e) ? '"' : "'"));

/** Hodnoty atributů jednoho tagu (<link rel="icon" href="…" sizes="…">). */
function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

/** Největší rozměr z atributu sizes („32x32 192x192“, „any“ = vektor). */
const declaredSize = (sizes: string | undefined) =>
  !sizes ? 0 : /any/i.test(sizes) ? Number.POSITIVE_INFINITY : Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/gi)].map((m) => Number(m[1])));

const absolute = (href: string, base: string) => {
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * Ikony, které stránka deklaruje (link rel=icon / apple-touch-icon, web manifest) – od největší.
 * Bez deklarovaných ikon zkusí obvyklé soubory v kořeni webu (apple-touch-icon.png, favicon.ico).
 */
export async function discoverWebIcons(homepage: string): Promise<string[]> {
  // Odkazy na ikony bývají až na konci hlavičky – za stovkami kB vložených stylů a skriptů
  const page = await fetchHead(homepage, { maxBytes: 1024 * 1024, until: "</head>", accept: "text/html,*/*;q=0.5" });
  // Přetížený server – výjimka, ať se web zkusí znovu (404 apod. je trvalá odpověď)
  if (page.status === 429 || page.status >= 500) throw new Error(`HTTP ${page.status}`);
  if (page.status >= 400) return [];
  const html = page.body.toString("utf8");
  const found: { url: string; size: number }[] = [];
  let manifest: string | null = null;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(tag);
    const rel = (a.rel ?? "").toLowerCase();
    const href = a.href ? absolute(a.href, page.url) : null;
    if (!href) continue;
    if (rel.split(/\s+/).includes("manifest")) manifest = href;
    // mask-icon je jednobarevná silueta pro Safari – ne ikona
    else if (/(^|\s)(icon|apple-touch-icon(-precomposed)?|fluid-icon)(\s|$)/.test(rel) && !rel.includes("mask-icon")) {
      const size = /\.svgz?($|\?)/i.test(href) || /svg/i.test(a.type ?? "") ? Number.POSITIVE_INFINITY : declaredSize(a.sizes) || (rel.includes("apple") ? 180 : 0);
      found.push({ url: href, size });
    }
  }
  if (manifest) {
    try {
      const res = await fetchHead(manifest, { accept: "application/manifest+json,application/json,*/*;q=0.5" });
      const json = JSON.parse(res.body.toString("utf8")) as { icons?: { src?: string; sizes?: string; purpose?: string }[] };
      for (const icon of json.icons ?? []) {
        const url = icon.src ? absolute(icon.src, manifest) : null;
        // Maskovatelné ikony mají kolem loga velký okraj
        if (url && !/^maskable$/i.test(icon.purpose ?? "")) found.push({ url, size: declaredSize(icon.sizes) });
      }
    } catch {
      // manifest nejde načíst nebo není JSON – stačí ikony ze stránky
    }
  }
  if (!found.length) {
    const root = new URL(page.url).origin;
    return root.startsWith("https:") ? [`${root}/apple-touch-icon.png`, `${root}/favicon.ico`] : [];
  }
  return [...new Set(found.sort((a, b) => b.size - a.size).map((f) => f.url))].slice(0, 4);
}

/** Chyby, které opakování nespraví: neexistující doména, vadný certifikát. */
const PERMANENT_ERRORS = /^(ENOTFOUND|ERR_TLS_CERT_ALTNAME_INVALID|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_SSL_.*)$/;

/**
 * Kandidáti z webů aplikací (homepage → ikony deklarované na stránce), s mezipamětí.
 * Weby, kde ikona patří službě (GitHub, Steam, SourceForge…), se přeskočí.
 */
export async function webIcons(homepages: string[]): Promise<Map<string, string[]>> {
  /** failed = web neodpověděl (časový limit, výpadek) – zkusí se znovu příští den. */
  let cache: Record<string, { icons: string[]; at: number; failed?: true }> = {};
  try {
    cache = JSON.parse(await readFile(WEB_CACHE_FILE, "utf8"));
  } catch {
    // první běh
  }
  const now = Date.now();
  const usable = [...new Set(homepages)].filter((url) => {
    try {
      const u = new URL(url);
      return u.protocol.startsWith("http") && !GENERIC_HOSTS.test(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  });
  const expiredWeb = (url: string) => !cache[url] || now - cache[url].at > (cache[url].failed ? TRANSIENT_AGE : MAX_AGE.iconSizes);
  const todo = usable.filter(expiredWeb);
  if (todo.length) {
    log.info(`weby aplikací k prohledání: ${todo.length} (${usable.length - todo.length} z mezipaměti)`);
    // Víc aplikací často sdílí web vydavatele – na jeden server nejvýš 2 požadavky najednou
    const limiterOf = hostLimiters(2);
    const errors = new Map<string, number>();
    const visit = async (urls: string[], concurrency: number, label: string) => {
      const tick = progress(label, urls.length);
      await mapLimit(urls, concurrency, async (url) => {
        const result = await limiterOf(url).run(() =>
          discoverWebIcons(url).then(
            (icons) => ({ icons, at: Date.now() }),
            (error: Error & { cause?: { code?: string } }) => {
              const kind = error.cause?.code ?? error.name;
              errors.set(kind, (errors.get(kind) ?? 0) + 1);
              // Neexistující doména a vadný certifikát se do zítřka nespraví – trvalá odpověď
              return PERMANENT_ERRORS.test(kind) ? { icons: [], at: Date.now() } : { icons: [], at: Date.now(), failed: true as const };
            },
          ),
        );
        cache[url] = result;
        tick();
      });
      if (errors.size) log.info(`chyby: ${[...errors].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}×`).join(", ")}`);
      errors.clear();
    };
    await visit(todo, 24, "weby");
    // Neodpověděly? Ještě jednou a pomaleji – v plném souběhu bývá chyba jen v časovém limitu
    const failed = todo.filter((url) => cache[url].failed);
    if (failed.length) await visit(failed, 6, "weby – druhý pokus");
    log.info(`weby: ${todo.filter((url) => cache[url].icons.length).length} s ikonami, ${todo.filter((url) => cache[url].failed).length} neodpovědělo`);
    await writeFile(WEB_CACHE_FILE, JSON.stringify(cache));
  }
  // Starší záznamy mohou mít v adrese entity HTML (&amp;)
  return new Map(usable.map((url) => [url, (cache[url]?.icons ?? []).map(decodeEntities)]));
}

/** Rozlišení ikony pro porovnání (kratší strana; vektor = nekonečno). */
export const iconPixels = (size: ImageSize | null | undefined) =>
  !size ? 0 : size.vector ? Number.POSITIVE_INFINITY : Math.min(size.width, size.height);

/**
 * Nejlepší ikona z kandidátů (v pořadí podle důvěryhodnosti zdroje, ikony z webu
 * na konci): první ostrá, jinak největší použitelná, jinak první ikona z balíčků,
 * kterou teď nešlo změřit (výpadek serveru – velikost pohlídá aplikace; ikony
 * z webu jsou jen odhad, ty ne), jinak žádná – aplikace ukáže avatar s iniciálami.
 */
export function pickSharpIcon(candidates: string[], sizes: Map<string, ImageSize | null | undefined>, fromWeb: string[] = []): string | null {
  const all = [...candidates, ...fromWeb];
  const sharp = all.find((url) => iconPixels(sizes.get(url)) >= SHARP_ICON);
  if (sharp) return sharp;
  const usable = all.filter((url) => iconPixels(sizes.get(url)) >= MIN_ICON);
  const best = usable.sort((a, b) => iconPixels(sizes.get(b)) - iconPixels(sizes.get(a)))[0];
  return best ?? candidates.find((url) => sizes.get(url) === undefined) ?? null;
}

/**
 * Ikonu webu sdílí tolik aplikací bez vlastní ikony – nebo má na stejném webu
 * stránku tolik aplikací z katalogu (apps.kde.org, faststone.org) → ikona je
 * logo webu nebo vydavatele, ne aplikace.
 */
const SHARED_WEB_ICON = 3;

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Ikonu z CDN wingetu (z manifestu, vytaženou z instalátoru) sdílí tolik aplikací
 * různých vydavatelů → je to výchozí ikona instalátoru, ne aplikace: Microsoft Teams,
 * Screenpresso, LanguageTool a JASP měly stejnou složku s obláčkem, desítky dalších
 * ikonu MSI, Electronu nebo Javy. Tři vydavatele mají i forky se skutečnou ikonou
 * (Chromium a ungoogled-chromium, Apache NetBeans). Sdílené logo z jiných zdrojů
 * (Node.js, FFmpeg) je v pořádku.
 */
const SHARED_WINGET_ICON = 4;
const WINGET_ICONS = "https://cdn.winget.microsoft.com/icons/";

/** Vydavatel podle id balíčku ve wingetu („Microsoft.Teams“ → microsoft) – názvy vydavatelů se píšou různě. */
const wingetPublisher = (entry: Pick<CatalogEntry, "publisher" | "sources">) =>
  (entry.sources.find((s) => s.source === "winget")?.packageId.split(".")[0] ?? entry.publisher).trim().toLowerCase();

/** Ikony z CDN wingetu, které mezi kandidáty mají aplikace aspoň SHARED_WINGET_ICON různých vydavatelů. */
export function genericWingetIcons(packages: Pick<CatalogEntry, "id" | "publisher" | "sources">[], choices: Map<string, IconChoice>): Set<string> {
  const publishers = new Map<string, Set<string>>();
  for (const entry of packages) {
    for (const url of choices.get(entry.id)?.candidates ?? []) {
      if (!url.startsWith(WINGET_ICONS)) continue;
      publishers.set(url, (publishers.get(url) ?? new Set()).add(wingetPublisher(entry)));
    }
  }
  return new Set([...publishers].filter(([, set]) => set.size >= SHARED_WINGET_ICON).map(([url]) => url));
}

export interface IconChoice {
  /** Kandidáti ze zdrojů (manifest wingetu, UniGetUI, Chocolatey). */
  candidates: string[];
  /** Web aplikace – prohledá se, když žádný kandidát není ostrý. */
  site: string | null;
}

/**
 * Každé aplikaci vybere nejostřejší ikonu: změří kandidáty ze zdrojů, aplikacím
 * bez ostré ikony prohledá i jejich web. Bez použitelné ikony zůstane iconUrl
 * prázdné a aplikace ukáže avatar s iniciálami (nebo ikonu nainstalovaného programu).
 */
export async function chooseSharpIcons(packages: CatalogEntry[], choices: Map<string, IconChoice>) {
  const generic = genericWingetIcons(packages, choices);
  if (generic.size) {
    for (const choice of choices.values()) choice.candidates = choice.candidates.filter((url) => !generic.has(url));
    log.info(`ikony: ${generic.size} výchozích ikon instalátoru z CDN wingetu (sdílí je ≥ ${SHARED_WINGET_ICON} vydavatelé) vyřazeno`);
  }
  const sizes = await measureIcons([...choices.values()].flatMap((c) => c.candidates));
  const sharpFromSources = (c: IconChoice) => c.candidates.some((url) => iconPixels(sizes.get(url)) >= SHARP_ICON);

  // Weby se stránkami víc aplikací z katalogu – jejich ikona patří webu
  const appsPerHost = new Map<string, number>();
  for (const p of packages) {
    const host = hostOf(p.homepage);
    if (host) appsPerHost.set(host, (appsPerHost.get(host) ?? 0) + 1);
  }
  const ownSite = (c: IconChoice) => !!c.site && (appsPerHost.get(hostOf(c.site) ?? "") ?? 0) < SHARED_WEB_ICON;

  const needWeb = [...choices.values()].filter((c) => ownSite(c) && !sharpFromSources(c));
  const web = await webIcons(needWeb.map((c) => c.site!));
  const uses = new Map<string, number>();
  for (const c of needWeb) for (const url of web.get(c.site!) ?? []) uses.set(url, (uses.get(url) ?? 0) + 1);
  const ownWebIcons = (c: IconChoice) => (ownSite(c) ? (web.get(c.site!) ?? []).filter((url) => (uses.get(url) ?? 0) < SHARED_WEB_ICON) : []);
  for (const [url, size] of await measureIcons(needWeb.flatMap(ownWebIcons))) sizes.set(url, size);

  const counts = { sharp: 0, usable: 0, unknown: 0, fromWeb: 0, none: 0, dropped: 0 };
  for (const entry of packages) {
    const choice = choices.get(entry.id);
    if (!choice) continue; // ruční ikona z curated.json
    const fromWeb = ownWebIcons(choice);
    const picked = pickSharpIcon(choice.candidates, sizes, fromWeb);
    if (!picked && choice.candidates.length) counts.dropped++;
    if (picked && fromWeb.includes(picked)) counts.fromWeb++;
    const size = picked ? sizes.get(picked) : null;
    if (!picked) counts.none++;
    else if (size === undefined) counts.unknown++;
    else if (iconPixels(size) >= SHARP_ICON) counts.sharp++;
    else counts.usable++;
    entry.iconUrl = picked;
  }
  log.info(
    `ikony: ${counts.sharp} ostrých (≥ ${SHARP_ICON} px nebo SVG), ${counts.usable} menších (${MIN_ICON}–${SHARP_ICON - 1} px), ` +
      `${counts.unknown} nezměřených (server nedostupný), ${counts.fromWeb} z webu aplikace, ` +
      `${counts.none} bez ikony (z toho ${counts.dropped} s malou nebo nefunkční ikonou → avatar)`,
  );
}
