import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { queryKeys } from "@/app/queryClient";
import { DevSourceOverview } from "@/components/home/DevSourceOverview";
import { ArchFilter, ArchHiddenNote } from "@/components/package/ArchFilter";
import { PackageCollection } from "@/components/package/PackageCollection";
import { CollectionToolbar } from "@/components/ui/CollectionToolbar";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/States";
import { useDebounce } from "@/hooks/useDebounce";
import {
  catalogByNameKey,
  catalogSearchIndex,
  mergeRepoResults,
  nameKey,
  sourceKey,
  useArchFilter,
  useCatalog,
  useSourceIndex,
  type SearchRecord,
} from "@/hooks/usePackages";
import { ARCH_LABEL } from "@/lib/arch";
import { normalize } from "@/lib/utils";
import { isVerified } from "@/lib/verified";
import { isWebOnly } from "@/lib/webOnly";
import { getSource, managers, sortBySourceOrder } from "@/services/managers";
import { sourcePriority } from "@/store/settings";
import { inLockedSource, isDevLock, useSourceScope } from "@/store/sourceLock";
import type { CatalogEntry, PackageSource, RepoSearchResult } from "@/types";

/**
 * Relevance výsledku: shoda na začátku názvu > v názvu > v id/vydavateli > ve štítcích
 * a popisu. 0 = neodpovídá. Texty jsou předem normalizované (catalogSearchIndex).
 */
function score(record: SearchRecord, q: string): number {
  if (record.name.startsWith(q)) return 4;
  if (record.name.includes(q)) return 3;
  if (record.idPublisher.includes(q)) return 2;
  if (record.extra.includes(q)) return 1;
  return 0;
}

interface Match {
  p: CatalogEntry;
  s: number;
  verified: boolean;
}

/**
 * Pořadí výsledků: nejdřív shody v názvu, v nich ověřené aplikace (fajka) nahoře,
 * pak relevance a popularita. Shody jen v popisu zůstanou pod nimi (i tam ověřené
 * první) – jinak by třeba „obs“ ukázalo GitLab Runner nad Obsidianem.
 */
function byRelevance(a: Match, b: Match): number {
  const inName = (m: Match) => (m.s >= 3 ? 1 : 0);
  return inName(b) - inName(a) || Number(b.verified) - Number(a.verified) || b.s - a.s || b.p.popularity - a.p.popularity;
}

/** Výsledky hledání od všech správců v pořadí podle priority (stabilní funkce – výsledek se sdílí). */
function combineSearches(results: UseQueryResult<RepoSearchResult[]>[]) {
  return {
    repo: results.flatMap((r) => r.data ?? []),
    isFetching: results.some((r) => r.isFetching),
    // Pořadí jako dotazy – které správce se nepodařilo prohledat
    failed: results.map((r) => r.isError),
  };
}

/**
 * Výsledky vyhledávání. Katalog se filtruje okamžitě při každém stisku,
 * dotazy do správců balíčků (pomalejší) se posílají s krátkým zpožděním.
 */
