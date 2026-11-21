/**
 * Obal správce balíčků, který zapisuje do protokolu, co se spouští
 * a jak to dopadlo. Funguje stejně nad mock i nad skutečným backendem;
 * skutečný backend bude navíc posílat výstup příkazů řádek po řádku.
 */
import i18n from "@/i18n";
import { writeLog } from "@/store/logs";
import type { OperationPhase, SourceId } from "@/types";
import { cacheCleanCommand, downloadCommand, sourceCommand, unattendedInstallCommand } from "./sources";
import type { OperationRequest, PackageManager } from "./types";

/**
 * Co backend spouští pro výpis nainstalovaných balíčků. winget se ovládá
 * PowerShell modulem Microsoft.WinGet.Client, ostatní svým CLI (správci
 * bez vyhledávání v CLI – Bun, pip – se ptají přímo API svého registru).
 * Chocolatey a Scoop čte backend přímo z jejich složek – stejný výsledek jako příkaz.
 */
const LIST: Record<SourceId, string> = {
  winget: "Get-WinGetPackage",
  chocolatey: "choco list",
  scoop: "scoop list",
  npm: "npm list -g --depth=0 --json",
  bun: "bun pm ls -g",
  pip: "python -m pip list --format=json",
  cargo: "cargo install --list",
  vcpkg: "vcpkg list",
  dotnet: "dotnet tool list --global",
  pwsh: "Get-InstalledPSResource",
  powershell: "Get-InstalledModule",
};

function searchCommand(source: SourceId, q: string): string {
  switch (source) {
    case "winget":
      return `Find-WinGetPackage -Query "${q}"`;
    case "chocolatey":
      return `choco search ${q}`;
    case "scoop":
      return `scoop search ${q}`;
    case "npm":
      return `npm search ${q} --json`;
    case "bun":
      return `GET https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}`;
    case "pip":
      return `GET https://pypi.org/search/?q=${encodeURIComponent(q)}`;
    case "cargo":
      return `cargo search ${q}`;
    case "vcpkg":
      return `vcpkg search ${q}`;
    case "dotnet":
      return `dotnet tool search ${q}`;
    case "pwsh":
      return `Find-PSResource -Name *${q}*`;
    case "powershell":
      return `Find-Module -Name *${q}*`;
  }
}

function versionsCommand(source: SourceId, id: string): string {
  switch (source) {
    case "winget":
      return `(Find-WinGetPackage -Id ${id} -MatchOption Equals).AvailableVersions`;
    case "chocolatey":
      return `choco search ${id} --exact --all-versions`;
    case "scoop":
      return `scoop info ${id}`;
    case "npm":
    case "bun":
      return `npm view ${id} versions --json`;
    case "pip":
      return `python -m pip index versions ${id}`;
    case "cargo":
      return `GET https://crates.io/api/v1/crates/${id}/versions`;
    case "vcpkg":
      return `vcpkg search ${id}`;
    case "dotnet":
      return `GET https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`;
    case "pwsh":
      return `Find-PSResource -Name ${id} -Version *`;
    case "powershell":
      return `Find-Module -Name ${id} -AllVersions`;
  }
}

/**
 * Příkaz operace – stejný, jaký si uživatel může zkopírovat (bez dotazů).
 * U wingetu odpovídá tomu, co backend skutečně spouští (winget CLI).
 */
function operationCommand(source: SourceId, request: OperationRequest): string {
  const { kind, packageId, version, options = {} } = request;
  if (kind === "download") return downloadCommand(source, packageId, version, options) ?? "";
  // Opravu umí jen winget (backend winget.rs operation_args)
  if (kind === "repair") return source === "winget" ? `winget repair --id ${packageId} --exact --silent` : "";
  return kind === "install" ? unattendedInstallCommand(source, packageId, version, options) : sourceCommand(source, kind, packageId);
}

const seconds = (start: number) =>
  ((performance.now() - start) / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 });

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function withLogging(manager: PackageManager): PackageManager {
  const source = manager.id;
  const log = (level: Parameters<typeof writeLog>[1], text: string) => writeLog(source, level, text);

  return {
    id: source,

    getStatus: () => manager.getStatus(),

    getCache: () => manager.getCache(),

    async clearCache() {
      const command = cacheCleanCommand(source);
      if (command) log("command", command);
      try {
        await manager.clearCache();
        log("success", i18n.t("logs.msg.cacheCleared"));
      } catch (e) {
        log("error", errorText(e));
        throw e;
      }
    },

    async setup() {
      log("info", i18n.t("logs.msg.setup"));
      try {
        await manager.setup();
        log("success", i18n.t("logs.msg.setupDone"));
      } catch (e) {
        log("error", errorText(e));
        throw e;
      }
    },

    async getInstalled() {
      const start = performance.now();
      log("command", LIST[source]);
      try {
        const result = await manager.getInstalled();
        log("info", i18n.t("logs.msg.found", { count: result.length, seconds: seconds(start) }));
        return result;
      } catch (e) {
        log("error", errorText(e));
        throw e;
      }
    },

    async search(query, signal) {
      const start = performance.now();
      log("command", searchCommand(source, query));
      try {
        const result = await manager.search(query, signal);
        log("info", i18n.t("logs.msg.results", { count: result.length, seconds: seconds(start) }));
        return result;
      } catch (e) {
        // Zrušené hledání (uživatel píše dál) není chyba
        if (e instanceof DOMException && e.name === "AbortError") log("info", i18n.t("logs.msg.aborted"));
        else log("error", errorText(e));
        throw e;
      }
    },

    async getVersions(packageId) {
      log("command", versionsCommand(source, packageId));
      try {
        const result = await manager.getVersions(packageId);
        log("info", i18n.t("logs.msg.versions", { count: result.length }));
        return result;
      } catch (e) {
        log("error", errorText(e));
        throw e;
      }
    },

    startOperation(request, onProgress) {
      const start = performance.now();
      let phase: OperationPhase | null = null;
      if (request.options?.asAdmin) log("info", i18n.t("logs.msg.asAdmin"));
      log("command", operationCommand(source, request));
      if (request.options?.skipHash) log("warning", i18n.t("logs.msg.skipHash"));

      const handle = manager.startOperation(request, (progress) => {
        // Do protokolu jen změny fáze, ne každé procento
        if (progress.phase !== phase) {
          phase = progress.phase;
          log(phase === "elevating" ? "warning" : "info", i18n.t(`logs.phase.${phase}`));
        }
        onProgress(progress);
      });

      handle.done.then(({ outcome, error, errorKey }) => {
        if (outcome === "success") log("success", i18n.t(`logs.msg.${request.kind}Done`, { seconds: seconds(start) }));
        else if (outcome === "cancelled") log("warning", i18n.t("logs.msg.cancelled"));
        // Na pozadí bez dialogu UAC nespuštěno – není to chyba, vysvětlí to fronta úloh (logs.msg.needsAdmin)
        else if (!(request.background && errorKey === "needsAdmin")) log("error", i18n.t("logs.msg.failed", { error: error ?? "" }));
      });
      return handle;
    },
  };
}
