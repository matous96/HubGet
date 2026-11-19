/**
 * „Čím otevřu tento soubor?“ – aplikace podle přípony souboru (fileExtensions v katalogu
 * z FileExtensions manifestů wingetu). Stránka /open-with, přetažení souboru na okno
 * HubGetu (components/layout/FileDropOpenWith.tsx) a hledání „.psd“.
 */
import type { CatalogEntry } from "@/types";

/**
 * Přípona ze vstupu: „.psd“, „PSD“, „fotka.Final.psd“, „C:\\složka\\video.mkv“ → „psd“ / „mkv“.
 * Null, když v textu přípona není (slovo bez tečky delší než přípona, mezery).
 */
export function extensionOf(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const name = text.split(/[\\/]/).pop() ?? text;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : name;
  // Bez tečky jen krátké slovo („psd“), ne celý dotaz („photoshop“) ani soubor bez přípony v cestě
  if (dot < 0 && (ext.length > 5 || name !== text)) return null;
  return /^[a-z0-9][a-z0-9_+-]{0,14}$/.test(ext) ? ext : null;
}

/** Dotaz hledání, který je příponou souboru („.psd“) – hledání pak nabídne „Čím otevřu“. */
export const extensionQuery = (query: string) => (/^\.[a-z0-9][a-z0-9_+-]{0,14}$/i.test(query.trim()) ? query.trim().slice(1).toLowerCase() : null);

/** Index přípona → aplikace (jednou pro každý katalog). */
const indexes = new WeakMap<CatalogEntry[], Map<string, CatalogEntry[]>>();

function indexOf(catalog: CatalogEntry[]) {
  let index = indexes.get(catalog);
  if (!index) {
    index = new Map();
    for (const entry of catalog) {
      for (const ext of entry.fileExtensions ?? []) {
        const list = index.get(ext);
        if (list) list.push(entry);
        else index.set(ext, [entry]);
      }
    }
    indexes.set(catalog, index);
  }
  return index;
}

/**
 * Aplikace, které soubor s příponou otevřou: nainstalované první, pak ty, které příponu
 * mají jako jednu z mála (specializovaný program před archivátorem se 40 příponami),
 * podle popularity.
 */
export function appsForExtension(catalog: CatalogEntry[], ext: string, installed: ReadonlySet<string>): CatalogEntry[] {
  const list = indexOf(catalog).get(ext.toLowerCase()) ?? [];
  const focus = (e: CatalogEntry) => (e.fileExtensions?.length ?? 1) <= 12;
  return [...list].sort(
    (a, b) =>
      Number(installed.has(b.id)) - Number(installed.has(a.id)) ||
      Number(focus(b)) - Number(focus(a)) ||
      b.popularity - a.popularity,
  );
}

/** Počet aplikací pro příponu (hledání ukáže odkaz jen, když nějaké jsou). */
export const countForExtension = (catalog: CatalogEntry[], ext: string) => indexOf(catalog).get(ext.toLowerCase())?.length ?? 0;
