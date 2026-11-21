/**
 * Ukázkové (mock) implementace správců balíčků pro vývoj v prohlížeči.
 * Simulují nainstalované balíčky, vyhledávání, průběh stahování a instalace,
 * dialog UAC i zrušení operace. Stav drží jen v paměti.
 */
import type { InstalledPackage, ManagerStatus, OperationProgress, RepoSearchResult, SourceId } from "@/types";
import { detectWingetOrigin, getSource } from "./sources";
import type { OperationHandle, OperationRequest, PackageManager } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Nainstalovaný balíček v ukázkových datech; u wingetu i jeho „Source“. */
type MockInstalled = Omit<InstalledPackage, "source" | "origin"> & {
  /** Jen winget: „winget“ (výchozí), „msstore“ (aplikace z Microsoft Storu), nebo null = program mimo winget. */
  wingetSource?: string | null;
};

/**
 * Vymyslí historii verzí od nejnovější: postupně snižuje poslední číslo,
 * při podtečení předposlední. Nečíselné verze (např. „145.0b3“) historii nemají.
 */
function olderVersions(latest: string, count = 12): string[] {
  const parts = latest.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (parts.some(Number.isNaN)) return [latest];
  const result = [latest];
  const current = [...parts];
  const last = current.length - 1;
  for (let i = 1; i < count; i++) {
    current[last] -= 1 + (i % 3);
    if (current[last] < 0) {
      if (last === 0 || current[last - 1] === 0) break;
      current[last - 1] -= 1;
      current[last] = 6 + (i % 4);
    }
    result.push(current.join("."));
  }
  return result;
}

/** Původ instalace stejně, jak ho určí skutečný backend. */
function originFor(source: SourceId, p: MockInstalled): InstalledPackage["origin"] {
  if (source !== "winget") return source;
  return detectWingetOrigin(p.packageId, p.wingetSource === undefined ? "winget" : p.wingetSource);
}

interface MockConfig {
  source: SourceId;
  status: ManagerStatus;
  /** Výchozí „nainstalované“ balíčky. */
  installed: MockInstalled[];
  /** Balíčky v repozitáři navíc oproti katalogu (ukázka výsledků mimo katalog). */
  extraRepo: Omit<RepoSearchResult, "source">[];
  /** Balíčky, u kterých se simuluje dialog UAC (u Chocolatey všechny). */
  requiresAdmin?: Set<string>;
  /** Velikost mezipaměti v MB (vynecháno = správce mezipaměť nemá). */
  cacheMb?: number;
}

