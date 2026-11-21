/**
 * Váš rok s HubGetem (/year): souhrn operací za rok z místních statistik (store/yearStats.ts) –
 * kolik aplikací přibylo, kolik aktualizací (i automatických), odhad ušetřeného času,
 * nejčastěji aktualizované aplikace a nejrušnější měsíc. Jen z tohoto počítače, nic se neposílá.
 */
import { CalendarHeart, Clock, Download, RefreshCw, Sparkles, Trash2, Wrench } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Segmented } from "@/components/ui/CollectionToolbar";
import { EmptyState, PageHeader } from "@/components/ui/States";
import { useUrlState } from "@/hooks/useUrlState";
import { useHistory } from "@/store/history";
import { useSettings } from "@/store/settings";
import { savedMinutes, useYearStats } from "@/store/yearStats";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function YearPage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const years = useYearStats((s) => s.years);
  // Statistiky z dosavadní historie (poprvé)
  useEffect(() => useYearStats.getState().seed(useHistory.getState().items), []);

  const available = useMemo(() => Object.keys(years).sort().reverse(), [years]);
  const current = String(new Date().getFullYear());
  const [year, setYear] = useUrlState<string>("y", available[0] ?? current, (v) => available.includes(v));
  const stats = years[year];

  const top = useMemo(
    () => (stats ? Object.entries(stats.apps).sort((a, b) => b[1].updates - a[1].updates).slice(0, 5) : []),
    [stats],
  );
  const busiest = stats ? stats.months.indexOf(Math.max(...stats.months)) : -1;
  const minutes = stats ? savedMinutes(stats) : 0;
  const total = stats ? stats.installs + stats.updates + stats.uninstalls + stats.repairs : 0;
  const month = (m: number) => new Date(2000, m, 1).toLocaleDateString(language, { month: "long" });

  return (
    <>
      <PageHeader
        title={t("year.title", { year })}
        subtitle={t("year.subtitle")}
        actions={available.length > 1 && <Segmented value={year} onChange={setYear} options={available.map((y) => ({ value: y, label: y }))} />}
      />
      {!stats || total === 0 ? (
        <EmptyState icon={CalendarHeart} message={t("year.empty")} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            <Stat icon={Download} label={t("year.installs")} value={stats.installs} />
            <Stat icon={RefreshCw} label={t("year.updates")} value={stats.updates} hint={t("year.automatic", { count: stats.automatic })} />
            <Stat icon={Clock} label={t("year.saved")} value={minutes >= 120 ? Math.round(minutes / 60) : minutes} hint={t(minutes >= 120 ? "year.hours" : "year.minutes")} />
            <Stat icon={Trash2} label={t("year.uninstalls")} value={stats.uninstalls} />
            {stats.repairs > 0 && <Stat icon={Wrench} label={t("year.repairs")} value={stats.repairs} />}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {top.length > 0 && (
              <Card title={t("year.topApps")}>
                <ol className="flex flex-col gap-2 text-sm">
                  {top.map(([id, app], i) => (
                    <li key={id} className="flex items-center gap-3">
                      <span className="w-5 text-right font-display font-bold text-muted tabular-nums">{i + 1}</span>
                      <Link to={detailUrl(id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
                        {app.name}
                      </Link>
                      <span className="shrink-0 text-muted tabular-nums">{t("year.updateCount", { count: app.updates })}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
            <Card title={t("year.months")}>
              <div className="flex h-32 items-end gap-1.5" role="img" aria-label={busiest >= 0 ? t("year.busiest", { month: month(busiest) }) : undefined}>
                {stats.months.map((count, m) => (
                  <div key={m} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className={m === busiest ? "w-full rounded-t-md bg-accent" : "w-full rounded-t-md bg-accent/35"}
                      style={{ height: `${Math.max(4, (count / Math.max(1, ...stats.months)) * 100)}%` }}
                      title={`${month(m)}: ${count}`}
                    />
                    <span className="text-[10px] text-muted">{new Date(2000, m, 1).toLocaleDateString(language, { month: "narrow" })}</span>
                  </div>
                ))}
              </div>
              {busiest >= 0 && (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <Sparkles className="size-4 text-accent" />
                  {t("year.busiest", { month: month(busiest) })}
                </p>
              )}
            </Card>
          </div>
          <p className="mt-6 text-xs text-muted">{t("year.note", { date: new Date(stats.first).toLocaleDateString(language) })}</p>
        </>
      )}
    </>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Download; label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <Icon className="mb-2 size-5 text-accent" aria-hidden />
      <p className="font-display text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 font-display text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
