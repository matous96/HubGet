/**
 * Malé ikony (kratší strana 48–127 px) by byly v dlaždici detailu aplikace malé –
 * aplikace je zvětší nejvýš 2×, víc by byly rozmazané. Real-ESRGAN (model
 * realesrgan-x4plus-anime, BSD-3) je zvětší čtyřikrát s ostrými hranami, ImageMagick
 * zmenší na nejvýš 256 px a cwebp uloží jako WebP do out/icons. Workflow Katalog je
 * zveřejní s katalogem na hubget.eu/icons a katalog na ně odkáže.
 *
 * Název souboru je otisk obsahu původní ikony a nastavení zvětšení, takže stejnou ikonu
 * nezvětšuje znovu: hotové se berou z mezipaměti (.cache/upscaled) nebo ze zveřejněného
 * webu. Nástroje dodá workflow (REALESRGAN = cesta k realesrgan-ncnn-vulkan, MAGICK =
 * příkaz ImageMagick, CWEBP = cwebp); bez nich (místní běh) se použijí jen hotové
 * zvětšeniny. Zvětšuje se bez grafické karty (Vulkan na procesoru), proto má běh časový
 * limit UPSCALE_MINUTES – zbytek dorovnají další běhy, do té doby zůstane původní ikona.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { CatalogEntry } from "../../../src/types/index.ts";
import { CACHE_DIR, MAX_AGE, OUT_DIR, UPSCALED_ICONS_URL, USER_AGENT } from "../config.ts";
import { cachedFetch, Limiter, mapLimit } from "../lib/http.ts";
import { log } from "../lib/log.ts";
import { measureIcons, MIN_ICON, SHARP_ICON } from "./icons.ts";

const run = promisify(execFile);

/** Změna nastavení zvětšení (model, velikost, kvalita) = nové názvy souborů → vše se zvětší znovu. */
const VERSION = "realesrgan-x4plus-anime/4x/256/webp-q90";
const MODEL = "realesrgan-x4plus-anime";
/** Největší rozměr zvětšené ikony (dlaždice detailu má ~150 px, při 150 % DPI ~225 px). */
const TARGET = 256;
/** Větší soubor není ikona (stejný limit jako src-tauri/src/icons.rs). */
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
/** Kolik ikon zpracovat jedním spuštěním Real-ESRGAN (model se načítá při každém). */
const BATCH = 40;

const CACHE = join(CACHE_DIR, "upscaled");
const OUT = join(OUT_DIR, "icons");
const iconLimiter = new Limiter(8);

