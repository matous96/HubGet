/**
 * Upozornění nad seznamem Nainstalovaných:
 *  - EndOfLifePanel – runtime a nástroje, které už nedostávají bezpečnostní opravy
 *    (endoflife.date, hooks/useEndOfLife.ts),
 *  - DuplicatesPanel – stejná aplikace nainstalovaná dvakrát (Git přes WinGet i jako
 *    součást Scoopu, prohlížeč z WinGetu i ze Storu) – jednu instalaci jde odebrat.
 * Plus EndOfLifeNote v detailu aplikace.
 */
import { Copy, ShieldOff } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useEndOfLife, useEndOfLifeOf } from "@/hooks/useEndOfLife";
import type { InstalledItem } from "@/hooks/useInstalledItems";
import { nameKey } from "@/hooks/usePackages";
import { getSource, isGameStore } from "@/services/managers";
import { useSettings } from "@/store/settings";
import type { InstalledPackage } from "@/types";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

const formatDate = (date: string, language: string) => new Date(date).toLocaleDateString(language, { day: "numeric", month: "numeric", year: "numeric" });

export function EndOfLifePanel({ items }: { items: InstalledItem[] }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const ended = useEndOfLife(items);
  if (!ended.length) return null;
  return (
    <section
      aria-label={t("eol.title", { count: ended.length })}
      className="mb-5 flex gap-4 rounded-2xl border border-danger/30 bg-danger/8 px-4 py-3"
    >
      <ShieldOff className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t("eol.title", { count: ended.length })}</p>
        <p className="text-xs text-muted">{t("eol.text")}</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {ended.map(({ item, eol }) => (
            <li key={`${item.pkg.source}:${item.pkg.packageId}`}>
              <Link to={detailUrl(item.entry.id)} className="font-medium hover:underline">
                {eol.label} {eol.cycle}
              </Link>
              <span className="text-muted">
                {" – "}
                {t("eol.since", { date: formatDate(eol.ended, language) })}
                {eol.newest && ` · ${t("eol.newest", { name: eol.label, cycle: eol.newest.cycle })}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Upozornění v detailu nainstalované aplikace bez podpory. */
export function EndOfLifeNote({ pkg }: { pkg: InstalledPackage | undefined }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const eol = useEndOfLifeOf(pkg);
  if (!eol) return null;
  return (
    <p className="flex max-w-2xl items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm">
      <ShieldOff className="mt-0.5 size-4 shrink-0 text-danger" />
      <span>
        {t("eol.detail", { name: eol.label, cycle: eol.cycle, date: formatDate(eol.ended, language) })}
        {eol.newest && ` ${t("eol.detailNewest", { name: eol.label, cycle: eol.newest.cycle })}`}
      </span>
    </p>
  );
}

/** Aplikace nainstalované dvakrát: stejný název u balíčků od různých zdrojů (bez her a programů mimo správce). */
export function useDuplicates(items: InstalledItem[]): InstalledItem[][] {
  return useMemo(() => {
    const groups = new Map<string, InstalledItem[]>();
    for (const item of items) {
      if (isGameStore(item.pkg.origin) || item.pkg.diskLocation) continue;
      const key = nameKey(item.entry.name);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    // Dvakrát = od dvou různých zdrojů (WinGet + Scoop, WinGet + Microsoft Store). Dva balíčky téhož
    // správce bývají různé varianty, které jsou potřeba obě (Visual C++ x86 a x64, Python 3.12 a 3.13)
    return [...groups.values()].filter((group) => new Set(group.map((i) => `${i.pkg.source}:${i.pkg.origin}`)).size > 1);
  }, [items]);
}

export function DuplicatesPanel({ items }: { items: InstalledItem[] }) {
  const { t } = useTranslation();
  const duplicates = useDuplicates(items);
  if (!duplicates.length) return null;
  return (
    <section
      aria-label={t("duplicates.title", { count: duplicates.length })}
      className="mb-5 flex gap-4 rounded-2xl border border-line bg-surface px-4 py-3"
    >
      <Copy className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t("duplicates.title", { count: duplicates.length })}</p>
        <p className="text-xs text-muted">{t("duplicates.text")}</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {duplicates.map((group) => (
            <li key={group[0].entry.id}>
              <span className="font-medium">{group[0].entry.name}</span>
              <span className="text-muted"> – </span>
              {group.map((item, i) => (
                <span key={`${item.pkg.source}:${item.pkg.packageId}`}>
                  {i > 0 && <span className="text-muted">, </span>}
                  <Link to={detailUrl(item.entry.id)} className="hover:underline" title={item.pkg.packageId}>
                    {getSource(item.pkg.source).label} {item.pkg.installedVersion}
                  </Link>
                </span>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
