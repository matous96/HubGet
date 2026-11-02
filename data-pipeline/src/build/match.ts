/**
 * Párování balíčků napříč správci do jedné karty aplikace.
 *
 * Základem je winget. Balíček z Chocolatey / Scoopu se k balíčku wingetu
 * přiřadí podle signálů s různou váhou:
 *  - 100  shoda s „monikerem“ wingetu (krátké jméno: firefox, vscode, vlc),
 *   85  stejný název („Mozilla Firefox“ = „Mozilla Firefox (en-US)“),
 *   75  shoda s celým id wingetu („googlechrome“ = „Google.Chrome“),
 *   70  stejný název bez přívěsků („Signal Desktop“ = „Signal“, „Zoom Client“ = „Zoom“),
 *   60  shoda s poslední částí id („git“ = „Git.Git“).
 * Web balíčku (Chocolatey projectUrl, Scoop homepage) rozhodne mezi stejně
 * pojmenovanými aplikacemi: patří-li jasně jinému vlastníkovi než balíček wingetu,
 * spojení se zamítne, patří-li stejnému, dostane přednost (+30, i před monikerem).
 * Chocolatey a Scoop bez wingetu se párují podle id, názvu a webu aplikace.
 * Přiřazuje se hladově od nejsilnějších shod; každý balíček wingetu může mít
 * nejvýš jeden protějšek z každého správce. Co se nespáruje, je samostatná karta.
 */
import { wingetVariant } from "../../../src/lib/wingetVariant.ts";
import type { ChocoPackage } from "../sources/chocolatey.ts";
import type { ScoopPackage } from "../sources/scoop.ts";
import type { WingetIndexEntry } from "../sources/winget.ts";
import { cleanName, nameKey, normalize, siteKey, trimmedNameKey } from "../lib/text.ts";

export interface AppRecord {
  winget?: WingetIndexEntry;
  /** Varianty balíčku wingetu (jazyk, typ instalátoru) sloučené do této karty. */
  wingetVariants?: WingetIndexEntry[];
  choco?: ChocoPackage;
  scoop?: ScoopPackage;
}

interface Edge {
  /** Index balíčku v jeho zdroji. */
  from: number;
  /** Cíl (index balíčku wingetu, resp. záznamu Chocolatey). */
  to: number;
  score: number;
}

