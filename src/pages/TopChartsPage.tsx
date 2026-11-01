import { ArrowDownUp, Check, ChevronDown, Info, Star, TrendingUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchFilter } from "@/components/package/ArchFilter";
import { PackageRow } from "@/components/package/PackageRow";
import { ratingsEnabled, useRatingFormat, useRatingSummaries } from "@/components/package/RatingsSection";
import { matchesSource, SourceFilter, type SourceFilterValue } from "@/components/package/SourceFilter";
import { CardSkeletons, EmptyState, PageHeader } from "@/components/ui/States";
import { getSource, isSourceId } from "@/services/managers";
import { CATEGORIES, inCategory } from "@/data/categories";
import { useVisibleCategories } from "@/hooks/useCategories";
import { useDismiss } from "@/hooks/useDismiss";
import { useUrlState } from "@/hooks/useUrlState";
import { useArchFilter, useCatalog, useModeFilter } from "@/hooks/usePackages";
import { trendingScore } from "@/lib/trending";
import { cn, topN } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useSourceScope } from "@/store/sourceLock";
import type { CategoryId } from "@/types";

const LIMIT = 50;

/** Řazení žebříčku: skóre popularity z katalogu, hodnocení uživatelů, Skokani týdne. */
type TopSort = "popularity" | "rating" | "movers";

/** Skokani týdne: nejméně stažení za týden – menší přírůstek je šum, i když je procentuálně velký. */
const MIN_WEEKLY_DOWNLOADS = 100;
/**
 * Hodnocení: Bayesův průměr – k hodnocením aplikace se přičte tolik „průměrných“,
 * ať aplikace s jedním hodnocením 5 ★ nepředběhne desítky hodnocení 4,8 ★.
 */
const RATING_PRIOR = 5;

/**
 * Žebříček nejstahovanějších aplikací. Winget počty stažení nezveřejňuje,
 * výchozí pořadí proto vychází ze skóre popularity, které počítá data pipeline.
 * Rozbalovací nabídka vedle filtru správců přepne řazení na hodnocení uživatelů
 * HubGetu nebo na Skokany týdne (růst stažení z Chocolatey za 7 dní, katalog;
 * dokud ho katalog nemá, řadí se podle trendů jako záložka Trendy na Domů).
 */
