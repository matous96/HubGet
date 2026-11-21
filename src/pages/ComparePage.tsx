/**
 * Porovnat aplikace (/compare): až COMPARE_MAX aplikací z katalogu vedle sebe – hodnocení,
 * licence, poslední verze a vydání, velikost instalátoru a místo na disku, architektury
 * (ARM64), minimální Windows, zdroje instalace, hvězdy na GitHubu a odkazy. Nejlepší hodnota
 * v řádku je vyznačená (lib/compare.ts). Aplikace se přidávají z nabídky aplikace (pravé
 * tlačítko), z lišty hromadného výběru nebo hledáním přímo tady.
 */
import { Check, Columns3, ExternalLink, Minus, Plus, Search, Trophy, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PackageAction } from "@/components/package/PackageAction";
import { PackageIcon } from "@/components/package/PackageIcon";
import { useRatingSummaries } from "@/components/package/RatingsSection";
import { VerifiedBadge } from "@/components/package/VerifiedBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState, PageHeader } from "@/components/ui/States";
import { Stars } from "@/components/ui/Stars";
import { catalogSearchIndex, useCatalog, useCatalogIndex, useInstalledIndex } from "@/hooks/usePackages";
import { bestIndex, COMPARE_MAX, compareFacts } from "@/lib/compare";
import { cn, formatSizeText, normalize } from "@/lib/utils";
import { getSource } from "@/services/managers";
import { useCompare } from "@/store/compare";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function ComparePage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { ids, remove, clear } = useCompare();
  const catalogIndex = useCatalogIndex();
  const installedIndex = useInstalledIndex();
  const ratings = useRatingSummaries();

  const entries = useMemo(() => ids.map((id) => catalogIndex.get(id)).filter((e): e is CatalogEntry => !!e), [ids, catalogIndex]);
  const facts = useMemo(() => entries.map(compareFacts), [entries]);

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(language, { day: "numeric", month: "numeric", year: "numeric" }) : null);
  const time = (iso: string | null) => (iso ? Date.parse(iso) : null);

  interface Row {
    id: string;
    label: string;
    cells: ReactNode[];
    /** Index nejlepší hodnoty v řádku. */
    best?: number | null;
  }
  const dash = <Minus className="size-4 text-muted" aria-label={t("compare.unknown")} />;
  const yes = (ok: boolean) =>
    ok ? <Check className="size-4 text-success" aria-label={t("compare.yes")} /> : <X className="size-4 text-muted" aria-label={t("compare.no")} />;

  const rows: Row[] = [
    {
      id: "rating",
      label: t("compare.rating"),
      cells: entries.map((e) => {
        const r = ratings.get(e.id);
        return r?.count ? (
          <span className="inline-flex items-center gap-2">
            <Stars value={r.average} />
            <span className="text-xs text-muted tabular-nums">
              {r.average.toLocaleString(language, { maximumFractionDigits: 1 })} ({r.count})
            </span>
          </span>
        ) : (
          dash
        );
      }),
      best: bestIndex(entries.map((e) => (ratings.get(e.id)?.count ? ratings.get(e.id)!.average : null)), true),
    },
    {
      id: "license",
      label: t("compare.license"),
      cells: entries.map((e, i) =>
        e.license ? (
          <span className="flex flex-col">
            <span className="break-words">{e.license}</span>
            {facts[i].license && <span className="text-xs text-muted">{t(`package.${facts[i].license}`)}</span>}
          </span>
        ) : (
          dash
        ),
      ),
    },
    {
      id: "openSource",
      label: t("compare.openSource"),
      cells: facts.map((f, i) => yes(f.license === "licenseOpen" || !!entries[i].repositoryUrl)),
    },
    {
      id: "version",
      label: t("compare.version"),
      cells: entries.map((e) => (e.latestVersion ? <span className="break-all tabular-nums">{e.latestVersion}</span> : dash)),
    },
    {
      id: "released",
      label: t("compare.released"),
      cells: facts.map((f) => date(f.releaseDate) ?? dash),
      best: bestIndex(facts.map((f) => time(f.releaseDate)), true),
    },
    {
      id: "size",
      label: t("compare.size"),
      cells: facts.map((f) => (f.size ? formatSizeText(f.size, language) : dash)),
      best: bestIndex(facts.map((f) => f.size), false),
    },
    {
      id: "installedSize",
      label: t("compare.installedSize"),
      cells: facts.map((f) => (f.installedSize ? formatSizeText(f.installedSize, language) : dash)),
      best: bestIndex(facts.map((f) => f.installedSize), false),
    },
    {
      id: "arm64",
      label: t("compare.arm64"),
      cells: facts.map((f) => (f.architectures.length ? yes(f.architectures.includes("arm64")) : dash)),
    },
    {
      id: "architectures",
      label: t("compare.architectures"),
      cells: facts.map((f) => (f.architectures.length ? f.architectures.join(", ") : dash)),
    },
    {
      id: "minOs",
      label: t("compare.minOs"),
      cells: facts.map((f) => f.minOs ?? dash),
    },
    {
      id: "sources",
      label: t("compare.sources"),
      cells: facts.map((f) =>
        f.sources.length ? (
          <span className="flex flex-wrap gap-1">
            {f.sources.map((s) => (
              <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                {getSource(s).label}
              </span>
            ))}
          </span>
        ) : (
          t("compare.webOnly")
        ),
      ),
    },
    {
      id: "stars",
      label: t("compare.stars"),
      cells: entries.map((e) => (e.githubStars ? e.githubStars.toLocaleString(language) : dash)),
      best: bestIndex(entries.map((e) => e.githubStars ?? null), true),
    },
    {
      id: "installed",
      label: t("compare.installed"),
      cells: entries.map((e) => {
        const pkg = installedIndex.get(e.id);
        return pkg ? <span className="text-success">{t("compare.installedVersion", { version: pkg.installedVersion || "?" })}</span> : t("compare.notInstalled");
      }),
    },
    {
      id: "links",
      label: t("compare.links"),
      cells: entries.map((e) => (
        <span className="flex flex-col gap-1">
          {e.homepage && <ExtLink href={e.homepage}>{t("compare.homepage")}</ExtLink>}
          {e.repositoryUrl && <ExtLink href={e.repositoryUrl}>{t("compare.repository")}</ExtLink>}
          {!e.homepage && !e.repositoryUrl && dash}
        </span>
      )),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("compare.title")}
        subtitle={t("compare.subtitle", { count: COMPARE_MAX })}
        actions={
          entries.length > 0 && (
            <Button variant="secondary" onClick={clear}>
              <X className="size-4" />
              {t("compare.clear")}
            </Button>
          )
        }
      />

      {entries.length < COMPARE_MAX && <AddApp exclude={ids} />}

      {entries.length === 0 ? (
        <EmptyState icon={Columns3} message={t("compare.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <caption className="sr-only">{t("compare.caption", { names: entries.map((e) => e.name).join(", ") })}</caption>
            <colgroup>
              <col className="w-44" />
              {entries.map((e) => (
                <col key={e.id} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-line">
                <td />
                {entries.map((e) => (
                  <th key={e.id} scope="col" className="p-4 text-left align-top font-normal">
                    <div className="flex items-start gap-2">
                      <PackageIcon id={e.id} name={e.name} iconUrl={e.iconUrl} size={44} />
                      <button
                        type="button"
                        onClick={() => remove(e.id)}
                        aria-label={t("compare.remove", { name: e.name })}
                        title={t("compare.remove", { name: e.name })}
                        className="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <Link to={detailUrl(e.id)} className="mt-2 flex items-center gap-1.5 font-semibold hover:underline">
                      <span className="truncate">{e.name}</span>
                      {e.verified && <VerifiedBadge size={14} />}
                    </Link>
                    <p className="truncate text-xs text-muted">{e.publisher}</p>
                    <PackageAction entry={e} className="mt-3" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-b-0">
                  <th scope="row" className="bg-surface-2/40 px-4 py-3 text-left align-top text-xs font-semibold text-muted">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={entries[i].id} className={cn("px-4 py-3 align-top", row.best === i && "bg-accent/6")}>
                      <span className="flex items-start gap-1.5">
                        <span className="min-w-0">{cell}</span>
                        {row.best === i && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/12 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                            <Trophy className="size-3" aria-hidden />
                            {t("compare.best")}
                          </span>
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

/** Přidat aplikaci do porovnání hledáním v katalogu. */
function AddApp({ exclude }: { exclude: string[] }) {
  const { t } = useTranslation();
  const { data } = useCatalog();
  const toggle = useCompare((s) => s.toggle);
  const [query, setQuery] = useState("");

  // Přesný název, pak název začínající dotazem, pak slovo v názvu („Mozilla Firefox“ na „firefox“),
  // nakonec kdekoli v názvu – v každé skupině podle popularity (Firefox před FirefoxDownloadsView)
  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!data || q.length < 2) return [];
    const scored: { entry: CatalogEntry; rank: number }[] = [];
    for (const record of catalogSearchIndex(data)) {
      if (exclude.includes(record.entry.id) || !record.name.includes(q)) continue;
      const words = record.name.split(/[^\p{L}\p{N}]+/u);
      const rank = record.name === q || words.at(-1) === q ? 0 : record.name.startsWith(q) ? 1 : words.some((w) => w.startsWith(q)) ? 2 : 3;
      scored.push({ entry: record.entry, rank });
    }
    return scored
      .sort((a, b) => a.rank - b.rank || b.entry.popularity - a.entry.popularity)
      .slice(0, 6)
      .map((s) => s.entry);
  }, [data, query, exclude]);

  return (
    <div className="relative mb-6 max-w-md">
      <label className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 focus-within:border-accent">
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("compare.addPlaceholder")}
          aria-label={t("compare.addPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {results.length > 0 && (
        <ul role="listbox" aria-label={t("compare.addPlaceholder")} className="absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover">
          {results.map((entry) => (
            <li key={entry.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  toggle(entry.id);
                  setQuery("");
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={28} />
                {/* Id balíčku odliší stejnojmenné aplikace (Mozilla Firefox a jeho verze ESR) */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{entry.name}</span>
                  <span className="block truncate text-xs text-muted">{entry.sources[0]?.packageId ?? entry.publisher}</span>
                </span>
                <Plus className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
