import { Clock, RefreshCw, RefreshCwOff, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PackageCollection } from "@/components/package/PackageCollection";
import { Button } from "@/components/ui/Button";
import { CollectionToolbar } from "@/components/ui/CollectionToolbar";
import { CardSkeletons, EmptyState, ErrorState, PageHeader } from "@/components/ui/States";
import { UNUSED_DAYS, useUnusedApps } from "@/hooks/useAppUsage";
import { useInstallOrder, useInstalledItems, useUpdates } from "@/hooks/useInstalledItems";
import { useSortedPackages } from "@/hooks/usePackages";
import { useSecurityUpdateIds } from "@/hooks/useSecurityUpdates";
import { useUrlState } from "@/hooks/useUrlState";
import { isTauri } from "@/lib/tauri";
import { cn, formatSizeText, normalize } from "@/lib/utils";
import { compareVersions } from "@/lib/version";
import { ORIGINS } from "@/services/managers";
import { AdminPendingPanel } from "@/components/package/AdminPendingPanel";
import { ListFailurePanel } from "@/components/package/ListFailurePanel";
import { DuplicatesPanel, EndOfLifePanel } from "@/components/package/InstalledNotices";
import { AdoptPanel } from "@/components/package/AdoptPanel";
import { AbandonedPanel } from "@/components/package/AbandonedNotice";
import { SELF_UPDATE_GRACE_DAYS } from "@/data/selfUpdating";
import type { NoteTone } from "@/components/package/PackageCard";
import { VulnerablePanel } from "@/components/package/VulnerabilityWatcher";
import { RecentlyUpdated } from "@/components/package/RecentlyUpdated";
import { OriginFilter, type OriginFilterValue } from "@/components/package/SourceFilter";
import { useAutoUpdates } from "@/store/autoUpdates";
import { problemShare, reliabilityWarning, useReliability } from "@/store/reliability";
import { useSelection } from "@/store/selection";
import { useSettings } from "@/store/settings";
import type { InstallOrigin } from "@/types";
import { AfterBatchSelect, FailedRetryBanner } from "@/components/package/UpdateFixes";
import { ScheduledInstallsBanner } from "@/components/package/ScheduleInstall";
import { useUpdatesOverview } from "@/components/package/UpdatesOverviewDialog";

type Filter = "all" | "updates" | "unused";

