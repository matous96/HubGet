/**
 * Nastavení → Oznámení (po vzoru UniGetUI): hlavní vypínač vyskakovacích
 * oznámení, souhrn po dávce operací a typy oznámení. Předvolby uplatňuje
 * services/notify.ts – vyskakovací oznámení ve Windows i v okně a záznamy
 * v historii oznámení (zvoneček).
 */
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { SOURCES } from "@/services/managers";
import { notifyEvent } from "@/services/notify";
import { useNotificationPrefs } from "@/store/notificationPrefs";
import { activeSources, useSettings } from "@/store/settings";
import { Card, Row, SwitchRow } from "./SettingsUi";

export function NotificationsSection() {
  const { t } = useTranslation();
  const prefs = useNotificationPrefs();
  const enabled = useSettings((s) => s.enabledSources);
  const userMode = useSettings((s) => s.userMode);
  const sources = SOURCES.filter((s) => activeSources(enabled, userMode).includes(s.id));

  return (
    <>
      <Card title={t("notifPrefs.main")}>
        <SwitchRow
          label={t("notifPrefs.enabled")}
          hint={t("notifPrefs.enabledHint")}
          checked={prefs.enabled}
          onChange={(enabled) => prefs.set({ enabled })}
        />
        <SwitchRow
          label={t("notifPrefs.batchSummary")}
          hint={t("notifPrefs.batchSummaryHint")}
          checked={prefs.batchSummary}
          onChange={(batchSummary) => prefs.set({ batchSummary })}
          disabled={!prefs.enabled}
        />
        <SwitchRow
          label={t("notifPrefs.weeklySummary")}
          hint={t("notifPrefs.weeklySummaryHint")}
          checked={prefs.weeklySummary}
          onChange={(weeklySummary) => prefs.set({ weeklySummary })}
        />
      </Card>

      <Card title={t("notifPrefs.types")}>
        <SwitchRow
          label={t("notifPrefs.updatesAvailable")}
          hint={t("notifPrefs.updatesAvailableHint")}
          checked={prefs.updatesAvailable}
          onChange={(updatesAvailable) => prefs.set({ updatesAvailable })}
        />
        {/* Správci, jejichž aktualizace se v oznámení vynechají (po vzoru UniGetUI) */}
        <div className={cn("px-4 py-3.5", !prefs.updatesAvailable && "opacity-50")}>
          <p className="text-sm font-medium">{t("notifPrefs.ignoreSources")}</p>
          <p className="mt-0.5 text-xs text-muted">{t("notifPrefs.ignoreSourcesHint")}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sources.map((s) => {
              const ignored = prefs.updatesIgnoredSources.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={ignored}
                  disabled={!prefs.updatesAvailable}
                  onClick={() =>
                    prefs.set({
                      updatesIgnoredSources: ignored ? prefs.updatesIgnoredSources.filter((id) => id !== s.id) : [...prefs.updatesIgnoredSources, s.id],
                    })
                  }
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default",
                    ignored ? "border-danger/30 bg-danger/10 text-danger line-through" : "border-line text-fg hover:bg-surface-2",
                  )}
                >
                  <span className={cn("size-2 rounded-full", s.dot)} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <SwitchRow
          label={t("notifPrefs.progress")}
          hint={t("notifPrefs.progressHint")}
          checked={prefs.progress}
          onChange={(progress) => prefs.set({ progress })}
        />
        <SwitchRow
          label={t("notifPrefs.failure")}
          hint={t("notifPrefs.failureHint")}
          checked={prefs.failure}
          onChange={(failure) => prefs.set({ failure })}
        />
        <SwitchRow
          label={t("notifPrefs.success")}
          hint={t("notifPrefs.successHint")}
          checked={prefs.success}
          onChange={(success) => prefs.set({ success })}
        />
        <p className="px-4 py-3 text-xs text-muted">{t("notifPrefs.historyNote")}</p>
      </Card>

      {isTauri() && (
        <Card>
          <Row label={t("notifPrefs.test")} hint={t("notifPrefs.testHint")}>
            <Button
              variant="secondary"
              size="sm"
              disabled={!prefs.enabled}
              onClick={() => notifyEvent({ type: "test", tone: "info", title: "HubGet", message: t("notifPrefs.testMessage") })}
            >
              <BellRing className="size-3.5" />
              {t("notifPrefs.testButton")}
            </Button>
          </Row>
        </Card>
      )}
    </>
  );
}
