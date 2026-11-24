/**
 * Přehled před „Aktualizovat vše“ (Nainstalované → Dostupné aktualizace): co se aktualizuje,
 * z jaké na jakou verzi, štítky Bezpečnostní a Velká, první věta novinek, velikost instalátorů
 * a celkem ke stažení; zaškrtnutím jde vybrat jen některé. Vypnout jde v Nastavení →
 * Aktualizace balíčků (nebo zaškrtnutím „Příště neukazovat“).
 */
import { ArrowRight, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { PackageIcon } from "@/components/package/PackageIcon";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useUpdates, type InstalledItem } from "@/hooks/useInstalledItems";
import { isSecurityUpdate } from "@/hooks/useSecurityUpdates";
import { isMajorUpdate, notesTeaser } from "@/lib/majorUpdate";
import { formatSizeText } from "@/lib/utils";
import { useAutoUpdates } from "@/store/autoUpdates";
import { useBusyAppIds } from "@/store/jobs";
import { useSettings } from "@/store/settings";

interface OverviewState {
  open: boolean;
  show: () => void;
  close: () => void;
}

export const useUpdatesOverview = create<OverviewState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/** Velikost instalátoru nabízené verze ze zdroje, přes který je aplikace nainstalovaná (bajty). */
const installerSize = ({ entry, pkg }: InstalledItem) => entry.sources.find((s) => s.source === pkg.source)?.size ?? null;

export function UpdatesOverviewDialog() {
  const open = useUpdatesOverview((s) => s.open);
  if (!open) return null;
  return <Overview />;
}

function Overview() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const close = useUpdatesOverview((s) => s.close);
  const { updatable, updateItems } = useUpdates();
  const busy = useBusyAppIds();
  // Bezpečnostní první, pak velké, pak podle názvu
  const items = useMemo(
    () =>
      updatable
        .filter((i) => !busy.has(i.entry.id))
        .map((i) => ({ item: i, security: isSecurityUpdate(i.pkg), major: isMajorUpdate(i.pkg.installedVersion, i.pkg.availableVersion) }))
        .sort((a, b) => Number(b.security) - Number(a.security) || Number(b.major) - Number(a.major) || a.item.entry.name.localeCompare(b.item.entry.name, language)),
    [updatable, busy, language],
  );
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [hide, setHide] = useState(false);
  const chosen = items.filter(({ item }) => !unchecked.has(item.entry.id));
  const total = chosen.reduce((sum, { item }) => sum + (installerSize(item) ?? 0), 0);
  const unknown = chosen.some(({ item }) => installerSize(item) === null);

  const toggle = (id: string) =>
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = () => {
    if (hide) useAutoUpdates.getState().set({ overviewBeforeUpdateAll: false });
    void updateItems(chosen.map(({ item }) => item));
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title={t("updatesOverview.title", { count: items.length })}
      className="max-w-2xl"
      footer={
        <>
          <label className="mr-auto inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
            {t("updatesOverview.dontShow")}
          </label>
          <Button variant="secondary" onClick={close}>
            {t("package.cancel")}
          </Button>
          <Button onClick={start} disabled={!chosen.length}>
            <RefreshCw className="size-4" />
            {t("updatesOverview.start", { count: chosen.length })}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        {total > 0 ? t(unknown ? "updatesOverview.sizeAtLeast" : "updatesOverview.size", { size: formatSizeText(total, language) }) : t("updatesOverview.sizeUnknown")}
      </p>
      <ul className="-mx-2 max-h-[55vh] overflow-y-auto">
        {items.map(({ item, security, major }) => {
          const { entry, pkg } = item;
          const size = installerSize(item);
          const teaser = entry.latestVersion === pkg.availableVersion ? notesTeaser(entry.releaseNotes, 120) : null;
          const checked = !unchecked.has(entry.id);
          return (
            <li key={entry.id}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2">
                <input type="checkbox" checked={checked} onChange={() => toggle(entry.id)} className="mt-3 size-4 shrink-0 accent-[var(--color-accent)]" aria-label={entry.name} />
                <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-semibold">{entry.name}</span>
                    {security && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-semibold text-danger">
                        <ShieldAlert className="size-3" />
                        {t("security.badge")}
                      </span>
                    )}
                    {major && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent">
                        <Sparkles className="size-3" />
                        {t("majorUpdate.badge")}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted tabular-nums">
                    {pkg.installedVersion}
                    <ArrowRight className="size-3" />
                    <span className="font-semibold text-accent">{pkg.availableVersion}</span>
                    {size !== null && <span>· {formatSizeText(size, language)}</span>}
                  </span>
                  {teaser && <span className="mt-0.5 line-clamp-2 block text-xs text-fg/80">{teaser}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
