import { useLayoutEffect } from "react";
import { sourceKey, useCatalogIndex, useComputedInstalledIndex, useSourceIndex } from "@/hooks/usePackages";
import { useStartApps } from "@/lib/launch";
import { freshDevices, useDevices } from "@/store/devices";
import { useEverInstalled } from "@/store/everInstalled";
import { useHistory } from "@/store/history";
import { usePackageIndex } from "@/store/packageIndex";

/**
 * Spočítá indexy pro karty a řádky seznamů (store/packageIndex.ts) – jednou pro celé
 * okno. Drží i dotazy na nainstalované aplikace, katalog a položky nabídky Start,
 * které si dřív zakládala každá karta zvlášť.
 */
export function usePackageIndexSync() {
  const installed = useComputedInstalledIndex();
  const catalog = useCatalogIndex();
  const sourceIndex = useSourceIndex();
  const { data: startApps } = useStartApps();
  const devices = useDevices((s) => s.devices);
  const deviceId = useDevices((s) => s.deviceId);
  // Před vykreslením – karty nové stránky ani na okamžik neukážou prázdný stav
  useLayoutEffect(() => {
    usePackageIndex.setState({ installed, catalog, startApps });
    // Aplikace, které tu někdy byly nainstalované – karta je pak ukáže s mráčkem (Nainstalovat znovu)
    useEverInstalled.getState().observe(installed.keys(), useHistory.getState().items);
  }, [installed, catalog, startApps]);

  // Aplikace z ostatních počítačů na účtu (Moje počítače) – také s mráčkem a na stránce Dříve nainstalované
  useLayoutEffect(() => {
    const elsewhere: Record<string, string[]> = {};
    for (const [id, device] of Object.entries(freshDevices(devices))) {
      if (id === deviceId) continue;
      for (const [source, packageId] of device.apps) {
        const entry = sourceIndex.get(sourceKey(source, packageId)) ?? catalog.get(packageId);
        if (!entry) continue;
        const names = (elsewhere[entry.id] ??= []);
        if (!names.includes(device.name)) names.push(device.name);
      }
    }
    useEverInstalled.getState().setElsewhere(elsewhere);
  }, [devices, deviceId, sourceIndex, catalog]);
}
