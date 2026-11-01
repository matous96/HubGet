/**
 * Sdílené datové typy aplikace.
 *
 * HubGet spojuje více správců balíčků (winget, Chocolatey, Scoop, npm, pip…).
 * Rozlišujeme dva druhy dat:
 *  - CatalogEntry – „profil aplikace“ z catalog.json (kategorie, ikona, popularita…)
 *                   se seznamem zdrojů, ze kterých ji lze nainstalovat;
 *                   generuje ho skript v /data-pipeline,
 *  - InstalledPackage / RepoSearchResult – živá data přímo od správců balíčků.
 * UI je spojuje přes dvojici (zdroj, id balíčku ve zdroji).
 */

/**
 * Podporovaní správci balíčků: správci aplikací (winget, Chocolatey, Scoop)
 * a správci pro vývojáře (npm, Bun, pip, Cargo, vcpkg, .NET Tool,
 * PowerShell 7 = „pwsh“, Windows PowerShell 5.1 = „powershell“).
 */
export type SourceId =
  | "winget"
  | "chocolatey"
  | "scoop"
  | "npm"
  | "bun"
  | "pip"
  | "cargo"
  | "vcpkg"
  | "dotnet"
  | "pwsh"
  | "powershell";

/** Architektura procesoru (názvy jako ve Windows). */
export type Arch = "x64" | "x86" | "arm64";

/**
 * Identifikátor kategorie – klíč pro překlady a ikony. Kategorie od „ai“ dál
 * přibyly ve verzi 0.1.20 – katalog je nese v `categoriesV2` (starší verze je neznají).
 */
export type CategoryId =
  | "browsers"
  | "development"
  | "communication"
  | "games"
  | "multimedia"
  | "utilities"
  | "security"
  | "productivity"
  | "graphics"
  | "system"
  | "ai"
  | "audio"
  | "cloud"
  | "education"
  | "finance"
  | "network"
  | "personalization"
  /** Ostatní – jen v UI: aplikace bez kategorie (v katalogu se nevyskytuje, viz inCategory). */
  | "other";

/** Kategorie zpracovávaných údajů (stejné členění jako štítky soukromí v App Store). */
export type PrivacyCategory =
  | "purchases"
  | "financial"
  | "location"
  | "contactInfo"
  | "contacts"
  | "userContent"
  | "searchHistory"
  | "browsingHistory"
  | "identifiers"
  | "usage"
  | "diagnostics";

/**
 * Údaje o soukromí, které uvádí vývojář (HubGet je neověřuje).
 * Všechna pole prázdná = vývojář uvádí, že aplikace nesbírá žádné údaje.
 */
export interface PrivacyInfo {
  /** Údaje použité ke sledování napříč aplikacemi a weby jiných firem. */
  tracking: PrivacyCategory[];
  /** Údaje propojené s identitou uživatele. */
  linked: PrivacyCategory[];
  /** Údaje shromažďované bez propojení s identitou. */
  notLinked: PrivacyCategory[];
}

/** Jeden zdroj, ze kterého lze aplikaci nainstalovat. */
export interface PackageSource {
  source: SourceId;
  /** Id balíčku v daném správci: "Mozilla.Firefox", "extras/firefox", "firefox". */
  packageId: string;
  version: string;
  /**
   * Velikost instalačního balíčku v bajtech (nejnovější verze). Data pipeline
   * ji zjistí z hlavičky Content-Length odkazu na instalátor, resp. z .nupkg.
   */
  size?: number | null;
  /**
   * Architektury, pro které zdroj nabízí instalátor (winget: Installers[].Architecture,
   * Scoop: klíče v „architecture“, Chocolatey: 32/64bit).
   */
  architectures?: Arch[];
  /** Kontrolní součet SHA-256 instalátoru (winget: InstallerSha256, Scoop: hash, Chocolatey: checksum64). */
  sha256?: string | null;
  /** Typ instalátoru (winget: InstallerType) – určuje mj. parametry pro instalaci bez restartu. */
  installerType?: InstallerType;
  /** Rozsahy instalace, které instalátor podporuje (winget: Scope); první = výchozí. */
  scopes?: InstallScope[];
  /** Místo na disku po instalaci v bajtech (odhad z velikosti rozbalené aplikace). */
  installedSize?: number | null;
  /** Minimální verze Windows (winget: MinimumOSVersion, např. „10.0.17763.0“). */
  minOsVersion?: string | null;
  /**
   * Varianty balíčku wingetu, které katalog slučuje do této karty – jazykové
   * verze („Mozilla.Firefox.cs“, kód „cs“) a jiné typy instalátoru
   * („Google.Chrome.EXE“, kód „EXE“). Vybrat jde ve volbách instalace.
   */
  variants?: PackageVariant[];
}

