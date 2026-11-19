/**
 * Hlídané aplikace (store/watchlist.ts): tlačítko se zvonkem v detailu a kontrola
 * po každém načtení katalogu – oznámí, že aplikace z webu jde nainstalovat přes
 * HubGet, nebo že vyšla nová verze.
 */
import { BellRing, BellPlus } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogIndex, useInstalledIndex } from "@/hooks/usePackages";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { compareVersions } from "@/lib/version";
import { isWebOnly } from "@/lib/webOnly";
import { notifyEvent } from "@/services/notify";
import { useWatchlist } from "@/store/watchlist";
import type { CatalogEntry } from "@/types";

/** Zvonek v detailu nenainstalované aplikace: hlídat / nehlídat. */
export function WatchButton({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const watched = useWatchlist((s) => !!s.items[entry.id]);
  const installed = useInstalledIndex().has(entry.id);
  if (installed && !watched) return null;
  const web = isWebOnly(entry);
  const label = watched ? t("watch.stop") : t(web ? "watch.startWeb" : "watch.start");
  const toggle = () => {
    const { watch, remove } = useWatchlist.getState();
    if (watched) remove(entry.id);
    else watch(entry.id, { name: entry.name, version: entry.latestVersion, webOnly: web });
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={watched}
      onClick={toggle}
      className={cn(
        "flex size-11 cursor-pointer items-center justify-center rounded-full bg-surface-2 transition-colors hover:bg-surface-3",
        watched ? "text-accent" : "text-fg",
      )}
    >
      {watched ? <BellRing className="size-5" /> : <BellPlus className="size-5" />}
    </button>
  );
}

/** Kontrola hlídaných aplikací po načtení katalogu (bez vlastního vzhledu – v Layoutu). */
export function WatchlistWatcher() {
  const catalogIndex = useCatalogIndex();
  const installed = useInstalledIndex();
  const items = useWatchlist((s) => s.items);

  useEffect(() => {
    if (!catalogIndex.size) return;
    const { update, remove } = useWatchlist.getState();
    for (const [appId, watched] of Object.entries(items)) {
      // Nainstalovaná aplikace: aktualizace hlídají Dostupné aktualizace
      if (installed.has(appId)) {
        remove(appId);
        continue;
      }
      const entry = catalogIndex.get(appId);
      if (!entry) continue;
      const note = (message: string) =>
        notifyEvent({ type: "info", tone: "success", title: entry.name, message, toast: message, record: { appId } });
      if (watched.webOnly && !isWebOnly(entry)) {
        note(i18n.t("watch.nowInstallable", { name: entry.name }));
        update(appId, { webOnly: false, version: entry.latestVersion || watched.version });
      } else if (entry.latestVersion && watched.version && compareVersions(entry.latestVersion, watched.version) > 0) {
        note(i18n.t("watch.newVersion", { name: entry.name, version: entry.latestVersion }));
        update(appId, { version: entry.latestVersion });
      } else if (entry.latestVersion && !watched.version) {
        update(appId, { version: entry.latestVersion });
      }
    }
  }, [catalogIndex, installed, items]);

  return null;
}
