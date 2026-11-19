/**
 * Kontrola místa na systémovém disku před instalací a aktualizací (backend system.rs →
 * disk_space): když místo nestačí, fronta operaci nespustí a poradí úklid – místo aby
 * instalátor spadl v polovině. Potřebné místo se odhadne z katalogu: stažený instalátor
 * + rozbalená aplikace (velikost po instalaci, jinak trojnásobek instalátoru) + rezerva
 * pro Windows.
 */
import { invoke } from "@tauri-apps/api/core";
import { queryClient, queryKeys } from "@/app/queryClient";
import type { LoadedCatalog } from "@/services/catalog";
import type { Job } from "@/types";
import { isTauri } from "./tauri";

export interface DiskSpace {
  drive: string;
  free: number;
  total: number;
}

/** Rezerva, kterou instalace nesmí spotřebovat (Windows potřebuje místo na stránkovací soubor, aktualizace…). */
export const RESERVE_BYTES = 500 * 1024 * 1024;

export const diskSpace = (): Promise<DiskSpace | null> =>
  isTauri() ? invoke<DiskSpace | null>("disk_space").catch(() => null) : Promise.resolve(null);

/** Odhad místa, které instalace / aktualizace potřebuje (bajty, včetně rezervy). */
export function requiredSpace(job: Pick<Job, "appId" | "source" | "packageId">, catalog = queryClient.getQueryData<LoadedCatalog>(queryKeys.catalog)): number {
  const entry = catalog?.catalog.packages.find((p) => p.id === job.appId);
  const source =
    entry?.sources.find((s) => s.source === job.source && s.packageId === job.packageId) ?? entry?.sources.find((s) => s.source === job.source);
  const download = source?.size ?? 0;
  const installed = source?.installedSize ?? download * 3;
  return download + installed + RESERVE_BYTES;
}

export interface Shortage {
  drive: string;
  free: number;
  needed: number;
}

/** Místo nestačí – null, když stačí nebo ho nejde zjistit (pak se instalace nezdržuje). */
export function shortageOf(space: DiskSpace | null, needed: number): Shortage | null {
  return space && space.free < needed ? { drive: space.drive, free: space.free, needed } : null;
}

/** Kontrola před spuštěním operace (jen instalace a aktualizace). */
export async function diskShortage(job: Pick<Job, "appId" | "source" | "packageId" | "kind">): Promise<Shortage | null> {
  if (job.kind !== "install" && job.kind !== "update") return null;
  return shortageOf(await diskSpace(), requiredSpace(job));
}
