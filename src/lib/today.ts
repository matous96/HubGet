/**
 * Dnešní výběr pro sekci „Dnes“ na domovské stránce. Kromě ručně psaných
 * příběhů a kolekcí (data/editorial.ts) bere i známé aplikace z celého
 * katalogu, aby se obsah neopakoval po pár dnech:
 *  - známá aplikace = populární nebo s mnoha hvězdami na GitHubu, s ikonou
 *    a popisem, bez balastu (opravy Windows, knihovny, agenti…), mezi 400
 *    nejpopulárnějšími (běžný uživatel bez nástrojů pro vývojáře a správce),
 *  - velký příběh: každý 4. den ručně psaný, jinak tip na známou aplikaci,
 *  - kolekce: ručně psané a výběry z kategorií – pokaždé jiná šestice
 *    z 30 nejoblíbenějších aplikací kategorie,
 *  - aplikace dne: známá ověřená aplikace (s fajkou), která dnes není
 *    v příběhu ani v kolekcích,
 *  - automaticky vybrané aplikace jen s ikonou ve vysokém rozlišení (aspoň
 *    256 px nebo vektor) – v sekci Dnes jsou ikony velké.
 * Pro daný den je výběr vždy stejný (číslo dne); sousední dny jsou od sebe
 * v seznamu daleko a nic se nezopakuje, dokud se neprojde celý seznam.
 * Pořadí nezávisí na tom, které ikony už jsou změřené – malá ikona se jen
 * přeskočí. Jinak by každé nové měření (na novém počítači desítky za sekundu)
 * přepočítalo celé pořadí a karty by přeskakovaly na úplně jiné aplikace.
 * Šipky na kartách listují výběry dalších / předchozích dní – každá karta zvlášť;
 * aplikace dne je jedna na celý den a nelistuje se.
 */
import { APP_STORIES, COLLECTIONS, PROFILE_COLLECTIONS, dayIndex, type AppStory, type CollectionStory } from "@/data/editorial";
import { CATEGORIES, categoryColor } from "@/data/categories";
import i18n from "@/i18n";
import { isVerified } from "@/lib/verified";
import { getSource } from "@/services/managers";
import type { CatalogEntry, CategoryId } from "@/types";

/** Kolik nejpopulárnějších aplikací se počítá mezi „známé“. */
const KNOWN = 400;
/** Velikost výběru z kategorie a z kolika nejoblíbenějších se vybírá. */
const CHUNK = 6;
const CATEGORY_TOP = 30;
/** Každý kolikátý den je velký příběh ručně psaný. */
const HANDWRITTEN_EVERY = 4;

export interface TodayPicks {
  story: AppStory;
  storyEntry: CatalogEntry | undefined;
  collections: { story: CollectionStory; entries: CatalogEntry[] }[];
  appOfDay: CatalogEntry | undefined;
  /** Vybrané aplikace a další kandidáti, u kterých ještě není změřené rozlišení ikony. */
  unmeasured: CatalogEntry[];
  /** Zobrazované automaticky vybrané aplikace s ještě nezměřenou ikonou – výběr se může posunout. */
  unsettled: CatalogEntry[];
}

/** Nejmenší rozlišení ikony (px) pro sekci Dnes – ikony se tu ukazují velké. */
export const SHARP_ICON = 256;

/** Posun karet sekce Dnes při listování (o kolik „dní“ dopředu / dozadu); aplikace dne se nelistuje. */
export interface TodayShift {
  story: number;
  collections: [number, number];
}
export const NO_SHIFT: TodayShift = { story: 0, collections: [0, 0] };

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** Zbytek po dělení i pro záporná čísla (listování dozadu). */
const mod = (value: number, n: number) => ((value % n) + n) % n;

/**
 * Prvek seznamu pro den: krok přes seznam ≈ zlatý řez jeho délky (nesoudělný
 * s ní) – sousední dny vyberou vzdálené prvky a každý přijde na řadu jednou,
 * než se začne znovu.
 */
function dailyOrder<T>(pool: T[], day: number, skip: (item: T) => boolean = () => false): T[] {
  const n = pool.length;
  if (!n) return [];
  let step = Math.max(1, Math.round(n * 0.618));
  while (gcd(step, n) !== 1) step++;
  // Obsazený prvek (dnes už jinde, malá ikona) → další v seznamu; seznam se nemění, takže se dny neposouvají
  const start = mod(day * step, n);
  return Array.from({ length: n }, (_, i) => pool[(start + i) % n]).filter((item) => !skip(item));
}

