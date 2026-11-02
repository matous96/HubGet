import { Code } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CollectionModal } from "@/components/home/CollectionModal";
import { AppOfTheDayCard, AppStoryCard, CollectionCard } from "@/components/home/TodayCards";
import { ProfileCollections } from "@/components/home/ProfileCollections";
import { SystemStatus } from "@/components/home/SystemStatus";
import { UserModeToggle } from "@/components/home/UserModeToggle";
import { ValuePillars } from "@/components/home/ValuePillars";
import { PackageCard } from "@/components/package/PackageCard";
import { Shelf, ShelfItem } from "@/components/ui/Shelf";
import { PackageCollection } from "@/components/package/PackageCollection";
import { CollectionToolbar } from "@/components/ui/CollectionToolbar";
import { CardSkeletons, ErrorState } from "@/components/ui/States";
import { isDevOnly, useCatalog, useCatalogIndex, useModeFilter } from "@/hooks/usePackages";
import { NO_SHIFT, todayPicks, type TodayShift } from "@/lib/today";
import { trendingScore } from "@/lib/trending";
import { cn, topN } from "@/lib/utils";
import { knownIconSizes, measureIcon, useIconQuality } from "@/store/iconQuality";
import { useSettings } from "@/store/settings";
import { isFirstDay, useTodayPager, useTodayShift, type TodaySlot } from "@/store/todayPager";
import type { CatalogEntry } from "@/types";

type Tab = "trending" | "popular" | "new" | "updated";
const TABS: Tab[] = ["trending", "popular", "new", "updated"];
const TAB_SIZE = 12;
/** Nejdéle tak dlouho (ms od načtení katalogu) čekají karty sekce Dnes na změření ikon. */
const HOLD_MAX = 3000;

/**
 * Domovská obrazovka: pruh se třemi sliby (bezpečné, jednoduché, vše pod
 * kontrolou) → sekce „Dnes“ ve stylu App Store (příběh, kolekce, Aplikace dne)
 * → stav počítače → kolekce podle zaměření → Trendy / Populární / Nové / Aktualizované.
 */