/** Nainstalované balíčky s filtrem aktualizací, hromadnou aktualizací a řazením i podle data instalace. */
export function InstalledPage() {
  const { t } = useTranslation();
  const { items, isLoading, isError, refetch, isFetching } = useInstalledItems();
  // Aplikace, které se aktualizují samy a čekají na lhůtu (pin „self“ s datem)
  const selfWaiting = useMemo(() => items.filter((i) => i.pkg.pin === "self" && i.pkg.pinUntil), [items]);
  const { updatable, pending: pendingUpdates, updateAll, updateItems } = useUpdates();
  // Aktualizace, které opravují bezpečnostní chybu – první v seznamu, se štítkem a vlastním tlačítkem
  const securityIds = useSecurityUpdateIds(updatable);
  const securityItems = useMemo(() => updatable.filter((i) => securityIds.has(i.entry.id)), [updatable, securityIds]);
  // Spolehlivost verzí od komunity (store/reliability.ts) – jen se zapnutým sdílením
  const community = useAutoUpdates((s) => s.communityReliability);
  const reliability = useReliability((s) => s.data);
  // Filtry jsou v adrese (?filter=updates&origin=steam&q=…): na záložku aktualizací odkazuje
  // postranní panel a po otevření detailu a návratu zpět zůstanou
  const [filter, setFilter] = useUrlState<Filter>("filter", "all", (v) => v === "updates" || v === "unused");
  // Nepoužívané aplikace (záznamy Windows o spuštění) – jen v desktopové aplikaci
  const { unused, notes, sizes, unusedSize, isLoading: usageLoading } = useUnusedApps(items, isTauri());
  // Řadit → Nově nainstalované: nejnovější instalace nahoře (jen tady – jinde podle popularity)
  const byInstallTime = useInstallOrder();
  const sortMode = useSettings((s) => s.sortMode);
  const language = useSettings((s) => s.language);
  const recentFirst = sortMode === "recent";
  const largestFirst = sortMode === "size" && isTauri();
  const unusedItems = useMemo(() => unused.map((u) => u.item), [unused]);
  // Co je nového u dostupných aktualizací – poznámky k verzi z katalogu, pokud patří k nabízené verzi
  const whatsNew = useMemo(() => {
    const notes = new Map<string, string>();
    for (const { pkg, entry } of updatable) {
      const current = !!entry.releaseNotes && !!pkg.availableVersion && !!entry.latestVersion && compareVersions(entry.latestVersion, pkg.availableVersion) === 0;
      const text = current ? entry.releaseNotes!.replace(/\s+/g, " ").trim().slice(0, 240) : "";
      const warning = community ? reliabilityWarning(reliability, pkg) : undefined;
      if (securityIds.has(entry.id)) notes.set(entry.id, text ? t("security.note", { text }) : t("security.noteShort"));
      else if (warning) notes.set(entry.id, t("reliability.note", { percent: Math.round(problemShare(warning) * 100), count: warning.reports }));
      else if (text) notes.set(entry.id, t("updates.whatsNew", { text }));
    }
    return notes;
  }, [updatable, securityIds, community, reliability, t]);
  // Bezpečnostní oprava červeně, problémy hlášené komunitou oranžově, ostatní poznámky jako informace
  const noteTones = useMemo(() => {
    const tones = new Map<string, NoteTone>([...securityIds].map((id) => [id, "danger"]));
    if (community) for (const { pkg, entry } of updatable) if (!tones.has(entry.id) && reliabilityWarning(reliability, pkg)) tones.set(entry.id, "warning");
    return tones;
  }, [securityIds, community, reliability, updatable]);
  const list = filter === "updates" ? updatable : filter === "unused" ? unusedItems : items;
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
  // Nepoužívané zůstanou od nejdéle nespuštěných
  const bySize = useMemo(
    () => (largestFirst ? [...entries].sort((a, b) => (sizes.get(b.id) ?? -1) - (sizes.get(a.id) ?? -1)) : entries),
    [largestFirst, entries, sizes],
  );
  const ordered = largestFirst ? bySize : recentFirst || filter === "unused" ? entries : sortedByMode;
  // Dostupné aktualizace: bezpečnostní nahoře (jinak v pořadí podle řazení)
  const sorted = useMemo(
    () => (filter === "updates" && securityIds.size ? [...ordered.filter((e) => securityIds.has(e.id)), ...ordered.filter((e) => !securityIds.has(e.id))] : ordered),
    [filter, ordered, securityIds],
  );

  const tabs: { id: Filter; label: string; count: number }[] = [
    // Jen zobrazené položky (bez programů nalezených jen na disku) – stejně jako filtr zdrojů a postranní panel
    { id: "all", label: t("installed.all"), count: items.length },
    { id: "updates", label: t("installed.updates"), count: updatable.length },
    ...(isTauri() ? [{ id: "unused" as const, label: t("installed.unused"), count: unused.length }] : []),
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
            {/* Po dokončení dávky uspat / vypnout počítač */}
            <AfterBatchSelect />
            <Button onClick={() => (useAutoUpdates.getState().overviewBeforeUpdateAll ? useUpdatesOverview.getState().show() : void updateAll())} disabled={pendingUpdates === 0}>
              {t("installed.updateAll")}
              {pendingUpdates > 0 && (
                <span className="rounded-full bg-white/25 px-1.5 text-[11px] leading-5">{pendingUpdates}</span>
              )}
            </Button>
          </>
        }
      />

      {/* Poslední dávka měla chyby – zkusit je znovu s opravou */}
      <FailedRetryBanner />
      {/* Naplánované instalace (Nainstalovat později…) – kdy se spustí, zrušení */}
      <ScheduledInstallsBanner />

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
            aria-label={t("installed.filterPlaceholder")}
            className="h-9 w-52 rounded-full border border-line bg-surface pr-3 pl-8 text-sm outline-none placeholder:text-muted focus:border-accent/50"
          />
        </div>

        <div className="ml-auto">
          <CollectionToolbar recentSort sizeSort={isTauri()} />
        </div>
      </div>

      {/* Filtr podle původu instalace (WinGet: winget / msstore, Steam, Chocolatey, Scoop, Lokální) */}
      <div className="mb-5">
        <OriginFilter value={origin} onChange={setOriginFilter} counts={originCounts} />
      </div>

      {/* Správce nevrátil seznam – jeho aplikace chybí, i když nainstalované jsou */}
      {!isLoading && <ListFailurePanel onRetry={() => void refetch()} retrying={isFetching} />}

      {/* Runtime bez bezpečnostních oprav (endoflife.date) a aplikace nainstalované dvakrát */}
      {filter === "all" && !isLoading && (
        <>
          <EndOfLifePanel items={items} />
          <DuplicatesPanel items={items} />
          <VulnerablePanel items={items} />
          {/* Programy z webu výrobce, které jsou i ve WinGetu – převzít do správy */}
          <AdoptPanel items={items} />
          {/* Aplikace, které se nejspíš už nevyvíjejí (archivovaný repozitář, dlouho bez změn) */}
          <AbandonedPanel items={items} />
        </>
      )}

      {/* Aktualizace odložené kvůli právům správce – jedním potvrzením UAC */}
      {filter === "updates" && <AdminPendingPanel />}

      {/* Aplikace s vlastním aktualizátorem (Chrome, Steam…) – do počtu aktualizací se nepočítají,
          dokud nevyprší lhůta (store/updateRules.ts); v detailu aplikace jde nabídnout hned */}
      {filter === "updates" && selfWaiting.length > 0 && !text && (
        <p className="mb-5 flex items-start gap-2 text-sm text-muted">
          <RefreshCwOff className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("selfUpdating.waiting", { count: selfWaiting.length, days: SELF_UPDATE_GRACE_DAYS, names: selfWaiting.slice(0, 5).map((i) => i.entry.name).join(", ") + (selfWaiting.length > 5 ? "…" : "") })}
          </span>
        </p>
      )}

      {/* Bezpečnostní aktualizace – opravují známé chyby, vyplatí se nainstalovat hned */}
      {filter === "updates" && securityItems.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-danger/30 bg-danger/8 px-4 py-3">
          <ShieldAlert className="size-5 shrink-0 text-danger" />
          <p className="min-w-0 flex-1 text-sm">
            <strong>{t("security.panelTitle", { count: securityItems.length })}</strong>
            <span className="text-muted"> {securityItems.slice(0, 4).map((i) => i.entry.name).join(", ")}{securityItems.length > 4 ? "…" : ""}</span>
          </p>
          <Button variant="secondary" onClick={() => void updateItems(securityItems)}>
            {t("security.updateThese", { count: securityItems.length })}
          </Button>
        </div>
      )}

      {/* Nepoužívané: co to znamená a výběr všech k hromadné odinstalaci (lišta dole) */}
      {filter === "unused" && sorted.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
          <Clock className="size-5 shrink-0 text-amber-500" />
          <p className="min-w-0 flex-1 text-sm text-muted">{t("unused.intro", { days: UNUSED_DAYS })}
            {unusedSize > 0 && <strong className="ml-1 text-fg">{t("unused.totalSize", { size: formatSizeText(unusedSize, language) })}</strong>}</p>
          <Button variant="secondary" onClick={() => selectMany(sorted)}>
            {t("unused.selectAll")}
          </Button>
        </div>
      )}

      {isLoading || (filter === "unused" && usageLoading) ? (
        <CardSkeletons count={6} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : sorted.length === 0 ? (
        <EmptyState
          message={
            filter === "updates" && !text ? t("installed.noUpdates") : filter === "unused" && !text ? t("unused.none", { days: UNUSED_DAYS }) : t("installed.empty")
          }
        />
      ) : (
        <PackageCollection
          packages={sorted}
          showUninstall
          notes={filter === "unused" ? notes : filter === "updates" ? whatsNew : undefined}
          noteTone={filter === "updates" ? "info" : "warning"}
          noteTones={filter === "updates" ? noteTones : undefined}
        />
      )}

      {/* Nedávno aktualizováno (jako v App Storu) – i když je všechno aktuální */}
      {filter === "updates" && !isLoading && !text && <RecentlyUpdated />}
    </>
  );
}
