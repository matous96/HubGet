/**
 * Nainstalovat na jiný počítač (nabídka instalace → Nainstalovat na jiný počítač…): seznam
 * ostatních počítačů na účtu (Moje počítače). „Poslat“ zapíše žádost „install“ do záznamu tohoto
 * počítače (store/devices) – synchronizace ji předá a druhý počítač aplikaci nainstaluje, jakmile
 * na něm HubGet poběží (DeviceCommandRunner). U počítače, kde aplikace už je, nebo se starším
 * HubGetem (bez „install“ v accepts) se poslat nedá.
 */
import { Check, Clock, Laptop, Monitor, Send } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatRelative } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { freshDevices, useDevices, waitingSince, type DeviceRecord } from "@/store/devices";
import { useSettings } from "@/store/settings";
import { useSync } from "@/store/sync";
import type { CatalogEntry, SourceId } from "@/types";

interface Target {
  entry: CatalogEntry;
  source: SourceId;
  packageId: string;
}

interface SendState {
  target: Target | null;
  open: (target: Target) => void;
  close: () => void;
}

export const useSendToDevice = create<SendState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

/** Počet ostatních počítačů na účtu (položka v nabídce se ukáže jen s přihlášením a synchronizací). */
export function useOtherDeviceCount() {
  const user = useAuth((s) => s.user);
  const syncOn = useSync((s) => s.enabled && s.kinds.devices);
  const count = useDevices((s) => Object.keys(freshDevices(s.devices)).filter((id) => id !== s.deviceId).length);
  return user && syncOn ? count : 0;
}

/** Má počítač aplikaci v přehledu (podle kteréhokoli zdroje z katalogu)? */
export function deviceHasApp(device: DeviceRecord, entry: CatalogEntry) {
  const keys = new Set(entry.sources.map((s) => `${s.source}:${s.packageId.toLowerCase()}`));
  return device.apps.some(([source, packageId]) => keys.has(`${source}:${packageId.toLowerCase()}`));
}

export function SendToDeviceDialog() {
  const target = useSendToDevice((s) => s.target);
  if (!target) return null;
  return <SendDialog target={target} />;
}

function SendDialog({ target }: { target: Target }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const close = useSendToDevice((s) => s.close);
  const { deviceId, devices, commands, request } = useDevices();
  const { entry, source, packageId } = target;
  const others = useMemo(
    () => Object.entries(freshDevices(devices)).filter(([id]) => id !== deviceId).sort(([, a], [, b]) => Date.parse(b.seen) - Date.parse(a.seen)),
    [devices, deviceId],
  );

  return (
    <Modal
      open
      onClose={close}
      title={t("sendToDevice.title", { name: entry.name })}
      footer={
        <Button variant="secondary" onClick={close}>
          {t("common.close")}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("sendToDevice.intro")}</p>
      {others.length === 0 && <p className="text-sm">{t("devices.onlyThis")}</p>}
      <ul className="-mx-2 divide-y divide-line">
        {others.map(([id, device]) => {
          const Icon = /notebook|laptop/i.test(device.name) ? Laptop : Monitor;
          const present = deviceHasApp(device, entry);
          const supported = !!device.accepts?.includes("install");
          const waiting = waitingSince(commands, id, device, (c) => c.kind === "install" && c.app?.appId === entry.id);
          return (
            <li key={id} className="flex flex-wrap items-center gap-3 px-2 py-2.5">
              <Icon className="size-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{device.name}</p>
                <p className="truncate text-xs text-muted">{t("devices.seen", { when: formatRelative(device.seen, language) })}</p>
              </div>
              {present ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                  <Check className="size-3.5" />
                  {t("sendToDevice.present")}
                </span>
              ) : !supported ? (
                <span className="text-xs text-muted">{t("sendToDevice.oldVersion")}</span>
              ) : waiting ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <Clock className="size-3.5" />
                  {t("sendToDevice.waiting")}
                </span>
              ) : (
                <Button size="sm" onClick={() => request(id, "install", { appId: entry.id, name: entry.name, source, packageId })}>
                  <Send className="size-3.5" />
                  {t("sendToDevice.send")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
