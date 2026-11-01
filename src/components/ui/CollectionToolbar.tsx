import { LayoutGrid, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import type { SortMode, ViewMode } from "@/types";

/**
 * Přepínač zobrazení (mřížka / seznam) a řazení (popularita / název, s `recentSort`
 * i nově nainstalované – jen u nainstalovaných; jinde se takové řazení ukáže jako popularita).
 */
export function CollectionToolbar({ count, hideSort, recentSort }: { count?: number; hideSort?: boolean; recentSort?: boolean }) {
  const { t } = useTranslation();
  const { viewMode, setViewMode, sortMode: chosen, setSortMode } = useSettings();
  const sortMode: SortMode = chosen === "recent" && !recentSort ? "popularity" : chosen;

  const views: { id: ViewMode; icon: typeof List }[] = [
    { id: "grid", icon: LayoutGrid },
    { id: "list", icon: List },
  ];
  const sorts: SortMode[] = recentSort ? ["popularity", "name", "recent"] : ["popularity", "name"];

  return (
    <div className="flex flex-wrap items-center gap-3">
      {count !== undefined && (
        <span className="mr-auto text-sm text-muted">{t("categories.appsCount", { count })}</span>
      )}

      {/* Řazení – segmentový ovladač */}
      <div className={cn("flex items-center gap-2 text-xs text-muted", hideSort && "hidden")}>
        <span>{t("view.sortBy")}</span>
        <Segmented
          value={sortMode}
          onChange={setSortMode}
          options={sorts.map((s) => ({ value: s, label: t(`view.sort.${s}`) }))}
        />
      </div>

      {/* Zobrazení */}
      <div className="flex rounded-full border border-line bg-surface-2 p-0.5">
        {views.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={t(`view.${id}`)}
            aria-label={t(`view.${id}`)}
            aria-pressed={viewMode === id}
            onClick={() => setViewMode(id)}
            className={cn(
              "flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors",
              viewMode === id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

/** Obecný segmentový přepínač (použitý i v Nastavení). */
export function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div className="flex rounded-full border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors",
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
