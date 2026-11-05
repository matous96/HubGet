/**
 * Detail kolekce přes celou obrazovku (po vzoru App Store) – otevře se
 * kliknutím na kartu kolekce na domovské stránce:
 *  - záhlaví v barvě kolekce: nadtitulek, název, podnadpis, popis
 *    a „Nainstalovat vše (N)“,
 *  - seznam aplikací pod sebou: ikona, název s popisem a kategorií, akce
 *    (Instalovat / Otevřít / Aktualizovat / průběh).
 * Zavírá se tlačítkem ✕ vpravo nahoře, klávesou Esc nebo kliknutím mimo.
 */
import { Check, Download, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Doodles } from "@/components/package/Doodles";
import { PackageAction } from "@/components/package/PackageAction";
import { PackageIcon } from "@/components/package/PackageIcon";
import { VerifiedBadge } from "@/components/package/VerifiedBadge";
import { isVerified } from "@/lib/verified";
import { localize, type CollectionStory } from "@/data/editorial";
import { useCollectionInstall } from "@/hooks/useCollectionInstall";
import { useOverlay } from "@/hooks/useOverlay";
import { useCatalogIndex } from "@/hooks/usePackages";
import { tintOf } from "@/lib/iconTile";
import { useCollectionModal } from "@/store/collectionModal";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";

/** Poloprůhledná barva textu (pro „sklo“ tlačítek v záhlaví). */
const glass = (ink: string, percent: number) => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;

export function CollectionModal() {
  const { story, close } = useCollectionModal();

  // Esc zavře detail (fokus si řeší panel sám – zavírací tlačítko)
  useOverlay(!!story, (e) => e.key === "Escape" && close());

  // Při odchodu z domovské stránky (např. zpět v historii) detail nezůstane otevřený
  useEffect(() => close, [close]);

  return createPortal(
    <AnimatePresence>
      {story && (
        <motion.div
          key="collection-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          onClick={close}
        >
          <CollectionPanel story={story} onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function CollectionPanel({ story, onClose }: { story: CollectionStory; onClose: () => void }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const catalogIndex = useCatalogIndex();
  const entries = useMemo(
    () => story.appIds.map((id) => catalogIndex.get(id)).filter((e): e is CatalogEntry => !!e),
    [story, catalogIndex],
  );
  const { pending, installAll } = useCollectionInstall(entries);
  // Odstín barvy kolekce podle tématu – stejný jako karta
  const { style: tint, from, ink, pattern } = tintOf(story.color);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Fokus na zavírací tlačítko (klávesnice, čtečky obrazovky); po zavření zpět, odkud přišel
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <motion.div
      role="dialog"
      aria-modal
      aria-label={localize(story.title, language)}
      // Proměnné odstínu i pro zavírací tlačítko mimo záhlaví
      className="tint-vars relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl"
      style={tint}
      initial={{ opacity: 0, scale: 0.94, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      // Otevření pružinou, zavření krátkým plynulým zmizením (bez dokmitávání)
      exit={{ opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.18, ease: "easeIn" } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Zavírací tlačítko – výrazné, vpravo nahoře nad záhlavím */}
      <button
        ref={closeButton}
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        title={`${t("common.close")} (Esc)`}
        className="absolute top-4 right-4 z-20 flex size-10 cursor-pointer items-center justify-center rounded-full backdrop-blur-md transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-black/20 focus-visible:outline-none"
        style={{ background: glass(ink, 22), color: ink }}
      >
        <X className="size-5" strokeWidth={2.5} />
      </button>

      <div className="min-h-0 overflow-y-auto">
        {/* Záhlaví v barvě kolekce */}
        <header className="tint-surface relative overflow-hidden px-8 pt-10 pb-8" style={{ color: ink }}>
          <Doodles seedKey={story.id} category={entries[0]?.categories[0]} ink={pattern} cols={8} rows={3} opacity={0.2} />
          <div className="relative max-w-2xl pr-10">
            <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-75">{localize(story.eyebrow, language)}</p>
            <h2 className="mt-2 font-display text-4xl leading-[1.08] font-bold tracking-tight">{localize(story.title, language)}</h2>
            <p className="mt-3 text-lg opacity-90">{localize(story.subtitle, language)}</p>
            {story.description && <p className="mt-3 text-sm leading-6 opacity-80">{localize(story.description, language)}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {pending.length > 0 ? (
                <button
                  type="button"
                  onClick={installAll}
                  className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full px-6 text-sm font-semibold shadow-lg shadow-black/15 transition hover:opacity-90"
                  // Barva textu záhlaví jako výplň: ve světlém tématu tmavé tlačítko, v tmavém světlé
                  style={{ background: ink, color: from }}
                >
                  <Download className="size-4" />
                  {t("collection.installAll", { count: pending.length })}
                </button>
              ) : (
                <span className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold" style={{ background: glass(ink, 16) }}>
                  <Check className="size-4" />
                  {t("home.allInstalled")}
                </span>
              )}
              <span className="text-sm opacity-75">{t("collection.appCount", { count: entries.length })}</span>
            </div>
          </div>
        </header>

        {/* Seznam aplikací */}
        <ul className="divide-y divide-line px-4 py-2 sm:px-6">
          {entries.map((entry) => (
            <CollectionRow key={entry.id} entry={entry} onNavigate={onClose} />
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

/** Řádek aplikace: ikona, název + popis a kategorie, akce vpravo. Klik na řádek otevře detail. */
function CollectionRow({ entry, onNavigate }: { entry: CatalogEntry; onNavigate: () => void }) {
  const { t } = useTranslation();
  const category = entry.categories[0];

  return (
    <li className="group relative flex items-center gap-4 rounded-2xl px-2 py-3.5 transition-colors hover:bg-surface-2">
      <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={56} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Link
            to={`/package/${encodeURIComponent(entry.id)}`}
            onClick={onNavigate}
            className="truncate outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-accent"
          >
            {entry.name}
          </Link>
          {isVerified(entry) && <VerifiedBadge size={15} />}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{entry.description || entry.publisher}</p>
        {category && <p className="mt-0.5 text-xs text-muted/80">{t(`categories.${category}`)}</p>}
      </div>
      <PackageAction entry={entry} className="relative z-10 shrink-0" />
    </li>
  );
}
