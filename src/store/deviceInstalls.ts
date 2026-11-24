/**
 * Automaticky instalovat aplikace z ostatních počítačů (Nastavení → Moje počítače): co
 * uživatel nainstaluje na jiném počítači na účtu, HubGet nainstaluje i tady – na pozadí,
 * bez dotazů (components/settings/DeviceAutoInstaller).
 *
 * Instalují se jen aplikace, které na jiném počítači přibyly po zapnutí volby: při zapnutí
 * (a u počítače, který přibude později) se zapamatuje, co tam už je (`known`) – jinak by se
 * po zapnutí najednou nainstalovalo všechno z druhého počítače. Zapamatované se tu ukládá
 * jen pro tento počítač (nesynchronizuje se).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Klíč aplikace z přehledu počítače: „winget:Mozilla.Firefox“. */
export const deviceAppKey = (source: string, packageId: string) => `${source}:${packageId.toLowerCase()}`;

interface DeviceInstallsState {
  /** Id počítače → klíče aplikací, které tam už byly (nebo se už zpracovaly). */
  known: Record<string, string[]>;
  /** Zapamatuje aplikace počítače (bez instalace). */
  remember: (deviceId: string, keys: string[]) => void;
  /** Zapomene všechno – po zapnutí volby se výchozí stav vezme znovu. */
  reset: () => void;
  /** Počítače, jejichž nabídku „Vrátit aplikace po přeinstalování Windows“ uživatel zavřel. */
  dismissedRestore: string[];
  dismissRestore: (deviceId: string) => void;
}

export const useDeviceInstalls = create<DeviceInstallsState>()(
  persist(
    (set, get) => ({
      known: {},
      remember: (deviceId, keys) => {
        const current = get().known[deviceId] ?? [];
        const merged = [...new Set([...current, ...keys])];
        if (merged.length !== current.length) set({ known: { ...get().known, [deviceId]: merged } });
      },
      reset: () => set({ known: {} }),
      dismissedRestore: [],
      dismissRestore: (deviceId) => set({ dismissedRestore: [...get().dismissedRestore, deviceId] }),
    }),
    { name: "unibox-device-installs" },
  ),
);

/**
 * Nově přibylé aplikace na jiných počítačích: `devices` = id počítače → klíče aplikací.
 * Počítač, který tu ještě nemá zapamatovaný stav, nic nevrací (jen výchozí stav).
 */
export function newDeviceApps(devices: Record<string, string[]>, known: Record<string, string[]>): { deviceId: string; key: string }[] {
  const fresh: { deviceId: string; key: string }[] = [];
  for (const [deviceId, keys] of Object.entries(devices)) {
    const seen = known[deviceId];
    if (!seen) continue;
    const set = new Set(seen);
    for (const key of keys) if (!set.has(key)) fresh.push({ deviceId, key });
  }
  return fresh;
}
