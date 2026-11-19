import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { detectLanguage } from "@/i18n";
import { getSource, isSourceId, SOURCE_IDS } from "@/services/managers/sources";
import { sourceAllowed } from "./orgPolicy";
import type { ArchFilterValue } from "@/lib/arch";
import type { SortMode, SourceId, ThemeSetting, UserMode, ViewMode } from "@/types";

/** Uživatelská nastavení – ukládají se mezi spuštěními (localStorage). */
interface SettingsState {
  theme: ThemeSetting;
  language: string;
  /** Běžný uživatel / vývojář – co se nabízí na domovské stránce a v seznamech. */
  userMode: UserMode;
  viewMode: ViewMode;
  sortMode: SortMode;
  /** Filtr platformy v hledání, kategoriích a žebříčku (x64, ARM64, x86 nebo všechny). */
  archFilter: ArchFilterValue;
  /** Zapnutí správci balíčků (vypnutý se nepoužívá pro instalaci ani hledání). */
  enabledSources: SourceId[];
  /** Preferovaný zdroj, pokud je aplikace dostupná ve více zdrojích. */
  preferredSource: SourceId;
  /** Desktop: zavření okna ho schová do oznamovací oblasti (HubGet běží dál). */
  closeToTray: boolean;
  /** Desktop: barevná tečka na ikoně u hodin (aktualizace, probíhající operace, chyba, hotovo). */
  trayBadge: boolean;
  /** Desktop: klávesová zkratka Win+Shift+H otevře HubGet s kurzorem ve vyhledávání. */
  globalShortcut: boolean;
  /** Desktop: příkaz hubget v terminálu (skript ve složce WindowsApps – cli.rs). */
  cliCommand: boolean;
  /** Před aktualizací zálohovat nastavení aplikace (AppData) – obnoví se při vrácení aktualizace. */
  backupSettings: boolean;
  /** Barva zvýraznění (tlačítka, odznaky, aktivní stavy) jako HEX; null = výchozí modrá HubGetu. */
  accentColor: string | null;
  /** Před operací ukončit procesy aplikace běžící na pozadí (bez okna) bez dotazu. */
  closeBackgroundProcesses: boolean;
  /**
   * „Zavírat běžící aplikace bez dotazu“ (výchozí): před ruční operací aplikaci zavřít bez
   * dialogu – jako křížkem; když se ptá na uložení práce, počkat, až ji uživatel zavře
   * (store/jobs.ts closeRunningApp). Vypnuté = dialog AppRunningDialog. Název klíče z doby,
   * kdy se ukončovalo vždy natvrdo.
   */
  forceCloseRunning: boolean;
  /** Pokročilá odinstalace: po odinstalaci hledat zbytky i v Program Files, ProgramData, zástupcích a registru. */
  advancedUninstall: boolean;
  /** Zbytky z pokročilé odinstalace smazat rovnou, bez potvrzovacího okna (jen oznámení). */
  autoCleanup: boolean;
  /** Sledovat instalace: snímek disku a registru před a po instalaci – podklad pro čisté odinstalování. */
  trackInstalls: boolean;
  setTheme: (theme: ThemeSetting) => void;
  setLanguage: (language: string) => void;
  setUserMode: (mode: UserMode) => void;
  setViewMode: (mode: ViewMode) => void;
  setSortMode: (mode: SortMode) => void;
  setArchFilter: (arch: ArchFilterValue) => void;
  toggleSource: (source: SourceId, enabled: boolean) => void;
  setPreferredSource: (source: SourceId) => void;
  setCloseToTray: (enabled: boolean) => void;
  setTrayBadge: (enabled: boolean) => void;
  setGlobalShortcut: (enabled: boolean) => void;
  setCliCommand: (enabled: boolean) => void;
  setBackupSettings: (enabled: boolean) => void;
  setAccentColor: (color: string | null) => void;
  setCloseBackgroundProcesses: (enabled: boolean) => void;
  setForceCloseRunning: (enabled: boolean) => void;
  setAdvancedUninstall: (enabled: boolean) => void;
  setAutoCleanup: (enabled: boolean) => void;
  setTrackInstalls: (enabled: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Výchozí „Systém“; když systém předvolbu neposkytne, použije se tmavý (viz useTheme).
      theme: "system",
      // Nový uživatel: jazyk Windows, pokud ho HubGet má, jinak angličtina
      language: detectLanguage(),
      userMode: "regular",
      viewMode: "grid",
      sortMode: "popularity",
      archFilter: "all",
      enabledSources: [...SOURCE_IDS],
      preferredSource: "winget",
      closeToTray: true,
      trayBadge: true,
      globalShortcut: true,
      cliCommand: true,
      backupSettings: true,
      accentColor: null,
      closeBackgroundProcesses: true,
      forceCloseRunning: true,
      advancedUninstall: false,
      autoCleanup: false,
      trackInstalls: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => {
        set({ language });
        void i18n.changeLanguage(language);
      },
      setUserMode: (userMode) => set({ userMode }),
      setViewMode: (viewMode) => set({ viewMode }),
      setSortMode: (sortMode) => set({ sortMode }),
      setArchFilter: (archFilter) => set({ archFilter }),
      toggleSource: (source, enabled) => {
        const current = get().enabledSources;
        // Pořadí držíme podle SOURCE_IDS, alespoň jeden správce musí zůstat zapnutý.
        const next = SOURCE_IDS.filter((id) => (id === source ? enabled : current.includes(id)));
        if (next.length > 0) set({ enabledSources: next });
      },
      setPreferredSource: (preferredSource) => set({ preferredSource }),
      setCloseToTray: (closeToTray) => set({ closeToTray }),
      setTrayBadge: (trayBadge) => set({ trayBadge }),
      setGlobalShortcut: (globalShortcut) => set({ globalShortcut }),
      setCliCommand: (cliCommand) => set({ cliCommand }),
      setBackupSettings: (backupSettings) => set({ backupSettings }),
      setAccentColor: (accentColor) => set({ accentColor: accentColor && /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : null }),
      setCloseBackgroundProcesses: (closeBackgroundProcesses) => set({ closeBackgroundProcesses }),
      setForceCloseRunning: (forceCloseRunning) => set({ forceCloseRunning }),
      setAdvancedUninstall: (advancedUninstall) => set({ advancedUninstall }),
      setAutoCleanup: (autoCleanup) => set({ autoCleanup }),
      setTrackInstalls: (trackInstalls) => set({ trackInstalls }),
    }),
    {
      name: "unibox-settings",
      // Uložené zapnuté správce srovnat do aktuálního pořadí SOURCE_IDS.
      // Zdroj, který v uložených nastaveních ještě nebyl (nově přidaný správce),
      // je ve výchozím stavu zapnutý. Zdroje, které už HubGet nepodporuje
      // (dřívější Microsoft Store), se zahodí.
      // `forceCloseDefault`: nastavení uložené před verzí, kde je zavírání bez dotazu výchozí (do 0.2.1
      // bylo vypnuté a dialog „Aplikace právě běží“ byl krok navíc) – jednou se zapne každému
      partialize: (state) => ({ ...state, knownSources: [...SOURCE_IDS], forceCloseDefault: true }),
      merge: (persisted, current) => {
        const saved = persisted as (Partial<SettingsState> & { knownSources?: string[]; forceCloseDefault?: boolean }) | undefined;
        const known = saved?.knownSources ?? ["winget", "chocolatey", "scoop"];
        const enabledSources = SOURCE_IDS.filter(
          (id) => !saved?.enabledSources || saved.enabledSources.includes(id) || !known.includes(id),
        );
        const preferred = saved?.preferredSource;
        return {
          ...current,
          ...saved,
          enabledSources,
          preferredSource: preferred && isSourceId(preferred) ? preferred : current.preferredSource,
          forceCloseRunning: saved?.forceCloseDefault ? (saved.forceCloseRunning ?? current.forceCloseRunning) : true,
        };
      },
    },
  ),
);

/**
 * Pořadí zdrojů podle priority: nejdřív preferovaný, pak ostatní zapnuté
 * ve výchozím pořadí (winget → Chocolatey → Scoop → správci pro vývojáře).
 */
export function sourcePriority(enabled: SourceId[], preferred: SourceId): SourceId[] {
  return [...enabled].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
}

/**
 * Zapnuté zdroje, které se právě používají (hledání, instalace, nainstalované):
 * správci pro vývojáře (npm, pip, Cargo…) jen v režimu Vývojář – běžnému
 * uživateli by do výsledků přidali knihovny a zpomalili seznam nainstalovaných.
 */
export function activeSources(enabled: SourceId[], userMode: UserMode): SourceId[] {
  // Firemní zásady: jen povolení správci (store/orgPolicy.ts – useOrgPolicySync vrací i nastavení)
  const allowed = enabled.filter((id) => sourceAllowed(id));
  return userMode === "developer" ? allowed : allowed.filter((id) => getSource(id).group === "apps");
}
