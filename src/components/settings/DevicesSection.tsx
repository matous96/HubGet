/**
 * Moje počítače (store/devices.ts): přehled tohoto počítače pro synchronizaci
 * (DeviceReporter – v Layoutu, bez vzhledu) a sekce Nastavení se seznamem
 * počítačů na účtu: kdy byly vidět, kolik mají aplikací a aktualizací a
 * „Nainstalovat sem aplikace z…“ (dialog importu profilu s aplikacemi, které
 * tu chybí).
 */
import { Download, Laptop, Monitor, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { isUnmanagedOrigin, useInstalledItems } from "@/hooks/useInstalledItems";
import { useSystemInfo } from "@/hooks/useSystemInfo";
import { formatRelative } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { DEVICE_REFRESH_HOURS, freshDevices, useDevices, type DeviceApp, type DeviceRecord } from "@/store/devices";
import { useProfileImport } from "@/store/profileImport";
import { useSettings } from "@/store/settings";
import { useSync } from "@/store/sync";
import { sourceKey, useCatalogIndex, useInstalledIndex, useSourceIndex } from "@/hooks/usePackages";
import { Card } from "./SettingsUi";

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
    const same = current && current.name === name && current.version === system.appVersion && JSON.stringify(current.apps) === JSON.stringify(apps);
    const recent = current && Date.now() - Date.parse(current.seen) < DEVICE_REFRESH_HOURS * 60 * 60_000;
    if (same && recent) return;
    setSelf({ name, seen: new Date().toISOString(), os, version: system.appVersion, apps });
  }, [items, isLoading, isError, system]);

  return null;
}

/** Sekce Nastavení → Moje počítače. */
export function DevicesSection() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const user = useAuth((s) => s.user);
  const syncOn = useSync((s) => s.enabled && s.kinds.devices);
  const { deviceId, devices } = useDevices();
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
      <ul className="divide-y divide-line">
        {list.map(([id, device]) => (
          <DeviceRow key={id} device={device} self={id === deviceId} when={formatRelative(device.seen, language)} />
        ))}
      </ul>
      {list.length < 2 && <p className="px-4 pb-4 text-xs text-muted">{t("devices.onlyThis")}</p>}
    </Card>
  );
}

function DeviceRow({ device, self, when }: { device: DeviceRecord; self: boolean; when: string }) {
  const { t } = useTranslation();
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const sourceIndex = useSourceIndex();
  const show = useProfileImport((s) => s.show);
  const updates = device.apps.filter((a) => a[4]).length;

  // Aplikace z toho počítače, které tady chybí (podle profilu v katalogu, jinak podle id balíčku)
  const missing = useMemo(() => {
    if (self) return [];
    return device.apps
      .map(([source, packageId, name]) => {
        const entry = sourceIndex.get(sourceKey(source, packageId)) ?? catalog.get(packageId);
        return { appId: entry?.id ?? `${source}:${packageId}`, name: entry?.name ?? name, source, packageId };
      })
      .filter((app) => !installed.has(app.appId));
  }, [self, device.apps, installed, catalog, sourceIndex]);

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
