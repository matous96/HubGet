import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { getSource } from "@/services/managers/sources";
import { useListFailures } from "@/store/listFailures";

/**
 * Upozornění nad seznamem nainstalovaných, když některý správce nevrátil svůj
 * seznam (nefunguje, vypršel čas, nečekaný výstup) – jeho aplikace v seznamu
 * chybí, i když nainstalované jsou. Zmizí, jakmile načtení projde.
 */
export function ListFailurePanel({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useTranslation();
  const sources = useListFailures((s) => s.sources);
  if (!sources.length) return null;
  const names = sources.map((id) => getSource(id).label).join(", ");

  return (
    <section
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3"
    >
      <TriangleAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-semibold">{t("installed.incompleteTitle")}</p>
        <p className="text-xs text-muted">{t("installed.incompleteText", { names })}</p>
      </div>
      <Button variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>
        {t("installed.incompleteRetry")}
      </Button>
    </section>
  );
}
