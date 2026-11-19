/**
 * Týdenní souhrn (Nastavení → Předvolby oznámení): jednou za 7 dní oznámení do
 * zvonečku – kolik aktualizací a instalací HubGet za týden provedl, kolik
 * aktualizací čeká (i na potvrzení oprávnění správce) a kolik aplikací jste dlouho
 * nespustili. První souhrn přijde týden po zapnutí; ne hned po spuštění HubGetu.
 */
import { useEffect, useState } from "react";
import { useUnusedApps } from "@/hooks/useAppUsage";
import { useAdminPendingUpdates, useInstalledItems, useUpdates } from "@/hooks/useInstalledItems";
import i18n from "@/i18n";
import { notifyEvent } from "@/services/notify";
import { useHistory } from "@/store/history";
import { useNotificationPrefs } from "@/store/notificationPrefs";

const WEEK_MS = 7 * 24 * 60 * 60_000;
/** Souhrn až chvíli po spuštění – ne do načítání aplikace. */
const STARTUP_DELAY_MS = 10 * 60_000;

export function WeeklySummary() {
  const { weeklySummary, lastWeeklySummary, set } = useNotificationPrefs();
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 60_000);
    const first = window.setTimeout(() => setNow(Date.now()), STARTUP_DELAY_MS + 1000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, []);

  // Zapnuto poprvé: odpočet týdne od teď
  useEffect(() => {
    if (weeklySummary && !lastWeeklySummary) set({ lastWeeklySummary: new Date().toISOString() });
  }, [weeklySummary, lastWeeklySummary, set]);

  const due = weeklySummary && !!lastWeeklySummary && now - Date.parse(lastWeeklySummary) >= WEEK_MS && now - startedAt >= STARTUP_DELAY_MS;
  const { items, isLoading } = useInstalledItems();
  const { updatable } = useUpdates();
  const admin = useAdminPendingUpdates();
  const usage = useUnusedApps(items, due);

  useEffect(() => {
    if (!due || isLoading || usage.isLoading) return;
    const since = now - WEEK_MS;
    const recent = useHistory.getState().items.filter((h) => h.outcome === "success" && Date.parse(h.finishedAt) >= since);
    const counts = {
      updated: recent.filter((h) => h.kind === "update").length,
      installed: recent.filter((h) => h.kind === "install").length,
      waiting: updatable.length,
      admin: admin.length,
      unused: usage.unused.length,
    };
    const parts = (Object.keys(counts) as (keyof typeof counts)[])
      .filter((key) => counts[key] > 0)
      .map((key) => i18n.t(`weekly.${key}`, { count: counts[key] }));
    set({ lastWeeklySummary: new Date(now).toISOString() });
    if (!parts.length) return;
    const message = i18n.t("weekly.message", { parts: parts.join(", ") });
    notifyEvent({ type: "info", tone: "info", title: null, message, toast: message, record: true });
  }, [due, isLoading, usage.isLoading, usage.unused.length, updatable.length, admin.length, now, set]);

  return null;
}