export function SearchPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const debounced = useDebounce(query, 300);
  const { data: catalogData } = useCatalog();
  // Zamčený zdroj (levý panel): katalog i živé hledání jen v něm
  const { enabled, preferred, lock } = useSourceScope();

  // 1) Okamžité výsledky z katalogu
  const catalogResults = useMemo(() => {
    const q = normalize(query);
    if (!q || !catalogData) return [];
    const matches: Match[] = [];
    for (const record of catalogSearchIndex(catalogData)) {
      const s = score(record, q);
      if (s > 0 && inLockedSource(record.entry, lock)) matches.push({ p: record.entry, s, verified: isVerified(record.entry) });
    }
    return matches.sort(byRelevance).map((x) => x.p);
  }, [catalogData, query, lock]);

  // 2) Průběžné výsledky přímo od všech zapnutých správců (balíčky, které katalog nezná).
  // Každý správce zvlášť: rychlé (WinGet, Scoop ~0,1 s) se ukážou hned, nečekají na pomalé (Chocolatey ~3 s).
  const searched = sourcePriority(enabled, preferred);
  const { repo, isFetching, failed } = useQueries({
    queries: searched.map((id) => ({
      queryKey: [...queryKeys.search(debounced), id],
      queryFn: ({ signal }: { signal: AbortSignal }) => managers[id].search(debounced, signal),
      enabled: debounced.length >= 2,
      staleTime: 5 * 60_000,
      // Nepovedené hledání u jednoho správce neopakovat – výsledky ostatních stačí
      retry: false,
    })),
    combine: combineSearches,
  });

  // Výsledky, které patří k aplikaci z katalogu, vynecháme (katalog je ukazuje výše).
  // Balíček se stejným názvem jako aplikace v katalogu, jehož zdroj katalog ještě
  // nezná, se k ní připojí jako další zdroj – kromě aplikace jen z webu výrobce (knihovna
  // „houdini“ z npm není SideFX Houdini). Zbytek se sloučí do profilů podle názvu:
  // stejný název = jeden profil, jiný název = samostatný profil.
  const sourceIndex = useSourceIndex();
  const { filter: archFilter, fits } = useArchFilter();
  const { shownCatalog, repoResults, hiddenByArch } = useMemo(() => {
    const all = catalogData?.catalog.packages ?? [];
    const byName = catalogData ? catalogByNameKey(catalogData) : new Map<string, CatalogEntry>();
    const extra = new Map<string, PackageSource[]>();
    const rest: RepoSearchResult[] = [];
    for (const r of repo) {
      if (sourceIndex.has(sourceKey(r.source, r.packageId))) continue;
      const named = byName.get(nameKey(r.name));
      const entry = named && !isWebOnly(named) ? named : undefined;
      const known = entry && [...entry.sources, ...(extra.get(entry.id) ?? [])].some((s) => s.source === r.source);
      if (entry && !known) extra.set(entry.id, [...(extra.get(entry.id) ?? []), { source: r.source, packageId: r.packageId, version: r.version }]);
      else rest.push(r);
    }
    const withExtra = (e: CatalogEntry) =>
      extra.has(e.id) ? { ...e, sources: sortBySourceOrder([...e.sources, ...extra.get(e.id)!]) } : e;
    // Aplikace z katalogu, ke které se připojil balíček, ale sama dotazu neodpovídala (shoda jen v id balíčku)
    const added = all.filter((p) => extra.has(p.id) && !catalogResults.some((e) => e.id === p.id));
    // Filtr platformy: verze pro jiné procesory (např. „Discord.Discord.arm64“) skrýt, ale spočítat
    const catalogAll = [...catalogResults, ...added].map(withExtra);
    const repoAll = mergeRepoResults(rest);
    const shownCatalog = catalogAll.filter(fits);
    const repoResults = repoAll.filter(fits);
    const hiddenByArch = catalogAll.length + repoAll.length - shownCatalog.length - repoResults.length;
    return { shownCatalog, repoResults, hiddenByArch };
  }, [repo, sourceIndex, catalogData, catalogResults, fits]);

  if (!query) {
    // Zámek na správce pro vývojáře: místo prázdné stránky jeho přehled a oblíbené balíčky
    if (isDevLock(lock)) return <DevSourceOverview source={lock} />;
    return (
      <>
        <PageHeader title={t("search.title")} />
        <EmptyState message={t("search.typeToSearch")} />
      </>
    );
  }

  const searchingRepo = isFetching || query !== debounced;
  const nothing = shownCatalog.length === 0 && repoResults.length === 0 && !searchingRepo;
  // Správci, u kterých hledání selhalo (neodpovídá, nečekaný výstup) – výsledky ostatních platí dál
  const failedNames = searched.filter((_, i) => failed[i]).map((id) => getSource(id).label);
  const failedNote = failedNames.length > 0 && !searchingRepo && (
    <p role="status" className="mb-4 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
      <AlertTriangle className="size-4 shrink-0" />
      {t("managerError.searchFailed", { names: failedNames.join(", ") })}
    </p>
  );

  return (
    <>
      <PageHeader title={t("search.resultsFor", { query })} actions={<ArchFilter />} />
      {failedNote}
      {!nothing && <ArchHiddenNote hidden={hiddenByArch} />}
      {nothing ? (
        <EmptyState
          message={hiddenByArch > 0 && archFilter !== "all" ? t("filters.emptyForArch", { arch: ARCH_LABEL[archFilter] }) : t("search.empty")}
        />
      ) : (
        <>
          {shownCatalog.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="font-display text-lg font-bold">{t("search.fromCatalog")}</h2>
                <CollectionToolbar />
              </div>
              <PackageCollection packages={shownCatalog} />
            </section>
          )}

          <section>
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
              {t("search.fromRepo")}
              {searchingRepo && <Spinner className="size-4" />}
            </h2>
            {searchingRepo && repoResults.length === 0 ? (
              <p className="text-sm text-muted">{t("search.searchingRepo")}</p>
            ) : (
              repoResults.length > 0 && <PackageCollection packages={repoResults} />
            )}
          </section>
        </>
      )}
    </>
  );
}
