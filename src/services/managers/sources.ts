/**
 * Popis podporovaných správců balíčků a sestavení příkazů pro příkazový řádek.
 * Čisté funkce bez vedlejších efektů – používá je UI i backend.
 */
import { combinedInstallerArgs } from "@/lib/installArgs";
import type { Arch, CommandKind, GameStore, InstallOptions, InstallOrigin, SourceId } from "@/types";

/**
 * Které volby instalace správce podporuje (ostatní se v dialogu nenabízí).
 * Spuštění jako správce jde u všech – ovlivňuje jen způsob spuštění procesu.
 */
export interface OptionSupport {
  interactive: boolean;
  skipHash: boolean;
  architecture: boolean;
  scope: boolean;
  location: boolean;
  customArgs: boolean;
  /** Umí stáhnout instalátor / balíček bez instalace. */
  download: boolean;
  /** Umí při aktualizaci odinstalovat předchozí verzi. */
  uninstallPrevious: boolean;
}

const support = (enabled: Partial<OptionSupport>): OptionSupport => ({
  interactive: false,
  skipHash: false,
  architecture: false,
  scope: false,
  location: false,
  customArgs: false,
  download: false,
  uninstallPrevious: false,
  ...enabled,
});

/**
 * Skupina správce:
 *  - apps – správci aplikací pro Windows (winget, Chocolatey, Scoop),
 *  - dev  – správci pro vývojáře (knihovny a nástroje příkazové řádky).
 */
export type SourceGroup = "apps" | "dev";

export interface SourceMeta {
  id: SourceId;
  label: string;
  group: SourceGroup;
  /** Barva odznaku (Tailwind třída pro tečku). */
  dot: string;
  homepage: string;
  /** Vyžaduje instalace obvykle práva správce (UAC)? */
  needsAdmin: boolean;
  /** Umí správce nainstalovat konkrétní (starší) verzi? */
  supportsVersions: boolean;
  /**
   * Repozitář, ze kterého správce instaluje. Správci se stejným repozitářem
   * (npm a Bun, oba PowerShelly) se ve statistikách počítají jednou.
   */
  registry: string;
  /** Podporované volby instalace. */
  options: OptionSupport;
  /**
   * Běhové prostředí, které balíčky z tohoto správce potřebují (Node.js u npm,
   * Python u pip…) – v detailu aplikace se ukáže mezi závislostmi.
   */
  runtime?: { name: string; appId?: string };
}

/**
 * Pořadí = pořadí zobrazení všude v aplikaci i výchozí priorita při výběru
 * zdroje: nejdřív správci aplikací (winget → Chocolatey → Scoop), pak
 * správci pro vývojáře.
 */
