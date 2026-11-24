/**
 * Vyzkoušet na týden (store/trials):
 *  - TrialWatcher – v Layoutu: po TRIAL_DAYS dnech zjistí podle záznamů Windows (app_last_used),
 *    jestli se aplikace od instalace spustila; spuštěná zůstane, nespuštěná dostane nabídku,
 *  - TrialPrompt – na Domů: „Vyzkoušeli jste…?“ s Ponechat / Odinstalovat.
 */
import { invoke } from "@tauri-apps/api/core";
import { FlaskConical } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PackageIcon } from "@/components/package/PackageIcon";
import { Button } from "@/components/ui/Button";
import { useCatalogIndex, useInstalledIndex } from "@/hooks/usePackages";
import { isTauri } from "@/lib/tauri";
import { notifyEvent } from "@/services/notify";
import { useJobs } from "@/store/jobs";
import { writeLog } from "@/store/logs";
import { dueTrials, TRIAL_DAYS, usedDuringTrial, useTrials } from "@/store/trials";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

/** Jak dlouho po začátku zkoušky čekat na instalaci, než se zkouška bez nainstalované aplikace zahodí. */
const INSTALL_GRACE_MS = 6 * 60 * 60_000;

interface AppUsage {
  lastUsed: number | null;
  inUse: boolean;
}

/** Vyhodnocení zkoušek: hned po načtení nainstalovaných a pak jednou za hodinu. */
export function TrialWatcher() {
  const { t } = useTranslation();
  const installed = useInstalledIndex();

  useEffect(() => {
    if (!installed.size || !isTauri()) return;
    const check = async () => {
      const { items, remove, ask } = useTrials.getState();
      // Mezitím odinstalovaná aplikace (i s otevřenou nabídkou) – zkouška končí; čerstvá zkouška
      // ještě instaluje (nebo čeká ve frontě), tu nechat
      const { jobs } = useJobs.getState();
      for (const [appId, trial] of Object.entries(items)) if (!installed.has(appId) && !jobs[appId] && Date.now() - trial.at > INSTALL_GRACE_MS) remove(appId);
      const due = dueTrials(useTrials.getState().items);
      if (!due.length) return;
      const apps = due.map(([appId]) => {
        const pkg = installed.get(appId)!;
        return { packageId: pkg.packageId, name: pkg.name };
      });
      const usage = await invoke<AppUsage[]>("app_last_used", { apps }).catch(() => null);
      if (!usage) return;
      const unused: string[] = [];
      due.forEach(([appId, trial], i) => {
        if (usage[i]?.inUse || usedDuringTrial(trial, usage[i]?.lastUsed ?? null)) {
          remove(appId);
          writeLog(trial.source, "info", t("trial.kept", { name: trial.name }));
        } else {
          ask(appId);
          unused.push(trial.name);
        }
      });
      if (!unused.length) return;
      const message = t("trial.notify", { count: unused.length, names: unused.join(", ") });
      notifyEvent({ type: "info", tone: "info", title: null, message, toast: message, record: true });
    };
    void check();
    const timer = setInterval(() => void check(), 60 * 60_000);
    return () => clearInterval(timer);
  }, [installed, t]);

  return null;
}

/** Nabídka Ponechat / Odinstalovat u aplikací, které se za zkoušku nespustily. */
export function TrialPrompt() {
  const { t } = useTranslation();
  const items = useTrials((s) => s.items);
  const remove = useTrials((s) => s.remove);
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const asked = Object.entries(items).filter(([appId, trial]) => trial.asked && installed.has(appId));
  if (!asked.length) return null;

  const uninstall = (appId: string, name: string) => {
    const pkg = installed.get(appId);
    if (pkg) useJobs.getState().enqueue({ appId, appName: name, source: pkg.source, packageId: pkg.packageId, kind: "uninstall" });
    remove(appId);
  };

  return (
    <div className="mb-8 space-y-3">
      {asked.map(([appId, trial]) => {
        const entry = catalog.get(appId);
        return (
          <section
            key={appId}
            aria-label={t("trial.title", { name: trial.name })}
            className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-3xl border border-line bg-surface px-5 py-4 shadow-card"
          >
            <Link to={detailUrl(appId)} className="shrink-0">
              <PackageIcon id={appId} name={trial.name} iconUrl={entry?.iconUrl ?? null} size={56} />
            </Link>
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 font-semibold">
                <FlaskConical className="size-4 text-accent" />
                {t("trial.title", { name: trial.name })}
              </h2>
              <p className="text-sm text-muted">{t("trial.text", { count: TRIAL_DAYS })}</p>
            </div>
            <Button variant="secondary" onClick={() => remove(appId)}>
              {t("trial.keep")}
            </Button>
            <Button variant="danger" onClick={() => uninstall(appId, trial.name)}>
              {t("trial.uninstall")}
            </Button>
          </section>
        );
      })}
    </div>
  );
}
