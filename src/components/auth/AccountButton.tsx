import { CloudOff, LogIn, LogOut, RefreshCw, Settings } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useDismiss } from "@/hooks/useDismiss";
import { cn, formatRelative } from "@/lib/utils";
import { auth } from "@/services/auth";
import { useAuth } from "@/store/auth";
import { useOrgPolicy } from "@/store/orgPolicy";
import { useSync } from "@/store/sync";
import { Avatar } from "./Avatar";

const PROVIDER_LABEL = { github: "GitHub", microsoft: "Microsoft", google: "Google" } as const;

/**
 * Účet v horní liště: nepřihlášenému tlačítko „Přihlásit se“,
 * přihlášenému avatar s nabídkou (profil, nastavení, odhlášení).
 */
export function AccountButton() {
  const { t, i18n } = useTranslation();
  const { user, openLogin, signOut } = useAuth();
  const signInDisabled = useOrgPolicy((p) => p.disableSignIn);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  // Stav synchronizace (načtení modulu ji zároveň spouští – store/sync.ts)
  const { enabled: syncEnabled, status, lastSyncedAt } = useSync();
  const SyncIcon = syncEnabled ? RefreshCw : CloudOff;
  const syncText = !syncEnabled
    ? t("sync.off")
    : status === "syncing"
      ? t("sync.syncing")
      : status === "error"
        ? t("sync.failedShort")
        : lastSyncedAt
          ? t("sync.lastSynced", { when: formatRelative(lastSyncedAt, i18n.language) })
          : t("sync.never");

  // Firemní zásady: bez přihlášení a synchronizace
  if (signInDisabled) return null;
  if (!user) {
    return (
      <button
        type="button"
        onClick={() => openLogin()}
        title={t("auth.signIn")}
        className="ml-1 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold text-accent-fg shadow-sm shadow-accent/30 transition hover:brightness-110"
      >
        <LogIn className="size-3.5" />
        <span className="hidden lg:inline">{t("auth.signIn")}</span>
      </button>
    );
  }

  return (
    <div ref={root} className="relative ml-1">
      <button
        type="button"
        aria-label={t("auth.account")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer rounded-full ring-2 ring-transparent transition hover:ring-accent/40 aria-expanded:ring-accent/60"
      >
        <Avatar user={user} size={32} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 z-40 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
          >
            <div className="flex items-center gap-3 border-b border-line p-4">
              <Avatar user={user} size={44} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {t("auth.via", { provider: PROVIDER_LABEL[user.provider] })}
                  {auth.isSample && <span className="ml-1.5 text-amber-600 dark:text-amber-400">· {t("auth.sampleShort")}</span>}
                </p>
              </div>
            </div>
            <div className="p-1.5">
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface-2"
              >
                <SyncIcon className={cn("size-4 text-muted", status === "syncing" && "animate-spin")} />
                <span className="min-w-0">
                  <span className="block">{t("sync.title")}</span>
                  <span className={cn("block truncate text-xs", status === "error" ? "text-danger" : "text-muted")}>{syncText}</span>
                </span>
              </Link>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface-2"
              >
                <Settings className="size-4 text-muted" />
                {t("nav.settings")}
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
              >
                <LogOut className="size-4" />
                {t("auth.signOut")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