/** Kolik dalších kandidátů změřit předem (kdyby vybraný měl malou ikonu) – každý je jedno stažení. */
const LOOKAHEAD = 2;

/**
 * Známá aplikace: popularita v katalogu (0–100) aspoň tolik, nebo tolik hvězd
 * na GitHubu (Joplin, Logseq… mají nižší popularitu, ale zná je každý).
 * Ověření vydavatele samo nestačí – ověřené bývají i málo známé nástroje.
 */
const KNOWN_POPULARITY = 72;
const KNOWN_STARS = 10_000;
/** Hvězdy se počítají až od této popularity (jinak by prošly knihovny s mnoha hvězdami). */
const STARS_MIN_POPULARITY = 60;
/** Aplikace bez kategorie (často nástroje příkazové řádky) se ukáže jen s vyšší popularitou. */
const UNCATEGORIZED_POPULARITY = 75;

/** Opravy Windows, knihovny a běhová prostředí, agenti, ovladače, testovací verze… – na titulní stránku nepatří. */
const NOT_SHOWCASE =
  /\bKB\d{6,}|security update|security advisory|vulnerability|update for|system update|command \| update|\bdrivers?\b|\bruntime\b|redistributable|\bsdk\b|\bcli\b|\bagent\b|\bhost\b|bootstrapper|build tools|workload|help pack|deprecated|\beol\b|\(install\)|machine-wide|flash player|shockwave|plug-?in\b|\.net\b|dot net|\b(beta|dev|developer|nightly|canary|insider|preview)\b/i;

/** Štítky nástrojů pro vývojáře a správce (cloud, terminál, databáze…) – běžnému uživateli se na titulní stránce nenabízejí. */
const ADMIN_TAG =
  /^(azure|aws|gcp|cloud|hashicorp|terraform|kubernetes|kubectl|docker|devops|cli|command-line|terminal|shell|ssh|telnet|sql|database|elasticsearch|kibana|developing|development|programming|sdk|api|compiler|git|server|infrastructure)$/i;

/** Servery a databáze, které štítky neoznačují (Elasticsearch…). */
const ADMIN_NAME = /\b(elasticsearch|kibana|logstash|mongodb|redis|mysql|mariadb|postgresql|sql server)\b/i;

const devOnly = (e: CatalogEntry) => e.sources.length > 0 && e.sources.every((s) => getSource(s.source).group === "dev");

const known = (e: CatalogEntry) =>
  e.popularity >= KNOWN_POPULARITY || ((e.githubStars ?? 0) >= KNOWN_STARS && e.popularity >= STARS_MIN_POPULARITY);

/** Pro běžného uživatele: bez vývojářských kategorií, nástrojů pro správce a málo známých aplikací bez kategorie. */
const forRegularUser = (e: CatalogEntry) =>
  !e.categories.includes("development") &&
  !e.tags.some((tag) => ADMIN_TAG.test(tag)) &&
  !ADMIN_NAME.test(e.name) &&
  (e.categories.length > 0 || e.popularity >= UNCATEGORIZED_POPULARITY);

/** Hodí se aplikace na titulní stránku? Známá, s ikonou a popisem, bez balastu (NOT_SHOWCASE). */
const showcase = (e: CatalogEntry, developer: boolean) =>
  !!e.iconUrl && !!e.description && !devOnly(e) && known(e) && !NOT_SHOWCASE.test(e.name) && (developer || forRegularUser(e));
const byPopularity = (a: CatalogEntry, b: CatalogEntry) => b.popularity - a.popularity || a.id.localeCompare(b.id);

/** Krátký podtitulek z popisu aplikace (první věta, nejvýš ~120 znaků). */
function shortText(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length <= 120 ? sentence : `${sentence.slice(0, 117).trimEnd()}…`;
}

/** Tip na známou aplikaci jako velký příběh (texty v aktuálním jazyce). */
function spotlight(entry: CatalogEntry, day: number): AppStory {
  const category = entry.categories[0];
  return {
    kind: "app",
    id: `spotlight-${entry.id}`,
    appId: entry.id,
    eyebrow: { cs: category ? i18n.t(`categories.${category}`) : i18n.t("home.spotlight.eyebrow") },
    title: { cs: i18n.t(`home.spotlight.title${day % 3}`, { name: entry.name }) },
    subtitle: { cs: shortText(entry.description) },
  };
}

