/**
 * Detail aplikace ve stylu App Store:
 *  banner → hlavička (ikona, název, akce, výběr zdroje) → pruh s údaji →
 *  příkaz pro CLI → Ukázka → Hodnocení → Informace → Mohlo by se vám líbit.
 *
 * Jeden profil aplikace sdružuje všechny zdroje (winget, Scoop, Chocolatey);
 * uživatel si vybere, odkud instalovat.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Info, UserSquare2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { queryKeys } from "@/app/queryClient";
import { LaunchButton, PackageAction } from "@/components/package/PackageAction";
import { PackageBanner } from "@/components/package/PackageBanner";
import { PackageCard } from "@/components/package/PackageCard";
import { PackageCommand } from "@/components/package/PackageCommand";
import { PackageIcon } from "@/components/package/PackageIcon";
import { ArchitectureInfo } from "@/components/package/ArchitectureInfo";
import { PrivacySection } from "@/components/package/PrivacySection";
import { InstallSplitMenu } from "@/components/package/InstallMenu";
import { InlineInstallParameters } from "@/components/package/InstallParameters";
import { QuickLinks } from "@/components/package/QuickLinks";
import { RatingsSection, ratingsEnabled, useRatingFormat, useRatingSummary } from "@/components/package/RatingsSection";
import { AppScreenshots } from "@/components/package/AppScreenshots";
import { TechnicalDetails } from "@/components/package/TechnicalDetails";
import { WhatsNew } from "@/components/package/WhatsNew";
import { DetailLibraryButtons } from "@/components/package/QuickActions";
import { SafeInstallNote } from "@/components/package/SafeInstallNote";
import { ReportButton } from "@/components/package/ReportButton";
import { ShareButton } from "@/components/package/ShareButton";
import { OriginBadge, useOriginLabel, WebBadge } from "@/components/package/SourceBadge";
import { UninstallButton } from "@/components/package/UninstallButton";
import { AutoUpdateToggle, InstallerHostWarning, UpdatePinBar } from "@/components/package/UpdatePin";
import { NameWithBadge, VerifiedBadge } from "@/components/package/VerifiedBadge";
import { isVerified } from "@/lib/verified";
import { VersionPicker } from "@/components/package/VersionPicker";
import { GitHubIcon } from "@/components/ui/BrandIcons";
import { Shelf, ShelfItem } from "@/components/ui/Shelf";
import { Stars } from "@/components/ui/Stars";
import { EmptyState, Spinner } from "@/components/ui/States";
import {
  fallbackEntry,
  mergeRepoResults,
  parseSourceKey,
  useCatalog,
  useCatalogIndex,
  useEffectiveSource,
  useInstalled,
  usePackageState,
} from "@/hooks/usePackages";
import { useInstallActions } from "@/hooks/useInstallActions";
import { overlayOpen } from "@/hooks/useOverlay";
import { allArchitectures } from "@/lib/arch";
import { cn, formatRelative, formatSize, formatSizeText } from "@/lib/utils";
import { isWebOnly } from "@/lib/webOnly";
import { useGithubStars } from "@/services/github";
import { getSource, searchAll, sourcePackageUrl, steamAppId } from "@/services/managers";
import { useInstallOptions } from "@/store/installOptions";
import { useInstallUi } from "@/store/installUi";
import { useRecent } from "@/store/recent";
import { sourcePriority, useSettings } from "@/store/settings";
import { useSourceLock, useSourceScope } from "@/store/sourceLock";
import type { CatalogEntry, PackageSource, SourceId } from "@/types";

/** Zamčený zdroj (jen zapnutý) a jeho zrušení. */
function useSourceLockView() {
  const { lock } = useSourceScope();
  const clearLock = useSourceLock((s) => s.clear);
  return { lock, clearLock };
}

