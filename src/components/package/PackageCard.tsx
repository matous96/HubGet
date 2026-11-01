import { ArrowUpCircle, Heart, Star, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { GitHubIcon } from "@/components/ui/BrandIcons";
import { usePackageState } from "@/hooks/usePackages";
import { cn } from "@/lib/utils";
import { knownGithubStars } from "@/services/github";
import { useFavorites } from "@/store/favorites";
import { useInstallerHostChange } from "@/store/installerUrls";
import { useSelection } from "@/store/selection";
import type { CatalogEntry } from "@/types";
import { CategoryBadge } from "./CategoryBadge";
import { usePackageMenuHandlers } from "./InstallMenu";
import { PackageAction } from "./PackageAction";
import { PackageIcon } from "./PackageIcon";
import { QuickActions } from "./QuickActions";
import { useRatingFormat, useRatingSummaries } from "./RatingsSection";
import { SelectCheckbox } from "./SelectCheckbox";
import { OriginBadge, SourceBadge, SourceDots, WebBadge } from "./SourceBadge";
import { VerifiedBadge } from "./VerifiedBadge";
import { isVerified } from "@/lib/verified";
import { isWebOnly } from "@/lib/webOnly";
import { UninstallButton } from "./UninstallButton";

interface PackageCardProps {
  entry: CatalogEntry;
  showUninstall?: boolean;
  className?: string;
}

/**
 * Karta balíčku pro mřížku a police. Celá karta je klikací (odkaz na detail
 * je „roztažený“ přes kartu), tlačítka akcí leží nad ním (z-10).
 *
 * Všechny karty mají stejnou stavbu a výšku: horní řádek s ikonou (vpravo
 * nahoře pevné místo pro odznak nové verze / rychlé akce), název a vydavatel
 * na jeden řádek, popis vždy na dva řádky a patička přišpendlená ke spodnímu
 * okraji. Obsah patičky se do karty vejde vždy – štítek zdroje se případně
 * zkrátí, tlačítka ne. Memo: při překreslení mřížky se překreslí jen karty,
 * kterých se změna týká (vlastní stav si každá karta sleduje sama).
 */
export const PackageCard = memo(function PackageCard({ entry, showUninstall, className }: PackageCardProps) {
  const { t } = useTranslation();
  const { status, installed, job } = usePackageState(entry.id);
  const hostChange = useInstallerHostChange(installed);
  const isFavorite = useFavorites((s) => s.items.some((i) => i.appId === entry.id));
  const selected = useSelection((s) => !!s.items[entry.id]);
  // Pravé tlačítko = nabídka instalace, Ctrl+Enter / Alt+Enter = instalovat / možnosti
  const menuHandlers = usePackageMenuHandlers(entry);
  const category = entry.categories[0];
  // Souhrny hodnocení přijdou jedním požadavkem pro všechny karty (jen se Supabase)
  const rating = useRatingSummaries().get(entry.id);
  const githubStars = knownGithubStars(entry);
  const fmt = useRatingFormat();

  return (
    <article
      {...menuHandlers}
      className={cn(
        "group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-card",
        "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
        job && "ring-2 ring-accent/40",
        selected && "ring-2 ring-accent",
        className,
      )}
    >
      {/* Hromadný výběr – zaškrtávátko v rohu přes ikonu */}
      <SelectCheckbox entry={entry} className="absolute top-2.5 left-2.5" />

      {/* Horní řádek: ikona (pevná výška – karty začínají názvem ve stejné výšce) */}
      <div className="flex h-14 shrink-0 items-start">
        <PackageIcon
          id={entry.id}
          name={entry.name}
          iconUrl={entry.iconUrl}
          size={56}
          className="transition-transform duration-300 group-hover:scale-105"
        />
      </div>

      {/* Pravý horní roh – vždy stejné místo: odznak nové verze a kategorie (ať je hned vidět,
          k čemu aplikace slouží), po najetí je nahradí rychlé akce */}
      <div className="absolute top-4 right-4 flex max-w-[55%] flex-col items-end gap-1.5 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
        {status === "updatable" && installed?.availableVersion && (
          <span
            title={hostChange ? t("hostChange.title", { from: hostChange.from, to: hostChange.to }) : undefined}
            className={cn(
              "inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-[11px] font-semibold tabular-nums",
              // Instalátor nové verze z jiného serveru (winget) – oranžově
              hostChange ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-accent/12 text-accent",
            )}
          >
            {hostChange ? <TriangleAlert className="size-3 shrink-0" /> : <ArrowUpCircle className="size-3 shrink-0" />}
            <span className="truncate">{installed.availableVersion}</span>
          </span>
        )}
        <CategoryBadge category={category} />
      </div>
      <QuickActions
        entry={entry}
        className="absolute top-3 right-3 rounded-full border border-line bg-surface/95 p-0.5 opacity-0 shadow-card backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      />

      <h3 className="mt-3 flex h-6 min-w-0 items-center gap-1.5 text-[15px] font-semibold">
        <Link
          to={`/package/${encodeURIComponent(entry.id)}`}
          className="block min-w-0 truncate outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-accent"
        >
          {entry.name}
        </Link>
        {isVerified(entry) && <VerifiedBadge size={15} />}
        {isFavorite && <Heart aria-label={t("quick.isFavorite")} className="size-3.5 shrink-0 fill-rose-500 text-rose-500" />}
      </h3>
      <p className="flex h-4 min-w-0 items-center gap-2 text-xs text-muted">
        <span className="truncate">{entry.publisher}</span>
        {/* Tečky zdrojů – ve kterých správcích je aplikace dostupná */}
        {entry.sources.length > 1 && <SourceDots sources={entry.sources.map((s) => s.source)} />}
        {/* Vpravo hodnocení uživatelů a hvězdičky na GitHubu (vydavatel se případně zkrátí) */}
        {(rating || githubStars) && (
          <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
            {rating && (
              <span
                title={t("reviews.cardTitle", { average: fmt.average(rating.average), formatted: fmt.count(rating.count) })}
                className="inline-flex items-center gap-0.5 font-medium text-fg/75"
              >
                <Star className="size-3 fill-amber-400 text-amber-400" />
                {fmt.average(rating.average)}
              </span>
            )}
            {githubStars ? (
              <span title={t("github.stars", { formatted: fmt.count(githubStars) })} className="inline-flex items-center gap-1">
                <GitHubIcon className="size-3" />
                {fmt.count(githubStars)}
              </span>
            ) : null}
          </span>
        )}
      </p>
      {/* Popis vždy na dva řádky (delší se zkrátí) – všechny karty mají stejnou výšku */}
      <p className="mt-2 line-clamp-2 h-10 shrink-0 text-[13px] leading-5 break-words text-muted" title={entry.description || undefined}>
        {entry.description || entry.sources[0]?.packageId}
      </p>

      {/* Patička u spodního okraje: zdroj + akce, nebo živý průběh přes celou šířku */}
      <div className="mt-auto pt-4">
        <div className="flex h-9 min-w-0 items-center justify-between gap-2">
          {job ? (
            <PackageAction entry={entry} className="min-w-0 flex-1" />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center">
                {installed ? (
                  // U nainstalované aplikace je důležitější, odkud je nainstalovaná;
                  // aplikace jen z webu výrobce (DaVinci Resolve) i s odznakem Web
                  <span className="flex min-w-0 items-center gap-1.5">
                    <OriginBadge origin={installed.origin} compact />
                    {isWebOnly(entry) && <WebBadge className="shrink-0" />}
                  </span>
                ) : entry.sources[0] ? (
                  <SourceBadge source={entry.sources[0].source} />
                ) : (
                  <WebBadge />
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {showUninstall && <UninstallButton entry={entry} />}
                <PackageAction entry={entry} className="relative z-10" />
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
});
