/**
 * Dlaždice ikony aplikace: všechny ikony – i ty s vlastním podkladem (Foxit, TeamViewer) –
 * leží stejně v bílé dlaždici s okrajem, jen s nádechem své převládající barvy a měkkým
 * stínem pod logem; téměř bílé logo dostane tmavou dlaždici, aby nezmizelo.
 * Ikona se čte v canvasu (jen zdroje s hlavičkou CORS, viz canInspect v lib/icons.ts);
 * výsledek se pamatuje podle zdroje – další karta se stejnou ikonou ho má hned.
 */
import type { CSSProperties } from "react";
import { NEUTRAL_TONE, dominantColor } from "./iconColor";
import { hexToRgb, hslToRgb, isNeutralColor, rgbToHex, rgbToHsl } from "./color";

export interface IconTile {
  /** Pozadí dlaždice (CSS background). */
  background: string;
  /**
   * Barva měkkého stínu pod logem – logo se od dlaždice odrazí jako ikony na iOS / macOS
   * (Telegram: modrá záře pod kruhem).
   */
  shadow: string;
}

const tiles = new Map<string, IconTile>();

export const iconTileOf = (src: string) => tiles.get(src);

/** Rozlišení, ve kterém se ikona zkoumá. */
const SIZE = 40;

/**
 * Světlý odstín dlaždice: podíl barvy loga na začátku a na konci přechodu (%) –
 * jen nádech, slabší než plochy .tint-surface (banner, karty), ať ikony nejsou moc barevné.
 */
const TINT_FROM = 2;
const TINT_TO = 5;

/**
 * Barva, ze které se míchá světlý odstín: tmavá barva značky nebo ikony (Steam #1b2838)
 * by se s bílou ztratila v šedé – použije se její odstín se světlostí 42–62 % a aspoň
 * střední sytostí (Discord #5865f2 zůstane, jak je). Šedá (černobílá ikona, NEUTRAL_TONE)
 * zůstane šedou, barva v jiném zápisu než hex se nemění.
 */
function tintSource(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb || color === NEUTRAL_TONE || isNeutralColor(color)) return color;
  const [h, s, l] = rgbToHsl(rgb);
  return rgbToHex(hslToRgb([h, Math.max(s, 0.45), Math.min(0.62, Math.max(0.42, l))]));
}

/** Dlaždice: světlý přechod v odstínu loga, u téměř bílého loga tmavý. */
function logoBackground(color: string | null, light: boolean): string {
  if (light) {
    if (!color || color === NEUTRAL_TONE || isNeutralColor(color)) return "linear-gradient(160deg, #3f3f46, #18181b)";
    return `linear-gradient(160deg, color-mix(in srgb, ${color} 55%, #27272a), color-mix(in srgb, ${color} 30%, #09090b))`;
  }
  const tint = tintSource(color ?? NEUTRAL_TONE);
  return `linear-gradient(160deg, color-mix(in srgb, ${tint} ${TINT_FROM}%, white), color-mix(in srgb, ${tint} ${TINT_TO}%, white))`;
}

/**
 * Odstín barvy ikony pro velké plochy (banner v detailu, karty na domovské stránce) –
 * ve světlém tématu světlý, v tmavém tmavý s nádechem barvy.
 * Pozadí dává třída .tint-surface (styles/index.css) podle proměnné --tint:
 *  - style: proměnná --tint pro plochu (nebo pro předka s třídou .tint-vars),
 *  - from / to: barva na začátku a konci přechodu (to = podklad pod textem),
 *  - ink: text – ve světlém tématu tmavý, v tmavém světlý, s nádechem barvy,
 *  - hue: barva upravená pro odstín (tintSource) – pro vzorek ikon.
 * Hodnoty jsou proměnné CSS, platí jen uvnitř plochy (nebo .tint-vars).
 */
export function tintOf(source: string) {
  const color = tintSource(source);
  return {
    style: { "--tint": color } as CSSProperties,
    from: "var(--tint-from)",
    to: "var(--tint-to)",
    ink: "var(--tint-ink)",
    hue: color,
  };
}

/** Bílá dlaždice s nádechem barvy a stínem v ní – pro logo i náhradní symbol kategorie (PackageIcon). */
export function colorTile(color: string): IconTile {
  return {
    background: logoBackground(color, false),
    shadow: `color-mix(in srgb, ${tintSource(color)} 25%, transparent)`,
  };
}

/**
 * Spočítá dlaždici načtené ikony (`light` = téměř bílá podle inspectIcon). Obrázek,
 * jehož pixely nejde číst, dlaždici nemá – zůstane bílý podklad.
 */
export function analyzeIconTile(img: HTMLImageElement, src: string, light: boolean): IconTile | undefined {
  const known = tiles.get(src);
  if (known) return known;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(img, 0, 0, SIZE, SIZE);
    const color = dominantColor(context.getImageData(0, 0, SIZE, SIZE).data);
    // Téměř bílé logo na tmavé dlaždici s tmavým stínem
    const tile = light ? { background: logoBackground(color, true), shadow: "rgb(0 0 0 / 0.45)" } : colorTile(color ?? NEUTRAL_TONE);
    tiles.set(src, tile);
    return tile;
  } catch {
    // Obrázek z jiného serveru bez CORS
    return undefined;
  }
}
