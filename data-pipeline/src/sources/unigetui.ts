/**
 * Komunitní databáze ikon a screenshotů projektu UniGetUI (MIT, Devolutions):
 * jeden soubor JSON, klíčem je zjednodušené id balíčku („vlc“, „firefox“,
 * „obs-studio“, „notepadplusplus“…). Obrázky se jen odkazují, nekopírují.
 */
import { MAX_AGE, UNIGETUI_SCREENSHOTS_URL } from "../config.ts";
import { fetchJson } from "../lib/http.ts";
import { log } from "../lib/log.ts";

interface UnigetDatabase {
  icons_and_screenshots?: Record<string, { icon?: string; images?: string[] }>;
}

/** Ikony a screenshoty podle klíče (jen položky, které je mají). */
export interface UnigetData {
  icons: Map<string, string>;
  screenshots: Map<string, string[]>;
}

export async function loadUnigetData(): Promise<UnigetData> {
  const data: UnigetData = { icons: new Map(), screenshots: new Map() };
  try {
    const db = await fetchJson<UnigetDatabase>(UNIGETUI_SCREENSHOTS_URL, { maxAge: MAX_AGE.unigetui });
    for (const [rawKey, value] of Object.entries(db?.icons_and_screenshots ?? {})) {
      const key = rawKey.toLowerCase();
      if (typeof value.icon === "string" && value.icon.trim()) data.icons.set(key, value.icon.trim());
      const images = (value.images ?? []).filter((u) => typeof u === "string" && u.trim());
      if (images.length) data.screenshots.set(key, images);
    }
    log.info(`UniGetUI: ikony u ${data.icons.size} balíčků, screenshoty u ${data.screenshots.size}`);
  } catch (e) {
    // Bez nich se katalog sestaví i tak
    log.warn(`UniGetUI: databázi ikon a screenshotů se nepodařilo načíst (${e instanceof Error ? e.message : e})`);
  }
  return data;
}

/**
 * Klíče, pod kterými může být aplikace v databázi UniGetUI: id z Chocolatey
 * (bez .install / .portable), název ze Scoopu, id wingetu bez vydavatele
 * („VideoLAN.VLC“ → „vlc“) a název aplikace („OBS Studio“ → „obs-studio“, „obsstudio“).
 */
export function unigetKeys(ids: { chocolatey?: string; scoop?: string; winget?: string }, name: string): string[] {
  const keys: string[] = [];
  const add = (key: string | undefined) => {
    const k = key?.toLowerCase().trim();
    if (k && !keys.includes(k)) keys.push(k);
  };
  add(ids.chocolatey?.replace(/\.(install|portable|app)$/i, ""));
  add(ids.scoop?.split("/").pop());
  if (ids.winget) {
    const tail = ids.winget.split(".").slice(1).join(".");
    add(tail);
    add(tail.replace(/\./g, "-"));
  }
  const lower = name.toLowerCase();
  add(nameSlug(lower));
  add(lower.replace(/[^a-z0-9]+/g, ""));
  return keys;
}

const nameSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, "-")
    .replace(/^-+|-+$/g, "");
const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Aplikace z pohledu klíčů UniGetUI – podle id, webu a vydavatele se pozná, kdo klíč vlastní. */
export interface UnigetApp {
  id: string;
  name: string;
  keys: string[];
  popularity: number;
  wingetId?: string;
  chocoId?: string;
  homepage?: string | null;
  publisher?: string;
  /** Klíče, které aplikaci přidělil curated.json – rozhodují před pravidly níže. */
  owns?: string[];
}

const CODE_HOSTS = new Set(["github.com", "gitlab.com", "sourceforge.net", "codeberg.org", "bitbucket.org"]);
/** Slova, která v adrese obrázku vlastníka neprozradí (hostingy, obecné části názvů vydavatelů). */
const WEAK_TOKENS = new Set(["github", "gitlab", "sourceforge", "codeberg", "bitbucket", "apps", "team", "project", "games", "labs", "media", "group", "community", "developers", "contributors", "open", "free"]);
const LEGAL_FORMS = /\b(inc|corp|corporation|ltd|llc|gmbh|co|limited|software|technologies|the)\b\.?/gi;
/** Kolikrát populárnější musí být aplikace přesně toho jména než další stejnojmenná. */
const CLEAR_LEAD = 3;

/** Web aplikace: doména (bez www a subdomén), u hostingu kódu i vlastník repozitáře. */
function siteOf(homepage: string | null | undefined): { key: string; name: string } | null {
  try {
    const url = new URL(homepage ?? "");
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const owner = url.pathname.split("/")[1]?.toLowerCase() ?? "";
    if (CODE_HOSTS.has(host)) return owner ? { key: `${host}/${owner}`, name: owner } : null;
    if (host.endsWith(".github.io")) return { key: `github.com/${host.split(".")[0]}`, name: host.split(".")[0] };
    const labels = host.split(".");
    // example.co.uk, example.com.au – registrovaná doména má tři části
    const take = labels.length >= 3 && /^(co|com|org|net|ac|gov|edu)$/.test(labels.at(-2)!) ? 3 : 2;
    if (labels.length < take) return null;
    return { key: labels.slice(-take).join("."), name: labels.at(-take)! };
  } catch {
    return null;
  }
}

