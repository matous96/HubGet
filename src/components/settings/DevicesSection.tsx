/**
 * Moje počítače (store/devices.ts): přehled tohoto počítače pro synchronizaci
 * (DeviceReporter – v Layoutu, bez vzhledu) a sekce Nastavení se seznamem
 * počítačů na účtu: kdy byly vidět, kolik mají aplikací a aktualizací a
 * „Nainstalovat sem aplikace z…“ (dialog importu profilu s aplikacemi, které
 * tu chybí).
 */
import { invoke } from "@tauri-apps/api/core";
import { Clock, Download, Laptop, Monitor, RefreshCw } from "lucide-react";
import { isTauri } from "@/lib/tauri";
import i18n from "@/i18n";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { isUnmanagedOrigin, useInstalledItems, useUpdates } from "@/hooks/useInstalledItems";
import { useSystemInfo } from "@/hooks/useSystemInfo";
import { formatRelative } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { useAutoUpdates } from "@/store/autoUpdates";
import { deviceAppKey, newDeviceApps, useDeviceInstalls } from "@/store/deviceInstalls";
import { useEverInstalled } from "@/store/everInstalled";
import { useJobs } from "@/store/jobs";
import { writeLog } from "@/store/logs";
import { commandsFor, DEVICE_REFRESH_HOURS, freshDevices, useDevices, waitingSince, type DeviceApp, type DeviceRecord } from "@/store/devices";
import { notifyEvent } from "@/services/notify";
import { useProfileImport } from "@/store/profileImport";
import { useSettings } from "@/store/settings";
import { useSync } from "@/store/sync";
import { sourceKey, useCatalogIndex, useInstalledIndex, useSourceIndex } from "@/hooks/usePackages";
import type { CatalogEntry, SourceId } from "@/types";
import { Card, SwitchRow } from "./SettingsUi";

/** Zapisuje přehled tohoto počítače, když se změní nainstalované aplikace (a jednou za pár hodin). */
export function DeviceReporter() {
  const { items, isLoading, isError } = useInstalledItems();
  const system = useSystemInfo();

  useEffect(() => {
    // Seznam se nenačetl (správci neodpověděli) – prázdný přehled by vypadal jako odinstalované vše
    if (!system || isLoading || isError || !items.length) return;
    const apps: DeviceApp[] = items
      .filter((i) => !isUnmanagedOrigin(i.pkg.origin) && !i.pkg.diskLocation)
      .map((i) => [i.pkg.source, i.pkg.packageId, i.entry.name, i.pkg.installedVersion, i.pkg.availableVersion]);
    apps.sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
    const { deviceId, devices, setSelf } = useDevices.getState();
    const current = devices[deviceId];
    const name = system.computerName ?? system.osName;
    const os = [system.osName, system.osDisplayVersion].filter(Boolean).join(" ");
    // Záznam ze starší verze bez „accepts“ přepsat hned – jinak by se mu 6 hodin nenabízelo Aktualizovat tam
    const same =
      current &&
      current.name === name &&
      current.version === system.appVersion &&
      !!current.accepts?.includes("updateAll") &&
      JSON.stringify(current.apps) === JSON.stringify(apps);
    const recent = current && Date.now() - Date.parse(current.seen) < DEVICE_REFRESH_HOURS * 60 * 60_000;
    if (same && recent) return;
    setSelf({ name, seen: new Date().toISOString(), os, version: system.appVersion, apps });
  }, [items, isLoading, isError, system]);

  return null;
}

/**
 * Automaticky instalovat aplikace z ostatních počítačů (Nastavení → Moje počítače, store/deviceInstalls):
 * aplikace, která na jiném počítači na účtu přibyla po zapnutí volby, se tu nainstaluje na pozadí –
 * přes stejného správce, jinak přes jiný zapnutý zdroj z katalogu. Ne aplikace, kterou tu uživatel
 * kdysi měl a odinstaloval (store/everInstalled) – tu znovu nevnucovat.
 */
