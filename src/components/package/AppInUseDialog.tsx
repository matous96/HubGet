/**
 * Běžící aplikace a operace nad ní. Stav: store/appInUse.ts, backend:
 * src-tauri/src/running.rs.
 *
 *  - AppRunningDialog (před operací): aplikace běží s oknem, nebo se proces
 *    našel jen podle názvu. Jedním kliknutím ji zavře – nejdřív slušně
 *    (aplikace se může zeptat na uložení), pak případně natvrdo – a operace
 *    pokračuje. Jde i pokračovat bez zavření, nebo operaci zrušit.
 *  - AppInUseDialog (po neúspěchu): instalátor aplikaci nemohl přepsat
 *    (winget „inUse“) – dialog najde její procesy, nabídne je zavřít
 *    a operaci zařadí znovu. U „inUseByOther“ (soubory aplikace drží jiný
 *    program – virtuální kamera OBS v Edgi) nabídne zavřít ty programy.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/States";
import { closeProcesses, findAppProcesses, findFileUsers, type RunningProcess } from "@/services/processes";
import { useAppInUse } from "@/store/appInUse";
import { useJobs } from "@/store/jobs";

/** Seznam procesů s cestou v bublině; proces bez okna má štítek „na pozadí“. */
function ProcessList({ processes }: { processes: RunningProcess[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-3 flex flex-col gap-1 rounded-xl border border-line p-2 text-sm">
      {processes.map((p) => (
        <li key={p.pid} className="flex items-center justify-between gap-3 px-2 py-1" title={p.path}>
          <span className="min-w-0 truncate font-medium">{p.description ?? p.name}</span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
            {!p.visible && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t("appInUse.background")}</span>}
            PID {p.pid}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Zavření procesů: slušně, a když to nestačí, nabídka ukončení natvrdo.
 * `onClosed` se zavolá, až žádný proces neběží.
 */
function useCloseProcesses(processes: RunningProcess[] | undefined, onClosed: () => void) {
  /** Slušné zavření nestačilo – nabídnout ukončení natvrdo. */
  const [stubborn, setStubborn] = useState(false);
  const mutation = useMutation({
    mutationFn: (force: boolean) => closeProcesses((processes ?? []).map((p) => p.pid), force),
    onSuccess: (alive) => {
      if (alive.length) {
        setStubborn(true);
      } else {
        setStubborn(false);
        onClosed();
      }
    },
  });
  return { stubborn, reset: () => setStubborn(false), close: () => mutation.mutate(stubborn), pending: mutation.isPending };
}

/** Před operací: aplikace běží – zavřít jedním kliknutím, pokračovat, nebo zrušit. */
export function AppRunningDialog() {
  const { t } = useTranslation();
  const { before, answer } = useAppInUse();
  const closing = useCloseProcesses(before?.processes, () => answer(true));

  const finish = (proceed: boolean) => {
    closing.reset();
    answer(proceed);
  };
  const name = before?.appName ?? "";
  const kind = before ? t(`appInUse.kind.${before.kind}`) : "";

  return (
    <Modal
      open={!!before}
      onClose={() => finish(false)}
      title={t("appInUse.beforeTitle", { name })}
      // Tři tlačítka v patičce – širší okno, ať se vejdou do jednoho řádku
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => finish(false)} disabled={closing.pending}>
            {t("package.cancel")}
          </Button>
          <Button variant="secondary" onClick={() => finish(true)} disabled={closing.pending}>
            {t("appInUse.continueAnyway")}
          </Button>
          <Button variant={closing.stubborn ? "danger" : "primary"} disabled={closing.pending} onClick={closing.close}>
            {closing.pending ? <Spinner className="size-4 text-accent-fg" /> : <XCircle className="size-4" />}
            {t(closing.stubborn ? "appInUse.forceContinue" : "appInUse.closeAndContinue")}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t("appInUse.beforeText", { name, kind })}</p>
      {before && <ProcessList processes={before.processes} />}
      {closing.stubborn && <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{t("appInUse.stubborn")}</p>}
      <p className="mt-3 text-xs text-muted">{t("appInUse.hint")}</p>
    </Modal>
  );
}

/**
 * Po neúspěchu: aplikace běží a instalátor ji nemohl přepsat – zavřít a zkusit znovu.
 * `otherApps`: soubory aplikace drží jiné programy (virtuální kamera OBS v prohlížeči
 * nebo ve videohovoru) – nabídnout zavřít ty, aplikace sama neběží.
 */
export function AppInUseDialog() {
  const { t } = useTranslation();
  const { request, otherApps, close } = useAppInUse();
  const enqueue = useJobs((s) => s.enqueue);

  const { data: processes, isLoading } = useQuery({
    queryKey: ["app-processes", request?.packageId, request?.appName, otherApps],
    queryFn: () => (otherApps ? findFileUsers : findAppProcesses)(request!.packageId, request!.appName),
    enabled: !!request,
    staleTime: 0,
  });
  /** Texty dialogu: aplikace běží, nebo její soubory drží jiné programy. */
  const text = (key: "title" | "text" | "closeAndRetry" | "notFound" | "hint") =>
    t(otherApps ? `appInUse.other.${key}` : `appInUse.${key}`, { name: request?.appName ?? "" });

  const retry = () => {
    if (request) enqueue(request);
    closing.reset();
    close();
  };
  const closing = useCloseProcesses(processes, retry);

  const dismiss = () => {
    closing.reset();
    close();
  };

  return (
    <Modal
      open={!!request}
      onClose={dismiss}
      title={text("title")}
      footer={
        <>
          <Button variant="secondary" onClick={dismiss} disabled={closing.pending}>
            {t("package.cancel")}
          </Button>
          {processes && processes.length > 0 ? (
            <Button variant={closing.stubborn ? "danger" : "primary"} disabled={closing.pending} onClick={closing.close}>
              {closing.pending ? <Spinner className="size-4 text-accent-fg" /> : <XCircle className="size-4" />}
              {closing.stubborn ? t("appInUse.forceClose") : text("closeAndRetry")}
            </Button>
          ) : (
            <Button onClick={retry} disabled={isLoading}>
              <RotateCcw className="size-4" />
              {t("appInUse.retry")}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm">{text("text")}</p>
      {isLoading ? (
        <Spinner className="mt-4 size-5" />
      ) : processes && processes.length > 0 ? (
        <ProcessList processes={processes} />
      ) : (
        <p className="mt-3 text-sm text-muted">{text("notFound")}</p>
      )}
      {closing.stubborn && <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{t("appInUse.stubborn")}</p>}
      <p className="mt-3 text-xs text-muted">{text("hint")}</p>
    </Modal>
  );
}
