import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PageHeader } from "@/components/ui/States";
import { useCategoryCounts, useVisibleCategories } from "@/hooks/useCategories";
import { cn } from "@/lib/utils";

/** Mřížka kategorií s počtem aplikací (prázdné se neukazují). */
export function CategoriesPage() {
  const { t } = useTranslation();
  // Počet balíčků v každé kategorii (při zamčeném zdroji jen z něj)
  const counts = useCategoryCounts() ?? new Map<string, number>();
  const categories = useVisibleCategories();

  return (
    <>
      <PageHeader title={t("categories.title")} subtitle={t("categories.subtitle")} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {categories.map(({ id, icon: Icon }) => (
          // Neutrální dlaždice: ikona v rámečku, název, počet a velká obrysová ikona v rohu
          <Link
            key={id}
            to={`/categories/${id}`}
            className={cn(
              "group relative flex h-36 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card",
              "transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover",
            )}
          >
            {/* Velká ikona v pozadí */}
            <Icon
              aria-hidden
              className="absolute -right-4 -bottom-4 size-28 text-fg opacity-[0.06] transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
              strokeWidth={1.5}
            />
            <span className="flex size-11 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-line">
              <Icon className="size-6 text-accent" />
            </span>
            <div>
              <p className="font-display text-lg font-bold">{t(`categories.${id}`)}</p>
              <p className="text-xs text-muted">{t("categories.appsCount", { count: counts.get(id) ?? 0 })}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
