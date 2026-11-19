import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Download, History } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/app/queryClient";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/States";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@/lib/utils";
import { compareVersions } from "@/lib/version";
import { getSource, managers } from "@/services/managers";
import { useJobs } from "@/store/jobs";
import type { CatalogEntry, InstalledPackage, PackageSource } from "@/types";

interface VersionPickerProps {
  entry: CatalogEntry;
  /** Zdroj, ze kterého se bude instalovat (zvolený nebo ten, přes který je aplikace nainstalovaná). */
  pkg: PackageSource;
  installed?: InstalledPackage;
  disabled?: boolean;
}

/**
 * Tlačítko „Starší verze“ s rozbalovací nabídkou dostupných verzí ve zvoleném
 * zdroji. Výběrem verze se zařadí instalace právě této verze (u nainstalované
 * aplikace přeinstalace na jinou verzi, tj. i návrat ke starší).
 */
export function VersionPicker({ entry, pkg, installed, disabled }: VersionPickerProps) {
  const { t } = useTranslation();
  const enqueue = useJobs((s) => s.enqueue);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Verze se načtou až při prvním otevření nabídky
  const { data: versions, isLoading } = useQuery({
    queryKey: queryKeys.versions(pkg.source, pkg.packageId),
    queryFn: () => managers[pkg.source].getVersions(pkg.packageId),
    enabled: open,
    staleTime: 10 * 60_000,
  });

  // Zavřít kliknutím mimo nabídku nebo klávesou Esc
  useDismiss(root, open, () => setOpen(false));

  const install = (version: string) => {
    setOpen(false);
    // Starší verze než nainstalovaná: správce downgrade odmítá („Už je nainstalovaná novější
    // verze“) – nejdřív odinstalovat, pak nainstalovat zvolenou verzi
    const older =
      installed?.source === pkg.source && !!installed.installedVersion && compareVersions(version, installed.installedVersion) < 0;
    enqueue({
      appId: entry.id,
      appName: entry.name,
      source: pkg.source,
      packageId: pkg.packageId,
      kind: "install",
      version,
      replaceInstalled: older,
    });
  };

  return (
    <div ref={root} className="relative">
      <Button
        variant="secondary"
        size="lg"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <History className="size-4" />
        {t("versions.button")}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 z-30 mt-2 w-72 origin-top-left overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
          >
            <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-muted">
              <span className={cn("size-2 rounded-full", getSource(pkg.source).dot)} />
              {t("versions.from", { source: getSource(pkg.source).label })}
            </p>

            {isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : !versions || versions.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-muted">{t("versions.none")}</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {versions.map((v, i) => {
                  const isInstalled = installed?.source === pkg.source && installed.installedVersion === v;
                  return (
                    <li key={v}>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={isInstalled}
                        onClick={() => install(v)}
                        className="group flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <span className="flex-1 font-mono tabular-nums">{v}</span>
                        {i === 0 && (
                          <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent">
                            {t("versions.latest")}
                          </span>
                        )}
                        {isInstalled ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-success">
                            <Check className="size-3.5" />
                            {t("versions.installed")}
                          </span>
                        ) : (
                          <Download className="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
