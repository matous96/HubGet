/**
 * Spouštění nainstalovaných aplikací (jen desktopová aplikace).
 *
 * Backend vrátí položky nabídky Start (`start_apps`: název + AppID, bez
 * odkazů na web, dokumentace a odinstalátorů). Tady se k aplikaci najde ta
 * její – podle AppID shodného s id wingetu, jinak podle názvu z katalogu,
 * názvu nainstalovaného balíčku a id wingetu:
 *  1. stejný název („VLC media player“, „Google Chrome (EXE)“ = „Google Chrome“),
 *  2. položka začíná názvem aplikace („OBS Studio“ → „OBS Studio (64bit)“),
 *  3. název aplikace končí názvem položky („Mozilla Thunderbird“ → „Thunderbird“).
 * Když položka podle názvu není, pomůže backend (`launch_info`) – složky programu
 * z registru nebo z disku, jeho EXE a hry ze Steamu:
 *  4. hra ze Steamu → spustí ji Steam,
 *  5. položka nabídky Start, která míří do složky programu (Git → „Git CMD“,
 *     Acrobat Reader → „Adobe Acrobat“),
 *  6. EXE programu s okny (Tor Browser rozbalený na ploše),
 *  7. jinak aspoň složka programu v Průzkumníkovi.
 * Bez toho všeho (knihovny, ovladače bez složky) tlačítko Otevřít není.
 */
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { useInstalled } from "@/hooks/usePackages";
import type { CatalogEntry, InstalledPackage } from "@/types";
import { isTauri } from "./tauri";
import { normalize } from "./utils";

export interface StartApp {
  name: string;
  appId: string;
  /** Spouštěcí soubor (cesta malými písmeny), pokud ho backend určil. */
  target?: string;
}

export const START_APPS_KEY = ["start-apps"] as const;