export const SOURCES: SourceMeta[] = [
  {
    id: "winget", label: "WinGet", group: "apps", dot: "bg-sky-500", homepage: "https://learn.microsoft.com/windows/package-manager/",
    needsAdmin: false, supportsVersions: true, registry: "winget",
    options: support({
      interactive: true,
      skipHash: true,
      architecture: true,
      scope: true,
      location: true,
      customArgs: true,
      download: true,
      uninstallPrevious: true,
    }),
  },
  {
    id: "chocolatey", label: "Chocolatey", group: "apps", dot: "bg-amber-600", homepage: "https://chocolatey.org",
    needsAdmin: true, supportsVersions: true, registry: "chocolatey",
    // Stahování balíčků (choco download) je jen v placených edicích
    options: support({ interactive: true, skipHash: true, customArgs: true }),
  },
  {
    id: "scoop", label: "Scoop", group: "apps", dot: "bg-emerald-500", homepage: "https://scoop.sh",
    needsAdmin: false, supportsVersions: true, registry: "scoop",
    // Jen pro aktuálního uživatele – instalace pro všechny (--global) by potřebovala práva správce
    options: support({ skipHash: true, architecture: true, download: true }),
  },
  {
    id: "npm", label: "npm", group: "dev", dot: "bg-red-500", homepage: "https://www.npmjs.com",
    needsAdmin: false, supportsVersions: true, registry: "npm", options: support({ download: true }),
    runtime: { name: "Node.js", appId: "openjs-nodejs-lts" },
  },
  // Bun instaluje balíčky z registru npm
  {
    id: "bun", label: "Bun", group: "dev", dot: "bg-orange-200", homepage: "https://bun.sh",
    needsAdmin: false, supportsVersions: true, registry: "npm", options: support({}),
  },
  {
    id: "pip", label: "pip", group: "dev", dot: "bg-yellow-400", homepage: "https://pypi.org",
    needsAdmin: false, supportsVersions: true, registry: "pypi", options: support({ scope: true, location: true, download: true }),
    runtime: { name: "Python", appId: "python-python-3-13" },
  },
  {
    id: "cargo", label: "Cargo", group: "dev", dot: "bg-orange-700", homepage: "https://crates.io",
    needsAdmin: false, supportsVersions: true, registry: "crates", options: support({ location: true }),
    runtime: { name: "Rust (rustup) + Visual Studio Build Tools" },
  },
  // vcpkg v klasickém režimu instaluje vždy verzi z aktuálního stavu repozitáře portů; architektura = triplet
  {
    id: "vcpkg", label: "vcpkg", group: "dev", dot: "bg-indigo-400", homepage: "https://vcpkg.io",
    needsAdmin: false, supportsVersions: false, registry: "vcpkg", options: support({ architecture: true }),
    runtime: { name: "Visual Studio Build Tools (C++)" },
  },
  {
    id: "dotnet", label: ".NET Tool", group: "dev", dot: "bg-violet-500", homepage: "https://learn.microsoft.com/dotnet/core/tools/global-tools",
    needsAdmin: false, supportsVersions: true, registry: "nuget", options: support({ architecture: true, location: true }),
    runtime: { name: ".NET SDK" },
  },
  // PowerShell 7 (PSResourceGet) a Windows PowerShell 5.1 (PowerShellGet) – oba z PowerShell Gallery
  {
    id: "pwsh", label: "PowerShell 7.x", group: "dev", dot: "bg-blue-500", homepage: "https://www.powershellgallery.com",
    needsAdmin: false, supportsVersions: true, registry: "psgallery", options: support({ scope: true, download: true }),
    runtime: { name: "PowerShell 7" },
  },
  {
    id: "powershell", label: "PowerShell 5.x", group: "dev", dot: "bg-blue-800", homepage: "https://www.powershellgallery.com",
    needsAdmin: false, supportsVersions: true, registry: "psgallery", options: support({ scope: true, download: true }),
  },
];

export const SOURCE_IDS = SOURCES.map((s) => s.id);
export const getSource = (id: SourceId) => SOURCES.find((s) => s.id === id)!;
export const isSourceId = (value: string): value is SourceId => (SOURCE_IDS as string[]).includes(value);

/** Seřadí zdroje aplikace podle pořadí v SOURCES. */
export function sortBySourceOrder<T extends { source: SourceId }>(items: T[]): T[] {
  return [...items].sort((a, b) => SOURCE_IDS.indexOf(a.source) - SOURCE_IDS.indexOf(b.source));
}

// ── Původ instalace ──────────────────────────────────────────────────────

export interface OriginMeta {
  id: InstallOrigin;
  /** Popisek; u „local“ se bere z překladů (origins.local). */
  label: string;
  dot: string;
}

/**
 * Pořadí = pořadí ve filtru Nainstalovaných. Aplikace z Microsoft Storu
 * vidí WinGet se zdrojem „msstore“ – zobrazí se jako „WinGet (Microsoft Store)“.
 */
export const ORIGINS: OriginMeta[] = [
  { id: "winget", label: "WinGet", dot: "bg-sky-500" },
  { id: "msstore", label: "WinGet (Microsoft Store)", dot: "bg-sky-300" },
  ...SOURCES.filter((s) => s.id !== "winget").map((s) => ({ id: s.id, label: s.label, dot: s.dot })),
  { id: "steam", label: "Steam", dot: "bg-slate-400" },
  { id: "epic", label: "Epic Games", dot: "bg-neutral-700" },
  { id: "ea", label: "EA app", dot: "bg-orange-500" },
  { id: "gog", label: "GOG", dot: "bg-violet-500" },
  { id: "ubisoft", label: "Ubisoft Connect", dot: "bg-blue-600" },
  { id: "battlenet", label: "Battle.net", dot: "bg-cyan-500" },
  { id: "local", label: "", dot: "bg-zinc-500" },
];

