/**
 * Přehled počítače (jen desktop): souhrn nainstalovaných aplikací – kolik jich je
 * a kolik zabírají, aktualizace, nepoužívané, bez podpory, dvakrát –, největší
 * aplikace, aplikace spouštěné s Windows zbytečně, úklid mezipamětí správců
 * (backend caches.rs) a kontrola digitálních podpisů (signatures.rs).
 */
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  DatabaseBackup,
  GitFork,
  CheckCircle2,
  Clock,
  Copy,
  HardDrive,
  Package,
  Power,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { EmptyState, PageHeader, Spinner } from "@/components/ui/States";
import { WindowsHealthPanel } from "@/components/home/WindowsHealthPanel";
import { useDuplicates } from "@/components/package/InstalledNotices";
import { UNUSED_DAYS, useUnusedApps } from "@/hooks/useAppUsage";
import { useEndOfLife } from "@/hooks/useEndOfLife";
import { isUnmanagedOrigin, useInstalledItems, useUpdates } from "@/hooks/useInstalledItems";
import { useCatalog, useCatalogIndex } from "@/hooks/usePackages";
import { isGameStore } from "@/services/managers";
import { PreinstalledPanel } from "@/components/home/PreinstalledPanel";
import { DriversPanel } from "@/components/home/DriversPanel";
import { isClosed, openSourceAlternatives } from "@/lib/alternatives";
import { isTauri } from "@/lib/tauri";
import { cn, formatRelative, formatSizeText } from "@/lib/utils";
import { useHistory } from "@/store/history";
import { useJobs } from "@/store/jobs";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";

const DAY_MS = 24 * 60 * 60_000;
const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

interface CacheInfo {
  id: string;
  path: string;
  bytes: number;
}

type SignatureStatus = "signed" | "unsigned" | "invalid" | "unknown";

