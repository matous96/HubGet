/**
 * Předinstalované aplikace Windows (Přehled počítače): hry, zprávy, tipy a aplikace partnerů,
 * které Windows nebo výrobce počítače nainstaluje s novým účtem. Panel ukáže, kolik jich
 * v počítači je; okno je vypíše po skupinách s výběrem („Vybrat doporučené“ – jen aplikace,
 * které většina lidí nepotřebuje) a odebere vybrané jen aktuálnímu uživateli. Odebrané jde
 * vrátit z Microsoft Storu. Seznam bezpečně odebratelných balíčků je v src-tauri/src/preinstalled.rs.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Info, PackageX, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient, queryKeys } from "@/app/queryClient";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/States";
import { sourceKey } from "@/hooks/usePackages";
import { appIconSrc } from "@/lib/iconSrc";
import { useStartApps } from "@/lib/launch";
import { cn } from "@/lib/utils";
import { useHistory } from "@/store/history";
import { usePreinstalled } from "@/store/preinstalled";
import { useToasts } from "@/store/toasts";

export type PreinstalledGroup = "games" | "microsoft" | "partners";

/** Předinstalovaná aplikace, jak ji vrací backend (preinstalled.rs). */
export interface PreinstalledApp {
  name: string;
  fullName: string;
  family: string;
  displayName: string;
  version: string;
  group: PreinstalledGroup;
  recommended: boolean;
}

interface RemoveResult {
  name: string;
  ok: boolean;
  error?: string;
}

const GROUPS: PreinstalledGroup[] = ["games", "microsoft", "partners"];
export const PREINSTALLED_KEY = ["preinstalled-apps"] as const;

export function usePreinstalledApps() {
  return useQuery({
    queryKey: PREINSTALLED_KEY,
    queryFn: () => invoke<PreinstalledApp[]>("preinstalled_apps"),
    staleTime: 10 * 60_000,
  });
}

