/**
 * Ignorování, přeskočení a odložení aktualizací (store/updatePins.ts):
 *  - useUpdatePin – akce pro kontextovou nabídku karty,
 *  - UpdatePinBar – řádek v detailu aplikace: „Přeskočit verzi X“ /
 *    „Odložit“ / „Ignorovat aktualizace“, u zamčené aplikace stav a zrušení.
 *    Aktualizaci podrženou pravidly (minimální stáří, neprojevená aktualizace,
 *    aplikace, která se aktualizuje sama – store/updateRules.ts) jde nabídnout hned / znovu.
 */
import { AlarmClock, ChevronDown, CircleSlash, Hourglass, Lock, LockOpen, RefreshCw, RefreshCwOff, ShieldAlert, SkipForward, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDismiss } from "@/hooks/useDismiss";
import { isUnmanagedOrigin } from "@/hooks/useInstalledItems";
import { useAutoUpdates } from "@/store/autoUpdates";
import { useInstallerHostChange } from "@/store/installerUrls";
import { useSigners } from "@/store/signers";
import { useUpdateHolds, versionKey } from "@/store/updateHolds";
import { pinKey, SNOOZE_DAYS, useUpdatePins, type SnoozeDays } from "@/store/updatePins";
import { useToasts } from "@/store/toasts";
import type { InstalledPackage } from "@/types";

/** Datum konce odložení („2. 11.“ / „Nov 2“). */
export function formatPinUntil(until: string | undefined, language: string) {
  if (!until) return "";
  return new Date(until).toLocaleDateString(language, { day: "numeric", month: "numeric", year: "numeric" });
}

export function useUpdatePin(installed: InstalledPackage | undefined, appName: string) {
  const { t, i18n } = useTranslation();
  const toast = useToasts((s) => s.push);
  const { skip, lock, snooze, unpin } = useUpdatePins();
  const allow = useUpdateHolds((s) => s.allow);
  const releaseSelfUpdating = useUpdateHolds((s) => s.releaseSelfUpdating);
  // Hry ze Steamu a programy mimo správce HubGet neaktualizuje – ignorovat není co
  const canPin = !!installed && !isUnmanagedOrigin(installed.origin);
  const offered = installed?.availableVersion ?? null;

  return {
    canPin,
    /** Nabízená verze, kterou jde přeskočit nebo odložit. */
    offered,
    pin: installed?.pin,
    /** Verze skrytá zámkem. */
    held: installed?.heldVersion,
    /** Do kdy je aktualizace odložená. */
    until: installed?.pinUntil,
    skip: () => {
      if (!installed || !offered) return;
      skip(installed, appName);
      toast("info", t("pins.skipped", { name: appName, version: offered }));
    },
    lock: () => {
      if (!installed) return;
      lock(installed, appName);
      toast("info", t("pins.locked", { name: appName, version: installed.installedVersion }));
    },
    snooze: (days: SnoozeDays) => {
      if (!installed) return;
      snooze(installed, appName, days);
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      toast("info", t("pins.snoozed", { name: appName, date: formatPinUntil(until, i18n.language) }));
    },
    unpin: () => {
      if (!installed) return;
      // Aplikace se aktualizuje sama – aktualizace přes správce zase nabízet
      if (installed.pin === "self") {
        releaseSelfUpdating(pinKey(installed));
        toast("info", t("pins.offered", { name: appName, version: installed.heldVersion ?? "" }));
        return;
      }
      // Pravidla aktualizací (minimální stáří, neprojevená aktualizace) – nabídnout tuto verzi i tak
      if ((installed.pin === "age" || installed.pin === "stuck") && installed.heldVersion) {
        allow(versionKey(installed, installed.heldVersion));
        toast("info", t("pins.offered", { name: appName, version: installed.heldVersion }));
        return;
      }
      unpin(pinKey(installed));
      toast("info", t("pins.unpinned", { name: appName }));
    },
  };
}

/** Popisek tlačítka, které zámek zruší. */
export const unpinLabel = (pin: InstalledPackage["pin"]) =>
  pin === "lock"
    ? "pins.unlock"
    : pin === "snooze"
      ? "pins.unsnooze"
      : pin === "age"
        ? "pins.offerNow"
        : pin === "stuck" || pin === "self"
          ? "pins.offerAgain"
          : "pins.unskip";

/**
 * Automatická aktualizace aplikace (Nastavení → Aktualizace balíčků): v režimu
 * „Jen vybrané“ přepínač pro tuto aplikaci, v režimu „Všechny“ jen informace.
 */
export function AutoUpdateToggle({ installed }: { installed: InstalledPackage | undefined }) {
  const { t } = useTranslation();
  const mode = useAutoUpdates((s) => s.autoInstall);
  const selected = useAutoUpdates((s) => !!installed && s.selected.includes(pinKey(installed)));
  const toggle = useAutoUpdates((s) => s.toggleSelected);
  if (!installed || isUnmanagedOrigin(installed.origin) || mode === "off") return null;

  if (mode === "all") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted">
        <RefreshCw className="size-3.5" />
        {t("autoUpdates.allApps")}
      </p>
    );
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-muted transition-colors hover:text-fg">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => toggle(pinKey(installed))}
        className="size-3.5 accent-[var(--accent)]"
      />
      {t("autoUpdates.thisApp")}
    </label>
  );
}

