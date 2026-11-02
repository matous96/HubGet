import { useLayoutEffect } from "react";
import { useCatalogIndex, useComputedInstalledIndex } from "@/hooks/usePackages";
import { useStartApps } from "@/lib/launch";
import { usePackageIndex } from "@/store/packageIndex";

/**
 * Spočítá indexy pro karty a řádky seznamů (store/packageIndex.ts) – jednou pro celé
 * okno. Drží i dotazy na nainstalované aplikace, katalog a položky nabídky Start,
 * které si dřív zakládala každá karta zvlášť.
 */
export function usePackageIndexSync() {
  const installed = useComputedInstalledIndex();
  const catalog = useCatalogIndex();
  const { data: startApps } = useStartApps();
  // Před vykreslením – karty nové stránky ani na okamžik neukážou prázdný stav
  useLayoutEffect(() => {
    usePackageIndex.setState({ installed, catalog, startApps });
  }, [installed, catalog, startApps]);
}
