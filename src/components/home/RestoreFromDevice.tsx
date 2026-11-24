/**
 * Obnova po přeinstalování Windows (Domů): na účtu je jiný záznam počítače se stejným názvem
 * (Moje počítače, store/devices) – nejspíš tento počítač před přeinstalováním Windows nebo
 * HubGetu – a chybí tu z něj aspoň MIN_MISSING aplikací. Nabídne je vrátit jedním kliknutím
 * (dialog importu profilu, jako „Nainstalovat sem“ v Moje počítače); zavřená nabídka se
 * u toho záznamu už neukáže.
 */
import { History, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { deviceMissingApps } from "@/components/settings/DevicesSection";
import { Button, IconButton } from "@/components/ui/Button";
import { useCatalogIndex, useInstalledIndex, useSourceIndex } from "@/hooks/usePackages";
import { useSystemInfo } from "@/hooks/useSystemInfo";
import { formatRelative } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { useDeviceInstalls } from "@/store/deviceInstalls";
import { freshDevices, useDevices } from "@/store/devices";
import { useProfileImport } from "@/store/profileImport";
import { useSettings } from "@/store/settings";
import { useSync } from "@/store/sync";

/** Od kolika chybějících aplikací nabídnout obnovu (pár rozdílů je běžný stav dvou instalací). */
const MIN_MISSING = 5;

export function RestoreFromDevice() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const user = useAuth((s) => s.user);
  const syncOn = useSync((s) => s.enabled && s.kinds.devices);
  const system = useSystemInfo();
  const { deviceId, devices } = useDevices();
  const dismissed = useDeviceInstalls((s) => s.dismissedRestore);
  const dismiss = useDeviceInstalls((s) => s.dismissRestore);
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const sourceIndex = useSourceIndex();
  const show = useProfileImport((s) => s.show);

  const offer = useMemo(() => {
    const name = system?.computerName?.toLowerCase();
    if (!user || !syncOn || !name || !installed.size || !catalog.size) return null;
    const candidates = Object.entries(freshDevices(devices))
      .filter(([id, d]) => id !== deviceId && !dismissed.includes(id) && d.name.toLowerCase() === name)
      .map(([id, device]) => ({ id, device, missing: deviceMissingApps(device, installed, catalog, sourceIndex) }))
      .filter((c) => c.missing.length >= MIN_MISSING)
      .sort((a, b) => b.missing.length - a.missing.length);
    return candidates[0] ?? null;
  }, [user, syncOn, system, devices, deviceId, dismissed, installed, catalog, sourceIndex]);

  if (!offer) return null;
  const { id, device, missing } = offer;

  return (
    <section className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-3xl border border-accent/30 bg-accent/8 px-5 py-4">
      <History className="size-8 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{t("restore.title")}</h2>
        <p className="text-sm text-muted">
          {t("restore.text", { count: missing.length, name: device.name, when: formatRelative(device.seen, language) })}
        </p>
      </div>
      <Button
        onClick={() => show({ format: "unibox-bundle", version: 1, name: device.name, createdAt: device.seen, packages: missing })}
      >
        {t("restore.action", { count: missing.length })}
      </Button>
      <IconButton onClick={() => dismiss(id)} title={t("ratePrompt.later")} aria-label={t("ratePrompt.later")}>
        <X className="size-4" />
      </IconButton>
    </section>
  );
}
