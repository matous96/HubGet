/**
 * Opuštěné aplikace (lib/abandoned.ts):
 *  - AbandonedPanel – nad seznamem Nainstalovaných: aplikace, které se nejspíš už nevyvíjejí,
 *    s důvodem a open-source náhradami z katalogu (jen těmi, které se samy vyvíjejí),
 *  - AbandonedNote – totéž v detailu aplikace.
 */
import { ChevronDown, Construction } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { InstalledItem } from "@/hooks/useInstalledItems";
import { useCatalog, useCatalogIndex } from "@/hooks/usePackages";
import { abandonedReason, STALE_COMMIT_YEARS, STALE_RELEASE_YEARS, type AbandonedReason } from "@/lib/abandoned";
import { openSourceAlternatives } from "@/lib/alternatives";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

function useReasonText() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const date = (iso: string) => new Date(iso).toLocaleDateString(language, { month: "numeric", year: "numeric" });
  return (reason: AbandonedReason) =>
    reason.kind === "archived"
      ? t("abandoned.archived")
      : reason.kind === "noCommits"
        ? t("abandoned.noCommits", { date: date(reason.since), count: STALE_COMMIT_YEARS })
        : t("abandoned.noRelease", { date: date(reason.since), count: STALE_RELEASE_YEARS });
}

/** Open-source náhrady, které se samy vyvíjejí (nejvýš 3). */
function useReplacements() {
  const { data } = useCatalog();
  const byId = useCatalogIndex();
  return (entry: CatalogEntry) =>
    data ? openSourceAlternatives(entry, data.catalog.packages, byId).filter((a) => !abandonedReason(a)).slice(0, 3) : [];
}

function Replacements({ list }: { list: CatalogEntry[] }) {
  const { t } = useTranslation();
  if (!list.length) return null;
  return (
    <span className="text-muted">
      {" · "}
      {t("abandoned.instead")}{" "}
      {list.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ", "}
          <Link to={detailUrl(a.id)} className="font-medium text-accent hover:underline">
            {a.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

export function AbandonedPanel({ items }: { items: InstalledItem[] }) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const replacements = useReplacements();
  const [open, setOpen] = useState(false);
  const abandoned = useMemo(
    () => items.flatMap((item) => {
      const reason = abandonedReason(item.entry);
      return reason ? [{ item, reason }] : [];
    }),
    [items],
  );
  if (!abandoned.length) return null;
  return (
    <section aria-label={t("abandoned.title", { count: abandoned.length })} className="mb-5 flex gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
      <Construction className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("abandoned.title", { count: abandoned.length })}</p>
            <p className="text-xs text-muted">{t("abandoned.text")}</p>
          </div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full px-3 text-sm font-medium text-accent hover:bg-accent/10"
          >
            {t(open ? "adopt.hide" : "adopt.show")}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
        {open && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {abandoned.map(({ item, reason }) => (
              <li key={`${item.pkg.source}:${item.pkg.packageId}`}>
                <Link to={detailUrl(item.entry.id)} className="font-medium hover:underline">
                  {item.entry.name}
                </Link>
                <span className="text-muted"> – {reasonText(reason)}</span>
                <Replacements list={replacements(item.entry)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Detail aplikace: aplikace se nejspíš už nevyvíjí. */
export function AbandonedNote({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const reasonText = useReasonText();
  const replacements = useReplacements();
  const reason = abandonedReason(entry);
  if (!reason) return null;
  return (
    <p className="flex max-w-2xl items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm">
      <Construction className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span>
        {t("abandoned.note", { reason: reasonText(reason) })}
        <Replacements list={replacements(entry)} />
      </span>
    </p>
  );
}
