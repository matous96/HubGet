/**
 * Nedávno aktualizováno (Nainstalované → Dostupné aktualizace, jako v App Storu): aplikace,
 * které HubGet za posledních 30 dní aktualizoval – ručně i automaticky (lib/recentUpdates.ts).
 * Aplikace, kterou čeká další aktualizace, tu není – je nahoře mezi dostupnými aktualizacemi
 * a po aktualizaci se sem vrátí. Řádek: ikona, název, den aktualizace a verze, Otevřít, pod ním
 * poznámky k verzi z katalogu s rozbalením „další“.
 */
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { fallbackEntry, useCatalogIndex, useInstalledIndex } from "@/hooks/usePackages";
import { dayLabel, RECENT_DAYS, visibleRecentUpdates } from "@/lib/recentUpdates";
import { compareVersions } from "@/lib/version";
import { useHistory, type HistoryEntry } from "@/store/history";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";
import { PackageAction } from "./PackageAction";
import { PackageIcon } from "./PackageIcon";

/** Kolik aplikací ukázat hned (zbytek po „Zobrazit všechny“). */
const SHOWN = 8;

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function RecentlyUpdated() {
  const { t } = useTranslation();
  const history = useHistory((s) => s.items);
  const catalogIndex = useCatalogIndex();
  const installedIndex = useInstalledIndex();
  const [all, setAll] = useState(false);

  // Jen aplikace, které jsou pořád nainstalované a nečeká je další aktualizace (ta je nahoře)
  const rows = useMemo(
    () =>
      visibleRecentUpdates(history, installedIndex)
        .map((h) => ({ h, entry: catalogIndex.get(h.appId) ?? fallbackEntry(h.source, h.packageId, h.appName, h.toVersion ?? h.version ?? "") })),
    [history, installedIndex, catalogIndex],
  );
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);

  return (
    <section className="mt-10" aria-label={t("recentlyUpdated.title")}>
      <h2 className="mb-1 font-display text-lg font-bold">{t("recentlyUpdated.title")}</h2>
      <p className="mb-4 text-sm text-muted">{t("recentlyUpdated.subtitle", { count: RECENT_DAYS })}</p>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {shown.map(({ h, entry }) => (
          <RecentRow key={h.id} h={h} entry={entry} />
        ))}
      </ul>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-3 cursor-pointer text-sm font-semibold text-accent hover:underline">
          {t("recentlyUpdated.showAll", { count: rows.length })}
        </button>
      )}
    </section>
  );
}

function RecentRow({ h, entry }: { h: HistoryEntry; entry: CatalogEntry }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const [expanded, setExpanded] = useState(false);
  // Poznámky z katalogu patří k jeho nejnovější verzi – jen když je to ta, na kterou se aktualizovalo
  const notes =
    entry.releaseNotes && h.toVersion && entry.latestVersion && compareVersions(entry.latestVersion, h.toVersion) === 0
      ? entry.releaseNotes.trim()
      : "";
  const long = notes.length > 140 || notes.split("\n").length > 2;

  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-3.5">
        <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={48} />
        <div className="min-w-0 flex-1">
          <Link to={detailUrl(entry.id)} className="block truncate font-semibold hover:underline">
            {entry.name}
          </Link>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted tabular-nums">
            <span className="shrink-0">{dayLabel(h.finishedAt, language)}</span>
            {h.toVersion && (
              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                ·{h.fromVersion && <span className="truncate">{h.fromVersion}</span>}
                {h.fromVersion && <ArrowRight className="size-3 shrink-0" />}
                <span className="truncate">{h.toVersion}</span>
              </span>
            )}
            {h.background && <span className="shrink-0">· {t("recentlyUpdated.automatic")}</span>}
          </p>
        </div>
        <PackageAction entry={entry} className="shrink-0" />
      </div>
      {notes && (
        <div className="mt-2 flex items-end gap-3 pl-[62px]">
          <p className={`min-w-0 flex-1 text-sm leading-relaxed whitespace-pre-line ${expanded ? "" : "line-clamp-2"}`}>{notes}</p>
          {long && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="shrink-0 cursor-pointer text-sm font-semibold text-accent hover:underline">
              {expanded ? t("whatsNew.less") : t("recentlyUpdated.more")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