export const getOrigin = (id: InstallOrigin) => ORIGINS.find((o) => o.id === id)!;

/** Herní obchody – hry v nich spravuje jejich spouštěč (aktualizace, ověření souborů). */
export const GAME_STORES: readonly GameStore[] = ["steam", "epic", "ea", "gog", "ubisoft", "battlenet"];
export const isGameStore = (value: string | null | undefined): value is GameStore => (GAME_STORES as readonly string[]).includes(value ?? "");

/** Id hry ve Steamu z identifikátoru „ARP\Machine\X64\Steam App 730“ (i bez předpony ARP), jinak null. */
export function steamAppId(packageId: string): string | null {
  return packageId.match(/(?:^|\\)Steam App (\d+)$/)?.[1] ?? null;
}

/**
 * Hry z ostatních obchodů – z id je většinou nepoznáme (záznam v registru má GUID), pozná je
 * backend (GameStore v arp.rs, Epic podle jeho manifestů) a výpis nainstalovaných je tu
 * zapamatuje (karty, oblíbené, historie).
 */
const games = new Map<string, GameStore>();
export const rememberGame = (packageId: string, store: GameStore) => void games.set(packageId.toLowerCase(), store);
/** Obchod, ze kterého je hra (Steam podle id, ostatní podle výpisu nainstalovaných), jinak null. */
export const gameStoreOf = (packageId: string): GameStore | null =>
  steamAppId(packageId) ? "steam" : (games.get(packageId.toLowerCase()) ?? (/^EPIC\\/i.test(packageId) ? "epic" : null));

/**
 * Určí původ balíčku nalezeného wingetem. Get-WinGetPackage vrací u každého
 * balíčku `Id` a `Source` („winget“, „msstore“, nebo prázdné u programů
 * nainstalovaných mimo winget). Hry ze Steamu mají Id „ARP\…\Steam App <číslo>“,
 * hry z ostatních obchodů označí backend (rememberGame).
 */
export function detectWingetOrigin(packageId: string, wingetSource: string | null): InstallOrigin {
  const game = gameStoreOf(packageId);
  if (game) return game;
  if (wingetSource === "msstore") return "msstore";
  if (wingetSource === "winget") return "winget";
  return "local";
}

/** Cesta v uvozovkách (kvůli mezerám, např. „C:\Program Files\…“). */
const quote = (path: string) => `"${path.replace(/"/g, "")}"`;

/** Názvy architektur ve Scoopu. */
const SCOOP_ARCH: Record<Arch, string> = { x64: "64bit", x86: "32bit", arm64: "arm64" };

/**
 * Příkaz pro ruční provedení operace v daném správci.
 * `version` a `options` se uplatní jen u instalace (konkrétní verze, volby
 * instalace); volby, které správce nepodporuje, se vynechají. Spuštění jako
 * správce se v příkazu neprojeví – terminál je potřeba spustit jako správce.
 */
