import type { MouseEvent } from "react";
import { Check, Download, ExternalLink, FolderOpen, Play, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useInstallActions } from "@/hooks/useInstallActions";
import { launchApp, useLaunchTarget } from "@/lib/launch";
import { isWebOnly, openDownloadPage } from "@/lib/webOnly";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry, InstalledPackage, SourceId } from "@/types";
import { JobProgress } from "./JobProgress";

interface PackageActionProps {
  entry: CatalogEntry;
  /** Výslovně zvolený zdroj (detail aplikace); jinak podle priority v nastavení. */
  source?: SourceId;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Hlavní akce aplikace jedním kliknutím:
 *  - běží úloha → živý průběh se zrušením,
 *  - nenainstalováno → Instalovat (ze zvoleného / preferovaného zdroje), aplikace jen z webu
 *    výrobce → Stáhnout z webu (oficiální stránka v prohlížeči; aktualizace se jí nenabízí),
 *  - existuje novější verze → Aktualizovat (přes zdroj, ze kterého je nainstalovaná),
 *  - nainstalováno a jde spustit → Otevřít (nabídka Start, EXE, Steam – lib/launch.ts),
 *    jde otevřít jen složka programu → Otevřít složku,
 *  - jinak → informace „Nainstalováno“.
 */
export function PackageAction({ entry, source, size = "sm", className }: PackageActionProps) {
  const { t } = useTranslation();
  // Instalace použije uložené možnosti instalace (zdroj, verze, jako správce…)
  const actions = useInstallActions(entry, source);
  const { status, job } = actions;
  const effective = actions.source;
  const canLaunch = !!useLaunchTarget(entry, actions.installed);

  if (job) return <JobProgress job={job} className={className} />;

  // Klik uvnitř karty nesmí zároveň otevřít detail.
  const run = (kind: "install" | "update") => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (kind === "install") actions.install();
    else actions.update();
  };

  const iconSize = size === "sm" ? "size-3.5" : "size-4";

  if (status === "available") {
    if (isWebOnly(entry)) return <WebDownloadButton entry={entry} size={size} className={className} />;
    return (
      <Button size={size} onClick={run("install")} disabled={!effective} className={className}>
        <Download className={iconSize} />
        {t("package.install")}
      </Button>
    );
  }

  if (status === "updatable" && !isWebOnly(entry)) {
    return (
      <Button size={size} onClick={run("update")} className={className}>
        <RefreshCw className={iconSize} />
        {t("package.update")}
      </Button>
    );
  }

  if (canLaunch) {
    // V detailu hlavní akce, na kartě decentně (Instalovat / Aktualizovat mají vyniknout)
    const variant = size === "lg" ? "primary" : "secondary";
    return <LaunchButton entry={entry} installed={actions.installed} size={size} variant={variant} className={className} />;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold text-success ${size === "sm" ? "text-xs" : "text-sm"} ${className ?? ""}`}
    >
      <Check className={iconSize} />
      {t("package.installed")}
    </span>
  );
}

/** Stáhnout z webu – aplikace jen z webu výrobce: otevře oficiální stránku ke stažení. */
function WebDownloadButton({ entry, size, className }: { entry: CatalogEntry; size: "sm" | "md" | "lg"; className?: string }) {
  const { t } = useTranslation();
  const open = (e: MouseEvent) => {
    // Klik uvnitř karty nesmí zároveň otevřít detail
    e.preventDefault();
    e.stopPropagation();
    openDownloadPage(entry);
  };
  return (
    <Button size={size} onClick={open} title={t("package.webOnlyNote", { name: entry.name, publisher: entry.publisher })} className={className}>
      <ExternalLink className={size === "sm" ? "size-3.5" : "size-4"} />
      {t("package.webDownload")}
    </Button>
  );
}

/**
 * Otevřít – spustí nainstalovanou aplikaci (položka nabídky Start, EXE, Steam), nebo otevře její složku.
 * Nic nevykreslí, pokud aplikaci otevřít nejde (knihovna bez složky, webová verze).
 */
export function LaunchButton({
  entry,
  installed,
  size = "sm",
  variant = "secondary",
  className,
}: {
  entry: CatalogEntry;
  installed: InstalledPackage | undefined;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const target = useLaunchTarget(entry, installed);
  if (!target) return null;

  const open = (e: MouseEvent) => {
    // Klik uvnitř karty nesmí zároveň otevřít detail
    e.preventDefault();
    e.stopPropagation();
    launchApp(target).then(
      () => toast("info", t("launch.starting", { name: entry.name })),
      (error: unknown) => toast("error", t("launch.failed", { name: entry.name, error: String(error) })),
    );
  };

  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  // Program, který spustit nejde (jen jeho složka) – otevře se složka v Průzkumníkovi
  if (target.kind === "folder") {
    return (
      <Button size={size} variant="secondary" onClick={open} className={className}>
        <FolderOpen className={iconSize} />
        {t("package.openFolder")}
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} onClick={open} title={target.kind === "start" ? target.app.name : undefined} className={className}>
      <Play className={iconSize} />
      {t("package.open")}
    </Button>
  );
}