export function TopChartsPage() {
  const { t } = useTranslation();
  const sortedCategories = useVisibleCategories();
  const { data, isLoading } = useCatalog();
  // Kategorie, správce a řazení v adrese – po otevření detailu a návratu zpět zůstanou
  const [category, setCategory] = useUrlState<CategoryId | "all">("category", "all", (v) => CATEGORIES.some((c) => c.id === v));
  const [pickedFilter, setSourceFilter] = useUrlState<SourceFilterValue>("source", "all", isSourceId);
  const [sort, setSort] = useUrlState<TopSort>("sort", "popularity", (v) => v === "rating" || v === "movers");
  // Zamčený zdroj (levý panel) má přednost – filtr stránky se pak neukazuje
  const { lock } = useSourceScope();
  const sourceFilter = lock ? "all" : pickedFilter;
  const summaries = useRatingSummaries();
  const ratingFormat = useRatingFormat();
  const language = useSettings((s) => s.language);

  const modeFilter = useModeFilter();
  const { fits: fitsArch } = useArchFilter();
  // Pořadí se počítá až po filtrech – „č. 1 ve Scoopu“ je nejpopulárnější aplikace dostupná ve Scoopu.
  const filtered = useMemo(() => {
    const list = (data?.catalog.packages ?? []).filter(
      (p) =>
        (category === "all" || inCategory(p, category)) &&
        matchesSource(p.sources, sourceFilter) &&
        fitsArch(p),
    );
    // Běžný uživatel nevidí balíčky jen pro vývojáře – ledaže si vývojářského správce vybral ve filtru
    return sourceFilter !== "all" && getSource(sourceFilter).group === "dev" ? list : modeFilter(list);
  }, [data, category, sourceFilter, modeFilter, fitsArch]);

  // Skokani týdne potřebují týden historie stažení v katalogu (data pipeline)
  const hasMovers = useMemo(() => (data?.catalog.packages ?? []).some((p) => p.weeklyGrowth !== undefined), [data]);

  const ranked = useMemo(() => {
    if (sort === "rating") {
      const rated = filtered.filter((p) => (summaries.get(p.id)?.count ?? 0) > 0);
      const mean = rated.length ? rated.reduce((sum, p) => sum + summaries.get(p.id)!.average, 0) / rated.length : 4;
      const score = (id: string) => {
        const s = summaries.get(id)!;
        return (s.average * s.count + mean * RATING_PRIOR) / (s.count + RATING_PRIOR);
      };
      return rated
        .sort((a, b) => score(b.id) - score(a.id) || summaries.get(b.id)!.count - summaries.get(a.id)!.count || b.popularity - a.popularity)
        .slice(0, LIMIT);
    }
    if (sort === "movers") {
      if (!hasMovers) {
        const now = Date.now();
        return topN(filtered, LIMIT, (p) => trendingScore(p, now));
      }
      return filtered
        .filter((p) => (p.weeklyDownloads ?? 0) >= MIN_WEEKLY_DOWNLOADS)
        .sort((a, b) => (b.weeklyGrowth ?? 0) - (a.weeklyGrowth ?? 0) || (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0))
        .slice(0, LIMIT);
    }
    return [...filtered].sort((a, b) => b.popularity - a.popularity).slice(0, LIMIT);
  }, [filtered, sort, summaries, hasMovers]);

  const sorts: TopSort[] = ratingsEnabled ? ["popularity", "rating", "movers"] : ["popularity", "movers"];
  const subtitle = sort === "movers" && !hasMovers ? t("top.subtitles.trending") : t(`top.subtitles.${sort}`);

  return (
    <>
      <PageHeader
        title={t("top.title")}
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SortMenu value={sort} options={sorts} onChange={setSort} />
            {!lock && <SourceFilter value={sourceFilter} onChange={setSourceFilter} />}
            <ArchFilter />
          </div>
        }
      />

      {/* Filtr kategorií */}
      <div className="no-scrollbar -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
        {(["all", ...sortedCategories.map((c) => c.id)] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
            className={cn(
              "h-8 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm font-medium transition-colors",
              category === id
                ? "border-accent/30 bg-accent/12 text-accent"
                : "border-line bg-surface text-muted hover:text-fg",
            )}
          >
            {id === "all" ? t("top.all") : t(`categories.${id}`)}
          </button>
        ))}
      </div>

      {/* Skokani týdne bez týdne historie v katalogu – řadí se zatím podle trendů */}
      {sort === "movers" && !hasMovers && (
        <p className="mb-5 flex items-start gap-2 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          {t("top.moversPending")}
        </p>
      )}

      {isLoading ? (
        <CardSkeletons count={6} />
      ) : ranked.length === 0 ? (
        <EmptyState
          message={
            sort === "rating"
              ? t("top.noRatings")
              : sourceFilter === "all"
                ? t("categories.empty")
                : t("filters.emptyForSource", { source: getSource(sourceFilter).label })
          }
        />
      ) : (
        // Sloupce jako žebříčky v App Store (pořadí čte shora dolů); jejich počet
        // podle šířky okna – sloupec má nejméně 28rem, na velkém monitoru jich je víc.
        <ol className="columns-[28rem] gap-x-8">
          {ranked.map((p, i) => {
            const rating = sort === "rating" ? summaries.get(p.id) : undefined;
            const growth = sort === "movers" && hasMovers ? p.weeklyGrowth : undefined;
            return (
              <li key={p.id} className="flex break-inside-avoid items-center gap-1 border-b border-line">
                <span className="w-9 shrink-0 text-center font-display text-lg font-bold text-muted tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <PackageRow entry={p} compact />
                </div>
                {/* Údaj, podle kterého se řadí */}
                {rating && (
                  <span
                    title={t("top.ratingCount", { count: rating.count })}
                    className="flex shrink-0 items-center gap-1 pr-2 text-sm font-semibold tabular-nums"
                  >
                    <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    {ratingFormat.average(rating.average)}
                    <span className="text-xs font-normal text-muted">({ratingFormat.count(rating.count)})</span>
                  </span>
                )}
                {growth !== undefined && (
                  <span
                    title={t("top.weeklyDownloads", { count: p.weeklyDownloads, formatted: (p.weeklyDownloads ?? 0).toLocaleString(language) })}
                    className="flex shrink-0 items-center gap-1 pr-2 text-sm font-semibold text-emerald-600 tabular-nums dark:text-emerald-400"
                  >
                    <TrendingUp className="size-3.5" />+{growth.toLocaleString(language, { maximumFractionDigits: growth < 10 ? 1 : 0 })} %
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** Rozbalovací nabídka řazení (vedle filtru správců v hlavičce). */
function SortMenu({ value, options, onChange }: { value: TopSort; options: TopSort[]; onChange: (sort: TopSort) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("top.sortLabel")}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors",
          value !== "popularity" ? "border-accent/30 bg-accent/12 text-accent" : "border-line bg-surface-2 text-fg hover:bg-surface-3",
        )}
      >
        <ArrowDownUp className={cn("size-4", value === "popularity" && "text-muted")} />
        {t(`top.sort.${value}`)}
        <ChevronDown className={cn("size-3.5 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div role="listbox" className="absolute top-full right-0 z-30 mt-2 w-72 rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={value === option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2",
                value === option && "bg-accent/12 hover:bg-accent/12",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", value === option && "font-semibold text-accent")}>{t(`top.sort.${option}`)}</span>
                <span className="block text-xs text-muted">{t(`top.sortHint.${option}`)}</span>
              </span>
              {value === option && <Check className="mt-0.5 size-4 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
