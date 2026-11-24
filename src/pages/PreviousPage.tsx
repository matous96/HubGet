/**
 * Dříve nainstalované (/previous) – jako „Zakoupené“ v App Storu: aplikace, které tu někdy
 * byly nainstalované a teď nejsou (store/everInstalled), a aplikace z ostatních počítačů na
 * účtu (Moje počítače), které tu chybí. Každá má mráček Nainstalovat znovu (PackageAction);
 * jde je skrýt a zase zobrazit. Uvolněné aplikace (store/offloaded) mají poznámku, že
 * nastavení zůstalo zachované a po instalaci se vrátí.
 */
import { CloudDownload, Eye, EyeOff } from "lucide-react";
import { useCallback, useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { PackageCollection } from "@/components/package/PackageCollection";
import { IconButton } from "@/components/ui/Button";
import { CollectionToolbar, Segmented } from "@/components/ui/CollectionToolbar";
import { CardSkeletons, EmptyState, PageHeader } from "@/components/ui/States";
import { useInstalled, useInstalledIndex, useCatalogIndex } from "@/hooks/usePackages";
import { useUrlState } from "@/hooks/useUrlState";
import { formatRelative } from "@/lib/utils";
import { useEverInstalled } from "@/store/everInstalled";
import { useOffloaded } from "@/store/offloaded";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";

const VIEWS = ["here", "devices", "hidden"] as const;
type View = (typeof VIEWS)[number];

export function PreviousPage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { isLoading } = useInstalled();
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const ids = useEverInstalled((s) => s.ids);
  const hidden = useEverInstalled((s) => s.hidden);
  const elsewhere = useEverInstalled((s) => s.elsewhere);
  const hide = useEverInstalled((s) => s.hide);
  const unhide = useEverInstalled((s) => s.unhide);
  const offloaded = useOffloaded((s) => s.items);
  const [view, setView] = useUrlState<View>("view", "here", (v) => (VIEWS as readonly string[]).includes(v));

  const { here, devices, hiddenList } = useMemo(() => {
    const isHidden = new Set(hidden);
    const absent = (id: string) => !installed.has(id) && catalog.has(id);
    // Tento počítač: od naposledy zaznamenané; uvolněné aplikace první (čekají na návrat)
    const hereAll = Object.entries(ids)
      .filter(([id]) => absent(id))
      .sort(([a, x], [b, y]) => Number(b in offloaded) - Number(a in offloaded) || y - x)
      .map(([id]) => catalog.get(id)!);
    // Ostatní počítače: jen to, co tu nikdy nebylo (jinak je to v Tento počítač), podle názvu
    const devicesAll = Object.keys(elsewhere)
      .filter((id) => absent(id) && !(id in ids))
      .map((id) => catalog.get(id)!)
      .sort((a, b) => a.name.localeCompare(b.name, language));
    const all = [...hereAll, ...devicesAll];
    return {
      here: hereAll.filter((e) => !isHidden.has(e.id)),
      devices: devicesAll.filter((e) => !isHidden.has(e.id)),
      hiddenList: all.filter((e) => isHidden.has(e.id)),
    };
  }, [ids, hidden, elsewhere, installed, catalog, offloaded, language]);

  // Prázdný pohled (skryté vše zobrazeno, počítače bez rozdílu) – zpět na Tento počítač
  const shown = view === "devices" && devices.length ? devices : view === "hidden" && hiddenList.length ? hiddenList : here;
  const active: View = shown === devices ? "devices" : shown === hiddenList ? "hidden" : "here";

  // Poznámka místo popisu: uvolněná aplikace (nastavení čeká), aplikace z jiného počítače
  const notes = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of shown) {
      const off = offloaded[entry.id];
      if (off) map.set(entry.id, t(off.backup ? "previous.offloaded" : "previous.offloadedNoBackup", { when: formatRelative(new Date(off.at).toISOString(), language) }));
      else if (elsewhere[entry.id] && !(entry.id in ids)) map.set(entry.id, t("previous.onDevices", { names: elsewhere[entry.id].join(", ") }));
    }
    return map;
  }, [shown, offloaded, elsewhere, ids, t, language]);

  // Skrýt / zobrazit – stabilní funkce (řádky seznamu jsou memo)
  const extra = useCallback(
    (entry: CatalogEntry) => {
      const isHidden = active === "hidden";
      const toggle = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (isHidden) unhide(entry.id);
        else hide(entry.id);
      };
      const label = t(isHidden ? "previous.unhide" : "previous.hide");
      return (
        <IconButton onClick={toggle} title={label} aria-label={`${label} – ${entry.name}`} className="relative z-10">
          {isHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </IconButton>
      );
    },
    [active, hide, unhide, t],
  );

  const options = [
    { value: "here" as const, label: t("previous.here", { n: here.length }) },
    ...(devices.length ? [{ value: "devices" as const, label: t("previous.devices", { n: devices.length }) }] : []),
    ...(hiddenList.length ? [{ value: "hidden" as const, label: t("previous.hidden", { n: hiddenList.length }) }] : []),
  ];

  return (
    <>
      <PageHeader
        title={t("previous.title")}
        subtitle={t("previous.subtitle")}
        actions={options.length > 1 ? <Segmented value={active} onChange={setView} options={options} /> : undefined}
      />
      {isLoading ? (
        <CardSkeletons count={6} />
      ) : shown.length === 0 ? (
        <EmptyState icon={CloudDownload} message={t("previous.empty")} />
      ) : (
        <>
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="text-sm text-muted">{t(`previous.hint.${active}`)}</p>
            <CollectionToolbar hideSort />
          </div>
          <PackageCollection packages={shown} notes={notes} noteTone="info" extra={extra} />
        </>
      )}
    </>
  );
}
