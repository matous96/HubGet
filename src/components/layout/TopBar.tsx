import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { IconButton } from "@/components/ui/Button";
import { CommunityBar } from "./CommunityBar";
import { overlayOpen } from "@/hooks/useOverlay";
import { catalogSearchIndex, useCatalog, useInstallableStats } from "@/hooks/usePackages";
import { getSource } from "@/services/managers";
import { formatAppCount, formatCompactCount } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useSourceScope } from "@/store/sourceLock";
import type { SourceId } from "@/types";

/**
 * Horní lišta: navigace zpět/vpřed a globální vyhledávání.
 * Psaní do pole průběžně přepisuje URL /search?q=…, výsledky se tak
 * zobrazují už během psaní. Ctrl+K nebo Ctrl+F pole aktivuje.
 */
export function TopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchPage = location.pathname === "/search";
  const [value, setValue] = useState(onSearchPage ? (params.get("q") ?? "") : "");
  const language = useSettings((s) => s.language);
  const stats = useInstallableStats();
  const { data: catalog } = useCatalog();

  // Zástupný text s počtem aplikací („Prohledat 15 650+ aplikací“)
  // a nápověda s rozpisem podle správců („winget 12 400 · Chocolatey 9 800 · …“).
  // Při zamčeném zdroji (levý panel) se hledá jen v něm (počet aplikací ukazuje lišta pod horní lištou)
  const { lock } = useSourceScope();
  const placeholder = lock
    ? t("search.placeholderSource", { source: getSource(lock).label })
    : stats.loaded
      ? t("search.placeholderCount", { count: stats.total, formatted: formatAppCount(stats.total, language) })
      : t("search.placeholder");
  const breakdown = (Object.entries(stats.bySource) as [SourceId, number][])
    .map(([id, n]) => `${getSource(id).label} ${formatCompactCount(n, language)}`)
    .join(" · ");

  // Pole odpovídá dotazu v adrese: hledání z odkazu (štítek, oblíbený balíček) ho vyplní,
  // po odchodu ze stránky vyhledávání se vyprázdní. Při psaní je dotaz v adrese stejný.
  const urlQuery = onSearchPage ? (params.get("q") ?? "") : "";
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  // Klávesová zkratka pro vyhledávání.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Pod otevřeným dialogem ne – fokus by skončil ve skrytém poli a psaní by měnilo stránku pod ním
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "f") && !overlayOpen()) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (next: string) => {
    setValue(next);
    // Na stránce hledání nahrazujeme historii, ať „Zpět“ neprochází každé písmeno.
    navigate(`/search?q=${encodeURIComponent(next)}`, { replace: onSearchPage });
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 px-6">
      <div className="flex gap-1">
        <IconButton aria-label={t("common.back")} title={t("common.back")} onClick={() => navigate(-1)}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <IconButton aria-label={t("common.forward")} title={t("common.forward")} onClick={() => navigate(1)}>
          <ChevronRight className="size-5" />
        </IconButton>
      </div>

      <div className="relative mx-auto w-full max-w-xl min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => update(e.target.value)}
          // Escape smaže dotaz; prázdné pole jen opustí – jinak by Escape na jiné stránce (detail aplikace)
          // přepnul na prázdnou stránku hledání
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            if (value) update("");
            else e.currentTarget.blur();
          }}
          // Index pro vyhledávání připravit hned při kliknutí do pole, ne až při prvním písmenu
          onFocus={() => catalog && requestIdleCallback(() => catalogSearchIndex(catalog), { timeout: 300 })}
          placeholder={placeholder}
          title={breakdown}
          aria-label={t("search.placeholder")}
          spellCheck={false}
          className="h-10 w-full rounded-full border border-line bg-surface pr-20 pl-10 text-sm text-ellipsis shadow-sm outline-none transition-shadow placeholder:text-muted focus:border-accent/50 focus:ring-4 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {value ? (
            <IconButton aria-label={t("common.close")} className="size-7" onClick={() => update("")}>
              <X className="size-4" />
            </IconButton>
          ) : (
            <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] text-muted">
              Ctrl K
            </kbd>
          )}
        </div>
      </div>

      {/* Open source, komunita a zdroje balíčků */}
      <CommunityBar />
    </header>
  );
}
