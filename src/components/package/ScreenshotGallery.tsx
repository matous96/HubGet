import { ChevronLeft, ChevronRight, Expand, Images, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useOverlay } from "@/hooks/useOverlay";
import { cn } from "@/lib/utils";
import type { ScreenshotSource } from "@/types";

/** Snímek v galerii – z katalogu jen adresa, od uživatelů i štítek, popisek a akce. */
export interface GalleryItem {
  id: string;
  url: string;
  /** Menší náhled (proužek v prohlížeči na celou obrazovku). */
  thumbUrl?: string;
  /** Štítek v rohu snímku („Od komunity“, „Čeká na schválení“). */
  badge?: ReactNode;
  /** Popisek a akce nahoře v prohlížeči na celou obrazovku. */
  caption?: ReactNode;
  actions?: ReactNode;
}

interface ScreenshotGalleryProps {
  items: GalleryItem[];
  /** Název aplikace – pro alternativní text obrázků. */
  name: string;
  /** Odkud snímky z katalogu pocházejí – uvede se nad galerií. */
  sources?: ScreenshotSource[];
  /** Tlačítko v záhlaví (Přidat snímek). */
  action?: ReactNode;
  /** Obsah místo galerie, když snímky nejsou (zobrazí se jen s `action`). */
  empty?: ReactNode;
  /** Obsah místo galerie, když snímky jsou, ale žádný se nenačetl (bez internetu) – ne „žádné snímky“. */
  unavailable?: ReactNode;
}

/** Popisky zdrojů snímků (vlastní názvy, nepřekládají se). */
const SOURCE_LABEL: Record<ScreenshotSource, string> = { unigetui: "UniGetUI", chocolatey: "Chocolatey" };

/**
 * Galerie screenshotů v detailu aplikace: karusel s posouváním po snímcích
 * (šipky, tečky, klávesy ← →, kolečko / touchpad), kliknutím se snímek
 * otevře na celou obrazovku. Snímky mají různé rozměry – zobrazí se celé
 * v jednotném rámu, za nimi rozmazaná kopie. Obrázky, které se nepodaří
 * načíst, se z galerie tiše vyřadí.
 */
