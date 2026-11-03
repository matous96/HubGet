// Texty všech stránek webu ve formulářích Pages CMS. Každý text na stránce má atribut
// data-t="…" a jeho znění je ve website/content/texty/<jazyk>/<stránka>.json (texty, titulek
// a popis pro vyhledávače, snímky obrazovky); menu, zápatí a hlášky skriptu jsou společné
// pro všechny stránky jazyka (spolecne.json). Formuláře v .pages.yml se generují odsud.
//
//   node scripts/website-texts.mjs           (pnpm website:content) – sladí HTML a data:
//       novým textům v HTML přidělí data-t, upravený text v HTML převezme do dat (podle
//       stavu v gitu), jinak platí data; zahodí texty, které ze stránek zmizely, a přegeneruje
//       formuláře v .pages.yml,
//   node scripts/website-texts.mjs --render  (workflow Katalog) – jen vepíše data do HTML.
//
// Text je prostý s malým Markdownem jako v Novinkách (**tučně**, [odkaz](adresa), `kód`, nový
// řádek = <br>). Části, které se ve formuláři nepíšou, jsou značky: {ikona}, {prvek} (obrázek,
// prázdný prvek z HTML – zůstane, kde je značka), {auto:klíč} (hodnota, kterou doplní
// website-release / website-content), {ano} {ne} {částečně} {info} / {yes} {no} {partly}
// (značky ve srovnávacích tabulkách) a {→}. Ostatní značky HTML s textem zůstávají ve znění,
// jak jsou. Oblasti <!--obsah:…--> a <!--release:…--> (Novinky, Co chystáme, novinky na
// domovské stránce) se tu přeskakují – mají vlastní formuláře a generátory.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Jazyky webu → složka stránek ve website/. */
const LANGS = { cs: "", en: "en/" };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style"]);
/** Značky, které smí být uvnitř textu (ostatní – odstavce, seznamy… – text dělí na víc polí). */
const INLINE = new Set(["a", "abbr", "b", "br", "code", "em", "i", "img", "kbd", "mark", "q", "s", "small", "span", "strong", "sub", "sup", "svg", "time", "u"]);
const SKIP = new Set(["head", "script", "style", "svg", "noscript", "template"]);
/** Uvnitř se nemění mezery ani nepřidávají nezlomitelné mezery. */
const VERBATIM = new Set(["code", "kbd", "pre"]);

/** Značky srovnávacích tabulek: token → [třída, text pro čtečky obrazovky]. */
const MARKS = {
  cs: { ano: ["yes", "Ano: "], ne: ["no", "Ne: "], částečně: ["part", "Částečně: "], info: ["info", null] },
  en: { yes: ["yes", "Yes: "], no: ["no", "No: "], partly: ["part", "Partly: "], info: ["info", null] },
};
const ARROW = '<span aria-hidden="true">→</span>';

/** Hlášky skriptu webu (TEXTS ve website/main.js) – popisky polí. */
const SCRIPT_LABELS = {
  placeholder: "Odkaz, který zatím nikam nevede",
  copy: "Tlačítko Kopírovat",
  copied: "Po zkopírování",
  copyFailed: "Kopírování se nepovedlo",
  menuOpen: "Otevřít menu (na mobilu)",
  menuClose: "Zavřít menu (na mobilu)",
  sending: "Odesílání formuláře",
  contactOffline: "Kontaktní formulář – bez internetu",
  contactRateLimit: "Kontaktní formulář – příliš mnoho zpráv",
  contactFailed: "Kontaktní formulář – zprávu se nepodařilo odeslat",
  contactReason: "Kontaktní formulář – důvod chyby",
};

const SEO_FIELDS = [
  ["title", "Titulek stránky (záložka prohlížeče, výsledky hledání)"],
  ["description", "Popis pro vyhledávače"],
  ["ogTitle", "Titulek při sdílení odkazu"],
  ["ogDescription", "Popis při sdílení odkazu"],
];

// ---------------------------------------------------------------------------------------------
// Rozbor HTML (ručně psané stránky webu – každý prvek je uzavřený)