/** Dlaždice s číslem. */
function Stat({ icon: Icon, label, value, hint, to, tone }: { icon: LucideIcon; label: string; value: string; hint?: string; to?: string; tone?: "warn" | "danger" }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-medium text-muted">
        <Icon className={cn("size-4", tone === "danger" ? "text-danger" : tone === "warn" ? "text-amber-500" : "text-accent")} />
        {label}
      </span>
      <span className="mt-2 font-display text-2xl font-bold tabular-nums">{value}</span>
      {hint && <span className="mt-0.5 text-xs text-muted">{hint}</span>}
    </>
  );
  const className = "flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-card";
  return to ? (
    <Link to={to} className={cn(className, "transition-colors hover:border-accent/50")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Panel({ title, icon: Icon, children, action }: { title: string; icon: LucideIcon; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Icon className="size-5 text-accent" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { items, isLoading } = useInstalledItems();
  const { updatable } = useUpdates();
  const usage = useUnusedApps(items, isTauri());
  const ended = useEndOfLife(items);
  const duplicates = useDuplicates(items);
  const history = useHistory((s) => s.items);
  const busy = useJobs((s) => Object.keys(s.jobs).length > 0);

  const managed = items.filter((i) => !isUnmanagedOrigin(i.pkg.origin)).length;
  const totalSize = useMemo(() => [...usage.sizes.values()].reduce((a, b) => a + b, 0), [usage.sizes]);
  const monthAgo = Date.now() - 30 * DAY_MS;
  const updatedMonth = history.filter((h) => h.kind === "update" && h.outcome === "success" && Date.parse(h.finishedAt) >= monthAgo).length;
  const largest = useMemo(
    () =>
      items
        .filter((i) => usage.sizes.has(i.entry.id))
        .sort((a, b) => usage.sizes.get(b.entry.id)! - usage.sizes.get(a.entry.id)!)
        .slice(0, 6),
    [items, usage.sizes],
  );
  const oldest = useMemo(
    () => items.filter((i) => i.pkg.installedAt).sort((a, b) => a.pkg.installedAt! - b.pkg.installedAt!)[0],
    [items],
  );

  if (!isTauri()) return <EmptyState message={t("overview.desktopOnly")} />;

  return (
    <>
      <PageHeader title={t("overview.title")} subtitle={t("overview.subtitle")} />

      {isLoading ? (
        <Spinner className="size-6" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            <Stat icon={Package} label={t("overview.apps")} value={String(items.length)} hint={t("overview.managed", { count: managed })} to="/installed" />
            <Stat
              icon={HardDrive}
              label={t("overview.size")}
              value={usage.isLoading ? "…" : totalSize ? formatSizeText(totalSize, language) : "–"}
              hint={t("overview.sizeHint", { count: usage.sizes.size })}
            />
            <Stat icon={RefreshCw} label={t("overview.updates")} value={String(updatable.length)} hint={t("overview.updatedMonth", { count: updatedMonth })} to="/installed?filter=updates" />
            <Stat
              icon={Clock}
              label={t("overview.unused")}
              // Záznamy o spuštění se ještě načítají – ne „0“, které by pak poskočilo
              value={usage.isLoading ? "…" : String(usage.unused.length)}
              hint={usage.unusedSize ? formatSizeText(usage.unusedSize, language) : t("overview.unusedHint", { days: UNUSED_DAYS })}
              to="/installed?filter=unused"
              tone={usage.unused.length ? "warn" : undefined}
            />
            <Stat icon={ShieldOff} label={t("overview.eol")} value={String(ended.length)} to="/installed" tone={ended.length ? "danger" : undefined} />
            <Stat icon={Copy} label={t("overview.duplicates")} value={String(duplicates.length)} to="/installed" tone={duplicates.length ? "warn" : undefined} />
          </div>

          {/* Podpora Windows, čekající restart, místo na disku, ochrana systému */}
          <WindowsHealthPanel />

          {oldest && (
            <p className="-mt-2 mb-6 text-xs text-muted">
              {t("overview.oldest", { name: oldest.entry.name, when: formatRelative(new Date(oldest.pkg.installedAt!).toISOString(), language) })}
            </p>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              {largest.length > 0 && (
                <Panel title={t("overview.largest")} icon={HardDrive}>
                  <ul className="flex flex-col gap-2">
                    {largest.map((i) => {
                      const bytes = usage.sizes.get(i.entry.id)!;
                      return (
                        <li key={`${i.pkg.source}:${i.pkg.packageId}`} className="flex items-center gap-3 text-sm">
                          <Link to={detailUrl(i.entry.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
                            {i.entry.name}
                          </Link>
                          <span className="shrink-0 text-muted tabular-nums">{formatSizeText(bytes, language)}</span>
                          <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-surface-3">
                            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (bytes / usage.sizes.get(largest[0].entry.id)!) * 100)}%` }} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              )}
              <IdleAutostart apps={usage.idleAutostart} />
              <OpenSourcePanel items={items} />
            </div>
            <div>
              <PreinstalledPanel />
              <DriversPanel />
              <CachesPanel busy={busy} />
              <BackupsPanel />
              <SignaturesPanel items={items} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Aplikace, které se spouštějí s Windows, ale ručně je dlouho nikdo neotevřel. */
function IdleAutostart({ apps }: { apps: ReturnType<typeof useUnusedApps>["idleAutostart"] }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  if (!apps.length) return null;
  return (
    <Panel
      title={t("overview.idleAutostart")}
      icon={Power}
      action={
        <Link to="/startup" className="text-sm font-semibold text-accent hover:underline">
          {t("overview.openStartup")}
        </Link>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("overview.idleAutostartHint", { days: UNUSED_DAYS })}</p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {apps.map(({ item, lastUsed }) => (
          <li key={`${item.pkg.source}:${item.pkg.packageId}`} className="flex items-center gap-2">
            <Link to={detailUrl(item.entry.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {item.entry.name}
            </Link>
            <span className="shrink-0 text-xs text-muted">
              {lastUsed ? t("unused.lastUsed", { when: formatRelative(new Date(lastUsed).toISOString(), language) }) : t("unused.never")}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Nainstalované uzavřené aplikace s open-source náhradou z katalogu (lib/alternatives). */
function OpenSourcePanel({ items }: { items: ReturnType<typeof useInstalledItems>["items"] }) {
  const { t } = useTranslation();
  const { data } = useCatalog();
  const byId = useCatalogIndex();
  const rows = useMemo(() => {
    const catalog = data?.catalog.packages ?? [];
    if (!catalog.length) return [];
    const installed = new Set(items.map((i) => i.entry.id));
    return items
      .filter((i) => !isUnmanagedOrigin(i.pkg.origin) && isClosed(i.entry))
      .map((i) => ({ item: i, alternatives: openSourceAlternatives(i.entry, catalog, byId).filter((a) => !installed.has(a.id)).slice(0, 3) }))
      .filter((r) => r.alternatives.length > 0)
      .sort((a, b) => b.item.entry.popularity - a.item.entry.popularity)
      .slice(0, 6);
  }, [data, byId, items]);
  if (!rows.length) return null;
  return (
    <Panel title={t("overview.openSource")} icon={GitFork}>
      <p className="mb-3 text-sm text-muted">{t("overview.openSourceHint")}</p>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map(({ item, alternatives }) => (
          <li key={item.entry.id} className="min-w-0">
            <Link to={detailUrl(item.entry.id)} className="font-medium hover:underline">
              {item.entry.name}
            </Link>
            <span className="text-muted"> → </span>
            {alternatives.map((a, i) => (
              <span key={a.id}>
                {i > 0 && <span className="text-muted">, </span>}
                <Link to={detailUrl(a.id)} className="text-accent hover:underline">
                  {a.name}
                </Link>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Zálohy nastavení aplikací před aktualizací (settings_backup.rs) – kolik zabírají a smazání. */
function BackupsPanel() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const enabled = useSettings((s) => s.backupSettings);
  const toast = useToasts((s) => s.push);
  const { data, refetch } = useQuery({
    queryKey: ["settings-backups"],
    queryFn: () => invoke<{ count: number; bytes: number }>("settings_backups_info"),
    staleTime: 10 * 60_000,
  });
  const clear = useMutation({
    mutationFn: () => invoke("settings_backups_clear"),
    onSuccess: () => {
      toast("success", t("settingsBackup.cleared"));
      void refetch();
    },
  });
  if (!data || (!data.count && enabled)) return null;
  return (
    <Panel
      title={t("settingsBackup.title")}
      icon={DatabaseBackup}
      action={
        data.count > 0 && (
          <Button variant="secondary" onClick={() => clear.mutate()} disabled={clear.isPending}>
            <Trash2 className="size-4" />
            {t("settingsBackup.clear")}
          </Button>
        )
      }
    >
      <p className="text-sm text-muted">
        {data.count
          ? t("settingsBackup.summary", { count: data.count, size: formatSizeText(data.bytes, language) })
          : t("settingsBackup.off")}
      </p>
    </Panel>
  );
}

/** Mezipaměti správců balíčků a jejich úklid. */
function CachesPanel({ busy }: { busy: boolean }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["caches"], queryFn: () => invoke<CacheInfo[]>("cache_info"), staleTime: 10 * 60_000 });
  const clean = useMutation({
    mutationFn: async (ids: string[]) => {
      let freed = 0;
      for (const id of ids) freed += await invoke<number>("clean_cache", { id });
      return freed;
    },
    onSuccess: (freed) => {
      toast("success", t("overview.freed", { size: formatSizeText(freed, language) }));
      void refetch();
    },
  });
  const total = (data ?? []).reduce((sum, c) => sum + c.bytes, 0);

  return (
    <Panel
      title={t("overview.caches")}
      icon={Archive}
      action={
        total > 0 && (
          <Button onClick={() => clean.mutate((data ?? []).map((c) => c.id))} disabled={busy || clean.isPending} title={busy ? t("overview.cachesBusy") : undefined}>
            {clean.isPending ? <Spinner className="size-4 text-accent-fg" /> : <Trash2 className="size-4" />}
            {t("overview.freeAll", { size: formatSizeText(total, language) })}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-muted">{t("overview.cachesHint")}</p>
      {isLoading ? (
        <Spinner className="size-5" />
      ) : !data?.length ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          {t("overview.cachesEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {data.map((cache) => (
            <li key={cache.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate" title={cache.path}>
                <span className="font-medium">{t(`overview.cache_${cache.id}`)}</span>
              </span>
              <span className="shrink-0 text-muted tabular-nums">{formatSizeText(cache.bytes, language)}</span>
              <button
                type="button"
                disabled={busy || clean.isPending}
                onClick={() => clean.mutate([cache.id])}
                className="shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 disabled:cursor-default disabled:opacity-40"
              >
                {t("overview.clean")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="mt-3 text-xs text-muted">{t("overview.cachesBusy")}</p>}
    </Panel>
  );
}

/** Kontrola digitálních podpisů hlavních programů nainstalovaných aplikací (na požádání). */
function SignaturesPanel({ items }: { items: ReturnType<typeof useInstalledItems>["items"] }) {
  const { t } = useTranslation();
  const [results, setResults] = useState<{ item: (typeof items)[number]; status: SignatureStatus; file: string | null }[] | null>(null);
  const check = useMutation({
    mutationFn: async () => {
      // Bez balíčků ze Storu (podepisuje je Microsoft) a her ze Steamu a EA (soubory ověřuje
      // jejich spouštěč; samotné hry podepsané často nejsou a seznam by jen zahltily)
      const apps = items.filter(
        (i) => !i.pkg.diskLocation && !i.pkg.packageId.startsWith("MSIX\\") && !isGameStore(i.pkg.origin),
      );
      const signatures = await invoke<{ status: SignatureStatus; file: string | null }[]>("check_signatures", {
        apps: apps.map((i) => ({ packageId: i.pkg.packageId, name: i.pkg.name })),
      });
      return apps.map((item, i) => ({ item, status: signatures[i]?.status ?? "unknown", file: signatures[i]?.file ?? null }));
    },
    onSuccess: setResults,
  });
  const counts = (status: SignatureStatus) => results?.filter((r) => r.status === status).length ?? 0;
  const invalid = results?.filter((r) => r.status === "invalid") ?? [];
  const unsigned = results?.filter((r) => r.status === "unsigned") ?? [];
  const row = ({ item, status, file }: NonNullable<typeof results>[number]) => (
    <li key={`${item.pkg.source}:${item.pkg.packageId}`} className="flex items-center gap-2" title={file ?? undefined}>
      {status === "invalid" ? <AlertTriangle className="size-4 shrink-0 text-danger" /> : <ShieldOff className="size-4 shrink-0 text-muted" />}
      <Link to={detailUrl(item.entry.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
        {item.entry.name}
      </Link>
      <span className={cn("shrink-0 text-xs", status === "invalid" ? "text-danger" : "text-muted")}>{t(`overview.sig_${status}`)}</span>
    </li>
  );

  return (
    <Panel
      title={t("overview.signatures")}
      icon={ShieldCheck}
      action={
        <Button variant="secondary" onClick={() => check.mutate()} disabled={check.isPending || !items.length}>
          {check.isPending ? <Spinner className="size-4" /> : <ShieldCheck className="size-4" />}
          {t(results ? "overview.checkAgain" : "overview.check")}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("overview.signaturesHint")}</p>
      {results && (
        <>
          <p className="mb-2 text-sm">
            {t("overview.signaturesResult", { signed: counts("signed"), unsigned: counts("unsigned"), invalid: counts("invalid") })}
          </p>
          {/* Neplatný podpis je vidět vždy, programy bez podpisu (často open source) po rozbalení */}
          {invalid.length > 0 && <ul className="mb-2 flex flex-col gap-1.5 text-sm">{invalid.map(row)}</ul>}
          {unsigned.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-accent">{t("overview.showUnsigned", { count: unsigned.length })}</summary>
              <ul className="mt-2 flex flex-col gap-1.5">{unsigned.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}
