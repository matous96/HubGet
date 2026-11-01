/**
 * Lišta hromadných akcí dole v okně – objeví se, jakmile je zaškrtnutá
 * aspoň jedna aplikace (store/selection.ts). Instalace a aktualizace se
 * zařadí do fronty a běží na pozadí jedna po druhé (store/jobs.ts);
 * nainstalované a už zařazené aplikace se přeskočí.
 */
import { Download, PackagePlus, RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { pickSource, useInstalledIndex } from "@/hooks/usePackages";
import { isWebOnly } from "@/lib/webOnly";
import { useBundle } from "@/store/bundle";
import { updateOptionsFor } from "@/store/installOptions";
import { useBusyAppIds, useJobs } from "@/store/jobs";
import { useSelection } from "@/store/selection";
import { useSourceScope } from "@/store/sourceLock";
import { useToasts } from "@/store/toasts";

export function SelectionBar() {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const { items, clear } = useSelection();
  const busy = useBusyAppIds();
  const enqueue = useJobs((s) => s.enqueue);
  const addToBundle = useBundle((s) => s.add);
  const { enabled, preferred } = useSourceScope();
  const installedIndex = useInstalledIndex();

  const selected = Object.values(items);
  const free = selected.filter((e) => !busy.has(e.id));
  // Co se s výběrem dá udělat: nainstalovat chybějící, aktualizovat zastaralé
  const toInstall = free.filter((e) => !installedIndex.has(e.id) && pickSource(e, enabled, preferred));
  // Aplikaci jen z webu výrobce HubGet neaktualizuje (ani do sady nepatří – nemá zdroj)
  const toUpdate = free.filter((e) => !isWebOnly(e) && installedIndex.get(e.id)?.availableVersion);

  const installAll = () => {
    for (const e of toInstall) {
      const source = pickSource(e, enabled, preferred)!;
      enqueue({ appId: e.id, appName: e.name, source: source.source, packageId: source.packageId, kind: "install" });
    }
    toast("success", t("bundles.queued", { count: toInstall.length }));
    clear();
  };

  const updateAll = () => {
    for (const e of toUpdate) {
      // Aktualizace přes správce a id, pod kterým je aplikace nainstalovaná
      const pkg = installedIndex.get(e.id)!;
      enqueue({ appId: e.id, appName: e.name, source: pkg.source, packageId: pkg.packageId, kind: "update", options: updateOptionsFor(e.id, pkg, e) });
    }
    toast("success", t("selection.updatesQueued", { count: toUpdate.length }));
    clear();
  };

  const toBundle = () => {
    let added = 0;
    for (const e of selected) {
      if (isWebOnly(e)) continue;
      const pkg = installedIndex.get(e.id);
      const source = pkg ? { source: pkg.source, packageId: pkg.packageId } : pickSource(e, enabled, preferred);
      if (!source) continue;
      addToBundle({ appId: e.id, name: e.name, source: source.source, packageId: source.packageId });
      added++;
    }
    toast("success", t("selection.addedToBundle", { count: added }));
    clear();
  };

  const button =
    "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:cursor-default disabled:opacity-40";

  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          role="toolbar"
          aria-label={t("selection.toolbar")}
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface/95 py-1.5 pr-1.5 pl-5 shadow-card-hover backdrop-blur"
        >
          <span className="mr-2 text-sm font-semibold tabular-nums">{t("selection.count", { count: selected.length })}</span>
          <button type="button" disabled={!toInstall.length} onClick={installAll} className={`${button} bg-accent text-accent-fg hover:brightness-110`}>
            <Download className="size-4" />
            {t("selection.install", { count: toInstall.length })}
          </button>
          <button type="button" disabled={!toUpdate.length} onClick={updateAll} className={`${button} bg-surface-2 hover:bg-surface-3`}>
            <RefreshCw className="size-4" />
            {t("selection.update", { count: toUpdate.length })}
          </button>
          <button type="button" onClick={toBundle} className={`${button} bg-surface-2 hover:bg-surface-3`}>
            <PackagePlus className="size-4" />
            {t("selection.toBundle")}
          </button>
          <button
            type="button"
            onClick={clear}
            aria-label={t("selection.clear")}
            title={t("selection.clear")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
