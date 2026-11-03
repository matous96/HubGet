/**
 * Odkazy na komunitu projektu. Hodnoty lze přepsat v souboru .env.local
 * (VITE_GITHUB_URL, VITE_SUPPORT_URL…).
 */
// Nenastavená proměnná ve workflow Vydání je prázdný řetězec – i pak výchozí adresa
export const GITHUB_URL: string = import.meta.env.VITE_GITHUB_URL || "https://github.com/matous96/HubGet";
/**
 * Dobrovolný příspěvek na vývoj (Revolut) – karta Podpořit HubGet v Nastavení.
 * Prázdná hodnota (VITE_SUPPORT_URL=) kartu skryje.
 */
export const SUPPORT_URL: string = import.meta.env.VITE_SUPPORT_URL ?? "https://revolut.me/matous96";
/**
 * Přístupový klíč kontaktního formuláře (Web3Forms – zpráva přijde e-mailem autorovi).
 * Klíč je veřejný, služba ho určuje přímo do kódu stránky. Prázdný (VITE_CONTACT_FORM_KEY=)
 * formulář vypne a místo odeslání odkáže na fórum.
 */
export const CONTACT_FORM_KEY: string = import.meta.env.VITE_CONTACT_FORM_KEY ?? "b43a3256-556d-4f08-a4e2-45d6b81e0c66";
/** Kontaktní formulář v aplikaci (Nastavení → Kontaktovat HubGet) – ikona obálky v horní liště. */
export const CONTACT_PATH = "/settings?section=contact";

/**
 * Webová adresa pro sdílené odkazy (např. https://vas-web.cz). Volitelná:
 * bez ní se sdílí odkaz unibox://, který otevře aplikaci přímo v HubGetu,
 * a na sociální sítě se přiloží web aplikace.
 */
export const SHARE_WEB_URL: string | null = import.meta.env.VITE_SHARE_URL ?? null;

/**
 * Odkaz, který otevře detail aplikace přímo v HubGetu (obsluhuje tauri-plugin-deep-link).
 * Sdílí se zatím schéma unibox:// – rozumí mu i verze z doby, kdy se aplikace jmenovala
 * Unibox; HubGet obsluhuje unibox:// i hubget://.
 */
export const appDeepLink = (appId: string) => `unibox://app/${encodeURIComponent(appId)}`;

/** Webový odkaz na aplikaci, pokud je nastavený web projektu. */
export const appWebLink = (appId: string) =>
  SHARE_WEB_URL ? `${SHARE_WEB_URL.replace(/\/$/, "")}/app/${encodeURIComponent(appId)}` : null;

/**
 * Odkaz na sdílenou sadu balíčků (data sady jsou přímo v odkazu):
 *  - s webem projektu: …/bundle?d=… (web ho přesměruje do aplikace),
 *  - v desktopové aplikaci: unibox://bundle?d=… (otevře HubGet přes deep link),
 *  - ve webové verzi pro vývoj: adresa této stránky.
 */
export function bundleShareLink(data: string): string {
  if (SHARE_WEB_URL) return `${SHARE_WEB_URL.replace(/\/$/, "")}/bundle?d=${data}`;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return `unibox://bundle?d=${data}`;
  return `${window.location.origin}${window.location.pathname}#/bundles/shared?d=${data}`;
}

/** Formulář pro návrh nového zdroje balíčků (nové issue na GitHubu). */
export const NEW_SOURCE_URL = `${GITHUB_URL}/issues/new?title=${encodeURIComponent("Nový zdroj balíčků: ")}&labels=new-source`;
