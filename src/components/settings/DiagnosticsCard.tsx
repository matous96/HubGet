import { ClipboardCopy, Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/States";
import { useSaveFile } from "@/hooks/useSaveFile";
import { buildDiagnostics } from "@/lib/diagnostics";
import { useToasts } from "@/store/toasts";
import { Card, Row } from "./SettingsUi";

/**
 * Diagnostika pro podporu (Nastavení → Kontaktovat HubGet, lib/diagnostics.ts): textový
 * soubor s verzemi, stavem správců, nastavením, nedávnými chybami a protokolem – bez
 * osobních údajů. Uložit, nebo zkopírovat a vložit do hlášení na GitHubu či do zprávy.
 */
export function DiagnosticsCard() {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const saveFile = useSaveFile();
  const [busy, setBusy] = useState<"save" | "copy" | null>(null);

  const run = async (kind: "save" | "copy") => {
    setBusy(kind);
    try {
      const text = await buildDiagnostics();
      if (kind === "save") {
        const stamp = new Date().toISOString().slice(0, 10);
        await saveFile(`hubget-diagnostika-${stamp}.txt`, text, "text/plain");
      } else {
        await navigator.clipboard.writeText(text);
        toast("success", t("diagnostics.copied"));
      }
    } catch {
      toast("error", t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={t("diagnostics.title")}>
      <Row label={t("diagnostics.label")} hint={t("diagnostics.hint")}>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void run("save")}>
            {busy === "save" ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
            {t("diagnostics.save")}
          </Button>
          <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void run("copy")}>
            {busy === "copy" ? <Spinner className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
            {t("diagnostics.copy")}
          </Button>
        </div>
      </Row>
    </Card>
  );
}
