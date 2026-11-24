/**
 * Oblasti dat účtu pro synchronizaci (store/sync.ts): jak se úložiště převede
 * na plochý objekt „klíč → hodnota“ (lib/syncMerge.ts) a zpět.
 *
 * Data z účtu se před použitím zkontrolují – neplatné hodnoty se zahodí
 * a položky sady projdou stejnou kontrolou jako import sady ze souboru.
 * Vlastní argumenty a příkazy instalace, bezpečnostní volby, automatické
 * mazání zbytků ani plán automatických aktualizací se nesynchronizují –
 * patří k počítači (přes účet by je šlo podstrčit všem počítačům).
 */
import { LANGUAGES } from "@/i18n";
import { isSourceId, SOURCE_IDS } from "@/services/managers/sources";
import type { SyncKindId } from "@/services/sync";
import type { SyncMap } from "@/lib/syncMerge";
import type { SortMode, SourceId, ThemeSetting, UserMode, ViewMode } from "@/types";
import { MAX_ICON_LENGTH, useAppLooks, type AppLook } from "./appLooks";
import { parseBundleFile, useBundle, type BundleItem } from "./bundle";
import { DEVICE_COMMAND_KINDS, freshDevices, MAX_DEVICE_COMMANDS, useDevices, type DeviceApp, type DeviceCommand, type DeviceCommandApp, type DeviceCommandKind, type DeviceRecord } from "./devices";
import { useFavorites, type FavoriteItem } from "./favorites";
import { useNotificationPrefs, type NotificationPrefs } from "./notificationPrefs";
import { useSettings } from "./settings";

