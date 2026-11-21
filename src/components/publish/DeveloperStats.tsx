/**
 * Statistiky vaší aplikace (Publikovat): kolikrát lidé aplikaci nainstalovali přes HubGet za 30,
 * 90 a 365 dní – z dobrovolných anonymních hlášení instalací (services/community.ts →
 * app_install_stats). Méně než 3 instalace se neukazují (nevydaly by jednotlivce). Plus odkaz
 * na Navržené aplikace – co lidé v katalogu postrádají.
 */
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Lightbulb, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PackageIcon } from "@/components/package/PackageIcon";
import { catalogSearchIndex, useCatalog } from "@/hooks/usePackages";
import { normalize } from "@/lib/utils";
import { communityAvailable, installStats } from "@/services/community";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";

export function DeveloperStats() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { data: catalog } = useCatalog();
  const [query, setQuery] = useState("");
  const [app, setApp] = useState<CatalogEntry | null>(null);
  const { data, isError, isFetching } = useQuery({
    queryKey: ["install-stats", app?.id],
    queryFn: () => installStats(app!.id),
    enabled: !!app && communityAvailable(),
    retry: false,
  });

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!catalog || q.length < 2) return [];
    const found: CatalogEntry[] = [];
    for (const record of catalogSearchIndex(catalog)) {
      if (record.name.includes(q) || record.idPublisher.includes(q)) found.push(record.entry);
    }
    return found.sort((a, b) => b.popularity - a.popularity).slice(0, 6);
  }, [catalog, query]);

  if (!communityAvailable()) return null;
  return (
    <section className="mb-10 rounded-3xl border border-line bg-surface p-7 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-display text-2xl font-bold">
        <BarChart3 className="size-6 text-accent" />
        {t("devStats.title")}
      </h2>
      <p className="mb-4 text-sm text-muted">{t("devStats.text")}</p>
      <div className="relative mb-4 max-w-md">
        <label className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface-2 px-4 focus-within:border-accent">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("devStats.search")}
            aria-label={t("devStats.search")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {results.length > 0 && (
          <ul role="listbox" aria-label={t("devStats.search")} className="absolute top-full right-0 left-0 z-20 mt-2 rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover">
            {results.map((entry) => (
              <li key={entry.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    setApp(entry);
                    setQuery("");
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={24} />
                  <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {app && (
        <div className="flex flex-wrap items-center gap-6">
          <span className="flex items-center gap-3">
            <PackageIcon id={app.id} name={app.name} iconUrl={app.iconUrl} size={40} />
            <span className="font-semibold">{app.name}</span>
          </span>
          {isError ? (
            <span className="text-sm text-muted">{t("devStats.unavailable")}</span>
          ) : (
            [30, 90, 365].map((days) => {
              const installs = data?.find((d) => d.days === days)?.installs;
              return (
                <span key={days} className="flex flex-col">
                  <span className="font-display text-2xl font-bold tabular-nums">
                    {isFetching ? "…" : installs != null ? installs.toLocaleString(language) : t("devStats.few")}
                  </span>
                  <span className="text-xs text-muted">{t("devStats.days", { count: days })}</span>
                </span>
              );
            })
          )}
        </div>
      )}
      <p className="mt-5 text-sm">
        <Link to="/requests" className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
          <Lightbulb className="size-4" />
          {t("devStats.requests")}
        </Link>
      </p>
    </section>
  );
}
