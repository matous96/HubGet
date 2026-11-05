import { ArrowRight, Check, Download, Link2, PackagePlus } from "lucide-react";
import { useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Doodles } from "@/components/package/Doodles";
import { PackageIcon } from "@/components/package/PackageIcon";
import { localize, PROFILE_COLLECTIONS, type CollectionStory } from "@/data/editorial";
import { useCollectionInstall } from "@/hooks/useCollectionInstall";
import { pickSource, useCatalogIndex } from "@/hooks/usePackages";
import { tintOf } from "@/lib/iconTile";
import { useBundle } from "@/store/bundle";
import { useCollectionModal } from "@/store/collectionModal";
import { useSettings } from "@/store/settings";
import { useSourceScope } from "@/store/sourceLock";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry } from "@/types";

/** Poloprůhledná barva textu karty. */
const glass = (ink: string, percent: number) => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;

/**
 * Kolekce podle zaměření (Hráčský PC, Grafik a kreativec, Základní výbava…)
 * a výzva k vytvoření vlastní sady, kterou jde sdílet odkazem.
 * V režimu Vývojář je kolekce pro vývojáře první.
 */
export function ProfileCollections() {
  const { t } = useTranslation();
  const catalogIndex = useCatalogIndex();
  const developer = useSettings((s) => s.userMode === "developer");

  const collections = useMemo(() => {
    const list = PROFILE_COLLECTIONS.map((c) => ({
      story: c,
      developer: !!c.developer,
      entries: c.appIds.map((id) => catalogIndex.get(id)).filter((e): e is CatalogEntry => !!e),
    })).filter((c) => c.entries.length > 0);
    // Vývojáři vidí svou kolekci jako první, běžní uživatelé jako poslední
    return [...list].sort((a, b) => (developer ? Number(b.developer) - Number(a.developer) : Number(a.developer) - Number(b.developer)));
  }, [catalogIndex, developer]);

  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="font-display text-2xl font-bold">{t("profiles.title")}</h2>
        <p className="text-sm text-muted">{t("profiles.subtitle")}</p>
      </div>
      {/* Počet sloupců podle šířky okna (na velkém monitoru víc kolekcí vedle sebe) */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {collections.map((c) => (
          <ProfileCard key={c.story.id} story={c.story} entries={c.entries} />
        ))}
        <CustomCollectionCard />
      </div>
    </section>
  );
}

/**
 * Karta kolekce podle zaměření: kliknutím kamkoli se otevře detail kolekce
 * (CollectionModal). Ikony aplikací, „Instalovat vše“ a „Do sady“ mají vlastní
 * akci a klik dál nepouštějí.
 */
function ProfileCard({ story, entries }: { story: CollectionStory; entries: CatalogEntry[] }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { enabled, preferred } = useSourceScope();
  const openCollection = useCollectionModal((s) => s.open);
  const { pending, installAll } = useCollectionInstall(entries);
  const addToBundle = useBundle((s) => s.add);
  const toast = useToasts((s) => s.push);
  // Odstín barvy kolekce podle tématu (ve světlém jako dlaždice ikon)
  const { style: tint, ink, pattern } = tintOf(story.color);
  const title = localize(story.title, language);

  /** Přidá kolekci do sady balíčků – tam si ji jde upravit a sdílet. */
  const toBundle = () => {
    for (const e of entries) {
      const s = pickSource(e, enabled, preferred);
      if (s) addToBundle({ appId: e.id, name: e.name, source: s.source, packageId: s.packageId });
    }
    toast("success", t("profiles.addedToBundle", { name: title }));
  };

  /** Akce uvnitř karty: provede se, ale detail kolekce se neotevře. */
  const only = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };

  return (
    <article
      onClick={() => openCollection(story)}
      className="tint-surface relative flex cursor-pointer flex-col dark:[--pattern-boost:1.5] overflow-hidden rounded-3xl shadow-card transition-[box-shadow,transform] duration-300 hover:shadow-card-hover active:scale-[0.99]"
      style={{ ...tint, color: ink }}
    >
      {/* Decentní vzorek symbolů podle zaměření (kategorie první aplikace); v tmavém tématu
          o polovinu silnější – na středně tmavé ploše by 5 % skoro nebylo vidět */}
      <Doodles seedKey={story.id} category={entries[0]?.categories[0]} ink={pattern} cols={6} rows={3} opacity={0.05} />
      <div className="relative flex-1 px-5 pt-5">
        {/* Nadpis je tlačítko kvůli klávesnici a čtečkám obrazovky; myší se klikne kamkoli na kartu */}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={t("collection.open", { name: title })}
          className="block cursor-pointer rounded-xl text-left outline-none focus-visible:ring-4 focus-visible:ring-black/20"
        >
          <p className="text-[11px] font-semibold tracking-[0.12em] uppercase opacity-75">{localize(story.eyebrow, language)}</p>
          <h3 className="mt-1 font-display text-2xl leading-tight font-bold">{title}</h3>
          <p className="mt-1 text-sm opacity-80">{localize(story.subtitle, language)}</p>
        </button>
        <div className="mt-4 flex flex-wrap gap-2">
          {entries.map((e) => (
            <Link
              key={e.id}
              to={`/package/${encodeURIComponent(e.id)}`}
              title={e.name}
              onClick={(event) => event.stopPropagation()}
              className="rounded-[10px] transition-transform hover:-translate-y-0.5"
            >
              <PackageIcon id={e.id} name={e.name} iconUrl={e.iconUrl} size={40} className="icon-lifted" />
            </Link>
          ))}
        </div>
      </div>
      {/* Tlačítka se nezalamují uvnitř; když se do úzké karty nevejdou vedle sebe, „Do sady“ přejde na další řádek */}
      <div
        className="relative mt-4 flex flex-wrap items-center gap-2 px-5 py-3.5"
        style={{ background: glass(ink, 10), borderTop: `1px solid ${glass(ink, 12)}` }}
      >
        {pending.length > 0 ? (
          <button
            type="button"
            onClick={only(installAll)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-opacity hover:opacity-80"
            style={{ background: glass(ink, 18) }}
          >
            <Download className="size-3.5 shrink-0" />
            {t("home.installAll", { count: pending.length })}
          </button>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap opacity-80">
            <Check className="size-4" />
            {t("home.allInstalled")}
          </span>
        )}
        <button
          type="button"
          onClick={only(toBundle)}
          title={t("profiles.toBundleHint")}
          className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap opacity-85 transition-opacity hover:opacity-100"
        >
          <PackagePlus className="size-3.5 shrink-0" />
          {t("profiles.toBundle")}
        </button>
      </div>
    </article>
  );
}

/** Výzva: vytvořte si vlastní kolekci (sadu balíčků) a sdílejte ji odkazem. */
function CustomCollectionCard() {
  const { t } = useTranslation();
  const count = useBundle((s) => s.items.length);

  return (
    <article className="flex flex-col justify-between rounded-3xl border-2 border-dashed border-line p-5">
      <div>
        <span className="flex size-11 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <PackagePlus className="size-6" />
        </span>
        <h3 className="mt-3 font-display text-xl font-bold">{t("profiles.customTitle")}</h3>
        <p className="mt-1 text-sm text-muted">{t("profiles.customText")}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Link2 className="size-3.5" />
          {t("profiles.customShare")}
        </p>
      </div>
      <Link
        to="/bundles"
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
      >
        {count > 0 ? t("profiles.customOpen", { count }) : t("profiles.customStart")}
        <ArrowRight className="size-4" />
      </Link>
    </article>
  );
}
