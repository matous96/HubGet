/**
 * Vygenerovaná ikona aplikace, která žádnou ikonu nemá (PackageIcon): přechod
 * a symbol kategorie, dva průsvitné kruhy rozmístěné podle názvu a první písmeno
 * názvu v rohu. Balíček mimo katalog (npm, pip…) nemá kategorii – barva je podle
 * názvu a symbol podle správce (knihovna = balíček, aplikace = okno). Stejný název
 * = vždy stejná dlaždice; banner bez ikony bere její tmavší barvu (useBrandPalette).
 */
import { AppWindow, Package, type LucideIcon } from "lucide-react";
import { categoryColor, getCategory } from "@/data/categories";
import { getSource, isSourceId } from "@/services/managers/sources";
import type { CategoryId } from "@/types";
import { hslToRgb, rgbToHex, rgbToHsl } from "./color";
import { hashString, initialOf, placeholderColors } from "./utils";

/** Kruh v dlaždici: střed a průměr jako podíl velikosti dlaždice. */
export interface PlaceholderCircle {
  x: number;
  y: number;
  size: number;
}

export interface PlaceholderLook {
  /** Přechod dlaždice (světlejší → tmavší, tmavší je i barva banneru). */
  from: string;
  to: string;
  icon: LucideIcon;
  letter: string;
  circles: [PlaceholderCircle, PlaceholderCircle];
}

/** Rohy dlaždice – velký kruh v jednom, malý v protějším. */
const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

/** Světlejší konec přechodu z barvy kategorie. */
function lighter(hex: string): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const [h, s, l] = rgbToHsl([parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]);
  return rgbToHex(hslToRgb([h, Math.min(1, s + 0.05), Math.min(0.62, l + 0.14)]));
}

/** Symbol balíčku mimo katalog podle správce v id („npm:left-pad“ → balíček). */
function sourceIcon(id: string): LucideIcon {
  const source = id.slice(0, Math.max(0, id.indexOf(":")));
  return isSourceId(source) && getSource(source).group === "dev" ? Package : AppWindow;
}

export function placeholderLook(id: string, name: string, category: CategoryId | undefined): PlaceholderLook {
  const known = category && category !== "other" ? getCategory(category) : undefined;
  const [from, to] = known ? [lighter(categoryColor(known.id)), categoryColor(known.id)] : placeholderColors(name);
  const hash = hashString(name);
  const [cx, cy] = CORNERS[hash % 4];
  const [ox, oy] = CORNERS[(hash + 2) % 4];
  // Středy kruhů kousek za rohem – z dlaždice vykukují jen jejich oblouky
  const out = (corner: number, by: number) => (corner ? 1 + by : -by);
  return {
    from,
    to,
    icon: known?.icon ?? (category === "other" ? getCategory("other")!.icon : sourceIcon(id)),
    letter: initialOf(name),
    circles: [
      { x: out(cx, 0.08 + ((hash >> 3) % 10) / 100), y: out(cy, 0.06 + ((hash >> 6) % 10) / 100), size: 0.95 + ((hash >> 9) % 30) / 100 },
      { x: out(ox, 0.04), y: out(oy, 0.04 + ((hash >> 12) % 8) / 100), size: 0.5 + ((hash >> 15) % 25) / 100 },
    ],
  };
}
