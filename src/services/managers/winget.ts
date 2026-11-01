/**
 * Skutečný winget v desktopové aplikaci – volá Rust backend (src-tauri/src/winget.rs).
 *
 * Výpisy a hledání jdou přes PowerShell modul Microsoft.WinGet.Client,
 * operace přes winget CLI. Průběh operace a výstup příkazu posílá backend
 * kanálem; výstup se zapisuje do protokolu správce.
 */
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import type { InstalledPackage, ManagerStatus, RepoSearchResult } from "@/types";
import { hex, startBackendOperation, type BackendResult } from "./backend";
import { detectWingetOrigin, rememberEaGame } from "./sources";
import type { CacheInfo, PackageManager } from "./types";

/** Nainstalovaný balíček, jak ho vrací backend. */
interface BackendInstalled {
  packageId: string;
  name: string;
  installedVersion: string;
  availableVersion: string | null;
  /** „winget“, „msstore“, nebo null u programů mimo winget. */
  wingetSource: string | null;
  /** Program nalezený jen podle složky na disku (InstalledPackage.diskLocation). */
  diskLocation?: string;
  /** Program rozbalený na ploše – verze z jeho souborů (InstalledPackage.portable). */
  portable?: boolean;
  /** Kdy byl program nainstalován (InstalledPackage.installedAt). */
  installedAt?: number;
  /** Hra z EA app (backend ji pozná podle složky hry). */
  eaGame?: boolean;
}

/** Backend nespustil hledání, protože ho nahradilo novější. */
const SUPERSEDED = "superseded";

const abortError = () => new DOMException("Aborted", "AbortError");

/** Srozumitelná chyba z výsledku operace. */
function errorMessage(result: BackendResult): string {
  const key = result.errorKey ?? "unknown";
  // status = stav HTTP u nefunkčního odkazu na instalátor (0x80190194 → 404);
  // u pádu instalátoru je v `detail` kód pádu (0xC0000005), ne HRESULT wingetu
  const code = key === "installerCrashed" && result.detail ? result.detail : hex(result.code);
  const message = i18n.t(`wingetError.${key}`, { code, status: result.code & 0xffff });
  return key === "unknown" && result.detail ? `${message} – ${result.detail}` : message;
}

export const wingetManager: PackageManager = {
  id: "winget",

  getStatus: () => invoke<ManagerStatus>("winget_status"),

  setup: () => invoke<void>("winget_setup"),

  async getInstalled(): Promise<InstalledPackage[]> {
    const items = await invoke<BackendInstalled[]>("winget_installed");
    return items.map(({ wingetSource, eaGame, ...p }) => {
      if (eaGame) rememberEaGame(p.packageId);
      return { ...p, source: "winget", origin: detectWingetOrigin(p.packageId, wingetSource) };
    });
  },

  async search(query, signal): Promise<RepoSearchResult[]> {
    if (!query.trim()) return [];
    if (signal?.aborted) throw abortError();
    // Backend hledání zrušit neumí – po zrušení se výsledek jen zahodí
    const request = invoke<Omit<RepoSearchResult, "source">[]>("winget_search", { query });
    const aborted = new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(abortError()), { once: true }));
    aborted.catch(() => undefined); // zrušení po dokončení hledání už nikoho nezajímá
    try {
      const items = await Promise.race([request, aborted]);
      return items.map((p) => ({ ...p, source: "winget" }));
    } catch (e) {
      if (e === SUPERSEDED) throw abortError();
      throw e;
    }
  },

  getVersions: (packageId) => invoke<string[]>("winget_versions", { packageId }),

  getCache: () => invoke<CacheInfo | null>("winget_cache"),

  clearCache: () => invoke<void>("winget_clear_cache"),

  startOperation: (request, onProgress) => startBackendOperation("winget", "winget_operation", request, onProgress, errorMessage),
};