export function DeviceAutoInstaller() {
  const enabled = useAutoUpdates((s) => s.installFromDevices);
  const user = useAuth((s) => s.user);
  const syncOn = useSync((s) => s.enabled && s.kinds.devices);
  const { deviceId, devices } = useDevices();
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const sourceIndex = useSourceIndex();
  const enabledSources = useSettings((s) => s.enabledSources);

  useEffect(() => {
    // Bez načtených nainstalovaných a katalogu by se nainstalovalo i to, co tu už je
    if (!enabled || !user || !syncOn || !installed.size || !catalog.size) return;
    const others = Object.entries(freshDevices(devices)).filter(([id]) => id !== deviceId);
    const byDevice = Object.fromEntries(others.map(([id, device]) => [id, device.apps.map((app) => deviceAppKey(app[0], app[1]))]));
    const { known, remember } = useDeviceInstalls.getState();
    const fresh = newDeviceApps(byDevice, known);
    // Počítač bez zapamatovaného stavu (nově zapnuto, nový počítač) – jen výchozí stav
    for (const [id, keys] of Object.entries(byDevice)) if (!known[id]) remember(id, keys);
    if (!fresh.length) return;
    void installFresh(fresh);
  }, [enabled, user, syncOn, devices, deviceId, installed, catalog, sourceIndex, enabledSources]);

  /** Instalace nově přibylých aplikací – na měřeném připojení (volba jako u automatických aktualizací) počká. */
  async function installFresh(fresh: { deviceId: string; key: string }[]) {
    const { remember } = useDeviceInstalls.getState();
    if (useAutoUpdates.getState().skipOnMetered && isTauri()) {
      const status = await invoke<{ metered: boolean }>("power_network_status").catch(() => null);
      // Nezapamatovat – zkusí se při další změně přehledu počítačů
      if (status?.metered) return;
    }
    const apps = new Map<string, DeviceApp>();
    for (const [, device] of Object.entries(freshDevices(devices))) for (const app of device.apps) apps.set(deviceAppKey(app[0], app[1]), app);
    const ever = useEverInstalled.getState().ids;
    const { enqueue, jobs } = useJobs.getState();
    for (const { deviceId: from, key } of fresh) {
      remember(from, [key]);
      const [source, packageId] = apps.get(key)!;
      const entry = sourceIndex.get(sourceKey(source, packageId)) ?? catalog.get(packageId);
      if (!entry || installed.has(entry.id) || jobs[entry.id] || entry.id in ever) continue;
      const pkg = pickSource(entry, source, packageId, enabledSources);
      if (!pkg) continue;
      writeLog(pkg.source, "info", i18n.t("devices.autoInstall", { name: entry.name, device: devices[from]?.name ?? "" }));
      enqueue({ appId: entry.id, appName: entry.name, source: pkg.source, packageId: pkg.packageId, kind: "install", background: true });
    }
  }

  return null;
}

/**
 * Žádosti „Aktualizovat tam“ z ostatních počítačů (Moje počítače): jakmile synchronizace přinese
 * žádost pro tento počítač, zařadí aktualizace všech aplikací (jako Aktualizovat vše, i velké verze –
 * je to výslovná žádost uživatele) – každou žádost jednou. Hned potom obnoví „naposledy vidět“,
 * aby počítač, který žádal, viděl, že žádost došla.
 */
