/**
 * Centrum oznámení v horní liště: zvoneček s červeným odznakem (počet
 * nepřečtených chyb) a po kliknutí panel s historií posledních událostí
 * a chyb – název aplikace, hláška a čas. Chybovou hlášku jde kliknutím
 * zkopírovat do schránky (např. do hlášení chyby nebo na fórum).
 * Data: store/notifications.ts (plní je fronta úloh a chybová oznámení).
 */
import { Bell, Check, CheckCircle2, Copy, History, Info, Trash2, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useCatalogIndex } from "@/hooks/usePackages";
import { useDismiss } from "@/hooks/useDismiss";
import { cn, formatRelative } from "@/lib/utils";
import { getSource } from "@/services/managers";
import { unreadErrorCount, useNotifications, type AppNotification, type NotificationTone } from "@/store/notifications";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";

const ICONS: Record<NotificationTone, typeof Info> = { success: CheckCircle2, error: XCircle, info: Info };
const TONES: Record<NotificationTone, string> = { success: "text-success", error: "text-danger", info: "text-muted" };

export function NotificationCenter() {
  const { t } = useTranslation();
  const items = useNotifications((s) => s.items);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const clear = useNotifications((s) => s.clear);
  const [open, setOpen] = useState(false);
  /** Záznamy, které byly při otevření panelu nové – zůstanou zvýrazněné, dokud je panel otevřený. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  const errors = unreadErrorCount(items);
  const label = errors ? t("notifications.openWithErrors", { count: errors }) : t("notifications.open");

  const toggle = () => {
    if (!open) {
      setFresh(new Set(items.filter((n) => !n.read).map((n) => n.id)));
      markAllRead();
    }
    setOpen(!open);
  };

  // Nové záznamy, které přijdou při otevřeném panelu, jsou rovnou přečtené
  useEffect(() => {
    if (open) markAllRead();
  }, [open, items, markAllRead]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "relative flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors",
          open ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
        )}
      >
        {/* Při nové chybě zvoneček krátce zazvoní */}
        <motion.span
          key={errors}
          className="flex"
          animate={errors ? { rotate: [0, -14, 12, -8, 5, 0] } : undefined}
          transition={{ duration: 0.6 }}
        >
          <Bell className="size-[18px]" />
        </motion.span>
        {errors > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-none font-bold text-white ring-2 ring-app">
            {errors > 9 ? "9+" : errors}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t("notifications.title")}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 z-40 mt-2 flex max-h-[min(70vh,560px)] w-[400px] origin-top-right flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <p className="font-semibold">{t("notifications.title")}</p>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                  {t("notifications.clear")}
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-8 py-10 text-center text-sm text-muted">
                <Bell className="size-7 opacity-40" />
                {t("notifications.empty")}
              </div>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                {items.map((n) => (
                  <NotificationRow key={n.id} notification={n} fresh={fresh.has(n.id)} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}

            <Link
              to="/settings?section=history"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <History className="size-3.5" />
              {t("notifications.allHistory")}
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Jeden záznam: ikona podle výsledku, aplikace (odkaz na detail), hláška, čas; chybu jde zkopírovat. */
function NotificationRow({ notification: n, fresh, onNavigate }: { notification: AppNotification; fresh: boolean; onNavigate: () => void }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const catalogIndex = useCatalogIndex();
  const toast = useToasts((s) => s.push);
  const [copied, setCopied] = useState(false);
  const Icon = ICONS[n.tone];
  const title = n.title ?? "HubGet";
  const time = new Date(n.createdAt);
  const exactTime = time.toLocaleString(language, { dateStyle: "medium", timeStyle: "medium" });
  const isError = n.tone === "error";

  const copy = async () => {
    // Celý záznam i s aplikací, zdrojem a časem – hodí se do hlášení chyby
    const source = n.source ? ` (${getSource(n.source).label})` : "";
    try {
      await navigator.clipboard.writeText(`${title}${source}: ${n.message} [${exactTime}]`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast("success", t("notifications.copied"));
    } catch {
      toast("error", t("common.error"));
    }
  };

  return (
    <li className={cn("flex gap-3 px-4 py-3", fresh && (isError ? "bg-danger/8" : "bg-accent/6"))}>
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", TONES[n.tone])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          {n.appId && catalogIndex.has(n.appId) ? (
            <Link to={`/package/${encodeURIComponent(n.appId)}`} onClick={onNavigate} className="truncate text-sm font-semibold hover:underline">
              {title}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold">{title}</p>
          )}
          <time dateTime={n.createdAt} title={exactTime} className="shrink-0 text-[11px] text-muted">
            {formatRelative(n.createdAt, language)}
          </time>
        </div>
        {isError ? (
          // Kliknutím na chybovou hlášku se zkopíruje
          <button
            type="button"
            onClick={copy}
            title={t("notifications.copy")}
            className="group mt-0.5 flex w-full cursor-pointer items-start gap-2 rounded-md text-left text-[13px] leading-snug text-fg/85 hover:text-fg"
          >
            {/* Nejvýš 6 řádků – celou hlášku zkopíruje klik, ukáže nápověda */}
            <span className="line-clamp-6 min-w-0 flex-1 break-words select-text" title={n.message}>
              {n.message}
            </span>
            <span className={cn("mt-0.5 shrink-0 transition-opacity", copied ? "text-success" : "text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </span>
          </button>
        ) : (
          <p className="mt-0.5 line-clamp-6 text-[13px] leading-snug break-words text-muted" title={n.message}>
            {n.message}
          </p>
        )}
      </div>
    </li>
  );
}
