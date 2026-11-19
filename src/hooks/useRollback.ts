/**
 * Kam se dá aplikace vrátit: poslední úspěšná aktualizace v historii operací,
 * u které je známá verze před ní, a nainstalovaná verze je pořád novější.
 */
import { useMemo } from "react";
import { compareVersions } from "@/lib/version";
import { useHistory } from "@/store/history";
import type { InstalledPackage } from "@/types";

export interface RollbackTarget {
  /** Verze před poslední aktualizací. */
  toVersion: string;
  currentVersion: string;
}

export function useRollback(appId: string, installed: InstalledPackage | undefined): RollbackTarget | null {
  const items = useHistory((s) => s.items);
  return useMemo(() => {
    if (!installed?.installedVersion) return null;
    // Nejnovější záznam první – stačí poslední úspěšná aktualizace téhož balíčku
    const last = items.find(
      (h) =>
        h.appId === appId &&
        h.kind === "update" &&
        h.outcome === "success" &&
        h.source === installed.source &&
        h.packageId === installed.packageId,
    );
    if (!last?.fromVersion) return null;
    if (compareVersions(installed.installedVersion, last.fromVersion) <= 0) return null;
    return { toVersion: last.fromVersion, currentVersion: installed.installedVersion };
  }, [items, appId, installed]);
}
