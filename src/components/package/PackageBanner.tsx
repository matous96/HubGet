import { Building2, CalendarClock, Cpu, Globe, Package, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { getCategory } from "@/data/categories";
import { allArchitectures, archSummary } from "@/lib/arch";
import { useBrandPalette } from "@/hooks/useBrandPalette";
import { BRAND_SHADE, COLOR_TRANSITION } from "@/lib/color";
import { cn } from "@/lib/utils";
import { getSource, steamAppId } from "@/services/managers";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";
import { Doodles } from "./Doodles";
import { PackageIcon } from "./PackageIcon";

/**
 * Banner v horní části detailu ve stylu App Store:
 * barva značky (nebo dominantní barva ikony), dekorativní vzorek ikon podle
 * kategorie a uprostřed ikona s názvem aplikace. Pokud katalog dodá
 * `bannerUrl`, použije se obrázek.
 */
export function PackageBanner({ entry }: { entry: CatalogEntry }) {
  const { color, light, ink } = useBrandPalette(entry);

  if (entry.bannerUrl) {
    return (
      <div className="relative h-72 overflow-hidden rounded-3xl shadow-card">
        <img src={entry.bannerUrl} alt="" className="size-full object-cover" draggable={false} />
        {/* Ztmavení spodní části kvůli čitelnosti štítků */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
        <BannerMeta entry={entry} ink="#ffffff" />
      </div>
    );
  }

  return (
    <div
      // Zaoblené rohy jako ostatní karty (banner už nesahá až k okrajům okna)
      className="relative flex h-72 items-center justify-center overflow-hidden rounded-3xl shadow-card"
      style={{ backgroundColor: color, backgroundImage: BRAND_SHADE, transition: COLOR_TRANSITION }}
    >
      {/* Vzorek ikon */}
      <Doodles seedKey={entry.id} category={entry.categories[0]} ink={ink} />

      {/* Plocha v barvě banneru za logem, aby vzorek nerušil (maska = měkký okraj) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: color,
          maskImage: "radial-gradient(ellipse 45% 60% at center, black 30%, transparent 100%)",
          transition: COLOR_TRANSITION,
        }}
      />

      {/* Logo: ikona + název (mírně nad středem, dole jsou štítky s informacemi) */}
      <div className="relative -mt-8 flex max-w-[80%] items-center gap-6">
        <PackageIcon
          id={entry.id}
          name={entry.name}
          iconUrl={entry.iconUrl}
          size={96}
          framed
          className="shadow-2xl shadow-black/30"
        />
        <span
          // Vyšší řádkování + padding, aby truncate neořízl ocásky písmen (p, y, g)
          className="cursor-text truncate py-2 font-display text-6xl leading-[1.15] font-bold tracking-tight select-text"
          style={{ color: ink, textShadow: light ? "none" : "0 2px 16px rgb(0 0 0 / 0.2)", transition: COLOR_TRANSITION }}
        >
          {entry.name}
        </span>
      </div>

      <BannerMeta entry={entry} ink={ink} />
    </div>
  );
}

/**
 * Decentní řada štítků ve spodní části banneru se základními informacemi
 * (vydavatel, kategorie, verze, aktualizace, licence, web, zdroje).
 * Barva se odvozuje od `ink`, takže štítky fungují na světlém i tmavém banneru.
 */
function BannerMeta({ entry, ink }: { entry: CatalogEntry; ink: string }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const category = entry.categories[0] ? getCategory(entry.categories[0]) : undefined;

  // Poloprůhledné „sklo“ v barvě textu banneru
  const pill = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm";
  const pillStyle = {
    color: ink,
    background: `color-mix(in srgb, ${ink} 13%, transparent)`,
    border: `1px solid color-mix(in srgb, ${ink} 18%, transparent)`,
  };
  const icon = "size-3 shrink-0 opacity-80";

  return (
    <div className="absolute inset-x-0 bottom-4 flex flex-wrap items-center justify-center gap-2 px-8 opacity-[0.92]">
      {entry.publisher && (
        <span className={pill} style={pillStyle}>
          <Building2 className={icon} />
          {entry.publisher}
        </span>
      )}
      {category && (
        <Link to={`/categories/${category.id}`} className={`${pill} transition-opacity hover:opacity-80`} style={pillStyle}>
          <category.icon className={icon} />
          {t(`categories.${category.id}`)}
        </Link>
      )}
      {entry.latestVersion && (
        <span className={`${pill} tabular-nums`} style={pillStyle}>
          <Package className={icon} />v{entry.latestVersion}
        </span>
      )}
      {entry.releaseDate && (
        <span className={pill} style={pillStyle}>
          <CalendarClock className={icon} />
          {t("banner.updated", {
            date: new Date(entry.releaseDate).toLocaleDateString(language, { day: "numeric", month: "numeric", year: "numeric" }),
          })}
        </span>
      )}
      {entry.license && (
        <span className={`${pill} max-w-64`} style={pillStyle} title={entry.license}>
          <Scale className={icon} />
          <span className="min-w-0 truncate">{entry.license}</span>
        </span>
      )}
      {/* Podporované architektury napříč zdroji, např. „x64 · ARM64 · x86“ */}
      {allArchitectures(entry.sources).length > 0 && (
        <span className={pill} style={pillStyle}>
          <Cpu className={icon} />
          {archSummary(allArchitectures(entry.sources))}
        </span>
      )}
      {entry.homepage && (
        <a
          href={entry.homepage}
          target="_blank"
          rel="noreferrer"
          className={`${pill} transition-opacity hover:opacity-80`}
          style={pillStyle}
        >
          <Globe className={icon} />
          {new URL(entry.homepage).hostname.replace(/^www\./, "")}
        </a>
      )}
      {/* Zdroje – ne u her ze Steamu (winget je jen „vidí“, instalovat je nejde) */}
      {entry.sources.length > 0 && !entry.sources.some((s) => steamAppId(s.packageId)) && (
        <span className={pill} style={pillStyle}>
          {entry.sources.map((s) => (
            <span key={s.source} className="inline-flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", getSource(s.source).dot)} />
              {getSource(s.source).label}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
