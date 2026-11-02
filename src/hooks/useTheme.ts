import { useEffect, useRef } from "react";
import { accentInk } from "@/lib/color";
import { useSettings } from "@/store/settings";

/**
 * Aplikuje motiv na <html>. Při volbě „Systém“ sleduje změny v systému.
 * Pokud systém světlý motiv výslovně nehlásí, zůstává tmavý (výchozí).
 *
 * Vlastní barva zvýraznění (Nastavení → Vzhled) přepíše proměnné --accent
 * a --accent-fg – přebarví se všechna tlačítka, odznaky a aktivní stavy
 * (Tailwind bg-accent, text-accent…) hned, bez restartu. V tmavém motivu
 * se barva mírně zesvětlí, stejně jako výchozí modrá.
 *
 * Změna za běhu se ukáže jedním plynulým prolnutím celého okna (View
 * Transitions). Bez něj by se každá část přebarvovala jinou rychlostí –
 * tělo stránky 200 ms, karty hned, tlačítka vlastním přechodem – a na chvíli
 * by bylo vidět světlé okno s tmavými kartami.
 */
export function useTheme() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accentColor);
  // Naposledy nastavený vzhled – při spuštění se nastaví hned, prolnutí jen při opravdové změně
  // (ne při druhém spuštění efektu ve StrictMode ani při HMR)
  const applied = useRef<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const root = document.documentElement;
    const isDark = () => theme === "dark" || (theme === "system" && !media.matches);
    const update = () => {
      const dark = isDark();
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
      if (accent) {
        root.style.setProperty("--accent", dark ? `color-mix(in srgb, ${accent} 82%, white)` : accent);
        root.style.setProperty("--accent-fg", accentInk(accent));
      } else {
        root.style.removeProperty("--accent");
        root.style.removeProperty("--accent-fg");
      }
    };
    const apply = () => {
      const look = `${isDark()}|${accent ?? ""}`;
      const animate =
        applied.current !== null &&
        applied.current !== look &&
        typeof document.startViewTransition === "function" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      applied.current = look;
      if (!animate) {
        update();
        return;
      }
      // Vlastní přechody barev vypnout – prolíná se snímek celého okna (styles/index.css)
      root.classList.add("theme-switching");
      document.startViewTransition(update).finished.finally(() => root.classList.remove("theme-switching"));
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, accent]);
}
