/**
 * Předvolby oznámení (Nastavení → Oznámení, po vzoru UniGetUI). Řídí:
 *  - vyskakovací oznámení – ve Windows (centrum oznámení systému, i když je
 *    HubGet schovaný u hodin) a v okně aplikace (roh vpravo dole),
 *  - co se zapisuje do historie oznámení (zvoneček v horní liště).
 * Hlavní vypínač vypne všechna vyskakovací oznámení; historie ve zvonečku
 * se dál plní podle typů níže, ať o chybě nepřijdete.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceId } from "@/types";

export interface NotificationPrefs {
  /** Hlavní vypínač vyskakovacích oznámení HubGetu. */
  enabled: boolean;
  /** Po dokončení dávky operací jedno souhrnné oznámení (místo jednoho za každou aplikaci). */
  batchSummary: boolean;
  /** Oznámit nalezené aktualizace (kontrola na pozadí). */
  updatesAvailable: boolean;
  /** Správci, jejichž aktualizace se v oznámení o nalezených aktualizacích vynechají. */
  updatesIgnoredSources: SourceId[];
  /** Tichá oznámení o běžící operaci (bez zvuku). */
  progress: boolean;
  /** Oznámit selhání operace. */
  failure: boolean;
  /** Oznámit úspěšné dokončení operace. */
  success: boolean;
  /** Jednou týdně souhrn: nainstalované a čekající aktualizace, nepoužívané aplikace. */
  weeklySummary: boolean;
  /** Kdy přišel poslední týdenní souhrn (ISO); null = ještě nikdy (první za týden). */
  lastWeeklySummary: string | null;
}

interface NotificationPrefsState extends NotificationPrefs {
  set: (changes: Partial<NotificationPrefs>) => void;
}

export const useNotificationPrefs = create<NotificationPrefsState>()(
  persist(
    (set) => ({
      enabled: true,
      batchSummary: true,
      updatesAvailable: true,
      updatesIgnoredSources: [],
      progress: false,
      failure: true,
      success: true,
      weeklySummary: true,
      lastWeeklySummary: null,
      set: (changes) => set(changes),
    }),
    { name: "unibox-notification-prefs" },
  ),
);
