/**
 * Nastavení → Vzhled: kolika aplikacím uživatel nastavil vlastní barvu nebo ikonu
 * (components/package/AppLookEditor.tsx) a obnovení původního vzhledu všech najednou.
 */
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useAppLooks } from "@/store/appLooks";
import { Row } from "./SettingsUi";

export function AppLooksRow() {
  const { t } = useTranslation();
  const count = useAppLooks((s) => Object.keys(s.looks).length);
  const resetAll = useAppLooks((s) => s.resetAll);

  return (
    <Row label={t("appLook.settingsLabel")} hint={t("appLook.settingsHint")}>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted tabular-nums">{count ? t("appLook.settingsCount", { count }) : t("appLook.settingsNone")}</span>
        {count > 0 && (
          <Button size="sm" variant="secondary" onClick={resetAll}>
            {t("appLook.settingsReset")}
          </Button>
        )}
      </div>
    </Row>
  );
}
