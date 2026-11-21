/**
 * Nový počítač (/new-pc, po vzoru Ninite): oblíbené aplikace po kategoriích (data/newPc.ts)
 * k zaškrtnutí – HubGet vybrané nainstaluje najednou (fronta úloh, jedna po druhé) nebo je
 * uloží jako sadu balíčků na později. Nainstalované aplikace jsou označené a nejdou vybrat.
 */
import { Check, Download, MonitorDown, PackagePlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PackageIcon } from "@/components/package/PackageIcon";
import { Button } from "@/components/ui/Button";
import { CardSkeletons, PageHeader } from "@/components/ui/States";
import { NEW_PC_GROUPS } from "@/data/newPc";
import { pickSource, useCatalogIndex, useInstalledIndex } from "@/hooks/usePackages";
import { cn } from "@/lib/utils";
import { useBundle } from "@/store/bundle";
import { useBusyAppIds, useJobs } from "@/store/jobs";
import { useSourceScope } from "@/store/sourceLock";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry } from "@/types";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function NewPcPage() {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const catalogIndex = useCatalogIndex();
  const installedIndex = useInstalledIndex();
  const busy = useBusyAppIds();
  const enqueue = useJobs((s) => s.enqueue);
  const addToBundle = useBundle((s) => s.add);
  const { enabled, preferred } = useSourceScope();
  const [selected, setSelected] = useState<string[]>([]);

  // Skupiny jen s aplikacemi, které katalog zná a jde je nainstalovat zapnutým správcem
  const groups = useMemo(
    () =>
      NEW_PC_GROUPS.map((g) => ({
        ...g,
        entries: g.apps.map((id) => catalogIndex.get(id)).filter((e): e is CatalogEntry => !!e && !!pickSource(e, enabled, preferred)),
      })).filter((g) => g.entries.length > 0),
    [catalogIndex, enabled, preferred],
  );
  const chosen = groups.flatMap((g) => g.entries).filter((e) => selected.includes(e.id) && !installedIndex.has(e.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const install = () => {
    let queued = 0;
    for (const e of chosen) {
      const source = pickSource(e, enabled, preferred);
      if (!source || busy.has(e.id)) continue;
      enqueue({ appId: e.id, appName: e.name, source: source.source, packageId: source.packageId, kind: "install" });
      queued++;
    }
    toast("success", t("bundles.queued", { count: queued }));
    setSelected([]);
  };

  const saveBundle = () => {
    for (const e of chosen) {
      const source = pickSource(e, enabled, preferred);
      if (source) addToBundle({ appId: e.id, name: e.name, source: source.source, packageId: source.packageId });
    }
    toast("success", t("selection.addedToBundle", { count: chosen.length }));
  };

  if (!catalogIndex.size) return <CardSkeletons count={6} />;

  return (
    <>
      <PageHeader
        title={t("newPc.title")}
        subtitle={t("newPc.subtitle")}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={saveBundle} disabled={!chosen.length}>
              <PackagePlus className="size-4" />
              {t("newPc.saveBundle")}
            </Button>
            <Button onClick={install} disabled={!chosen.length}>
              <Download className="size-4" />
              {t("newPc.install", { count: chosen.length })}
            </Button>
          </div>
        }
      />

      {groups.map((group) => (
        <section key={group.category} className="mb-7" aria-label={t(`categories.${group.category}`)}>
          <h2 className="mb-3 font-display text-lg font-bold">{t(`categories.${group.category}`)}</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
            {group.entries.map((entry) => {
              const installed = installedIndex.has(entry.id);
              const checked = installed || selected.includes(entry.id);
              return (
                <li key={entry.id}>
                  <label
                    className={cn(
                      "flex h-full items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
                      installed ? "cursor-default border-line bg-surface opacity-70" : "cursor-pointer hover:bg-surface-2/60",
                      !installed && selected.includes(entry.id) ? "border-accent/50 bg-accent/8" : "border-line bg-surface",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={installed}
                      onChange={() => toggle(entry.id)}
                      className="size-4 shrink-0 accent-[var(--accent)]"
                    />
                    <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{entry.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {installed ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <Check className="size-3" aria-hidden />
                            {t("newPc.installed")}
                          </span>
                        ) : (
                          entry.description
                        )}
                      </span>
                    </span>
                    <Link
                      to={detailUrl(entry.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("newPc.details", { name: entry.name })}
                      title={t("newPc.details", { name: entry.name })}
                      className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      {t("newPc.more")}
                    </Link>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="flex items-center gap-2 text-xs text-muted">
        <MonitorDown className="size-4" aria-hidden />
        {t("newPc.hint")}
      </p>
    </>
  );
}
