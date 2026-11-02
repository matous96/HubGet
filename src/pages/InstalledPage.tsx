import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PackageCollection } from "@/components/package/PackageCollection";
import { Button } from "@/components/ui/Button";
import { CollectionToolbar } from "@/components/ui/CollectionToolbar";
import { CardSkeletons, EmptyState, ErrorState, PageHeader } from "@/components/ui/States";
import { useInstallOrder, useInstalledItems, useUpdates } from "@/hooks/useInstalledItems";
import { useSortedPackages } from "@/hooks/usePackages";
import { useUrlState } from "@/hooks/useUrlState";
import { cn, normalize } from "@/lib/utils";
import { ORIGINS } from "@/services/managers";
import { AdminPendingPanel } from "@/components/package/AdminPendingPanel";
import { ListFailurePanel } from "@/components/package/ListFailurePanel";
import { OriginFilter, type OriginFilterValue } from "@/components/package/SourceFilter";
import { useAutoUpdates } from "@/store/autoUpdates";
import { useSelection } from "@/store/selection";
import { useSettings } from "@/store/settings";
import type { InstallOrigin } from "@/types";

type Filter = "all" | "updates";

/** Nainstalované balíčky s filtrem aktualizací, hromadnou aktualizací a řazením i podle data instalace. */
export function InstalledPage() {
  const { t } = useTranslation();
  const { items, isLoading, isError, refetch, isFetching } = useInstalledItems();
  const { updatable, pending: pendingUpdates, updateAll } = useUpdates();
  // Filtry jsou v adrese (?filter=updates&origin=steam&q=…): na záložku aktualizací odkazuje
  // postranní panel a po otevření detailu a návratu zpět zůstanou
  const [filter, setFilter] = useUrlState<Filter>("filter", "all", (v) => v === "updates");
  // Řadit → Nově nainstalované: nejnovější instalace nahoře (jen tady – jinde podle popularity)
  const byInstallTime = useInstallOrder();
  const recentFirst = useSettings((s) => s.sortMode) === "recent";
  const list = filter === "updates" ? updatable : items;
  const [text, setText] = useUrlState<string>("q", "");
  const [originFilter, setOriginFilter] = useUrlState<OriginFilterValue>("origin", "all", (v) => ORIGINS.some((o) => o.id === v));

  // Nastavení → Aktualizace balíčků: při otevření seznamu aktualizací je předem zaškrtnout
  const preselect = useAutoUpdates((s) => s.preselectUpdates);
  const selectMany = useSelection((s) => s.selectMany);
  const preselected = useRef(false);
  useEffect(() => {
    if (filter !== "updates") {
      preselected.current = false;
      return;
    }
    if (!preselect || preselected.current || !updatable.length) return;
    preselected.current = true;
    selectMany(updatable.map((i) => i.entry));
  }, [filter, preselect, updatable, selectMany]);

  // Počty podle původu instalace (pro filtr) v rámci zvolené záložky
  const originCounts = useMemo(() => {
    const counts: Partial<Record<InstallOrigin, number>> = {};
    for (const i of list) counts[i.pkg.origin] = (counts[i.pkg.origin] ?? 0) + 1;
    return counts;
  }, [list]);

  // Zdroj, který ve zvolené záložce nic nemá (Steam v Dostupných aktualizacích), se nepoužije –
  // jeho filtr by tam nebyl vidět a seznam by byl bez vysvětlení prázdný. Na Vše zase platí.
  const origin: OriginFilterValue = originFilter !== "all" && originCounts[originFilter] ? originFilter : "all";

  const entries = useMemo(() => {
    const q = normalize(text.trim());
    const shown = list.filter((i) => origin === "all" || i.pkg.origin === origin);
    return (recentFirst ? byInstallTime(shown) : shown)
      .map((i) => i.entry)
      .filter((e) => !q || normalize(e.name).includes(q) || normalize(e.id).includes(q));
  }, [list, origin, text, recentFirst, byInstallTime]);
  const sortedByMode = useSortedPackages(entries);
  const sorted = recentFirst ? entries : sortedByMode;

  const tabs: { id: Filter; label: string; count: number }[] = [
    // Jen zobrazené položky (bez programů nalezených jen na disku) – stejně jako filtr zdrojů a postranní panel
    { id: "all", label: t("installed.all"), count: items.length },
    { id: "updates", label: t("installed.updates"), count: updatable.length },
  ];

  return (
    <>
      <PageHeader
        title={t("installed.title")}
        subtitle={t("installed.subtitle")}
        actions={
          <>
            <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
              {t("installed.refresh")}
            </Button>
            <Button onClick={updateAll} disabled={pendingUpdates === 0}>
              {t("installed.updateAll")}
              {pendingUpdates > 0 && (
                <span className="rounded-full bg-white/25 px-1.5 text-[11px] leading-5">{pendingUpdates}</span>
              )}
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {/* Filtr: Vše / Dostupné aktualizace */}
        <div className="flex rounded-full border border-line bg-surface-2 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={filter === tab.id}
              onClick={() => setFilter(tab.id)}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors",
                filter === tab.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] leading-5 font-semibold",
                  tab.id === "updates" && tab.count > 0 ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted",
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("installed.filterPlaceholder")}
            className="h-9 w-52 rounded-full border border-line bg-surface pr-3 pl-8 text-sm outline-none placeholder:text-muted focus:border-accent/50"
          />
        </div>

        <div className="ml-auto">
          <CollectionToolbar recentSort />
        </div>
      </div>

      {/* Filtr podle původu instalace (WinGet: winget / msstore, Steam, Chocolatey, Scoop, Lokální) */}
      <div className="mb-5">
        <OriginFilter value={origin} onChange={setOriginFilter} counts={originCounts} />
      </div>

      {/* Správce nevrátil seznam – jeho aplikace chybí, i když nainstalované jsou */}
      {!isLoading && <ListFailurePanel onRetry={() => void refetch()} retrying={isFetching} />}

      {/* Aktualizace odložené kvůli právům správce – jedním potvrzením UAC */}
      {filter === "updates" && <AdminPendingPanel />}

      {isLoading ? (
        <CardSkeletons count={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : sorted.length === 0 ? (
        <EmptyState message={filter === "updates" && !text ? t("installed.noUpdates") : t("installed.empty")} />
      ) : (
        <PackageCollection packages={sorted} showUninstall />
      )}
    </>
  );
}