const TOKEN = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/gi;
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Strom prvků s pozicemi v textu stránky. */
function parse(html, file) {
  const root = { type: "element", tag: "#root", attrs: {}, children: [], start: 0, openEnd: 0, innerStart: 0, innerEnd: html.length, end: html.length };
  const stack = [root];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    const top = stack.at(-1);
    if (m.index > last) top.children.push({ type: "text", start: last, end: m.index, parent: top });
    if (m[0].startsWith("<!--")) top.children.push({ type: "comment", start: m.index, end: TOKEN.lastIndex, parent: top });
    else if (m[1]) {
      const tag = m[1].toLowerCase();
      if (top.tag !== tag) throw new Error(`${file}: </${tag}> na pozici ${m.index} neuzavírá <${top.tag}>`);
      stack.pop();
      top.innerEnd = m.index;
      top.end = TOKEN.lastIndex;
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = {};
      for (const a of (m[3] ?? "").matchAll(ATTR)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
      const el = { type: "element", tag, attrs, start: m.index, openEnd: TOKEN.lastIndex, innerStart: TOKEN.lastIndex, children: [], parent: top };
      top.children.push(el);
      if (VOID.has(tag) || m[4] === "/") el.innerEnd = el.end = TOKEN.lastIndex;
      else if (RAW.has(tag)) {
        const close = html.toLowerCase().indexOf(`</${tag}`, TOKEN.lastIndex);
        el.innerEnd = close;
        el.end = html.indexOf(">", close) + 1;
        TOKEN.lastIndex = el.end;
      } else stack.push(el);
    }
    last = TOKEN.lastIndex;
  }
  if (stack.length > 1) throw new Error(`${file}: neuzavřené <${stack.at(-1).tag}>`);
  return root;
}

const isText = (node, html) => node.type === "text" && html.slice(node.start, node.end).replace(/&nbsp;/g, " ").trim() !== "";
const hasAncestor = (node, test) => {
  for (let p = node.parent; p; p = p.parent) if (test(p)) return true;
  return false;
};
const classes = (el) => (el.attrs.class ?? "").split(/\s+/);

/** Prvek obsahuje jen text a vložené značky (do svg se nevidí). */
function inlineOnly(el) {
  return el.children.every((c) => c.type !== "element" || (INLINE.has(c.tag) && (c.tag === "svg" || inlineOnly(c))));
}

// ---------------------------------------------------------------------------------------------
// HTML ↔ text formuláře

const decode = (text) => text.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const encodeAttr = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/ /g, "&nbsp;");
const SENTINEL = (i) => `${i}`;
const SENTINELS = /(\d+)/g;

/**
 * Obsah prvku → text pro formulář a části HTML, které ve formuláři zastupují značky
 * ({ikona}, {prvek}, {auto:klíč}). Vrátí { text, fragments: [{ name, html }] }.
 */