/** Index pro rychlé hledání podle klíče. */
function indexBy<T>(items: T[], keys: (item: T) => (string | null | undefined)[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  items.forEach((item, i) => {
    for (const key of new Set(keys(item))) {
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(i);
      else map.set(key, [i]);
    }
  });
  return map;
}

/** Hladové přiřazení: hrany od nejsilnější, každý zdroj i cíl nejvýš jednou. */
function assign(edges: Edge[]): Map<number, number> {
  edges.sort((a, b) => b.score - a.score);
  const usedFrom = new Set<number>();
  const usedTo = new Set<number>();
  const result = new Map<number, number>();
  for (const e of edges) {
    if (usedFrom.has(e.from) || usedTo.has(e.to)) continue;
    usedFrom.add(e.from);
    usedTo.add(e.to);
    result.set(e.from, e.to);
  }
  return result;
}

/**
 * Základní id a přípona varianty balíčku wingetu, nebo null:
 *  - jazyk („Mozilla.Firefox.cs“, „Mozilla.Firefox.en-GB“ → „Mozilla.Firefox“),
 *  - jiný typ instalátoru („Google.Chrome.EXE“, „Mozilla.Firefox.MSIX“,
 *    „KDE.Kate.appx“ → „Google.Chrome“, …).
 * Krátké přípony, které jazykem nejsou („.dev“, „.cli“, „.pro“…), jsou
 * samostatné balíčky. Stejné pravidlo používá aplikace (src/lib/wingetVariant.ts).
 */
export { wingetBaseId, wingetVariant } from "../../../src/lib/wingetVariant.ts";

/**
 * Varianty balíčku (jazyk, typ instalátoru) nedostanou vlastní kartu, pokud
 * existuje základní balíček – jinak by vznikly desítky karet stejné aplikace.
 * Do karty základního balíčku se připojí jako varianty (výběr ve volbách
 * instalace), takže katalog obsahuje všechny balíčky wingetu.
 */
export function dedupeWinget(entries: WingetIndexEntry[]): { entries: WingetIndexEntry[]; variants: Map<string, WingetIndexEntry[]> } {
  const ids = new Set(entries.map((e) => e.id.toLowerCase()));
  const variants = new Map<string, WingetIndexEntry[]>();
  const kept = entries.filter((e) => {
    const variant = wingetVariant(e.id);
    if (!variant || !ids.has(variant.base.toLowerCase())) return true;
    const key = variant.base.toLowerCase();
    variants.set(key, [...(variants.get(key) ?? []), e]);
    return false;
  });
  return { entries: kept, variants };
}

/** Pomocné balíčky Chocolatey, které nejsou aplikacemi (rozšíření, šablony). */
const isChocoHelper = (id: string) => /\.(extension|template)$/i.test(id) || /^chocolatey-/i.test(id);

/**
 * Chocolatey má často trojici „app“ (meta), „app.install“ a „app.portable“.
 * Ponechá se základní balíček; varianta jen tehdy, když základní neexistuje.
 */
export function dedupeChoco(packages: ChocoPackage[]): ChocoPackage[] {
  const ids = new Set(packages.map((p) => p.id.toLowerCase()));
  const kept = new Map<string, ChocoPackage>();
  for (const p of packages) {
    if (isChocoHelper(p.id)) continue;
    const base = p.id.toLowerCase().replace(/\.(install|portable)$/, "");
    if (base !== p.id.toLowerCase() && ids.has(base)) continue; // existuje základní balíček
    const existing = kept.get(base);
    // Z .install a .portable ponechat ten stahovanější
    if (!existing || p.downloadCount > existing.downloadCount) kept.set(base, p);
  }
  return [...kept.values()];
}

/** Scoop: stejná aplikace ve více bucketech → první podle pořadí bucketů (main > extras > …). */
export function dedupeScoop(packages: ScoopPackage[]): ScoopPackage[] {
  const kept = new Map<string, ScoopPackage>();
  for (const p of packages) if (!kept.has(p.name.toLowerCase())) kept.set(p.name.toLowerCase(), p);
  return [...kept.values()];
}

const chocoBase = (id: string) => id.toLowerCase().replace(/\.(install|portable)$/, "");
const idTail = (id: string) => id.split(".").pop() ?? id;

/** Klíče názvu pro párování – „+“ se počítá: „Notepad++“ ≠ „Notepad--“ (nameKey by z obou udělal „notepad“). */
const plus = (text: string) => text.replace(/\+/g, " plus ");
const matchKey = (text: string) => nameKey(plus(text));
const matchTrimmed = (text: string) => trimmedNameKey(plus(text));

const flat = (text: string) => normalize(text).replace(/[^a-z0-9]/g, "");
const CODE_HOSTS = new Set(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org", "gitee.com"]);
/** Hostingy, kde projekt nebo autora určuje subdoména (gnuwin32.sourceforge.net, sabrogden.github.io, fixounet.free.fr). */
const SUBDOMAIN_HOSTS =
  /\.(github\.io|gitlab\.io|sourceforge\.net|sourceforge\.io|readthedocs\.io|netlify\.app|vercel\.app|pages\.dev|codeplex\.com|itch\.io|free\.fr|xs4all\.nl|blogspot\.com|wordpress\.com|tuxfamily\.org)$/;
/** Weby, které o vlastníkovi nic neřeknou (sociální sítě, obchody, registry balíčků, katalogy software). */
const NO_OWNER_HOSTS =
  /(^|\.)(discord\.gg|discord\.com|t\.me|twitter\.com|x\.com|youtube\.com|youtu\.be|reddit\.com|facebook\.com|linkedin\.com|patreon\.com|ko-fi\.com|buymeacoffee\.com|play\.google\.com|apps\.apple\.com|apps\.microsoft\.com|npmjs\.com|pypi\.org|crates\.io|lib\.rs|docs\.rs|nuget\.org|chocolatey\.org|wikipedia\.org|softpedia\.com|filehippo\.com|majorgeeks\.com|informer\.com|uptodown\.com|bit\.ly|goo\.gl)$/;
/** Dokumentace balíčků Go: adresa obsahuje repozitář (godoc.org/github.com/gokcehan/lf). */
const GO_DOCS = new Set(["godoc.org", "pkg.go.dev"]);
/** Části adres a názvů, které nic neprozradí. */
const WEAK = new Set([
  "www", "web", "app", "apps", "download", "downloads", "docs", "home", "blog", "get", "en", "us", "github", "archive", "sourceforge",
  "codeplex", "sites", "projects", "products", "product", "software", "tools", "cli", "client", "desktop", "studio", "launcher", "server",
  "tool", "editor", "browser", "player", "manager", "core", "lite", "pro", "sync", "connect", "tunnel", "portable",
]);
const LEGAL_FORMS = /\b(inc|corp|corporation|ltd|llc|gmbh|co|limited|software|technologies|the)\b\.?/g;

/**
 * Stopy webu nebo balíčku: vlastník (účet, doména, autor), produkt (repozitář, stránka
 * produktu) a subdomény, které se počítají jen při přesné shodě s produktem
 * (klogg.filimonov.dev = klogg, ale spark.apache.org ≠ Spark Desktop).
 */
interface Identity {
  owners: string[];
  products: string[];
  exact?: string[];
}

/** Stopy bez prázdných a nic neříkajících; dvě písmena stačí (k6.io), u částí cesty až tři. */
const clean = (values: (string | null | undefined)[], min = 2) =>
  [...new Set(values.map((v) => flat(v ?? "")))].filter((v) => v.length >= min && !WEAK.has(v));

/**
 * Stopy webu: účet a repozitář na hostingu kódu (github.com/sharkdp/pastel), projekt na
 * SourceForge, subdoména hostingu (gnuwin32.sourceforge.net), jinak název domény a první
 * části cesty (uvviewsoft.com/cudatext). Archivovaná adresa (web.archive.org) podle původní.
 */
export function siteIdentity(url: string | null | undefined): Identity {
  const none: Identity = { owners: [], products: [] };
  if (!url) return none;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.split("/").filter(Boolean);
    if (host === "web.archive.org") {
      const original = u.pathname.replace(/^\/web\/[^/]*\//, "");
      return original === u.pathname ? none : siteIdentity(/^https?:/.test(original) ? original : `https://${original}`);
    }
    if (GO_DOCS.has(host) && CODE_HOSTS.has(path[0] ?? "")) return siteIdentity(`https://${path.join("/")}`);
    if (NO_OWNER_HOSTS.test(host)) return none;
    if (host === "aka.ms") return { owners: ["microsoft"], products: [] };
    if (CODE_HOSTS.has(host)) return { owners: clean([path[0]]), products: clean([path[1]?.replace(/\.git$/, "")]) };
    if (host === "sourceforge.net") return { owners: [], products: clean([path[0] === "projects" || path[0] === "p" ? path[1] : undefined]) };
    // Stránky na Google Sites (sites.google.com/site/qaacpage) – vlastníka určuje cesta
    if (host === "sites.google.com") return { owners: [], products: clean(path.slice(0, 3), 3) };
    const pages = clean(path.slice(0, 2), 3);
    if (SUBDOMAIN_HOSTS.test(host)) {
      const sub = host.split(".")[0];
      return /sourceforge/.test(host) ? { owners: [], products: clean([sub, ...pages]) } : { owners: clean([sub]), products: pages };
    }
    const labels = host.split(".");
    // example.co.uk, wilfred.me.uk – název domény je třetí od konce. Subdomény jen při přesné
    // shodě: spark.apache.org i ant.apache.org patří Apache, ne Sparku od Readdle a Antu od Anthropicu
    const take = labels.length >= 3 && /^(co|com|org|net|ac|gov|edu|me|ne|or|gr|go|ltd|plc|nom)$/.test(labels.at(-2)!) ? 3 : 2;
    if (labels.length < take) return none;
    return { owners: clean([labels.at(-take)]), products: pages, exact: clean(labels.slice(0, -take), 3) };
  } catch {
    return none;
  }
}

/** Přívěsky, které ke krátkému názvu patří („k9s“ + cli = k9scli.io), na rozdíl od „zap“ + roxy (zaproxy.org). */
const AFFIXES = new Set([...WEAK, "hq", "dev", "io", "js", "rs", "py", "go", "lang", "team", "labs", "official", "site", "org", "installer", "setup"]);

/** Souvisí stopy? Shoda, delší obsahuje kratší („ffmpegessentialsbuild“ × „ffmpeg“), u krátkých jen s přívěskem („k9scli“ × „k9s“). */
const overlaps = (a: string[], b: string[]) =>
  a.some((x) =>
    b.some((y) => {
      if (x === y) return true;
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (short.length >= 4) return long.includes(short);
      return short.length >= 2 && long.startsWith(short) && AFFIXES.has(long.slice(short.length));
    }),
  );

/**
 * Stopy balíčku wingetu: vlastník (vydavatel z id a z indexu, weby z manifestu) a produkt
 * (název i bez úvodního vydavatele: „Mozilla Firefox“ → firefox; repozitář z webu).
 * `known` = balíček má web – bez něj se spojení nezamítá.
 */
function wingetIdentity(w: WingetIndexEntry, sites: string[]): Identity & { known: boolean } {
  const publisher = flat(w.id.split(".")[0]);
  const product = matchKey(cleanName(w.name));
  // I bez závorky: „mpv (shinchiro build)“ → mpv
  const bare = matchKey(w.name.replace(/\([^)]*\)/g, " "));
  const fromSites = sites.map(siteIdentity);
  return {
    owners: clean([publisher, w.publisherNorm, ...fromSites.flatMap((s) => s.owners)]),
    products: clean([product, bare, product.startsWith(publisher) ? product.slice(publisher.length) : undefined, ...fromSites.flatMap((s) => s.products)]),
    known: fromSites.some((s) => s.owners.length + s.products.length > 0),
  };
}

/** Autoři balíčku Chocolatey jako stopy vlastníka („Epic Games, Inc.“ → epicgames). */
const authorOwners = (authors: string) => clean(authors.toLowerCase().replace(LEGAL_FORMS, "").split(/,|&|;|\/|\band\b/));

export function pairSources(
  winget: WingetIndexEntry[],
  chocoAll: ChocoPackage[],
  scoopAll: ScoopPackage[],
  variants: Map<string, WingetIndexEntry[]> = new Map(),
  /** Weby balíčků wingetu z manifestu (PackageUrl, PublisherUrl) podle id malými písmeny. */
  wingetSites: Map<string, string[]> = new Map(),
): AppRecord[] {
  const choco = dedupeChoco(chocoAll);
  const scoop = dedupeScoop(scoopAll);

  // Indexy wingetu podle jednotlivých signálů
  const byMoniker = indexBy(winget, (w) => [w.moniker?.toLowerCase()]);
  const byName = indexBy(winget, (w) => [matchKey(cleanName(w.name))]);
  // Id i s „+“ vynechaným – Chocolatey ho v id nemívá („paragon-hfs“ = „Paragon.HFS+“)
  const byId = indexBy(winget, (w) => [matchKey(w.id), nameKey(w.id)]);
  const byTrimmed = indexBy(winget, (w) => [matchTrimmed(w.name)]);
  const byTail = indexBy(winget, (w) => [matchKey(idTail(w.id)), nameKey(idTail(w.id))]);
  const identities = winget.map((w) => wingetIdentity(w, wingetSites.get(w.id.toLowerCase()) ?? []));

  /**
   * Kandidáti z wingetu pro daný klíč a jejich skóre. Shodný název ani moniker
   * neznamenají stejnou aplikaci („mc“ = MinIO Client i Midnight Commander,
   * „Pastel“ od Japplis i od sharkdp): když web ani autoři balíčku nesouvisí s balíčkem
   * wingetu, spojení se zamítne; když sedí vlastník (účet, doména, autor), má přednost.
   */
  const candidates = (
    keys: { key: string | null; map: Map<string, number[]>; score: number }[],
    publisherHint: string,
    site: Identity,
    /** Autoři (Chocolatey) – shoda přidá přednost, sami spojení nezamítnou (bývají to jména lidí). */
    authors: string[] = [],
  ) => {
    const best = new Map<number, number>();
    const described = site.owners.length + site.products.length > 0;
    for (const { key, map, score } of keys) {
      if (!key) continue;
      for (const i of map.get(key) ?? []) {
        let bonus = 0;
        const w = identities[i];
        const all = [...w.owners, ...w.products];
        const sameOwner = overlaps([...site.owners, ...authors], all);
        const sameProduct = overlaps(site.products, all) || !!site.exact?.some((name) => w.products.includes(name));
        if (described && !sameOwner && w.known && !sameProduct) continue;
        // Jen konec id (Logitech.Sync = „sync“ od Sysinternals) u balíčku bez webu – nic to nedokazuje
        if (described && !sameOwner && !w.known && score <= 60) continue;
        if (sameOwner) bonus += 30;
        // Drobný bonus, když sedí i vydavatel (rozhodne mezi stejně pojmenovanými balíčky)
        if (publisherHint && winget[i].publisherNorm && publisherHint.includes(winget[i].publisherNorm!)) bonus += 5;
        // Kratší id = spíš hlavní balíček („Git.Git“ před „Git.Git.PreRelease“)
        const s = score + bonus - winget[i].id.length / 100;
        if ((best.get(i) ?? 0) < s) best.set(i, s);
      }
    }
    return best;
  };

  // Chocolatey → winget
  const chocoEdges: Edge[] = [];
  choco.forEach((c, from) => {
    const base = chocoBase(c.id);
    const found = candidates(
      [
        { key: base, map: byMoniker, score: 100 },
        { key: matchKey(c.title), map: byName, score: 85 },
        { key: matchKey(base), map: byId, score: 75 },
        { key: matchTrimmed(c.title), map: byTrimmed, score: 70 },
        { key: matchKey(base), map: byTail, score: 60 },
      ],
      normalize(c.authors),
      siteIdentity(c.projectUrl),
      authorOwners(c.authors),
    );
    for (const [to, score] of found) chocoEdges.push({ from, to, score });
  });
  const chocoToWinget = assign(chocoEdges);

  // Scoop → winget
  const scoopEdges: Edge[] = [];
  scoop.forEach((s, from) => {
    const name = s.name.toLowerCase();
    const found = candidates(
      [
        { key: name, map: byMoniker, score: 100 },
        { key: matchKey(name), map: byName, score: 85 },
        { key: matchKey(name), map: byId, score: 75 },
        { key: matchTrimmed(name), map: byTrimmed, score: 70 },
        { key: matchKey(name), map: byTail, score: 60 },
      ],
      "",
      siteIdentity(s.homepage),
    );
    for (const [to, score] of found) scoopEdges.push({ from, to, score });
  });
  const scoopToWinget = assign(scoopEdges);

  // Záznamy s wingetem (i s jeho variantami – jazyky, typy instalátoru)
  const records: AppRecord[] = winget.map((w) => {
    const merged = variants.get(w.id.toLowerCase());
    return merged ? { winget: w, wingetVariants: merged } : { winget: w };
  });
  for (const [c, w] of chocoToWinget) records[w].choco = choco[c];
  for (const [s, w] of scoopToWinget) records[w].scoop = scoop[s];

  // Chocolatey bez wingetu → samostatné záznamy; k nim ještě zkusit Scoop
  const chocoOnly = choco.filter((_, i) => !chocoToWinget.has(i));
  const chocoOnlyStart = records.length;
  for (const c of chocoOnly) records.push({ choco: c });

  const byChocoId = indexBy(chocoOnly, (c) => [chocoBase(c.id)]);
  const byChocoTitle = indexBy(chocoOnly, (c) => [nameKey(c.title), nameKey(chocoBase(c.id)), trimmedNameKey(c.title)]);
  // Stejný web aplikace (u GitHubu včetně repozitáře) – „sharkdp/bat“ = „bat“
  const byChocoSite = indexBy(chocoOnly, (c) => [siteKey(c.projectUrl)]);
  const scoopChocoEdges: Edge[] = [];
  scoop.forEach((s, from) => {
    if (scoopToWinget.has(from)) return;
    for (const to of byChocoId.get(s.name.toLowerCase()) ?? []) scoopChocoEdges.push({ from, to, score: 90 });
    for (const to of byChocoTitle.get(nameKey(s.name)) ?? []) scoopChocoEdges.push({ from, to, score: 80 });
    const site = siteKey(s.homepage);
    // Jen weby konkrétní aplikace (repozitář), ne společné domény vydavatelů
    if (site && site.split("/").length === 3) for (const to of byChocoSite.get(site) ?? []) scoopChocoEdges.push({ from, to, score: 70 });
  });
  const scoopToChoco = assign(scoopChocoEdges);
  for (const [s, c] of scoopToChoco) records[chocoOnlyStart + c].scoop = scoop[s];

  // Scoop bez protějšku
  scoop.forEach((s, i) => {
    if (!scoopToWinget.has(i) && !scoopToChoco.has(i)) records.push({ scoop: s });
  });

  return records;
}
