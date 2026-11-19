/**
 * Internacionalizace (react-i18next).
 * Nový jazyk přidáte tak, že vytvoříte locales/<kód>.json se stejnými klíči
 * a zaregistrujete ho v poli LANGUAGES a v `resources` níže.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import cs from "./locales/cs.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";
import zh from "./locales/zh.json";

export const LANGUAGES = [
  { code: "cs", label: "Čeština" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "zh", label: "简体中文" },
] as const;

/**
 * Jazyk pro nového uživatele podle jazyka Windows (navigator.language: „de-DE“ → „de“,
 * „zh-Hans-CN“ → „zh“); jazyk, který HubGet nemá, → angličtina.
 */
export function detectLanguage(): string {
  const system = (typeof navigator !== "undefined" ? navigator.language : "").toLowerCase();
  return LANGUAGES.find((l) => system === l.code || system.startsWith(`${l.code}-`))?.code ?? "en";
}

/** Jazyk uložený v nastavení (čteno přímo, aby nevznikla cyklická závislost). */
function storedLanguage(): string {
  try {
    const raw = localStorage.getItem("unibox-settings");
    return (raw && JSON.parse(raw)?.state?.language) || detectLanguage();
  } catch {
    return detectLanguage();
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    cs: { translation: cs },
    en: { translation: en },
    de: { translation: de },
    es: { translation: es },
    fr: { translation: fr },
    pt: { translation: pt },
    zh: { translation: zh },
  },
  lng: storedLanguage(),
  // Chybějící text se ukáže anglicky (srozumitelnější pro většinu jazyků než čeština)
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React escapuje sám
});

// Jazyk dokumentu (čtečky obrazovky, dělení slov) a titulek okna drží krok s jazykem aplikace
const syncDocument = () => {
  // Bez okna (testy logiky – pnpm test) není co nastavovat
  if (typeof document === "undefined") return;
  document.documentElement.lang = i18n.language;
  document.title = i18n.t("app.title");
};
syncDocument();
i18n.on("languageChanged", syncDocument);

export default i18n;
