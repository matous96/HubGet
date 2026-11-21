/**
 * Adresy ikon přes protokol icon:// (Rust, icons.rs) – samostatný modul, ať je
 * může použít lib/icons.ts i store/iconQuality.ts bez kruhového importu.
 */
import { isTauri } from "./tauri";

/** Protokol icon:// ve WebView2 (Windows). */
export const ICON_HOST = "http://icon.localhost";

/**
 * Adresa ikony z internetu – v desktopové aplikaci přes mezipaměť na disku.
 * Adresa protokolu icon:// (ikona hry ze Steamu) zůstane, jak je.
 */
export const remoteIconSrc = (url: string) =>
  isTauri() && !url.startsWith(ICON_HOST) ? `${ICON_HOST}/remote?u=${encodeURIComponent(url)}` : url;

/** Ikona nainstalované aplikace z nabídky Start (jen desktop). */
export const appIconSrc = (appId: string) => `${ICON_HOST}/app?id=${encodeURIComponent(appId)}`;

/** Ikona nainstalované hry ze Steamu podle čísla hry (soubor .ico, který uložil Steam; jen desktop). */
export const steamIconSrc = (appId: string) => `${ICON_HOST}/steam?app=${encodeURIComponent(appId)}`;

/**
 * Ikona nainstalované hry z EA app, GOG, Ubisoft Connect či Battle.net podle id záznamu
 * v registru („ARP\Machine\X86\{…}“), u Epic Games („EPIC\<hra>“) z jejího spustitelného
 * souboru (jen desktop).
 */
export const gameIconSrc = (packageId: string) => `${ICON_HOST}/game?id=${encodeURIComponent(packageId)}`;

/** Ikona programu ze seznamu Po spuštění (jen desktop, jen programy z posledního výpisu). */
export const fileIconSrc = (path: string) => `${ICON_HOST}/file?p=${encodeURIComponent(path)}`;
