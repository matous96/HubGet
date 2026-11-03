import { useMutation, useQuery } from "@tanstack/react-query";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import {
  AlarmClock,
  AlertTriangle,
  Archive,
  Bell,
  Boxes,
  CheckCircle2,
  Clock,
  Download,
  FileCode2,
  FileJson,
  FlaskConical,
  GraduationCap,
  Heart,
  History,
  Info,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  Mail,
  Palette,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { queryClient, queryKeys } from "@/app/queryClient";
import { Avatar } from "@/components/auth/Avatar";
import { UserModeToggle } from "@/components/home/UserModeToggle";
import { SourceIcon } from "@/components/package/SourceIcon";
import { ReleaseList } from "@/components/layout/ReleaseList";
import { formatPinUntil, unpinLabel } from "@/components/package/UpdatePin";
import { AccentColorRow } from "@/components/settings/AccentColorRow";
import { CommandGuide } from "@/components/settings/CommandGuide";
import { ContactSection } from "@/components/settings/ContactSection";
import { HistorySection } from "@/components/settings/HistorySection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { PackageUpdatesSection } from "@/components/settings/PackageUpdatesSection";
import { SecuritySection } from "@/components/settings/SecuritySection";
import { SettingsSearch } from "@/components/settings/SettingsSearch";
import { SyncCard } from "@/components/settings/SyncCard";
import { Card, Row, Switch, SwitchRow } from "@/components/settings/SettingsUi";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/CollectionToolbar";
import { PageHeader, Spinner } from "@/components/ui/States";
import { useManagerStatus } from "@/hooks/useManagerStatus";
import { overlayOpen } from "@/hooks/useOverlay";
import { useCatalog } from "@/hooks/usePackages";
import { PROFILE_ACCEPT, useProfileTransfer } from "@/hooks/useProfileTransfer";
import { LANGUAGES } from "@/i18n";
import { cn, normalize } from "@/lib/utils";
import { getSource, isTauri, SOURCES } from "@/services/managers";
import { forgetTrace, installTraces } from "@/services/tracker";
import { useAuth } from "@/store/auth";
import { useOnboarding } from "@/store/onboarding";
import { SUPPORT_URL } from "@/config";
import { APP_VERSION } from "@/services/updates";
import { useAppUpdate } from "@/store/appUpdate";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import { snoozeActive, useUpdatePins, type UpdatePin } from "@/store/updatePins";
import { useWhatsNewRequest } from "@/store/whatsNew";
import { CHANGELOG } from "@/data/changelog";
import type { SourceId, ThemeSetting } from "@/types";

/**
 * Podzáložky Nastavení (po vzoru UniGetUI) – vybraná je v adrese
 * (?section=notifications), takže na ni jde odkázat (např. z ikony u hodin).
 */
const SECTIONS = [
  { id: "general", icon: Settings2 },
  { id: "appearance", icon: Palette },
  { id: "updates", icon: RefreshCw },
  { id: "notifications", icon: Bell },
  { id: "history", icon: History },
  { id: "security", icon: ShieldAlert },
  { id: "managers", icon: Boxes },
  { id: "backup", icon: Archive },
  { id: "commands", icon: Terminal },
  { id: "news", icon: Sparkles },
  { id: "contact", icon: Mail },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Sekce, jejichž obsah hledání neprochází – dlouhé texty (poznámky k verzím, příkazy pro
 * terminál, záznamy historie) by k většině dotazů přidaly šum. Najdou se jen podle svého názvu.
 */
const SEARCH_BY_NAME_ONLY: SectionId[] = ["news", "commands", "history"];

/** Obsah sekce Nastavení. */
function SectionContent({ id }: { id: SectionId }) {
  switch (id) {
    case "general":
      return <GeneralSection />;
    case "appearance":
      return <AppearanceSection />;
    case "updates":
      return (
        <>
          <PackageUpdatesSection />
          <PinsCard />
        </>
      );
    case "notifications":
      return <NotificationsSection />;
    case "history":
      return <HistorySection />;
    case "security":
      return <SecuritySection />;
    case "managers":
      return <ManagersSection />;
    case "backup":
      return (
        <>
          <BackupCard />
          <CatalogCard />
        </>
      );
    case "commands":
      return <CommandGuide placeholders />;
    case "news":
      return <NewsSection />;
    case "contact":
      return <ContactSection />;
  }
}

/** Nastavení: podzáložky vlevo (nad nimi hledání), obsah vybrané vpravo. */
export function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get("section");
  const section: SectionId = SECTIONS.some((s) => s.id === requested) ? (requested as SectionId) : "general";
  const [query, setQuery] = useState("");
  const searching = normalize(query.trim()).length >= 2;
  const searchInput = useRef<HTMLInputElement>(null);

  const open = (id: SectionId) => {
    setQuery("");
    setParams(id === "general" ? {} : { section: id }, { replace: true });
  };

  // Ctrl+F v Nastavení hledá v nastavení – dřív než zkratka hlavního hledání (TopBar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && !overlayOpen()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div>
      <PageHeader title={t("settings.title")} />
      <div className="flex items-start gap-8">
        <nav className="sticky top-2 flex w-60 shrink-0 flex-col gap-0.5" aria-label={t("settings.title")}>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={t("settings.searchPlaceholder")}
              aria-label={t("settings.searchPlaceholder")}
              className="h-10 w-full rounded-xl border border-line bg-surface pr-9 pl-9 text-sm outline-none placeholder:text-muted focus:border-accent/60 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchInput.current?.focus();
                }}
                aria-label={t("settings.searchClear")}
                title={t("settings.searchClear")}
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {SECTIONS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => open(id)}
              aria-current={!searching && section === id ? "page" : undefined}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
                !searching && section === id ? "bg-accent/12 text-accent" : "text-fg/80 hover:bg-surface-2 hover:text-fg",
              )}
            >
              {/* Nebezpečná nastavení: žlutý je jen štít s vykřičníkem, text jako u ostatních položek */}
              <Icon className={cn("size-[18px] shrink-0", id === "security" && "text-amber-500 dark:text-amber-400")} />
              {t(`settingsNav.${id}`)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 max-w-3xl flex-1">
          {searching ? (
            <SettingsSearch query={query}>
              {SECTIONS.map(({ id }) => (
                <div key={id} data-settings-section className="mb-8">
                  {/* Název sekce – kliknutím se sekce otevře a hledání skončí */}
                  <button
                    type="button"
                    data-settings-section-title
                    onClick={() => open(id)}
                    className="mb-4 cursor-pointer font-display text-2xl font-bold transition-colors hover:text-accent"
                  >
                    {t(`settingsNav.${id}`)}
                  </button>
                  {/* Sekce prohledávané jen podle názvu: obsah až po shodě v názvu (filtr ji jinak skryje) */}
                  {(!SEARCH_BY_NAME_ONLY.includes(id) || normalize(t(`settingsNav.${id}`)).includes(normalize(query.trim()))) && (
                    <SectionContent id={id} />
                  )}
                </div>
              ))}
            </SettingsSearch>
          ) : (
            <>
              <h2 className="mb-4 font-display text-2xl font-bold">{t(`settingsNav.${section}`)}</h2>
              <SectionContent id={section} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Novinky: co přinesla každá verze (data/changelog.ts) a znovu otevření okna
 * „Co je nového“ – pro případ, že ho uživatel po aktualizaci omylem zavřel.
 */
function NewsSection() {
  const { t } = useTranslation();
  const showWhatsNew = useWhatsNewRequest((s) => s.show);

  return (
    <>
      <Card>
        <Row label={t("settings.newsCurrent", { version: APP_VERSION })} hint={t("settings.newsCurrentHint")}>
          <Button variant="secondary" size="sm" onClick={showWhatsNew}>
            <Sparkles className="size-3.5" />
            {t("settings.newsOpen")}
          </Button>
        </Row>
      </Card>
      <Card title={t("settings.newsHistory")}>
        <div className="px-4 py-4">
          <ReleaseList releases={CHANGELOG} />
        </div>
      </Card>
    </>
  );
}

/** Obecné: upozornění na režim, účet a chování desktopové aplikace. */
function GeneralSection() {
  const { t } = useTranslation();
  const { closeToTray, setCloseToTray, trayBadge, setTrayBadge } = useSettings();
  const showOnboarding = useOnboarding((s) => s.show);

  return (
    <>
      {isTauri() ? (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-700 dark:text-sky-300">
          <Info className="size-4 shrink-0" />
          {t("settings.desktopNotice")}
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <FlaskConical className="size-4 shrink-0" />
          {t("settings.mockNotice")}
        </div>
      )}

      <AccountCard />
      <SyncCard />

      <Card title={t("onboarding.settingsTitle")}>
        <Row label={t("onboarding.settingsRow")} hint={t("onboarding.settingsHint")}>
          <Button variant="secondary" size="sm" onClick={showOnboarding}>
            <GraduationCap className="size-3.5" />
            {t("onboarding.settingsButton")}
          </Button>
        </Row>
      </Card>

      {isTauri() && (
        <Card title={t("settings.desktop")}>
          <AutostartRow />
          <Row label={t("settings.closeToTray")} hint={t("settings.closeToTrayHint")}>
            <Switch checked={closeToTray} onChange={setCloseToTray} label={t("settings.closeToTray")} />
          </Row>
          <Row label={t("settings.trayBadge")} hint={t("settings.trayBadgeHint")}>
            <Switch checked={trayBadge} onChange={setTrayBadge} label={t("settings.trayBadge")} />
          </Row>
          <AppUpdateRows />
        </Card>
      )}

      {isTauri() && <UninstallCard />}

      {SUPPORT_URL && <SupportCard />}
    </>
  );
}

/** Nenápadná možnost podpořit vývoj – jen odkaz na konci Obecných, žádné připomínání. */
function SupportCard() {
  const { t } = useTranslation();
  return (
    <Card title={t("settings.support")}>
      <Row label={t("settings.supportRow")} hint={t("settings.supportHint")}>
        {/* Odkaz ven otevře systémový prohlížeč (useExternalLinks) */}
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-surface-3"
        >
          <Heart className="size-3.5 text-rose-500" />
          {t("settings.supportButton")}
        </a>
      </Row>
    </Card>
  );
}

/**
 * Odinstalace a běžící aplikace: ukončování procesů na pozadí před operací,
 * pokročilá odinstalace se skenem zbytků (registr a soubory) a její
 * automatický režim (jen se zapnutou pokročilou odinstalací).
 */
function UninstallCard() {
  const { t } = useTranslation();
  const {
    closeBackgroundProcesses,
    setCloseBackgroundProcesses,
    forceCloseRunning,
    setForceCloseRunning,
    advancedUninstall,
    setAdvancedUninstall,
    autoCleanup,
    setAutoCleanup,
    trackInstalls,
    setTrackInstalls,
  } = useSettings();

  return (
    <Card title={t("settings.uninstall")}>
      <SwitchRow
        label={t("settings.closeBackgroundProcesses")}
        hint={t("settings.closeBackgroundProcessesHint")}
        checked={closeBackgroundProcesses}
        onChange={setCloseBackgroundProcesses}
      />
      <SwitchRow
        label={t("settings.forceCloseRunning")}
        hint={t("settings.forceCloseRunningHint")}
        checked={forceCloseRunning}
        onChange={setForceCloseRunning}
      />
      <SwitchRow
        label={t("settings.advancedUninstall")}
        hint={t("settings.advancedUninstallHint")}
        checked={advancedUninstall}
        onChange={setAdvancedUninstall}
      />
      <div className="pl-6">
        <SwitchRow
          label={t("settings.autoCleanup")}
          hint={t("settings.autoCleanupHint")}
          checked={advancedUninstall && autoCleanup}
          onChange={setAutoCleanup}
          disabled={!advancedUninstall}
        />
      </div>
      {isTauri() && (
        <>
          <SwitchRow label={t("settings.trackInstalls")} hint={t("settings.trackInstallsHint")} checked={trackInstalls} onChange={setTrackInstalls} />
          <TracesRow />
        </>
      )}
    </Card>
  );
}

/** Zaznamenané instalace (sledování instalace) – přehled a zapomenutí záznamu. */
function TracesRow() {
  const { t, i18n } = useTranslation();
  const traces = useQuery({ queryKey: queryKeys.installTraces, queryFn: installTraces });
  const forget = useMutation({
    mutationFn: forgetTrace,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.installTraces }),
  });
  const list = traces.data ?? [];
  if (!list.length) return null;

  return (
    <div className="px-4 py-3.5">
      <p className="text-sm font-medium">{t("settings.traces", { count: list.length })}</p>
      <p className="mt-0.5 text-xs text-muted">{t("settings.tracesHint")}</p>
      <ul className="mt-2.5 flex flex-col gap-1">
        {list.map((trace) => (
          <li key={trace.key} className="flex items-center justify-between gap-4 rounded-xl bg-surface-2/60 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{trace.appName}</p>
              <p className="truncate text-xs text-muted">
                {t("settings.traceItems", { folders: trace.folders, keys: trace.keys })} ·{" "}
                {new Date(trace.updatedAt * 1000).toLocaleDateString(i18n.language)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => forget.mutate(trace.key)} disabled={forget.isPending}>
              {t("settings.forgetTrace")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vzhled: motiv, barva zvýraznění, jazyk a režim uživatele. */
function AppearanceSection() {
  const { t } = useTranslation();
  const { theme, setTheme, language, setLanguage } = useSettings();
  const themes: ThemeSetting[] = ["system", "dark", "light"];
  const themeLabel = { system: t("settings.themeSystem"), dark: t("settings.themeDark"), light: t("settings.themeLight") };

  return (
    <Card title={t("settings.appearance")}>
      <Row label={t("settings.theme")} hint={t("settings.themeHint")}>
        <Segmented value={theme} onChange={setTheme} options={themes.map((v) => ({ value: v, label: themeLabel[v] }))} />
      </Row>
      <AccentColorRow />
      <Row label={t("settings.language")}>
        {/* Sedm jazyků se do přepínače nevejde – rozbalovací seznam */}
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          aria-label={t("settings.language")}
          className="h-9 w-48 cursor-pointer rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent/50"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("userMode.label")} hint={t("userMode.settingsHint")}>
        <UserModeToggle />
      </Row>
    </Card>
  );
}

/** Správci balíčků: stav, instalace a zapnutí; preferovaný zdroj. */
function ManagersSection() {
  const { t } = useTranslation();
  const { enabledSources, preferredSource, setPreferredSource, userMode, setUserMode } = useSettings();

  return (
    <Card title={t("settings.managers")}>
      {/* Správci aplikací a správci pro vývojáře */}
      {(["apps", "dev"] as const).map((group) => (
        <Fragment key={group}>
          <p className="px-4 pt-4 pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{t(`sources.group.${group}`)}</p>
          {/* Správci pro vývojáře se v režimu Běžný uživatel nepoužívají (store/settings.ts → activeSources) */}
          {group === "dev" && userMode !== "developer" && (
            <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent/10 px-3 py-2.5 text-xs">
              <span className="min-w-0 flex-1">{t("settings.devModeOnly")}</span>
              <Button size="sm" variant="secondary" onClick={() => setUserMode("developer")}>
                {t("settings.switchToDeveloper")}
              </Button>
            </div>
          )}
          {SOURCES.filter((s) => s.group === group).map((s) => (
            <ManagerRow key={s.id} source={s.id} />
          ))}
        </Fragment>
      ))}
      {/* Preferovaný zdroj má smysl jen mezi správci aplikací */}
      <Row label={t("settings.preferredSource")} hint={t("settings.preferredSourceHint")}>
        <Segmented
          value={preferredSource}
          onChange={setPreferredSource}
          options={enabledSources.filter((id) => getSource(id).group === "apps").map((id) => ({ value: id, label: getSource(id).label }))}
        />
      </Row>
    </Card>
  );
}

/** Katalog: zdroj, počet aplikací, kdy byl vylepšen a nové načtení. */
function CatalogCard() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { data: catalog, refetch, isFetching } = useCatalog();

  return (
    <Card title={t("settings.catalog")}>
      <Row label={t("settings.catalogSource")}>
        <span className="text-sm">{catalog ? t(`settings.catalogSource_${catalog.source}`) : "—"}</span>
      </Row>
      <Row label={t("settings.catalogPackages")}>
        <span className="text-sm tabular-nums">{catalog ? catalog.catalog.packages.length.toLocaleString(language) : "—"}</span>
      </Row>
      <Row label={t("settings.catalogGenerated")}>
        <span className="text-sm">{catalog ? new Date(catalog.catalog.generatedAt).toLocaleDateString(language) : "—"}</span>
      </Row>
      <Row label="">
        <Button variant="secondary" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {t("settings.catalogReload")}
        </Button>
      </Row>
    </Card>
  );
}

/** Účet: přihlášený uživatel s odhlášením, jinak výzva k přihlášení. */
function AccountCard() {
  const { t } = useTranslation();
  const { user, openLogin, signOut } = useAuth();

  return (
    <Card title={t("auth.account")}>
      {user ? (
        <div className="flex items-center justify-between gap-6 px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar user={user} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted">
                {user.email} · {t("auth.via", { provider: { github: "GitHub", microsoft: "Microsoft", google: "Google" }[user.provider] })}
              </p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={() => void signOut()}>
            <LogOut className="size-3.5" />
            {t("auth.signOut")}
          </Button>
        </div>
      ) : (
        <Row label={t("auth.notSignedIn")} hint={t("auth.reasonGeneral")}>
          <Button size="sm" onClick={() => openLogin()}>
            <LogIn className="size-3.5" />
            {t("auth.signIn")}
          </Button>
        </Row>
      )}
    </Card>
  );
}

/**
 * Spouštění při startu Windows (tauri-plugin-autostart – záznam v registru
 * HKCU\…\Run). Po přihlášení se HubGet spustí schovaný v oznamovací oblasti
 * a hlídá aktualizace; stav se čte přímo z registru.
 */
function AutostartRow() {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const { data: enabled, isLoading, refetch } = useQuery({ queryKey: ["autostart"], queryFn: isAutostartEnabled });
  const toggle = useMutation({
    mutationFn: (value: boolean) => (value ? enableAutostart() : disableAutostart()),
    onSettled: () => void refetch(),
    onError: () => toast("error", t("settings.autostartFailed")),
  });

  return (
    <Row label={t("settings.autostart")} hint={t("settings.autostartHint")}>
      <Switch
        checked={toggle.isPending ? !!toggle.variables : !!enabled}
        disabled={isLoading || toggle.isPending}
        onChange={(value) => toggle.mutate(value)}
        label={t("settings.autostart")}
      />
    </Row>
  );
}

/** Aktualizace HubGetu: verze, ruční kontrola a automatická kontrola při spuštění. */
function AppUpdateRows() {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const { checking, autoCheck, setAutoCheck, check } = useAppUpdate();

  const checkNow = async () => {
    const result = await check(true);
    if (result === "current") toast("success", t("menu.upToDate", { version: APP_VERSION }));
    else if (result === "error") toast("error", t("menu.updateFailed"));
  };

  return (
    <>
      <Row label={t("appUpdate.version", { version: APP_VERSION })} hint={t("appUpdate.versionHint")}>
        <Button variant="secondary" size="sm" disabled={checking} onClick={() => void checkNow()}>
          {checking ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          {t("menu.checkUpdates")}
        </Button>
      </Row>
      <Row label={t("appUpdate.auto")} hint={t("appUpdate.autoHint")}>
        <Switch checked={autoCheck} onChange={setAutoCheck} label={t("appUpdate.auto")} />
      </Row>
    </>
  );
}

/**
 * Záloha a přenos aplikací: export profilu (aplikace i s nastavením – JSON,
 * nebo přehledná stránka HTML), soubor pro `winget import` a import – dialog
 * se souhrnem nainstaluje chybějící aplikace jedním kliknutím.
 */
function BackupCard() {
  const { t } = useTranslation();
  const { portableCount, wingetCount, exportProfile, exportWinget, importFile } = useProfileTransfer();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <Card title={t("settings.backup")}>
      <Row label={t("settings.exportHubGet")} hint={t("settings.exportHubGetHint", { count: portableCount })}>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" disabled={!portableCount} onClick={() => void exportProfile("json")}>
            <Download className="size-3.5" />
            JSON
          </Button>
          <Button variant="secondary" size="sm" disabled={!portableCount} onClick={() => void exportProfile("html")}>
            <FileCode2 className="size-3.5" />
            HTML
          </Button>
        </div>
      </Row>
      <Row label={t("settings.exportWinget")} hint={t("settings.exportWingetHint", { count: wingetCount })}>
        <Button variant="secondary" size="sm" disabled={!wingetCount} onClick={() => void exportWinget()}>
          <FileJson className="size-3.5" />
          {t("settings.exportButton")}
        </Button>
      </Row>
      <Row label={t("settings.importApps")} hint={t("settings.importAppsHint")}>
        <Button size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="size-3.5" />
          {t("settings.importButton")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={PROFILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = "";
          }}
        />
      </Row>
    </Card>
  );
}

/** Ignorované, přeskočené a odložené aktualizace – přehled se zrušením. */
function PinsCard() {
  const { t, i18n } = useTranslation();
  const { pins, unpin } = useUpdatePins();
  const entries = Object.entries(pins)
    .filter(([, pin]) => snoozeActive(pin))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));

  const describe = (pin: UpdatePin) =>
    pin.kind === "lock"
      ? t("pins.lockedAll")
      : pin.kind === "snooze"
        ? t("pins.snoozedUntil", { date: formatPinUntil(pin.until, i18n.language) })
        : t("pins.skippedVersion", { version: pin.version });

  return (
    <Card title={t("pins.title")}>
      {entries.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">{t("pins.empty")}</p>
      ) : (
        entries.map(([key, pin]) => (
          <div key={key} className="flex items-center justify-between gap-6 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {pin.kind === "lock" ? (
                <Lock className="size-4 shrink-0 text-amber-500" />
              ) : pin.kind === "snooze" ? (
                <AlarmClock className="size-4 shrink-0 text-accent" />
              ) : (
                <SkipForward className="size-4 shrink-0 text-muted" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{pin.name}</p>
                <p className="truncate text-xs text-muted">
                  {describe(pin)} · {key}
                </p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => unpin(key)}>
              <LockOpen className="size-3.5" />
              {t(unpinLabel(pin.kind))}
            </Button>
          </div>
        ))
      )}
    </Card>
  );
}

/** Jeden správce balíčků: stav v systému, instalace správce a zapnutí/vypnutí. */
function ManagerRow({ source }: { source: SourceId }) {
  const { t } = useTranslation();
  const meta = getSource(source);
  const enabled = useSettings((s) => s.enabledSources.includes(source));
  const enabledCount = useSettings((s) => s.enabledSources.length);
  const toggleSource = useSettings((s) => s.toggleSource);
  const { status, setup, canSetup } = useManagerStatus(source);

  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3.5">
        {/* Ikona správce s barevnou tečkou zdroje */}
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg/80">
          <SourceIcon source={source} />
          <span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface", meta.dot)} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {meta.label}
            {meta.needsAdmin && <span className="ml-2 text-xs font-normal text-muted">{t("settings.needsAdmin")}</span>}
          </p>
          <p className="text-xs text-muted">{t(`sources.desc.${source}`)}</p>
          {setup.isError && (
            <p className="mt-0.5 text-xs text-danger">{setup.error instanceof Error ? setup.error.message : String(setup.error)}</p>
          )}
          {status.isLoading ? (
            <Spinner className="mt-0.5 size-3.5" />
          ) : status.data?.available ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="size-3.5" />
              {t("settings.managerInstalled", { version: status.data.version })}
            </p>
          ) : status.data?.planned ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <Clock className="size-3.5" />
              {t("settings.managerPlanned")}
            </p>
          ) : (
            <>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-danger">
                <AlertTriangle className="size-3.5" />
                {t("settings.managerMissing")}
              </p>
              {!canSetup && <p className="mt-0.5 text-xs text-muted">{t(`managerSetup.how_${source}`)}</p>}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {status.data && !status.data.available && !status.data.planned && canSetup && (
          <Button size="sm" disabled={setup.isPending} onClick={() => setup.mutate()}>
            {setup.isPending ? <Spinner className="size-3.5 text-accent-fg" /> : null}
            {t("settings.installManager", { name: meta.label })}
          </Button>
        )}
        <Switch
          checked={enabled}
          // Poslední zapnutého správce nelze vypnout
          disabled={enabled && enabledCount === 1}
          label={meta.label}
          onChange={(value) => toggleSource(source, value)}
        />
      </div>
    </div>
  );
}