export function HomePage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { data, isLoading, isError, refetch } = useCatalog();
  const catalogIndex = useCatalogIndex();
  const [tab, setTab] = useState<Tab>("trending");
  const developer = useSettings((s) => s.userMode === "developer");
  const modeFilter = useModeFilter();

  const all = useMemo(() => data?.catalog.packages ?? [], [data]);

  // Dnešní výběr: ručně psané příběhy a kolekce i známé aplikace z celého katalogu (lib/today.ts),
  // automaticky vybrané jen s ikonou ve vysokém rozlišení (store/iconQuality.ts)
  const measured = useIconQuality((s) => s.sizes);
  const failedIcons = useIconQuality((s) => s.failed);
  const liveSizes = useMemo(() => knownIconSizes({ sizes: measured, failed: failedIcons }), [measured, failedIcons]);
  // Po zobrazení karet se výběr řídí rozlišeními známými v tu chvíli – pozdější měření
  // (karty se zobrazenými ikonami, na novém počítači desítky za sekundu) zobrazené karty nevymění
  const [frozenSizes, setFrozenSizes] = useState<Record<string, number> | null>(null);
  const iconSizes = frozenSizes ?? liveSizes;
  // Listování šipkami na kartách (store/todayPager.ts)
  const shift = useTodayShift();
  const move = useTodayPager((s) => s.move);
  // Šipka ukáže výběr jiného dne – ten už počítá se vším, co se mezitím změřilo
  const [shownShift, setShownShift] = useState(shift);
  if (shownShift !== shift) {
    setShownShift(shift);
    if (frozenSizes) setFrozenSizes(knownIconSizes());
  }
  // První den po instalaci: ručně psaný obsah s přibalenými ikonami – ukáže se hned (lib/today.ts)
  const [firstRun] = useState(isFirstDay);
  const { today, neighbours } = useMemo(() => {
    const size = (e: CatalogEntry) => (e.iconUrl ? iconSizes[e.iconUrl] : 0);
    const at = (by: number): TodayShift => ({
      story: shift.story + by,
      collections: [shift.collections[0] + by, shift.collections[1] + by],
    });
    const picks = (s: TodayShift, date?: Date) => todayPicks(all, catalogIndex, developer, size, date, s, firstRun && !date);
    return {
      today: picks(shift),
      // Sousední výběry (šipka vpřed / vzad) a první den i zítřejší běžný výběr – jejich ikony se
      // změří (a stáhnou) předem
      neighbours: [picks(at(1)), picks(at(-1)), ...(firstRun ? [picks(NO_SHIFT, new Date(Date.now() + 86_400_000))] : [])],
    };
  }, [all, catalogIndex, developer, language, iconSizes, shift, firstRun]);
  const paging = (slot: TodaySlot) => ({ onPrev: () => move(slot, -1), onNext: () => move(slot, 1) });

  // Místo karet kostry, dokud nejsou změřené ikony zobrazovaných aplikací (na novém počítači se
  // jinak karty v prvních sekundách několikrát vymění) – nejvýš HOLD_MAX od načtení katalogu, pak
  // se ukáže, co je známé. Pak se výběr zamrazí (frozenSizes). Barvy karet se dopočítají až
  // z ikon v mezipaměti a do barvy ikony přejdou plynule.
  const catalogReady = !!data;
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!catalogReady) return;
    const timer = setTimeout(() => setWaited(true), HOLD_MAX);
    return () => clearTimeout(timer);
  }, [catalogReady]);
  const settled = today.unsettled.length === 0;
  const holdToday = !frozenSizes && !settled && !waited;
  useEffect(() => {
    if (catalogReady && !frozenSizes && (settled || waited)) setFrozenSizes(knownIconSizes());
  }, [catalogReady, frozenSizes, settled, waited]);

  // Měření ikon: ikony se stahují nejvýš po několika (icons.rs), proto nejdřív jen zobrazované
  // aplikace – kandidáti navíc a výběry pro šipky (desítky ikon) by první zobrazení zdržely
  // o několik sekund. Ostatní až po zobrazení karet.
  const unsettled = today.unsettled.map((e) => e.iconUrl ?? "").join("\n");
  const later = frozenSizes
    ? [...today.unmeasured, ...neighbours.flatMap((n) => [...n.unsettled, ...n.unmeasured])].map((e) => e.iconUrl ?? "").join("\n")
    : "";
  useEffect(() => {
    for (const url of unsettled.split("\n").filter(Boolean)) void measureIcon(url);
  }, [unsettled]);
  useEffect(() => {
    for (const url of later.split("\n").filter(Boolean)) void measureIcon(url);
  }, [later]);

  // Obsah záložek (běžný uživatel bez balíčků jen pro vývojáře)
  // Jen prvních 12 v jednom průchodu – řazení celého katalogu by u Trendů trvalo desítky ms
  const tabItems = useMemo(() => {
    const now = Date.now();
    const visible = modeFilter(all);
    const time = (date: string | null | undefined) => (date ? Date.parse(date) || 0 : 0);
    const score: Record<Tab, (p: CatalogEntry) => number> = {
      trending: (p) => trendingScore(p, now),
      popular: (p) => p.popularity,
      new: (p) => time(p.addedAt),
      updated: (p) => time(p.releaseDate),
    };
    return topN(visible, TAB_SIZE, score[tab]);
  }, [all, tab, modeFilter]);

  // Režim Vývojář: nástroje pro vývojáře hned v prvním řádku
  const devTools = useMemo(
    () => (developer ? topN(all.filter((p) => isDevOnly(p) || p.categories.includes("development")), 14, (p) => p.popularity) : []),
    [all, developer],
  );

  if (isLoading) return <CardSkeletons />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;

  const dateLabel = new Date().toLocaleDateString(language, { weekday: "long", day: "numeric", month: "long" });
  const [firstCollection, secondCollection] = today.collections;

  return (
    <>
      {/* ── Dnes: vlevo datum a nadpis, uprostřed tři sliby HubGetu, vpravo přepínač režimu ── */}
      {/* Sliby na střed volného místa mezi nadpisem a přepínačem (přepínač je mnohem širší než
          „Dnes“ – na středu celého řádku by vypadaly posunuté doprava). Na užších obrazovkách
          se přesunou na vlastní řádek pod nadpis. */}
      <div className="mb-5 grid grid-cols-[1fr_auto] items-end gap-x-6 gap-y-3 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">{dateLabel}</p>
          <h2 className="font-display text-4xl font-bold tracking-tight">{t("home.today")}</h2>
        </div>
        {/* Bezpečné (bez virů), jednoduché, vše pod kontrolou – v rovině s nadpisem „Dnes“ */}
        <ValuePillars className="order-last col-span-2 pb-1.5 xl:order-none xl:col-span-1" />
        <div className="justify-self-end">
          <UserModeToggle />
        </div>
      </div>

      <div className="mb-10 grid gap-5 lg:grid-cols-3">
        {holdToday ? (
          // Kostry ve tvaru karet (příběh, dvě kolekce, aplikace dne)
          ["lg:col-span-2", "", "", "lg:col-span-2"].map((span, i) => (
            <div key={i} className={cn("min-h-[440px] animate-pulse rounded-3xl bg-surface-2", span)} />
          ))
        ) : (
          <>
            {today.storyEntry && (
              <AppStoryCard story={today.story} entry={today.storyEntry} className="lg:col-span-2" paging={paging("story")} />
            )}
            {firstCollection.entries.length > 0 && (
              <CollectionCard story={firstCollection.story} entries={firstCollection.entries} paging={paging("collection0")} />
            )}
            {secondCollection.entries.length > 0 && (
              <CollectionCard story={secondCollection.story} entries={secondCollection.entries} paging={paging("collection1")} />
            )}
            {/* Aplikace dne – jedna na celý den, bez listování */}
            {today.appOfDay && <AppOfTheDayCard entry={today.appOfDay} className="lg:col-span-2" />}
          </>
        )}
      </div>

      {/* Zbytek stránky až po kartách Dnes – jeho ikony a barvy (desítky stažení) by jinak
          na prvním spuštění zdržely ikony karet, na které se čeká */}
      {!holdToday && (
        <>
          {/* Stav počítače: aktualizace, co spravuje HubGet, export / import, vyčištění */}
          <SystemStatus />

          {/* Režim Vývojář: nástroje pro vývojáře hned pod přehledem */}
          {devTools.length > 0 && (
            <div className="mb-8">
              <Shelf title={t("home.devTools")} icon={<Code className="size-5 text-accent" />}>
                {devTools.map((p) => (
                  <ShelfItem key={p.id}>
                    <PackageCard entry={p} />
                  </ShelfItem>
                ))}
              </Shelf>
            </div>
          )}

          {/* Kolekce podle zaměření + vlastní sada sdílená odkazem */}
          <ProfileCollections />

          {/* Celoobrazovkový detail kolekce – otevírají ho karty kolekcí výše */}
          <CollectionModal />

          {/* ── Trendy / Populární / Nové / Aktualizované ────────────── */}
          <section className="mb-10">
            <div className="mb-5 grid grid-cols-4 rounded-full border border-line bg-surface-2 p-1" role="tablist">
              {TABS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative h-11 cursor-pointer rounded-full text-sm font-semibold transition-colors",
                    tab === id ? "text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {/* Posuvný ukazatel aktivní záložky */}
                  {tab === id && (
                    <motion.span
                      layoutId="home-tab-indicator"
                      className="absolute inset-0 rounded-full bg-surface shadow-sm"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative">{t(`home.tabs.${id}`)}</span>
                </button>
              ))}
            </div>

            <div className="mb-4 flex items-center justify-end gap-4">
              <Link to="/top" className="mr-auto text-sm font-medium text-accent hover:underline">
                {t("home.seeAll")}
              </Link>
              {/* Pořadí určuje záložka – nabízíme jen přepnutí mřížka / seznam */}
              <CollectionToolbar hideSort />
            </div>

            {/* Bez nového připojení při přepnutí záložky – seznam jen dostane jiné aplikace
                a drží výšku, takže stránka neposkočí nahoru */}
            <PackageCollection packages={tabItems} />
          </section>
        </>
      )}
    </>
  );
}
