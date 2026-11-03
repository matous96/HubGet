import type { CatalogEntry } from "@/types";
import { placeholderColors } from "./utils";

/** Relativní jas barvy podle WCAG 2 (s gama korekcí sRGB), 0–1. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Bannery a karty se směrem dolů ztmavují (BRAND_SHADE, brandGradient) –
 * text a štítky leží zhruba uprostřed přechodu, tj. na barvě s ~14 % černé.
 */
const SHADE_AT_TEXT = 0.86;

/**
 * Nejmenší kontrast bílého textu, při kterém zůstane bílý. Bannery mají velké
 * tučné písmo se stínem a štítky na „skle“, takže bílá je čitelná i na
 * středních tónech (tyrkysová, oranžová, zelená); světlé barvy (žlutá,
 * světle zelená, bledě modrá – kolem 2 : 1) dostanou tmavý text.
 */
const MIN_WHITE_CONTRAST = 2.5;

/**
 * Je barva (hex) natolik světlá, že na ní musí být tmavý text? Kontrast
 * bílé podle WCAG proti barvě ztmavené jako místo s textem – bílý text se
 * použije vždy, když je dost čitelný.
 */
/**
 * Barva textu na barvě zvýraznění (tlačítka): bílá, pokud má s barvou
 * kontrast alespoň 3 : 1 (WCAG pro velký / tučný text), jinak tmavá.
 */
export function accentInk(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#ffffff";
  const rgb = m.slice(1).map((v) => parseInt(v, 16)) as [number, number, number];
  return 1.05 / (luminance(rgb) + 0.05) >= 3 ? "#ffffff" : "#0f172a";
}

export function isLight(hex: string): boolean {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const shaded = m.slice(1).map((v) => parseInt(v, 16) * SHADE_AT_TEXT) as [number, number, number];
  const whiteContrast = 1.05 / (luminance(shaded) + 0.05);
  return whiteContrast < MIN_WHITE_CONTRAST;
}

export interface Palette {
  /** Hlavní barva pozadí. */
  color: string;
  /** Je pozadí světlé? */
  light: boolean;
  /** Barva textu a dekorací na tomto pozadí. */
  ink: string;
}

/** Paleta pro libovolnou barvu (hex). */
export function paletteFor(color: string): Palette {
  const light = isLight(color);
  return { color, light, ink: light ? "#111827" : "#ffffff" };
}

/**
 * Náhradní paleta, když barvu ikony nejde zjistit: ručně zvolená barva značky,
 * jinak tmavší odstín náhradního avataru s iniciálami (PackageIcon) – banner
 * pak sedí k tomu, co je místo ikony vidět.
 */
export function brandPalette(entry: CatalogEntry): Palette {
  if (entry.brandColor) return paletteFor(entry.brandColor);
  return { color: placeholderColors(entry.name)[1], light: false, ink: "#ffffff" };
}

type Rgb = [number, number, number];

export const rgbToHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** RGB (0–255) → HSL (h 0–360, s a l 0–1). */
export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Barva ikony upravená pro velkou plochu banneru: ani skoro černá, ani
 * skoro bílá (jas 30–58 %), odstín a sytost zůstanou.
 */
export function bannerTone(rgb: Rgb): string {
  const [h, s, l] = rgbToHsl(rgb);
  return rgbToHex(hslToRgb([h, s, Math.min(0.58, Math.max(0.3, l))]));
}

/** Pod touto sytostí je barva šedá – její „odstín“ nic neznamená. */
const NEUTRAL_SATURATION = 0.15;

/**
 * Tmavá šedá z loga pro banner (DaVinci Resolve, Windows Terminal – v ikoně převládá):
 * jas 16–30 %, nejvýš lehký nádech barvy.
 */
export function darkTone(rgb: Rgb): string {
  const [h, s, l] = rgbToHsl(rgb);
  return rgbToHex(hslToRgb([h, Math.min(s, 0.1), Math.min(0.3, Math.max(0.16, l))]));
}

/** Šedá barva (tmavá šedá z loga) – bez odstínu, se kterým by se dala seskupit. */
export function isNeutralColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  return !!rgb && rgbToHsl(rgb)[1] < NEUTRAL_SATURATION;
}

/** Plynulá změna barvy karty nebo banneru (barva pozadí s přechodem nad ní, tintOf v lib/iconTile.ts). */
export const COLOR_TRANSITION = "background-color 450ms ease, color 450ms ease";

export const hexToRgb = (hex: string): Rgb | null => {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? (m.slice(1).map((v) => parseInt(v, 16)) as Rgb) : null;
};

/** Ikony se „stejnou“ barvou: odstíny nejvýš takhle daleko od sebe (°). */
const SAME_HUE = 30;
/** Převládající barva musí mít aspoň takový podíl váhy (a aspoň dvě ikony). */
const PREVAILING_SHARE = 0.4;

/**
 * Převládající barva sady ikon (karta kolekce): barvy ikon se seskupí podle
 * odstínu (±30°) a vyhraje skupina s největší vahou – první tři ikony (velké
 * na kartě) váží víc. Černobílé ikony (`neutral`) tvoří vlastní skupinu.
 * Vrací nejsytější barvu vítězné skupiny (průměr by byl kalný; Discord místo
 * tmavé barvy Steamu), nebo null, když žádná nepřevládá (pestrá sada) – karta
 * pak zůstane ve své barvě.
 */
export function prevailingColor(colors: (string | undefined)[], neutral: string): string | null {
  const items = colors.flatMap((color, i) => {
    const rgb = color ? hexToRgb(color) : null;
    if (!color || !rgb) return [];
    const [hue, saturation] = rgbToHsl(rgb);
    return [{ color, hue: color === neutral || saturation < NEUTRAL_SATURATION ? null : hue, saturation, weight: i < 3 ? 1.5 : 1 }];
  });
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  let best: typeof items = [];
  let bestWeight = 0;
  for (const center of items) {
    const group = items.filter((item) =>
      center.hue === null ? item.hue === null : item.hue !== null && hueDistance(item.hue, center.hue) <= SAME_HUE,
    );
    const weight = group.reduce((sum, item) => sum + item.weight, 0);
    if (weight > bestWeight) [best, bestWeight] = [group, weight];
  }
  if (best.length < 2 || bestWeight < total * PREVAILING_SHARE) return null;
  return best.reduce((vivid, item) => (item.saturation > vivid.saturation ? item : vivid)).color;
}
