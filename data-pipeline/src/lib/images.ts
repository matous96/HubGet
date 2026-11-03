/**
 * Adresy obrázků z komunitních zdrojů: oprava zaniklých CDN, převod na HTTPS
 * a vytažení screenshotů z popisu balíčku (Markdown / HTML).
 */
import { fixDeadCdn } from "../../../src/lib/imageCdn.ts";

export { fixDeadCdn };

/** Šířky náhledů, které Wikimedia Commons vydá (jiné vrátí chybu 400). */
const WIKIMEDIA_WIDTHS = [120, 250, 330, 500, 960, 1280, 1920];

/**
 * Náhled z Wikimedia Commons v nestandardní šířce („512px-Steam_icon_logo…“)
 * → nejbližší standardní šířka („500px-…“).
 */
export function fixWikimediaThumb(url: string): string {
  return url.replace(
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/thumb\/.+\/)(\d+)px-([^/]+)$/,
    (_, prefix: string, width: string, file: string) => {
      const requested = Number(width);
      const nearest = WIKIMEDIA_WIDTHS.reduce((best, w) => (Math.abs(w - requested) < Math.abs(best - requested) ? w : best));
      return `${prefix}${nearest}px-${file}`;
    },
  );
}

/**
 * Adresa obrázku použitelná v aplikaci: opravené CDN, HTTPS (aplikace
 * načítá obrázky jen přes HTTPS – CSP), stránka souboru na GitHubu
 * („…/blob/…“) převedená na samotný soubor („…/raw/…“) a náhled
 * z Wikimedia ve standardní šířce.
 */
export function normalizeImageUrl(url: string): string | null {
  const trimmed = url.trim().replace(/^http:\/\//i, "https://");
  if (!/^https:\/\/[^/\s]+\/\S+$/.test(trimmed)) return null;
  const fixed = fixDeadCdn(trimmed);
  return fixed ? fixWikimediaThumb(fixed.replace(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/blob\//, "$1/raw/")) : null;
}

/** Obrázky, které nejsou screenshoty: odznaky, loga, ikony, bannery, tlačítka darů. */
const NOT_SCREENSHOT =
  /shields\.io|badge|appveyor|travis-ci|codecov|coveralls|icon|logo|favicon|banner|\/flags?\/|ko-fi|paypal|buymeacoffee|patreon|donat|sponsor|\.svg(\?|$)|\.ico(\?|$)/i;

/**
 * Screenshoty z popisu balíčku (Chocolatey má Markdown): `![alt](url)`
 * i `<img src="…">`. Vynechá odznaky, loga a podobné obrázky.
 */
export function descriptionImages(description: string | null | undefined): string[] {
  if (!description) return [];
  const pattern = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const urls: string[] = [];
  for (const match of description.matchAll(pattern)) {
    const alt = match[1] ?? match[0];
    const raw = match[2] ?? match[3];
    if (!raw || NOT_SCREENSHOT.test(raw) || NOT_SCREENSHOT.test(alt)) continue;
    const url = normalizeImageUrl(raw);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
