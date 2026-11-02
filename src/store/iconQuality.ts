/**
 * Rozlišení ikon aplikací z katalogu (kratší strana obrázku v pixelech):
 *  - sekce „Dnes“ ukazuje ikony velké a malá by byla rozmazaná (lib/today.ts),
 *  - malá ikona z katalogu ustoupí ikoně nainstalované aplikace (lib/icons.ts).
 * Katalog rozlišení neuvádí, proto se změří z načteného obrázku (stejný zdroj
 * jako PackageIcon – v desktopu přes mezipaměť icon://) a uloží natrvalo;
 * každá ikona se měří jen jednou – při zobrazení na kartě, nebo předem.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { remoteIconSrc } from "@/lib/iconSrc";

/** Vektorová ikona (SVG) – ostrá v jakékoli velikosti. */
export const VECTOR_ICON = 9999;
/** Kolik ikon si pamatovat (nejstarší záznamy se zahodí). */
const KEEP = 4000;

/** Bez nejstarších záznamů nad limit KEEP. */
function trimmed(sizes: Record<string, number>): Record<string, number> {
  const keys = Object.keys(sizes);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) delete sizes[old];
  return sizes;
}
/** Jak dlouho čekat na načtení ikony. */
const TIMEOUT = 10_000;

interface IconQualityState {
  /** Adresa ikony z katalogu → kratší strana v px (ukládá se natrvalo). */
  sizes: Record<string, number>;
  /**
   * Ikony, které se v tomto spuštění nenačetly – jen do zavření aplikace. Bez internetu
   * nebo při výpadku serveru by trvale zapsaná nula ikonu vyřadila (sekce Dnes) i potom,
   * co se síť vrátí.
   */
  failed: Record<string, true>;
  put: (url: string, size: number) => void;
  fail: (url: string) => void;
}

export const useIconQuality = create<IconQualityState>()(
  persist(
    (set, get) => ({
      sizes: {},
      failed: {},
      put: (url, size) => set({ sizes: trimmed({ ...get().sizes, [url]: size }) }),
      fail: (url) => set({ failed: { ...get().failed, [url]: true } }),
    }),
    {
      name: "unibox-icon-quality",
      partialize: (state) => ({ sizes: state.sizes }),
      // Verze 1: neúspěchy se neukládají – dřívější nuly (i z výpadku sítě) dostanou novou šanci
      version: 1,
      migrate: (stored) => {
        const sizes = (stored as { sizes?: Record<string, number> } | undefined)?.sizes ?? {};
        return { sizes: Object.fromEntries(Object.entries(sizes).filter(([, size]) => size > 0)) } as IconQualityState;
      },
    },
  ),
);

/** Rozlišení ikon pro výběr: změřená + v tomto spuštění nenačtené jako 0 (malá ikona). */
export function knownIconSizes(state: Pick<IconQualityState, "sizes" | "failed"> = useIconQuality.getState()): Record<string, number> {
  const failed = Object.keys(state.failed);
  return failed.length ? { ...Object.fromEntries(failed.map((url) => [url, 0])), ...state.sizes } : state.sizes;
}

const isSvg = (url: string) => /\.svgz?($|[?#])/i.test(url);
const pending = new Map<string, Promise<number | undefined>>();

/** Kratší strana načteného obrázku (SVG bez rozměrů = vektor). */
export const iconPixels = (url: string, img: HTMLImageElement) =>
  isSvg(url) || !img.naturalWidth || !img.naturalHeight ? VECTOR_ICON : Math.min(img.naturalWidth, img.naturalHeight);

/** Rozlišení zapsaná při zobrazení ikon – uloží se najednou (desítky karet = jeden zápis). */
let buffered: Record<string, number> | null = null;

/**
 * Zapamatuje rozlišení ikony z katalogu, kterou právě zobrazila karta
 * (PackageIcon) – bez dalšího stahování. Podle něj má ikona z katalogu
 * přednost před ikonou nainstalované aplikace (lib/icons.ts).
 */
export function recordIconSize(url: string, img: HTMLImageElement) {
  if (useIconQuality.getState().sizes[url] !== undefined || buffered?.[url] !== undefined) return;
  if (!buffered) {
    buffered = {};
    setTimeout(() => {
      const batch = buffered ?? {};
      buffered = null;
      useIconQuality.setState({ sizes: trimmed({ ...useIconQuality.getState().sizes, ...batch }) });
    }, 1000);
  }
  buffered[url] = iconPixels(url, img);
}

/**
 * Změří ikonu (výsledek uloží). Vrací kratší stranu v px, 0 = nenačetla se
 * (pamatuje se jen do zavření aplikace), undefined = nestihla se načíst.
 */
export function measureIcon(url: string): Promise<number | undefined> {
  const known = useIconQuality.getState().sizes[url];
  if (known !== undefined) return Promise.resolve(known);
  if (useIconQuality.getState().failed[url]) return Promise.resolve(0);
  if (isSvg(url)) {
    useIconQuality.getState().put(url, VECTOR_ICON);
    return Promise.resolve(VECTOR_ICON);
  }
  let request = pending.get(url);
  if (!request) {
    request = new Promise<number | undefined>((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(undefined), TIMEOUT);
      img.onload = () => {
        clearTimeout(timer);
        resolve(iconPixels(url, img));
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(0);
      };
      img.src = remoteIconSrc(url);
    }).then((size) => {
      pending.delete(url);
      if (size === 0) useIconQuality.getState().fail(url);
      else if (size !== undefined) useIconQuality.getState().put(url, size);
      return size;
    });
    pending.set(url, request);
  }
  return request;
}