export function sourceCommand(
  source: SourceId,
  kind: CommandKind,
  packageId: string,
  version?: string,
  options: InstallOptions = {},
): string {
  const install = kind === "install";
  const meta = getSource(source);
  const pinned = install && version && meta.supportsVersions ? version : undefined;
  // Jen podporované volby a jen u instalace
  const opt = (key: Exclude<keyof OptionSupport, "download" | "customArgs">) => (install && meta.options[key] ? options[key] : undefined);
  // Parametry instalátoru: vlastní (uživatel) a z voleb HubGetu (PATH, bez restartu…) dohromady
  const installerArgs = install && meta.options.customArgs ? combinedInstallerArgs(options) : undefined;
  const flags: string[] = [];

  switch (source) {
    case "winget": {
      const verb = { install: "install", update: "upgrade", uninstall: "uninstall" }[kind];
      if (pinned) flags.push(`--version ${pinned}`);
      if (opt("interactive")) flags.push("--interactive");
      if (opt("skipHash")) flags.push("--ignore-security-hash");
      if (opt("architecture")) flags.push(`--architecture ${options.architecture}`);
      if (opt("scope")) flags.push(`--scope ${options.scope}`);
      if (opt("location")) flags.push(`--location ${quote(options.location!)}`);
      if (installerArgs) flags.push(`--custom ${quote(installerArgs)}`);
      return [`winget ${verb} -e --id ${packageId}`, ...flags].join(" ");
    }
    case "chocolatey": {
      const verb = { install: "install", update: "upgrade", uninstall: "uninstall" }[kind];
      if (pinned) flags.push(`--version ${pinned}`);
      if (opt("interactive")) flags.push("--not-silent");
      if (opt("skipHash")) flags.push("--ignore-checksums");
      if (installerArgs) flags.push(`--install-arguments=${quote(installerArgs)}`);
      return [`choco ${verb} ${packageId}`, ...flags, "-y"].join(" ");
    }
    case "scoop": {
      // Instalace potřebuje bucket ("extras/firefox"), ostatní operace jen název aplikace.
      const app = packageId.split("/").pop()!;
      const verb = { install: "install", update: "update", uninstall: "uninstall" }[kind];
      if (opt("architecture")) flags.push(`--arch ${SCOOP_ARCH[options.architecture!]}`);
      if (opt("skipHash")) flags.push("--skip-hash");
      return [`scoop ${verb} ${install ? packageId : app}${pinned ? `@${pinned}` : ""}`, ...flags].join(" ");
    }
    case "npm": {
      const verb = { install: "install", update: "update", uninstall: "uninstall" }[kind];
      return `npm ${verb} -g ${packageId}${pinned ? `@${pinned}` : ""}`;
    }
    case "bun": {
      // Bun nemá samostatnou aktualizaci globálního balíčku – znovu přidá nejnovější verzi
      if (kind === "uninstall") return `bun remove -g ${packageId}`;
      return `bun add -g ${packageId}@${pinned ?? "latest"}`;
    }
    case "pip": {
      if (kind === "uninstall") return `python -m pip uninstall -y ${packageId}`;
      if (kind === "update") return `python -m pip install --upgrade ${packageId}`;
      if (opt("scope") === "user") flags.push("--user");
      if (opt("location")) flags.push(`--target ${quote(options.location!)}`);
      return [`python -m pip install ${packageId}${pinned ? `==${pinned}` : ""}`, ...flags].join(" ");
    }
    case "cargo": {
      // `cargo install` nainstaluje novější verzi i přes už nainstalovanou
      if (kind === "uninstall") return `cargo uninstall ${packageId}`;
      if (pinned) flags.push(`--version ${pinned}`);
      if (opt("location")) flags.push(`--root ${quote(options.location!)}`);
      return [`cargo install ${packageId}`, ...flags].join(" ");
    }
    case "vcpkg": {
      const verb = { install: "install", update: "upgrade", uninstall: "remove" }[kind];
      // Architektura se ve vcpkg zadává tripletem („fmt:x64-windows“)
      const triplet = opt("architecture") ? `:${options.architecture}-windows` : "";
      return `vcpkg ${verb} ${packageId}${triplet}${kind === "update" ? " --no-dry-run" : ""}`;
    }
    case "dotnet": {
      // Vlastní složka nástroje místo globální instalace
      const target = opt("location") ? `--tool-path ${quote(options.location!)}` : "--global";
      if (pinned) flags.push(`--version ${pinned}`);
      if (opt("architecture")) flags.push(`--arch ${options.architecture}`);
      return [`dotnet tool ${kind} ${target} ${packageId}`, ...flags].join(" ");
    }
    case "pwsh": {
      const verb = { install: "Install", update: "Update", uninstall: "Uninstall" }[kind];
      if (pinned) flags.push(`-Version ${pinned}`);
      if (opt("scope")) flags.push(`-Scope ${options.scope === "machine" ? "AllUsers" : "CurrentUser"}`);
      return [`${verb}-PSResource -Name ${packageId}`, ...flags].join(" ");
    }
    case "powershell": {
      const verb = { install: "Install", update: "Update", uninstall: "Uninstall" }[kind];
      if (pinned) flags.push(`-RequiredVersion ${pinned}`);
      if (install) flags.push(`-Scope ${opt("scope") === "machine" ? "AllUsers" : "CurrentUser"}`);
      return [`${verb}-Module -Name ${packageId}`, ...flags].join(" ");
    }
  }
}