/** Hrubé rozlišení licence pro pruh s údaji. */
function licenseKind(license: string | null): "licenseOpen" | "licenseProprietary" | "licenseFree" | null {
  if (!license) return null;
  if (/proprietary/i.test(license)) return "licenseProprietary";
  if (/freeware/i.test(license)) return "licenseFree";
  if (/MIT|GPL|MPL|Apache|BSD|PSF|ISC|Unlicense/i.test(license)) return "licenseOpen";
  return null;
}

/** Stránka detailu: dohledá profil aplikace a předá ho zobrazení. */
export function PackageDetailPage() {
  const { t } = useTranslation();
  const { packageId: appId = "" } = useParams();
  const recordView = useRecent((s) => s.record);
  const { isLoading: catalogLoading } = useCatalog();
  const { isLoading: installedLoading } = useInstalled();
  const catalogIndex = useCatalogIndex();
  const { installed } = usePackageState(appId);

  // Profil z katalogu, případně náhradní profil pro balíček mimo katalog
  // (id "zdroj:balíček"): nejdřív z nainstalovaných, jinak dohledáním u správce.
  const fromCatalog = catalogIndex.get(appId);
  const parsed = parseSourceKey(appId);
  const { enabled, preferred } = useSourceScope();
  const needsLookup = !catalogLoading && !installedLoading && !fromCatalog && !!parsed;
  // Hledáme podle názvu balíčku u všech správců a výsledky sloučíme stejně
  // jako ve vyhledávání – profil tak ukáže všechny zdroje, kde aplikace je.
  const lookupTerm = parsed?.packageId.split(/[./]/).pop() ?? "";
  const { data: repoResults, isLoading: repoLoading } = useQuery({
    queryKey: [...queryKeys.search(lookupTerm), enabled],
    queryFn: ({ signal }) => searchAll(lookupTerm, sourcePriority(enabled, preferred), signal),
    enabled: needsLookup,
  });
  const fromRepo = mergeRepoResults(repoResults ?? []).find((e) =>
    e.sources.some((s) => s.source === parsed?.source && s.packageId === parsed?.packageId),
  );
  const entry =
    fromCatalog ??
    // id profilu = id z adresy, aby seděl stav instalace i historie
    (fromRepo && { ...fromRepo, id: appId }) ??
    (installed
      ? fallbackEntry(installed.source, installed.packageId, installed.name, installed.availableVersion ?? installed.installedVersion)
      : undefined);

  // Zápis do historie „Naposledy zobrazené“, jakmile je aplikace známá.
  const entryId = entry?.id;
  const entryName = entry?.name;
  const entryVersion = entry?.latestVersion;
  useEffect(() => {
    if (entryId && entryName) recordView({ id: entryId, name: entryName, version: entryVersion ?? "" });
  }, [entryId, entryName, entryVersion, recordView]);

  if (catalogLoading || (!entry && (installedLoading || (needsLookup && repoLoading)))) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }
  if (!entry) return <EmptyState message={t("package.notFound")} />;

  // key = při přechodu na jinou aplikaci se vynuluje zvolený zdroj
  return <PackageDetailView key={entry.id} entry={entry} inCatalog={!!fromCatalog} />;
}

