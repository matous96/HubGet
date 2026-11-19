/**
 * Tlačítka v oznámeních Windows (services/notify.ts → actions):
 *  - nalezené aktualizace: Aktualizovat vše, Zobrazit,
 *  - hotová instalace či aktualizace: Otevřít (spustí aplikaci),
 *  - chyba: Podrobnosti (detail aplikace s chybou).
 * Klik na samotné oznámení ukáže HubGet na odpovídající stránce. Názvy tlačítek se
 * registrují v jazyce aplikace (a znovu po jeho změně). Windows klik ohlásí, jen dokud je
 * oznámení na obrazovce – z Centra oznámení otevře HubGet bez akce.
 */
import { invoke } from "@tauri-apps/api/core";
import { onAction, registerActionTypes, type ActionPerformed } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { launchApp, startAppFor, type StartApp } from "@/lib/launch";
import { isTauri } from "@/lib/tauri";
import type { NotificationActionType } from "@/services/notify";
import { usePackageIndex } from "@/store/packageIndex";
import { runAppCommand } from "./CliCommands";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function NotificationActions() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri()) return;
    const types: { id: NotificationActionType; actions: { id: string; title: string }[] }[] = [
      { id: "updates", actions: [{ id: "updateAll", title: t("notificationActions.updateAll") }, { id: "show", title: t("notificationActions.show") }] },
      { id: "installed", actions: [{ id: "open", title: t("notificationActions.open") }] },
      { id: "failed", actions: [{ id: "details", title: t("notificationActions.details") }] },
    ];
    void registerActionTypes(types).catch(() => undefined);
  }, [t, i18n.language]);

  useEffect(() => {
    if (!isTauri()) return;
    const handle = async ({ actionId, notification }: ActionPerformed) => {
      const extra = (notification?.extra ?? {}) as { type?: string; appId?: string };
      const type = (notification?.actionTypeId ?? extra.type ?? "") as NotificationActionType | "";
      const appId = extra.appId || undefined;
      // Spuštění aplikace okno HubGetu nepotřebuje
      if (actionId === "open" && appId && (await openApp(appId))) return;
      await invoke("show_window").catch(() => undefined);
      if (actionId === "updateAll") runAppCommand({ command: "update", args: [] });
      else if (type === "updates") navigate("/installed?filter=updates");
      else if (appId) navigate(detailUrl(appId));
    };
    const listener = onAction((event) => void handle(event));
    return () => void listener.then((l) => l.unregister()).catch(() => undefined);
  }, [navigate]);

  return null;
}

/** Spustí nainstalovanou aplikaci položkou nabídky Start; false = nenašla se (ukáže se detail). */
async function openApp(appId: string) {
  const installed = usePackageIndex.getState().installed.get(appId);
  if (!installed) return false;
  const apps = await invoke<StartApp[]>("start_apps").catch(() => []);
  const app = startAppFor(apps, installed.name, installed);
  if (!app) return false;
  return launchApp({ kind: "start", app }).then(
    () => true,
    () => false,
  );
}
