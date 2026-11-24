/**
 * Akce instalace jedné aplikace s uloženými volbami (zdroj, verze, jako správce…).
 * Sdílí je tlačítko Instalovat, nabídka u tlačítka i kontextová nabídka karty.
 */
import { resolveInstallOptions } from "@/lib/installArgs";
import { canRepair } from "@/lib/repair";
import { isWebOnly } from "@/lib/webOnly";
import { getSource } from "@/services/managers";
import { installFlags, packageIdFor, updateOptionsFor, useInstallOptions } from "@/store/installOptions";
import { useJobs } from "@/store/jobs";
import type { CatalogEntry, InstallOptions, SourceId } from "@/types";
import { isUnmanagedOrigin } from "./useInstalledItems";
import { useEffectiveSource, usePackageState } from "./usePackages";

export function useInstallActions(entry: CatalogEntry, chosen?: SourceId) {
  const saved = useInstallOptions((s) => s.byApp[entry.id]);
  const enqueue = useJobs((s) => s.enqueue);
  const state = usePackageState(entry.id);
  // Výslovně zvolený zdroj (detail aplikace) > uložený v možnostech instalace > priorita z nastavení
  const source = useEffectiveSource(entry, chosen ?? saved?.source);
  const meta = source ? getSource(source.source) : undefined;
  // Uložená verze platí jen pro uložený zdroj
  const version = saved?.version && (!saved.source || saved.source === source?.source) ? saved.version : undefined;
  const flags = installFlags(saved);

  // Uložená varianta balíčku (jazyk, typ instalátoru) jen pro instalaci – aktualizace jde na nainstalovaný balíček
  const base = () => source && { appId: entry.id, appName: entry.name, source: source.source, packageId: source.packageId };
  const installBase = () => source && { ...base()!, packageId: packageIdFor(source, saved) };

  return {
    ...state,
    source,
    saved,
    /** Podporované volby zvoleného zdroje. */
    support: meta?.options,
    /**
     * Instalace s uloženými volbami; `extra` je přepíše jen pro tuto instalaci,
     * `track` = sledovat instalaci snímkem systému.
     */
    install: (extra?: InstallOptions, { track }: { track?: boolean } = {}) => {
      const job = installBase();
      // Části instalátoru (PATH, zástupci) a „bez restartu“ se převedou na parametry instalátoru
      if (job) enqueue({ ...job, kind: "install", version, options: resolveInstallOptions(entry, source, { ...flags, ...extra }), track });
    },
    update: () => {
      const job = base();
      // Uložené volby (jako správce, parametry, odinstalace předchozí verze…) platí i pro aktualizaci
      if (job) enqueue({ ...job, kind: "update", options: updateOptionsFor(entry.id, job, entry) });
    },
    /** Aplikaci jde opravit (lib/repair.ts). */
    canRepair: canRepair(state.installed),
    /** Oprava nainstalované aplikace (winget repair) – na nainstalovaný balíček, ne na zdroj z katalogu. */
    repair: () => {
      const pkg = state.installed;
      if (pkg && canRepair(pkg)) enqueue({ appId: entry.id, appName: entry.name, source: pkg.source, packageId: pkg.packageId, kind: "repair" });
    },
    /**
     * Uvolnit aplikaci (jako v iOS): odinstalovat, nastavení a data nechat – po Nainstalovat znovu
     * se vrátí. Jen aplikace z katalogu, kterou jde znovu nainstalovat (ne hra z obchodu, program
     * mimo správce nebo na disku, aplikace jen z webu výrobce).
     */
    canOffload:
      !!state.installed && entry.sources.length > 0 && !isWebOnly(entry) && !isUnmanagedOrigin(state.installed.origin) && !state.installed.diskLocation,
    offload: () => {
      const pkg = state.installed;
      if (pkg) enqueue({ appId: entry.id, appName: entry.name, source: pkg.source, packageId: pkg.packageId, kind: "uninstall", offload: true });
    },
    /** Stažení instalátoru bez instalace. */
    download: () => {
      const job = installBase();
      if (job && meta?.options.download) enqueue({ ...job, kind: "download", version, options: flags });
    },
  };
}