function toText(el, html, lang) {
  const fragments = [];
  const fragment = (label, part) => {
    fragments.push({ label, html: part });
    return SENTINEL(fragments.length - 1);
  };
  const nodes = (list, verbatim) => {
    let out = "";
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const raw = html.slice(n.start, n.end);
      if (n.type === "text") {
        const text = decode(raw);
        out += verbatim ? text : text.replace(/[ \t\r\n]+/g, " ");
      } else if (n.type === "comment") {
        // Hodnota doplňovaná skriptem: <!--release:klíč-->…<!--/release:klíč-->
        const marker = /^<!--(obsah|release):([\w-]+)-->$/.exec(raw);
        const close = marker ? list.findIndex((c, j) => j > i && c.type === "comment" && html.slice(c.start, c.end) === `<!--/${marker[1]}:${marker[2]}-->`) : -1;
        if (close > i) {
          out += fragment(`auto:${marker[2]}`, html.slice(n.start, list[close].end));
          i = close;
        } else out += fragment("prvek", raw);
      } else out += element(n, verbatim);
    }
    return out;
  };
  const element = (n, verbatim) => {
    const raw = html.slice(n.start, n.end);
    const inner = html.slice(n.innerStart, n.innerEnd);
    const keys = Object.keys(n.attrs);
    const plain = n.children.every((c) => c.type === "text");
    const textContent = n.children.some((c) => isText(c, html) || (c.type === "element" && c.tag !== "svg" && /[^\s]/.test(html.slice(c.innerStart, c.innerEnd).replace(/<[^>]*>/g, ""))));
    // Značka srovnávací tabulky
    if (n.tag === "span" && /^mark mark--(yes|no|part|info)$/.test(n.attrs.class ?? "") && keys.length === 1) {
      const kind = n.attrs.class.slice(11);
      const token = Object.entries(MARKS[lang]).find(([, [k, sr]]) => k === kind && markHtml(k, sr) === raw);
      if (token) return `{${token[0]}}`;
    }
    if (raw === ARROW) return "{→}";
    // Ozdoba skrytá čtečkám (šipka, symbol) – ve formuláři značka podle znaku
    if (n.attrs["aria-hidden"] === "true") {
      const symbol = decode(inner).trim();
      return fragment(symbol && symbol.length <= 2 && !/[{}]/.test(symbol) ? symbol : "ikona", raw);
    }
    if (n.tag === "br" && keys.length === 0) return verbatim ? fragment("prvek", raw) : "\n";
    if (n.tag === "strong" && keys.length === 0 && !inner.includes("<strong")) return `**${nodes(n.children, verbatim)}**`;
    if (n.tag === "code" && keys.length === 0 && plain && !inner.includes("`")) return `\`${decode(inner)}\``;
    if (n.tag === "a" && !/[\]\[]/.test(inner)) {
      const href = n.attrs.href ?? "";
      const link = (target) => `[${nodes(n.children, verbatim)}](${target})`;
      if (keys.length === 2 && n.attrs["data-link"] && href === "#") return link(`@${n.attrs["data-link"]}`);
      if (/^[^\s()"]+$/.test(href) && (keys.length === 1 || (keys.length === 2 && n.attrs.rel === "noopener" && /^https?:/.test(href)))) return link(href);
    }
    // Ikona, obrázek nebo prázdný prvek – ve formuláři jen značka
    if (!textContent) return fragment(["svg", "img", "i"].includes(n.tag) ? "ikona" : "prvek", raw);
    // Ostatní značky s textem zůstávají jako HTML
    return `${html.slice(n.start, n.openEnd)}${nodes(n.children, verbatim || VERBATIM.has(n.tag))}</${n.tag}>`;
  };
  const verbatim = el.tag === "pre" || hasAncestor(el, (p) => p.tag === "pre");
  let text = nodes(el.children, verbatim);
  if (!verbatim) text = text.replace(/^[ \n]+|[ \n]+$/g, "").replace(/ ?\n ?/g, "\n");
  // Nezlomitelné mezery za jednopísmennými slovy doplní render – v datech obyčejné
  if (lang === "cs" && !verbatim) text = text.replace(/(?<=^|[\s ])([AaIiKkOoSsUuVvZz]) /g, "$1 ");
  // Značky pojmenovat: {ikona}, nebo {ikona 1}, {ikona 2}… když jich je víc
  const counts = {};
  for (const f of fragments) counts[f.label] = (counts[f.label] ?? 0) + 1;
  const seen = {};
  for (const f of fragments) {
    seen[f.label] = (seen[f.label] ?? 0) + 1;
    f.name = counts[f.label] > 1 ? `${f.label} ${seen[f.label]}` : f.label;
  }
  text = text.replace(SENTINELS, (_, i) => `{${fragments[i].name}}`);
  return { text, fragments, verbatim };
}

const markHtml = (kind, sr) => `<span class="mark mark--${kind}">${sr ? `<span class="sr-only">${sr}</span>` : ""}</span>`;

/** Text z formuláře → obsah prvku (části zastoupené značkami se vezmou z dosavadního HTML). */
function render(text, fragments, lang, verbatim) {
  const parts = [];
  const keep = (part) => {
    parts.push(part);
    return SENTINEL(parts.length - 1);
  };
  const byName = new Map(fragments.map((f) => [f.name, f.html]));
  let s = text.replace(/\{([^{}\n]{1,40})\}/g, (whole, name) => {
    if (byName.has(name)) return keep(byName.get(name));
    const mark = MARKS[lang][name];
    if (mark) return keep(markHtml(...mark));
    if (name === "→") return keep(ARROW);
    return whole;
  });
  s = s.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/<(?![A-Za-z\/!])/g, "&lt;");
  s = s
    .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`))
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s"]+)\)/g, (_, label, href) =>
      href.startsWith("@")
        ? `<a data-link="${href.slice(1)}" href="#">${label}</a>`
        : `<a href="${href}"${/^https?:/.test(href) ? ' rel="noopener"' : ""}>${label}</a>`,
    );
  if (!verbatim) {
    s = s.replace(/\n/g, "<br>");
    // Česká typografie mimo značky a mimo kód
    if (lang === "cs") {
      let depth = 0;
      s = s.replace(/(<[^>]*>)|([^<]+)/g, (_, tag, chunk) => {
        if (tag) {
          const m = /^<(\/?)(code|kbd|pre)\b/i.exec(tag);
          if (m) depth += m[1] ? -1 : 1;
          return tag;
        }
        return depth ? chunk : chunk.replace(/(?<=^|[\s ])([AaIiKkOoSsUuVvZz]) /g, "$1 ");
      });
    }
  }
  s = s.replaceAll(" ", "&nbsp;");
  // Vnořené části (kód obsahuje i značky) – dokud nějaké zbývají
  while (SENTINELS.test(s)) s = s.replace(SENTINELS, (_, i) => parts[i]);
  return s;
}

/** Nastaví (nebo přidá) atribut v otevírací značce. */
function setAttr(openTag, name, value) {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s"'=<>\`]+)`);
  if (re.test(openTag)) return openTag.replace(re, `$1"${value}"`);
  return openTag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
}

