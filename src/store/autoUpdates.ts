/**
 * Automatická kontrola a instalace aktualizací balíčků na pozadí
 * (Nastavení → Aktualizace balíčků, po vzoru UniGetUI). Samotné plánování
 * a spouštění je v hooks/useAutoUpdates.ts – běží, dokud je HubGet spuštěný
 * (i schovaný u hodin). Pravidla, které aktualizace se nabízejí (minimální
 * stáří, neprojevené aktualizace), uplatňuje store/updateRules.ts.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SourceId } from "@/types";

export type UpdateInterval = "30min" | "hourly" | "2h" | "4h" | "8h" | "12h" | "daily" | "weekly";

const HOUR = 60 * 60_000;
/** Kolik minut bez klávesnice a myši znamená „na počítači se nepracuje“. */
export const IDLE_MINUTES = 10;

export const INTERVAL_MS: Record<UpdateInterval, number> = {
  "30min": HOUR / 2,
  hourly: HOUR,
  "2h": 2 * HOUR,
  "4h": 4 * HOUR,
  "8h": 8 * HOUR,
  "12h": 12 * HOUR,
  daily: 24 * HOUR,
  weekly: 7 * 24 * HOUR,
};
export const INTERVALS = Object.keys(INTERVAL_MS) as UpdateInterval[];

/** Kdy kontrolovat: v pevném intervalu, každý den v daný čas, nebo ve vybrané dny v daný čas. */
export type CheckRepeat = "interval" | "daily" | "days";
/** Kdy instalovat: po každé kontrole, každý den v daný čas, nebo ve vybrané dny v daný čas. */
export type InstallRepeat = "afterCheck" | "daily" | "days";
/** Zmeškaný termín (počítač spal, HubGet neběžel): dohnat se zpožděním, hned po spuštění, nebo počkat na další. */
export type MissedPolicy = "delay" | "startup" | "skip";
/** Co instalovat automaticky: nic, všechny aktualizace, nebo jen vybrané aplikace. */
export type AutoInstallMode = "off" | "all" | "selected";

/** Nabízené minimální stáří aktualizací (dny); vlastní hodnota jde zadat zvlášť. */
export const MIN_AGE_DAYS = [0, 1, 3, 7, 14, 30] as const;
/** Pondělí až neděle (Date.getDay: 0 = neděle). */
export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export interface AutoUpdatesSettings {
  /** Kontrolovat aktualizace automaticky. */
  autoCheck: boolean;
  checkRepeat: CheckRepeat;
  interval: UpdateInterval;
  /** Čas kontroly „HH:MM“ (denně / ve vybrané dny). */
  checkTime: string;
  checkDays: number[];
  autoInstall: AutoInstallMode;
  installRepeat: InstallRepeat;
  installTime: string;
  installDays: number[];
  /** Nainstalované balíčky („winget:OBSProject.OBSStudio“), které se aktualizují automaticky v režimu „selected“. */
  selected: string[];
  /** Neinstalovat na měřeném připojení (mobilní data, hotspot). */
  skipOnMetered: boolean;
  /** Neinstalovat při napájení z baterie. */
  skipOnBattery: boolean;
  /** Neinstalovat, když je zapnutá úspora baterie. */
  skipOnSaver: boolean;
  /** Neinstalovat během hry, videa přes celou obrazovku nebo prezentace. */
  skipWhileBusy: boolean;
  /** Instalovat jen, když uživatel aspoň IDLE_MINUTES nepracuje (klávesnice, myš). */
  onlyWhenIdle: boolean;
  /** Před ruční hromadnou aktualizací (Aktualizovat vše) vytvořit bod obnovení systému. */
  restorePoint: boolean;
  missed: MissedPolicy;
  /** Minimální stáří aktualizací ve dnech (0 = nabídnout hned). */
  minAgeDays: number;
  /** Jiné minimální stáří pro jednotlivé správce (chybí = podle minAgeDays). */
  minAgeBySource: Partial<Record<SourceId, number>>;
  /** Bezpečnostní aktualizace (lib/securityUpdates.ts) nabídnout hned, bez minimálního stáří. */
  securityNoWait: boolean;
  /** Hledat známé zranitelnosti balíčků režimu Vývojář na OSV.dev (posílá název a verzi balíčku). */
  osvCheck: boolean;
  /** Spolehlivost verzí od komunity: anonymně hlásit výsledky aktualizací a ukazovat souhrn (store/reliability.ts). */
  communityReliability: boolean;
  /** Po kolika „úspěšných“ aktualizacích bez změny verze ji přestat nabízet (0 = nikdy). */
  stuckLimit: number;
  /**
   * Aplikacím, které se aktualizují samy (data/selfUpdating.ts), dát čas: jejich aktualizaci
   * nabídnout až po lhůtě, pokud se mezitím neaktualizují samy (store/updateRules.ts).
   */
  selfUpdatingWait: boolean;
  /** Anonymně přispívat do žebříčku instalací v HubGetu (store/installStats.ts). */
  communityInstalls: boolean;
  /** Aplikace nainstalované na jiném počítači na účtu nainstalovat i tady (store/deviceInstalls.ts). */
  installFromDevices: boolean;
  /** Omezení rychlosti stahování instalátorů v kB/s (0 = bez omezení) – download.rs, `--limit-rate`. */
  downloadLimit: number;
  /** Automatické aktualizace pozastavené do (ms) – před prezentací, streamem…; null = běží. */
  pausedUntil: number | null;
  /** Novou hlavní verzi (OBS 32 → 33, lib/majorUpdate) automaticky neinstalovat – na kliknutí. */
  majorManual: boolean;
  /** Před „Aktualizovat vše“ ukázat přehled (velikost, novinky, výběr) – UpdatesOverviewDialog. */
  overviewBeforeUpdateAll: boolean;
  /** Čekající aktualizace stáhnout předem na pozadí (ne na měřeném připojení) – jobs.ts → prefetch. */
  prefetchUpdates: boolean;
  /** Instalátor stažený HubGetem před spuštěním prověřit Microsoft Defenderem (defender.rs). */
  installerScan: boolean;
  /** Varovat, když se mezi nainstalovanou a novou verzí změní server instalátoru (winget); automaticky takovou aktualizaci neinstalovat. */
  warnHostChange: boolean;
  /** Na stránce aktualizací předem zaškrtnout všechny aktualizace. */
  preselectUpdates: boolean;
}

