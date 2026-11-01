import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { ArchFilter, ArchHiddenNote } from "@/components/package/ArchFilter";
import { PackageCollection } from "@/components/package/PackageCollection";
import { matchesSource, SourceFilter, type SourceFilterValue } from "@/components/package/SourceFilter";
import { CollectionToolbar } from "@/components/ui/CollectionToolbar";
import { CardSkeletons, EmptyState, PageHeader } from "@/components/ui/States";
import { getCategory, inCategory } from "@/data/categories";
import { useArchFilter, useCatalog, useModeFilter, useSortedPackages } from "@/hooks/usePackages";
import { ARCH_LABEL } from "@/lib/arch";
import { getSource } from "@/services/managers";
import { useSourceScope } from "@/store/sourceLock";

/** Seznam aplikací v jedné kategorii s filtrem podle správce balíčků. */
/** Poslední filtr správců v kategoriích (do restartu aplikace). */
let lastSourceFilter: SourceFilterValue = "all";

export function CategoryPage() {
  const { t } = useTranslation();
  const { categoryId = "" } = useParams();
  const category = getCategory(categoryId);
  const { data, isLoading } = useCatalog();
  // Filtr se záměrně zachovává při přechodu mezi kategoriemi i po návratu z detailu (paměť relace)
  const [pickedFilter, setPickedFilter] = useState<SourceFilterValue>(() => lastSourceFilter);
  const setSourceFilter = (next: SourceFilterValue) => {
    lastSourceFilter = next;
    setPickedFilter(next);
  };
  // Zamčený zdroj (levý panel) má přednost – filtr stránky se pak neukazuje
  const { lock } = useSourceScope();
  const sourceFilter = lock ? "all" : pickedFilter;

  const modeFilter = useModeFilter();
  const { filter: archFilter, fits } = useArchFilter();
  const { packages, hiddenByArch } = useMemo(() => {
    if (!category) return { packages: [], hiddenByArch: 0 };
    const list = (data?.catalog.packages ?? []).filter(
      (p) => inCategory(p, category.id) && matchesSource(p.sources, sourceFilter),
    );
    // Běžný uživatel nevidí balíčky jen pro vývojáře – ledaže si vývojářského správce vybral ve filtru
    const visible = sourceFilter !== "all" && getSource(sourceFilter).group === "dev" ? list : modeFilter(list);
    const fitting = visible.filter(fits);
    return { packages: fitting, hiddenByArch: visible.length - fitting.length };
  }, [data, category, sourceFilter, modeFilter, fits]);
  const sorted = useSortedPackages(packages);

  if (!category) return <EmptyState message={t("categories.notFound")} />;
  const Icon = category.icon;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Icon className="size-8 text-accent" strokeWidth={2.25} />
            {t(`categories.${category.id}`)}
          </span>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {!lock && <SourceFilter value={sourceFilter} onChange={setSourceFilter} />}
        <ArchFilter />
        {/* Lišta má výchozí šířku podle obsahu – v úzkém okně se zalomí celá na další řádek, ne napůl */}
        <div className="grow basis-auto">
          <CollectionToolbar count={sorted.length} />
        </div>
      </div>
      {isLoading ? (
        <CardSkeletons />
      ) : sorted.length === 0 ? (
        <EmptyState
          message={
            hiddenByArch > 0 && archFilter !== "all"
              ? t("filters.emptyForArch", { arch: ARCH_LABEL[archFilter] })
              : sourceFilter === "all"
                ? t("categories.empty")
                : t("filters.emptyForSource", { source: getSource(sourceFilter).label })
          }
        />
      ) : (
        <>
          <ArchHiddenNote hidden={hiddenByArch} />
          <PackageCollection packages={sorted} />
        </>
      )}
    </>
  );
}