// ---------------------------------------------------------------------------------------------
// Texty stránky

/** Popis pole ve formuláři podle druhu prvku. */
function kindOf(el) {
  const cls = classes(el);
  const tag = el.tag;
  if (tag === "h1") return "Hlavní nadpis";
  if (tag === "h2") return "Nadpis sekce";
  if (/^h[3-6]$/.test(tag)) return "Nadpis";
  if (cls.includes("eyebrow")) return "Štítek nad nadpisem";
  if (cls.some((c) => c === "lead" || c.endsWith("__lead"))) return "Úvodní text";
  if (tag === "p") return "Odstavec";
  if (tag === "li") return "Bod seznamu";
  if ((tag === "a" || tag === "button") && cls.includes("btn")) return "Tlačítko";
  if (tag === "a") return "Odkaz";
  if (tag === "button") return "Tlačítko";
  if (tag === "dt") return "Popisek";
  if (tag === "dd") return "Hodnota";
  if (tag === "th") return "Záhlaví tabulky";
  if (tag === "td") return el.attrs["data-label"] ? `Buňka (${el.attrs["data-label"]})` : "Buňka tabulky";
  if (tag === "summary") return "Otázka";
  if (tag === "label") return "Popisek pole";
  if (tag === "option") return "Volba v nabídce";
  if (tag === "figcaption") return "Popisek obrázku";
  if (tag === "input" || tag === "textarea") return "Nápověda v poli";
  if (tag === "pre") return "Ukázka kódu";
  return "Text";
}

/** Oblast společná všem stránkám (menu, zápatí, odkaz Přeskočit na obsah) – jinak null. */
function sharedArea(el) {
  for (let p = el; p; p = p.parent) {
    if (p.tag === "header" && classes(p).includes("nav")) return "Menu";
    if (p.tag === "footer") return "Zápatí";
    if (p.tag === "a" && classes(p).includes("skip")) return "Přeskočit na obsah";
  }
  return null;
}

