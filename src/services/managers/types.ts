import type {
  InstallOptions,
  InstalledPackage,
  ManagerStatus,
  OperationKind,
  OperationOutcome,
  OperationProgress,
  RepoSearchResult,
  SourceId,
} from "@/types";

/** Popis jedné operace nad balíčkem v konkrétním správci. */
export interface OperationRequest {
  kind: OperationKind;
  /** Id balíčku ve správci ("Mozilla.Firefox", "extras/firefox", "firefox"). */
  packageId: string;
  /** Konkrétní verze; vynecháno = nejnovější. */
  version?: string;
  /** Volby instalace / stažení. */
  options?: InstallOptions;
  /** Název aplikace – backendu pomůže dohledat její záznam v registru. */
  name?: string;
  /** Automatická operace na pozadí – backend neotevře dialog UAC (chyba „needsAdmin“). */
  background?: boolean;
}

/** Mezipaměť správce balíčků. */
export interface CacheInfo {
  /** Velikost v bajtech. */
  size: number;
}

/** Ovladač běžící operace – umožňuje čekat na výsledek a operaci zrušit. */
export interface OperationHandle {
  done: Promise<OperationResult>;
  cancel: () => void;
  /** Pozastaví stahování instalátoru (jen když ho stahuje HubGet sám); true = pozastaveno. */
  pause?: () => Promise<boolean>;
}

/** Výsledek dokončené operace. */
export interface OperationResult {
  outcome: OperationOutcome;
  error?: string;
  /**
   * Klíč chyby od backendu („linkBroken“, „hashMismatch“…) – podle něj fronta
   * úloh pozná, že instalátor je nedostupný a má zkusit jiný zdroj instalace.
   */
  errorKey?: string;
  /** Dokončení vyžaduje restart počítače. */
  restartRequired?: boolean;
  /** Kdo podepsal stažený instalátor („“ = bez podpisu) – jen winget s instalátorem staženým předem. */
  signer?: string;
  /** Stahování uživatel pozastavil (outcome „cancelled“) – rozstažený soubor zůstal, úloha čeká na Pokračovat. */
  paused?: boolean;
}

/**
 * Abstrakce jednoho správce balíčků. UI pracuje jen s tímto rozhraním;
 * ve webové verzi ho plní ukázkové implementace (mock.ts), v desktopové
 * aplikaci Rust backend (winget.ts) – komponenty rozdíl nepoznají.
 */
export interface PackageManager {
  readonly id: SourceId;
  /** Je správce nainstalovaný (u wingetu i PowerShell modul)? */
  getStatus(): Promise<ManagerStatus>;
  /** Nainstaluje správce, případně potřebný modul. */
  setup(): Promise<void>;
  /** Seznam nainstalovaných balíčků včetně dostupných aktualizací. */
  getInstalled(): Promise<InstalledPackage[]>;
  /** Vyhledávání přímo v repozitáři správce. */
  search(query: string, signal?: AbortSignal): Promise<RepoSearchResult[]>;
  /**
   * Dostupné verze balíčku, od nejnovější. winget: Find-WinGetPackage
   * (AvailableVersions), Chocolatey: `choco search --exact --all-versions`,
   * Scoop: historie manifestu v bucketu.
   */
  getVersions(packageId: string): Promise<string[]>;
  /**
   * Velikost mezipaměti správce (stažené instalátory, archivy balíčků, staré verze);
   * null = správce mezipaměť nemá nebo není nainstalovaný.
   */
  getCache(): Promise<CacheInfo | null>;
  /** Smaže mezipaměť – nainstalované aplikace zůstanou. */
  clearCache(): Promise<void>;
  /** Spustí instalaci / aktualizaci / odinstalaci / stažení instalátoru s průběžným hlášením. */
  startOperation(request: OperationRequest, onProgress: (progress: OperationProgress) => void): OperationHandle;
}
