import { ClipboardCopy, Download, Eraser, FlaskConical, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { SourceFilter, type SourceFilterValue } from "@/components/package/SourceFilter";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/States";
import { useSaveFile } from "@/hooks/useSaveFile";
import { cn } from "@/lib/utils";
import { getSource, isTauri } from "@/services/managers";
import { logsToText, useLogs, type LogLevel } from "@/store/logs";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";

/** Barva řádku podle úrovně. */
const LEVEL_CLASS: Record<LogLevel, string> = {
  command: "text-sky-300",
  output: "text-zinc-500",
  info: "text-zinc-300",
  success: "text-emerald-400",
  warning: "text-amber-300",
  error: "text-rose-400",
};

/**
 * Protokoly správců balíčků: příkazy, které HubGet spouští, a jejich výsledek.
 * Zobrazení připomíná konzoli; nové řádky se posouvají dolů.
 */
export function LogsPage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const saveFile = useSaveFile();
  const { entries, clear } = useLogs();
  const [source, setSource] = useState<SourceFilterValue>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);

  const shown = entries.filter(
    (e) => (source === "all" || e.source === source) && (!errorsOnly || e.level === "error" || e.level === "warning"),
  );

  // Držet konzoli dole, pokud uživatel neodscrolloval nahoru
  useEffect(() => {
    const el = consoleRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logsToText(shown, language));
      toast("success", t("logs.copied"));
    } catch {
      toast("error", t("common.error"));
    }
  };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

  return (
    <>
      <PageHeader
        title={t("logs.title")}
        subtitle={t("logs.subtitle")}
        actions={
          <Link
            to="/settings?section=history"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold transition-colors hover:bg-surface-2"
          >
            <History className="size-4" />
            {t("logs.openHistory")}
          </Link>
        }
      />

      {/* Ve webové verzi jsou správci jen simulovaní – protokol tomu odpovídá */}
      {!isTauri() && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          <FlaskConical className="size-4 shrink-0" />
          {t("logs.mockNote")}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SourceFilter value={source} onChange={setSource} />
        <label className="flex cursor-pointer items-center gap-2 px-2 text-sm text-muted select-none">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          {t("logs.errorsOnly")}
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={!shown.length} onClick={() => void copy()}>
            <ClipboardCopy className="size-4" />
            {t("logs.copy")}
          </Button>
          <Button
            variant="secondary"
            disabled={!shown.length}
            onClick={() => void saveFile(`unibox-${stamp}.log`, logsToText(shown, language))}
          >
            <Download className="size-4" />
            {t("logs.save")}
          </Button>
          <Button variant="secondary" disabled={!entries.length} onClick={clear}>
            <Eraser className="size-4" />
            {t("logs.clear")}
          </Button>
        </div>
      </div>

      {/* Konzole – vždy tmavá, jako terminál */}
      <div
        ref={consoleRef}
        role="log"
        aria-live="polite"
        className="h-[calc(100vh-20rem)] min-h-80 overflow-y-auto rounded-2xl border border-line bg-[#0d1117] p-4 font-mono text-[12.5px] leading-6"
      >
        {shown.length === 0 ? (
          <p className="text-zinc-500">{t("logs.empty")}</p>
        ) : (
          shown.map((e) => (
            <div key={e.id} className="flex gap-3 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-zinc-500 tabular-nums">{new Date(e.time).toLocaleTimeString(language)}</span>
              <span className="flex w-36 shrink-0 items-center gap-1.5 whitespace-nowrap text-zinc-400">
                <span className={cn("size-1.5 shrink-0 rounded-full", getSource(e.source).dot)} />
                {getSource(e.source).label}
              </span>
              <span className={LEVEL_CLASS[e.level]}>
                {e.level === "command" && <span className="text-zinc-500 select-none">&gt; </span>}
                {e.text}
              </span>
            </div>
          ))
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{t("logs.sessionOnly")}</p>
    </>
  );
}