/**
 * Výběr z kategorie: `round` = kolikrát už kolekce přišla na řadu – pokaždé jiná šestice.
 * Šestice se určí z celého seznamu `top` (nezávisle na měření ikon); aplikace s malou
 * ikonou nahradí další z kategorie, ostatní zůstanou na místě.
 */
function categoryCollection(
  category: CategoryId,
  top: CatalogEntry[],
  round: number,
  blurry: (e: CatalogEntry) => boolean,
): { story: CollectionStory; entries: CatalogEntry[] } {
  const chunks = Math.max(1, Math.floor(top.length / CHUNK));
  const start = (round % chunks) * CHUNK;
  const rotated = [...top.slice(start), ...top.slice(0, start)];
  const entries = rotated.filter((e) => !blurry(e)).slice(0, CHUNK);
  const name = i18n.t(`categories.${category}`);
  return {
    story: {
      kind: "collection",
      id: `category-${category}-${start}`,
      eyebrow: { cs: i18n.t("home.categoryCollection.eyebrow") },
      title: { cs: i18n.t("home.categoryCollection.title", { category: name }) },
      subtitle: { cs: i18n.t("home.categoryCollection.subtitle", { names: entries.slice(0, 3).map((e) => e.name).join(", ") }) },
      description: { cs: i18n.t("home.categoryCollection.description", { category: name }) },
      appIds: entries.map((e) => e.id),
      color: categoryColor(category),
    },
    entries,
  };
}

/** Ručně psané kolekce v sekci Dnes první den (běžný uživatel / režim Vývojář). */
const WELCOME_COLLECTIONS = { regular: ["new-pc", "focus"], developer: ["dev-setup", "new-pc"] };

/** Všechny aplikace z redakčního obsahu – jejich ikony jsou přibalené k instalaci (scripts/first-run-icons.mjs). */
const EDITORIAL_APPS = [
  ...APP_STORIES.map((s) => s.appId),
  ...[...COLLECTIONS, ...PROFILE_COLLECTIONS].flatMap((c) => c.appIds),
];

/**
 * Dnešní příběh, dvě kolekce a aplikace dne. `iconSize` = změřené rozlišení
 * ikony (store/iconQuality.ts), undefined = ještě neznámé: aplikace s malou
 * ikonou se v tipech, výběrech z kategorií a aplikaci dne přeskočí, neznámé
 * se vrátí v `unmeasured` ke změření (pak se výběr případně posune dál).
 *
 * `firstRun` = první den po instalaci: jen ručně psaný obsah (příběh, kolekce
 * Nový počítač…, aplikace dne z redakčních aplikací), jehož ikony jsou přibalené –
 * sekce se ukáže hned, bez stahování a měření ikon. Listování šipkami vede na
 * běžný denní výběr.
 */
