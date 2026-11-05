/**
 * Barva karty kolekce podle ikon v ní: když v sadě převládá jedna barva
 * (třeba modré ikony KeePassu, Signalu a Malwarebytes), karta ji převezme;
 * u pestré sady zůstane barva kolekce (kategorie). Barvy ikon jsou stejné
 * jako u banneru v detailu aplikace (lib/iconColor.ts – i s mezipamětí).
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { paletteFor, prevailingColor, type Palette } from "@/lib/color";
import { NEUTRAL_TONE, useIconColors } from "@/lib/iconColor";
import { useIconSourcesOf } from "@/lib/icons";
import { useAppLooks } from "@/store/appLooks";
import type { CatalogEntry } from "@/types";

/** Kolik ikon rozhoduje o barvě – plovoucí ikony a lišta karty. */
const COLOR_ICONS = 6;

export function useCollectionPalette(entries: CatalogEntry[], fallback: string): Palette {
  const shown = useMemo(() => entries.slice(0, COLOR_ICONS), [entries]);
  const sources = useIconSourcesOf(shown);
  const { colors, pending } = useIconColors(shown.map((e, i) => ({ sources: sources[i], brand: e.brandColor })));
  // Dokud se barvy počítají, barva kolekce – pak plynulý přechod (COLOR_TRANSITION)
  // Barva, kterou si uživatel u aplikace nastavil sám (store/appLooks.ts), platí i tady
  const customs = useAppLooks(useShallow((s) => shown.map((e) => s.looks[e.id]?.color)));
  const color = pending ? null : prevailingColor(colors.map((c, i) => customs[i] ?? c), NEUTRAL_TONE);
  return paletteFor(color ?? fallback);
}