/** Klíč pro porovnání názvů: bez diakritiky, závorek („(64bit)“, „(x64 cs)“), čísel verzí a interpunkce. */
const nameKey = (name: string) =>
  normalize(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(\.\d+)+\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");

interface StartIndex {
  exact: Map<string, StartApp>;
  keyed: [string, StartApp][];
  /** Podle AppID (malými písmeny). */
  ids: Map<string, StartApp>;
}

// Index se počítá jednou pro každý načtený seznam (sdílí ho všechny karty)
const indexes = new WeakMap<StartApp[], StartIndex>();

function indexOf(apps: StartApp[]): StartIndex {
  let index = indexes.get(apps);
  if (!index) {
    const keyed = apps.map((app) => [nameKey(app.name), app] as [string, StartApp]).filter(([key]) => key);
    const exact = new Map<string, StartApp>();
    for (const [key, app] of keyed) if (!exact.has(key)) exact.set(key, app);
    const ids = new Map(apps.map((app) => [app.appId.toLowerCase(), app]));
    index = { exact, keyed, ids };
    indexes.set(apps, index);
  }
  return index;
}

/** Položka nabídky Start pro aplikaci; undefined = nejde spustit. */
export function findStartApp(apps: StartApp[], names: string[]): StartApp | undefined {
  const { exact, keyed } = indexOf(apps);
  const keys = [...new Set(names.map(nameKey).filter((key) => key.length >= 2))];
  for (const key of keys) {
    const hit = exact.get(key);
    if (hit) return hit;
  }
  // Nejkratší položka, která začíná názvem aplikace / kterou název aplikace končí
  const shortest = (matches: [string, StartApp][]) => matches.sort((a, b) => a[0].length - b[0].length)[0]?.[1];
  for (const key of keys.filter((k) => k.length >= 4)) {
    const hit = shortest(keyed.filter(([start]) => start.startsWith(key)));
    if (hit) return hit;
  }
  for (const key of keys) {
    const hit = shortest(keyed.filter(([start]) => start.length >= 4 && key.endsWith(start)));
    if (hit) return hit;
  }
  return undefined;
}

/** Položky nabídky Start (sdílená cache; obnoví se po instalaci / odinstalaci). */
export function useStartApps() {
  return useQuery({
    queryKey: START_APPS_KEY,
    queryFn: () => invoke<StartApp[]>("start_apps"),
    enabled: isTauri(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Položka nabídky Start pro nainstalovaný balíček. Nejdřív podle AppID –
 * některé aplikace ho mají shodné s id wingetu (EA app: položka „EA“,
 * AppID „ElectronicArts.EADesktop“) – u programu nalezeného jen na disku
 * zástupce do jeho složky (podle názvu, jinak ten s nejkratším názvem) –
 * jinak podle názvů.
 */
export function startAppFor(apps: StartApp[], name: string, installed: InstalledPackage): StartApp | undefined {
  const byId = indexOf(apps).ids.get(installed.packageId.toLowerCase());
  if (byId) return byId;
  if (installed.diskLocation) {
    const inside = `${installed.diskLocation.toLowerCase().replace(/\\+$/, "")}\\`;
    const own = apps.filter((app) => app.target?.startsWith(inside));
    if (own.length) return findStartApp(own, [name, installed.name]) ?? [...own].sort((a, b) => a.name.length - b.name.length)[0];
  }
  const wingetTail = installed.source === "winget" ? installed.packageId.split(".").slice(1).join(" ") : "";
  return findStartApp(apps, [name, installed.name, wingetTail]);
}

/** Co backend ví o programu bez vlastní položky v nabídce Start (apps.rs → launch_info). */
interface LaunchInfo {
  packageId: string;
  /** Složky programu (malými písmeny, bez lomítka na konci). */
  folders: string[];
  /** Program jde spustit přímo (EXE s okny). */
  exe: boolean;
  /** Hra ze Steamu. */
  steam: boolean;
}

/** Jak aplikaci otevřít: položkou nabídky Start, nebo přes backend (EXE, Steam, složka). */
export type LaunchTarget = { kind: "start"; app: StartApp } | { kind: "exe" | "steam" | "folder"; installed: InstalledPackage };

const infoMaps = new WeakMap<LaunchInfo[], Map<string, LaunchInfo>>();

/** Pořadové číslo seznamu nainstalovaných – nový seznam i po pouhém novém výběru (katalog dorazil později). */
const listIds = new WeakMap<InstalledPackage[], number>();
let nextListId = 0;
const listId = (list: InstalledPackage[]) => {
  let id = listIds.get(list);
  if (id === undefined) listIds.set(list, (id = ++nextListId));
  return id;
};

/**
 * Údaje backendu k balíčkům wingetu bez položky v nabídce Start (registr, disk,
 * Steam) podle id; obnoví se s každým seznamem nainstalovaných (i když se jen
 * změní výběr – rozbalený program dostane id wingetu, až dorazí katalog) a nabídky Start.
 */
function useLaunchInfo(): Map<string, LaunchInfo> | undefined {
  const { data: installed } = useInstalled();
  const { data: apps, dataUpdatedAt: appsUpdatedAt } = useStartApps();
  const { data } = useQuery({
    queryKey: ["launch-info", installed ? listId(installed) : 0, appsUpdatedAt],
    queryFn: () =>
      invoke<LaunchInfo[]>("launch_info", {
        packages: (installed ?? [])
          .filter((p) => p.source === "winget" && !startAppFor(apps ?? [], p.name, p))
          .map((p) => ({ packageId: p.packageId, name: p.name, version: p.installedVersion })),
      }),
    enabled: isTauri() && !!installed && !!apps,
    staleTime: Infinity,
  });
  if (!data) return undefined;
  let map = infoMaps.get(data);
  if (!map) {
    map = new Map(data.map((info) => [info.packageId, info]));
    infoMaps.set(data, map);
  }
  return map;
}

/** Jak otevřít nainstalovaný balíček – pořadí v úvodu souboru. */
export function launchTargetFor(
  apps: StartApp[],
  infos: Map<string, LaunchInfo> | undefined,
  name: string,
  installed: InstalledPackage,
): LaunchTarget | undefined {
  const app = startAppFor(apps, name, installed);
  if (app) return { kind: "start", app };
  const info = infos?.get(installed.packageId);
  if (!info) return undefined;
  // Hra ze Steamu před zástupci ve složkách – její odinstalátor je steam.exe a zástupce „Steam“ by hru nespustil
  if (info.steam) return { kind: "steam", installed };
  const own = apps.filter((a) => a.target && info.folders.some((dir) => a.target!.startsWith(`${dir}\\`)));
  if (own.length) {
    const best = findStartApp(own, [name, installed.name]) ?? [...own].sort((a, b) => a.name.length - b.name.length)[0];
    return { kind: "start", app: best };
  }
  if (info.exe) return { kind: "exe", installed };
  if (info.folders.length) return { kind: "folder", installed };
  return undefined;
}

/** Jak spustit nainstalovanou aplikaci (jen v desktopové aplikaci a jen nainstalovanou). */
export function useLaunchTarget(entry: CatalogEntry, installed: InstalledPackage | undefined): LaunchTarget | undefined {
  const { data } = useStartApps();
  const infos = useLaunchInfo();
  if (!data || !installed) return undefined;
  return launchTargetFor(data, infos, entry.name, installed);
}

export const launchApp = (target: LaunchTarget) =>
  target.kind === "start"
    ? invoke<void>("launch_app", { appId: target.app.appId })
    : invoke<void>("launch_installed", {
        package: { packageId: target.installed.packageId, name: target.installed.name, version: target.installed.installedVersion },
        mode: target.kind,
      });
