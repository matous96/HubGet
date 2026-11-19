/**
 * Most mezi frontendem a Rust backendem (Tauri). Ve webové verzi
 * (pnpm dev v prohlížeči) backend není – funkce pak vrací null
 * a aplikace použije náhradní řešení (simulované správce, odhady).
 */
import { invoke } from "@tauri-apps/api/core";
import type { Arch } from "@/types";

/** Běží aplikace uvnitř Tauri (desktopová aplikace), ne v obyčejném prohlížeči? */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Testovací verze: vývojový režim v desktopové aplikaci (tauri dev, „HubGet (test)“). */
export const isTestBuild = () => import.meta.env.DEV && isTauri();

/** Údaje o počítači z backendu (příkaz system_info). */
export interface SystemInfo {
  arch: Arch;
  /** Např. „Windows 11 Pro“. */
  osName: string;
  /** Např. „24H2“. */
  osDisplayVersion: string | null;
  /** Číslo sestavení Windows, např. 26100. */
  osBuild: number;
  /** Název počítače (proměnná COMPUTERNAME). */
  computerName?: string | null;
  appVersion: string;
}

export async function getSystemInfo(): Promise<SystemInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<SystemInfo>("system_info");
  } catch {
    return null;
  }
}
