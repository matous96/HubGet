/**
 * Moje počítače (Nastavení → Moje počítače): každý počítač přihlášený ke stejnému
 * účtu zapisuje do synchronizace (druh „devices“) svůj stručný přehled – název,
 * kdy byl naposledy vidět a nainstalované aplikace, které HubGet spravuje (bez
 * her ze Steamu a programů mimo správce). Ostatní počítače z něj ukážou, co kde
 * čeká na aktualizaci, a nabídnou nainstalovat sem aplikace z jiného počítače.
 *
 * Klíč záznamu je náhodné id tohoto počítače (vznikne při prvním spuštění) – každý
 * počítač mění jen svůj záznam, slučování v synchronizaci tak nemá konflikty.
 * Počítač, který se 180 dní neozval, se ze seznamu vyřadí.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceId } from "@/types";

/** Aplikace v přehledu počítače: [zdroj, id balíčku, název, verze, nabízená verze | null]. */
export type DeviceApp = [SourceId, string, string, string, string | null];

export interface DeviceRecord {
  name: string;
  /** Kdy HubGet na počítači naposledy běžel (ISO). */
  seen: string;
  /** „Windows 11 Pro 24H2“. */
  os?: string;
  /** Verze HubGetu. */
  version?: string;
  apps: DeviceApp[];
}

/** Po kolika dnech se počítač bez ozvání vyřadí. */
export const DEVICE_KEEP_DAYS = 180;
/** Jak často obnovit „naposledy vidět“, když se jinak nic nezměnilo (hodiny). */
export const DEVICE_REFRESH_HOURS = 6;

interface DevicesState {
  /** Id tohoto počítače. */
  deviceId: string;
  devices: Record<string, DeviceRecord>;
  /** Zapíše přehled tohoto počítače. */
  setSelf: (record: DeviceRecord) => void;
}

export const useDevices = create<DevicesState>()(
  persist(
    (set, get) => ({
      deviceId: crypto.randomUUID(),
      devices: {},
      setSelf: (record) => set({ devices: { ...get().devices, [get().deviceId]: record } }),
    }),
    { name: "unibox-devices" },
  ),
);

/** Záznamy počítačů, které se ozvaly v posledních DEVICE_KEEP_DAYS dnech. */
export function freshDevices(devices: Record<string, DeviceRecord>, now = Date.now()): Record<string, DeviceRecord> {
  const limit = now - DEVICE_KEEP_DAYS * 24 * 60 * 60_000;
  return Object.fromEntries(Object.entries(devices).filter(([, d]) => Date.parse(d.seen) >= limit));
}