/** Varianta balíčku: id ve správci a přípona za základním id („cs“, „en-GB“, „EXE“, „MSIX“). */
export interface PackageVariant {
  packageId: string;
  code: string;
}

/** Typ instalátoru (názvy podle winget manifestu). */
export type InstallerType = "msi" | "wix" | "inno" | "nsis" | "burn" | "exe" | "msix" | "portable" | "zip";

/** Závislost aplikace (winget: Dependencies – PackageDependencies / WindowsFeatures). */
export interface Dependency {
  name: string;
  /** Profil závislosti v katalogu (odkaz a stav „nainstalováno“). */
  appId?: string;
  minVersion?: string;
  kind: "package" | "runtime" | "feature";
  /** Platí jen pro tento zdroj (jinak pro všechny). */
  source?: SourceId;
  /** Doporučená, ale ne nutná. */
  optional?: boolean;
}

/** Volitelná část instalátoru, kterou lze zapnout / vypnout parametrem (winget: --custom). */
export type InstallerFeatureId = "addToPath" | "startMenu" | "desktopShortcut" | "contextMenu";

export interface InstallerFeature {
  id: InstallerFeatureId;
  /** Parametr instalátoru, když je volba zapnutá. */
  args?: string;
  /** Parametr instalátoru, když je volba vypnutá (u voleb, které instalátor dělá sám). */
  argsOff?: string;
  /** Zapnuto ve výchozím stavu. */
  default?: boolean;
}

