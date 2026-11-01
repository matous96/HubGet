/**
 * Barevná paleta aplikace pro banner a karty – vždy podle ikony, kterou
 * aplikace opravdu zobrazuje:
 *  1. barva ikony (ze stejných zdrojů jako ikona – i z EXE nainstalované
 *     aplikace): ručně zvolená barva značky (curated.json), pokud ji ikona
 *     obsahuje (vícebarevná loga – Chrome), jinak dominantní odstín ikony;
 *     černobílá ikona = neutrální břidlicová,
 *  2. ikonu nejde načíst ani prozkoumat: barva značky,
 *  3. jinak tmavší barva vygenerované dlaždice (lib/placeholderIcon.ts).
 */
import { brandPalette, paletteFor, type Palette } from "@/lib/color";
import { NEUTRAL_TONE, useIconColor } from "@/lib/iconColor";
import { useIconSources } from "@/lib/icons";
import { placeholderLook } from "@/lib/placeholderIcon";
import type { CatalogEntry } from "@/types";

export function useBrandPalette(entry: CatalogEntry): Palette {
  const sources = useIconSources(entry.id, entry.name, entry.iconUrl);
  const { color, pending } = useIconColor(sources, entry.brandColor);
  if (color) return paletteFor(color);
  // Během výpočtu neutrálně – pak plynulý přechod do barvy ikony
  if (pending) return paletteFor(NEUTRAL_TONE);
  if (entry.brandColor) return brandPalette(entry);
  return { color: placeholderLook(entry.id, entry.name, entry.categories[0]).to, light: false, ink: "#ffffff" };
}
