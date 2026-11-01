import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getOrigin, getSource } from "@/services/managers";
import { cn } from "@/lib/utils";
import type { InstallOrigin, SourceId } from "@/types";

/** Popisek původu instalace („WinGet: msstore“, „Steam“, „Lokální“…). */
export function useOriginLabel() {
  const { t } = useTranslation();
  return (origin: InstallOrigin) => getOrigin(origin).label || t(`origins.${origin}`);
}

/**
 * Odznak přesného původu instalace (u nainstalovaných aplikací).
 * `compact` = krátký popisek pro úzké karty („winget“ místo „WinGet: winget“),
 * plný je v nápovědě.
 */
export function OriginBadge({ origin, compact, className }: { origin: InstallOrigin; compact?: boolean; className?: string }) {
  const label = useOriginLabel();
  const full = label(origin);
  return (
    <span
      // Smí se zúžit (dlouhý název zdroje se zkrátí), tečka zůstane
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted",
        className,
      )}
      title={full}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", getOrigin(origin).dot)} />
      <span className="truncate">{compact ? full.replace(/^WinGet:\s*/, "") : full}</span>
    </span>
  );
}

/** Malý odznak zdroje (barevná tečka + název správce). */
export function SourceBadge({ source, className }: { source: SourceId; className?: string }) {
  const meta = getSource(source);
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted",
        className,
      )}
      title={meta.label}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

/** Odznak aplikace jen z webu výrobce (místo správce balíčků, ze kterého by se instalovala); vysvětlení v bublině. */
export function WebBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted",
        className,
      )}
      title={t("package.webSourceHint")}
    >
      <Globe className="size-3 shrink-0" />
      <span className="truncate">{t("package.webBadge")}</span>
    </span>
  );
}

/** Řada teček – ve kterých zdrojích je aplikace dostupná (kompaktní, pro karty). */
export function SourceDots({ sources }: { sources: SourceId[] }) {
  return (
    <span className="inline-flex items-center gap-1" title={sources.map((s) => getSource(s).label).join(" · ")}>
      {sources.map((s) => (
        <span key={s} className={cn("size-1.5 rounded-full", getSource(s).dot)} />
      ))}
    </span>
  );
}