/** Profil aplikace v katalogu (formát souboru catalog.json). */
export interface CatalogEntry {
  /**
   * Kanonické id aplikace v HubGetu (např. "mozilla-firefox").
   * U balíčků mimo katalog má tvar "<zdroj>:<id balíčku>".
   */
  id: string;
  name: string;
  publisher: string;
  /** Krátký popis. */
  description: string;
  /** Kategorie; v aplikaci už z `categoriesV2`, je-li v katalogu (services/catalog → prepare). */
  categories: CategoryId[];
  /**
   * Kategorie i s těmi z verze 0.1.20 – jen kde se liší od `categories`, které pro
   * starší verze HubGetu obsahují jen původních 10 (data-pipeline legacyCategories).
   */
  categoriesV2?: CategoryId[];
  tags: string[];
  /** URL ikony; null = zobrazí se generovaná zástupná ikona. */
  iconUrl: string | null;
  homepage: string | null;
  license: string | null;
  /** Nejnovější verze napříč zdroji. */
  latestVersion: string;
  /** Relativní skóre popularity 0–100 (počítá data pipeline). */
  popularity: number;
  /** Stažení z Chocolatey za posledních 7 dní (Skokani týdne); chybí = bez údajů. */
  weeklyDownloads?: number;
  /** O kolik procent za 7 dní vzrostl počet stažení z Chocolatey. */
  weeklyGrowth?: number;
  /** Datum prvního přidání do některého z repozitářů (ISO 8601). */
  addedAt: string;
  /** Zdroje, ze kterých lze aplikaci nainstalovat (alespoň jeden; žádný jen s `downloadUrl`). */
  sources: PackageSource[];
  /** Kurátorsky vybraný balíček pro sekci „Doporučené“. */
  featured?: boolean;
  /**
   * Ověřený vydavatel: potvrdil vlastnictví domény z manifestu (záznam DNS TXT)
   * nebo organizace na GitHubu. U aplikace se zobrazí modrá fajfka.
   */
  verified?: boolean;
  /**
   * URL screenshotů pro galerii v detailu – z komunitní databáze UniGetUI
   * a z popisů balíčků v Chocolatey (sestavuje data pipeline).
   */
  screenshots?: string[];
  /** Odkud screenshoty pocházejí (uvádí se u galerie). */
  screenshotSources?: ScreenshotSource[];
  /** Poznámky k nejnovější verzi (ReleaseNotes z manifestu wingetu). */
  releaseNotes?: string | null;
  releaseNotesUrl?: string | null;
  /** Datum vydání nejnovější verze (ISO 8601). */
  releaseDate?: string | null;
  /** Odkaz na podporu vydavatele. */
  supportUrl?: string | null;
  /** Zásady ochrany osobních údajů (PrivacyUrl z manifestu wingetu). */
  privacyUrl?: string | null;
  /** Štítky soukromí od vývojáře; chybí = vývojář je zatím neuvedl. */
  privacy?: PrivacyInfo | null;
  /** Barva značky pro banner (hex); chybí-li, odvodí se z id. */
  brandColor?: string | null;
  /** Vlastní obrázek banneru; jinak se banner generuje. */
  bannerUrl?: string | null;
  /** Závislosti (runtime, balíčky, funkce Windows). */
  dependencies?: Dependency[];
  /** Kurátorsky vybrané alternativy (id aplikací v katalogu). */
  alternatives?: string[];
  /** Zdrojový kód (winget: PackageUrl, pokud vede na GitHub / GitLab…). */
  repositoryUrl?: string | null;
  /**
   * Počet hvězdiček repozitáře na GitHubu v době sestavení katalogu (data
   * pipeline s GITHUB_TOKEN). Detail aplikace načte aktuální číslo živě.
   */
  githubStars?: number | null;
  /** Hlášení chyb vývojářům (issue tracker). */
  issuesUrl?: string | null;
  /** Oficiální dokumentace (winget: Documentations). */
  docsUrl?: string | null;
  /** Volitelné části instalátoru wingetu (PATH, zástupci…). */
  installerFeatures?: InstallerFeature[];
  /**
   * Oficiální stránka ke stažení u aplikace, kterou výrobce dává jen na svém webu
   * (DaVinci Resolve) – žádný správce ji nemá, `sources` je prázdné. HubGet ji
   * nenainstaluje, neaktualizuje ani neodinstaluje; nainstalovanou pozná a otevře.
   */
  downloadUrl?: string;
  /**
   * Regulární výrazy názvů v registru, pod kterými se program aplikace jen z webu výrobce
   * zapisuje, když se jmenuje jinak („VMware Workstation“ u VMware Workstation Pro).
   */
  installedNames?: string[];
}

/**
 * Souhrnná čísla za celé repozitáře (ne jen za aplikace v katalogu).
 * Spočítá je data pipeline při párování balíčků napříč správci.
 */
export interface CatalogStats {
  /** Počet unikátních aplikací napříč správci aplikací (aplikace z více zdrojů = 1). */
  total: number;
  /** Počet balíčků v jednotlivých repozitářích (všichni správci). */
  bySource: Partial<Record<SourceId, number>>;
  /** Kolik aplikací je dostupných pouze v daném správci aplikací (pro přepočet při vypnutí správce). */
  exclusive: Partial<Record<SourceId, number>>;
}

/** Kořen souboru catalog.json. */
export interface Catalog {
  schemaVersion: 2;
  generatedAt: string;
  /** Ukázkový katalog pro vývoj – části s vymyšlenými údaji se v UI viditelně označí. */
  sample?: boolean;
  stats?: CatalogStats;
  packages: CatalogEntry[];
  /**
   * Aplikace jen z webu výrobce (s `downloadUrl`, bez zdrojů) – mimo `packages`, protože
   * HubGet do verze 0.1.19 počítá s aspoň jedním zdrojem. Aplikace je přidá k ostatním
   * (services/catalog → prepare).
   */
  webOnly?: CatalogEntry[];
}

