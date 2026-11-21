/**
 * Převzít do správy: který program mimo správce balíčků (štítek Lokální) jde převzít pod
 * balíček wingetu z katalogu – spárovaný profil z katalogu (useInstalledEntries – podle názvu
 * v registru) s balíčkem z repozitáře wingetu. Ne aplikace jen z webu výrobce, ze Storu,
 * hry z herních obchodů, programy jen na disku ani rozbalené na ploše (ty mají vlastní cestu).
 */
import type { CatalogEntry, InstalledPackage, PackageSource } from "@/types";
import { isStoreId } from "./profile";
import { compareVersions } from "./version";
import { isWebOnly } from "./webOnly";

export function adoptionSource(pkg: InstalledPackage, entry: CatalogEntry | undefined): PackageSource | null {
  if (!entry || pkg.source !== "winget" || pkg.origin !== "local" || pkg.diskLocation || pkg.portable || pkg.adoptedFrom) return null;
  if (isWebOnly(entry)) return null;
  const winget = entry.sources.find((s) => s.source === "winget" && !/^(ARP|MSIX|DISK|EPIC)\\/i.test(s.packageId) && !isStoreId(s.packageId));
  // Jen se známou verzí programu, kterou balíček v katalogu má stejnou nebo novější: bez verze
  // by se aktualizace nikdy nenabídla a starší balíček bývá jiná řada („Windows SDK 10.0.26100“
  // spárované podle názvu s balíčkem SDK 10.0.17763) – převzetí by nic nepřineslo
  if (!winget || !pkg.installedVersion || !winget.version || compareVersions(winget.version, pkg.installedVersion) < 0) return null;
  return winget;
}