export function DeviceCommandRunner() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const syncOn = useSync((s) => s.enabled && s.kinds.devices);
  const { deviceId, devices, handled } = useDevices();
  const { items, isLoading, isError } = useInstalledItems();
  const { updatable, pending, updateAll } = useUpdates();
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const sourceIndex = useSourceIndex();
  const enabledSources = useSettings((s) => s.enabledSources);

  useEffect(() => {
    // Bez načtených nainstalovaných a katalogu by se žádost „vyřídila“ s ničím
    if (!user || !syncOn || isLoading || isError || !items.length || !catalog.size) return;
    const due = commandsFor(deviceId, devices, handled);
    if (!due.length) return;
    const { markHandled, setSelf } = useDevices.getState();
    for (const { command } of due) markHandled(command.id);
    const from = (list: typeof due) => [...new Set(list.map((d) => d.from.name))].join(", ");
    const notify = (message: string) => notifyEvent({ type: "info", tone: "info", title: null, message, toast: message, record: true });

    // Aktualizovat tam: jako Aktualizovat vše; počet i s aktualizacemi, které už běží
    const updates = due.filter((d) => d.command.kind === "updateAll");
    if (updates.length) {
      if (pending) void updateAll();
      const count = updatable.length;
      notify(count ? t("devices.remoteUpdate", { device: from(updates), count }) : t("devices.remoteUpdateNone", { device: from(updates) }));
    }

    // Nainstalovat na jiný počítač: přes stejného správce, jinak přes jiný zapnutý zdroj z katalogu
    const installs = due.filter((d) => d.command.kind === "install" && d.command.app);
    const queued: string[] = [];
    const { enqueue, jobs } = useJobs.getState();
    for (const { command, from: device } of installs) {
      const app = command.app!;
      const entry = sourceIndex.get(sourceKey(app.source, app.packageId)) ?? catalog.get(app.appId);
      const pkg = entry && pickSource(entry, app.source, app.packageId, enabledSources);
      if (!entry || !pkg || installed.has(entry.id) || jobs[entry.id]) {
        const key = entry && (installed.has(entry.id) || jobs[entry.id]) ? "devices.remoteInstallPresent" : "devices.remoteInstallUnavailable";
        writeLog(app.source, "info", t(key, { name: app.name, device: device.name }));
        continue;
      }
      enqueue({ appId: entry.id, appName: entry.name, source: pkg.source, packageId: pkg.packageId, kind: "install" });
      queued.push(entry.name);
    }
    if (queued.length) notify(t("devices.remoteInstall", { device: from(installs), names: queued.join(", "), count: queued.length }));

    const self = useDevices.getState().devices[deviceId];
    if (self) setSelf({ ...self, seen: new Date().toISOString() });
    // updateAll je při každém vykreslení nová funkce – stačí aktuální pending
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, syncOn, deviceId, devices, handled, items, isLoading, isError, pending, updatable, installed, catalog, sourceIndex, enabledSources, t]);

  return null;
}

/** Zdroj, přes který aplikaci nainstalovat: zvolený, když je zapnutý, jinak jiný zapnutý zdroj z katalogu. */
export function pickSource(entry: CatalogEntry, source: SourceId, packageId: string, enabled: SourceId[]): { source: SourceId; packageId: string } | null {
  if (enabled.includes(source)) return { source, packageId };
  return entry.sources.find((s) => enabled.includes(s.source)) ?? null;
}

/** Aplikace z přehledu jiného počítače, které tady chybí (podle profilu v katalogu, jinak podle id balíčku). */
export function deviceMissingApps(
  device: DeviceRecord,
  installed: ReadonlyMap<string, unknown>,
  catalog: ReadonlyMap<string, CatalogEntry>,
  sourceIndex: ReadonlyMap<string, CatalogEntry>,
) {
  return device.apps
    .map(([source, packageId, name]) => {
      const entry = sourceIndex.get(sourceKey(source, packageId)) ?? catalog.get(packageId);
      return { appId: entry?.id ?? `${source}:${packageId}`, name: entry?.name ?? name, source, packageId };
    })
    .filter((app) => !installed.has(app.appId));
}

