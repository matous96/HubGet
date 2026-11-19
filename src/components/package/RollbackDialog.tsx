/**
 * Potvrzení vrácení aktualizace (store/rollback.ts): nainstalovaná verze se
 * odinstaluje a nainstaluje se verze před aktualizací; vadnou verzi pak
 * automatické aktualizace přeskočí (připnutí „skip“), dokud nevyjde novější.
 */
import { Undo2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/app/queryClient";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/States";
import { isTauri } from "@/lib/tauri";
import { compareVersions } from "@/lib/version";
import { managers } from "@/services/managers";
import { useRollback } from "@/hooks/useRollback";
import { useJobs } from "@/store/jobs";
import { useRollbackUi } from "@/store/rollback";
import type { CatalogEntry, InstalledPackage } from "@/types";

/** Tlačítko v detailu aplikace – jen když se poslední aktualizace dá vrátit (useRollback). */
export function RollbackButton({ entry, installed }: { entry: CatalogEntry; installed: InstalledPackage | undefined }) {
  const { t } = useTranslation();
  const rollback = useRollback(entry.id, installed);
  const open = useRollbackUi((s) => s.open);
  if (!rollback || !installed) return null;
  return (
    <Button
      variant="secondary"
      size="lg"
      title={t("rollback.hint", { current: rollback.currentVersion })}
      onClick={() =>
        open({ entry, source: installed.source, packageId: installed.packageId, toVersion: rollback.toVersion, currentVersion: rollback.currentVersion })
      }
    >
      <Undo2 className="size-4" />
      {t("rollback.menu", { version: rollback.toVersion })}
    </Button>
  );
}

export function RollbackDialog() {
  const { t } = useTranslation();
  const { request, close } = useRollbackUi();
  const enqueue = useJobs((s) => s.enqueue);
  // Je předchozí verze u správce ještě ke stažení? Jinak by se aplikace odinstalovala zbytečně
  const { data: versions, isLoading } = useQuery({
    queryKey: queryKeys.versions(request?.source ?? "winget", request?.packageId ?? ""),
    queryFn: () => managers[request!.source].getVersions(request!.packageId),
    enabled: !!request,
    staleTime: 10 * 60_000,
  });
  const unavailable = !!request && !!versions && !versions.some((v) => compareVersions(v, request.toVersion) === 0);
  // Záloha nastavení z doby před aktualizací – obnoví se spolu s verzí (settings_backup.rs)
  const { data: backupVersion } = useQuery({
    queryKey: ["settings-backup", request?.entry.id],
    queryFn: () => invoke<string | null>("settings_backup_version", { appId: request!.entry.id }),
    enabled: !!request && isTauri(),
    staleTime: 0,
  });
  const restoresSettings = !!request && backupVersion === request.toVersion;

  const confirm = () => {
    if (!request || unavailable) return;
    const { entry, source, packageId, toVersion, currentVersion } = request;
    // Vadnou verzi přeskočí automatické aktualizace až po úspěšném vrácení (store/jobs.ts)
    enqueue({
      appId: entry.id,
      appName: entry.name,
      source,
      packageId,
      kind: "install",
      version: toVersion,
      replaceInstalled: true,
      skipVersion: currentVersion,
    });
    close();
  };

  return (
    <Modal
      open={!!request}
      onClose={close}
      title={t("rollback.title", { name: request?.entry.name ?? "", version: request?.toVersion ?? "" })}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("package.cancel")}
          </Button>
          <Button onClick={confirm} disabled={isLoading || unavailable}>
            {isLoading ? <Spinner className="size-4 text-accent-fg" /> : <Undo2 className="size-4" />}
            {t("rollback.confirm", { version: request?.toVersion ?? "" })}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t("rollback.text", { name: request?.entry.name ?? "", current: request?.currentVersion ?? "", version: request?.toVersion ?? "" })}</p>
      <p className="mt-3 text-xs text-muted">{t("rollback.skipNote", { current: request?.currentVersion ?? "" })}</p>
      {restoresSettings && <p className="mt-2 text-xs text-muted">{t("rollback.settingsNote")}</p>}
      {unavailable && <p className="mt-3 text-sm text-danger">{t("rollback.unavailable", { version: request?.toVersion ?? "" })}</p>}
    </Modal>
  );
}
