/**
 * Aplikace jen z webu výrobce (DaVinci Resolve): žádný správce balíčků ji nemá,
 * katalog u ní nese odkaz na oficiální stránku ke stažení (`downloadUrl`).
 * HubGet ji nenainstaluje, neaktualizuje ani neodinstaluje – nainstalovanou
 * pozná podle názvu v registru a umí ji otevřít.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/lib/tauri";
import type { CatalogEntry } from "@/types";

export const isWebOnly = (entry: Pick<CatalogEntry, "downloadUrl">) => !!entry.downloadUrl;

/** Otevře oficiální stránku ke stažení v systémovém prohlížeči. */
export function openDownloadPage(entry: Pick<CatalogEntry, "downloadUrl">) {
  if (!entry.downloadUrl) return;
  if (isTauri()) void openUrl(entry.downloadUrl);
  else window.open(entry.downloadUrl, "_blank", "noopener,noreferrer");
}
