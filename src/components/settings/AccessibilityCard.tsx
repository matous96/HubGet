/**
 * Přístupnost (Nastavení → Vzhled): velikost textu (podle Windows nebo vlastní), omezení
 * animací a podtržené odkazy – uplatní je hooks/useAccessibility.ts. Kontrastní motivy
 * Windows HubGet sleduje sám (styles/index.css), ovládání klávesnicí a čtečky obrazovky
 * popisuje nápověda pod kartou.
 */
import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/ui/CollectionToolbar";
import { useWindowsTextScale } from "@/hooks/useAccessibility";
import { isTauri } from "@/lib/tauri";
import { TEXT_SCALES, useSettings, type TextScale } from "@/store/settings";
import { Card, Row, SwitchRow } from "./SettingsUi";

export function AccessibilityCard() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { textScale, setTextScale, motion, setMotion, underlineLinks, setUnderlineLinks } = useSettings();
  const windows = useWindowsTextScale(true);
  const percent = (value: number) => (value / 100).toLocaleString(language, { style: "percent" });

  return (
    <Card title={t("a11y.title")}>
      <Row
        label={t("a11y.textSize")}
        hint={textScale === "system" && isTauri() ? t("a11y.textSizeWindows", { size: percent(windows) }) : t("a11y.textSizeHint")}
      >
        <select
          value={String(textScale)}
          onChange={(e) => setTextScale((e.target.value === "system" ? "system" : Number(e.target.value)) as TextScale)}
          aria-label={t("a11y.textSize")}
          className="h-9 w-48 cursor-pointer rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent/50"
        >
          {isTauri() && <option value="system">{t("a11y.textSizeSystem")}</option>}
          {!isTauri() && <option value="system">{t("a11y.textSizeDefault")}</option>}
          {TEXT_SCALES.map((scale) => (
            <option key={scale} value={scale}>
              {percent(scale * 100)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("a11y.motion")} hint={t("a11y.motionHint")}>
        <Segmented
          value={motion}
          onChange={setMotion}
          options={[
            { value: "system", label: t("a11y.motionSystem") },
            { value: "reduce", label: t("a11y.motionReduce") },
          ]}
        />
      </Row>
      <SwitchRow label={t("a11y.underlineLinks")} hint={t("a11y.underlineLinksHint")} checked={underlineLinks} onChange={setUnderlineLinks} />
      <p className="px-1 pt-3 text-xs text-muted">{t("a11y.keyboardHint")}</p>
    </Card>
  );
}
