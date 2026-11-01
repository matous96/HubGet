/**
 * Nabídka možností instalace (po vzoru UniGetUI):
 *  - InstallMenuItems – položky nabídky (Nainstalovat, Možnosti instalace,
 *    Ruční instalace, Jako správce, Interaktivně, Bez kontrolního součtu,
 *    Stáhnout instalátor, Podrobnosti),
 *  - InstallSplitMenu – šipka vedle tlačítka Instalovat v detailu aplikace,
 *  - PackageContextMenuHost – kontextová nabídka (pravé tlačítko) na kartách a řádcích,
 *  - usePackageMenuHandlers – pravé tlačítko a klávesové zkratky pro kartu.
 */
import {
  AlarmClock,
  ArrowDownToLine,
  ChevronDown,
  Download,
  ExternalLink,
  Hand,
  Hash,
  Info,
  Lock,
  LockOpen,
  RefreshCw,
  ScanSearch,
  ShieldUser,
  SkipForward,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useDismiss } from "@/hooks/useDismiss";
import { useInstallActions } from "@/hooks/useInstallActions";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/tauri";
import { isWebOnly, openDownloadPage } from "@/lib/webOnly";
import { useInstallUi } from "@/store/installUi";
import { useSettings } from "@/store/settings";
import type { CatalogEntry, SourceId } from "@/types";
import { unpinLabel, useUpdatePin } from "./UpdatePin";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

interface MenuItemsProps {
  entry: CatalogEntry;
  /** Výslovně zvolený zdroj (detail aplikace). */
  source?: SourceId;
  /** Zobrazit „Podrobnosti“ (ne v detailu aplikace). */
  showDetails?: boolean;
  onClose: () => void;
}

/** Položky nabídky instalace pro jednu aplikaci. */
export function InstallMenuItems({ entry, source, showDetails = true, onClose }: MenuItemsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openOptions, openManual } = useInstallUi();
  const actions = useInstallActions(entry, source);
  const { status, job, support } = actions;
  const busy = !!job || !actions.source;
  const notInstalled = status === "available";
  const pin = useUpdatePin(actions.installed, entry.name);
  const trackAll = useSettings((s) => s.trackInstalls);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  // Aplikace jen z webu výrobce: HubGet ji nespravuje – jen odkaz ke stažení a detail
  if (isWebOnly(entry)) {
    return (
      <>
        {notInstalled && (
          <Item icon={ExternalLink} label={t("package.webDownload")} onClick={run(() => openDownloadPage(entry))} />
        )}
        {notInstalled && showDetails && <Separator />}
        {showDetails && (
          <Item icon={Info} label={t("installMenu.details")} shortcut="Enter" onClick={run(() => navigate(detailUrl(entry.id)))} />
        )}
      </>
    );
  }

  return (
    <>
      {notInstalled ? (
        <Item icon={Download} label={t("installMenu.install")} shortcut="Ctrl+Enter" disabled={busy} onClick={run(() => actions.install())} />
      ) : status === "updatable" ? (
        <Item icon={RefreshCw} label={t("package.update")} disabled={busy} onClick={run(actions.update)} />
      ) : null}
      {/* Přeskočit nabízenou verzi / odložit / ignorovat aktualizace / zrušit zámek */}
      {pin.canPin && pin.offered && (
        <>
          <Item icon={SkipForward} label={t("pins.skip", { version: pin.offered })} onClick={run(pin.skip)} />
          <Item icon={AlarmClock} label={t("pins.snoozeWeek")} onClick={run(() => pin.snooze(7))} />
        </>
      )}
      {pin.canPin && !pin.pin && <Item icon={Lock} label={t("pins.lock")} onClick={run(pin.lock)} />}
      {pin.canPin && pin.pin && <Item icon={LockOpen} label={t(unpinLabel(pin.pin))} onClick={run(pin.unpin)} />}
      {notInstalled && (
        <>
          <Separator />
          <Item
            icon={SlidersHorizontal}
            label={t("installMenu.options")}
            shortcut="Alt+Enter"
            disabled={busy}
            onClick={run(() => openOptions(entry, actions.source?.source))}
          />
        </>
      )}
      {!notInstalled && <Separator />}
      <Item icon={SquareTerminal} label={t("installMenu.manual")} disabled={!actions.source} onClick={run(() => openManual(entry, actions.source?.source))} />

      <Separator />
      {notInstalled && (
        <>
          <Item icon={ShieldUser} label={t("installMenu.asAdmin")} disabled={busy} onClick={run(() => actions.install({ asAdmin: true }))} />
          {/* Sledování instalace snímkem systému – v Nastavení vypnuté, tak aspoň pro tuto aplikaci */}
          {isTauri() && !trackAll && (
            <Item icon={ScanSearch} label={t("installMenu.tracked")} disabled={busy} onClick={run(() => actions.install(undefined, { track: true }))} />
          )}
          <Item
            icon={Hand}
            label={t("installMenu.interactive")}
            disabled={busy || !support?.interactive}
            hint={!support?.interactive ? t("installMenu.unsupported") : undefined}
            onClick={run(() => actions.install({ interactive: true }))}
          />
          <Item
            icon={Hash}
            label={t("installMenu.skipHash")}
            disabled={busy || !support?.skipHash}
            hint={!support?.skipHash ? t("installMenu.unsupported") : undefined}
            onClick={run(() => actions.install({ skipHash: true }))}
          />
        </>
      )}
      <Item
        icon={ArrowDownToLine}
        label={t("installMenu.download")}
        disabled={busy || !support?.download}
        hint={!support?.download ? t("installMenu.unsupported") : undefined}
        onClick={run(actions.download)}
      />

      {showDetails && (
        <>
          <Separator />
          <Item icon={Info} label={t("installMenu.details")} shortcut="Enter" onClick={run(() => navigate(detailUrl(entry.id)))} />
        </>
      )}
    </>
  );
}

