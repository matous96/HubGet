/**
 * Bezpečnostní aktualizace pro karty, seznam aktualizací a oznámení
 * (lib/securityUpdates.ts – poznámky k verzi z katalogu, zranitelnosti z OSV.dev).
 */
import { useMemo } from "react";
import { queryClient, queryKeys } from "@/app/queryClient";
import { isSecurityRelease } from "@/lib/securityUpdates";
import type { LoadedCatalog } from "@/services/catalog";
import { findingOf, useVulnerabilities } from "@/store/vulnerabilities";
import type { InstalledPackage } from "@/types";
import type { InstalledItem } from "./useInstalledItems";
import { useCatalog } from "./usePackages";

/** Aktualizace balíčku opravuje bezpečnostní chybu (mimo React – oznámení, automatické aktualizace). */
export function isSecurityUpdate(pkg: InstalledPackage, catalog = queryClient.getQueryData<LoadedCatalog>(queryKeys.catalog)) {
  if (!pkg.availableVersion) return false;
  return isSecurityRelease(catalog, pkg, pkg.availableVersion) || !!findingOf(useVulnerabilities.getState().found, pkg);
}

/**
 * Totéž pro kartu nainstalované aplikace. Katalog bez odběru dotazu (karty se při změně
 * nainstalovaných překreslí samy, katalog je v tu chvíli načtený) a ze zranitelností jen
 * výsledek pro tuto kartu – desítky karet na stránce tak nepřidají práci navíc.
 */
export function useIsSecurityUpdate(pkg: InstalledPackage | undefined) {
  const vulnerable = useVulnerabilities((s) => !!pkg?.availableVersion && !!findingOf(s.found, pkg));
  if (!pkg?.availableVersion) return false;
  return vulnerable || isSecurityRelease(queryClient.getQueryData<LoadedCatalog>(queryKeys.catalog), pkg, pkg.availableVersion);
}

/** Id aplikací (karet) s bezpečnostní aktualizací. */
export function useSecurityUpdateIds(updatable: InstalledItem[]): ReadonlySet<string> {
  const { data: catalog } = useCatalog();
  const found = useVulnerabilities((s) => s.found);
  return useMemo(() => {
    const ids = new Set<string>();
    for (const { pkg, entry } of updatable) {
      if (pkg.availableVersion && (isSecurityRelease(catalog, pkg, pkg.availableVersion) || findingOf(found, pkg))) ids.add(entry.id);
    }
    return ids;
  }, [updatable, catalog, found]);
}

/** Nainstalované balíčky se známou zranitelností (OSV.dev) – i ty, ke kterým zatím aktualizace není. */
export function useVulnerableItems(items: InstalledItem[]) {
  const found = useVulnerabilities((s) => s.found);
  return useMemo(
    () => items.flatMap((item) => {
      const finding = findingOf(found, item.pkg);
      return finding ? [{ item, finding }] : [];
    }),
    [items, found],
  );
}
