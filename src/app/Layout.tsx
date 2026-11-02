import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type ComponentType, type ReactNode } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router";
import { LoginDialog } from "@/components/auth/LoginDialog";
import { OnboardingDialog } from "@/components/layout/OnboardingDialog";
import { DevSourceOverview } from "@/components/home/DevSourceOverview";
import { OfflineBar } from "@/components/layout/OfflineBar";
import { SelectionBar } from "@/components/layout/SelectionBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { SourceLockBar } from "@/components/layout/SourceLockBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { Toasts } from "@/components/layout/Toasts";
import { TopBar } from "@/components/layout/TopBar";
import { UpdateDialog } from "@/components/layout/UpdateDialog";
import { WhatsNewDialog } from "@/components/layout/WhatsNewDialog";
import { PackageContextMenuHost } from "@/components/package/InstallMenu";
import { InstallOptionsDialog } from "@/components/package/InstallOptionsDialog";
import { ErrorBoundary, PageCrash } from "@/components/ui/ErrorBoundary";
import { Tooltips } from "@/components/ui/Tooltip";
import { AppInUseDialog, AppRunningDialog } from "@/components/package/AppInUseDialog";
import { FallbackOfferDialog } from "@/components/package/FallbackOfferDialog";
import { LeftoversDialog } from "@/components/package/LeftoversDialog";
import { ManagerSetupDialog } from "@/components/package/ManagerSetupDialog";
import { ManualInstallDialog } from "@/components/package/ManualInstallDialog";
import { ProfileImportDialog } from "@/components/package/ProfileImportDialog";
import { useAutoUpdateScheduler } from "@/hooks/useAutoUpdates";
import { useDeepLinks } from "@/hooks/useDeepLinks";
import { useDesktopIntegration } from "@/hooks/useDesktopIntegration";
import { useSecurityPolicySync } from "@/hooks/useSecurityPolicySync";
import { useExternalLinks } from "@/hooks/useExternalLinks";
import { usePackageIndexSync } from "@/hooks/usePackageIndexSync";
import { ScrollContainerContext, scrollRestore } from "@/hooks/useScrollContainer";
import { useTheme } from "@/hooks/useTheme";
import { isTauri } from "@/lib/tauri";
import { isDevLock, useSourceScope } from "@/store/sourceLock";

/**
 * Služby na pozadí bez vlastního obsahu. Jsou ve vlastní komponentě, protože
 * sledují často se měnící stav (fronta operací, nainstalované aplikace) – jejich
 * překreslení se tak netýká celého okna se stránkou.
 */
function BackgroundServices() {
  // Zavření do oznamovací oblasti, texty a stav její ikony
  useDesktopIntegration();
  // Oprávnění správce a nebezpečná nastavení → backend; kontrola a instalace aktualizací na pozadí
  useSecurityPolicySync();
  useAutoUpdateScheduler();
  // Odkazy unibox:// z webu a sdílených sad
  useDeepLinks();
  // Indexy nainstalovaných, katalogu a nabídky Start pro karty (jednou pro celé okno)
  usePackageIndexSync();
  return null;
}

/** Přehledy katalogu, které při zámku na správce pro vývojáře nahradí jeho přehled. */
const DEV_OVERVIEW_PAGES = /^\/($|categories|top|recent|favorites)/;

/**
 * Obsah stránky. Katalog aplikací balíčky z npm, pip, Cargo… nemá – při zámku
 * na takového správce (levý panel) by domovská stránka, kategorie a žebříčky
 * byly prázdné, proto ukážou přehled správce (nainstalované, hledání v registru).
 */
function PageContent({ pathname }: { pathname: string }) {
  const { lock } = useSourceScope();
  return isDevLock(lock) && DEV_OVERVIEW_PAGES.test(pathname) ? <DevSourceOverview source={lock} /> : <Outlet />;
}

