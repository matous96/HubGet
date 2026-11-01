/**
 * Dominantní barva ikony aplikace – podle ní se barví banner v detailu
 * a karty na domovské stránce (u aplikací bez ručně zvolené barvy značky).
 *
 * Zdroje jsou stejné jako u ikony (lib/icons.ts – i ikona nainstalované
 * aplikace z nabídky Start), zkoušejí se popořadě. V desktopové aplikaci jdou
 * přes protokol icon:// (mezipaměť na disku, hlavička CORS), ve webové verzi
 * přímo s crossOrigin (funguje jen u serverů, které to povolí). Ikona se
 * zmenší na 40 × 40 px a spočítá se nejčastější sytý odstín – nebo tmavá
 * šedá, když v ikoně převládá. Výsledky se pamatují v localStorage, takže
 * při dalším otevření je banner hned ve správné barvě.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { bannerTone, darkTone, isNeutralColor } from "./color";
import { failedIconSources } from "./icons";

/** Černobílá ikona (GitHub, Notion…) – banner v neutrální břidlicové. */
export const NEUTRAL_TONE = "#334155";

// v2 (0.1.20): převládající tmavá šedá – barvy spočítané dřív se spočítají znovu
const STORAGE_KEY = "unibox-icon-colors-v2";
const LEGACY_STORAGE_KEY = "unibox-icon-colors";
const MAX_STORED = 800;

let stored: Record<string, string> | null = null;

function storedColors(): Record<string, string> {
  if (!stored) {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
    } catch {
      stored = {};
    }
  }
  return stored;
}

function remember(url: string, color: string) {
  const colors = storedColors();
  colors[url] = color;
  // Nejstarší záznamy zahodit (pořadí klíčů = pořadí vložení)
  const keys = Object.keys(colors);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STORED))) delete colors[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    /* plné nebo zakázané úložiště – barva se příště spočítá znovu */
  }
}

/** Ikona se nenačetla (404, chyba sítě) – na rozdíl od ikony, jejíž pixely nejde číst. */
class IconLoadError extends Error {}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // pixely jde číst jen u obrázků s hlavičkou CORS
    img.onload = () => resolve(img);
    img.onerror = () => reject(new IconLoadError(`Ikonu se nepodařilo načíst: ${src}`));
    img.src = src;
  });
}

/** Odstín (24 dílků po 15°) a sytost barvy; null = šedá, skoro černá nebo skoro bílá. */
function hueOf(r: number, g: number, b: number): { bucket: number; s: number } | null {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  const d = (max - min) / 255;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.25 || l < 0.08 || l > 0.94) return null;
  const h = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  return { bucket: Math.floor(h * 4) % 24, s };
}

/**
 * Pixely ikony roztříděné do 24 odstínů (váha = sytost, i počet pixelů), počet
 * neprůhledných pixelů a tmavé šedé a černé (bez bílé) – tmavá plocha loga.
 */
function analyze(pixels: Uint8ClampedArray) {
  const buckets = Array.from({ length: 24 }, () => ({ weight: 0, count: 0, r: 0, g: 0, b: 0 }));
  const dark = { count: 0, r: 0, g: 0, b: 0 };
  let opaque = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    opaque++;
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const hue = hueOf(r, g, b);
    if (!hue) {
      if (Math.max(r, g, b) + Math.min(r, g, b) < 255) {
        dark.count++;
        dark.r += r;
        dark.g += g;
        dark.b += b;
      }
      continue;
    }
    const bucket = buckets[hue.bucket];
    bucket.count++;
    bucket.weight += hue.s;
    bucket.r += r * hue.s;
    bucket.g += g * hue.s;
    bucket.b += b * hue.s;
  }
  // Váha odstínu i se sousedními (±15°)
  const windowWeight = (k: number) => [-1, 0, 1].reduce((sum, o) => sum + buckets[(k + o + 24) % 24].weight, 0);
  const windowCount = (k: number) => [-1, 0, 1].reduce((sum, o) => sum + buckets[(k + o + 24) % 24].count, 0);
  return { buckets, opaque, dark, windowWeight, windowCount };
}

/** Kolik barvy musí v ikoně být, aby se počítala (podíl neprůhledných pixelů vážený sytostí). */
const COLORED_SHARE = 0.06;

/**
 * Tmavá šedá / černá v ikoně převládá, když zabírá aspoň polovinu neprůhledných
 * pixelů a je jí aspoň 4× víc než pixelů nejsilnějšího odstínu (DaVinci Resolve:
 * tmavý kruh 66 %, nejvíc barvy – červené – 9 %).
 */
const DARK_SHARE = 0.5;
const DARK_OVER_HUE = 4;

/**
 * Nejčastější sytý odstín: pixely se roztřídí do 24 odstínů po 15° (váha =
 * sytost), vybere se nejsilnější trojice sousedních odstínů a zprůměruje.
 * Průhledné, šedé, skoro černé a skoro bílé pixely se nepočítají. Převládá-li
 * v ikoně tmavá šedá nebo černá (logo na tmavém kruhu, terminál), je barvou
 * ona. Když barevných pixelů je méně než 6 %, je ikona černobílá.
 */
