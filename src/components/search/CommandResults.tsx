/**
 * Akce ve vyhledávání (Ctrl+K): „aktual“ nabídne Aktualizovat vše, „proto“ Protokoly,
 * „motiv“ přepnutí světlého / tmavého režimu, „oznám“ sekci nastavení… Hledá se
 * v názvu akce v jazyce aplikace i v angličtině (zkratky fungují v obou).
 */
import {
  Bell,
  Gauge,
  Download,
  Heart,
  History,
  LayoutGrid,
  type LucideIcon,
  Moon,
  Package,
  Power,
  RefreshCw,
  Settings,
  SquareTerminal,
  Sun,
  TrendingUp,
  CircleQuestionMark,
  Upload,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { queryClient, queryKeys } from "@/app/queryClient";
import { useUpdates } from "@/hooks/useInstalledItems";
import i18n from "@/i18n";
import { isTauri } from "@/lib/tauri";
import { normalize } from "@/lib/utils";
import { useSettings } from "@/store/settings";

interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  /** Klíč textu – kvůli hledání i v angličtině. */
  key: string;
  params?: Record<string, unknown>;
}

const SETTINGS_SECTIONS = ["general", "appearance", "updates", "notifications", "history", "security", "managers", "backup", "commands", "news", "contact"];

/** Nejvíc nabízených akcí. */
const MAX = 6;

export function CommandResults({ query }: { query: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pending, updateAll } = useUpdates();
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const dark = theme === "dark" || (theme === "system" && !window.matchMedia("(prefers-color-scheme: light)").matches);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const list: Command[] = [];
    if (pending > 0) list.push({ id: "update-all", key: "commandSearch.updateAll", params: { count: pending }, icon: RefreshCw, run: updateAll, label: "" });
    list.push(
      {
        id: "check-updates",
        key: "commandSearch.checkUpdates",
        icon: RefreshCw,
        label: "",
        run: () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.installed });
          navigate("/installed?filter=updates");
        },
      },
      { id: "updates", key: "nav.updates", icon: Download, run: go("/installed?filter=updates"), label: "" },
      { id: "installed", key: "nav.installed", icon: Package, run: go("/installed"), label: "" },
      { id: "favorites", key: "nav.favorites", icon: Heart, run: go("/favorites"), label: "" },
      { id: "bundles", key: "nav.bundles", icon: Package, run: go("/bundles"), label: "" },
      { id: "recent", key: "nav.recent", icon: History, run: go("/recent"), label: "" },
      { id: "categories", key: "nav.categories", icon: LayoutGrid, run: go("/categories"), label: "" },
      { id: "top", key: "nav.top", icon: TrendingUp, run: go("/top"), label: "" },
      ...(isTauri() ? [{ id: "startup", key: "nav.startup", icon: Power, run: go("/startup"), label: "" }] : []),
      ...(isTauri() ? [{ id: "overview", key: "nav.overview", icon: Gauge, run: go("/overview"), label: "" }] : []),
      { id: "publish", key: "nav.publish", icon: Upload, run: go("/publish"), label: "" },
      { id: "logs", key: "menu.logs", icon: SquareTerminal, run: go("/logs"), label: "" },
      { id: "help", key: "menu.help", icon: CircleQuestionMark, run: go("/help"), label: "" },
      { id: "theme", key: dark ? "theme.toLight" : "theme.toDark", icon: dark ? Sun : Moon, run: () => setTheme(dark ? "light" : "dark"), label: "" },
      ...SETTINGS_SECTIONS.map((section) => ({
        id: `settings-${section}`,
        key: `settingsNav.${section}`,
        icon: section === "notifications" ? Bell : Settings,
        run: go(`/settings?section=${section}`),
        label: "",
      })),
    );
    return list.map((c) => ({
      ...c,
      label: c.id.startsWith("settings-") ? `${t("nav.settings")}: ${t(c.key)}` : t(c.key, c.params),
    }));
  }, [t, navigate, pending, updateAll, dark, setTheme]);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    return commands
      .map((c) => {
        const texts = [normalize(c.label), normalize(i18n.t(c.key, { ...c.params, lng: "en" }))];
        // Shoda: všechna slova dotazu jsou na začátku některého slova názvu (česky nebo anglicky)
        const hit = texts.some((text) => words.every((w) => text.split(/[\s:()/,–-]+/).some((part) => part.startsWith(w))));
        const starts = texts.some((text) => text.startsWith(q));
        return { c, rank: hit ? (starts ? 2 : 1) : 0 };
      })
      .filter((m) => m.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, MAX)
      .map((m) => m.c);
  }, [commands, query]);

  if (!matches.length) return null;
  return (
    <section className="mb-8" aria-label={t("commandSearch.title")}>
      <h2 className="mb-3 font-display text-lg font-bold">{t("commandSearch.title")}</h2>
      <div className="flex flex-wrap gap-2">
        {matches.map(({ id, label, icon: Icon, run }) => (
          <button
            key={id}
            type="button"
            onClick={run}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium shadow-sm transition-colors hover:border-accent/50 hover:bg-accent/8 hover:text-accent"
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
