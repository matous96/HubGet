import { ArrowRight, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { usePackageState } from "@/hooks/usePackages";
import { cn } from "@/lib/utils";
import { useInstallerHostChange } from "@/store/installerUrls";
import { useSelection } from "@/store/selection";
import type { CatalogEntry } from "@/types";
import { usePackageMenuHandlers } from "./InstallMenu";
import { SelectCheckbox } from "./SelectCheckbox";
import { PackageAction } from "./PackageAction";
import { PackageIcon } from "./PackageIcon";
import { QuickActions } from "./QuickActions";
import { CategoryBadge } from "./CategoryBadge";
import { OriginBadge, SourceDots, WebBadge } from "./SourceBadge";
import { VerifiedBadge } from "./VerifiedBadge";
import { isVerified } from "@/lib/verified";
import { isWebOnly } from "@/lib/webOnly";
import { UninstallButton } from "./UninstallButton";

interface PackageRowProps {
  entry: CatalogEntry;
  showUninstall?: boolean;
  /** Úzká varianta (např. dvousloupcový žebříček): bez odznaku zdroje a verzí, ať zůstane místo na název. */
  compact?: boolean;
}

/**
 * Řádek balíčku pro zobrazení „seznam“. Memo: stránka se stovkami řádků
 * (Nainstalované) překreslí jen řádky, kterých se změna týká.
 */
export const PackageRow = memo(function PackageRow({ entry, showUninstall, compact }: PackageRowProps) {
  const { t } = useTranslation();
  const { installed, job } = usePackageState(entry.id);
  const hostChange = useInstallerHostChange(installed);
  // Pravé tlačítko = nabídka instalace, Ctrl+Enter / Alt+Enter = instalovat / možnosti
  const menuHandlers = usePackageMenuHandlers(entry);
  const selected = useSelection((s) => !!s.items[entry.id]);

  return (
    <article
      {...menuHandlers}
      className={cn(
        "group relative flex items-center gap-4 rounded-xl border border-transparent px-3 py-2.5",
        "transition-colors hover:border-line hover:bg-surface",
        job && "border-line bg-surface",
        selected && "border-accent/60 bg-accent/5",
      )}
    >
      {/* Hromadný výběr – zaškrtávátko v rohu přes ikonu */}
      <SelectCheckbox entry={entry} className="absolute top-1 left-1" />
      <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={44} />

      {/* @container: odznak kategorie jen při dost širokém sloupci (dvousloupcový žebříček by jinak názvu nechal pár písmen) */}
      <div className="@container min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="flex min-w-0 items-center text-sm font-semibold">
            <Link
              to={`/package/${encodeURIComponent(entry.id)}`}
              className="block min-w-0 truncate outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-accent"
            >
              {entry.name}
            </Link>
            {/* Za názvem 1 px, který se smí ztratit: šířka nadpisu podle obsahu se při měřítku 150 % zaokrouhlí
                o zlomek pixelu dolů a jinak by ho ubral název – „Git“ by se zkrátil na „G…“ */}
            {isVerified(entry) ? (
              <span className="inline-flex min-w-[17px] shrink-[1000] pl-1">
                <VerifiedBadge size={14} />
              </span>
            ) : (
              <span aria-hidden className="w-px shrink-[1000]" />
            )}
          </h3>
          {/* Vydavatel se zkracuje dřív než název aplikace */}
          <span className="min-w-0 shrink-[10000] truncate text-xs text-muted">{entry.publisher}</span>
          {!installed && entry.sources.length > 1 && <SourceDots sources={entry.sources.map((s) => s.source)} />}
          {/* Aplikace jen z webu výrobce; nainstalovaná ho má u verze (širší řádek) */}
          {isWebOnly(entry) && (!installed || compact) && <WebBadge className="shrink-0" />}
          <CategoryBadge category={entry.categories[0]} className="shrink-0 @max-sm:hidden" />
        </div>
        <p className="truncate text-[13px] text-muted">{entry.description || entry.sources[0]?.packageId}</p>
      </div>

      {/* Zdroj (u nainstalovaných) a verze: nainstalovaná → dostupná */}
      {installed && !compact && (
        <div className="hidden shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted md:flex">
          <OriginBadge origin={installed.origin} className={isWebOnly(entry) ? undefined : "mr-2"} />
          {isWebOnly(entry) && <WebBadge className="mr-2" />}
          <span>{installed.installedVersion}</span>
          {installed.availableVersion && (
            <>
              <ArrowRight className="size-3" />
              {/* Instalátor nové verze z jiného serveru (winget) – oranžově s varováním */}
              {hostChange ? (
                <span
                  title={t("hostChange.title", { from: hostChange.from, to: hostChange.to })}
                  className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300"
                >
                  <TriangleAlert className="size-3.5" />
                  {installed.availableVersion}
                </span>
              ) : (
                <span className="font-semibold text-accent">{installed.availableVersion}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* Rychlé akce po najetí myší. V úzkém řádku (žebříček) se překryjí přes popis, aby nezabíraly místo názvu. */}
      {!job && (
        <QuickActions
          entry={entry}
          className={cn(
            "shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
            compact
              ? "absolute top-1/2 right-[8.5rem] -translate-y-1/2 rounded-full border border-line bg-surface p-0.5 shadow-card"
              : "relative",
          )}
        />
      )}

      <div className={cn("flex shrink-0 items-center justify-end gap-1", job ? "w-56" : "min-w-28")}>
        {showUninstall && <UninstallButton entry={entry} />}
        <PackageAction entry={entry} className="relative z-10" />
      </div>
    </article>
  );
});