/** Panel v Přehledu počítače: počet nalezených, kolik doporučujeme odebrat, tlačítko Projít. */
export function PreinstalledPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = usePreinstalledApps();
  const removed = usePreinstalled((s) => s.removed);
  const [open, setOpen] = useState(false);
  const recommended = (data ?? []).filter((a) => a.recommended).length;

  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <PackageX className="size-5 text-accent" />
          {t("preinstalled.title")}
        </h2>
        {(!!data?.length || removed.length > 0) && <Button onClick={() => setOpen(true)}>{t("preinstalled.review")}</Button>}
      </div>
      <p className="mb-3 text-sm text-muted">{t("preinstalled.hint")}</p>
      {isLoading ? (
        <Spinner className="size-5" />
      ) : isError ? (
        <p className="text-sm text-muted">{t("preinstalled.failed")}</p>
      ) : !data?.length ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          {t("preinstalled.none")}
        </p>
      ) : (
        <p className="text-sm">
          {t("preinstalled.found", { count: data.length })}
          {recommended > 0 && <span className="text-muted"> · {t("preinstalled.recommendedCount", { count: recommended })}</span>}
        </p>
      )}
      <PreinstalledDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function PreinstalledDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const addHistory = useHistory((s) => s.add);
  const { data } = usePreinstalledApps();
  const { removed, add: rememberRemoved, forget } = usePreinstalled();
  const { data: startApps } = useStartApps();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const apps = useMemo(() => data ?? [], [data]);

  // Aplikace, která je zase nainstalovaná, už mezi odebranými není
  useEffect(() => {
    if (data) forget(data.map((a) => a.name));
  }, [data, forget]);
  // Výběr jen z toho, co ve výpisu pořád je
  useEffect(() => {
    setSelected((s) => s.filter((name) => apps.some((a) => a.name === name)));
  }, [apps]);

  // Ikona z nabídky Start (AppID aplikace ze Storu začíná rodinou balíčku)
  const iconOf = (family: string) => {
    const app = startApps?.find((a) => a.appId.toLowerCase().startsWith(`${family.toLowerCase()}!`));
    return app ? appIconSrc(app.appId) : null;
  };

  const remove = useMutation({
    mutationFn: (names: string[]) => invoke<RemoveResult[]>("remove_preinstalled", { names }),
    onSuccess: (results) => {
      const now = new Date().toISOString();
      const done = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      rememberRemoved(
        done.flatMap((r) => {
          const app = apps.find((a) => a.name === r.name);
          return app ? [{ name: app.name, family: app.family, displayName: app.displayName }] : [];
        }),
      );
      for (const r of results) {
        const app = apps.find((a) => a.name === r.name);
        if (!app) continue;
        addHistory({
          id: crypto.randomUUID(),
          appId: sourceKey("winget", `MSIX\\${app.fullName}`),
          appName: app.displayName,
          source: "winget",
          packageId: `MSIX\\${app.fullName}`,
          kind: "uninstall",
          version: app.version,
          outcome: r.ok ? "success" : "error",
          error: r.error,
          startedAt: now,
          finishedAt: now,
        });
      }
      if (done.length) toast("success", t("preinstalled.removed", { count: done.length }));
      if (failed.length) toast("error", t("preinstalled.removeFailed", { names: failed.map((r) => apps.find((a) => a.name === r.name)?.displayName ?? r.name).join(", ") }));
      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: PREINSTALLED_KEY });
      // Aplikace ze Storu jsou i mezi nainstalovanými (MSIX\…) – obnovit výpis
      void queryClient.invalidateQueries({ queryKey: queryKeys.installed });
    },
    onError: (error) => toast("error", t("preinstalled.removeError", { error: String(error) })),
  });

  const busy = remove.isPending;
  const toggle = (name: string) => setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));
  const recommended = apps.filter((a) => a.recommended).map((a) => a.name);
  const selectedNames = apps.filter((a) => selected.includes(a.name)).map((a) => a.displayName);
  const restore = (family: string) =>
    invoke("preinstalled_store_page", { family }).catch((error) => toast("error", t("preinstalled.storeFailed", { error: String(error) })));

  return (
    <>
      <Modal
        open={open}
        onClose={busy ? () => {} : onClose}
        title={t("preinstalled.title")}
        className="max-w-2xl"
        footer={
          apps.length > 0 ? (
            <>
              <Button variant="secondary" onClick={() => setSelected(recommended)} disabled={busy || recommended.length === 0}>
                {t("preinstalled.selectRecommended", { count: recommended.length })}
              </Button>
              <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy || selected.length === 0}>
                {busy ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
                {t("preinstalled.remove", { count: selected.length })}
              </Button>
            </>
          ) : undefined
        }
      >
        <p className="-mt-1 mb-4 flex gap-2 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          {t("preinstalled.intro")}
        </p>

        {GROUPS.map((group) => {
          const items = apps.filter((a) => a.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="mb-4">
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t(`preinstalled.group.${group}`)}</h3>
              <ul className="overflow-hidden rounded-2xl border border-line">
                {items.map((app) => {
                  const icon = iconOf(app.family);
                  return (
                    <li key={app.name} className="border-b border-line last:border-b-0">
                      <label className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60", busy && "cursor-default")}>
                        <input
                          type="checkbox"
                          checked={selected.includes(app.name)}
                          disabled={busy}
                          onChange={() => toggle(app.name)}
                          className="size-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                          {icon ? <img src={icon} alt="" className="size-6 object-contain" /> : <PackageX className="size-4 text-muted" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{app.displayName}</span>
                          <span className="block truncate text-[11px] text-muted">{app.name}</span>
                        </span>
                        {app.recommended && (
                          <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">{t("preinstalled.recommended")}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {apps.length === 0 && (
          <p className="flex items-center justify-center gap-2 py-6 text-sm font-medium text-success">
            <CheckCircle2 className="size-5" />
            {t("preinstalled.none")}
          </p>
        )}

        {removed.length > 0 && (
          <div className="mt-2">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t("preinstalled.removedTitle")}</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {removed.map((r) => (
                <li key={r.name} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate">{r.displayName}</span>
                  <button
                    type="button"
                    onClick={() => void restore(r.family)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10"
                  >
                    <RotateCcw className="size-3.5" />
                    {t("preinstalled.restore")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirming}
        danger
        title={t("preinstalled.confirm", { count: selectedNames.length, names: selectedNames.join(", ") })}
        confirmLabel={t("preinstalled.remove", { count: selectedNames.length })}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate(selected);
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
