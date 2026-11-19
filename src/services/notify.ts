/**
 * Jedno místo pro všechna oznámení o operacích a aktualizacích – uplatňuje
 * předvolby z Nastavení → Oznámení (store/notificationPrefs.ts):
 *  - historie oznámení (zvoneček): podle typu události – i s vypnutým hlavním
 *    vypínačem, ať o chybě nepřijdete,
 *  - vyskakovací oznámení: hlavní vypínač + typ události. V okně HubGetu
 *    v rohu vpravo dole; když okno nemá fokus (je v pozadí nebo schované
 *    u hodin), i jako oznámení Windows – s tlačítky (Aktualizovat vše, Otevřít…,
 *    components/layout/NotificationActions.tsx).
 */
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { isTauri } from "@/lib/tauri";
import { useNotificationPrefs, type NotificationPrefs } from "@/store/notificationPrefs";
import { useNotifications, type AppNotification } from "@/store/notifications";
import { useToasts, type ToastTone } from "@/store/toasts";

/** Druh události – podle něj se rozhoduje o předvolbách. */
export type NotifyEventType = "success" | "failure" | "progress" | "updates" | "summary" | "info" | "test";

export interface NotifyEvent {
  type: NotifyEventType;
  tone: ToastTone;
  /** Název aplikace (nadpis), null = HubGet. */
  title: string | null;
  /** Text do historie a do oznámení Windows. */
  message: string;
  /** Text vyskakovacího oznámení v okně (výchozí = message); false = v okně nic. */
  toast?: string | false;
  /** Zapsat do historie oznámení (zvoneček) – s údaji o operaci. */
  record?: Pick<AppNotification, "kind" | "source" | "appId"> | true;
  /** Vyskakovací oznámení vynechat (např. jednotlivé výsledky během dávky – přijde souhrn). */
  popup?: boolean;
  /**
   * Tlačítka v oznámení Windows (NotificationActions.tsx): „updates“ – Aktualizovat vše
   * a Zobrazit, „installed“ – Otevřít aplikaci (appId), „failed“ – Podrobnosti (appId).
   */
  actions?: NotificationActionType;
  /** Aplikace, ke které tlačítka patří (id karty). */
  appId?: string;
}

export type NotificationActionType = "updates" | "installed" | "failed";

/** Předvolba, která daný druh události povoluje. */
const TYPE_PREF: Partial<Record<NotifyEventType, keyof NotificationPrefs>> = {
  success: "success",
  failure: "failure",
  progress: "progress",
  updates: "updatesAvailable",
  summary: "batchSummary",
};

export function notifyEvent(event: NotifyEvent) {
  const prefs = useNotificationPrefs.getState();
  const pref = TYPE_PREF[event.type];
  const allowed = pref ? prefs[pref] : true;
  if (!allowed) return;

  if (event.record) {
    const details = event.record === true ? {} : event.record;
    useNotifications.getState().add({ tone: event.tone, title: event.title, message: event.message, ...details });
  }

  if (!prefs.enabled || event.popup === false) return;
  if (event.toast !== false) useToasts.getState().push(event.tone, event.toast ?? event.message, { record: false });
  // Okno je v pozadí nebo schované u hodin → oznámení Windows (průběh tiše)
  if (isTauri() && (!document.hasFocus() || event.type === "test")) {
    void systemNotification(event.title ?? "HubGet", event.message, event.type === "progress", event.actions, event.appId);
  }
}

let permission: Promise<boolean> | null = null;

/** Oznámení Windows (plugin notification); oprávnění se zjistí jednou. */
async function systemNotification(title: string, body: string, silent: boolean, actions?: NotificationActionType, appId?: string) {
  permission ??= isPermissionGranted().then(async (granted) => granted || (await requestPermission()) === "granted");
  try {
    // Klik na oznámení i na tlačítko zpracuje NotificationActions (typ a aplikace v extra)
    if (await permission) sendNotification({ title, body, silent, actionTypeId: actions, extra: { type: actions ?? "", appId: appId ?? "" } });
  } catch {
    // Oznámení Windows jsou jen doplněk – historie a oznámení v okně fungují dál
  }
}
