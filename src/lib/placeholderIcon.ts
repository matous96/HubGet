/**
 * Vygenerovaná ikona aplikace, která žádnou ikonu nemá (PackageIcon): symbol
 * kategorie a první písmeno názvu v její barvě na bílé dlaždici. Balíček mimo
 * katalog (npm, pip…) nemá kategorii – barva je podle názvu a symbol podle správce
 * (knihovna = balíček, aplikace = okno). Stejný název = vždy stejná dlaždice;
 * banner bez ikony bere její barvu (useBrandPalette).
 */
import { AppWindow, Package, type LucideIcon } from "lucide-react";
import { categoryColor, getCategory } from "@/data/categories";
import { getSource, isSourceId } from "@/services/managers/sources";
import type { CategoryId } from "@/types";
import { initialOf, placeholderColors } from "./utils";

export interface PlaceholderLook {
  /** Barva symbolu a písmena (i barva banneru). */
  to: string;
  icon: LucideIcon;
  letter: string;
}

/** Symbol balíčku mimo katalog podle správce v id („npm:left-pad“ → balíček). */
function sourceIcon(id: string): LucideIcon {
  const source = id.slice(0, Math.max(0, id.indexOf(":")));
  return isSourceId(source) && getSource(source).group === "dev" ? Package : AppWindow;
}

export function placeholderLook(id: string, name: string, category: CategoryId | undefined): PlaceholderLook {
  const known = category && category !== "other" ? getCategory(category) : undefined;
  return {
    to: known ? categoryColor(known.id) : placeholderColors(name)[1],
    icon: known?.icon ?? (category === "other" ? getCategory("other")!.icon : sourceIcon(id)),
    letter: initialOf(name),
  };
}