/** Sekce Nastavení → Moje počítače. */
export function DevicesSection() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const user = useAuth((s) => s.user);
  const syncOn = useSync((s) => s.enabled && s.kinds.devices);
  const { deviceId, devices, commands } = useDevices();
  const autoInstall = useAutoUpdates((s) => s.installFromDevices);
  const list = useMemo(
    () => Object.entries(freshDevices(devices)).sort(([a, x], [b, y]) => (a === deviceId ? -1 : b === deviceId ? 1 : Date.parse(y.seen) - Date.parse(x.seen))),
    [devices, deviceId],
  );

  if (!user || !syncOn) {
    return (
      <Card title={t("devices.title")}>
        <p className="px-4 py-4 text-sm text-muted">{t(user ? "devices.syncOff" : "devices.signIn")}</p>
      </Card>
    );
  }

  return (
    <Card title={t("devices.title")}>
      <p className="px-4 pt-3 text-sm text-muted">{t("devices.intro")}</p>
      {/* Co přibude na jiném počítači, nainstalovat i tady (jako Automatické stahování v App Storu) */}
      <SwitchRow
        label={t("devices.autoInstallSetting")}
        hint={t("devices.autoInstallHint")}
        checked={autoInstall}
        onChange={(on) => {
          // Zapnutí: výchozí stav ostatních počítačů znovu – nainstaluje se jen to, co přibude potom
          if (on) useDeviceInstalls.getState().reset();
          useAutoUpdates.getState().set({ installFromDevices: on });
        }}
      />
      <ul className="divide-y divide-line">
        {list.map(([id, device]) => (
          <DeviceRow
            key={id}
            id={id}
            device={device}
            self={id === deviceId}
            when={formatRelative(device.seen, language)}
            requested={waitingSince(commands, id, device, (c) => c.kind === "updateAll")}
          />
        ))}
      </ul>
      {list.length < 2 && <p className="px-4 pb-4 text-xs text-muted">{t("devices.onlyThis")}</p>}
    </Card>
  );
}

interface DeviceRowProps {
  id: string;
  device: DeviceRecord;
  self: boolean;
  when: string;
  /** Kdy odsud odešla žádost Aktualizovat tam, na kterou ten počítač ještě nereagoval (ISO), jinak null. */
  requested: string | null;
}

function DeviceRow({ id, device, self, when, requested }: DeviceRowProps) {
  const { t } = useTranslation();
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const sourceIndex = useSourceIndex();
  const show = useProfileImport((s) => s.show);
  const updates = device.apps.filter((a) => a[4]).length;
  const waiting = !!requested;
  const canRequest = !self && updates > 0 && !!device.accepts?.includes("updateAll");

  // Aplikace z toho počítače, které tady chybí (podle profilu v katalogu, jinak podle id balíčku)
  const missing = useMemo(() => (self ? [] : deviceMissingApps(device, installed, catalog, sourceIndex)), [self, device, installed, catalog, sourceIndex]);

  const Icon = /notebook|laptop/i.test(device.name) ? Laptop : Monitor;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Icon className="size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {device.name}
          {self && <span className="ml-2 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent">{t("devices.this")}</span>}
        </p>
        <p className="truncate text-xs text-muted">
          {[self ? null : t("devices.seen", { when }), device.os, t("devices.apps", { count: device.apps.length })].filter(Boolean).join(" · ")}
        </p>
      </div>
      {updates > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2.5 py-1 text-xs font-semibold text-accent">
          <RefreshCw className="size-3.5" />
          {t("devices.updates", { count: updates })}
        </span>
      )}
      {canRequest &&
        (waiting ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Clock className="size-3.5" />
            {t("devices.updateRequested")}
          </span>
        ) : (
          <Button variant="secondary" onClick={() => useDevices.getState().request(id)} title={t("devices.updateThereHint", { device: device.name })}>
            <RefreshCw className="size-4" />
            {t("devices.updateThere")}
          </Button>
        ))}
      {!self && missing.length > 0 && (
        <Button
          variant="secondary"
          onClick={() =>
            show({
              format: "unibox-bundle",
              version: 1,
              name: device.name,
              createdAt: device.seen,
              packages: missing,
            })
          }
        >
          <Download className="size-4" />
          {t("devices.installHere", { count: missing.length })}
        </Button>
      )}
    </li>
  );
}
