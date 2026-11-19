import { ExternalLink, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isSecurityNote } from "@/lib/securityUpdates";
import { formatRelative } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import type { CatalogEntry } from "@/types";

/**
 * Co je nového: krátký přehled novinek v aktuální verzi (ReleaseNotes
 * z manifestu wingetu) s odkazem na celou historii verzí.
 */
export function WhatsNew({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const [expanded, setExpanded] = useState(false);
  if (!entry.releaseNotes) return null;
  const long = entry.releaseNotes.length > 220;

  return (
    <section className="border-b border-line py-6">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
          <Sparkles className="size-5 text-amber-400" />
          {t("whatsNew.title")}
        </h2>
        <span className="text-sm text-muted tabular-nums">
          {t("whatsNew.version", { version: entry.latestVersion })}
          {entry.releaseDate && ` · ${formatRelative(entry.releaseDate, language)}`}
        </span>
        {/* Verze opravuje bezpečnostní chybu (CVE, „security fix“…) */}
        {isSecurityNote(entry.releaseNotes) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-xs font-semibold text-danger">
            <ShieldAlert className="size-3.5" />
            {t("security.badge")}
          </span>
        )}
        {entry.releaseNotesUrl && (
          <a
            href={entry.releaseNotesUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            {t("whatsNew.history")}
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      <p className={`max-w-3xl text-[15px] leading-relaxed whitespace-pre-line ${!expanded && long ? "line-clamp-3" : ""}`}>
        {entry.releaseNotes}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 cursor-pointer text-sm font-semibold text-accent hover:underline"
        >
          {expanded ? t("whatsNew.less") : t("whatsNew.more")}
        </button>
      )}
    </section>
  );
}
