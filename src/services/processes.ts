/**
 * Běžící procesy aplikace (jen desktopová aplikace) – backend
 * src-tauri/src/running.rs. Před operací, po ní a v AppInUseDialog.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";

export interface RunningProcess {
  pid: number;
  name: string;
  path: string;
  /** Má viditelné okno (i minimalizované) – uživatel s aplikací pracuje. */
  visible: boolean;
  /** Okenní program (konzolové programy se bez dotazu nezavírají). */
  gui: boolean;
  /** Leží ve složce instalace ze záznamu v registru (ne jen podle názvu). */
  certain: boolean;
}

/** Procesy aplikace podle složky instalace, názvu a id balíčku. */
export const findAppProcesses = (packageId: string, name: string): Promise<RunningProcess[]> =>
  isTauri() ? invoke<RunningProcess[]>("app_processes", { packageId, name }) : Promise.resolve([]);

/** Zavře procesy – slušně, s `force` natvrdo. Vrátí id procesů, které běží dál. */
export const closeProcesses = (pids: number[], force: boolean) => invoke<number[]>("close_processes", { pids, force });

/** Stav zavírané aplikace. */
export interface CloseState {
  /** Procesy, které běží dál. */
  alive: number[];
  /** Z nich procesy s viditelným, reagujícím oknem – aplikace se ptá na uložení práce. */
  waiting: number[];
}

/**
 * Zavře aplikaci bez ztráty práce: žádost o zavření (jako křížek); co se schová k hodinám
 * nebo zamrzne, natvrdo. Aplikaci, která se ptá na uložení, nechá běžet (`waiting`).
 */
export const closeApp = (pids: number[]) => invoke<CloseState>("close_app", { pids });

/** Stav aplikace, na jejíž zavření se čeká – nic neukončuje. */
export const appCloseState = (pids: number[]) => invoke<CloseState>("app_close_state", { pids });

/** Ukončí procesy bez dotazu (slušně, kdo nereaguje, natvrdo). Vrátí id těch, které ukončit nešlo. */
export const endProcesses = (pids: number[]) => invoke<number[]>("end_processes", { pids });

/**
 * Proces, který HubGet smí před operací ukončit bez dotazu: jistě patří
 * aplikaci (složka instalace z registru), nemá okno (běží na pozadí / u hodin)
 * a je okenní program – ne konzolový skript, který spustil uživatel.
 */
export const closableInBackground = (p: RunningProcess) => p.certain && !p.visible && p.gui;
