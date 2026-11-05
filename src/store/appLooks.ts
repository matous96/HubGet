/**
 * Vlastní vzhled aplikací – barva banneru a ikona, které si uživatel nastavil
 * v detailu aplikace (components/package/AppLookEditor.tsx).
 *
 * Vidí ho jen uživatel sám: ukládá se do localStorage a po přihlášení se
 * synchronizuje mezi jeho počítači (oblast „looks“, store/syncKinds.ts – data účtu
 * vidí jen vlastník). Do profilu aplikací ani sdílených sad nepatří. Projeví se
 * všude, kde se aplikace ukazuje: ikona v kartách, řádcích, banneru i hlavičce
 * detailu (lib/icons.ts), barva v banneru a kartách na domovské stránce
 * (hooks/useBrandPalette.ts).
 *
 * Ikona se uloží jako malý obrázek WebP (data: URL, ICON_SIZE px, obvykle 5–15 kB), ať se
 * vejde do localStorage i do účtu a nezávisí na souboru, ze kterého pochází.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppLook {
  /** Barva banneru a karet (#rrggbb); bez ní podle ikony. */
  color?: string;
  /** Vlastní ikona (data:image/webp…); bez ní ikona z katalogu / nainstalované aplikace. */
  icon?: string;
}

interface AppLooksState {
  looks: Record<string, AppLook>;
  setColor: (appId: string, color: string | null) => void;
  setIcon: (appId: string, icon: string | null) => void;
  /** Vrátí aplikaci původní vzhled. */
  reset: (appId: string) => void;
  resetAll: () => void;
}

/** Úprava záznamu – prázdný záznam se smaže. */
function patched(looks: Record<string, AppLook>, appId: string, change: Partial<Record<keyof AppLook, string | null>>) {
  const next: AppLook = { ...looks[appId] };
  for (const [key, value] of Object.entries(change) as [keyof AppLook, string | null][]) {
    if (value) next[key] = value;
    else delete next[key];
  }
  const rest = { ...looks };
  if (next.color || next.icon) rest[appId] = next;
  else delete rest[appId];
  return rest;
}

export const useAppLooks = create<AppLooksState>()(
  persist(
    (set, get) => ({
      looks: {},
      setColor: (appId, color) => set({ looks: patched(get().looks, appId, { color }) }),
      setIcon: (appId, icon) => set({ looks: patched(get().looks, appId, { icon }) }),
      reset: (appId) => set({ looks: patched(get().looks, appId, { color: null, icon: null }) }),
      resetAll: () => set({ looks: {} }),
    }),
    { name: "unibox-app-looks" },
  ),
);

/** Vlastní ikona aplikace (nebo undefined). */
export const useCustomIcon = (appId: string) => useAppLooks((s) => s.looks[appId]?.icon);

/** Vlastní barva aplikace (nebo undefined). */
export const useCustomColor = (appId: string) => useAppLooks((s) => s.looks[appId]?.color);

/**
 * Velikost uložené ikony v px – ostrá v kartách i v banneru; největší dlaždice (hlavička detailu)
 * ukazuje logo zhruba ve 150 px, takže ji zvětší jen málo.
 */
const ICON_SIZE = 128;

/** Nejdelší uložená ikona (znaky data: URL) – delší se nepřijme ani z účtu. */
export const MAX_ICON_LENGTH = 80_000;

/** Proč obrázek nejde použít jako ikonu: nejde načíst, je prázdný (průhledný), ani zmenšený se nevejde. */
export type IconImportProblem = "unreadable" | "empty" | "tooLarge";

export class IconImportError extends Error {
  constructor(readonly problem: IconImportProblem) {
    super(problem);
  }
}

/**
 * Skoro celý průhledný obrázek – stejná mez jako kontrola ikon v PackageIcon (inspectIcon
 * v lib/icons.ts: v náhledu 24 × 24 px méně než 3 % viditelných pixelů). Takovou ikonu by
 * aplikace zahodila a ukázala původní – uživatel by „nastavenou“ ikonu nikde neviděl.
 */
function isBlank(source: HTMLCanvasElement): boolean {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(source, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  let visible = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 40) visible++;
  return visible < size * size * 0.03;
}

/**
 * Načte obrázek ze souboru (PNG, JPG, WebP, GIF, BMP, ICO, SVG) a zmenší ho do čtverce
 * ICON_SIZE × ICON_SIZE (poměr stran zachová, okraje průhledné). Vrací data: URL WebP.
 */
export async function importIconFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new IconImportError("unreadable"));
      image.src = url;
    });
    // SVG bez rozměrů má nulovou přirozenou velikost – nakreslí se přes celý čtverec
    const width = img.naturalWidth || ICON_SIZE;
    const height = img.naturalHeight || ICON_SIZE;
    const scale = ICON_SIZE / Math.max(width, height);
    const [w, h] = [Math.round(width * scale), Math.round(height * scale)];
    const canvas = document.createElement("canvas");
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new IconImportError("unreadable");
    context.imageSmoothingQuality = "high";
    context.drawImage(img, (ICON_SIZE - w) / 2, (ICON_SIZE - h) / 2, w, h);
    if (isBlank(canvas)) throw new IconImportError("empty");
    // Fotka nebo složitý obrázek: nižší kvalita, ať se ikona vejde (MAX_ICON_LENGTH)
    for (const quality of [0.92, 0.8, 0.6]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (!data.startsWith("data:image/")) throw new IconImportError("unreadable");
      if (data.length <= MAX_ICON_LENGTH) return data;
    }
    throw new IconImportError("tooLarge");
  } finally {
    URL.revokeObjectURL(url);
  }
}
