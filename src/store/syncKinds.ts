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
import { parseBundleFile, useBundle, type BundleItem } from "./bundle";
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
    if (oneOf<SortMode>(map.sortMode, ["popularity", "name", "recent"])) s.setSortMode(map.sortMode);
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

const NOTIFICATION_FLAGS = ["enabled", "batchSummary", "updatesAvailable", "progress", "failure", "success"] as const;

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

export const SYNC_KIND_LIST: SyncKind[] = [favoritesKind, bundleKind, settingsKind, notificationsKind];
