import { Trash2 } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { usePackageState } from "@/hooks/usePackages";
import { isWebOnly } from "@/lib/webOnly";
import { getSource } from "@/services/managers";
import { useJobs } from "@/store/jobs";
import type { CatalogEntry } from "@/types";

interface UninstallButtonProps {
  entry: CatalogEntry;
  /** "icon" = jen ikona (seznamy), "full" = tlačítko s popiskem (detail). */
  variant?: "icon" | "full";
}

/**
 * Odinstalace s potvrzením. Zobrazí se jen u nainstalovaného balíčku bez běžící
 * úlohy – ne u programu nalezeného jen podle složky na disku (žádný správce ani
 * záznam v registru ho odinstalovat neumí). Výjimkou je program rozbalený na ploše
 * (Tor Browser): backend jeho složku přesune do Koše. Aplikaci jen z webu výrobce
 * (DaVinci Resolve) HubGet nespravuje – odinstaluje se ve Windows.
 */
export function UninstallButton({ entry, variant = "icon" }: UninstallButtonProps) {
  const { t } = useTranslation();
  const { installed, job } = usePackageState(entry.id);
  const enqueue = useJobs((s) => s.enqueue);
  const [confirming, setConfirming] = useState(false);

  if (!installed || job || isWebOnly(entry) || (installed.diskLocation && !installed.portable)) return null;

  const open = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(true);
  };

  return (
    <>
      {variant === "icon" ? (
        <IconButton
          aria-label={t("package.uninstall")}
          title={t("package.uninstall")}
          onClick={open}
          className="relative z-10 hover:text-danger"
        >
          <Trash2 className="size-4" />
        </IconButton>
      ) : (
        <Button variant="danger" size="lg" onClick={open}>
          <Trash2 className="size-4" />
          {t("package.uninstall")}
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        danger
        title={
          installed.portable
            ? t("package.confirmPortableUninstall", { name: entry.name, folder: installed.diskLocation })
            : t("package.confirmUninstall", { name: entry.name, source: getSource(installed.source).label })
        }
        confirmLabel={t("package.uninstall")}
        // Odinstalace vždy přes správce, kterým byla aplikace nainstalována
        onConfirm={() =>
          enqueue({
            appId: entry.id,
            appName: entry.name,
            source: installed.source,
            packageId: installed.packageId,
            kind: "uninstall",
          })
        }
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
