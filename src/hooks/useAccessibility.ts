/**
 * Přístupnost (Nastavení → Vzhled → Přístupnost) uplatněná na <html>:
 *  - velikost textu: na desktopu zoom WebView2 (celé okno i zalomení rozvržení), v prohlížeči
 *    kořenová velikost písma (rem – Tailwind); „Podle Windows“ vezme Velikost textu z Nastavení
 *    Windows (system.rs text_scale_factor) – WebView2 ji sám neuplatní; změna ve Windows se
 *    projeví po návratu do okna HubGetu,
 *  - omezit animace: třída `reduce-motion` (styles/index.css) a MotionConfig v Layoutu; „Podle
 *    Windows“ řídí Efekty animace (prefers-reduced-motion),
 *  - podtržené odkazy: třída `underline-links`.
 * Vysoký kontrast Windows (motivy kontrastu) řeší CSS sám (@media (forced-colors: active)).
 */
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { isTauri } from "@/lib/tauri";
import { useSettings } from "@/store/settings";

/** Velikost textu z Windows v procentech (100 = výchozí). */
export function useWindowsTextScale(enabled: boolean): number {
  const { data } = useQuery({
    queryKey: ["text-scale-factor"],
    queryFn: () => invoke<number>("text_scale_factor"),
    enabled: enabled && isTauri(),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  return data ?? 100;
}

/** Násobek velikosti písma okna (1 = výchozí 16 px). */
export function useTextScale(): number {
  const scale = useSettings((s) => s.textScale);
  const windows = useWindowsTextScale(scale === "system");
  return scale === "system" ? windows / 100 : scale;
}

export function useAccessibility() {
  const scale = useTextScale();
  const motion = useSettings((s) => s.motion);
  const underline = useSettings((s) => s.underlineLinks);

  useEffect(() => {
    // Desktop: zvětšení celého okna jako zoom prohlížeče – zvětší se i šířka zalomení rozvržení
    // (breakpointy), takže se horní lišta a mřížky přeskládají místo přetečení. Písmo kořene by
    // breakpointy neposunulo (media queries v rem počítají s výchozími 16 px).
    if (isTauri()) {
      void getCurrentWebview()
        .setZoom(scale)
        .catch(() => undefined);
      return;
    }
    const root = document.documentElement;
    if (scale === 1) root.style.removeProperty("font-size");
    else root.style.fontSize = `${Math.round(scale * 100)}%`;
  }, [scale]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", motion === "reduce");
  }, [motion]);

  useEffect(() => {
    document.documentElement.classList.toggle("underline-links", underline);
  }, [underline]);
}
