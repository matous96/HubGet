/**
 * Nastavení → Aktualizace balíčků (po vzoru UniGetUI):
 *  - kontrola: v pevném intervalu, každý den nebo ve vybrané dny v zadaný čas,
 *    „Spustit tuto úlohu nyní“,
 *  - automatická instalace (vše / jen vybrané aplikace) po každé kontrole nebo
 *    ve vlastním čase; ne na baterii, při úspoře baterie a na měřeném připojení,
 *  - zmeškané termíny (dohnat se zpožděním, hned, nebo přeskočit),
 *  - bezpečnost: minimální stáří aktualizací (i zvlášť pro správce) a neprojevené
 *    aktualizace, předvýběr aktualizací v seznamu.
 * Logika: hooks/useAutoUpdates.ts, pravidla: store/updateRules.ts, stav: store/autoUpdates.ts.
 */
import { ChevronDown, Play, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/CollectionToolbar";
import { Spinner } from "@/components/ui/States";
import { runUpdateCheck } from "@/hooks/useAutoUpdates";
import { useInstalled } from "@/hooks/usePackages";
import { nextTime, type Schedule } from "@/lib/schedule";
import { isTauri } from "@/lib/tauri";
import { cn, formatRelative } from "@/lib/utils";
import { getSource, SOURCES } from "@/services/managers";
import {
  IDLE_MINUTES,
  INTERVAL_MS,
  INTERVALS,
  MIN_AGE_DAYS,
  useAutoUpdates,
  WEEK_DAYS,
  type AutoInstallMode,
  type CheckRepeat,
  type InstallRepeat,
  type MissedPolicy,
} from "@/store/autoUpdates";
import { activeSources, useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import { pinKey } from "@/store/updatePins";
import type { SourceId } from "@/types";
import { Card, Row, SwitchRow } from "./SettingsUi";

const select = "h-9 cursor-pointer rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent/50";

export function PackageUpdatesSection() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const auto = useAutoUpdates();
  const { data: installed } = useInstalled();

  const checkNow = async () => {
    const result = await runUpdateCheck();
    if (result.queued) toast("info", t("autoUpdates.queued", { count: result.queued }));
    else if (result.skipped) toast("info", t(`autoUpdates.skipped_${result.skipped}`, { count: result.available }));
    else toast(result.available ? "info" : "success", result.available ? t("autoUpdates.foundShort", { count: result.available }) : t("autoUpdates.upToDate"));
  };

  // Vybrané aplikace (automatická instalace jen pro ně): nainstalované balíčky s klíčem zdroj:id
  const byKey = new Map((installed ?? []).map((p) => [pinKey(p), p]));
  const updatable = (installed ?? []).filter((p) => p.availableVersion && !auto.selected.includes(pinKey(p)));

  // Příští kontrola (popisek u „Spustit nyní“)
  const checkSchedule: Schedule =
    auto.checkRepeat === "interval"
      ? { repeat: "interval", intervalMs: INTERVAL_MS[auto.interval] }
      : { repeat: auto.checkRepeat, time: auto.checkTime, days: auto.checkDays };
  const since = [auto.lastCheck, auto.checkRepeat === "interval" ? null : auto.checkPlannedAt]
    .map((v) => (v ? Date.parse(v) : NaN))
    .filter((v) => !Number.isNaN(v));
  const next = auto.autoCheck ? nextTime(checkSchedule, since.length ? Math.max(...since) : null, Date.now()) : null;
  const formatAt = (at: number) => new Date(at).toLocaleString(language, { weekday: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <Card title={t("autoUpdates.checkTitle")}>
        <SwitchRow
          label={t("autoUpdates.autoCheck")}
          hint={t("autoUpdates.autoCheckHint")}
          checked={auto.autoCheck}
          onChange={(autoCheck) => auto.set({ autoCheck })}
        />
        <Row label={t("autoUpdates.repeat")} disabled={!auto.autoCheck}>
          <Segmented<CheckRepeat>
            value={auto.checkRepeat}
            onChange={(checkRepeat) => auto.set({ checkRepeat })}
            options={(["interval", "daily", "days"] as const).map((v) => ({ value: v, label: t(`autoUpdates.repeat_${v}`) }))}
          />
        </Row>
        {auto.checkRepeat === "interval" ? (
          <Row label={t("autoUpdates.interval")} disabled={!auto.autoCheck}>
            <select value={auto.interval} onChange={(e) => auto.set({ interval: e.target.value as typeof auto.interval })} className={select}>
              {INTERVALS.map((v) => (
                <option key={v} value={v}>
                  {t(`autoUpdates.interval_${v}`)}
                </option>
              ))}
            </select>
          </Row>
        ) : (
          <TimeRows
            time={auto.checkTime}
            days={auto.checkRepeat === "days" ? auto.checkDays : null}
            disabled={!auto.autoCheck}
            onTime={(checkTime) => auto.set({ checkTime })}
            onDays={(checkDays) => auto.set({ checkDays })}
          />
        )}
        <Row
          label={t("autoUpdates.runNow")}
          hint={
            <>
              {auto.lastCheck ? t("autoUpdates.lastCheck", { when: formatRelative(auto.lastCheck, language) }) : t("autoUpdates.neverChecked")}
              {next !== null && <> · {t("autoUpdates.nextCheck", { when: formatAt(next) })}</>}
            </>
          }
        >
          <Button variant="secondary" size="sm" disabled={auto.checking} onClick={() => void checkNow()}>
            {auto.checking ? <Spinner className="size-3.5" /> : <Play className="size-3.5" />}
            {t("autoUpdates.runNowButton")}
          </Button>
        </Row>
      </Card>

      <Card title={t("autoUpdates.installTitle")}>
        <Row label={t("autoUpdates.autoInstall")} hint={t("autoUpdates.autoInstallHint")}>
          <Segmented<AutoInstallMode>
            value={auto.autoInstall}
            onChange={(autoInstall) => auto.set({ autoInstall })}
            options={(["off", "all", "selected"] as const).map((v) => ({ value: v, label: t(`autoUpdates.mode_${v}`) }))}
          />
        </Row>
        {auto.autoInstall === "selected" && (
          <div className="px-4 py-3.5">
            <p className="text-sm font-medium">{t("autoUpdates.selectedTitle")}</p>
            <p className="mt-0.5 text-xs text-muted">{t("autoUpdates.selectedHint")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {auto.selected.length === 0 && <span className="text-xs text-muted">{t("autoUpdates.selectedEmpty")}</span>}
              {auto.selected.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => auto.toggleSelected(key)}
                  title={t("autoUpdates.remove")}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
                >
                  {byKey.get(key)?.name ?? key}
                  <X className="size-3" />
                </button>
              ))}
            </div>
            {/* Rychlé přidání: aplikace, které mají teď aktualizaci */}
            {updatable.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted">{t("autoUpdates.addUpdatable")}</span>
                {updatable.slice(0, 12).map((p) => (
                  <button
                    key={pinKey(p)}
                    type="button"
                    onClick={() => auto.toggleSelected(pinKey(p))}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs transition-colors hover:bg-surface-2"
                    title={getSource(p.source).label}
                  >
                    + {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <Row label={t("autoUpdates.installWhen")} disabled={auto.autoInstall === "off"}>
          <Segmented<InstallRepeat>
            value={auto.installRepeat}
            onChange={(installRepeat) => auto.set({ installRepeat })}
            options={(["afterCheck", "daily", "days"] as const).map((v) => ({ value: v, label: t(`autoUpdates.install_${v}`) }))}
          />
        </Row>
        {auto.installRepeat !== "afterCheck" && (
          <TimeRows
            time={auto.installTime}
            days={auto.installRepeat === "days" ? auto.installDays : null}
            disabled={auto.autoInstall === "off"}
            onTime={(installTime) => auto.set({ installTime })}
            onDays={(installDays) => auto.set({ installDays })}
          />
        )}
        <SwitchRow
          label={t("autoUpdates.skipOnBattery")}
          hint={t("autoUpdates.skipOnBatteryHint")}
          checked={auto.skipOnBattery}
          onChange={(skipOnBattery) => auto.set({ skipOnBattery })}
          disabled={auto.autoInstall === "off"}
        />
        <SwitchRow
          label={t("autoUpdates.skipOnSaver")}
          hint={t("autoUpdates.skipOnSaverHint")}
          checked={auto.skipOnSaver}
          onChange={(skipOnSaver) => auto.set({ skipOnSaver })}
          disabled={auto.autoInstall === "off"}
        />
        <SwitchRow
          label={t("autoUpdates.skipOnMetered")}
          hint={t("autoUpdates.skipOnMeteredHint")}
          checked={auto.skipOnMetered}
          onChange={(skipOnMetered) => auto.set({ skipOnMetered })}
          disabled={auto.autoInstall === "off"}
        />
        <SwitchRow
          label={t("autoUpdates.skipWhileBusy")}
          hint={t("autoUpdates.skipWhileBusyHint")}
          checked={auto.skipWhileBusy}
          onChange={(skipWhileBusy) => auto.set({ skipWhileBusy })}
          disabled={auto.autoInstall === "off"}
        />
        <SwitchRow
          label={t("autoUpdates.onlyWhenIdle")}
          hint={t("autoUpdates.onlyWhenIdleHint", { minutes: IDLE_MINUTES })}
          checked={auto.onlyWhenIdle}
          onChange={(onlyWhenIdle) => auto.set({ onlyWhenIdle })}
          disabled={auto.autoInstall === "off"}
        />
        {isTauri() && (
          <SwitchRow
            label={t("autoUpdates.restorePoint")}
            hint={t("autoUpdates.restorePointHint")}
            checked={auto.restorePoint}
            onChange={(restorePoint) => auto.set({ restorePoint })}
          />
        )}
        <p className="px-4 py-3 text-xs text-muted">{t("autoUpdates.trayNote")}</p>
      </Card>

      <Card title={t("autoUpdates.missedTitle")}>
        <Row label={t("autoUpdates.missed")} hint={t("autoUpdates.missedHint")}>
          <Segmented<MissedPolicy>
            value={auto.missed}
            onChange={(missed) => auto.set({ missed })}
            options={(["delay", "startup", "skip"] as const).map((v) => ({ value: v, label: t(`autoUpdates.missed_${v}`) }))}
          />
        </Row>
      </Card>

      <UpdateSecurityCard />

      <Card title={t("autoUpdates.listTitle")}>
        <SwitchRow
          label={t("autoUpdates.preselect")}
          hint={t("autoUpdates.preselectHint")}
          checked={auto.preselectUpdates}
          onChange={(preselectUpdates) => auto.set({ preselectUpdates })}
        />
        <p className="px-4 py-3 text-xs text-muted">{t("autoUpdates.optionsNote")}</p>
      </Card>
    </>
  );
}

/** Čas a (u „ve vybrané dny“) dny v týdnu. */
function TimeRows({
  time,
  days,
  disabled,
  onTime,
  onDays,
}: {
  time: string;
  days: number[] | null;
  disabled: boolean;
  onTime: (time: string) => void;
  onDays: (days: number[]) => void;
}) {
  const { t, i18n } = useTranslation();
  // Krátké názvy dnů podle jazyka (2. 11. 2026 = pondělí)
  const dayName = (day: number) => new Date(2026, 10, 1 + ((day + 6) % 7) + 1).toLocaleDateString(i18n.language, { weekday: "short" });
  return (
    <>
      <Row label={t("autoUpdates.time")} disabled={disabled}>
        <input
          type="time"
          value={time}
          onChange={(e) => e.target.value && onTime(e.target.value)}
          disabled={disabled}
          className="h-9 rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent/50"
        />
      </Row>
      {days && (
        <Row label={t("autoUpdates.days")} disabled={disabled}>
          <div className="flex flex-wrap justify-end gap-1">
            {WEEK_DAYS.map((day) => {
              const on = days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled || (on && days.length === 1)}
                  onClick={() => onDays(on ? days.filter((d) => d !== day) : [...days, day])}
                  className={cn(
                    "h-8 min-w-10 cursor-pointer rounded-full border px-2.5 text-xs font-medium capitalize transition-colors disabled:cursor-default",
                    on ? "border-accent/40 bg-accent/12 text-accent" : "border-line text-muted hover:text-fg",
                  )}
                >
                  {dayName(day)}
                </button>
              );
            })}
          </div>
        </Row>
      )}
    </>
  );
}

/** Minimální stáří aktualizací (celkově i pro jednotlivé správce) a neprojevené aktualizace. */
function UpdateSecurityCard() {
  const { t } = useTranslation();
  const auto = useAutoUpdates();
  const enabled = useSettings((s) => s.enabledSources);
  const userMode = useSettings((s) => s.userMode);
  const [perSource, setPerSource] = useState(() => Object.keys(auto.minAgeBySource).length > 0);
  const preset = (MIN_AGE_DAYS as readonly number[]).includes(auto.minAgeDays);
  const [custom, setCustom] = useState(!preset);
  const sources = SOURCES.filter((s) => activeSources(enabled, userMode).includes(s.id));
  const daysLabel = (days: number) => (days === 0 ? t("autoUpdates.minAgeNone") : t("autoUpdates.minAgeDays", { count: days }));

  const setSourceAge = (source: SourceId, value: string) => {
    const next = { ...auto.minAgeBySource };
    if (value === "") delete next[source];
    else next[source] = Number(value);
    auto.set({ minAgeBySource: next });
  };

  return (
    <Card title={t("autoUpdates.securityTitle")}>
      <Row label={t("autoUpdates.minAge")} hint={t("autoUpdates.minAgeHint")}>
        <div className="flex items-center gap-2">
          <select
            value={custom ? "custom" : String(auto.minAgeDays)}
            onChange={(e) => {
              const isCustom = e.target.value === "custom";
              setCustom(isCustom);
              if (!isCustom) auto.set({ minAgeDays: Number(e.target.value) });
            }}
            className={select}
          >
            {MIN_AGE_DAYS.map((days) => (
              <option key={days} value={days}>
                {daysLabel(days)}
              </option>
            ))}
            <option value="custom">{t("autoUpdates.minAgeCustom")}</option>
          </select>
          {custom && (
            <input
              type="number"
              min={0}
              max={365}
              value={auto.minAgeDays}
              onChange={(e) => auto.set({ minAgeDays: Math.min(365, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
              aria-label={t("autoUpdates.minAgeCustomDays")}
              className="h-9 w-20 rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent/50"
            />
          )}
        </div>
      </Row>
      <div className="px-4 py-3">
        <button
          type="button"
          aria-expanded={perSource}
          onClick={() => setPerSource(!perSource)}
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-accent"
        >
          {t("autoUpdates.minAgePerSource")}
          {Object.keys(auto.minAgeBySource).length > 0 && (
            <span className="rounded-full bg-accent/12 px-1.5 text-[11px]">{Object.keys(auto.minAgeBySource).length}</span>
          )}
          <ChevronDown className={cn("size-3.5 transition-transform", perSource && "rotate-180")} />
        </button>
        {perSource && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {sources.map((s) => (
              <label key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", s.dot)} />
                  {s.label}
                </span>
                <select
                  value={auto.minAgeBySource[s.id] ?? ""}
                  onChange={(e) => setSourceAge(s.id, e.target.value)}
                  className="h-8 cursor-pointer rounded-lg border border-line bg-surface-2 px-2 text-xs outline-none focus:border-accent/50"
                >
                  <option value="">{t("autoUpdates.minAgeGlobal")}</option>
                  {[...new Set([...MIN_AGE_DAYS, auto.minAgeBySource[s.id] ?? 0])].sort((a, b) => a - b).map((days) => (
                    <option key={days} value={days}>
                      {daysLabel(days)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>
      <SwitchRow
        label={t("autoUpdates.warnHostChange")}
        hint={t("autoUpdates.warnHostChangeHint")}
        checked={auto.warnHostChange}
        onChange={(warnHostChange) => auto.set({ warnHostChange })}
      />
      <Row label={t("autoUpdates.stuck")} hint={t("autoUpdates.stuckHint")}>
        <select value={auto.stuckLimit} onChange={(e) => auto.set({ stuckLimit: Number(e.target.value) })} className={select}>
          {[0, 2, 3, 5].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? t("autoUpdates.stuckNever") : t("autoUpdates.stuckAfter", { count: n })}
            </option>
          ))}
        </select>
      </Row>
    </Card>
  );
}