const plainLabel = (text) => text.replace(/\{[^{}]*\}|\*\*|\[|\]\([^)]*\)|`/g, "").replace(/\s+/g, " ").trim();
const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Texty, titulky a snímky jedné stránky: { items, seo, images, mixed }.
 * items: { el, id, shared, text, fragments, verbatim, label, attr? }; mixed: texty vedle
 * odstavců či seznamů v jednom prvku – do formuláře se nedostanou.
 */
function collect(html, file, lang) {
  const root = parse(html, file);
  const regions = [...html.matchAll(/<!--(obsah|release):([\w-]+)-->[\s\S]*?<!--\/\1:\2-->/g)].map((m) => [m.index, m.index + m[0].length]);
  const inRegion = (n) => regions.some(([a, b]) => n.start >= a && n.end <= b);
  const items = [];
  const images = [];
  const mixed = [];
  const seo = {};
  let section = "";
  const visit = (el) => {
    if (el.type !== "element") return;
    if (el.tag === "head") {
      for (const c of el.children) {
        if (c.type !== "element") continue;
        if (c.tag === "title") seo.title = { el: c, value: decode(html.slice(c.innerStart, c.innerEnd)), mode: "inner" };
        const key = c.tag === "meta" && ({ description: "description", "og:title": "ogTitle", "og:description": "ogDescription" }[c.attrs.name ?? c.attrs.property]);
        if (key) seo[key] = { el: c, value: decode(c.attrs.content ?? ""), mode: "content" };
      }
      return;
    }
    if (SKIP.has(el.tag) || inRegion(el)) return;
    if (el.tag === "img" && /^(\.\.\/)?img\//.test(el.attrs.src ?? "")) {
      const theme = classes(el).find((c) => /--(light|dark)$/.test(c));
      const label = `Snímek obrazovky${theme ? (theme.endsWith("light") ? " – světlý motiv" : " – tmavý motiv") : ""}${section ? ` · ${section}` : ""}`;
      images.push({ el, id: el.attrs["data-t"], src: el.attrs.src.replace(/^\.\.\//, ""), alt: decode(el.attrs.alt ?? ""), label });
      return;
    }
    if ((el.tag === "input" || el.tag === "textarea") && el.attrs.placeholder) {
      items.push({ el, id: el.attrs["data-t"], shared: null, text: decode(el.attrs.placeholder), fragments: [], attr: "placeholder", label: `${kindOf(el)}${section ? ` · ${section}` : ""}` });
      return;
    }
    const direct = el.children.some((c) => isText(c, html));
    if (direct && inlineOnly(el)) {
      const { text, fragments, verbatim } = toText(el, html, lang);
      if (/^h[12]$/.test(el.tag)) section = shorten(plainLabel(text), 40);
      // Jen automatické hodnoty – ve formuláři by nebylo co psát
      if (!text.replace(/\{auto:[\w-]+\}/g, "").trim()) return;
      const shared = sharedArea(el);
      const kind = kindOf(el);
      const label = shared ? `${kind} · ${shared}` : /^h[12]$/.test(el.tag) ? kind : `${kind}${section ? ` · ${section}` : ""}`;
      items.push({ el, id: el.attrs["data-t"], shared, text, fragments, verbatim, label });
      return;
    }
    if (direct) mixed.push(plainLabel(decode(html.slice(el.innerStart, el.innerEnd).replace(/<[^>]*>/g, " "))));
    for (const c of el.children) visit(c);
  };
  visit(root);
  return { items, seo, images, mixed };
}

// ---------------------------------------------------------------------------------------------
// Data a synchronizace

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

/** Obsah souboru v posledním commitu (null = soubor v něm není nebo nejde o git). */
function headFile(root, path) {
  try {
    return execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** Stránky jazyka: [{ file (website/…), name, path }]. */
function pagesOf(root, lang) {
  const dir = join(root, "website", LANGS[lang]);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))
    .map((f) => ({ file: `website/${LANGS[lang]}${f}`, name: f.replace(/\.html$/, ""), path: join(dir, f) }));
}

/** Rozměry obrázku (PNG, JPEG, WebP) – null u jiných formátů. */
function imageSize(path) {
  if (!existsSync(path)) return null;
  const b = readFileSync(path);
  if (b.toString("ascii", 1, 4) === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const v = b.readUInt32LE(21);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length - 9; ) {
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Hlášky skriptu webu (TEXTS ve website/main.js). */
const SCRIPT_TEXTS = /const TEXTS = (\{[\s\S]*?\n\});/;
function scriptTexts(source) {
  const m = source && SCRIPT_TEXTS.exec(source);
  return m ? new Function(`return ${m[1]}`)() : null;
}
function writeScriptTexts(source, texts) {
  const lang = (l) => [`  ${l}: {`, ...Object.entries(texts[l]).map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`), "  },"];
  return source.replace(SCRIPT_TEXTS, ["const TEXTS = {", ...Object.keys(texts).flatMap(lang), "};"].join("\n"));
}

/**
 * Sladí stránky webu s daty ve website/content/texty/. Při `render` jen vepíše data do HTML
 * (workflow), jinak přidělí nová data-t, převezme do dat texty upravené v HTML, zapíše data
 * a formuláře v .pages.yml. Vrátí varování a počty pro hlášení.
 */