export interface SyncKind {
  id: SyncKindId;
  /** Aktuální stav tady jako plochý objekt. */
  snapshot(): SyncMap;
  /** Zapíše sloučený stav (hodnoty z účtu zkontroluje). */
  apply(map: SyncMap): void;
  /** Změny tady (posluchač dostane volání při každé změně úložiště). */
  subscribe(listener: () => void): () => void;
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === "string" && allowed.includes(value as T);
const isString = (value: unknown): value is string => typeof value === "string";
const sources = (value: unknown): SourceId[] => (Array.isArray(value) ? SOURCE_IDS.filter((id) => value.includes(id)) : []);

// ── Předvolby (vzhled, jazyk, režim, správci) ────────────────────────────

const SETTINGS_KEYS = ["theme", "language", "userMode", "viewMode", "sortMode", "accentColor", "enabledSources", "preferredSource"] as const;

const settingsKind: SyncKind = {
  id: "settings",
  snapshot() {
    const s = useSettings.getState();
    return Object.fromEntries(SETTINGS_KEYS.map((key) => [key, s[key]]));
  },
  apply(map) {
    const s = useSettings.getState();
    if (oneOf<ThemeSetting>(map.theme, ["system", "dark", "light"]) && map.theme !== s.theme) s.setTheme(map.theme);
    if (oneOf(map.language, LANGUAGES.map((l) => l.code)) && map.language !== s.language) s.setLanguage(map.language);
    if (oneOf<UserMode>(map.userMode, ["regular", "developer"])) s.setUserMode(map.userMode);
    if (oneOf<ViewMode>(map.viewMode, ["grid", "list"])) s.setViewMode(map.viewMode);
    if (oneOf<SortMode>(map.sortMode, ["popularity", "name", "recent", "size"])) s.setSortMode(map.sortMode);
    if (map.accentColor === null || isString(map.accentColor)) s.setAccentColor(map.accentColor);
    const enabled = sources(map.enabledSources);
    // Aspoň jeden správce musí zůstat zapnutý
    if (enabled.length) useSettings.setState({ enabledSources: enabled });
    if (isString(map.preferredSource) && isSourceId(map.preferredSource)) s.setPreferredSource(map.preferredSource);
  },
  subscribe: (listener) => useSettings.subscribe(listener),
};

// ── Oblíbené ─────────────────────────────────────────────────────────────

const favoritesKind: SyncKind = {
  id: "favorites",
  snapshot() {
    return Object.fromEntries(useFavorites.getState().items.map(({ appId, ...rest }) => [appId, rest]));
  },
  apply(map) {
    const items: FavoriteItem[] = Object.entries(map).flatMap(([appId, value]) => {
      const v = value as Partial<FavoriteItem> | null;
      return v && isString(v.name) ? [{ appId, name: v.name, version: isString(v.version) ? v.version : "", addedAt: isString(v.addedAt) ? v.addedAt : "" }] : [];
    });
    // Naposledy přidané nahoře (jako při přidávání)
    useFavorites.setState({ items: items.sort((a, b) => b.addedAt.localeCompare(a.addedAt)) });
  },
  subscribe: (listener) => useFavorites.subscribe(listener),
};

// ── Sada balíčků ─────────────────────────────────────────────────────────

const ITEM = "item:";

/**
 * Vlastní argumenty a příkazy před / po instalaci do účtu nepatří – spouštějí
 * se při instalaci a přes účet by je šlo podstrčit všem počítačům. Zůstávají
 * jen v počítači, kde je uživatel zadal.
 */
const PRIVATE_OPTIONS = ["customArgs", "preCommand", "postCommand"] as const;

function shareable(item: BundleItem): BundleItem {
  if (!item.options) return item;
  const options = { ...item.options };
  for (const key of PRIVATE_OPTIONS) delete options[key];
  return Object.keys(options).length ? { ...item, options } : { ...item, options: undefined };
}

const bundleKind: SyncKind = {
  id: "bundle",
  snapshot() {
    const { name, items } = useBundle.getState();
    return { name, ...Object.fromEntries(items.map((item) => [`${ITEM}${item.appId}`, shareable(item)])) };
  },
  apply(map) {
    const raw = Object.entries(map)
      .filter(([key]) => key.startsWith(ITEM))
      .map(([, item]) => item);
    // Stejná kontrola jako u souboru sady: platný zdroj, pročištěné volby instalace
    const packages = parseBundleFile(JSON.stringify({ format: "unibox-bundle", version: 1, name: "", packages: raw })).packages;
    const { items: current, selected } = useBundle.getState();
    // Argumenty a příkazy z účtu nikdy (i s povoleným importem ze sad) – zůstanou jen místní
    const local = new Map(current.map((item) => [item.appId, item]));
    for (let i = 0; i < packages.length; i++) {
      const fromAccount = shareable(packages[i]);
      const mine = local.get(fromAccount.appId)?.options;
      const kept = mine ? Object.fromEntries(PRIVATE_OPTIONS.filter((key) => mine[key] !== undefined).map((key) => [key, mine[key]])) : {};
      packages[i] = Object.keys(kept).length ? { ...fromAccount, options: { ...fromAccount.options, ...kept } } : fromAccount;
    }
    // Pořadí jako tady, nové položky na konec (a vybrané – jako při přidání)
    const position = new Map(current.map((item, i) => [item.appId, i]));
    const items: BundleItem[] = packages.sort((a, b) => (position.get(a.appId) ?? Infinity) - (position.get(b.appId) ?? Infinity));
    const ids = new Set(items.map((i) => i.appId));
    const added = items.filter((i) => !position.has(i.appId)).map((i) => i.appId);
    useBundle.setState({
      name: isString(map.name) ? map.name : "",
      items,
      selected: [...selected.filter((id) => ids.has(id)), ...added],
    });
  },
  subscribe: (listener) => useBundle.subscribe(listener),
};

// ── Předvolby oznámení ───────────────────────────────────────────────────

const NOTIFICATION_FLAGS = ["enabled", "batchSummary", "updatesAvailable", "progress", "failure", "success", "weeklySummary"] as const;

const notificationsKind: SyncKind = {
  id: "notifications",
  snapshot() {
    const p = useNotificationPrefs.getState();
    return { ...Object.fromEntries(NOTIFICATION_FLAGS.map((key) => [key, p[key]])), updatesIgnoredSources: p.updatesIgnoredSources };
  },
  apply(map) {
    const changes: Partial<NotificationPrefs> = {};
    for (const key of NOTIFICATION_FLAGS) if (typeof map[key] === "boolean") changes[key] = map[key];
    if (Array.isArray(map.updatesIgnoredSources)) changes.updatesIgnoredSources = sources(map.updatesIgnoredSources);
    useNotificationPrefs.getState().set(changes);
  },
  subscribe: (listener) => useNotificationPrefs.subscribe(listener),
};

// ── Vlastní vzhled aplikací ──────────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** Ikona z účtu jen jako obrázek uložený HubGetem (data: URL, rozumná velikost) – žádné adresy ven. */
const isIcon = (value: unknown): value is string =>
  isString(value) && /^data:image\/(webp|png);base64,[a-z0-9+/=]+$/i.test(value) && value.length <= MAX_ICON_LENGTH;

const looksKind: SyncKind = {
  id: "looks",
  snapshot() {
    return { ...useAppLooks.getState().looks };
  },
  apply(map) {
    const looks: Record<string, AppLook> = {};
    for (const [appId, value] of Object.entries(map)) {
      const v = value as Partial<AppLook> | null;
      const look: AppLook = {};
      if (isString(v?.color) && HEX_COLOR.test(v.color)) look.color = v.color;
      if (isIcon(v?.icon)) look.icon = v.icon;
      if (look.color || look.icon) looks[appId] = look;
    }
    useAppLooks.setState({ looks });
  },
  subscribe: (listener) => useAppLooks.subscribe(listener),
};

// ── Moje počítače (přehled nainstalovaných aplikací každého počítače) ────

/** Nejvíc aplikací v přehledu jednoho počítače (záznam má v databázi limit velikosti). */
const MAX_DEVICE_APPS = 1500;

const isCommandKind = (k: unknown): k is DeviceCommandKind => DEVICE_COMMAND_KINDS.includes(k as DeviceCommandKind);

/** Aplikace v žádosti o instalaci – krátké texty a známý zdroj. */
function isCommandApp(a: unknown): a is DeviceCommandApp {
  const v = a as Partial<DeviceCommandApp> | null;
  return !!v && isString(v.appId) && v.appId.length <= 300 && isString(v.name) && v.name.length <= 300 && isString(v.source) && isSourceId(v.source) && isString(v.packageId) && v.packageId.length <= 300;
}

function isCommand(c: unknown): c is DeviceCommand {
  const v = c as Partial<DeviceCommand> | null;
  if (!v || !isString(v.id) || v.id.length > 64 || !isString(v.target) || v.target.length > 64 || !isCommandKind(v.kind)) return false;
  if (!isString(v.at) || Number.isNaN(Date.parse(v.at))) return false;
  // Instalace musí nést aplikaci, Aktualizovat tam žádnou
  return v.kind === "install" ? isCommandApp(v.app) : v.app === undefined;
}

function parseDevice(value: unknown): DeviceRecord | null {
  const v = value as Partial<DeviceRecord> | null;
  if (!v || !isString(v.name) || !isString(v.seen) || Number.isNaN(Date.parse(v.seen)) || !Array.isArray(v.apps)) return null;
  const apps = v.apps
    .filter(
      (a): a is DeviceApp =>
        Array.isArray(a) &&
        isSourceId(a[0]) &&
        isString(a[1]) &&
        isString(a[2]) &&
        isString(a[3]) &&
        (a[4] === null || isString(a[4])) &&
        a[1].length <= 300 &&
        a[2].length <= 300,
    )
    .slice(0, MAX_DEVICE_APPS);
  return {
    name: v.name.slice(0, 80),
    seen: v.seen,
    ...(isString(v.os) && { os: v.os.slice(0, 80) }),
    ...(isString(v.version) && { version: v.version.slice(0, 20) }),
    apps,
    // Žádosti pro jiné počítače (Aktualizovat tam, Nainstalovat na…) – jen známé druhy, krátká id
    ...(Array.isArray(v.commands) && { commands: v.commands.filter(isCommand).slice(-MAX_DEVICE_COMMANDS) }),
    ...(Array.isArray(v.accepts) && { accepts: [...new Set(v.accepts.filter(isCommandKind))] }),
  };
}

const devicesKind: SyncKind = {
  id: "devices",
  snapshot() {
    // Počítače, které se dlouho neozvaly, vypadnou (sloučení je smaže i v účtu)
    return { ...freshDevices(useDevices.getState().devices) };
  },
  apply(map) {
    const { deviceId, devices } = useDevices.getState();
    const next: Record<string, DeviceRecord> = {};
    for (const [id, value] of Object.entries(map)) {
      const record = parseDevice(value);
      if (record) next[id] = record;
    }
    // Vlastní záznam vždy podle tohoto počítače
    if (devices[deviceId]) next[deviceId] = devices[deviceId];
    useDevices.setState({ devices: next });
  },
  subscribe: (listener) => useDevices.subscribe(listener),
};

// Vzhled aplikací poslední – je největší a databáze bez migrace ho odmítne; ostatní oblasti se tím nezdrží
export const SYNC_KIND_LIST: SyncKind[] = [favoritesKind, bundleKind, settingsKind, notificationsKind, devicesKind, looksKind];
