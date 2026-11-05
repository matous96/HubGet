/**
 * Nastavení → Obecné → Synchronizace: zapnutí, výběr oblastí (oblíbené, sada
 * balíčků, předvolby, oznámení), stav poslední synchronizace a smazání dat
 * z účtu. Synchronizaci řídí store/sync.ts.
 */
import { CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/States";
import { formatRelative } from "@/lib/utils";
import { syncBackend, type SyncKindId } from "@/services/sync";
import { useAuth } from "@/store/auth";
import { useSync } from "@/store/sync";
import { useToasts } from "@/store/toasts";
import { Card, Row, SwitchRow } from "./SettingsUi";

const KINDS: SyncKindId[] = ["favorites", "bundle", "settings", "notifications", "looks"];

export function SyncCard() {
  const { t, i18n } = useTranslation();
  const user = useAuth((s) => s.user);
  const { enabled, kinds, status, lastSyncedAt, setEnabled, setKind, syncNow, clearAccount } = useSync();
  const toast = useToasts((s) => s.push);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  if (!user) {
    return (
      <Card title={t("sync.title")}>
        <Row label={t("sync.signedOut")} hint={t("sync.signedOutHint")}>
          <CloudOff className="size-5 text-muted" />
        </Row>
      </Card>
    );
  }

  const statusText =
    status === "syncing"
      ? t("sync.syncing")
      : status === "error"
        ? t("sync.failed")
        : lastSyncedAt
          ? t("sync.lastSynced", { when: formatRelative(lastSyncedAt, i18n.language) })
          : t("sync.never");

  const clear = async () => {
    setClearing(true);
    try {
      await clearAccount();
      toast("success", t("sync.cleared"));
    } catch (error) {
      console.error("[HubGet] Smazání dat z účtu se nepovedlo:", error);
      toast("error", t("sync.clearFailed"));
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };

  return (
    <Card title={t("sync.title")}>
      {syncBackend.isSample && (
        <p className="mx-4 mt-2 mb-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("sync.sample")}
        </p>
      )}
      <SwitchRow label={t("sync.enabled")} hint={t("sync.enabledHint")} checked={enabled} onChange={setEnabled} />
      <div className="pl-6">
        {KINDS.map((kind) => (
          <SwitchRow
            key={kind}
            label={t(`sync.kind.${kind}`)}
            hint={t(`sync.kind.${kind}Hint`)}
            checked={enabled && kinds[kind]}
            onChange={(on) => setKind(kind, on)}
            disabled={!enabled}
          />
        ))}
      </div>

      {enabled && (
        <Row label={t("sync.status")} hint={statusText}>
          <Button variant="secondary" size="sm" onClick={() => void syncNow()} disabled={status === "syncing"}>
            {status === "syncing" ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            {t("sync.syncNow")}
          </Button>
        </Row>
      )}

      <p className="px-4 py-2 text-xs text-muted">{t("sync.localOnly")}</p>

      <Row label={t("sync.clear")} hint={t(confirmClear ? "sync.clearConfirm" : "sync.clearHint")}>
        {confirmClear ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)} disabled={clearing}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void clear()} disabled={clearing}>
              {clearing ? <Spinner className="size-3.5" /> : <Trash2 className="size-3.5" />}
              {t("sync.clearYes")}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirmClear(true)}>
            <Trash2 className="size-3.5" />
            {t("sync.clear")}
          </Button>
        )}
      </Row>
    </Card>
  );
}
