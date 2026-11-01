/**
 * Aplikace, které výrobce dává ke stažení jen na svém webu (web-only.json) – žádný
 * správce balíčků je nemá (DaVinci Resolve). Katalog je nese mimo `packages`
 * v `webOnly`: HubGet je ukáže s odkazem na oficiální stránku ke stažení
 * a nainstalované pozná a otevře, ale neinstaluje, neaktualizuje ani neodinstaluje.
 *
 * Verzi a datum vydání produktů Blackmagic Design doplní jejich veřejný seznam
 * stažení – jen údaje o verzích, registraci ani stahování to neobchází. Když
 * seznam není k dispozici, platí verze uvedená ručně.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogEntry, CategoryId } from "../../../src/types/index.ts";
import { MAX_AGE, PIPELINE_DIR } from "../config.ts";
import { fetchJson } from "../lib/http.ts";
import { log } from "../lib/log.ts";

/** Ručně spravovaný záznam (klíč = id v katalogu). */
interface WebOnlyApp {
  name: string;
  publisher: string;
  description: string;
  categories: CategoryId[];
  tags: string[];
  iconUrl: string | null;
  brandColor?: string;
  homepage: string;
  downloadUrl: string;
  supportUrl?: string;
  license: string | null;
  popularity: number;
  /** Verze, když ji nejde zjistit automaticky; chybí = aplikace verzi neukazuje (zastaralá by mátla). */
  latestVersion?: string;
  /** Produkt v seznamu stažení Blackmagic Design („davinci-resolve“) – odtud verze a datum vydání. */
  blackmagic?: string;
  alternatives?: string[];
  /** Názvy v registru jako regulární výrazy, když se program jmenuje jinak než aplikace. */
  installedNames?: string[];
}

const BLACKMAGIC_DOWNLOADS = "https://www.blackmagicdesign.com/api/support/us/downloads.json";

interface BlackmagicDownload {
  name: string;
  /** „02 Oct 2026“, u nedávných vydání slovy („Yesterday“, „Last Tuesday“). */
  date?: string;
  urls?: Record<string, { product?: string; major?: number; minor?: number; releaseNum?: number; beta?: number }[]>;
}

/** Verze a datum posledního vydání produktu pro Windows (bez bet – ty mají `beta` menší než 255). */
function latestRelease(downloads: BlackmagicDownload[], product: string, today: Date) {
  let best: { parts: number[]; date?: string } | null = null;
  for (const d of downloads) {
    const win = d.urls?.Windows?.find((u) => u.product === product && u.beta === 255);
    if (!win || win.major === undefined) continue;
    const parts = [win.major, win.minor ?? 0, win.releaseNum ?? 0];
    if (!best || compareParts(parts, best.parts) > 0) best = { parts, date: releaseDate(d.date, today) };
  }
  if (!best) return null;
  // „21.1.0“ → „21.1“ jako na webu výrobce
  const version = (best.parts[2] ? best.parts : best.parts.slice(0, 2)).join(".");
  return { version, date: best.date };
}

const compareParts = (a: number[], b: number[]) => a.reduce((result, n, i) => result || n - (b[i] ?? 0), 0);

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Datum ze seznamu stažení jako ISO; slovní „Today“, „Yesterday“, „Last Tuesday“ podle dnešního dne. */
function releaseDate(text: string | undefined, today: Date): string | undefined {
  if (!text) return undefined;
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const lower = text.trim().toLowerCase();
  const back = (days: number) => new Date(day.getTime() - days * 86_400_000).toISOString();
  if (lower === "today") return back(0);
  if (lower === "yesterday") return back(1);
  const weekday = WEEKDAYS.indexOf(lower.replace(/^last\s+/, ""));
  if (weekday >= 0) return back(((day.getUTCDay() - weekday + 7) % 7) || 7);
  const parsed = new Date(`${text} UTC`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Záznamy katalogu pro aplikace jen z webu výrobce (bez `addedAt` – doplní sestavení katalogu). */
export async function loadWebOnly(now: string): Promise<Omit<CatalogEntry, "addedAt">[]> {
  let apps: Record<string, WebOnlyApp>;
  try {
    apps = JSON.parse(await readFile(join(PIPELINE_DIR, "web-only.json"), "utf8")) as Record<string, WebOnlyApp>;
  } catch {
    return [];
  }

  let downloads: BlackmagicDownload[] = [];
  if (Object.values(apps).some((a) => a.blackmagic)) {
    try {
      downloads = (await fetchJson<{ downloads?: BlackmagicDownload[] }>(BLACKMAGIC_DOWNLOADS, { maxAge: MAX_AGE.webOnly, retries: 1 })).downloads ?? [];
    } catch (error) {
      log.warn(`Seznam stažení Blackmagic Design nedostupný – platí ručně uvedené verze (${String(error)})`);
    }
  }

  const today = new Date(now);
  return Object.entries(apps).map(([id, app]) => {
    const release = app.blackmagic ? latestRelease(downloads, app.blackmagic, today) : null;
    const { blackmagic: _, latestVersion, ...rest } = app;
    return {
      id,
      ...rest,
      latestVersion: release?.version ?? latestVersion ?? "",
      releaseDate: release?.date,
      sources: [],
    };
  });
}
