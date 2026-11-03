/**
 * Karty sekce „Dnes“ ve stylu App Store:
 *  - AppStoryCard: příběh o jedné aplikaci (grafika z barvy značky, lišta „Zobrazit“),
 *  - AppOfTheDayCard: vodorovná karta „Aplikace dne“,
 *  - CollectionCard: tematická kolekce s řadou ikon a tlačítkem „Instalovat vše“,
 *    kliknutím se otevře detail kolekce (CollectionModal).
 * S `paging` mají příběh a kolekce v rohu šipky ‹ › pro listování dalšími
 * výběry; aplikace dne je jedna na celý den.
 */
import { Check, ChevronLeft, ChevronRight, Download, Star } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Doodles } from "@/components/package/Doodles";
import { PackageAction } from "@/components/package/PackageAction";
import { PackageIcon } from "@/components/package/PackageIcon";
import { NameWithBadge, VerifiedBadge } from "@/components/package/VerifiedBadge";
import { isVerified } from "@/lib/verified";
import { localize, type AppStory, type CollectionStory } from "@/data/editorial";
import { useBrandPalette } from "@/hooks/useBrandPalette";
import { useCollectionInstall } from "@/hooks/useCollectionInstall";
import { useCollectionPalette } from "@/hooks/useCollectionPalette";
import { COLOR_TRANSITION, isNeutralColor } from "@/lib/color";
import { tintOf } from "@/lib/iconTile";
import { cn } from "@/lib/utils";
import { useCollectionModal } from "@/store/collectionModal";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";

/** Poloprůhledná barva textu karty (pro „sklo“ lišt a tlačítek). */
const glass = (ink: string, percent: number) => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;

/** Listování v kartě (předchozí / další výběr). */
export interface CardPaging {
  onPrev: () => void;
  onNext: () => void;
}

/** Šipky ‹ › v pravém horním rohu karty – listují výběrem; klik na ně kartu neotevře. */
function CardPager({ onPrev, onNext, ink }: CardPaging & { ink: string }) {
  const { t } = useTranslation();
  const button = (label: string, action: () => void, Icon: typeof ChevronLeft) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        action();
      }}
      className="flex size-9 cursor-pointer items-center justify-center rounded-full backdrop-blur-md transition-[background-color,transform] hover:scale-105 active:scale-95"
      style={{ background: glass(ink, 16), color: ink }}
    >
      <Icon className="size-5" />
    </button>
  );
  return (
    <div className="absolute top-4 right-4 z-20 flex gap-1.5 opacity-80 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {button(t("home.pagerPrev"), onPrev, ChevronLeft)}
      {button(t("home.pagerNext"), onNext, ChevronRight)}
    </div>
  );
}

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

/**
 * Celá karta aplikace jako jeden klikatelný prvek: klik kamkoli (i na grafiku
 * a dekorace) otevře detail aplikace. Odkazy a tlačítka uvnitř karty mají
 * vlastní akci – jejich klik karta nechá být (jinak by se navigovalo dvakrát).
 */
function useCardClick(id: string) {
  const navigate = useNavigate();
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    navigate(detailUrl(id));
  };
}

/** Společný nadpis karty: malý nadtitulek, velký titulek, podtitulek. */
function StoryText({ eyebrow, title, subtitle, ink, large }: { eyebrow: string; title: string; subtitle: string; ink: string; large?: boolean }) {
  return (
    <div style={{ color: ink }}>
      <p className="text-[11px] font-semibold tracking-[0.12em] uppercase opacity-75">{eyebrow}</p>
      <h2 className={cn("mt-1 font-display leading-[1.1] font-bold tracking-tight", large ? "text-[34px]" : "text-[28px]")}>
        {title}
      </h2>
      <p className="mt-2 text-sm opacity-80">{subtitle}</p>
    </div>
  );
}

// ── Příběh o aplikaci ─────────────────────────────────────────────────────

