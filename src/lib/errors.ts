/**
 * Neočekávané chyby: zápis do konzole a oznámení (v rohu okna i v historii
 * oznámení – zvoneček), ať se uživatel dozví, že se něco nepovedlo, a chybu
 * může nahlásit. Stejná chyba se oznámí nejvýš jednou za minutu.
 *
 * Chyby při vykreslování zachytí ErrorBoundary; neošetřené chyby z asynchronního
 * kódu (zamítnutý Promise, výjimka v obsluze události) installGlobalErrorHandlers
 * – aplikaci neshodí, ale bez zachycení by o nich nikdo nevěděl.
 */
import i18n from "@/i18n";
import { useToasts } from "@/store/toasts";

/** Jak dlouho se stejná chyba znovu neoznamuje. */
const QUIET_MS = 60_000;
const reported = new Map<string, number>();

/**
 * Vývojový režim: chvíli po výměně kódu za běhu (HMR) bývají přechodné chyby
 * (rozpracovaný soubor, jiný počet hooků) – jen do konzole, bez oznámení.
 */
let lastHotUpdate = 0;
import.meta.hot?.on("vite:beforeUpdate", () => {
  lastHotUpdate = Date.now();
});

/** Chyby, které nejsou chybou aplikace: zrušený požadavek, hlášení ResizeObserveru, HMR ve vývoji. */
function ignorable(error: Error): boolean {
  return (
    error.name === "AbortError" ||
    error.name === "CancelledError" ||
    /ResizeObserver loop|Failed to fetch dynamically imported module|\[hmr\]/i.test(error.message)
  );
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(typeof value === "string" ? value : JSON.stringify(value) ?? String(value));

export function reportError(value: unknown, context = "") {
  const error = asError(value);
  if (ignorable(error)) return;
  console.error(`[HubGet] ${context}`, error);
  if (import.meta.env.DEV && Date.now() - lastHotUpdate < 5000) return;
  const key = `${error.name}: ${error.message}`;
  const now = Date.now();
  if ((reported.get(key) ?? 0) > now - QUIET_MS) return;
  reported.set(key, now);
  if (reported.size > 100) reported.clear();
  // Tón „error“ zapíše oznámení i do historie (store/toasts.ts)
  useToasts.getState().push("error", i18n.t("crash.toast", { message: error.message || error.name }));
}

/** Zachytávání neošetřených chyb – volá se jednou při startu (main.tsx). */
export function installGlobalErrorHandlers() {
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, "unhandledrejection"));
  // Chyby načtení obrázků a skriptů nebublají – sem chodí jen výjimky ze skriptů
  window.addEventListener("error", (event) => {
    if (event.error) reportError(event.error, "error");
  });
  // Zablokované pravidly CSP (src-tauri/tauri.conf.json): ve vývoji s oznámením – stejná CSP
  // platí i tam (vite.config.ts), takže se chyba ukáže dřív než po vydání; v aplikaci jen do konzole
  document.addEventListener("securitypolicyviolation", (event) => {
    const message = `CSP zablokovala ${event.effectiveDirective}: ${event.blockedURI || "inline"}`;
    if (import.meta.env.DEV) reportError(new Error(message), "csp");
    else console.error(`[HubGet] ${message}`);
  });
}
