import {
  Download,
  Heart,
  History,
  Home,
  LayoutGrid,
  PackagePlus,
  Power,
  RefreshCw,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { HubGetLogo } from "@/components/ui/Logo";
import { AppMenu } from "./AppMenu";
import { SourcesPanel } from "./SourcesPanel";
import { useVisibleCategories } from "@/hooks/useCategories";
import { useInstalledItems } from "@/hooks/useInstalledItems";
import { useInstallableStats } from "@/hooks/usePackages";
import { isTauri, isTestBuild } from "@/lib/tauri";
import { cn, formatAppCount } from "@/lib/utils";
import { APP_VERSION } from "@/services/updates";
import { useBundle } from "@/store/bundle";
import { useFavorites } from "@/store/favorites";
import { useJobs } from "@/store/jobs";
import { useRecent } from "@/store/recent";
import { useSettings } from "@/store/settings";

/** Levý navigační panel: sekce Objevovat, Knihovna a Kategorie, dole nastavení. */
export function Sidebar() {
  const { t } = useTranslation();
  const categories = useVisibleCategories();
  // Počet stejný jako na stránce Nainstalované (bez nespárovaných programů nalezených jen na disku)
  const { data: installed, items: installedItems } = useInstalledItems();
  const updates = installed?.filter((p) => p.availableVersion).length ?? 0;
  const activeJobs = useJobs((s) => Object.keys(s.jobs).length);
  const recentCount = useRecent((s) => s.items.length);
  const favoritesCount = useFavorites((s) => s.items.length);
  const bundleCount = useBundle((s) => s.items.length);
  const stats = useInstallableStats();
  const language = useSettings((s) => s.language);

  return (
    <aside className="theme-transition flex w-64 shrink-0 flex-col border-r border-line bg-sidebar">
      {/* Logo – stejná výška (h-16) a svislý střed jako horní lišta, ať leží v jedné rovině s vyhledáváním */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <Link
          to="/"
          aria-label={t("nav.home")}
          className={cn(
            "shrink-0 rounded-[9px] shadow-lg transition-transform hover:scale-105",
            isTestBuild() ? "shadow-orange-500/30" : "shadow-accent/30",
          )}
        >
          <HubGetLogo size={38} />
        </Link>
        <div className="leading-tight">
          <span className="block font-display text-lg font-bold tracking-tight">{t("app.name")}</span>
          {/* Připomínka, jak velký je výběr */}
          {stats.loaded && stats.total > 0 && (
            <span className="block text-[11px] text-muted tabular-nums">
              {t("stats.sidebar", { formatted: formatAppCount(stats.total, language) })}
            </span>
          )}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <Section title={t("nav.discover")}>
          <NavItem to="/" icon={Home} label={t("nav.home")} exact />
          <NavItem to="/categories" icon={LayoutGrid} label={t("nav.categories")} exact />
          <NavItem to="/top" icon={TrendingUp} label={t("nav.top")} />
          <NavItem
            to="/recent"
            icon={History}
            label={t("nav.recent")}
            badge={recentCount > 0 && <Count>{recentCount}</Count>}
          />
        </Section>

        <Section title={t("nav.library")}>
          <NavItem
            to="/installed"
            icon={Download}
            label={t("nav.installed")}
            badge={
              <>
                {activeJobs > 0 && <span className="size-2 animate-pulse rounded-full bg-accent" />}
                {installed && <Count>{installedItems.length}</Count>}
              </>
            }
          />
          <NavItem
            to="/installed?filter=updates"
            icon={RefreshCw}
            label={t("nav.updates")}
            badge={updates > 0 && <Count highlight>{updates}</Count>}
          />
          <NavItem
            to="/favorites"
            icon={Heart}
            label={t("nav.favorites")}
            badge={favoritesCount > 0 && <Count>{favoritesCount}</Count>}
          />
          <NavItem
            to="/bundles"
            icon={PackagePlus}
            label={t("nav.bundles")}
            badge={bundleCount > 0 && <Count>{bundleCount}</Count>}
          />
          {/* Programy spouštěné po přihlášení (jen desktop) */}
          {isTauri() && <NavItem to="/startup" icon={Power} label={t("nav.startup")} />}
        </Section>

        <Section title={t("nav.categories")}>
          {categories.map(({ id, icon }) => (
            <NavItem key={id} to={`/categories/${id}`} icon={icon} label={t(`categories.${id}`)} accentIcon />
          ))}
        </Section>
      </nav>

      {/* Zdroje balíčků + „Přidat zdroj“, pod nimi nastavení s číslem verze HubGetu */}
      <SourcesPanel />
      <div className="flex items-center gap-1 px-3 pt-1 pb-3">
        <div className="min-w-0 flex-1">
          <NavItem to="/settings" icon={Settings} label={t("nav.settings")} badge={<Count>v{APP_VERSION}</Count>} />
        </div>
        {/* Protokoly, historie, verze, nápověda… */}
        <AppMenu />
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

interface NavItemProps {
  /** Cesta, případně i s parametry (?filter=updates). */
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: ReactNode;
  /** Aktivní jen při přesné shodě cesty (ne pro podstránky). */
  exact?: boolean;
  /** Ikona v barvě akcentu i v neaktivním stavu (kategorie). */
  accentIcon?: boolean;
}

/**
 * Položka navigace. Aktivní stav se počítá ručně, protože NavLink
 * nerozlišuje parametry v URL (Nainstalované vs. Aktualizace).
 */
function NavItem({ to, icon: Icon, label, badge, exact, accentIcon }: NavItemProps) {
  const location = useLocation();
  const [path, query = ""] = to.split("?");
  const currentQuery = location.search.replace(/^\?/, "");
  const pathMatches = exact ? location.pathname === path : location.pathname === path || location.pathname.startsWith(`${path}/`);
  const active = pathMatches && currentQuery === query;

  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-[7px] text-sm font-medium transition-colors",
        active
          ? "border-accent/25 bg-accent/12 text-accent"
          : "border-transparent text-fg/85 hover:bg-surface/60 hover:text-fg",
      )}
    >
      <Icon
        className={cn("size-[18px] shrink-0", active || accentIcon ? "text-accent" : "text-muted")}
        strokeWidth={accentIcon ? 2.25 : 2}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
    </Link>
  );
}

/** Počet vpravo u položky; zvýrazněný = barva akcentu (dostupné aktualizace). */
function Count({ children, highlight }: { children: ReactNode; highlight?: boolean }) {
  return (
    <span className={cn("text-xs tabular-nums", highlight ? "font-bold text-accent" : "text-muted")}>{children}</span>
  );
}