export function syncTexts(root, { render: renderOnly = false } = {}) {
  const warnings = [];
  const warn = (file, message) => warnings.push({ file, message });
  const forms = {};
  let total = 0;
  const mainJs = join(root, "website", "main.js");
  const scriptNow = scriptTexts(readFileSync(mainJs, "utf8"));
  const scriptHead = renderOnly ? null : scriptTexts(headFile(root, "website/main.js"));
  const scriptFinal = {};

  for (const lang of Object.keys(LANGS)) {
    const dataDir = join(root, "website", "content", "texty", lang);
    const dataFile = (name) => `website/content/texty/${lang}/${name}.json`;
    const loadHead = (path) => (renderOnly ? null : JSON.parse(headFile(root, path) ?? "null"));
    const sharedPath = dataFile("spolecne");
    const sharedNow = readJson(join(root, sharedPath)) ?? {};
    const sharedHead = loadHead(sharedPath) ?? {};
    const pages = pagesOf(root, lang).map((page) => {
      const html = readFileSync(page.path, "utf8");
      const headHtml = renderOnly ? null : headFile(root, page.file);
      const data = readJson(join(root, dataFile(page.name))) ?? {};
      return { ...page, html, data, head: loadHead(dataFile(page.name)) ?? {}, collected: collect(html, page.file, lang), headCollected: headHtml ? collect(headHtml, page.file, lang) : null };
    });

    /**
     * Výsledné znění: data upravená od posledního commitu > HTML upravené od posledního
     * commitu > data; bez dat HTML. `render` bere data, jinak HTML.
     */
    const decide = (dataNow, dataHead, htmlNow, htmlHead) => {
      if (dataNow === undefined || dataNow === null) return htmlNow;
      if (renderOnly || dataNow !== dataHead) return dataNow;
      if (htmlHead !== undefined && htmlNow !== htmlHead) return htmlNow;
      return dataNow;
    };

    // Společné texty: stejné znění na všech stránkách = jedno pole
    const sharedFinal = {};
    const sharedByText = new Map(Object.entries(sharedNow.texty ?? {}).map(([id, text]) => [text, id]));
    let sharedMax = Math.max(0, ...Object.keys(sharedNow.texty ?? {}).map((id) => Number(id.slice(1))));
    const sharedLabels = {};

    for (const page of pages) {
      const { items, seo, images, mixed } = page.collected;
      if (!renderOnly) for (const text of mixed) warn(page.file, `text „${shorten(text, 50)}“ je vedle bloků (odstavců, seznamů) – do formuláře se nedostane`);
      const headItems = new Map((page.headCollected?.items ?? []).filter((i) => i.id).map((i) => [i.id, i.text]));
      const headImages = new Map((page.headCollected?.images ?? []).filter((i) => i.id).map((i) => [i.id, i]));
      const used = new Set();
      let max = Math.max(0, ...items.filter((i) => /^t\d+$/.test(i.id ?? "")).map((i) => Number(i.id.slice(1))));
      const texts = {};
      const labels = {};
      const edits = [];

      for (const item of items) {
        // Id: chybějící, duplicitní (zkopírovaný prvek) nebo z jiné oblasti dostane nové
        const valid = item.id && (item.shared ? /^s\d+$/ : /^t\d+$/).test(item.id) && !used.has(item.id);
        if (!valid) {
          if (renderOnly) {
            warn(page.file, `text „${shorten(plainLabel(item.text), 50)}“ nemá data-t – zůstane, jak je v HTML (spusťte pnpm website:content)`);
            continue;
          }
          item.id = item.shared ? (sharedByText.get(item.text) ?? `s${++sharedMax}`) : `t${++max}`;
          item.fresh = true;
        }
        if (!item.shared) used.add(item.id);
        let final;
        if (item.shared) {
          final = sharedFinal[item.id] ?? decide(sharedNow.texty?.[item.id], sharedHead.texty?.[item.id], item.text, headItems.get(item.id));
          sharedFinal[item.id] = final;
          sharedByText.set(final, item.id);
          sharedLabels[item.id] ??= item.label;
        } else {
          final = decide(item.fresh ? undefined : page.data.texty?.[item.id], page.head.texty?.[item.id], item.text, item.fresh ? undefined : headItems.get(item.id));
          texts[item.id] = final;
          labels[item.id] = { label: item.label, long: final.length > 70 || final.includes("\n") };
        }
        if (final === undefined) continue;
        // Zápis do HTML: data-t a znění
        let open = html(page, item.el.start, item.el.openEnd);
        if (item.el.attrs["data-t"] !== item.id) open = setAttr(open, "data-t", item.id);
        if (item.attr) {
          open = setAttr(open, item.attr, encodeAttr(final));
          edits.push([item.el.start, item.el.openEnd, open]);
        } else {
          edits.push([item.el.start, item.el.openEnd, open]);
          edits.push([item.el.innerStart, item.el.innerEnd, render(final, item.fragments, lang, item.verbatim)]);
        }
      }

      // Titulek a popis pro vyhledávače
      const seoFinal = {};
      for (const [key] of SEO_FIELDS) {
        const now = seo[key];
        if (!now) continue;
        const value = decide(page.data.seo?.[key], page.head.seo?.[key], now.value, page.headCollected?.seo[key]?.value);
        seoFinal[key] = value;
        if (now.mode === "inner") edits.push([now.el.innerStart, now.el.innerEnd, value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/ /g, "&nbsp;")]);
        else edits.push([now.el.start, now.el.openEnd, setAttr(html(page, now.el.start, now.el.openEnd), "content", encodeAttr(value))]);
      }

      // Snímky obrazovky: soubor (cesta jako v knihovně médií, img/…) a popis
      const imagesFinal = {};
      const imageLabels = {};
      let imageMax = Math.max(0, ...images.filter((i) => /^i\d+$/.test(i.id ?? "")).map((i) => Number(i.id.slice(1))));
      const usedImages = new Set();
      for (const image of images) {
        if (!image.id || !/^i\d+$/.test(image.id) || usedImages.has(image.id)) {
          if (renderOnly) continue;
          image.id = `i${++imageMax}`;
          image.fresh = true;
        }
        usedImages.add(image.id);
        const data = image.fresh ? undefined : page.data.obrazky?.[image.id];
        const head = page.head.obrazky?.[image.id];
        const before = headImages.get(image.id);
        const src = decide(data?.src, head?.src, image.src, before?.src);
        const alt = decide(data?.alt, head?.alt, image.alt, before?.alt);
        imagesFinal[image.id] = { src, alt };
        imageLabels[image.id] = image.label;
        let open = html(page, image.el.start, image.el.openEnd);
        if (image.el.attrs["data-t"] !== image.id) open = setAttr(open, "data-t", image.id);
        open = setAttr(open, "src", `${LANGS[lang] ? "../" : ""}${src}`);
        open = setAttr(open, "alt", encodeAttr(alt));
        const size = "width" in image.el.attrs ? imageSize(join(root, "website", src)) : null;
        if (size) open = setAttr(setAttr(open, "width", String(size.width)), "height", String(size.height));
        else if (!existsSync(join(root, "website", src))) warn(page.file, `obrázek ${src} neexistuje`);
        edits.push([image.el.start, image.el.openEnd, open]);
      }

      // Úpravy od konce, ať pozice platí
      let next = page.html;
      for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) next = next.slice(0, start) + value + next.slice(end);
      if (next !== page.html) writeFileSync(page.path, next);
      total += Object.keys(texts).length;

      if (!renderOnly) {
        // Texty v datech, které na stránce nejsou, zmizí; nová data v pořadí stránky
        const out = { seo: seoFinal, texty: texts };
        if (Object.keys(imagesFinal).length) out.obrazky = imagesFinal;
        mkdirSync(dataDir, { recursive: true });
        writeJson(join(root, dataFile(page.name)), out);
        const title = page.name === "index" ? "Domů" : (seoFinal.title?.replace(/ – (HubGet|srovnání|comparison)$/, "") ?? page.name);
        (forms[lang] ??= []).push({ page, title, labels, imageLabels, seo: Object.keys(seoFinal) });
      } else {
        for (const id of Object.keys(page.data.texty ?? {})) if (!items.some((i) => i.id === id)) warn(dataFile(page.name), `text ${id} na stránce není – přeskočí se`);
      }
    }

    // Hlášky skriptu (TEXTS ve website/main.js)
    const scriptData = sharedNow.hlasky ?? {};
    scriptFinal[lang] = {};
    for (const key of Object.keys(scriptNow?.[lang] ?? {})) {
      scriptFinal[lang][key] = decide(scriptData[key], sharedHead.hlasky?.[key], scriptNow[lang][key], scriptHead?.[lang]?.[key]);
    }
    if (!renderOnly) {
      const ordered = Object.fromEntries(Object.keys(sharedLabels).sort((a, b) => a.slice(1) - b.slice(1)).map((id) => [id, sharedFinal[id]]));
      writeJson(join(root, sharedPath), { texty: ordered, hlasky: scriptFinal[lang] });
      forms[lang].unshift({ shared: true, labels: Object.fromEntries(Object.entries(sharedLabels).map(([id, label]) => [id, { label, long: false }])) });
    }
  }

  const script = readFileSync(mainJs, "utf8");
  const updated = writeScriptTexts(script, scriptFinal);
  if (updated !== script) writeFileSync(mainJs, updated);
  if (!renderOnly) writePagesConfig(root, forms);
  return { warnings, texts: total };
}

