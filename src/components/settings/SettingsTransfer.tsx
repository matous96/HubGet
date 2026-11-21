/**
 * Přenos nastavení aplikací na nový počítač (Nastavení → Záloha a katalog, backend
 * settings_transfer.rs): nastavení vybraných aplikací z AppData do souboru
 * .hubget-settings zašifrovaného heslem, na novém počítači zpět. Heslo se nikam
 * neukládá – bez něj soubor nejde otevřít (v AppData bývají i přihlašovací tokeny).
 */
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, KeyRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/States";
import { useInstalledItems } from "@/hooks/useInstalledItems";
import { isGameStore } from "@/services/managers";
import { formatSizeText } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import { Row } from "./SettingsUi";

interface ScannedApp {
  appId: string;
  bytes: number;
  tooLarge: boolean;
}

/** Nejmenší délka hesla (backend ji ověří i sám). */
const MIN_PASSWORD = 8;
/** Předem vybrané jen menší nastavení – velká bývají profily a databáze. */
const PRESELECT_LIMIT = 50 * 1024 * 1024;

export function SettingsTransferRow() {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<"export" | "import" | null>(null);
  return (
    <Row label={t("transfer.title")} hint={t("transfer.hint")}>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDialog("export")}>
          <ArrowRightLeft className="size-3.5" />
          {t("transfer.export")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDialog("import")}>
          {t("transfer.import")}
        </Button>
      </div>
      <ExportDialog open={dialog === "export"} onClose={() => setDialog(null)} />
      <ImportDialog open={dialog === "import"} onClose={() => setDialog(null)} />
    </Row>
  );
}

function PasswordFields({ password, setPassword, confirm, setConfirm }: { password: string; setPassword: (v: string) => void; confirm?: string; setConfirm?: (v: string) => void }) {
  const { t } = useTranslation();
  const input = "h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent/50";
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t("transfer.password")}
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </label>
      {setConfirm && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t("transfer.passwordAgain")}
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
        </label>
      )}
    </div>
  );
}

function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const { items } = useInstalledItems();
  const apps = useMemo(
    () => items.filter((i) => !isGameStore(i.pkg.origin)).map((i) => ({ appId: i.entry.id, name: i.entry.name, packageId: i.pkg.packageId })),
    [items],
  );
  // Které aplikace mají nastavení v AppData (jen s otevřeným dialogem)
  const scan = useQuery({
    queryKey: ["settings-transfer-scan", apps.length],
    queryFn: () => invoke<ScannedApp[]>("settings_transfer_scan", { apps }),
    enabled: open && apps.length > 0,
    staleTime: 60_000,
  });
  // Bez prázdných složek (nic k přenosu) a bez příliš velkých (profily prohlížečů)
  const found = useMemo(() => (scan.data ?? []).filter((s) => !s.tooLarge && s.bytes > 0).sort((a, b) => a.bytes - b.bytes), [scan.data]);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const selected = chosen ?? new Set(found.filter((s) => s.bytes <= PRESELECT_LIMIT).map((s) => s.appId));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const nameOf = (appId: string) => apps.find((a) => a.appId === appId)?.name ?? appId;
  const total = found.filter((s) => selected.has(s.appId)).reduce((sum, s) => sum + s.bytes, 0);
  const valid = selected.size > 0 && password.length >= MIN_PASSWORD && password === confirm;

  const toggle = (appId: string) => {
    const next = new Set(selected);
    if (next.has(appId)) next.delete(appId);
    else next.add(appId);
    setChosen(next);
  };

  const close = () => {
    setPassword("");
    setConfirm("");
    setChosen(null);
    onClose();
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await invoke<{ path: string; apps: number; bytes: number } | null>("settings_transfer_export", {
        apps: apps.filter((a) => selected.has(a.appId)),
        password,
        fileName: `${t("transfer.fileName")}.hubget-settings`,
      });
      if (result) {
        toast("success", t("transfer.saved", { count: result.apps, size: formatSizeText(result.bytes, language), path: result.path }));
        close();
      }
    } catch (error) {
      toast("error", t("transfer.failed", { error: String(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("transfer.exportTitle")}
      className="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid || busy} onClick={() => void save()}>
            {busy ? <Spinner className="size-4 text-accent-fg" /> : <KeyRound className="size-4" />}
            {t("transfer.save", { size: formatSizeText(total, language) })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{t("transfer.exportText")}</p>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-line">
        {scan.isLoading ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted">
            <Spinner className="size-4" /> {t("transfer.scanning")}
          </p>
        ) : found.length === 0 ? (
          <p className="p-3 text-sm text-muted">{t("transfer.nothing")}</p>
        ) : (
          found.map((s) => (
            <label key={s.appId} className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0 hover:bg-surface-2">
              <input type="checkbox" checked={selected.has(s.appId)} onChange={() => toggle(s.appId)} className="size-4 shrink-0 accent-[var(--accent)]" />
              <span className="min-w-0 flex-1 truncate">{nameOf(s.appId)}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">{formatSizeText(s.bytes, language)}</span>
            </label>
          ))
        )}
      </div>
      <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{t("transfer.warning")}</p>
      <div className="mt-3">
        <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
        {password.length > 0 && password.length < MIN_PASSWORD && <p className="mt-1 text-xs text-danger">{t("transfer.passwordShort", { count: MIN_PASSWORD })}</p>}
        {confirm.length > 0 && password !== confirm && <p className="mt-1 text-xs text-danger">{t("transfer.passwordMismatch")}</p>}
      </div>
    </Modal>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPassword("");
    onClose();
  };

  const restore = async () => {
    setBusy(true);
    try {
      const result = await invoke<{ restored: string[] } | null>("settings_transfer_import", { password });
      if (result) {
        toast(result.restored.length ? "success" : "info", result.restored.length ? t("transfer.restored", { count: result.restored.length, names: result.restored.join(", ") }) : t("transfer.restoredNothing"));
        close();
      }
    } catch (error) {
      toast("error", t("transfer.failed", { error: String(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("transfer.importTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!password || busy} onClick={() => void restore()}>
            {busy ? <Spinner className="size-4 text-accent-fg" /> : <KeyRound className="size-4" />}
            {t("transfer.chooseFile")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{t("transfer.importText")}</p>
      <div className="mt-3">
        <PasswordFields password={password} setPassword={setPassword} />
      </div>
    </Modal>
  );
}
