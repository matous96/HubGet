/**
 * Záložní systém ikon aplikací.
 *
 * Pro každou aplikaci se sestaví seřazený seznam zdrojů a použije se první,
 * který funguje:
 *  1. ikona z katalogu (manifest wingetu, databáze UniGetUI, Chocolatey) –
 *     když je dost velká (aspoň 128 px nebo vektor; rozlišení se zapamatuje
 *     při prvním zobrazení, store/iconQuality.ts),
 *  2. skutečná ikona nainstalované aplikace – z její položky v nabídce Start
 *     (EXE, zástupce, aplikace ze Storu; jen v desktopové aplikaci); při malé
 *     ikoně v katalogu má přednost ona,
 *  3. vygenerovaný avatar s iniciálami (PackageIcon).
 * Favicony webu aplikace se za běhu nehledají (služby Googlu / DuckDuckGo by
 * se dozvěděly, které aplikace si uživatel prohlíží) – ikony z webů aplikací
 * vybírá datová pipeline předem.
 * Ikona z katalogu má přednost i proto, že se nemění: ikona zástupce se
 * načte až s nabídkou Start a karta by jinak po chvíli přeskočila na jinou
 * ikonu i barvu (OneDrive: modrý mráček → žlutá složka).
 *
 * V desktopové aplikaci jdou všechny ikony přes protokol icon:// (Rust,
 * icons.rs): stáhnou se jednou a pak se načítají z mezipaměti na disku,
 * ICO se převádí na PNG a prázdné obrázky backend odmítne. Načtená ikona se
 * navíc zkontroluje v canvasu: prázdná → další zdroj, skoro bílá → tmavé pozadí.
 * Ikona z internetu menší než MIN_ICON se přeskočí jako nefunkční – všude by
 * byla rozmazaná (katalog takové ikony neobsahuje, viz datová pipeline; jde
 * o ikony, které se od sestavení katalogu změnily). Menší ikona se
 * nezvětší víc než MAX_UPSCALE× – v detailu je o kousek menší, ale ne rozmazaná.
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useInstalledIndex } from "@/hooks/usePackages";
import { useIconQuality } from "@/store/iconQuality";
import type { CatalogEntry } from "@/types";
import { appIconSrc, ICON_HOST, remoteIconSrc } from "./iconSrc";
import { startAppFor, useStartApps } from "./launch";

export { appIconSrc, fileIconSrc, remoteIconSrc } from "./iconSrc";

/** Ikona z katalogu menší než tolik px ustoupí ikoně nainstalované aplikace. */
const CATALOG_ICON_MIN = 128;

/**
 * Menší ikona z internetu se nepoužije (favicon 16–32 px; stejná mez jako
 * MIN_ICON v datové pipeline, data-pipeline/src/build/icons.ts). Ikony
 * nainstalovaných programů se nekontrolují – jiná skutečná ikona aplikace nebývá.
 */
export const MIN_ICON = 48;

/** Ikona se nezvětší víc než tolikrát (v pixelech obrazovky). */
export const MAX_UPSCALE = 2;

/** Ikona z internetu (ne z nabídky Start ani ze seznamu Po spuštění)? */
export const isRemoteIcon = (src: string) => !src.startsWith(ICON_HOST) || src.startsWith(`${ICON_HOST}/remote`);

/** Lze ikonu zkoumat v canvasu? (protokol icon:// posílá hlavičku CORS) */
export const canInspect = (src: string) => src.startsWith(ICON_HOST);

/** Pořadí zdrojů ikony (bez duplicit) – viz popis modulu. */
function orderSources(iconUrl: string | null | undefined, localAppId: string | undefined, catalogSize: number | undefined): string[] {
  const catalog = iconUrl ? [remoteIconSrc(iconUrl)] : [];
  if (!localAppId) return catalog;
  const catalogFirst = catalog.length > 0 && (catalogSize === undefined || catalogSize >= CATALOG_ICON_MIN);
  return [...new Set(catalogFirst ? [...catalog, appIconSrc(localAppId)] : [appIconSrc(localAppId), ...catalog])];
}

/** Seřazené zdroje ikony aplikace (bez duplicit). */
export function useIconSources(id: string, name: string, iconUrl: string | null | undefined): string[] {
  const installed = useInstalledIndex().get(id);
  const { data: startApps } = useStartApps();
  // Stejné párování jako u tlačítka Otevřít
  const local = installed && startApps ? startAppFor(startApps, name, installed) : undefined;
  // Rozlišení ikony z katalogu (neznámé = zatím se nezobrazila)
  const catalogSize = useIconQuality((s) => (iconUrl ? s.sizes[iconUrl] : undefined));

  return useMemo(() => orderSources(iconUrl, local?.appId, catalogSize), [iconUrl, local, catalogSize]);
}

/** Zdroje ikon pro víc aplikací najednou (karta kolekce – barva podle ikon) – stejné jako useIconSources. */
export function useIconSourcesOf(entries: Pick<CatalogEntry, "id" | "name" | "iconUrl">[]): string[][] {
  const installedIndex = useInstalledIndex();
  const { data: startApps } = useStartApps();
  const catalogSizes = useIconQuality(useShallow((s) => entries.map((e) => (e.iconUrl ? s.sizes[e.iconUrl] : undefined))));

  return useMemo(
    () =>
      entries.map((e, i) => {
        const installed = installedIndex.get(e.id);
        const local = installed && startApps ? startAppFor(startApps, e.name, installed) : undefined;
        return orderSources(e.iconUrl, local?.appId, catalogSizes[i]);
      }),
    [entries, installedIndex, startApps, catalogSizes],
  );
}

/**
 * Zdroje ikon, které se nenačetly nebo jsou prázdné – sdílené ikonou
 * (PackageIcon) i barvou banneru (iconColor.ts), ať obě vycházejí ze stejné
 * ikony a nefunkční zdroje se nezkoušejí znovu.
 */
export const failedIconSources = new Set<string>();

/** Výsledek kontroly načtené ikony. */
export type IconVerdict = "ok" | "blank" | "light";

const verdicts = new Map<string, IconVerdict>();

/**
 * Zkontroluje načtenou ikonu (jen zdroje, které jde číst v canvasu):
 * „blank“ = skoro žádné viditelné pixely, „light“ = téměř celá bílá
 * (na bílé dlaždici by zmizela).
 */
export function inspectIcon(img: HTMLImageElement, src: string): IconVerdict {
  const known = verdicts.get(src);
  if (known) return known;
  let verdict: IconVerdict = "ok";
  try {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.drawImage(img, 0, 0, size, size);
      const data = context.getImageData(0, 0, size, size).data;
      let visible = 0;
      let white = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue;
        visible++;
        if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) white++;
      }
      if (visible < size * size * 0.03) verdict = "blank";
      else if (white / visible > 0.85) verdict = "light";
    }
  } catch {
    // Obrázek z jiného serveru bez CORS – nejde zkontrolovat, bereme jako v pořádku
  }
  verdicts.set(src, verdict);
  return verdict;
}