function Item({
  icon: Icon,
  label,
  shortcut,
  hint,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={hint}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon className="size-[18px] shrink-0 text-muted" />
      <span className="flex-1">{label}</span>
      {shortcut && <kbd className="font-sans text-xs text-muted">{shortcut}</kbd>}
    </button>
  );
}

const Separator = () => <div role="separator" className="mx-2 my-1 h-px bg-line" />;

/** Šipka vedle tlačítka Instalovat (detail aplikace) s nabídkou možností instalace. */
export function InstallSplitMenu({ entry, source }: { entry: CatalogEntry; source?: SourceId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={t("installMenu.more")}
        title={t("installMenu.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors",
          open ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg hover:bg-surface-3",
        )}
      >
        <ChevronDown className={cn("size-5 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 z-30 mt-2 w-72 origin-top-left rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover"
          >
            <InstallMenuItems entry={entry} source={source} showDetails={false} onClose={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Kontextová nabídka aplikace – jedna pro celou aplikaci, otevírá ji pravé tlačítko na kartě. */
export function PackageContextMenuHost() {
  const { menu, closeMenu } = useInstallUi();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useDismiss(ref, !!menu, closeMenu);

  // Nabídku udržet v okně (u pravého / spodního okraje se otevře na druhou stranu)
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: menu.y + height > window.innerHeight - 8 ? Math.max(8, menu.y - height) : menu.y,
    });
  }, [menu]);

  // Posun stránky nabídku zavře (jinak by zůstala viset mimo kartu)
  useEffect(() => {
    if (!menu) return;
    window.addEventListener("wheel", closeMenu, { passive: true });
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("wheel", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menu, closeMenu]);

  if (!menu) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 w-72 rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover"
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="truncate px-3 pt-1.5 pb-1 text-xs font-semibold text-muted">{menu.entry.name}</p>
      <InstallMenuItems entry={menu.entry} onClose={closeMenu} />
    </div>,
    document.body,
  );
}

/**
 * Pravé tlačítko a klávesové zkratky pro kartu / řádek aplikace:
 * Ctrl+Enter = instalovat, Alt+Enter = možnosti instalace,
 * klávesa Menu / Shift+F10 = kontextová nabídka (Enter otevře detail sám).
 */
export function usePackageMenuHandlers(entry: CatalogEntry) {
  const { openMenu, openOptions } = useInstallUi();
  const actions = useInstallActions(entry);

  return {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      openMenu(entry, e.clientX, e.clientY);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const canInstall = actions.status === "available" && !actions.job && !!actions.source;
      if (e.key === "Enter" && e.ctrlKey && canInstall) {
        e.preventDefault();
        actions.install();
      } else if (e.key === "Enter" && e.altKey && canInstall) {
        e.preventDefault();
        openOptions(entry, actions.source?.source);
      } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        openMenu(entry, rect.left + 24, rect.top + 24);
      }
    },
  };
}