export function AppStoryCard({ story, entry, className, paging }: { story: AppStory; entry: CatalogEntry; className?: string; paging?: CardPaging }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { color } = useBrandPalette(entry);
  // Odstín barvy ikony podle tématu – stejný jako banner v detailu
  const { style: tint, to: shade, ink, hue } = tintOf(color);
  const openDetail = useCardClick(entry.id);

  return (
    <article
      onClick={openDetail}
      className={cn(
        "tint-surface group relative flex min-h-[440px] cursor-pointer flex-col justify-end overflow-hidden rounded-3xl shadow-card transition-[box-shadow,transform] duration-300 hover:shadow-card-hover active:scale-[0.995]",
        className,
      )}
      style={{ ...tint, transition: `${COLOR_TRANSITION}, box-shadow 300ms, transform 300ms` }}
    >
      <Doodles seedKey={story.id} category={entry.categories[0]} ink={hue} cols={8} rows={4} opacity={0.12} />
      {paging && <CardPager {...paging} ink={ink} />}

      {/* Grafika: velká natočená ikona aplikace (dekorace – klik patří kartě) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex h-[60%] items-center justify-center">
        <PackageIcon
          id={entry.id}
          name={entry.name}
          iconUrl={entry.iconUrl}
          size={180}
          className="icon-lifted -rotate-6 transition-transform duration-500 group-hover:scale-105 group-hover:rotate-0"
        />
      </div>

      {/* Přechod do barvy kvůli čitelnosti textu */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
        style={{ background: `linear-gradient(to top, ${shade} 40%, transparent)` }}
      />

      {/* Nadpis jako odkaz – pro klávesnici a čtečky obrazovky; myší se klikne kamkoli na kartu */}
      <div className="relative px-7 pb-5">
        <Link to={detailUrl(entry.id)} className="block rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-black/20">
          <StoryText
            eyebrow={localize(story.eyebrow, language)}
            title={localize(story.title, language)}
            subtitle={localize(story.subtitle, language)}
            ink={ink}
            large
          />
        </Link>
      </div>

      {/* Spodní lišta: aplikace + Zobrazit */}
      <div
        className="relative flex items-center gap-4 px-7 py-4 backdrop-blur-sm"
        style={{ background: glass(ink, 10), borderTop: `1px solid ${glass(ink, 12)}`, color: ink }}
      >
        <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={48} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold">
            <span className="truncate">{entry.name}</span>
            {isVerified(entry) && <VerifiedBadge size={15} />}
          </p>
          <p className="truncate text-xs opacity-75">{entry.description || entry.publisher}</p>
        </div>
        <Link
          to={detailUrl(entry.id)}
          className="relative z-10 shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: glass(ink, 18) }}
        >
          {t("home.view")}
        </Link>
      </div>
    </article>
  );
}

// ── Aplikace dne ──────────────────────────────────────────────────────────

/**
 * Vodorovná karta „Aplikace dne“ podle tématu: ve světlém světlý odstín barvy značky
 * jako ostatní karty (tintOf), v tmavém tmavé pozadí jemně zabarvené barvou značky;
 * v pozadí vzorek symbolů podle kategorie aplikace, vlevo hvězdička, název a popis
 * s akcemi, vpravo velká ikona se září.
 */
export function AppOfTheDayCard({ entry, className }: { entry: CatalogEntry; className?: string }) {
  const { t } = useTranslation();
  const { color } = useBrandPalette(entry);
  const { style: tint, ink, hue } = tintOf(color);
  const base = `color-mix(in srgb, ${color} 22%, #0a1530)`;
  const openDetail = useCardClick(entry.id);

  return (
    <article
      onClick={openDetail}
      className={cn(
        "tint-surface group relative flex min-h-[440px] cursor-pointer items-center overflow-hidden rounded-3xl text-(--ink) shadow-card transition-[box-shadow,transform] duration-300 hover:shadow-card-hover active:scale-[0.995] dark:text-white",
        className,
      )}
      style={{ ...tint, "--ink": ink } as CSSProperties}
    >
      {/* Tmavé téma: tmavé pozadí s nádechem barvy značky */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{ background: `linear-gradient(135deg, ${base}, color-mix(in srgb, ${base} 70%, black))` }}
      />

      {/* Symboly toho, co aplikace dělá (kategorie) – jako na ostatních kartách */}
      <Doodles seedKey={entry.id} category={entry.categories[0]} ink={hue} cols={8} rows={4} opacity={0.12} />

      {/* Záře barvy značky za ikonou – ve světlém tématu jen jemná (na světlém odstínu karty
          by výrazná působila jako velká skvrna), šedá (černobílá ikona – Plex) jen v tmavém */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 right-[12%] size-96 -translate-y-1/2 rounded-full blur-3xl dark:opacity-40",
          isNeutralColor(hue) ? "opacity-0" : "opacity-12",
        )}
        style={{ background: hue }}
      />

      <div className="relative grid w-full items-center gap-8 px-10 py-10 md:grid-cols-[1fr_auto]">
        <div className="max-w-md">
          <p className="flex items-center gap-2 text-lg font-medium">
            <Star className="size-5 fill-current text-amber-500 dark:text-amber-300" />
            {t("home.appOfDay")}
          </p>
          <h2 className="mt-8 font-display text-5xl leading-[1.05] font-bold tracking-tight">
            <Link
              to={detailUrl(entry.id)}
              className="rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-black/20 dark:focus-visible:ring-white/40"
            >
              <NameWithBadge name={entry.name} verified={isVerified(entry)} size={32} />
            </Link>
          </h2>
          <p className="mt-3 text-lg opacity-80">{entry.description}</p>
          <div className="relative z-10 mt-8 flex items-center gap-3 [&_button]:bg-(--ink) [&_button]:text-white [&_button]:shadow-none [&>span]:text-(--ink) dark:[&_button]:bg-white dark:[&_button]:text-slate-900 dark:[&>span]:text-white">
            <PackageAction entry={entry} size="lg" />
            <Link
              to={detailUrl(entry.id)}
              className="rounded-full bg-black/6 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-black/10 dark:bg-white/12 dark:hover:bg-white/20"
            >
              {t("home.view")}
            </Link>
          </div>
        </div>

        <PackageIcon
          id={entry.id}
          name={entry.name}
          iconUrl={entry.iconUrl}
          size={200}
          className="icon-lifted pointer-events-none mx-auto rotate-3 transition-transform duration-500 group-hover:scale-105 group-hover:rotate-0"
        />
      </div>
    </article>
  );
}

