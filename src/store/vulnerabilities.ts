/**
 * Známé zranitelnosti nainstalovaných verzí balíčků režimu Vývojář z OSV.dev
 * (lib/securityUpdates.ts, kontrolu spouští components/package/VulnerabilityWatcher.tsx,
 * jen se zapnutým Nastavení → Aktualizace balíčků → Známé zranitelnosti).
 * Uloženo, ať pravidla aktualizací platí hned po startu – kontrola se opakuje po
 * CHECK_INTERVAL nebo po změně nainstalovaných verzí.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OsvFinding } from "@/lib/securityUpdates";
import type { InstalledPackage } from "@/types";

export const CHECK_INTERVAL = 12 * 60 * 60_000;

interface VulnerabilitiesState {
  /** „zdroj:id balíčku“ → zranitelnosti nainstalované verze. */
  found: Record<string, OsvFinding>;
  /** Kdy a pro jaké balíčky (podpis „zdroj:id@verze“) proběhla poslední kontrola. */
  checkedAt: number | null;
  signature: string | null;
  set: (found: Record<string, OsvFinding>, signature: string) => void;
  clear: () => void;
}

export const useVulnerabilities = create<VulnerabilitiesState>()(
  persist(
    (set) => ({
      found: {},
      checkedAt: null,
      signature: null,
      set: (found, signature) => set({ found, signature, checkedAt: Date.now() }),
      clear: () => set({ found: {}, signature: null, checkedAt: null }),
    }),
    { name: "unibox-vulnerabilities", partialize: ({ found, checkedAt, signature }) => ({ found, checkedAt, signature }) },
  ),
);

/** Zranitelnosti právě nainstalované verze (po aktualizaci starý nález neplatí). */
export function findingOf(found: Record<string, OsvFinding>, pkg: Pick<InstalledPackage, "source" | "packageId" | "installedVersion">) {
  const finding = found[`${pkg.source}:${pkg.packageId}`];
  return finding && finding.version === pkg.installedVersion ? finding : undefined;
}