interface AutoUpdatesState extends AutoUpdatesSettings {
  /** Kdy proběhla poslední kontrola (ISO), null = ještě nikdy. */
  lastCheck: string | null;
  /** Kdy proběhla poslední naplánovaná instalace (ISO). */
  lastInstall: string | null;
  /** Kdy se naposledy změnil plán kontroly / instalace v čase – dřívější termíny se nedohánějí. */
  checkPlannedAt: string | null;
  installPlannedAt: string | null;
  /** Naposledy oznámené aktualizace (podpis) – stejné se neoznamují znovu. */
  lastNotified: string | null;
  /** Právě probíhá kontrola (neukládá se). */
  checking: boolean;
  set: (changes: Partial<Omit<AutoUpdatesState, "set" | "toggleSelected">>) => void;
  /** Zapne / vypne automatickou aktualizaci balíčku (klíč pinKey – „zdroj:id“). */
  toggleSelected: (key: string) => void;
}

export const useAutoUpdates = create<AutoUpdatesState>()(
  persist(
    (set, get) => ({
      autoCheck: true,
      checkRepeat: "interval",
      interval: "daily",
      checkTime: "10:00",
      checkDays: [1, 2, 3, 4, 5],
      lastCheck: null,
      lastInstall: null,
      checkPlannedAt: null,
      installPlannedAt: null,
      lastNotified: null,
      autoInstall: "off",
      installRepeat: "afterCheck",
      installTime: "12:00",
      installDays: [1, 2, 3, 4, 5],
      selected: [],
      skipOnMetered: true,
      skipOnBattery: true,
      skipOnSaver: true,
      skipWhileBusy: true,
      onlyWhenIdle: false,
      restorePoint: false,
      missed: "delay",
      minAgeDays: 0,
      minAgeBySource: {},
      securityNoWait: true,
      osvCheck: false,
      communityReliability: false,
      stuckLimit: 3,
      selfUpdatingWait: true,
      communityInstalls: false,
      installFromDevices: false,
      downloadLimit: 0,
      pausedUntil: null,
      majorManual: true,
      overviewBeforeUpdateAll: true,
      prefetchUpdates: true,
      installerScan: true,
      warnHostChange: true,
      preselectUpdates: false,
      checking: false,
      set: (changes) => {
        // Nový plán v čase platí od teď – termín, který už dnes minul, se nedohání
        const now = new Date().toISOString();
        const touched = (keys: (keyof AutoUpdatesState)[]) => keys.some((key) => key in changes);
        set({
          ...changes,
          ...(touched(["checkRepeat", "checkTime", "checkDays"]) ? { checkPlannedAt: now } : {}),
          ...(touched(["autoInstall", "installRepeat", "installTime", "installDays"]) ? { installPlannedAt: now } : {}),
        });
      },
      toggleSelected: (key) => {
        const selected = get().selected;
        set({ selected: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key] });
      },
    }),
    {
      name: "unibox-auto-updates",
      partialize: ({ checking: _checking, ...rest }) => rest,
    },
  ),
);

/** Minimální stáří aktualizací pro správce (ve dnech). */
export const minAgeFor = (settings: Pick<AutoUpdatesSettings, "minAgeDays" | "minAgeBySource">, source: SourceId) =>
  settings.minAgeBySource[source] ?? settings.minAgeDays;
