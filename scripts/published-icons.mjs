// Zvětšené ikony, na které odkazuje zveřejněný katalog (data-pipeline/src/build/upscale.ts).
// Při nasazení jen změny webu (workflow Katalog bez pipeline) se stáhnou ze stávajícího webu –
// GitHub Pages nasazuje vždy celý web a bez nich by aplikace dostala u ikon chybu 404.
//
//   node scripts/published-icons.mjs <catalog.json> <cílová složka>
//
// Kterákoli ikona, která nejde stáhnout, zastaví nasazení (raději starý web než rozbité ikony).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [catalogFile, outDir] = process.argv.slice(2);
const base = `${process.env.HUBGET_ICONS_URL ?? "https://hubget.eu/icons"}/`;
const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
const names = [...new Set(catalog.packages.map((p) => p.iconUrl).filter((url) => url?.startsWith(base)).map((url) => url.slice(base.length)))];
await mkdir(outDir, { recursive: true });

const failed = [];
let next = 0;
async function worker() {
  while (next < names.length) {
    const name = names[next++];
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(base + name, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());
        if (body.subarray(8, 12).toString("latin1") !== "WEBP") throw new Error("není WebP");
        await writeFile(join(outDir, name), body);
        break;
      } catch (error) {
        if (attempt >= 3) {
          failed.push(`${name}: ${error.message}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
}
await Promise.all(Array.from({ length: 16 }, worker));

console.log(`zvětšené ikony ze zveřejněného webu: ${names.length - failed.length} / ${names.length}`);
if (failed.length) {
  console.error(`nestaženo:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
