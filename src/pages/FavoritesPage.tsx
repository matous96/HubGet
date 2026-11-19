import { BellRing, Heart } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PackageCollection } from "@/components/package/PackageCollection";
import { CollectionToolbar } from "@/components/ui/CollectionToolbar";
import { EmptyState, PageHeader } from "@/components/ui/States";
import { fallbackEntry, parseSourceKey, useCatalogIndex } from "@/hooks/usePackages";
import { useFavorites } from "@/store/favorites";
import { useWatchlist } from "@/store/watchlist";
import { inLockedSource, useSourceScope } from "@/store/sourceLock";
import type { CatalogEntry } from "@/types";

/**
 * Oblíbené aplikace (od naposledy přidané). Srdíčko se přidává
 * rychlou akcí na kartě nebo v profilu aplikace.
 */
export function FavoritesPage() {
  const { t } = useTranslation();
  const items = useFavorites((s) => s.items);
  const catalogIndex = useCatalogIndex();
  const { lock } = useSourceScope();

  // Balíčky mimo katalog se obnoví z id "zdroj:balíček"; neznámá id se vynechají.
  // Při zamčeném zdroji (levý panel) jen aplikace z něj.
  const entries = useMemo(
    () =>
      items
        .map((i) => {
          const fromCatalog = catalogIndex.get(i.appId);
          if (fromCatalog) return fromCatalog;
          const parsed = parseSourceKey(i.appId);
          return parsed ? fallbackEntry(parsed.source, parsed.packageId, i.name, i.version) : null;
        })
        .filter((e): e is CatalogEntry => e !== null && inLockedSource(e, lock)),
    [items, catalogIndex, lock],
  );

  // Hlídané aplikace (zvonek v detailu) – jen ty, které katalog zná
  const watchedIds = useWatchlist((s) => s.items);
  const watched = useMemo(
    () => Object.keys(watchedIds).map((id) => catalogIndex.get(id)).filter((e): e is CatalogEntry => !!e && inLockedSource(e, lock)),
    [watchedIds, catalogIndex, lock],
  );

  return (
    <>
      <PageHeader title={t("favorites.title")} subtitle={t("favorites.subtitle")} />
      {entries.length === 0 ? (
        watched.length === 0 && <EmptyState icon={Heart} message={t("favorites.empty")} />
      ) : (
        <>
          <div className="mb-5 flex justify-end">
            <CollectionToolbar hideSort />
          </div>
          <PackageCollection packages={entries} />
        </>
      )}
      {watched.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold">
            <BellRing className="size-5 text-accent" />
            {t("watch.title")}
          </h2>
          <p className="mb-4 text-sm text-muted">{t("watch.subtitle")}</p>
          <PackageCollection packages={watched} />
        </section>
      )}
    </>
  );
}