/** Hlavní rozvržení okna: (titulková lišta) + postranní panel + horní lišta + obsah stránky. */
export function Layout() {
  useTheme();
  // V desktopové aplikaci otevírat odkazy ven v systémovém prohlížeči
  useExternalLinks();
  const desktop = isTauri();
  const location = useLocation();
  const navigationType = useNavigationType();
  const scroller = useRef<HTMLElement>(null);

  // Posun stránky podle záznamu historie – Zpět / Vpřed ho obnoví (jako v prohlížeči)
  const positions = useRef(new Map<string, number>());
  const currentKey = useRef(location.key);
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => positions.current.set(currentKey.current, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Cíl obnovení musí znát už virtualizované seznamy nové stránky – připojí se dřív než efekt níže
  if (location.key !== currentKey.current) {
    scrollRestore.target = navigationType === "POP" ? (positions.current.get(location.key) ?? null) : null;
  }

  // Nová stránka začíná nahoře (psaní ve vyhledávání ani filtry v adrese posun nemění);
  // při návratu Zpět / Vpřed se obnoví uložený posun. Klíč se přepne v layout efektu,
  // dřív než přijde událost scroll z kratšího obsahu nové stránky.
  useLayoutEffect(() => {
    currentKey.current = location.key;
    const pageChanged = lastPath.current !== location.pathname;
    lastPath.current = location.pathname;
    const el = scroller.current;
    const saved = scrollRestore.target;
    if (!el || saved === null) {
      scrollRestore.target = null;
      if (pageChanged) el?.scrollTo({ top: 0 });
      // Nahrazená adresa (filtr) bez dalšího posunu by jinak neměla uloženou pozici pro Zpět
      if (el) positions.current.set(location.key, el.scrollTop);
      return;
    }
    // Seznam se dorovnává (virtualizace, data z mezipaměti) – zkoušet, dokud je stránka
    // dost vysoká (nejvýš ~1 s); otočení kolečkem obnovení zastaví
    let frame = 0;
    let tries = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      scrollRestore.target = null;
    };
    const restore = () => {
      el.scrollTop = saved;
      if (Math.abs(el.scrollTop - saved) > 1 && tries++ < 60) frame = requestAnimationFrame(restore);
      else scrollRestore.target = null;
    };
    el.addEventListener("wheel", finish, { once: true, passive: true });
    restore();
    return () => {
      finish();
      el.removeEventListener("wheel", finish);
    };
  }, [location.key]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Isolated name="BackgroundServices">
        <BackgroundServices />
      </Isolated>
      {/* Desktop: okno bez systémových dekorací má vlastní titulkovou lištu */}
      {desktop && <TitleBar />}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {/* Režim jednoho zdroje (levý panel) – indikátor se zrušením filtru */}
          <SourceLockBar />
          {/* Ztráta připojení – co funguje dál a co počká */}
          <OfflineBar />
          {/* Stálé místo pro posuvník – obsah při přechodu mezi krátkou a dlouhou stránkou neuskočí do strany */}
          <main ref={scroller} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {/* Při změně stránky jen krátké prolnutí, bez posunu – okno reaguje svižně jako nativní
                aplikace. Obsah využívá celou šířku okna – mřížky karet přidávají sloupce (auto-fill). */}
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="px-6 pt-2 pb-12 lg:px-8 2xl:px-10"
            >
              {/* Spadne-li stránka, zbytek okna běží dál; přechod na jinou stránku chybu zapomene */}
              <ErrorBoundary
                name={`page ${location.pathname}`}
                resetKey={location.pathname}
                fallback={(error, reset) => <PageCrash error={error} reset={reset} />}
              >
                {/* Virtualizované seznamy aplikací počítají viditelné položky podle posuvné oblasti */}
                <ScrollContainerContext value={scroller}>
                  <PageContent pathname={location.pathname} />
                </ScrollContainerContext>
              </ErrorBoundary>
            </motion.div>
          </main>
        </div>
      </div>
      {/* Dialogy a lišty – každý zvlášť: chyba v jednom nevypne ostatní (vadný jen zmizí) */}
      {OVERLAYS.map(([name, Overlay]) => (
        <Isolated key={name} name={name}>
          <Overlay />
        </Isolated>
      ))}
    </div>
  );
}

/**
 * Dialogy a lišty nad oknem (každý si stav drží ve vlastním store):
 * oznámení v rohu, bubliny s popisky (title), hromadné akce (useSelection), přihlášení (useAuth), možnosti
 * a ruční instalace s kontextovou nabídkou (useInstallUi), zbytky po odinstalaci
 * (useLeftovers), import profilu, chybějící správce, běžící aplikace, nabídka
 * jiného zdroje, nová verze HubGetu, novinky a úvodní průvodce.
 */
const OVERLAYS: [string, ComponentType][] = [
  ["Toasts", Toasts],
  ["Tooltips", Tooltips],
  ["SelectionBar", SelectionBar],
  ["LoginDialog", LoginDialog],
  ["InstallOptionsDialog", InstallOptionsDialog],
  ["ManualInstallDialog", ManualInstallDialog],
  ["PackageContextMenuHost", PackageContextMenuHost],
  ["LeftoversDialog", LeftoversDialog],
  ["ProfileImportDialog", ProfileImportDialog],
  ["ManagerSetupDialog", ManagerSetupDialog],
  ["AppInUseDialog", AppInUseDialog],
  ["AppRunningDialog", AppRunningDialog],
  ["FallbackOfferDialog", FallbackOfferDialog],
  ["UpdateDialog", UpdateDialog],
  ["WhatsNewDialog", WhatsNewDialog],
  ["OnboardingDialog", OnboardingDialog],
];

/** Část okna, jejíž chyba se zapíše a nic dalšího neshodí (bez náhradního obsahu). */
function Isolated({ name, children }: { name: string; children: ReactNode }) {
  const { pathname } = useLocation();
  // Po přechodu na jinou stránku to zkusí znovu
  return (
    <ErrorBoundary name={name} resetKey={pathname}>
      {children}
    </ErrorBoundary>
  );
}
