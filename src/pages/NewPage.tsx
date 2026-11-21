/**
 * Nově v katalogu (/new): aplikace, které do katalogu HubGetu přibyly za posledních 7, 30
 * nebo 90 dní (addedAt – data pipeline ho zapisuje při prvním výskytu balíčku), od nejnovější,
 * u každé den přidání. Bez balíčků jen pro vývojáře u běžného uživatele, s filtrem platformy
 * a zamčeným zdrojem. Katalog nové aplikace sleduje od určitého dne – dřívější zmizí z výběru,
 * na což stránka upozorní.
 */
import { Info, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArchFilter } from "@/components/package/ArchFilter";
import { PackageCollection } from "@/components/package/PackageCollection";
import { CollectionToolbar, Segmented } from "@/components/ui/CollectionToolbar";
import { CardSkeletons, EmptyState, PageHeader } from "@/components/ui/States";
import { useUrlState } from "@/hooks/useUrlState";
import { useArchFilter, useCatalog, useModeFilter } from "@/hooks/usePackages";
import { newInCatalog } from "@/lib/newApps";
import { dayLabel } from "@/lib/recentUpdates";
import { useSettings } from "@/store/settings";

const PERIODS = ["7", "30", "90"] as const;
type Period = (typeof PERIODS)[number];
const DAY_MS = 24 * 60 * 60_000;

export function NewPage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { data, isLoading } = useCatalog();
  const [period, setPeriod] = useUrlState<Period>("days", "30", (v) => (PERIODS as readonly string[]).includes(v));
  const modeFilter = useModeFilter();
  const { fits } = useArchFilter();
  const all = data?.catalog.packages;

  const packages = useMemo(
    // Běžný uživatel bez balíčků jen pro vývojáře; zamčený zdroj (levý panel) – obojí useModeFilter
    () => modeFilter(newInCatalog(all ?? [], Number(period)).filter((p) => fits(p))),
    [all, period, modeFilter, fits],
  );
  // Den přidání pod každou aplikací („Dnes“, „Včera“, „Před 3 dny“, pak datum)
  const notes = useMemo(() => new Map(packages.map((p) => [p.id, t("newApps.added", { when: dayLabel(p.addedAt!, language) })])), [packages, t, language]);
  // Od kdy katalog nové aplikace sleduje – starší přidání nezná
  const trackedSince = useMemo(() => {
    let first = Infinity;
    for (const p of all ?? []) if (p.addedAt) first = Math.min(first, Date.parse(p.addedAt));
    return Number.isFinite(first) ? first : null;
  }, [all]);
  const partial = trackedSince !== null && trackedSince > Date.now() - Number(period) * DAY_MS;

  return (
    <>
      <PageHeader
        title={t("newApps.title")}
        subtitle={t("newApps.subtitle", { count: Number(period) })}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Segmented value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: t("newApps.days", { count: Number(p) }) }))} />
            <ArchFilter />
          </div>
        }
      />
      {partial && (
        <p className="mb-5 flex items-start gap-2 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          {t("newApps.trackedSince", { date: new Date(trackedSince!).toLocaleDateString(language, { day: "numeric", month: "numeric", year: "numeric" }) })}
        </p>
      )}
      {isLoading ? (
        <CardSkeletons count={6} />
      ) : packages.length === 0 ? (
        <EmptyState icon={Sparkles} message={t("newApps.empty", { count: Number(period) })} />
      ) : (
        <>
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="text-sm text-muted">{t("newApps.count", { count: packages.length })}</p>
            <CollectionToolbar hideSort />
          </div>
          <PackageCollection packages={packages} notes={notes} />
        </>
      )}
    </>
  );
}