export function ScreenshotGallery({ items, name, sources, action, empty, unavailable }: ScreenshotGalleryProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);

  const visible = items.filter((item) => !failed.has(item.id));
  const count = visible.length;
  const markFailed = (id: string) => setFailed((prev) => new Set(prev).add(id));
  const markLoaded = (id: string) => setLoaded((prev) => new Set(prev).add(id));

  /** Posune karusel tak, aby snímek začínal u levého okraje. */
  const scrollTo = useCallback((index: number) => {
    const el = track.current;
    const slide = el?.children[index] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - el.offsetLeft, behavior: "smooth" });
  }, []);

  // Aktivní snímek = ten, jehož levý okraj je nejblíž aktuálnímu posunu
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const slides = [...el.children] as HTMLElement[];
        let best = 0;
        slides.forEach((slide, i) => {
          if (Math.abs(slide.offsetLeft - el.offsetLeft - el.scrollLeft) < Math.abs(slides[best].offsetLeft - el.offsetLeft - el.scrollLeft)) best = i;
        });
        // Na konci posunu je aktivní poslední snímek, i když nezačíná u okraje
        if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) best = slides.length - 1;
        setActive(best);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [count]);

  // Nový snímek na začátku (právě přidaný) – karusel ukáže začátek
  const firstId = visible[0]?.id;
  useEffect(() => {
    track.current?.scrollTo({ left: 0 });
  }, [firstId]);

  // Prohlížeč zavřít, když jeho snímek zmizel (smazaný vlastní snímek)
  if (openIndex !== null && openIndex >= count) setOpenIndex(count > 0 ? count - 1 : null);

  if (count === 0 && !action) return null;

  const go = (delta: number) => scrollTo(Math.min(count - 1, Math.max(0, active + delta)));
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2.5 font-display text-2xl font-bold">
          {t("package.screenshots")}
          {count > 0 && <span className="text-base font-medium text-muted tabular-nums">{count}</span>}
        </h2>
        <div className="flex items-center gap-4">
          {sources && sources.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Images className="size-3.5" />
              {t("package.screenshotsSource", { sources: sources.map((s) => SOURCE_LABEL[s]).join(", ") })}
            </p>
          )}
          {action}
        </div>
      </div>

      {count === 0 ? (
        items.length > 0 ? (unavailable ?? empty) : empty
      ) : (
        <>
          <div className="group/gallery relative">
            <div
              ref={track}
              tabIndex={0}
              onKeyDown={onKeyDown}
              aria-label={t("package.screenshots")}
              className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth rounded-2xl pb-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {visible.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setOpenIndex(i)}
                  aria-label={t("package.screenshotOf", { index: i + 1, total: count })}
                  className={cn(
                    "group relative aspect-[16/10] shrink-0 cursor-zoom-in snap-start overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-card",
                    // Jediný snímek přes celou šířku (do 900 px), jinak vykukuje další
                    count === 1 ? "w-full max-w-[900px]" : "w-[min(720px,82%)]",
                  )}
                >
                  {/* Rozmazaná kopie za snímkem vyplní okraje rámu */}
                  <img src={item.thumbUrl ?? item.url} alt="" aria-hidden draggable={false} className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl" />
                  {!loaded.has(item.id) && <span className="absolute inset-0 animate-pulse bg-surface-2" />}
                  <img
                    src={item.url}
                    alt={`${name} – ${t("package.screenshotOf", { index: i + 1, total: count })}`}
                    loading={i < 2 ? "eager" : "lazy"}
                    draggable={false}
                    onLoad={() => markLoaded(item.id)}
                    onError={() => markFailed(item.id)}
                    className="relative size-full object-contain p-3 drop-shadow-xl transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                  {item.badge && <span className="pointer-events-none absolute top-3 left-3">{item.badge}</span>}
                  {/* Ikona zvětšení při najetí */}
                  <span className="absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                    <Expand className="size-4" />
                  </span>
                </button>
              ))}
            </div>

            {/* Šipky – objeví se při najetí na galerii */}
            {count > 1 && (
              <>
                <CarouselArrow side="left" label={t("package.previous")} disabled={active === 0} onClick={() => go(-1)} />
                <CarouselArrow side="right" label={t("package.next")} disabled={active === count - 1} onClick={() => go(1)} />
              </>
            )}
          </div>

          {/* Tečky – kde v galerii jsem, kliknutím skok na snímek */}
          {count > 1 && (
            <div className="mt-4 flex justify-center gap-2">
              {visible.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={t("package.screenshotOf", { index: i + 1, total: count })}
                  aria-current={i === active}
                  onClick={() => scrollTo(i)}
                  className={cn(
                    "h-2 cursor-pointer rounded-full transition-all duration-300",
                    i === active ? "w-6 bg-accent" : "w-2 bg-fg/20 hover:bg-fg/40",
                  )}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Lightbox
        items={visible}
        name={name}
        index={openIndex}
        onChange={(index) => {
          setOpenIndex(index);
          scrollTo(index); // po zavření prohlížeče je karusel u stejného snímku
        }}
        onClose={() => setOpenIndex(null)}
      />
    </section>
  );
}

/** Kulatá šipka karuselu přes okraj galerie. */
function CarouselArrow({
  side,
  label,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-10 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-line bg-surface/90 text-fg shadow-card backdrop-blur transition-all",
        "opacity-0 group-hover/gallery:opacity-100 hover:scale-105 disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

interface LightboxProps {
  items: GalleryItem[];
  name: string;
  index: number | null;
  onChange: (index: number) => void;
  onClose: () => void;
}

/** Prohlížeč na celou obrazovku – šipky, Esc, náhledy dole, u snímků od uživatelů autor a akce. */
function Lightbox({ items, name, index, onChange, onClose }: LightboxProps) {
  const { t } = useTranslation();
  // Směr posledního přechodu: 1 = vpřed, -1 = zpět (pro animaci posunu)
  const [direction, setDirection] = useState(1);
  const open = index !== null && index < items.length;
  const count = items.length;

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      setDirection(delta);
      onChange((index + delta + count) % count);
    },
    [index, count, onChange],
  );

  // Fokus do prohlížeče – Enter by jinak znovu „klikl“ na náhled pod ním a skočil na první snímek
  const viewer = useRef<HTMLDivElement>(null);
  useOverlay(
    open,
    (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    },
    viewer,
  );

  const item = open ? items[index] : null;

  return createPortal(
    <AnimatePresence>
      {open && item && (
        <motion.div
          // Celoobrazovkový prohlížeč je dialog – čtečky obrazovky ho tak oznámí a ignorují stránku pod ním
          ref={viewer}
          role="dialog"
          aria-modal="true"
          aria-label={`${name} – ${t("package.screenshots")}`}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Horní lišta */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 text-sm text-white/80">
            <span className="min-w-0 truncate">
              {name} · {t("package.screenshotOf", { index: index + 1, total: count })}
              {item.caption && <> · {item.caption}</>}
            </span>
            <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {item.actions}
              <LightboxButton label={t("common.close")} onClick={onClose}>
                <X className="size-5" />
              </LightboxButton>
            </div>
          </div>

          {/* Obrázek s animovaným přechodem */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-20">
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <motion.img
                key={item.id}
                src={item.url}
                alt={`${name} – ${t("package.screenshotOf", { index: index + 1, total: count })}`}
                custom={direction}
                initial={{ opacity: 0, x: direction * 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -60 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                draggable={false}
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
              />
            </AnimatePresence>

            {count > 1 && (
              <>
                <LightboxButton label={t("package.previous")} onClick={() => go(-1)} className="absolute left-6">
                  <ChevronLeft className="size-6" />
                </LightboxButton>
                <LightboxButton label={t("package.next")} onClick={() => go(1)} className="absolute right-6">
                  <ChevronRight className="size-6" />
                </LightboxButton>
              </>
            )}
          </div>

          {/* Náhledy */}
          {count > 1 && (
            <div className="flex justify-center gap-2 px-6 py-5" onClick={(e) => e.stopPropagation()}>
              {items.map((thumb, i) => (
                <button
                  key={thumb.id}
                  type="button"
                  aria-label={t("package.screenshotOf", { index: i + 1, total: count })}
                  onClick={() => {
                    setDirection(i > index ? 1 : -1);
                    onChange(i);
                  }}
                  className={cn(
                    "aspect-[16/10] w-24 cursor-pointer overflow-hidden rounded-lg ring-2 transition-all",
                    i === index ? "opacity-100 ring-white" : "opacity-50 ring-transparent hover:opacity-80",
                  )}
                >
                  <img src={thumb.thumbUrl ?? thumb.url} alt="" draggable={false} className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function LightboxButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-11 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20",
        className,
      )}
    >
      {children}
    </button>
  );
}
