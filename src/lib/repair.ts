/**
 * Oprava nainstalované aplikace (Opravit v nabídce aplikace → winget repair): instalátor MSI
 * a MSIX opraví Windows, instalátor EXE winget spustí s parametry opravy z manifestu. Jen
 * balíčky wingetu a programy ze seznamu Aplikace ve Windows – ne hry z herních obchodů
 * (soubory ověří jejich spouštěč), programy nalezené jen podle složky na disku a rozbalené
 * na ploše (nemají instalátor, který by je opravil) a ostatní správci balíčků (opravu neumí).
 */
import { isGameStore } from "@/services/managers";
import type { InstalledPackage } from "@/types";

export function canRepair(pkg: InstalledPackage | null | undefined): boolean {
  return !!pkg && pkg.source === "winget" && !isGameStore(pkg.origin) && !pkg.diskLocation && !pkg.portable;
}