/**
 * Přesný původ instalace – zobrazuje se v sekci Nainstalované.
 *  - id správce: nainstalováno přes daného správce (u wingetu z repozitáře winget),
 *  - msstore: aplikace z Microsoft Storu, kterou winget vidí se zdrojem „msstore“,
 *  - steam: hra ze Steamu (winget ji vidí jako „ARP\Machine\X64\Steam App <id>“),
 *  - local: program nainstalovaný mimo správce balíčků (winget ho jen najde
 *    v seznamu Programy a funkce, umí ho odinstalovat, ale ne aktualizovat).
 */
export type InstallOrigin = SourceId | "msstore" | "steam" | "ea" | "local";

/** Zdroj screenshotů: komunitní databáze UniGetUI, nebo popis balíčku v Chocolatey. */
export type ScreenshotSource = "unigetui" | "chocolatey";

/** Balíček nainstalovaný v systému, jak ho vidí některý ze správců. */
export interface InstalledPackage {
  source: SourceId;
  packageId: string;
  name: string;
  installedVersion: string;
  /** Novější dostupná verze, pokud existuje (a uživatel ji nepřeskočil / nezamkl verzi). */
  availableVersion: string | null;
  origin: InstallOrigin;
  /** Nabízená verze, kterou skrývá zámek (store/updatePins.ts) nebo pravidlo aktualizací (store/updateRules.ts). */
  heldVersion?: string;
  /**
   * Proč se aktualizace nenabízí: přeskočená verze, ignorované aktualizace,
   * odložená aktualizace (zámky uživatele), nebo automaticky – verze je mladší
   * než minimální stáří aktualizací (age), aktualizace se opakovaně neprojevila (stuck),
   * aplikace se po aktualizaci sama vrátila na starší verzi – aktualizuje se sama (self).
   */
  pin?: "skip" | "lock" | "snooze" | "age" | "stuck" | "self";
  /** Do kdy je aktualizace odložená / kdy dosáhne minimálního stáří (ISO). */
  pinUntil?: string;
  /** Chocolatey: balíček spouští instalátor – program vidí i winget v registru (getAllInstalled). */
  installer?: boolean;
  /**
   * Program nalezený jen podle složky na disku (bez záznamu v registru, id
   * „DISK\<složka>“) – složka programu. Ukáže se, jen když se spáruje
   * s katalogem; odinstalovat ani aktualizovat ho HubGet neumí (kromě `portable`).
   */
  diskLocation?: string;
  /**
   * Program rozbalený na ploše (Tor Browser), který winget nevidí: vede se pod id
   * balíčku wingetu z katalogu (withPortablePackages), aktualizace nainstaluje
   * novou verzi a odinstalace přesune složku do Koše (backend winget_operation).
   */
  portable?: boolean;
  /**
   * Kdy byl program nainstalován (ms od 1. 1. 1970) podle Windows – záznam v registru,
   * u programu jen na disku vznik jeho složky. Čas nově objeveného balíčku (store/installSeen).
   */
  installedAt?: number;
}

/** Výsledek vyhledávání přímo v repozitáři správce. */
export interface RepoSearchResult {
  source: SourceId;
  packageId: string;
  name: string;
  version: string;
}

/** Druh operace nad balíčkem. */
export type OperationKind = "install" | "update" | "uninstall" | "download";

/** Operace, pro které existuje příkaz správce (stažení instalátoru má vlastní příkaz). */
export type CommandKind = Exclude<OperationKind, "download">;

/** Rozsah instalace: pro aktuálního uživatele, nebo pro všechny uživatele počítače. */
export type InstallScope = "user" | "machine";

/**
 * Volby instalace (po vzoru UniGetUI). Vynechaná volba = výchozí chování
 * správce. Které volby správce podporuje, říká SourceMeta.options.
 */