/**
 * Příkaz pro stažení instalátoru (balíčku) bez instalace, nebo null, pokud
 * to správce neumí. Soubory se uloží do aktuální složky / Stažených souborů.
 */
export function downloadCommand(source: SourceId, packageId: string, version?: string, options: InstallOptions = {}): string | null {
  const pinned = version && getSource(source).supportsVersions ? version : undefined;
  switch (source) {
    case "winget": {
      const flags = [pinned && `--version ${pinned}`, options.architecture && `--architecture ${options.architecture}`].filter(Boolean);
      return [`winget download -e --id ${packageId}`, ...flags].join(" ");
    }
    case "scoop":
      return `scoop download ${packageId}${options.architecture ? ` --arch ${SCOOP_ARCH[options.architecture]}` : ""}`;
    case "npm":
      return `npm pack ${packageId}${pinned ? `@${pinned}` : ""}`;
    case "pip":
      return `python -m pip download ${packageId}${pinned ? `==${pinned}` : ""} --no-deps`;
    case "pwsh":
      return `Save-PSResource -Name ${packageId}${pinned ? ` -Version ${pinned}` : ""} -Path .`;
    case "powershell":
      return `Save-Module -Name ${packageId}${pinned ? ` -RequiredVersion ${pinned}` : ""} -Path .`;
    default:
      return null;
  }
}

/**
 * Příkaz, kterým se smaže mezipaměť správce (stažené instalátory, archivy,
 * staré verze). Nainstalované aplikace zůstanou. null = správce mezipaměť nemá.
 */
export function cacheCleanCommand(source: SourceId): string | null {
  switch (source) {
    case "winget":
      return 'Remove-Item "$env:TEMP\\WinGet" -Recurse -Force';
    case "chocolatey":
      return "choco cache remove";
    case "scoop":
      return "scoop cleanup * --cache";
    case "npm":
      return "npm cache clean --force";
    case "bun":
      return "bun pm cache rm";
    case "pip":
      return "python -m pip cache purge";
    case "cargo":
      return 'Remove-Item "$env:USERPROFILE\\.cargo\\registry\\cache" -Recurse -Force';
    case "vcpkg":
      return 'Remove-Item "$env:LOCALAPPDATA\\vcpkg\\archives" -Recurse -Force';
    case "dotnet":
      return "dotnet nuget locals all --clear";
    default:
      return null;
  }
}

/**
 * Příkaz pro instalaci bez dotazů (do skriptů): k běžnému příkazu přidá
 * automatické potvrzení licencí a důvěryhodnosti repozitáře, kde je potřeba.
 */
export function unattendedInstallCommand(source: SourceId, packageId: string, version?: string, options?: InstallOptions): string {
  const base = sourceCommand(source, "install", packageId, version, options);
  if (source === "winget") return `${base} --accept-package-agreements --accept-source-agreements`;
  if (source === "pwsh") return `${base} -TrustRepository`;
  if (source === "powershell") return `${base} -Force`;
  return base; // choco už má -y, ostatní se neptají
}

/** Odkaz na stránku balíčku v repozitáři zdroje (pro sekci Informace). */
export function sourcePackageUrl(source: SourceId, packageId: string): string {
  const id = encodeURIComponent(packageId);
  switch (source) {
    case "winget":
      return `https://winstall.app/apps/${id}`;
    case "chocolatey":
      return `https://community.chocolatey.org/packages/${id}`;
    case "scoop":
      return `https://scoop.sh/#/apps?q=${encodeURIComponent(packageId.split("/").pop()!)}`;
    case "npm":
    case "bun":
      return `https://www.npmjs.com/package/${packageId}`;
    case "pip":
      return `https://pypi.org/project/${id}/`;
    case "cargo":
      return `https://crates.io/crates/${id}`;
    case "vcpkg":
      return `https://vcpkg.io/en/package/${id}`;
    case "dotnet":
      return `https://www.nuget.org/packages/${id}`;
    case "pwsh":
    case "powershell":
      return `https://www.powershellgallery.com/packages/${id}`;
  }
}