export function todayPicks(
  all: CatalogEntry[],
  index: Map<string, CatalogEntry>,
  developer: boolean,
  iconSize: (entry: CatalogEntry) => number | undefined = () => undefined,
  date = new Date(),
  shift: TodayShift = NO_SHIFT,
  firstRun = false,
): TodayPicks {
  const day = dayIndex(date);
  const resolve = (ids: string[]) => ids.map((id) => index.get(id)).filter((e): e is CatalogEntry => !!e);
  const blurry = (e: CatalogEntry) => {
    const size = iconSize(e);
    return size !== undefined && size < SHARP_ICON;
  };
  const usable = all.filter((e) => showcase(e, developer)).sort(byPopularity);
  const known = usable.slice(0, KNOWN);
  const handwritten = APP_STORIES.filter((s) => index.has(s.appId));
  // Ostatní (aplikace bez kategorie) jako téma dne nedává smysl. Kategorie s málo známými aplikacemi
  // (malé nové – Finance, Přizpůsobení – nebo katalog, který je ještě nezná) by dala prázdnou kartu,
  // která se skryje – do střídání patří jen ty, ze kterých jde poskládat celý výběr (bez ohledu na
  // ikony, ať se pořadí nemění, jak se měří)
  const categories = CATEGORIES.map((c) => c.id).filter(
    (id) => id !== "other" && (developer || id !== "development") && usable.filter((e) => e.categories.includes(id)).length > CHUNK,
  );
  const sources = [
    ...COLLECTIONS.filter((c) => resolve(c.appIds).length > 0).map((c) => ({ kind: "fixed" as const, story: c })),
    ...categories.map((id) => ({ kind: "category" as const, id })),
  ];

  /** Příběh a dvě kolekce pro daný posun (listování šipkami – každá karta ukáže výběr jiného dne). */
  const cards = (s: TodayShift) => {
    // Velký příběh: ručně psaný, nebo tip na známou aplikaci (první den jen ručně psaný)
    const storyDay = day + s.story;
    const welcomeStory = firstRun && s.story === 0;
    const spotlightOrder = !welcomeStory && mod(storyDay, HANDWRITTEN_EVERY) !== 0 ? dailyOrder(known, storyDay, blurry) : [];
    const story = spotlightOrder[0]
      ? spotlight(spotlightOrder[0], storyDay)
      : (handwritten[mod(welcomeStory ? day : Math.floor(storyDay / HANDWRITTEN_EVERY), Math.max(1, handwritten.length))] ?? APP_STORIES[0]);

    // Kolekce: ručně psané + výběry z kategorií (běžný uživatel bez vývojářských)
    const welcome = (slot: 0 | 1) => {
      const id = WELCOME_COLLECTIONS[developer ? "developer" : "regular"][slot];
      const fixed = COLLECTIONS.find((c) => c.id === id);
      return fixed && firstRun && s.collections[slot] === 0 ? { story: fixed, entries: resolve(fixed.appIds) } : undefined;
    };
    const pick = (position: number) => {
      // Katalog se ještě načítá (prázdný seznam) – žádná kolekce, karta se neukáže
      if (!sources.length) return { story: COLLECTIONS[0], entries: [] as CatalogEntry[] };
      const source = sources[mod(position, sources.length)];
      if (source.kind === "fixed") return { story: source.story, entries: resolve(source.story.appIds) };
      const top = usable.filter((e) => e.categories.includes(source.id) && e.id !== story.appId).slice(0, CATEGORY_TOP);
      return { ...categoryCollection(source.id, top, Math.floor(position / sources.length), blurry), generated: true };
    };
    // Druhá kolekce o půl seznamu dál; když ji listování dovede na stejnou jako první, vezme další
    const first = day + s.collections[0];
    let second = day + s.collections[1] + Math.max(1, Math.floor(sources.length / 2));
    if (mod(second, sources.length) === mod(first, sources.length)) second += s.collections[1] < 0 ? -1 : 1;
    return { story, spotlightOrder, collections: [welcome(0) ?? pick(first), welcome(1) ?? pick(second)] };
  };

  const { story, spotlightOrder, collections } = cards(shift);

  // Aplikace dne: jedna na celý den (bez listování) – známá ověřená aplikace (fajka u názvu),
  // která není v dnešním příběhu ani kolekcích; listování ostatních karet ji nemění.
  // První den z redakčních aplikací (přibalené ikony).
  const unshifted = shift === NO_SHIFT ? { story, collections } : cards(NO_SHIFT);
  const used = new Set([unshifted.story.appId, ...unshifted.collections.flatMap((c) => c.entries.map((e) => e.id))]);
  const appOfDayOrder = firstRun
    ? dailyOrder(
        resolve([...new Set(EDITORIAL_APPS)]).filter((e) => isVerified(e)),
        day + 7,
        (e) => used.has(e.id),
      )
    : dailyOrder(
        known.filter((e) => isVerified(e)),
        day + 7,
        (e) => used.has(e.id) || blurry(e),
      );
  const appOfDay = appOfDayOrder[0];

  // Automaticky vybrané aplikace na kartách (ručně psané ani první den se neměří)
  const generated = collections.flatMap((c) => ("generated" in c ? c.entries : []));
  const measuredAppOfDay = firstRun ? [] : appOfDayOrder;
  const shown = [spotlightOrder[0], measuredAppOfDay[0], ...generated].filter((e): e is CatalogEntry => !!e);
  const notMeasured = (e: CatalogEntry) => iconSize(e) === undefined;
  // Ke změření i další kandidáti, ať se výběr po jednom měření ustálí
  const candidates = [...spotlightOrder.slice(0, LOOKAHEAD), ...measuredAppOfDay.slice(0, LOOKAHEAD), ...generated];

  return {
    story,
    storyEntry: index.get(story.appId),
    collections: collections.map(({ story, entries }) => ({ story, entries })),
    appOfDay,
    unmeasured: [...new Set(candidates.filter(notMeasured))],
    unsettled: [...new Set(shown.filter(notMeasured))],
  };
}
