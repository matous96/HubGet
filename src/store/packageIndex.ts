/**
 * Hotové indexy pro karty a řádky seznamů: nainstalované (id aplikace → balíček),
 * katalog (id → profil) a položky nabídky Start. Spočítá je jednou komponenta
 * PackageIndexSync v rozvržení okna; karta si z nich vybere jen svůj záznam jedním
 * odběrem a překreslí se jen při jeho změně.
 *
 * Dřív si každá karta skládala dotazy na katalog, nainstalované, pravidla aktualizací
 * a párování sama – kolem 12 dotazů a 50 odběrů stavu na kartu. Při posouvání dlouhých
 * seznamů to zdržovalo připojení každého řádku (úlohy ~55 ms) a po minutě (zastaralá
 * data) každý nově připojený řádek spouštěl nové načtení nainstalovaných aplikací.
 */
import { create } from "zustand";
import type { StartApp } from "@/lib/launch";
import type { CatalogEntry, InstalledPackage } from "@/types";

interface PackageIndexState {
  installed: ReadonlyMap<string, InstalledPackage>;
  catalog: ReadonlyMap<string, CatalogEntry>;
  /** Položky nabídky Start (tlačítko Otevřít, ikony nainstalovaných); undefined = ještě nenačtené. */
  startApps: StartApp[] | undefined;
}

export const usePackageIndex = create<PackageIndexState>(() => ({
  installed: new Map(),
  catalog: new Map(),
  startApps: undefined,
}));