export function dominantColor(pixels: Uint8ClampedArray): string | null {
  const { buckets, opaque, dark, windowWeight, windowCount } = analyze(pixels);
  if (!opaque) return null;

  let best = 0;
  let bestWeight = -1;
  for (let k = 0; k < 24; k++) {
    const w = windowWeight(k);
    if (w > bestWeight) [best, bestWeight] = [k, w];
  }
  if (dark.count >= opaque * DARK_SHARE && dark.count >= windowCount(best) * DARK_OVER_HUE) {
    return darkTone([dark.r / dark.count, dark.g / dark.count, dark.b / dark.count]);
  }
  if (bestWeight < opaque * COLORED_SHARE) return NEUTRAL_TONE;

  const sum = [-1, 0, 1].reduce(
    (acc, o) => {
      const bucket = buckets[(best + o + 24) % 24];
      return [acc[0] + bucket.r, acc[1] + bucket.g, acc[2] + bucket.b];
    },
    [0, 0, 0],
  );
  return bannerTone([sum[0] / bestWeight, sum[1] / bestWeight, sum[2] / bestWeight]);
}

/**
 * Je ručně zvolená barva značky v ikoně vidět? Sytá barva (Chrome #1a73e8):
 * aspoň 6 % ikony v jejím odstínu ±15° – u vícebarevných log pak banner dostane
 * barvu značky místo náhodně nejsilnějšího odstínu. Neutrální barva (OBS
 * #302e31): v ikoně převládá šedá nebo je černobílá. Barva, která v ikoně
 * není (GOG – fialová u šedé ikony), se nepoužije.
 */
export function brandInIcon(pixels: Uint8ClampedArray, brand: string): boolean {
  const m = brand.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const { opaque, windowWeight } = analyze(pixels);
  if (!opaque) return false;
  const hue = hueOf(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
  if (!hue) {
    const color = dominantColor(pixels);
    return color === NEUTRAL_TONE || (!!color && isNeutralColor(color));
  }
  return windowWeight(hue.bucket) >= opaque * COLORED_SHARE;
}

/**
 * Spočítá barvu ikony (null = ikona bez neprůhledných pixelů). Je-li zadaná
 * barva značky a ikona ji obsahuje, vrátí ji – jinak dominantní barvu ikony.
 */
export async function extractIconColor(src: string, brand?: string | null): Promise<string | null> {
  const img = await loadImage(src);
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(img, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const dominant = dominantColor(pixels);
  return dominant && brand && brandInIcon(pixels, brand) ? brand : dominant;
}

/**
 * Uložená barva ikony, kterou aplikace opravdu zobrazuje: prvního zdroje,
 * který nezná jako nefunkční. Barvu pozdějšího zdroje (třeba ikony z katalogu,
 * když se zobrazuje ikona z EXE) nepoužije – banner by neseděl k ikoně.
 */
function knownColor(sources: string[], brand: string | null | undefined): string | undefined {
  for (const src of sources) {
    if (failedIconSources.has(src)) continue;
    return storedColors()[storageKey(src, brand)];
  }
  return undefined;
}

/** Klíč uložené barvy – s barvou značky se výsledek může lišit. */
const storageKey = (src: string, brand: string | null | undefined) => (brand ? `${src}|${brand}` : src);

/** Dotaz na barvu ikony – sdílený bannerem (useIconColor) i kartou kolekce (useIconColors). */
function iconColorQuery(sources: string[], brand: string | null | undefined, known: string | undefined) {
  return {
    queryKey: ["icon-color", sources, brand ?? null],
    queryFn: async () => {
      for (const src of sources) {
        if (failedIconSources.has(src)) continue;
        try {
          const color = await extractIconColor(src, brand);
          if (color) {
            remember(storageKey(src, brand), color);
            return color;
          }
        } catch (error) {
          // Zdroj se nenačetl – nezkoušet ho znovu ani u ikony; jiná chyba (canvas) jen přeskočit
          if (error instanceof IconLoadError) failedIconSources.add(src);
        }
      }
      return null;
    },
    enabled: sources.length > 0 && !known,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  };
}

/**
 * Barva ikony pro banner – ze stejného zdroje jako ikona (první, který se
 * podaří načíst). Ručně zvolená barva značky se použije, jen když ji ikona
 * obsahuje. `pending` = barva se teprve počítá (banner zatím neutrální,
 * ať neprobleskne náhradní barvou).
 */
export function useIconColor(sources: string[], brand?: string | null): { color: string | undefined; pending: boolean } {
  const known = knownColor(sources, brand);
  const { data, isPending } = useQuery(iconColorQuery(sources, brand, known));
  return { color: known ?? data ?? undefined, pending: sources.length > 0 && !known && isPending };
}

/**
 * Barvy ikon několika aplikací (undefined = ikona bez barvy nebo nejde načíst).
 * `pending` = některá se ještě počítá. Stejné zdroje (dvě aplikace se stejnou
 * ikonou – Blackmagic Desktop Video a ATEM, aplikace bez ikony) sdílí jeden dotaz.
 */
export function useIconColors(items: { sources: string[]; brand?: string | null }[]): { colors: (string | undefined)[]; pending: boolean } {
  const known = items.map((item) => knownColor(item.sources, item.brand));
  const keys = items.map((item) => JSON.stringify([item.sources, item.brand ?? null]));
  const unique = [...new Set(keys)].map((key) => keys.indexOf(key));
  const results = useQueries({ queries: unique.map((i) => iconColorQuery(items[i].sources, items[i].brand, known[i])) });
  const resultOf = (i: number) => results[unique.indexOf(keys.indexOf(keys[i]))];
  return {
    colors: items.map((_, i) => known[i] ?? resultOf(i).data ?? undefined),
    pending: items.some((item, i) => item.sources.length > 0 && !known[i] && resultOf(i).isPending),
  };
}