const html = (page, start, end) => page.html.slice(start, end);
const writeJson = (path, data) => {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
};

// ---------------------------------------------------------------------------------------------
// Formuláře Pages CMS

const GENERATED = "  # ===== Texty stránek – generuje scripts/website-texts.mjs (pnpm website:content), ručně neupravovat =====";

/** Přepíše generovanou část .pages.yml (od značky do konce souboru). */
function writePagesConfig(root, forms) {
  const path = join(root, ".pages.yml");
  const config = readFileSync(path, "utf8");
  const start = config.indexOf(GENERATED);
  const head = (start < 0 ? config : config.slice(0, start)).trimEnd();
  const q = (text) => JSON.stringify(text);
  const field = (indent, name, label, type, extra = []) => [`${indent}- name: ${name}`, `${indent}  label: ${q(label)}`, `${indent}  type: ${type}`, ...extra.map((l) => `${indent}  ${l}`)];
  const textFields = (indent, labels) =>
    Object.entries(labels).flatMap(([id, { label, long }]) => field(indent, id, label, long ? "text" : "string"));
  const lines = [GENERATED];
  for (const [lang, entries] of Object.entries(forms)) {
    lines.push(`  - name: texty-${lang}`, `    label: ${q(lang === "cs" ? "Texty webu – česky" : "Texty webu – anglicky")}`, "    type: group", "    items:");
    for (const entry of entries) {
      const ind = "          ";
      if (entry.shared) {
        lines.push(
          `      - name: texty-${lang}-spolecne`,
          `        label: ${q("Menu, zápatí a hlášky")}`,
          "        type: file",
          `        path: website/content/texty/${lang}/spolecne.json`,
          "        format: json",
          "        fields:",
          ...field(ind, "texty", "Menu a zápatí (na všech stránkách)", "object", ["fields:"]),
          ...textFields(`${ind}    `, entry.labels),
          ...field(ind, "hlasky", "Hlášky webu (kopírování, kontaktní formulář)", "object", ["fields:"]),
          ...Object.entries(SCRIPT_LABELS).flatMap(([key, label]) => field(`${ind}    `, key, label, "string")),
        );
        continue;
      }
      lines.push(
        `      - name: texty-${lang}-${entry.page.name}`,
        `        label: ${q(entry.title)}`,
        "        type: file",
        `        path: website/content/texty/${lang}/${entry.page.name}.json`,
        "        format: json",
        "        fields:",
        ...field(ind, "seo", "Vyhledávače a sdílení", "object", ["fields:"]),
        ...SEO_FIELDS.filter(([key]) => entry.seo.includes(key)).flatMap(([key, label]) => field(`${ind}    `, key, label, key.toLowerCase().includes("description") ? "text" : "string")),
        ...field(ind, "texty", "Texty stránky (v pořadí na stránce)", "object", ["fields:"]),
        ...textFields(`${ind}    `, entry.labels),
      );
      if (Object.keys(entry.imageLabels).length) {
        lines.push(...field(ind, "obrazky", "Snímky obrazovky", "object", ["fields:"]));
        for (const [id, label] of Object.entries(entry.imageLabels)) {
          lines.push(
            ...field(`${ind}    `, id, label, "object", ["fields:"]),
            ...field(`${ind}        `, "src", "Obrázek", "image"),
            ...field(`${ind}        `, "alt", "Popis obrázku (pro nevidomé a vyhledávače)", "text"),
          );
        }
      }
    }
  }
  const next = `${head}\n\n${lines.join("\n")}\n`;
  if (next !== config) writeFileSync(path, next);
}

// Spuštění samostatně (pnpm website:content, workflow Katalog s --render)
if (resolve(process.argv[1] ?? "").toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const renderOnly = process.argv.includes("--render");
  const { warnings, texts } = syncTexts(root, { render: renderOnly });
  console.log(`Web: ${texts} textů stránek ${renderOnly ? "vepsáno z" : "sladěno s"} website/content/texty/.`);
  for (const { file, message } of warnings) console.warn(process.env.GITHUB_ACTIONS ? `::warning file=${file}::${message}` : `! ${file}: ${message}`);
}
