/**
 * Diagnostika pro podporu (Nastavení → Kontaktovat HubGet): jeden textový soubor
 * s tím, co pomůže najít příčinu problému – verze HubGetu a Windows, stav správců
 * balíčků, místo na disku, hlavní nastavení, nedávné neúspěšné operace a konec
 * protokolu. Nic se neodesílá, uživatel soubor uloží nebo zkopíruje sám.
 *
 * Bez osobních údajů: jméno počítače a uživatele se v textech nahradí zástupným
 * slovem, přihlášení, e-mail, tokeny ani vlastní příkazy instalace se nepřidávají.
 */
import { queryClient, queryKeys } from "@/app/queryClient";
import { managers, SOURCES } from "@/services/managers";
import { APP_VERSION } from "@/services/updates";
import { useAutoUpdates } from "@/store/autoUpdates";
import { useHistory } from "@/store/history";
import { useLogs } from "@/store/logs";
import { useOrgPolicy } from "@/store/orgPolicy";
import { useSecurity } from "@/store/security";
import { useSettings } from "@/store/settings";
import type { InstalledPackage } from "@/types";
import { diskSpace } from "./diskSpace";
import { getSystemInfo, isTauri } from "./tauri";
import { formatSizeText } from "./utils";

/** Kolik posledních řádků protokolu a neúspěšných operací přidat. */
const LOG_LINES = 300;
const FAILURES = 30;

/**
 * Odstraní osobní údaje: cesty k profilu (C:\Users\jméno → %USERPROFILE%), jméno počítače
 * a uživatele, e-mailové adresy.
 */
export function redact(text: string, names: { computer?: string | null; user?: string | null } = {}): string {
  let out = text
    .replace(/[A-Za-z]:\\Users\\[^\\/:*?"<>|\r\n]+/gi, "%USERPROFILE%")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<e-mail>");
  for (const [value, label] of [[names.computer, "<počítač>"], [names.user, "<uživatel>"]] as const) {
    if (value && value.length >= 3) out = out.split(value).join(label);
  }
  return out;
}

const iso = (time: number | string) => new Date(time).toISOString().replace("T", " ").slice(0, 19);

export async function buildDiagnostics(): Promise<string> {
  const system = await getSystemInfo();
  const disk = await diskSpace();
  const settings = useSettings.getState();
  const auto = useAutoUpdates.getState();
  const security = useSecurity.getState();
  const policy = useOrgPolicy.getState();

  const lines: string[] = [];
  const section = (title: string) => lines.push("", `== ${title} ==`);
  lines.push(`HubGet – diagnostika (${iso(Date.now())} UTC)`);

  section("Systém");
  lines.push(`HubGet ${APP_VERSION}${isTauri() ? "" : " (webová verze)"}`);
  if (system) lines.push(`${system.osName}${system.osDisplayVersion ? ` ${system.osDisplayVersion}` : ""} (sestavení ${system.osBuild}), ${system.arch}`);
  if (disk) lines.push(`Disk ${disk.drive} – volno ${formatSizeText(disk.free, "cs")} z ${formatSizeText(disk.total, "cs")}`);
  lines.push(`Jazyk: ${settings.language}, režim: ${settings.userMode}`);

  section("Správci balíčků");
  const statuses = await Promise.all(
    SOURCES.map(async (s) => {
      const enabled = settings.enabledSources.includes(s.id);
      if (!enabled) return `${s.label}: vypnutý`;
      const status = await Promise.race([
        managers[s.id].getStatus().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      return `${s.label}: ${status ? (status.available ? `ano${status.version ? ` ${status.version}` : ""}` : status.planned ? "připravuje se" : "nenainstalovaný") : "nezjištěno"}`;
    }),
  );
  lines.push(...statuses);

  section("Nainstalované");
  const installed = queryClient.getQueriesData<InstalledPackage[]>({ queryKey: queryKeys.installed }).flatMap(([, d]) => d ?? []);
  const bySource = new Map<string, number>();
  for (const p of installed) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1);
  lines.push(`Celkem ${installed.length}: ${[...bySource].map(([s, n]) => `${s} ${n}`).join(", ") || "–"}`);
  lines.push(`Nabízené aktualizace (před pravidly): ${installed.filter((p) => p.availableVersion).length}`);

  section("Nastavení");
  lines.push(
    `Automatické aktualizace: kontrola ${auto.autoCheck ? auto.checkRepeat : "vypnutá"}, instalace ${auto.autoInstall}, minimální stáří ${auto.minAgeDays} d, bezpečnostní bez čekání ${auto.securityNoWait ? "ano" : "ne"}`,
    `Oprávnění: povýšit vždy ${security.elevateAlways ? "ano" : "ne"}, jednou ${security.elevateOnce ? "ano" : "ne"}, zakázat ${security.elevationProhibited ? "ano" : "ne"}, vlastní argumenty ${security.allowCustomArgs ? "ano" : "ne"}, příkazy před/po ${security.allowPrePostCommands ? "ano" : "ne"}, vlastní cesty správců ${security.allowCustomManagerPaths ? "ano" : "ne"}`,
    `Firemní zásady: ${policy.managed ? JSON.stringify({ ...policy, allowedApps: policy.allowedApps ? `${policy.allowedApps.length} aplikací` : null }) : "žádné"}`,
  );

  section(`Neúspěšné operace (posledních ${FAILURES})`);
  const failures = useHistory
    .getState()
    .items.filter((h) => h.outcome === "error")
    .slice(0, FAILURES);
  lines.push(...(failures.length ? failures.map((h) => `${iso(h.finishedAt)} ${h.kind} ${h.source}:${h.packageId}${h.toVersion ? ` → ${h.toVersion}` : ""}${h.background ? " (na pozadí)" : ""}: ${h.error ?? "?"}`) : ["–"]));

  section(`Protokol správců (posledních ${LOG_LINES} řádků)`);
  const log = useLogs.getState().entries.slice(-LOG_LINES);
  lines.push(...(log.length ? log.map((e) => `${iso(e.time)} [${e.source}] ${e.level}: ${e.text}`) : ["–"]));

  // Uživatelské jméno se v textech objevuje v cestách k profilu – ty nahradí redact
  return redact(lines.join("\n"), { computer: system?.computerName }) + "\n";
}