/** Formát podle prvních bajtů – Real-ESRGAN čte jen PNG, JPEG a WebP, ostatní převede ImageMagick. */
function formatOf(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (bytes.readUInt32BE(0) === 0x00000100) return "ico";
  if (bytes.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  if (bytes.subarray(0, 2).toString("latin1") === "BM") return "bmp";
  return null;
}

const isWebp = (bytes: Buffer) => formatOf(bytes) === "webp";
/** Plocha obrázku PNG z hlavičky IHDR. */
const pngArea = (png: Buffer) => (png.length >= 24 ? png.readUInt32BE(16) * png.readUInt32BE(20) : 0);

interface Tools {
  realesrgan: string;
  magick: string;
  cwebp: string;
}

/** Nástroje z proměnných prostředí – jen když jsou nastavené všechny (na Windows je „convert“ jiný program). */
function toolsFromEnv(): Tools | null {
  const { REALESRGAN, MAGICK, CWEBP } = process.env;
  return REALESRGAN && MAGICK && CWEBP ? { realesrgan: REALESRGAN, magick: MAGICK, cwebp: CWEBP } : null;
}

interface Job {
  url: string;
  name: string;
  source: Buffer;
  format: string;
}

/** Zvětší dávku ikon do mezipaměti; vrátí názvy hotových. */
async function upscaleBatch(jobs: Job[], tools: Tools, work: string): Promise<string[]> {
  const input = join(work, "in");
  const output = join(work, "x4");
  await rm(work, { recursive: true, force: true });
  await mkdir(input, { recursive: true });
  await mkdir(output, { recursive: true });

  // Vstup pro Real-ESRGAN: PNG (u ICO největší obrázek, u GIF první snímek)
  const ready: Job[] = [];
  for (const [i, job] of jobs.entries()) {
    const target = join(input, `${i}.png`);
    try {
      if (job.format === "png") {
        await writeFile(target, job.source);
      } else {
        const original = join(work, `${i}.${job.format}`);
        const frames = join(work, `${i}-frames`);
        await writeFile(original, job.source);
        await mkdir(frames);
        // Každý snímek zvlášť (ICO jich má víc velikostí), použije se největší
        await run(tools.magick, [job.format === "gif" ? `${original}[0]` : original, "-background", "none", `png32:${join(frames, "%d.png")}`]);
        const pngs = await Promise.all((await readdir(frames)).map(async (file) => ({ file, area: pngArea(await readFile(join(frames, file))) })));
        const largest = pngs.reduce((best, png) => (png.area > best.area ? png : best));
        await copyFile(join(frames, largest.file), target);
      }
      ready.push(job);
    } catch (error) {
      log.warn(`zvětšení ikon: ${job.url} nejde převést (${(error as Error).message.split("\n")[0]})`);
    }
  }
  if (!ready.length) return [];

  const models = join(dirname(tools.realesrgan), "models");
  await run(tools.realesrgan, ["-i", input, "-o", output, "-n", MODEL, "-s", "4", "-f", "png", "-m", models], { maxBuffer: 16 * 1024 * 1024 });

  const done: string[] = [];
  for (const job of ready) {
    const i = jobs.indexOf(job);
    const upscaled = join(output, `${i}.png`);
    const resized = join(work, `${i}-256.png`);
    try {
      // Zmenšit jen větší (zvětšenina 64–127 px má 256–508 px), poměr stran zachovat
      await run(tools.magick, [upscaled, "-filter", "Lanczos", "-resize", `${TARGET}x${TARGET}>`, `png32:${resized}`]);
      await run(tools.cwebp, ["-quiet", "-q", "90", "-alpha_q", "100", "-m", "6", resized, "-o", join(CACHE, job.name)]);
      done.push(job.name);
    } catch (error) {
      log.warn(`zvětšení ikon: ${job.url} se nepovedlo uložit (${(error as Error).message.split("\n")[0]})`);
    }
  }
  return done;
}

/** Hotová zvětšenina ze zveřejněného webu (přišla-li mezipaměť pipeline vniveč). */
async function fromPublished(name: string): Promise<boolean> {
  try {
    const res = await iconLimiter.run(() =>
      fetch(`${UPSCALED_ICONS_URL}/${name}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) }),
    );
    if (!res.ok) return false;
    const body = Buffer.from(await res.arrayBuffer());
    if (!isWebp(body)) return false;
    await writeFile(join(CACHE, name), body);
    return true;
  } catch {
    return false;
  }
}

/** Malým ikonám v katalogu přiřadí zvětšené (hotové, nebo nově zvětšené v časovém limitu). */
export async function upscaleSmallIcons(packages: CatalogEntry[]) {
  await mkdir(CACHE, { recursive: true });
  // Zveřejňují se jen ikony, na které katalog odkazuje
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const sizes = await measureIcons(packages.map((p) => p.iconUrl).filter((url): url is string => !!url));
  const small = [...new Set(packages.map((p) => p.iconUrl))].filter((url): url is string => {
    const size = url ? sizes.get(url) : undefined;
    return !!size && !size.vector && Math.min(size.width, size.height) >= MIN_ICON && Math.min(size.width, size.height) < SHARP_ICON;
  });

  // Původní ikony a názvy zvětšenin podle otisku obsahu
  const jobs: Job[] = [];
  await mapLimit(small, 8, async (url) => {
    const res = await cachedFetch(url, { maxAge: MAX_AGE.iconSizes, limiter: iconLimiter, retries: 1 });
    if (res.status !== 200 || !res.body.length || res.body.length > MAX_SOURCE_BYTES) return;
    const format = formatOf(res.body);
    if (!format) return;
    const name = `${createHash("sha256").update(`${VERSION}\n`).update(res.body).digest("hex").slice(0, 40)}.webp`;
    jobs.push({ url, name, source: res.body, format });
  });

  const available = new Set(await readdir(CACHE));
  // Zveřejněný web se prohledá jen při prázdné mezipaměti (nový běžec, smazaná mezipaměť) –
  // jinak chybějí jen ikony, které ještě nikdo nezvětšil
  const missing = available.size ? [] : jobs;
  let published = 0;
  await mapLimit(missing, 8, async (job) => {
    if (await fromPublished(job.name)) {
      available.add(job.name);
      published++;
    }
  });

  // Nově zvětšit, co chybí – jen s nástroji a v časovém limitu
  const tools = toolsFromEnv();
  const todo = jobs.filter((job) => !available.has(job.name));
  let upscaled = 0;
  if (tools && todo.length) {
    const deadline = Date.now() + Number(process.env.UPSCALE_MINUTES ?? 20) * 60_000;
    const work = join(tmpdir(), "hubget-upscale");
    for (let i = 0; i < todo.length && Date.now() < deadline; i += BATCH) {
      try {
        for (const name of await upscaleBatch(todo.slice(i, i + BATCH), tools, work)) {
          available.add(name);
          upscaled++;
        }
      } catch (error) {
        log.warn(`zvětšení ikon: dávka selhala (${(error as Error).message.split("\n")[0]})`);
      }
      log.info(`zvětšení ikon: ${Math.min(i + BATCH, todo.length)} / ${todo.length}`);
    }
    await rm(work, { recursive: true, force: true });
  }

  // Katalog odkáže na zvětšeniny; soubory do out/icons ke zveřejnění
  const byUrl = new Map(jobs.filter((job) => available.has(job.name)).map((job) => [job.url, job.name]));
  for (const name of new Set(byUrl.values())) await copyFile(join(CACHE, name), join(OUT, name));
  let replaced = 0;
  for (const entry of packages) {
    const name = entry.iconUrl ? byUrl.get(entry.iconUrl) : undefined;
    if (!name) continue;
    entry.iconUrl = `${UPSCALED_ICONS_URL}/${name}`;
    replaced++;
  }
  log.info(
    `zvětšení ikon: ${small.length} malých ikon (${MIN_ICON}–${SHARP_ICON - 1} px), ${replaced} aplikací se zvětšenou ` +
      `(${upscaled} nově, ${published} ze zveřejněného webu), ${jobs.length - byUrl.size} čeká` +
      (tools ? "" : " – nástroje nejsou nastavené (REALESRGAN, MAGICK, CWEBP), jen hotové zvětšeniny"),
  );
}