/**
 * Varování v detailu aplikace: instalátor nabízené verze se stahuje z jiného
 * serveru než instalátor nainstalované verze (winget, po vzoru UniGetUI).
 * Automatická aktualizace takovou aplikaci vynechá (hooks/useAutoUpdates.ts).
 */
export function InstallerHostWarning({ installed }: { installed: InstalledPackage | undefined }) {
  const { t } = useTranslation();
  const change = useInstallerHostChange(installed);
  if (!change) return null;
  return (
    <div className="flex max-w-xl gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{t("hostChange.title", { from: change.from, to: change.to })}</p>
        <p className="mt-0.5">{t("hostChange.text", { version: installed?.availableVersion })}</p>
        <p className="mt-1.5 truncate font-mono text-[11px] opacity-80" title={change.fromUrl}>
          {installed?.installedVersion}: {change.fromUrl}
        </p>
        <p className="truncate font-mono text-[11px] opacity-80" title={change.toUrl}>
          {installed?.availableVersion}: {change.toUrl}
        </p>
      </div>
    </div>
  );
}

/**
 * Instalátor nové verze podepsal jiný vydavatel než minulý (nebo nemá podpis) – HubGet ho
 * nespustil (store/signers.ts, signatures.rs). Po kontrole jde změnu přijmout a aktualizovat.
 */
export function InstallerSignerWarning({ installed, onTrust }: { installed: InstalledPackage | undefined; onTrust: () => void }) {
  const { t } = useTranslation();
  const key = installed ? pinKey(installed) : "";
  const change = useSigners((s) => (key ? s.changed[key] : undefined));
  const trust = useSigners((s) => s.trust);
  if (!installed || !change) return null;
  return (
    <div className="flex max-w-xl gap-2.5 rounded-xl border border-danger/30 bg-danger/8 px-3 py-2.5 text-xs">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="font-semibold">{change.to ? t("signer.changedTitle") : t("signer.missingTitle")}</p>
        <p className="mt-0.5">
          {change.to
            ? t("signer.changedText", { from: change.from, to: change.to, version: change.version ?? "" })
            : t("signer.missingText", { from: change.from, version: change.version ?? "" })}
        </p>
        <button
          type="button"
          onClick={() => {
            trust(key);
            onTrust();
          }}
          className="mt-1.5 cursor-pointer font-semibold text-danger hover:underline"
        >
          {t("signer.trust")}
        </button>
      </div>
    </div>
  );
}

const link = "inline-flex cursor-pointer items-center gap-1.5 font-medium text-muted transition-colors hover:text-fg";

/** Řádek v detailu aplikace pod tlačítky akcí. */
export function UpdatePinBar({ installed, appName }: { installed: InstalledPackage | undefined; appName: string }) {
  const { t, i18n } = useTranslation();
  const pin = useUpdatePin(installed, appName);
  if (!pin.canPin) return null;

  if (pin.pin) {
    const date = formatPinUntil(pin.until, i18n.language);
    const state =
      pin.pin === "lock"
        ? t("pins.lockedState", { version: installed?.installedVersion })
        : pin.pin === "snooze"
          ? t("pins.snoozedState", { version: pin.held, date })
          : pin.pin === "age"
            ? t("pins.ageState", { version: pin.held, date })
            : pin.pin === "stuck"
              ? t("pins.stuckState", { version: pin.held })
              : pin.pin === "self"
                ? // Známá aplikace s vlastním aktualizátorem – do lhůty (data/selfUpdating.ts), pak se nabídne
                  pin.until
                  ? t("pins.selfWaitState", { version: pin.held, date })
                  : t("pins.selfState", { version: pin.held })
              : t("pins.skippedState", { version: pin.held });
    const Icon =
      pin.pin === "snooze" ? AlarmClock : pin.pin === "age" ? Hourglass : pin.pin === "stuck" ? CircleSlash : pin.pin === "self" ? RefreshCwOff : Lock;
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-300">
          <Icon className="size-3" />
          {state}
        </span>
        <button type="button" onClick={pin.unpin} className={link}>
          <LockOpen className="size-3.5" />
          {t(unpinLabel(pin.pin))}
        </button>
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {pin.offered && (
        <>
          <button type="button" onClick={pin.skip} className={link}>
            <SkipForward className="size-3.5" />
            {t("pins.skip", { version: pin.offered })}
          </button>
          <SnoozeButton onSnooze={pin.snooze} />
        </>
      )}
      <button type="button" onClick={pin.lock} className={link} title={t("pins.lockHint")}>
        <Lock className="size-3.5" />
        {t("pins.lock")}
      </button>
    </p>
  );
}

/** „Odložit“ s nabídkou délky (den, týden, měsíc). */
function SnoozeButton({ onSnooze }: { onSnooze: (days: SnoozeDays) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <span ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={link} aria-haspopup="menu" aria-expanded={open}>
        <AlarmClock className="size-3.5" />
        {t("pins.snooze")}
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <span role="menu" className="absolute top-full left-0 z-30 mt-1.5 flex w-44 flex-col rounded-xl border border-line bg-surface p-1 shadow-lg">
          {SNOOZE_DAYS.map((days) => (
            <button
              key={days}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSnooze(days);
              }}
              className="rounded-lg px-3 py-2 text-left text-xs font-medium text-fg transition-colors hover:bg-surface-2"
            >
              {t(`pins.snoozeFor.${days}`)}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
