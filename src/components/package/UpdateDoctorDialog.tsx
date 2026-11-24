/**
 * Proč aktualizace selhala? (Historie operací → u chyby): průvodce projde, co mohlo operaci
 * zastavit – programy, které drží soubory aplikace (načtené knihovny i Restart Manager, i služby),
 * běžící aplikaci, čekající restart Windows a co říká chyba (připojení, místo, práva správce,
 * manifest wingetu). „Opravit a zkusit znovu“ zavře, co zavřít jde, a operaci zopakuje s hlídáním
 * procesů, které se znovu spustí; „Dokončit při příštím přihlášení“ ji odloží (store/updateFixes);
 * u chyby manifestu nabídne předvyplněné hlášení do winget-pkgs (lib/manifestIssue).
 */
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { CircleCheck, CloudOff, Flag, HardDrive, History, Power, ShieldUser, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/States";
import { manifestIssueUrl, MANIFEST_ERRORS } from "@/lib/manifestIssue";
import { isTauri } from "@/lib/tauri";
import { closeApp, findAppProcesses, type RunningProcess } from "@/services/processes";
import { useJobs } from "@/store/jobs";
import { retryRequest, useDeferredUpdates, useUpdateDoctor } from "@/store/updateFixes";

interface Diagnosis {
  blockers: RunningProcess[];
  running: RunningProcess[];
  rebootPending: boolean;
  windows?: string;
}

async function diagnose(packageId: string, name: string): Promise<Diagnosis> {
  if (!isTauri()) return { blockers: [], running: [], rebootPending: false };
  const [blockers, running, health, system] = await Promise.all([
    invoke<RunningProcess[]>("app_blockers", { packageId, name }).catch(() => []),
    findAppProcesses(packageId, name).catch(() => []),
    invoke<{ rebootPending: boolean }>("windows_health").catch(() => null),
    invoke<{ osName?: string; osDisplayVersion?: string }>("system_info").catch(() => null),
  ]);
  const windows = [system?.osName, system?.osDisplayVersion].filter(Boolean).join(" ") || undefined;
  return { blockers, running, rebootPending: !!health?.rebootPending, windows };
}

function Finding({ icon: Icon, tone = "warning", title, children }: { icon: LucideIcon; tone?: "warning" | "info" | "ok"; title: string; children?: ReactNode }) {
  const color = tone === "ok" ? "text-success" : tone === "info" ? "text-accent" : "text-amber-500";
  return (
    <li className="flex gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
      <Icon className={`mt-0.5 size-5 shrink-0 ${color}`} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-muted">{children}</div>}
      </div>
    </li>
  );
}

export function UpdateDoctorDialog() {
  const { t } = useTranslation();
  const entry = useUpdateDoctor((s) => s.entry);
  const close = useUpdateDoctor((s) => s.close);
  const enqueue = useJobs((s) => s.enqueue);
  const defer = useDeferredUpdates((s) => s.add);
  const [fixing, setFixing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["update-doctor", entry?.id],
    queryFn: () => diagnose(entry!.packageId, entry!.appName),
    enabled: !!entry,
    staleTime: 0,
  });

  if (!entry) return null;
  const key = entry.errorKey;
  const admin = key === "requiresAdmin" || key === "needsAdmin";
  const names = (list: RunningProcess[]) => [...new Set(list.map((p) => p.description ?? p.name))].join(", ");
  const holders = data?.blockers ?? [];
  const running = data?.running ?? [];
  const manifest = entry.source === "winget" && !!key && MANIFEST_ERRORS.has(key);
  const nothing = data && !holders.length && !running.length && !data.rebootPending && !key;

  const fixAndRetry = async () => {
    setFixing(true);
    // Zavřít, co zavřít jde (okna slušně, procesy bez okna natvrdo – closeApp); zbytek ohlídá backend
    const pids = [...new Set([...running, ...holders].map((p) => p.pid))];
    if (pids.length) await closeApp(pids).catch(() => undefined);
    enqueue(retryRequest(entry, admin ? { asAdmin: true } : {}));
    setFixing(false);
    close();
  };

  const deferToLogin = async () => {
    const session = isTauri() ? await invoke<{ boot: number }>("session_info").catch(() => ({ boot: 0 })) : { boot: 0 };
    defer({ request: retryRequest(entry), boot: session.boot, at: Date.now() });
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title={t("doctor.title", { name: entry.appName })}
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => void deferToLogin()} disabled={fixing}>
            <History className="size-4" />
            {t("doctor.defer")}
          </Button>
          <Button onClick={() => void fixAndRetry()} disabled={fixing || isLoading}>
            {fixing ? <Spinner className="size-4 text-accent-fg" /> : <CircleCheck className="size-4" />}
            {t("doctor.fix")}
          </Button>
        </>
      }
    >
      {entry.error && <p className="mb-4 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{entry.error}</p>}
      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-4" />
          {t("doctor.checking")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {running.length > 0 && (
            <Finding icon={TriangleAlert} title={t("doctor.running", { name: entry.appName })}>
              {t("doctor.runningHint")}
            </Finding>
          )}
          {holders.length > 0 && (
            <Finding icon={TriangleAlert} title={t("doctor.holders", { names: names(holders) })}>
              {t("doctor.holdersHint")}
            </Finding>
          )}
          {data?.rebootPending && (
            <Finding icon={Power} tone="info" title={t("doctor.reboot")}>
              {t("doctor.rebootHint")}
            </Finding>
          )}
          {admin && (
            <Finding icon={ShieldUser} tone="info" title={t("doctor.admin")}>
              {t("doctor.adminHint")}
            </Finding>
          )}
          {(key === "network" || key === "downloadFailed") && (
            <Finding icon={CloudOff} tone="info" title={t("doctor.network")}>
              {t("doctor.networkHint")}
            </Finding>
          )}
          {key === "diskFull" && (
            <Finding icon={HardDrive} title={t("doctor.disk")}>
              <Link to="/overview" onClick={close} className="font-medium text-accent hover:underline">
                {t("doctor.diskLink")}
              </Link>
            </Finding>
          )}
          {(key === "signatureInvalid" || key === "signatureMissing" || key === "signerChanged") && (
            <Finding icon={ShieldUser} title={t("doctor.signature")}>
              {t("doctor.signatureHint")}
            </Finding>
          )}
          {manifest && (
            <Finding icon={Flag} tone="info" title={t("doctor.manifest")}>
              <span>{t("doctor.manifestHint")} </span>
              <a href={manifestIssueUrl(entry, data?.windows)} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                {t("doctor.manifestReport")}
              </a>
            </Finding>
          )}
          {nothing && <Finding icon={CircleCheck} tone="ok" title={t("doctor.nothing")}>{t("doctor.nothingHint")}</Finding>}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">{t("doctor.deferHint")}</p>
    </Modal>
  );
}
