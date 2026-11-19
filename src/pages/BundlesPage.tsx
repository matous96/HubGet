import {
  Check,
  ChevronDown,
  ClipboardCopy,
  Download,
  FilePlus2,
  FileCog,
  FileTerminal,
  FolderOpen,
  HardDriveDownload,
  Info,
  Link2,
  PackagePlus,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { JobProgress } from "@/components/package/JobProgress";
import { PackageIcon } from "@/components/package/PackageIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDismiss } from "@/hooks/useDismiss";
import { fallbackEntry, useCatalogIndex, useInstalledIndex } from "@/hooks/usePackages";
import { bundleShareLink } from "@/config";
import { buildBundleScript, bundleCommands } from "@/lib/bundleScript";
import { buildWingetConfiguration } from "@/lib/profile";
import { cancelOffline, offlineCandidates, prepareOffline, useOfflineBundle } from "@/lib/offlineBundle";
import { isTauri } from "@/lib/tauri";
import { encodeBundle } from "@/lib/bundleShare";
import { useSaveFile } from "@/hooks/useSaveFile";
import { safeFileName } from "@/lib/download";
import { cn } from "@/lib/utils";
import { getSource } from "@/services/managers";
import { PROFILE_ACCEPT, useProfileTransfer } from "@/hooks/useProfileTransfer";
import { useBundle, type BundleItem } from "@/store/bundle";
import { useJobs } from "@/store/jobs";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";

/**
 * Sady balíčků: seznam aplikací k hromadné instalaci. Lze je nainstalovat
 * jedním kliknutím, uložit do souboru .ubundle, otevřít ze souboru
 * nebo z nich vygenerovat PowerShell skript.
 */
export function BundlesPage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const { name, items, selected, rename, remove, selectAll, reset, toFile } = useBundle();
  const enqueue = useJobs((s) => s.enqueue);
  const installedIndex = useInstalledIndex();
  const fileInput = useRef<HTMLInputElement>(null);
  const saveFile = useSaveFile();
  const [confirmNew, setConfirmNew] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  // Offline balíček – průběh stahování instalátorů (lib/offlineBundle.ts)
  const offline = useOfflineBundle();

  const selectedItems = items.filter((i) => selected.includes(i.appId));
  const allSelected = items.length > 0 && selected.length === items.length;
  const fileBase = safeFileName(name, t("bundles.defaultFileName"));

  /** Zařadí instalaci (jen co ještě není nainstalované ani ve frontě). */
  const install = (list: BundleItem[]) => {
    // Fronta až v okamžiku kliknutí – stránka se nemusí překreslovat při každé změně průběhu
    const { jobs } = useJobs.getState();
    const todo = list.filter((i) => !installedIndex.has(i.appId) && !jobs[i.appId]);
    for (const i of todo) {
      enqueue({ appId: i.appId, appName: i.name, source: i.source, packageId: i.packageId, kind: "install", version: i.version, options: i.options });
    }
    toast(todo.length ? "success" : "info", todo.length ? t("bundles.queued", { count: todo.length }) : t("bundles.nothingToInstall"));
  };

  // Otevře sadu (.ubundle), profil (.json, .html) i export wingetu (.json) – rovnou v seznamu
  const { importFile } = useProfileTransfer();
  const open = (file: File) => importFile(file, { navigate: false });

  const copyCommands = async () => {
    const list = selectedItems.length ? selectedItems : items;
    try {
      await navigator.clipboard.writeText(bundleCommands(list));
      toast("success", t("bundles.commandsCopied", { count: list.length }));
    } catch {
      toast("error", t("common.error"));
    }
  };

  /** Zkopíruje odkaz, ve kterém je celá sada – přátelé ji otevřou v HubGetu. */
  const shareLink = async () => {
    try {
      await navigator.clipboard.writeText(bundleShareLink(encodeBundle(name, items)));
      toast("success", t("bundles.linkCopied", { count: items.length }));
    } catch {
      toast("error", t("common.error"));
    }
  };

  const empty = items.length === 0;

  return (
    <>
      {/* Záhlaví */}
      <header className="mb-5 flex flex-wrap items-center gap-5">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <PackagePlus className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold tracking-tight">{t("bundles.title")}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {empty ? t("bundles.emptySubtitle") : t("bundles.subtitle", { count: items.length, selected: selected.length })}
          </p>
        </div>
        {!empty && (
          <input
            value={name}
            onChange={(e) => rename(e.target.value)}
            placeholder={t("bundles.namePlaceholder")}
            aria-label={t("bundles.namePlaceholder")}
            className="h-10 w-64 rounded-xl border border-line bg-surface px-3.5 text-sm outline-none placeholder:text-muted focus:border-accent/50 focus:ring-4 focus:ring-accent/15"
          />
        )}
      </header>

      {/* Panel nástrojů */}
      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface p-1.5">
        <InstallSplitButton
          count={selectedItems.length}
          disabled={empty}
          onInstallSelected={() => install(selectedItems)}
          onInstallAll={() => install(items)}
        />
        <Divider />
        <ToolbarButton icon={FilePlus2} label={t("bundles.new")} onClick={() => (empty ? reset() : setConfirmNew(true))} />
        <ToolbarButton icon={FolderOpen} label={t("bundles.open")} onClick={() => fileInput.current?.click()} />
        <ToolbarButton
          icon={Save}
          label={t("bundles.saveAs")}
          disabled={empty}
          onClick={() => void saveFile(`${fileBase}.ubundle`, JSON.stringify(toFile(), null, 2), "application/json")}
        />
        <ToolbarButton
          icon={FileTerminal}
          label={t("bundles.script")}
          disabled={empty}
          onClick={() => void saveFile(`${fileBase}.ps1`, buildBundleScript(name, items, language, `${fileBase}.ps1`))}
        />
        <ToolbarButton
          icon={FileCog}
          label={t("bundles.configuration")}
          disabled={!items.some((i) => i.source === "winget")}
          onClick={() => void saveFile(`${fileBase}.winget`, buildWingetConfiguration(items, name || t("sharedBundle.untitled")).yaml, "text/yaml")}
        />
        {isTauri() && (
          <ToolbarButton
            icon={HardDriveDownload}
            label={t("offline.button")}
            disabled={offline.running || !offlineCandidates(items).length}
            onClick={() => void prepareOffline(items, name || t("sharedBundle.untitled"))}
          />
        )}
        <ToolbarButton icon={ClipboardCopy} label={t("bundles.copyCommands")} disabled={empty} onClick={() => void copyCommands()} />
        <ToolbarButton icon={Link2} label={t("bundles.shareLink")} disabled={empty} onClick={() => void shareLink()} />
        <Divider />
        <ToolbarButton icon={Trash2} label={t("bundles.removeSelected")} disabled={!selectedItems.length} onClick={() => remove(selected)} danger />
        <button
          type="button"
          aria-label={t("bundles.info")}
          title={t("bundles.info")}
          aria-pressed={showInfo}
          onClick={() => setShowInfo(!showInfo)}
          className={cn(
            "ml-auto flex size-9 cursor-pointer items-center justify-center rounded-xl transition-colors hover:bg-surface-2",
            showInfo ? "text-accent" : "text-muted",
          )}
        >
          <Info className="size-5" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={PROFILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void open(file);
            e.target.value = "";
          }}
        />
      </div>

      {showInfo && <p className="mb-4 rounded-2xl bg-accent/10 px-4 py-3 text-sm">{t("bundles.infoText")}</p>}

      {/* Offline balíček: stahování instalátorů do vybrané složky */}
      {offline.running && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
          <HardDriveDownload className="size-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {offline.total ? t("offline.progress", { done: offline.done + 1, total: offline.total, name: offline.name }) : t("offline.picking")}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${offline.total ? (offline.done / offline.total) * 100 : 0}%` }} />
            </div>
          </div>
          {offline.total > 0 && (
            <button type="button" onClick={cancelOffline} className="cursor-pointer text-sm font-medium text-muted hover:text-fg">
              {t("common.cancel")}
            </button>
          )}
        </div>
      )}

      {empty ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
          <PackagePlus className="size-12 text-muted/60" strokeWidth={1.5} />
          <p className="mt-4 text-lg font-semibold">{t("bundles.emptyTitle")}</p>
          <p className="mt-1 max-w-md text-sm text-muted">{t("bundles.emptyText")}</p>
          <div className="mt-6 flex gap-2">
            <Link
              to="/categories"
              className="inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
            >
              {t("bundles.browse")}
            </Link>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold transition-colors hover:bg-surface-2"
            >
              <FolderOpen className="size-4" />
              {t("bundles.open")}
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {/* Hlavička seznamu */}
          <div className="flex items-center gap-4 border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wider text-muted uppercase">
            <Checkbox checked={allSelected} onChange={() => selectAll(!allSelected)} label={t("bundles.selectAll")} />
            <span className="flex-1">{t("bundles.colApp")}</span>
            <span className="w-44">{t("bundles.colSource")}</span>
            <span className="w-36">{t("bundles.colVersion")}</span>
            <span className="w-44">{t("bundles.colStatus")}</span>
            <span className="w-8" />
          </div>
          {items.map((item) => (
            <BundleRow key={item.appId} item={item} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmNew}
        danger
        title={t("bundles.confirmNew")}
        confirmLabel={t("bundles.new")}
        onConfirm={reset}
        onClose={() => setConfirmNew(false)}
      />
    </>
  );
}

/** Jeden řádek sady: výběr, aplikace, zdroj, verze, stav, odebrání. */
function BundleRow({ item }: { item: BundleItem }) {
  const { t } = useTranslation();
  const catalogIndex = useCatalogIndex();
  const installed = useInstalledIndex().get(item.appId);
  const job = useJobs((s) => s.jobs[item.appId]);
  const { selected, toggleSelected, update, remove } = useBundle();
  const entry = catalogIndex.get(item.appId) ?? fallbackEntry(item.source, item.packageId, item.name, item.version ?? "");
  const current = entry.sources.find((s) => s.source === item.source);

  return (
    <div className="flex items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-surface-2/50">
      <Checkbox checked={selected.includes(item.appId)} onChange={() => toggleSelected(item.appId)} label={item.name} />
      <Link to={`/package/${encodeURIComponent(item.appId)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold hover:underline">{entry.name}</p>
          <p className="truncate text-xs text-muted">{entry.publisher}</p>
        </div>
      </Link>

      {/* Zdroj – lze přepnout na jiný, kde je aplikace dostupná */}
      <div className="w-44">
        <select
          value={item.source}
          disabled={entry.sources.length < 2}
          onChange={(e) => {
            const s = entry.sources.find((x) => x.source === e.target.value);
            if (s) update(item.appId, { source: s.source, packageId: s.packageId, version: undefined });
          }}
          className="h-8 w-full cursor-pointer rounded-lg border border-line bg-surface-2 px-2 text-xs outline-none disabled:cursor-default disabled:opacity-80"
        >
          {entry.sources.map((s) => (
            <option key={s.source} value={s.source}>
              {getSource(s.source).label}
            </option>
          ))}
        </select>
      </div>

      <span className="w-36 truncate text-xs text-muted tabular-nums">
        {item.version ? item.version : `${t("bundles.latest")} (${current?.version ?? "?"})`}
      </span>

      <div className="w-44">
        {job ? (
          <JobProgress job={job} />
        ) : installed ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
            <Check className="size-3.5" />
            {t("package.installed")}
          </span>
        ) : (
          <span className="text-xs text-muted">{t("bundles.notInstalled")}</span>
        )}
      </div>

      <button
        type="button"
        aria-label={t("bundles.removeOne", { name: item.name })}
        title={t("bundles.removeOne", { name: item.name })}
        onClick={() => remove([item.appId])}
        className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

/** Hlavní tlačítko „Nainstalovat vybrané“ s rozbalovací volbou „Nainstalovat vše“. */
function InstallSplitButton({
  count,
  disabled,
  onInstallSelected,
  onInstallAll,
}: {
  count: number;
  disabled: boolean;
  onInstallSelected: () => void;
  onInstallAll: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  return (
    <div ref={root} className="relative flex">
      <button
        type="button"
        disabled={disabled || count === 0}
        onClick={onInstallSelected}
        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-l-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:brightness-110 disabled:cursor-default disabled:opacity-50"
      >
        <Download className="size-4" />
        {t("bundles.installSelected")}
        {count > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px] leading-5">{count}</span>}
      </button>
      <button
        type="button"
        aria-label={t("bundles.moreInstall")}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="ml-px inline-flex h-9 cursor-pointer items-center rounded-r-xl bg-accent px-2 text-accent-fg transition hover:brightness-110 disabled:cursor-default disabled:opacity-50"
      >
        <ChevronDown className="size-4" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1.5 w-56 rounded-xl border border-line bg-surface p-1 shadow-card-hover">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onInstallAll();
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            <Download className="size-4 text-muted" />
            {t("bundles.installAll")}
          </button>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-40",
        danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-surface-2",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1 h-6 w-px bg-line" />;

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }): ReactNode {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border-2 transition-colors",
        checked ? "border-accent bg-accent text-accent-fg" : "border-muted/50 hover:border-accent/60",
      )}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}
