import {
  Clapperboard,
  Cloud,
  Code2,
  Gamepad2,
  Globe,
  GraduationCap,
  Image,
  MessagesSquare,
  Music,
  Network,
  NotebookPen,
  Settings2,
  Shapes,
  ShieldCheck,
  Sparkles,
  Wallet,
  Wallpaper,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogEntry, CategoryId } from "@/types";

/**
 * Definice kategorií pro UI. Název se bere z překladů (`categories.<id>`),
 * tady je jen ikona a barevný přechod dlaždice. V postranním panelu a na stránce
 * Kategorie se řadí podle názvu v jazyce aplikace (useSortedCategories).
 */
export interface CategoryDef {
  id: CategoryId;
  icon: LucideIcon;
  /** Tailwind třídy pro gradient pozadí dlaždice. */
  gradient: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "browsers", icon: Globe, gradient: "from-sky-500 to-blue-600" },
  { id: "development", icon: Code2, gradient: "from-violet-500 to-indigo-600" },
  { id: "communication", icon: MessagesSquare, gradient: "from-emerald-500 to-teal-600" },
  { id: "games", icon: Gamepad2, gradient: "from-rose-500 to-pink-600" },
  { id: "multimedia", icon: Clapperboard, gradient: "from-orange-500 to-amber-600" },
  { id: "audio", icon: Music, gradient: "from-pink-500 to-rose-600" },
  { id: "graphics", icon: Image, gradient: "from-fuchsia-500 to-purple-600" },
  { id: "productivity", icon: NotebookPen, gradient: "from-yellow-500 to-orange-500" },
  { id: "ai", icon: Sparkles, gradient: "from-indigo-500 to-fuchsia-600" },
  { id: "education", icon: GraduationCap, gradient: "from-lime-500 to-green-600" },
  { id: "finance", icon: Wallet, gradient: "from-emerald-500 to-green-700" },
  { id: "cloud", icon: Cloud, gradient: "from-sky-400 to-cyan-600" },
  { id: "network", icon: Network, gradient: "from-teal-500 to-cyan-700" },
  { id: "personalization", icon: Wallpaper, gradient: "from-purple-500 to-violet-700" },
  { id: "utilities", icon: Wrench, gradient: "from-slate-500 to-slate-700" },
  { id: "security", icon: ShieldCheck, gradient: "from-red-500 to-rose-700" },
  { id: "system", icon: Settings2, gradient: "from-cyan-500 to-sky-700" },
  { id: "other", icon: Shapes, gradient: "from-zinc-500 to-zinc-700" },
];

export const getCategory = (id: string) => CATEGORIES.find((c) => c.id === id);

/**
 * Barva kategorie (hex): karta výběru z kategorie na domovské stránce (skládá z ní přechod)
 * a vygenerovaná ikona aplikace bez ikony (lib/placeholderIcon.ts).
 */
const CATEGORY_COLORS: Record<CategoryId, string> = {
  browsers: "#1d4ed8",
  development: "#4338ca",
  // Komunikace a bezpečnost se ukazují stejný den – jiný odstín než zelená bezpečnost
  communication: "#6d28d9",
  games: "#be123c",
  multimedia: "#c2410c",
  graphics: "#a21caf",
  productivity: "#b45309",
  utilities: "#334155",
  // Zelená jako štít „Bezpečné“ – červená by působila jako varování
  security: "#047857",
  system: "#0e7490",
  ai: "#7e22ce",
  audio: "#be185d",
  cloud: "#0369a1",
  education: "#4d7c0f",
  finance: "#15803d",
  network: "#0f766e",
  personalization: "#6b21a8",
  other: "#3f3f46",
};

export const categoryColor = (id: CategoryId) => CATEGORY_COLORS[id];

/** Patří aplikace do kategorie? Ostatní = aplikace bez kategorie. */
export const inCategory = (entry: CatalogEntry, id: CategoryId) =>
  id === "other" ? entry.categories.length === 0 : entry.categories.includes(id);

/**
 * Kategorie seřazené podle názvu v jazyce aplikace (postranní panel, Kategorie,
 * Nejstahovanější); Ostatní vždy na konci.
 */
export function useSortedCategories(): CategoryDef[] {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  return useMemo(
    () =>
      [...CATEGORIES].sort(
        (a, b) =>
          Number(a.id === "other") - Number(b.id === "other") ||
          t(`categories.${a.id}`).localeCompare(t(`categories.${b.id}`), language),
      ),
    [t, language],
  );
}