export interface InstallOptions {
  /** Spustit instalaci s právy správce (UAC). */
  asAdmin?: boolean;
  /** Zobrazit průvodce instalací místo tiché instalace. */
  interactive?: boolean;
  /** Nekontrolovat kontrolní součet instalátoru (riskantní – jen pro zastaralé manifesty). */
  skipHash?: boolean;
  architecture?: Arch;
  scope?: InstallScope;
  /** Cílová složka instalace. */
  location?: string;
  /**
   * Vlastní parametry instalátoru zadané uživatelem – jen s povolením
   * v Nastavení → Oprávnění správce (jinak je backend ignoruje).
   */
  customArgs?: string;
  /**
   * Parametry instalátoru, které skládá HubGet sám z voleb (části instalátoru,
   * bez restartu) – na povolení vlastních argumentů nezávisí.
   */
  installerArgs?: string;
  /** Příkaz spuštěný před instalací (cmd) – jen s povolením v Nastavení; když selže, instalace se nespustí. */
  preCommand?: string;
  /** Příkaz spuštěný po úspěšné instalaci (cmd) – jen s povolením v Nastavení. */
  postCommand?: string;
  /** Zapnuté volitelné části instalátoru (vynecháno = výchozí podle katalogu). */
  features?: InstallerFeatureId[];
  /** Potlačit restart po instalaci (vynecháno = ano, kde to instalátor umí). */
  noRestart?: boolean;
  /** Vlastní parametry instalátoru jen pro aktualizace (vynecháno = stejné jako při instalaci). */
  updateArgs?: string;
  /** Při aktualizaci odinstalovat předchozí verzi (winget --uninstall-previous). */
  uninstallPrevious?: boolean;
}

/** Fáze průběhu operace – zobrazuje se přímo na kartě. */
export type OperationPhase =
  | "queued"
  | "elevating" // čeká na potvrzení dialogu UAC
  | "downloading"
  | "interactive" // čeká se na uživatele v průvodci instalací
  | "installing"
  | "uninstalling";

export interface OperationProgress {
  phase: OperationPhase;
  /** 0–100, nebo null u neurčitého průběhu. */
  percent: number | null;
  /** Začátek fáze (Date.now()) – pro odhad procent u fází, které je nehlásí (lib/phaseEstimate). */
  since?: number;
}

/** Výsledný stav dokončené operace. */
export type OperationOutcome = "success" | "cancelled" | "error";

/** Úloha ve frontě (instalace/aktualizace/odinstalace). */
export interface Job {
  id: string;
  /** Kanonické id aplikace – podle něj si karta najde svůj průběh. */
  appId: string;
  appName: string;
  source: SourceId;
  packageId: string;
  kind: OperationKind;
  /** Konkrétní verze k instalaci (starší verze); jinak nejnovější. */
  version?: string;
  /** Volby instalace (jako správce, interaktivně…). */
  options?: InstallOptions;
  /** Automatická aktualizace na pozadí (bez dotazů na uživatele). */
  background?: boolean;
  /** Sledovat instalaci snímkem systému (i když je v Nastavení vypnuté). */
  track?: boolean;
  /** Automatická aktualizace: nabízená verze (počítadlo neúspěchů v updateHolds). */
  targetVersion?: string;
  progress: OperationProgress;
  error?: string;
}

/** Stav správce balíčků v systému. */
export interface ManagerStatus {
  /** Správce je nainstalovaný a použitelný. */
  available: boolean;
  version: string | null;
  /** Desktopová aplikace správce zatím neumí ovládat (podpora se připravuje). */
  planned?: boolean;
}

export type ThemeSetting = "system" | "dark" | "light";
/**
 * Režim zobrazení: běžný uživatel (jen desktopové aplikace, bez knihoven
 * z npm, pip, Cargo…) nebo vývojář (nástroje pro vývojáře hned nahoře).
 */
export type UserMode = "regular" | "developer";
export type ViewMode = "grid" | "list";
/** Řazení; „recent“ (nově nainstalované) nabízí jen stránka Nainstalované, jinde platí jako popularita. */
export type SortMode = "popularity" | "name" | "recent";
