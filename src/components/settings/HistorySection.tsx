import { CircleCheck, CircleSlash, CircleX, History, RotateCcw, SquareTerminal, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PackageIcon } from "@/components/package/PackageIcon";
import { SourceBadge } from "@/components/package/SourceBadge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { fallbackEntry, useCatalogIndex } from "@/hooks/usePackages";
import { cn } from "@/lib/utils";
import { useHistory, type HistoryEntry } from "@/store/history";
import { useJobs } from "@/store/jobs";
import { useSettings } from "@/store/settings";
import type { OperationKind } from "@/types";

type KindFilter = "all" | OperationKind | "failed";

/**
 * Kolik záznamů vykreslit najednou – historie jich drží až 500 (automatické aktualizace)
 * a každý má ikonu; starší přibývají tlačítkem.
 */
const PAGE = 100;

/**
 * Historie operací (sekce Nastavení, dřív samostatná stránka – /history na ni přesměruje):
 * dokončené, zrušené i neúspěšné operace seskupené po dnech.
 */
export function HistorySection() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { items, clear } = useHistory();
  const [filter, setFilter] = useState<KindFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(
    () => items.filter((i) => (filter === "all" ? true : filter === "failed" ? i.outcome !== "success" : i.kind === filter)),
    [items, filter],
  );

  // Skupiny podle dne (Dnes, Včera, datum) z vykreslených záznamů
  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const item of filtered.slice(0, shown)) {
      const key = new Date(item.finishedAt).toDateString();
      const group = map.get(key);
      if (group) group.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [filtered, shown]);

  const dayLabel = (key: string) => {
    const date = new Date(key);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (date.toDateString() === today.toDateString()) return t("history.today");
    if (date.toDateString() === yesterday.toDateString()) return t("history.yesterday");
    return date.toLocaleDateString(language, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };

  const filters: { id: KindFilter; label: string }[] = [
    { id: "all", label: t("history.filterAll") },
    { id: "install", label: t("history.kind.install") },
    { id: "update", label: t("history.kind.update") },
    { id: "uninstall", label: t("history.kind.uninstall") },
    { id: "download", label: t("history.kind.download") },
    { id: "failed", label: t("history.filterFailed") },
  ];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t("history.subtitle")}</p>
        <div className="flex gap-2">
          <Link
            to="/logs"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold transition-colors hover:bg-surface-2"
          >
            <SquareTerminal className="size-4" />
            {t("history.openLogs")}
          </Link>
          {items.length > 0 && (
            <Button variant="secondary" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-4" />
              {t("history.clear")}
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={History} message={t("history.empty")} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => {
                  setFilter(f.id);
                  setShown(PAGE);
                }}
                className={cn(
                  "h-8 cursor-pointer rounded-full border px-3.5 text-sm font-medium transition-colors",
                  filter === f.id
                    ? "border-accent/30 bg-accent/12 text-accent"
                    : "border-line bg-surface text-muted hover:text-fg",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <EmptyState icon={History} message={t("history.emptyFilter")} />
          ) : (
            groups.map(([key, entries]) => (
              <section key={key} className="mb-6">
                <h2 className="mb-2 px-1 text-xs font-semibold tracking-wider text-muted uppercase first-letter:uppercase">
                  {dayLabel(key)}
                </h2>
                <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                  {entries.map((entry) => (
                    <HistoryRow key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            ))
          )}
          {filtered.length > shown && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                {t("history.showOlder", { count: filtered.length - shown })}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        danger
        title={t("history.confirmClear")}
        confirmLabel={t("history.clear")}
        onConfirm={clear}
        onClose={() => setConfirmClear(false)}
      />
    </>
  );
}

const OUTCOME = {
  success: { Icon: CircleCheck, className: "text-success" },
  cancelled: { Icon: CircleSlash, className: "text-muted" },
  error: { Icon: CircleX, className: "text-danger" },
} as const;

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const catalogIndex = useCatalogIndex();
  const enqueue = useJobs((s) => s.enqueue);
  const running = useJobs((s) => !!s.jobs[entry.appId]);
  const app = catalogIndex.get(entry.appId) ?? fallbackEntry(entry.source, entry.packageId, entry.appName, entry.version ?? "");
  const { Icon, className } = OUTCOME[entry.outcome];
  const durationSec = Math.max(1, Math.round((Date.parse(entry.finishedAt) - Date.parse(entry.startedAt)) / 1000));

  return (
    <div className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <Link to={`/package/${encodeURIComponent(entry.appId)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <PackageIcon id={app.id} name={app.name} iconUrl={app.iconUrl} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold hover:underline">
            {entry.appName}
            {entry.version && <span className="ml-1.5 font-normal text-muted tabular-nums">{entry.version}</span>}
          </p>
          <p className="flex items-center gap-2 text-xs text-muted">
            {t(`history.kind.${entry.kind}`)}
            <SourceBadge source={entry.source} />
          </p>
        </div>
      </Link>

      {/* Výsledek; u chyby i její text */}
      <div className="flex w-56 min-w-0 items-center gap-2">
        <Icon className={cn("size-4 shrink-0", className)} />
        <div className="min-w-0">
          <p className={cn("text-sm font-medium", className)}>{t(`history.outcome.${entry.outcome}`)}</p>
          {entry.error && (
            <p className="truncate text-xs text-muted" title={entry.error}>
              {entry.error}
            </p>
          )}
        </div>
      </div>

      <div className="w-24 text-right text-xs text-muted tabular-nums">
        <p>{new Date(entry.finishedAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}</p>
        <p>{t("history.duration", { seconds: durationSec })}</p>
      </div>

      {/* Zopakovat neúspěšnou nebo zrušenou operaci */}
      <div className="w-9">
        {entry.outcome !== "success" && (
          <button
            type="button"
            disabled={running}
            aria-label={t("history.retry")}
            title={t("history.retry")}
            onClick={() =>
              enqueue({
                appId: entry.appId,
                appName: entry.appName,
                source: entry.source,
                packageId: entry.packageId,
                kind: entry.kind,
                version: entry.version,
                options: entry.options,
              })
            }
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-default disabled:opacity-40"
          >
            <RotateCcw className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