function PackageDetailView({ entry: fullEntry, inCatalog }: { entry: CatalogEntry; inCatalog: boolean }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const enabledSources = useSettings((s) => s.enabledSources);
  const { data: catalogData } = useCatalog();
  const catalogIndex = useCatalogIndex();
  const { installed, job } = usePackageState(fullEntry.id);
  // Režim jednoho zdroje (levý panel): ostatní zdroje jako by u aplikace nebyly – výběr
  // zdroje, příkazy i technické údaje jen ze zamčeného. Aplikace, která v něm není,
  // zůstane celá, jen ji nejde nainstalovat (upozornění se zrušením filtru).
  const { lock, clearLock } = useSourceLockView();
  const lockedSources = useMemo(() => (lock ? fullEntry.sources.filter((s) => s.source === lock) : []), [fullEntry, lock]);
  const lockedOut = !!lock && lockedSources.length === 0 && !installed;
  const entry = useMemo(
    () => (lockedSources.length ? { ...fullEntry, sources: lockedSources } : fullEntry),
    [fullEntry, lockedSources],
  );
  const [chosen, setChosen] = useState<SourceId | undefined>();
  const originLabel = useOriginLabel();
  // Hra ze Steamu / program mimo správce, který není v katalogu
  const unmanaged = !!installed && !inCatalog && (installed.origin === "steam" || installed.origin === "ea" || installed.origin === "local");
  // Zdroj uložený v Možnostech instalace platí, dokud uživatel nezvolí jiný
  const savedSource = useInstallOptions((s) => s.byApp[entry.id]?.source);
  // Vypnutá kontrola součtu v Možnostech instalace – indikátor SHA-256 varuje
  const savedSkipHash = useInstallOptions((s) => !!s.byApp[entry.id]?.skipHash);
  const effective = useEffectiveSource(entry, chosen ?? savedSource);
  // Aplikace jen z webu výrobce (DaVinci Resolve) žádný zdroj nemá – ani nainstalovaná
  // (záznam v registru by nabídl starší verze, sadu balíčků a příkaz wingetu)
  const web = isWebOnly(entry);
  const shownSource: PackageSource | undefined = web ? undefined : (effective ?? entry.sources[0]);
  const actions = useInstallActions(entry, effective?.source);
  const openOptions = useInstallUi((s) => s.openOptions);
  const canInstall = actions.status === "available" && !job && !!effective;

  // Klávesové zkratky jako v UniGetUI: Ctrl+Enter = instalovat, Alt+Enter = možnosti instalace
  useEffect(() => {
    if (!canInstall) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Ne pod otevřeným dialogem nebo prohlížečem snímků (fokus tam nemusí být uvnitř)
      if (e.key !== "Enter" || overlayOpen() || target?.closest("input, textarea, select, [role=dialog]")) return;
      if (e.ctrlKey) {
        e.preventDefault();
        actions.install();
      } else if (e.altKey) {
        e.preventDefault();
        openOptions(entry, effective?.source);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canInstall, actions, openOptions, entry, effective?.source]);

  // Pořadí v hlavní kategorii, alternativy a podobné aplikace (podle popularity).
  const { rank, similar, alternatives } = useMemo(() => {
    const all = catalogData?.catalog.packages ?? [];
    const alternatives = (entry.alternatives ?? [])
      .map((id) => catalogIndex.get(id))
      .filter((p): p is CatalogEntry => !!p);
    const main = entry.categories[0];
    if (!main) return { rank: null, similar: [] as CatalogEntry[], alternatives };
    const inCategory = all.filter((p) => p.categories.includes(main)).sort((a, b) => b.popularity - a.popularity);
    const position = inCategory.findIndex((p) => p.id === entry.id);
    return {
      rank: position >= 0 ? position + 1 : null,
      // Alternativy už mají vlastní polici – v „Mohlo by se vám také líbit“ je neopakovat
      similar: inCategory.filter((p) => p.id !== entry.id && !alternatives.includes(p)).slice(0, 10),
      alternatives,
    };
  }, [catalogData, catalogIndex, entry]);

  const mainCategory = entry.categories[0];
  const license = licenseKind(entry.license);
  const { data: ratingSummary } = useRatingSummary(entry);
  const ratingFormat = useRatingFormat();
  // Detail načte aktuální počet hvězdiček z GitHub API (karty jen z mezipaměti a katalogu)
  const github = useGithubStars(entry, true);

  return (
    <article className="@container">
      {/* ── Banner ───────────────────────────────────────────────── */}
      <PackageBanner entry={entry} />

      {/* ── Hlavička ─────────────────────────────────────────────── */}
      {/* Mřížka: ikona přes obě řádky, vpravo nahoře oblíbené a sdílení. Široký detail
          (container query na <article>): vlevo název, popis a akce, vpravo pod ikonami
          panel se stavem instalace a ověřením – využije místo pod nimi. Užší detail:
          panel pod akcemi přes celou šířku, jeho skupiny vedle sebe, když je místo. Velmi široký
          (celá obrazovka): panel v řádku s akcemi vpravo, skupiny vedle sebe – nízká hlavička bez prázdna. */}
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-8 pt-8 pb-8 @6xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,24rem)] @min-[120rem]:grid-cols-[auto_minmax(0,1fr)_auto]">
        <PackageIcon
          id={entry.id}
          name={entry.name}
          iconUrl={entry.iconUrl}
          size={150}
          className="icon-lifted row-span-2"
        />
        {/* Úzký detail: obal se „rozpustí“ (contents) a název i akce jsou samostatné položky mřížky –
            akce pod názvem přes celou šířku. Široký: jeden sloupec přes obě řádky, vpravo panel. */}
        <div className="contents @6xl:col-start-2 @6xl:row-span-2 @6xl:row-start-1 @6xl:block @6xl:min-w-0 @6xl:pt-3 @min-[120rem]:contents">
          <div className="col-start-2 row-start-1 min-w-0 pt-3 @6xl:pt-0 @min-[120rem]:pt-3">
            {/* Název a popis jdou označit a zkopírovat (jinak má okno výběr textu vypnutý) */}
            <h1 className="font-display text-[40px] leading-tight font-bold tracking-tight">
              <span className="cursor-text select-text">
                <NameWithBadge name={entry.name} verified={isVerified(entry)} size={28} />
              </span>
            </h1>
            {/* Vedle panelu je sloupec užší – popis smí mít o řádek víc */}
            <p className="mt-1 line-clamp-2 cursor-text text-xl text-muted select-text @6xl:line-clamp-3">
              {inCatalog ? entry.description : entry.publisher}
            </p>
            {lockedOut && lock && (
              <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
                <span className={cn("size-2 shrink-0 rounded-full", getSource(lock).dot)} />
                <span className="min-w-0 flex-1">{t("sourceLock.notInSource", { source: getSource(lock).label })}</span>
                <button type="button" onClick={clearLock} className="cursor-pointer font-semibold text-accent hover:underline">
                  {t("sourceLock.showAll")}
                </button>
              </p>
            )}
          </div>

          {/* Akce; nenainstalovaná aplikace i s výběrem zdroje a parametry instalace */}
          <div className={cn("col-span-2 col-start-2 row-start-2 mt-6 flex min-w-0 flex-col gap-4 @6xl:col-span-1 @6xl:col-start-2", lockedOut && "hidden")}>
            <div className="flex flex-wrap items-center gap-3">
              {/* Při běžící úloze potřebuje průběh pevnou šířku */}
              <div className={cn(job && "w-80")}>
                <PackageAction entry={entry} source={effective?.source} size="lg" />
              </div>
              {/* Starší verze jde i spustit – Otevřít vedle Aktualizovat */}
              {actions.status === "updatable" && !job && !web && <LaunchButton entry={entry} installed={installed} size="lg" />}
              {/* Možnosti instalace: jako správce, interaktivně, ruční instalace… */}
              {canInstall && <InstallSplitMenu entry={entry} source={effective?.source} />}
              {/* Instalace konkrétní (starší) verze ze zvoleného zdroje */}
              {/* Správce bez výběru verze (vcpkg) nabízí jen aktuální verzi */}
              {effective && getSource(effective.source).supportsVersions && !unmanaged && !web && !job && (
                <VersionPicker entry={entry} pkg={effective} installed={installed} />
              )}
              <UninstallButton entry={entry} variant="full" />
            </div>

            {/* Aplikace jen z webu výrobce: proč ji HubGet nespravuje */}
            {web && (
              <p className="flex max-w-2xl items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{t("package.webOnlyNote", { name: entry.name, publisher: entry.publisher })}</span>
              </p>
            )}

            {/* Nenainstalovaná aplikace: výběr zdroje instalace */}
            {!installed && entry.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="mr-1 text-muted">{t("package.sourceLabel")}</span>
                {entry.sources.map((s) => {
                  const enabled = enabledSources.includes(s.source);
                  const active = effective?.source === s.source;
                  return (
                    <button
                      key={s.source}
                      type="button"
                      disabled={!enabled || !!job}
                      aria-pressed={active}
                      title={enabled ? undefined : t("package.sourceDisabled")}
                      onClick={() => setChosen(s.source)}
                      className={cn(
                        "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        active
                          ? "border-accent/40 bg-accent/12 text-accent"
                          : "border-line bg-surface text-fg hover:bg-surface-2",
                      )}
                    >
                      <span className={cn("size-2 rounded-full", getSource(s.source).dot)} />
                      <span className="font-medium">{getSource(s.source).label}</span>
                      <span className={cn("text-xs tabular-nums", active ? "text-accent/80" : "text-muted")}>
                        {s.version}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Podrobné parametry instalace: PATH, zástupci, bez restartu (podle instalátoru) */}
            {canInstall && <InlineInstallParameters entry={entry} pkg={effective} />}
          </div>
        </div>

        {/* Oblíbené, sada balíčků, nahlášení problému a sdílení vpravo nahoře (jako v App Store) */}
        <div className="col-start-3 row-start-1 flex justify-end gap-2 pt-3">
          <DetailLibraryButtons entry={entry} pkg={shownSource} />
          <ReportButton entry={entry} pkg={shownSource} installedVersion={installed?.installedVersion} />
          <ShareButton entry={entry} pkg={shownSource} />
        </div>

        {/* Panel: odkud a jak je aplikace nainstalovaná, pravidla aktualizací a ověření instalátoru */}
        {(installed || (!unmanaged && !web)) && (
          <div
            className={cn(
              "col-span-2 col-start-2 row-start-3 mt-6 flex flex-wrap items-start gap-x-10 gap-y-3 self-start rounded-2xl border border-line bg-surface/60 px-5 py-4 text-sm",
              "@6xl:col-span-1 @6xl:col-start-3 @6xl:row-start-2 @6xl:mt-5",
              // Velmi široký detail: v řádku s akcemi (stejný horní okraj), skupiny vedle sebe
              "@min-[120rem]:mt-6",
              lockedOut && "hidden",
            )}
          >
            {installed && (
              <div className="flex min-w-0 flex-col gap-2">
                <span className="flex items-center gap-2 text-muted">
                  {t("package.installedVia")}
                  <OriginBadge origin={installed.origin} />
                  {web && <WebBadge />}
                </span>
                {/* Hry ze Steamu aktualizuje Steam sám; programy mimo správce HubGet jen odinstaluje */}
                {installed.origin === "steam" && (
                  <p className="text-xs text-muted">
                    {t("package.managedBySteam")}{" "}
                    <a
                      href={`steam://nav/games/details/${steamAppId(installed.packageId)}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {t("package.openInSteam")}
                    </a>
                  </p>
                )}
                {installed.origin === "ea" && <p className="text-xs text-muted">{t("package.managedByEa")}</p>}
                {installed.diskLocation ? (
                  <p className="text-xs break-all text-muted">
                    {t(installed.portable ? "package.portableInstall" : "package.diskInstall", { folder: installed.diskLocation })}
                  </p>
                ) : (
                  installed.origin === "local" && !web && <p className="text-xs text-muted">{t("package.localInstall")}</p>
                )}
                {/* Instalátor nové verze z jiného serveru (winget) */}
                <InstallerHostWarning installed={installed} />
                {/* Přeskočit nabízenou verzi / zamknout verzi; automatická aktualizace této aplikace */}
                {!web && <UpdatePinBar installed={installed} appName={entry.name} />}
                {!web && <AutoUpdateToggle installed={installed} />}
              </div>
            )}
            {/* Ujištění o bezpečné instalaci (ne u programů mimo správce a her ze Steamu) */}
            {!unmanaged && shownSource && <SafeInstallNote pkg={shownSource} skipHash={savedSkipHash} />}
          </div>
        )}
      </header>

      {/* ── Pruh s údaji ─────────────────────────────────────────── */}
      <section className="no-scrollbar flex overflow-x-auto border-y border-line py-5">
        {/* Hodnocení uživatelů (Supabase) – jen u aplikací z katalogu, které už někdo hodnotil */}
        {ratingsEnabled && inCatalog && ratingSummary && ratingSummary.count > 0 && (
          <Stat
            label={t("package.statRating")}
            sub={<Stars value={ratingSummary.average} size={12} className="text-fg/70" />}
          >
            {ratingFormat.average(ratingSummary.average)}
          </Stat>
        )}
        {rank && mainCategory && (
          <Stat label={t("package.statRank")} sub={t(`categories.${mainCategory}`)}>
            {t("package.statRankValue", { rank })}
          </Stat>
        )}
        <Stat
          label={t("package.statPublisher")}
          sub={
            <>
              <span className="min-w-0 truncate" title={entry.publisher}>
                {entry.publisher}
              </span>
              {isVerified(entry) && <VerifiedBadge size={13} />}
            </>
          }
        >
          <UserSquare2 className="mx-auto size-7" strokeWidth={1.75} />
        </Stat>
        <Stat
          label={t("package.statVersion")}
          // Pod verzí: nainstalovaná verze, jinak kdy vyšla poslední aktualizace
          sub={
            installed?.installedVersion
              ? t("package.statYouHave", { version: installed.installedVersion })
              : installed
                ? originLabel(installed.origin)
                : entry.releaseDate
                  ? t("package.statReleased", { when: formatRelative(entry.releaseDate, language) })
                  : shownSource
                    ? getSource(shownSource.source).label
                    : t("package.webSource")
          }
        >
          {shownSource?.version || entry.latestVersion || "—"}
        </Stat>
        {/* U her ze Steamu a lokálních programů winget jen „vidí“ instalaci – zdroj ke stažení to není */}
        {!unmanaged && entry.sources.length > 0 && (
          <Stat label={t("package.statSources")} sub={entry.sources.map((s) => getSource(s.source).label).join(" · ")}>
            {entry.sources.length}
          </Stat>
        )}
        {entry.license && (
          <Stat label={t("package.statLicense")} sub={license ? t(`package.${license}`) : ""}>
            {entry.license}
          </Stat>
        )}
        {/* Hvězdičky repozitáře na GitHubu (open source) – aktuální číslo z GitHub API */}
        {github.repo && github.stars !== null && (
          <Stat label={t("github.statLabel")} sub={t("github.statSub", { count: github.stars })}>
            <a
              href={`https://github.com/${github.repo}/stargazers`}
              target="_blank"
              rel="noreferrer"
              title={t("github.stars", { formatted: ratingFormat.count(github.stars) })}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
            >
              <GitHubIcon className="size-5" />
              {ratingFormat.count(github.stars)}
            </a>
          </Stat>
        )}
        {/* Velikost ke stažení ze zvoleného zdroje („182,9“ / „MB“), pod ní místo na disku */}
        {shownSource?.size ? (
          <Stat
            label={t("package.statSize")}
            sub={
              shownSource.installedSize
                ? t("package.statSizeDisk", {
                    unit: formatSize(shownSource.size, language).unit,
                    disk: formatSizeText(shownSource.installedSize, language),
                  })
                : formatSize(shownSource.size, language).unit
            }
          >
            {formatSize(shownSource.size, language).value}
          </Stat>
        ) : null}
      </section>

      {/* ── Rychlé odkazy: web, GitHub, hlášení chyb, dokumentace ── */}
      <QuickLinks entry={entry} />

      {/* ── Příkazy pro příkazový řádek všech správců ────────────── */}
      {/* Hry ze Steamu a programy mimo správce přes příkazy nainstalovat nejdou */}
      {!unmanaged && shownSource && (
        <PackageCommand sources={entry.sources} active={shownSource.source} installed={installed} name={entry.name} />
      )}

      {/* ── Screenshoty (od uživatelů HubGetu, z databáze UniGetUI a popisů balíčků v Chocolatey) ── */}
      <AppScreenshots entry={entry} />

      {/* ── Co je nového v aktuální verzi ────────────────────────── */}
      {inCatalog && <WhatsNew entry={entry} />}

      {/* ── Hodnocení hvězdičkami (Supabase; bez něj se nezobrazuje) ── */}
      {ratingsEnabled && inCatalog && <RatingsSection entry={entry} />}

      {!inCatalog && (
        <p className="my-6 flex items-center gap-2 text-sm text-muted">
          <Info className="size-4" />
          {t("package.notInCatalog")}
        </p>
      )}

      {/* ── Technické údaje: požadavky, SHA-256, rozsah, velikost, závislosti ── */}
      {!unmanaged && inCatalog && shownSource && <TechnicalDetails entry={entry} pkg={shownSource} />}

      {/* ── Ochrana soukromí ─────────────────────────────────────── */}
      {!unmanaged && <PrivacySection entry={entry} />}

      {/* ── Informace ────────────────────────────────────────────── */}
      <section className="mb-10 border-t border-line pt-6">
        <h2 className="mb-5 font-display text-2xl font-bold">{t("package.information")}</h2>
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-10 gap-y-6">
          <InfoItem label={t("package.publisher")}>{entry.publisher}</InfoItem>
          {entry.categories.length > 0 && (
            <InfoItem label={t("package.categories")}>
              <div className="flex flex-wrap gap-1.5">
                {entry.categories.map((c) => (
                  <Link
                    key={c}
                    to={`/categories/${c}`}
                    className="rounded-full bg-accent/12 px-2.5 py-0.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
                  >
                    {t(`categories.${c}`)}
                  </Link>
                ))}
              </div>
            </InfoItem>
          )}
          {/* Aplikace jen z webu výrobce bez zjistitelné verze ji nemá */}
          {entry.latestVersion && <InfoItem label={t("package.latestVersion")}>{entry.latestVersion}</InfoItem>}
          {entry.releaseDate && (
            <InfoItem label={t("package.lastUpdate")}>
              {new Date(entry.releaseDate).toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric" })}
            </InfoItem>
          )}
          {entry.addedAt && (
            <InfoItem label={t("package.statAdded")}>{new Date(entry.addedAt).getFullYear()}</InfoItem>
          )}
          {installed && <InfoItem label={t("package.installedVersion")}>{installed.installedVersion}</InfoItem>}
          {entry.license && <InfoItem label={t("package.license")}>{entry.license}</InfoItem>}
          {shownSource?.installerType && (
            <InfoItem label={t("package.installerType")}>{t(`installerTypes.${shownSource.installerType}`)}</InfoItem>
          )}
          {entry.homepage && (
            <InfoItem label={t("package.website")}>
              {/* V Tauri se odkaz otevře v systémovém prohlížeči (plugin opener – krok 3). */}
              <a
                href={entry.homepage}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {new URL(entry.homepage).hostname.replace(/^www\./, "")}
                <ExternalLink className="size-3.5" />
              </a>
            </InfoItem>
          )}
          {/* Architektury zvoleného zdroje (jinak sjednocení všech) + kompatibilita s tímto PC */}
          {shownSource && ((shownSource.architectures?.length ?? 0) > 0 || allArchitectures(entry.sources).length > 0) ? (
            <InfoItem label={t("arch.label", { source: getSource(shownSource.source).label })}>
              <ArchitectureInfo architectures={shownSource.architectures ?? allArchitectures(entry.sources)} />
            </InfoItem>
          ) : null}
          {/* Aplikace jen z webu výrobce: oficiální stránka ke stažení */}
          {entry.downloadUrl && (
            <InfoItem label={t("package.downloadPage")}>
              <a
                href={entry.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {new URL(entry.downloadUrl).hostname.replace(/^www\./, "")}
                <ExternalLink className="size-3.5" />
              </a>
            </InfoItem>
          )}
          {/* Id balíčku v každém zdroji s odkazem do repozitáře */}
          {entry.sources.length > 0 && (
            <InfoItem label={t("package.availableIn")}>
              <ul className="flex flex-col gap-1.5">
                {entry.sources.map((s) => (
                  <li key={s.source} className="flex items-center gap-2 text-sm">
                    <span className={cn("size-2 shrink-0 rounded-full", getSource(s.source).dot)} />
                    <span className="w-28 shrink-0 text-muted">{getSource(s.source).label}</span>
                    <a
                      href={sourcePackageUrl(s.source, s.packageId)}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-mono text-xs text-fg hover:text-accent hover:underline"
                    >
                      {s.packageId}
                    </a>
                    {s.size ? (
                      <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">
                        {formatSizeText(s.size, language)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </InfoItem>
          )}
          {entry.tags.length > 0 && (
            <InfoItem label={t("package.tags")}>
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <Link
                    key={tag}
                    to={`/search?q=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted transition-colors hover:bg-surface-3 hover:text-fg"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            </InfoItem>
          )}
        </dl>
      </section>

      {/* ── Alternativy (kurátorský výběr, např. Steam → Epic, GOG) ── */}
      {alternatives.length > 0 && (
        <Shelf title={t("package.alternatives", { name: entry.name })} large>
          {alternatives.map((p) => (
            <ShelfItem key={p.id}>
              <PackageCard entry={p} />
            </ShelfItem>
          ))}
        </Shelf>
      )}

      {/* ── Mohlo by se vám také líbit ───────────────────────────── */}
      {similar.length > 0 && (
        <Shelf title={t("package.similar")} large>
          {similar.map((p) => (
            <ShelfItem key={p.id}>
              <PackageCard entry={p} />
            </ShelfItem>
          ))}
        </Shelf>
      )}
    </article>
  );
}

/**
 * Písmo hodnoty podle délky textu: dlouhá verze nebo licence se zmenší, nejdelší
 * text se zalomí nejvýš na dva řádky (výška pruhu zůstane stejná) a pak zkrátí výpustkou.
 */
const statText = (text: string) =>
  text.length <= 9
    ? "text-2xl truncate py-0.5"
    : text.length <= 14
      ? "text-xl truncate py-0.5"
      : "text-[15px] leading-4 line-clamp-2 break-words whitespace-normal";

/**
 * Jeden sloupec pruhu s údaji (popisek / hodnota / podpopisek). Dlouhý text
 * (verze „4.0.1.262721353“, licence „GPL-3.0 or Bitwarden-1.0“) se zmenší
 * a případně zkrátí výpustkou – celý je v bublině – a nikdy nepřeteče do
 * vedlejšího sloupce. Podpopisek je řádek flexboxu: ikona (fajfka ověření)
 * u textu zůstane svisle na středu.
 */
function Stat({ label, sub, children }: { label: string; sub: ReactNode; children: ReactNode }) {
  const text = typeof children === "string" ? children : null;
  return (
    <div className="flex min-w-40 flex-1 flex-col items-center justify-start gap-1.5 overflow-hidden border-l border-line px-4 text-center first:border-l-0">
      <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</span>
      <span className="flex h-8 max-w-full items-center justify-center font-display text-2xl leading-none font-bold text-fg/75">
        {text ? (
          <span className={cn("min-w-0", statText(text))} title={text}>
            {text}
          </span>
        ) : (
          children
        )}
      </span>
      <span className="flex h-4 max-w-full items-center justify-center gap-1 text-xs leading-4 text-muted">
        {typeof sub === "string" ? (
          <span className="min-w-0 truncate" title={sub}>
            {sub}
          </span>
        ) : (
          sub
        )}
      </span>
    </div>
  );
}

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-xs text-muted">{label}</dt>
      <dd className="text-[15px] break-words">{children}</dd>
    </div>
  );
}
