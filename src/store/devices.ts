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
  /** Žádosti pro jiné počítače („aktualizuj vše“) – každý počítač píše jen do svého záznamu. */
  commands?: DeviceCommand[];
  /** Druhy žádostí, které tenhle počítač umí vyřídit (starší HubGet nic – tlačítko se mu nenabídne). */
  accepts?: DeviceCommandKind[];
}

/** Aplikace k instalaci na jiném počítači (detail aplikace → Nainstalovat na jiný počítač). */
export interface DeviceCommandApp {
  appId: string;
  name: string;
  source: SourceId;
  packageId: string;
}

/**
 * Žádost pro jiný počítač na účtu: „updateAll“ (Moje počítače → Aktualizovat tam) nebo
 * „install“ (detail aplikace → Nainstalovat na jiný počítač, s aplikací v `app`).
 */
export interface DeviceCommand {
  id: string;
  /** Id cílového počítače. */
  target: string;
  kind: DeviceCommandKind;
  /** Kdy vznikla (ISO) – po DEVICE_COMMAND_DAYS dnech se zahodí. */
  at: string;
  app?: DeviceCommandApp;
}

export type DeviceCommandKind = "updateAll" | "install";
/** Druhy žádostí, které tahle verze umí vyřídit (zapisuje se do vlastního záznamu – `accepts`). */
export const DEVICE_COMMAND_KINDS: DeviceCommandKind[] = ["updateAll", "install"];
/** Nejvíc odeslaných žádostí v záznamu (starší vypadnou). */
export const MAX_DEVICE_COMMANDS = 20;

/** Jak dlouho žádost pro jiný počítač platí (pak se nevyřízená zahodí). */
export const DEVICE_COMMAND_DAYS = 7;

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
  /** Odeslané žádosti pro jiné počítače (jdou do záznamu tohoto počítače – DeviceReporter). */
  commands: DeviceCommand[];
  /** Vyřízené žádosti od jiných počítačů (id) – každá se provede jednou. */
  handled: string[];
  /**
   * Nová žádost pro jiný počítač – hned i do záznamu tohoto počítače (synchronizace ji pošle).
   * Stejná žádost (Aktualizovat tam, instalace téže aplikace) pro stejný počítač nahradí předchozí.
   */
  request: (target: string, kind?: DeviceCommandKind, app?: DeviceCommandApp) => void;
  markHandled: (id: string) => void;
}

export const useDevices = create<DevicesState>()(
  persist(
    (set, get) => ({
      deviceId: crypto.randomUUID(),
      devices: {},
      setSelf: (record) => set({ devices: { ...get().devices, [get().deviceId]: { ...record, commands: freshCommands(get().commands), accepts: DEVICE_COMMAND_KINDS } } }),
      commands: [],
      handled: [],
      request: (target, kind = "updateAll", app) => {
        const same = (c: DeviceCommand) => c.target === target && c.kind === kind && c.app?.appId === app?.appId;
        const command: DeviceCommand = { id: crypto.randomUUID(), target, kind, at: new Date().toISOString(), ...(app && { app }) };
        const commands = [...freshCommands(get().commands).filter((c) => !same(c)), command].slice(-MAX_DEVICE_COMMANDS);
        const self = get().devices[get().deviceId];
        set({ commands, ...(self && { devices: { ...get().devices, [get().deviceId]: { ...self, commands } } }) });
      },
      markHandled: (id) => set({ handled: [...get().handled.slice(-200), id] }),
    }),
    { name: "unibox-devices" },
  ),
);

/** Žádosti mladší DEVICE_COMMAND_DAYS dnů. */
export function freshCommands(commands: DeviceCommand[] | undefined, now = Date.now()): DeviceCommand[] {
  const limit = now - DEVICE_COMMAND_DAYS * 24 * 60 * 60_000;
  return (commands ?? []).filter((c) => Date.parse(c.at) >= limit);
}

/** Nevyřízené žádosti pro tento počítač ze záznamů ostatních počítačů. */
export function commandsFor(deviceId: string, devices: Record<string, DeviceRecord>, handled: string[], now = Date.now()): { from: DeviceRecord; command: DeviceCommand }[] {
  const done = new Set(handled);
  return Object.entries(devices)
    .filter(([id]) => id !== deviceId)
    .flatMap(([, from]) => freshCommands(from.commands, now).filter((c) => c.target === deviceId && !done.has(c.id)).map((command) => ({ from, command })));
}

/** Kdy odsud odešla žádost pro počítač (ISO) – jen dokud se ten počítač od té doby neozval. */
export function waitingSince(commands: DeviceCommand[], target: string, device: DeviceRecord, match: (c: DeviceCommand) => boolean): string | null {
  const sent = commands.filter((c) => c.target === target && match(c)).at(-1);
  return sent && Date.parse(device.seen) < Date.parse(sent.at) ? sent.at : null;
}

/** Záznamy počítačů, které se ozvaly v posledních DEVICE_KEEP_DAYS dnech. */
export function freshDevices(devices: Record<string, DeviceRecord>, now = Date.now()): Record<string, DeviceRecord> {
  const limit = now - DEVICE_KEEP_DAYS * 24 * 60 * 60_000;
  return Object.fromEntries(Object.entries(devices).filter(([, d]) => Date.parse(d.seen) >= limit));
}