// ── Kolekce ───────────────────────────────────────────────────────────────

/** Kolik ikon se vejde do spodní lišty kolekce vedle tlačítka (v úzké kartě méně). */
const MAX_ICONS = 4;
const NARROW_ICONS = 2;

/** Rozmístění „plovoucích“ ikon v horní části karty kolekce. */
const FLOATING: { left: string; top: string; size: number; rotate: number }[] = [
  { left: "8%", top: "16%", size: 104, rotate: -10 },
  { left: "42%", top: "5%", size: 92, rotate: 8 },
  { left: "58%", top: "42%", size: 84, rotate: -4 },
];

/**
 * Karta kolekce: kliknutím kamkoli se otevře celoobrazovkový detail kolekce
 * (CollectionModal). Výjimky, které mají vlastní akci a klik dál nepouštějí:
 * „Instalovat vše“ (rovnou instaluje) a malé ikony ve spodní liště (detail aplikace).
 */
export function CollectionCard({
  story,
  entries,
  className,
  paging,
}: {
  story: CollectionStory;
  entries: CatalogEntry[];
  className?: string;
  paging?: CardPaging;
}) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const openCollection = useCollectionModal((s) => s.open);
  const { pending, installAll } = useCollectionInstall(entries);
  // Barva podle ikon v sadě (převládající odstín), u pestré sady barva kolekce
  const { color } = useCollectionPalette(entries, story.color);
  // Odstín barvy podle tématu (ve světlém jako dlaždice ikon)
  const { style: tint, to: shade, ink, hue } = tintOf(color);
  // Skutečná barva spodní lišty (podklad pod textem + 10 % průhledné vrstvy) – kroužek kolem ikon s ní splyne
  const bar = `color-mix(in srgb, ${shade} 90%, ${ink})`;
  const title = localize(story.title, language);

  return (
    <article
      // Detail kolekce ve stejné barvě jako karta
      onClick={() => openCollection({ ...story, color })}
      className={cn(
        "tint-surface group relative flex min-h-[440px] cursor-pointer flex-col justify-end overflow-hidden rounded-3xl shadow-card transition-[box-shadow,transform] duration-300 hover:shadow-card-hover active:scale-[0.99]",
        className,
      )}
      style={{ ...tint, transition: `${COLOR_TRANSITION}, box-shadow 300ms, transform 300ms` }}
    >
      <Doodles seedKey={story.id} category={entries[0]?.categories[0]} ink={hue} cols={5} rows={4} opacity={0.12} />
      {paging && <CardPager {...paging} ink={ink} />}

      {/* Grafika: tři plovoucí ikony z kolekce (klik otevře detail kolekce jako zbytek karty) */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[58%]">
        {entries.slice(0, FLOATING.length).map((e, i) => {
          const pos = FLOATING[i];
          return (
            <div
              key={e.id}
              className="absolute transition-transform duration-500 group-hover:-translate-y-1.5"
              style={{ left: pos.left, top: pos.top, transform: `rotate(${pos.rotate}deg)`, transitionDelay: `${i * 60}ms` }}
            >
              <PackageIcon
                id={e.id}
                name={e.name}
                iconUrl={e.iconUrl}
                size={pos.size}
                className="icon-lifted transition-transform duration-200 hover:scale-110"
              />
            </div>
          );
        })}
      </div>

      {/* Tmavnutí pod textem – barva pozadí s maskou, ať se barva mění plynule spolu s kartou */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/5"
        style={{ backgroundColor: shade, maskImage: "linear-gradient(to top, black 45%, transparent)", transition: COLOR_TRANSITION }}
      />

      {/* Nadpis je tlačítko kvůli klávesnici a čtečkám obrazovky; myší se klikne kamkoli na kartu */}
      <div className="relative px-6 pb-5">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t("collection.open", { name: title })}
          className="cursor-pointer rounded-xl text-left outline-none focus-visible:ring-4 focus-visible:ring-black/20"
        >
          <StoryText eyebrow={localize(story.eyebrow, language)} title={title} subtitle={localize(story.subtitle, language)} ink={ink} />
        </button>
      </div>

      {/* Spodní lišta: ikony aplikací + Instalovat vše. Počet ikon podle šířky lišty (container
          query) – čtyři, v užší kartě dvě a v nejužší žádná, ať tlačítko vždy pojme celý text. */}
      <div
        className="@container relative flex items-center gap-3 px-5 py-4 backdrop-blur-sm"
        style={{ background: glass(ink, 10), borderTop: `1px solid ${glass(ink, 12)}`, color: ink }}
      >
        <div className="flex min-w-0 flex-1 items-center -space-x-2.5 @max-[15rem]:hidden">
          {entries.slice(0, MAX_ICONS).map((e, i) => (
            <Link
              key={e.id}
              to={detailUrl(e.id)}
              title={e.name}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "shrink-0 rounded-[10px] transition-transform hover:z-10 hover:-translate-y-1",
                i >= NARROW_ICONS && "@max-[19rem]:hidden",
              )}
              style={{ boxShadow: `0 0 0 3px ${bar}`, transition: "box-shadow 450ms ease, transform 150ms ease" } as CSSProperties}
            >
              <PackageIcon id={e.id} name={e.name} iconUrl={e.iconUrl} size={36} />
            </Link>
          ))}
          <MoreIcons entries={entries} shown={MAX_ICONS} ring={bar} ink={ink} className="@max-[19rem]:hidden" />
          <MoreIcons entries={entries} shown={NARROW_ICONS} ring={bar} ink={ink} className="@min-[19rem]:hidden" />
        </div>
        {pending.length > 0 ? (
          <button
            type="button"
            onClick={(event) => {
              // Instaluje rovnou – detail kolekce se neotevře
              event.stopPropagation();
              installAll();
            }}
            className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-opacity hover:opacity-80"
            style={{ background: glass(ink, 18) }}
          >
            <Download className="size-3.5 shrink-0" />
            {t("home.installAll", { count: pending.length })}
          </button>
        ) : (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap opacity-80">
            <Check className="size-4" />
            {t("home.allInstalled")}
          </span>
        )}
      </div>
    </article>
  );
}

/** „+N“ za ikonami kolekce – kolik aplikací se do lišty nevešlo. */
function MoreIcons({ entries, shown, ring, ink, className }: { entries: CatalogEntry[]; shown: number; ring: string; ink: string; className?: string }) {
  if (entries.length <= shown) return null;
  return (
    <span
      title={entries.slice(shown).map((e) => e.name).join(", ")}
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px] text-xs font-bold", className)}
      // Neprůhledná výplň (jinak prosvítá kroužek sousední ikony) v odstínu lišty
      style={{ background: `color-mix(in srgb, ${ring} 82%, ${ink})`, boxShadow: `0 0 0 3px ${ring}`, transition: "background-color 450ms ease, box-shadow 450ms ease" }}
    >
      +{entries.length - shown}
    </span>
  );
}