function createMockManager(config: MockConfig): PackageManager {
  const { source } = config;
  let status = { ...config.status };
  const installed = new Map<string, InstalledPackage>(
    config.installed.map((p) => {
      const { wingetSource, ...rest } = p;
      void wingetSource; // jen pro určení původu, do výsledku nepatří
      return [p.packageId, { ...rest, source, origin: originFor(source, p) }];
    }),
  );

  // Repozitář = všechny balíčky katalogu dostupné v tomto zdroji + balíčky navíc.
  // Ukázkový katalog (480 kB) se načte až při prvním použití – desktopová verze ho nepotřebuje.
  let repoPromise: Promise<RepoSearchResult[]> | null = null;
  const loadRepo = () =>
    (repoPromise ??= import("@/data/catalog.sample.json").then(({ default: sample }) => [
      ...(sample.packages as { name: string; sources: { source: string; packageId: string; version: string }[] }[])
        .flatMap((p) =>
          p.sources
            .filter((s) => s.source === source)
            .map((s) => ({ source, packageId: s.packageId, name: p.name, version: s.version })),
        ),
      ...config.extraRepo.map((p) => ({ ...p, source })),
    ]));

  const needsUac = (packageId: string) => getSource(source).needsAdmin || !!config.requiresAdmin?.has(packageId);
  let cacheBytes = config.cacheMb !== undefined ? Math.round(config.cacheMb * 1024 * 1024) : null;

  return {
    id: source,

    async getStatus() {
      await sleep(150);
      return status;
    },

    async setup() {
      await sleep(2000);
      status = { available: true, version: "1.0.0" };
    },

    async getInstalled() {
      await sleep(300 + Math.random() * 300); // simulace doby běhu CLI / PowerShellu
      return status.available ? [...installed.values()] : [];
    },

    async search(query, signal) {
      await sleep(250 + Math.random() * 250);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const q = query.trim().toLowerCase();
      if (!q || !status.available) return [];
      return (await loadRepo()).filter((p) => p.packageId.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    },

    async getCache() {
      await sleep(400 + Math.random() * 500); // procházení složek mezipaměti
      return status.available && cacheBytes !== null ? { size: cacheBytes } : null;
    },

    async clearCache() {
      await sleep(900 + Math.random() * 700);
      if (cacheBytes !== null) cacheBytes = 0;
    },

    async getVersions(packageId) {
      await sleep(300);
      const latest = (await loadRepo()).find((p) => p.packageId === packageId)?.version;
      if (!latest) return [];
      // Správce bez výběru verze (vcpkg) nabízí jen aktuální verzi
      return getSource(source).supportsVersions ? olderVersions(latest) : [latest];
    },

    startOperation(request: OperationRequest, onProgress: (p: OperationProgress) => void): OperationHandle {
      let cancelled = false;

      const run = async () => {
        // Postupně zvyšuje procenta v dané fázi, dokud není zrušeno.
        const step = async (phase: OperationProgress["phase"], ms: number) => {
          const steps = 20;
          for (let i = 0; i <= steps; i++) {
            if (cancelled) return false;
            onProgress({ phase, percent: Math.round((100 * i) / steps) });
            await sleep(ms / steps);
          }
          return true;
        };

        const options = request.options ?? {};

        // Stažení instalátoru: jen stahování, nic se neinstaluje
        if (request.kind === "download") {
          if (!(await step("downloading", 1800 + Math.random() * 1200))) return { outcome: "cancelled" as const };
          return { outcome: "success" as const };
        }

        if (needsUac(request.packageId) || options.asAdmin) {
          onProgress({ phase: "elevating", percent: null });
          await sleep(1500);
          if (cancelled) return { outcome: "cancelled" as const };
        }

        if (request.kind === "uninstall") {
          if (!(await step("uninstalling", 1800))) return { outcome: "cancelled" as const };
          installed.delete(request.packageId);
          return { outcome: "success" as const };
        }
        if (request.kind === "repair") {
          if (!(await step("repairing", 2000))) return { outcome: "cancelled" as const };
          return { outcome: "success" as const };
        }

        if (!(await step("downloading", 2200 + Math.random() * 1500))) return { outcome: "cancelled" as const };
        // Interaktivní instalace: čeká se, až uživatel projde průvodcem
        if (options.interactive) {
          onProgress({ phase: "interactive", percent: null });
          await sleep(2600);
          if (cancelled) return { outcome: "cancelled" as const };
        }
        // Ve fázi instalace průběh neznáme – stejně jako u skutečných správců.
        onProgress({ phase: "installing", percent: null });
        await sleep(1400);
        if (cancelled) return { outcome: "cancelled" as const };

        // Instalace konkrétní (starší) verze → po ní je dostupná aktualizace na nejnovější.
        const pkg = (await loadRepo()).find((p) => p.packageId === request.packageId);
        const latest = pkg?.version ?? "1.0.0";
        const version = request.version ?? latest;
        installed.set(request.packageId, {
          source,
          packageId: request.packageId,
          name: pkg?.name ?? request.packageId,
          installedVersion: version,
          availableVersion: version !== latest ? latest : null,
          origin: source,
        });
        return { outcome: "success" as const };
      };

      return { done: run(), cancel: () => (cancelled = true) };
    },
  };
}

/** Balíčky z registru npm mimo katalog (sdílí npm i Bun). */
const NPM_EXTRA: MockConfig["extraRepo"] = [
  { packageId: "eslint", name: "ESLint", version: "9.38.0" },
  { packageId: "vite", name: "Vite", version: "7.1.12" },
  { packageId: "nodemon", name: "nodemon", version: "3.1.10" },
  { packageId: "http-server", name: "http-server", version: "14.1.1" },
];

/** Moduly z PowerShell Gallery mimo katalog (sdílí PowerShell 7 i 5). */
const PSGALLERY_EXTRA: MockConfig["extraRepo"] = [
  { packageId: "Az", name: "Az", version: "14.5.0" },
  { packageId: "Microsoft.Graph", name: "Microsoft Graph PowerShell SDK", version: "2.31.0" },
  { packageId: "Terminal-Icons", name: "Terminal-Icons", version: "0.11.0" },
  { packageId: "posh-git", name: "posh-git", version: "1.1.0" },
];

export const mockManagers: Record<SourceId, PackageManager> = {
  winget: createMockManager({
    source: "winget",
    cacheMb: 412,
    status: { available: true, version: "1.11.430" },
    installed: [
      { packageId: "Mozilla.Firefox", name: "Mozilla Firefox", installedVersion: "143.0.1", availableVersion: "144.0" },
      { packageId: "Microsoft.VisualStudioCode", name: "Visual Studio Code", installedVersion: "1.106.0", availableVersion: null },
      { packageId: "Git.Git", name: "Git", installedVersion: "2.50.1", availableVersion: "2.51.2" },
      { packageId: "7zip.7zip", name: "7-Zip", installedVersion: "25.01", availableVersion: null },
      { packageId: "VideoLAN.VLC", name: "VLC media player", installedVersion: "3.0.20", availableVersion: "3.0.21" },
      { packageId: "Discord.Discord", name: "Discord", installedVersion: "1.0.9212", availableVersion: null },
      { packageId: "Microsoft.PowerToys", name: "PowerToys", installedVersion: "0.94.2", availableVersion: "0.95.1" },
      { packageId: "Microsoft.Edge", name: "Microsoft Edge", installedVersion: "141.0.3537.92", availableVersion: null },
      { packageId: "Spotify.Spotify", name: "Spotify", installedVersion: "1.2.73.474", availableVersion: "1.2.74.477" },
      // Aplikace z Microsoft Storu – winget je vidí se zdrojem „msstore“ (původ „WinGet: msstore“)
      { packageId: "9NKSQGP7F2NH", name: "WhatsApp", installedVersion: "2.2547.6.0", availableVersion: null, wingetSource: "msstore" },
      { packageId: "9WZDNCRFJ3PS", name: "Microsoft Remote Desktop", installedVersion: "10.2.3012.0", availableVersion: "10.2.3014.0", wingetSource: "msstore" },
      // Hry ze Steamu – winget je vidí jako „Steam App <id>“ bez zdroje
      { packageId: "Steam App 730", name: "Counter-Strike 2", installedVersion: "", availableVersion: null, wingetSource: null },
      { packageId: "Steam App 570", name: "Dota 2", installedVersion: "", availableVersion: null, wingetSource: null },
      { packageId: "Steam App 1091500", name: "Cyberpunk 2077", installedVersion: "", availableVersion: null, wingetSource: null },
      { packageId: "Steam App 892970", name: "Valheim", installedVersion: "", availableVersion: null, wingetSource: null },
      { packageId: "Steam App 1145360", name: "Hades", installedVersion: "", availableVersion: null, wingetSource: null },
      // Programy nainstalované mimo správce balíčků (jen v seznamu Programy a funkce)
      { packageId: "ARP\\Machine\\X64\\Logitech G HUB", name: "Logitech G HUB", installedVersion: "2025.8.7", availableVersion: null, wingetSource: null },
      { packageId: "ARP\\Machine\\X64\\{B2FE1952-0186-46C3-BAEC-A80AA35AC5B8}_Display.Driver", name: "NVIDIA Graphics Driver", installedVersion: "581.57", availableVersion: null, wingetSource: null },
    ],
    extraRepo: [
      { packageId: "Mozilla.Firefox.DeveloperEdition", name: "Firefox Developer Edition", version: "145.0b3" },
      { packageId: "Mozilla.Thunderbird", name: "Mozilla Thunderbird", version: "144.0" },
      { packageId: "GitHub.cli", name: "GitHub CLI", version: "2.82.1" },
      { packageId: "GitHub.GitHubDesktop", name: "GitHub Desktop", version: "3.5.3" },
      { packageId: "Microsoft.PowerShell", name: "PowerShell", version: "7.5.4" },
      { packageId: "Microsoft.Edge", name: "Microsoft Edge", version: "141.0.3537.92" },
      // Balíčky s podobnými názvy (ukázka slučování: stejný název = jedna aplikace, jiný = zvlášť)
      { packageId: "Envoy49.go-spotify-cli", name: "Go Spotify Cli", version: "1.0.80" },
      { packageId: "OpenCLICollective.spotify-cli", name: "Spotify CLI", version: "0.1.11" },
      { packageId: "aome510.spotify-player", name: "spotify_player", version: "0.25.1" },
    ],
    requiresAdmin: new Set(["Docker.DockerDesktop", "Microsoft.PowerToys", "WireGuard.WireGuard", "Malwarebytes.Malwarebytes"]),
  }),

  scoop: createMockManager({
    source: "scoop",
    cacheMb: 1270,
    status: { available: true, version: "0.5.3" },
    installed: [
      { packageId: "extras/obsidian", name: "Obsidian", installedVersion: "1.9.10", availableVersion: "1.9.14" },
      { packageId: "extras/everything", name: "Everything", installedVersion: "1.4.1.1028", availableVersion: null },
      { packageId: "main/neovim", name: "Neovim", installedVersion: "0.11.4", availableVersion: null },
    ],
    extraRepo: [
      { packageId: "main/neovim", name: "Neovim", version: "0.11.4" },
      { packageId: "main/gh", name: "GitHub CLI", version: "2.82.1" },
      { packageId: "extras/firefox-developer", name: "Firefox Developer Edition", version: "145.0b3" },
      { packageId: "main/spotify-player", name: "Spotify Player", version: "0.24.0" },
      { packageId: "main/spotify-tui", name: "Spotify Tui", version: "0.25.0" },
    ],
  }),

  chocolatey: createMockManager({
    source: "chocolatey",
    cacheMb: 286,
    status: { available: true, version: "2.5.1" },
    installed: [
      { packageId: "notepadplusplus", name: "Notepad++", installedVersion: "8.8.6", availableVersion: null },
      { packageId: "keepassxc", name: "KeePassXC", installedVersion: "2.7.9", availableVersion: "2.7.10" },
    ],
    extraRepo: [
      { packageId: "firefox-dev", name: "Firefox Developer Edition", version: "145.0.3-beta" },
      { packageId: "thunderbird", name: "Mozilla Thunderbird", version: "144.0" },
      { packageId: "gh", name: "GitHub CLI", version: "2.82.1" },
      { packageId: "spotify-cli", name: "Spotify Cli", version: "0.1.22" },
      { packageId: "spotify-tui", name: "Spotify Tui", version: "0.25.0" },
    ],
  }),

  // ── Správci pro vývojáře ──────────────────────────────────────────────
  // Ukázka různých stavů: některé jsou „nainstalované“, jiné ne (Nastavení
  // pak nabídne jejich instalaci).

  npm: createMockManager({
    source: "npm",
    cacheMb: 830,
    status: { available: true, version: "11.6.2" },
    installed: [
      { packageId: "typescript", name: "TypeScript", installedVersion: "5.9.3", availableVersion: null },
      { packageId: "pnpm", name: "pnpm", installedVersion: "10.18.0", availableVersion: "10.19.0" },
    ],
    extraRepo: NPM_EXTRA,
  }),

  bun: createMockManager({
    source: "bun",
    cacheMb: 120,
    status: { available: false, version: null },
    installed: [],
    extraRepo: NPM_EXTRA, // Bun instaluje z registru npm
  }),

  pip: createMockManager({
    source: "pip",
    cacheMb: 214,
    status: { available: true, version: "25.2" },
    installed: [
      { packageId: "yt-dlp", name: "yt-dlp", installedVersion: "2025.9.26", availableVersion: "2025.10.22" },
      { packageId: "black", name: "Black", installedVersion: "25.9.0", availableVersion: null },
    ],
    extraRepo: [
      { packageId: "requests", name: "Requests", version: "2.32.5" },
      { packageId: "httpie", name: "HTTPie", version: "3.2.4" },
      { packageId: "poetry", name: "Poetry", version: "2.2.1" },
      { packageId: "ruff", name: "Ruff", version: "0.14.1" },
    ],
  }),

  cargo: createMockManager({
    source: "cargo",
    cacheMb: 540,
    status: { available: false, version: null },
    installed: [],
    extraRepo: [
      { packageId: "fd-find", name: "fd", version: "10.3.0" },
      { packageId: "tokei", name: "tokei", version: "13.0.0" },
      { packageId: "starship", name: "Starship", version: "1.23.0" },
      { packageId: "cargo-update", name: "cargo-update", version: "18.0.0" },
    ],
  }),

  vcpkg: createMockManager({
    source: "vcpkg",
    cacheMb: 960,
    status: { available: false, version: null },
    installed: [],
    extraRepo: [
      { packageId: "zlib", name: "zlib", version: "1.3.1" },
      { packageId: "openssl", name: "OpenSSL", version: "3.6.0" },
      { packageId: "sdl2", name: "SDL2", version: "2.32.10" },
      { packageId: "boost", name: "Boost", version: "1.89.0" },
    ],
  }),

  dotnet: createMockManager({
    source: "dotnet",
    cacheMb: 1640,
    status: { available: true, version: "9.0.306" },
    installed: [{ packageId: "dotnet-ef", name: "Entity Framework Core Tools", installedVersion: "9.0.10", availableVersion: null }],
    extraRepo: [
      { packageId: "dotnet-outdated-tool", name: "dotnet-outdated", version: "4.6.8" },
      { packageId: "dotnet-counters", name: "dotnet-counters", version: "9.0.652701" },
      { packageId: "csharpier", name: "CSharpier", version: "1.1.2" },
    ],
  }),

  pwsh: createMockManager({
    source: "pwsh",
    status: { available: true, version: "7.5.4" },
    installed: [{ packageId: "PSReadLine", name: "PSReadLine", installedVersion: "2.3.6", availableVersion: null }],
    extraRepo: PSGALLERY_EXTRA,
  }),

  powershell: createMockManager({
    source: "powershell",
    status: { available: true, version: "5.1.26100" },
    // Windows PowerShell má od výroby starý Pester 3.4.0
    installed: [{ packageId: "Pester", name: "Pester", installedVersion: "3.4.0", availableVersion: "5.7.1" }],
    extraRepo: PSGALLERY_EXTRA,
  }),
};