/** Stopy vlastníka (předpona id ve wingetu, web, vydavatel) a slova, podle kterých ho jde poznat v adrese obrázku. */
function ownerOf(app: UnigetApp): { tokens: string[]; words: string[] } {
  const tokens: string[] = [];
  const words: string[] = [];
  if (app.wingetId?.includes(".")) {
    const prefix = flat(app.wingetId.split(".")[0]);
    tokens.push(`w:${prefix}`);
    words.push(prefix);
  }
  const site = siteOf(app.homepage);
  if (site) {
    tokens.push(`s:${site.key}`);
    words.push(flat(site.name));
  }
  const publisher = flat((app.publisher ?? "").replace(LEGAL_FORMS, ""));
  if (publisher.length >= 3) {
    tokens.push(`p:${publisher}`);
    words.push(publisher);
  }
  return { tokens: tokens.length ? tokens : [`a:${app.id}`], words: [...new Set(words)].filter((w) => w.length >= 4 && !WEAK_TOKENS.has(w)) };
}

/** Id balíčku Chocolatey z adresy jeho obrázku (…/packageimages/goldendict.install.1.0.1.png → goldendict). */
const chocoImagePackage = (url: string) =>
  /community\.chocolatey\.org\/content\/packageimages\/(.+?)\.\d/i.exec(url)?.[1]?.toLowerCase().replace(/\.(install|portable|app)$/, "");
const chocoBase = (id: string | undefined) => id?.toLowerCase().replace(/\.(install|portable|app)$/, "");

/**
 * Klíče databáze UniGetUI nemají vydavatele („Devolutions.Launcher“ → launcher), takže je
 * vytvoří i úplně jiné aplikace stejného jména: ikonu Rockstar Games Launcher měly všechny
 * „Launcher“, obrázek balíčku „studio“ z Chocolatey všechna „Studio“. Klíč, který vytvoří
 * aplikace víc vlastníků (spojených předponou id ve wingetu, webem nebo vydavatelem),
 * platí jen pro tu, které obrázek prokazatelně patří:
 *  0. aplikaci, které klíč přidělil curated.json (Microsoft Teams × Busylight for Teams),
 *  1. obrázek balíčku Chocolatey – aplikaci s tímto balíčkem,
 *  2. jinak aplikaci, jejíhož vlastníka adresa obrázku zmiňuje (rockstar-games-….png),
 *  3. jinak aplikaci přesně toho jména – jediné, nebo výrazně nejpopulárnější (git × Microsoft Git),
 *  4. jinak nikomu.
 * Vrací: smí aplikace použít obrázky (ikonu / screenshoty) pod tímto klíčem?
 */
export function unigetOwnership(apps: UnigetApp[]): (app: UnigetApp, key: string, urls: string[]) => boolean {
  const owners = new Map(apps.map((app) => [app.id, ownerOf(app)]));
  // Vlastníci: aplikace se společnou stopou patří k sobě (Discord.Discord a Discord.Discord.PTB, web + vydavatel…)
  const parent = new Map<string, string>();
  const root = (token: string): string => {
    let r = token;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(token, r);
    return r;
  };
  for (const { tokens } of owners.values()) {
    for (const token of tokens) if (!parent.has(token)) parent.set(token, token);
    for (const token of tokens.slice(1)) parent.set(root(token), root(tokens[0]));
  }
  const producers = new Map<string, UnigetApp[]>();
  for (const app of apps) for (const key of app.keys) producers.set(key, [...(producers.get(key) ?? []), app]);
  const shared = (key: string) => new Set((producers.get(key) ?? []).map((app) => root(owners.get(app.id)!.tokens[0]))).size > 1;

  const decided = new Map<string, Set<string>>();
  const allowed = (key: string, urls: string[]): Set<string> => {
    const cacheKey = `${key}\n${urls[0] ?? ""}`;
    const known = decided.get(cacheKey);
    if (known) return known;
    const candidates = producers.get(key) ?? [];
    let chosen = candidates.filter((app) => app.owns?.includes(key));
    const chocoPackage = urls[0] && chocoImagePackage(urls[0]);
    if (!chosen.length && chocoPackage) {
      chosen = candidates.filter((app) => chocoBase(app.chocoId) === chocoPackage);
    } else if (!chosen.length) {
      const text = flat(urls.join(" "));
      chosen = candidates.filter((app) => owners.get(app.id)!.words.some((word) => text.includes(word)));
      if (!chosen.length) {
        const exact = candidates.filter((app) => nameSlug(app.name) === key || flat(app.name) === key).sort((a, b) => b.popularity - a.popularity);
        if (exact.length === 1 || (exact.length > 1 && exact[0].popularity >= CLEAR_LEAD * Math.max(1, exact[1].popularity))) chosen = [exact[0]];
      }
    }
    const result = new Set(chosen.map((app) => app.id));
    decided.set(cacheKey, result);
    return result;
  };

  return (app, key, urls) => !shared(key) || allowed(key, urls).has(app.id);
}
