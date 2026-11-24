/**
 * Významné aktualizace na Domů (jako „Události“ v App Storu): nainstalované aplikace, kterým
 * vyšla nová hlavní verze (lib/majorUpdate – OBS 32 → 33), jako karty s první větou poznámek
 * k vydání a tlačítkem Aktualizovat. Klik na kartu otevře detail s celými novinkami.
 */
import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PackageAction } from "@/components/package/PackageAction";
import { PackageIcon } from "@/components/package/PackageIcon";
import { Shelf, ShelfItem } from "@/components/ui/Shelf";
import { useUpdates } from "@/hooks/useInstalledItems";
import { isMajorUpdate, majorOf, notesTeaser } from "@/lib/majorUpdate";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function MajorUpdates() {
  const { t } = useTranslation();
  const { updatable } = useUpdates();
  const majors = useMemo(
    () => updatable.filter((i) => isMajorUpdate(i.pkg.installedVersion, i.pkg.availableVersion)).sort((a, b) => b.entry.popularity - a.entry.popularity),
    [updatable],
  );
  if (!majors.length) return null;

  return (
    <div className="mb-8">
      <Shelf title={t("majorUpdate.title")} icon={<Sparkles className="size-5 text-amber-400" />}>
        {majors.map(({ entry, pkg }) => {
          // Poznámky z katalogu patří nejnovější verzi – jen když je to ta nabízená
          const teaser = entry.latestVersion === pkg.availableVersion ? notesTeaser(entry.releaseNotes) : null;
          return (
            <ShelfItem key={entry.id}>
              <article className="relative flex h-full flex-col rounded-3xl border border-line bg-surface p-5 shadow-card transition-shadow hover:shadow-card-hover">
                <Link to={detailUrl(entry.id)} className="absolute inset-0 rounded-3xl" aria-label={entry.name} />
                <p className="text-[11px] font-bold tracking-[0.12em] text-accent uppercase">{t("majorUpdate.label")}</p>
                <div className="mt-3 flex items-center gap-3">
                  <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={48} />
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{entry.name}</h3>
                    <p className="text-sm text-muted tabular-nums">
                      {t("majorUpdate.version", { version: majorOf(pkg.availableVersion!) ?? pkg.availableVersion })}
                    </p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-3 flex-1 text-sm text-fg/80">{teaser ?? t("majorUpdate.noNotes", { from: pkg.installedVersion, to: pkg.availableVersion })}</p>
                <div className="relative z-10 mt-4">
                  <PackageAction entry={entry} />
                </div>
              </article>
            </ShelfItem>
          );
        })}
      </Shelf>
    </div>
  );
}
