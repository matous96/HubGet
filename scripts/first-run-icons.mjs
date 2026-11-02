// Ikony aplikací z redakčního obsahu (src/data/editorial.ts – příběhy a kolekce) přibalené
// k aplikaci: při prvním spuštění je sekce „Dnes“ ukazuje hned, bez stahování z internetu.
// Soubory se jmenují jako v mezipaměti ikon (SHA-256 adresy z katalogu, src-tauri/src/icons.rs),
// obsah je stažený beze změny – převod ICO → PNG a kontrolu udělá aplikace při prvním použití.
//
//   node scripts/first-run-icons.mjs [katalog.json]   (výchozí public/catalog.json)
//
// Spouští se s katalogem, který se přibaluje (workflow Vydání), ať adresy ikon sedí.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src-tauri", "first-run-icons");
const catalogPath = process.argv[2] ?? join(root, "public", "catalog.json");
/** Větší soubor není ikona (stejný limit jako icons.rs). */
const MAX_BYTES = 4 * 1024 * 1024;

// Id aplikací z redakčního obsahu (příběhy, kolekce, kolekce podle zaměření)
const editorial = readFileSync(join(root, "src", "data", "editorial.ts"), "utf8");
const ids = new Set([
  ...[...editorial.matchAll(/appId:\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...editorial.matchAll(/appIds:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((id) => id[1])),
]);

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const entries = new Map([...catalog.packages, ...(catalog.webOnly ?? [])].map((p) => [p.id, p]));
const sha = (text) => createHash("sha256").update(text).digest("hex");

mkdirSync(out, { recursive: true });
const wanted = new Map();
for (const id of ids) {
  const url = entries.get(id)?.iconUrl;
  if (url) wanted.set(sha(url), { id, url });
  else console.warn(`bez ikony v katalogu: ${id}`);
}

let total = 0;
const failed = [];
/** Stažení s dalšími dvěma pokusy – jedno selhání sítě by ikonu z instalace vynechalo. */
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HubGet" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

await Promise.all(
  [...wanted].map(async ([name, { id, url }]) => {
    try {
      const bytes = await download(url);
      if (!bytes.length || bytes.length > MAX_BYTES) throw new Error(`velikost ${bytes.length} B`);
      if (/^\s*<(!doctype html|html)/i.test(bytes.subarray(0, 64).toString("utf8"))) throw new Error("HTML místo obrázku");
      writeFileSync(join(out, name), bytes);
      total += bytes.length;
    } catch (error) {
      failed.push(`${id}: ${error.message}`);
    }
  }),
);

// Ikony aplikací, které už v redakčním obsahu nejsou (nebo změnily adresu)
for (const file of readdirSync(out)) if (!wanted.has(file)) rmSync(join(out, file));

console.log(`přibaleno ${wanted.size - failed.length} ikon z ${ids.size} aplikací, ${(total / 1024).toFixed(0)} kB`);
if (failed.length) console.warn(`nestaženo:\n  ${failed.join("\n  ")}`);
