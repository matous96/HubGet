import {
  CircleQuestionMark,
  Ellipsis,
  History,
  Info,
  Loader2,
  Megaphone,
  RefreshCw,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Modal } from "@/components/ui/Modal";
import { CHANGELOG } from "@/data/changelog";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/services/updates";
import { useAppUpdate } from "@/store/appUpdate";
import { useToasts } from "@/store/toasts";
import { ReleaseList } from "./ReleaseList";

/**
 * Nabídka „…“ vedle Nastavení (po vzoru UniGetUI): protokoly a historie,
 * verze, poznámky k vydání, kontrola aktualizací, nápověda a O aplikaci.
 */
export function AppMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToasts((s) => s.push);
  const [open, setOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkAppUpdate = useAppUpdate((s) => s.check);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  // Je-li nová verze, otevře se dialog s nabídkou aktualizace (UpdateDialog)
  const checkUpdates = async () => {
    setChecking(true);
    const result = await checkAppUpdate(true);
    if (result === "current") toast("success", t("menu.upToDate", { version: APP_VERSION }));
    else if (result === "error") toast("error", t("menu.updateFailed"));
    setChecking(false);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={t("menu.more")}
        title={t("menu.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex size-9 cursor-pointer items-center justify-center rounded-xl transition-colors",
          open ? "bg-accent/12 text-accent" : "text-muted hover:bg-surface/60 hover:text-fg",
        )}
      >
        <Ellipsis className="size-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, x: -6, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            // Vyjede vpravo od postranního panelu, zarovnané ke spodnímu okraji
            className="absolute bottom-0 left-full z-40 ml-3 w-80 origin-bottom-left rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover"
          >
            <MenuItem icon={SquareTerminal} label={t("menu.logs")} onClick={() => go("/logs")} />
            <MenuItem icon={History} label={t("menu.history")} onClick={() => go("/settings?section=history")} />
            <Separator />
            <MenuItem icon={Info} label={t("menu.version", { version: APP_VERSION })} disabled />
            <MenuItem
              icon={Megaphone}
              label={t("menu.releaseNotes")}
              onClick={() => {
                setOpen(false);
                setNotesOpen(true);
              }}
            />
            <MenuItem
              icon={checking ? Loader2 : RefreshCw}
              spin={checking}
              label={checking ? t("menu.checking") : t("menu.checkUpdates")}
              onClick={() => void checkUpdates()}
              disabled={checking}
            />
            <Separator />
            <MenuItem icon={CircleQuestionMark} label={t("menu.help")} onClick={() => go("/help")} />
            <MenuItem icon={Info} label={t("menu.about")} onClick={() => go("/about")} />
          </motion.div>
        )}
      </AnimatePresence>

      <ReleaseNotes open={notesOpen} onClose={() => setNotesOpen(false)} />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  spin,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
    >
      <Icon className={cn("size-[18px] shrink-0 text-muted", spin && "animate-spin")} />
      {label}
    </button>
  );
}

const Separator = () => <div role="separator" className="mx-2 my-1.5 h-px bg-line" />;

/** Okno s poznámkami k vydání (z data/changelog.ts). */
function ReleaseNotes({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t("menu.releaseNotes")} className="max-w-xl">
      <ReleaseList releases={CHANGELOG} />
    </Modal>
  );
}
