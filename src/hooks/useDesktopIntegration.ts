/**
 * Propojení s desktopem (jen v Tauri):
 *  - chování zavření okna (do oznamovací oblasti / ukončit),
 *  - texty nabídky ikony v oznamovací oblasti v jazyce aplikace – položka
 *    aktualizací i popisek ukazují jejich počet („HubGet – 4 aktualizace“),
 *  - stav na ikoně: barevná tečka (operace z useTrayStatus, oranžová = čekají
 *    aktualizace; v Nastavení jde vypnout) a popisek,
 *  - rychlé odkazy z nabídky ikony (Procházet balíčky, Dostupné aktualizace,
 *    Nainstalované) – backend pošle stránku, aplikace na ni přejde,
 *  - kontrola nové verze HubGetu chvíli po spuštění (jen sestavená aplikace,
 *    lze vypnout v Nastavení).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { isTauri } from "@/lib/tauri";
import { useAppUpdate } from "@/store/appUpdate";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import { useUpdates } from "./useInstalledItems";
import { useTrayStatus } from "./useTrayStatus";

export function useDesktopIntegration() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const closeToTray = useSettings((s) => s.closeToTray);
  const trayBadge = useSettings((s) => s.trayBadge);
  const updates = useUpdates().updatable.length;
  const tray = useTrayStatus();
  // Probíhající operace a jejich výsledek mají přednost před čekajícími aktualizacemi
  const badge = !trayBadge ? "idle" : tray.status === "idle" && updates > 0 ? "updates" : tray.status;

  useEffect(() => {
    if (isTauri()) invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => undefined);
  }, [closeToTray]);

  useEffect(() => {
    if (isTauri()) invoke("set_tray_status", { status: badge }).catch(() => undefined);
  }, [badge]);

  useEffect(() => {
    if (!isTauri()) return;
    // Popisek: probíhající operace a jejich výsledek mají přednost před počtem aktualizací
    const tooltip =
      tray.status === "busy"
        ? tray.running
          ? t("tray.tooltipBusy", { count: tray.running })
          : t("tray.tooltipChecking")
        : tray.status !== "idle"
          ? t(tray.status === "error" ? "tray.tooltipError" : "tray.tooltipDone")
          : updates
            ? t("tray.tooltipUpdates", { count: updates })
            : "HubGet";
    const labels = {
      browse: t("tray.browse"),
      updates: updates ? t("tray.updatesCount", { count: updates }) : t("tray.updates"),
      installed: t("tray.installed"),
      show: t("tray.show"),
      quit: t("tray.quit"),
      tooltip,
    };
    invoke("set_tray_labels", { labels }).catch(() => undefined);
  }, [t, i18n.language, updates, tray.status, tray.running, tray.checking]);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<string>("tray-navigate", (event) => navigate(event.payload));
    return () => void unlisten.then((stop) => stop());
  }, [navigate]);

  // Klávesová zkratka Win+Shift+H (shortcut.rs): zapnout / vypnout podle nastavení; po stisku
  // backend ukáže okno a pošle „focus-search“ – kurzor do vyhledávání (TopBar)
  const globalShortcut = useSettings((s) => s.globalShortcut);
  useEffect(() => {
    if (!isTauri()) return;
    invoke("set_global_shortcut", { enabled: globalShortcut }).catch((error) => {
      if (globalShortcut) useToasts.getState().push("info", t("settings.globalShortcutTaken", { error: String(error) }));
    });
  }, [globalShortcut, t]);
  // Příkaz hubget v terminálu: skript zapíše (i po přesunutí HubGetu) nebo smaže backend
  const cliCommand = useSettings((s) => s.cliCommand);
  const cliAtStartup = useRef(true);
  useEffect(() => {
    if (!isTauri()) return;
    const startup = cliAtStartup.current;
    cliAtStartup.current = false;
    invoke("set_cli_command", { enabled: cliCommand }).catch((error) => {
      if (!cliCommand) return;
      // Při startu jen do konzole – cizí hubget.cmd by jinak hlásil chybu při každém spuštění;
      // oznámení až po zapnutí v Nastavení
      if (startup) console.warn("[HubGet] Příkaz hubget:", error);
      else useToasts.getState().push("info", i18n.t("settings.cliCommandFailed", { error: String(error) }));
    });
  }, [cliCommand]);
  // Rychlé akce na ikoně v hlavním panelu (pravé tlačítko) v jazyce aplikace – jumplist.rs
  useEffect(() => {
    if (!isTauri()) return;
    const tasks = [
      { title: t("jumpList.updates"), command: "updates" },
      { title: t("jumpList.updateAll"), command: "update" },
      { title: t("nav.overview"), command: "overview" },
    ];
    invoke("set_jump_list", { tasks }).catch((error) => console.warn("[HubGet] Rychlé akce na ikoně:", error));
  }, [t, i18n.language]);
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen("focus-search", () => window.dispatchEvent(new Event("hubget:focus-search")));
    return () => void unlisten.then((stop) => stop());
  }, []);

  // Nová verze HubGetu: kontrola 8 s po spuštění (ať nezdržuje načtení katalogu)
  useEffect(() => {
    if (!isTauri() || !import.meta.env.PROD || !useAppUpdate.getState().autoCheck) return;
    const timer = setTimeout(() => void useAppUpdate.getState().check(false), 8000);
    return () => clearTimeout(timer);
  }, []);
}
