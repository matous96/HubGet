/**
 * Nainstalované balíčky spárované s profily z katalogu, dostupné aktualizace
 * a „Aktualizovat vše“. Sdílí je přehled na domovské stránce i stránka Nainstalované.
 */
import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import i18n from "@/i18n";
import { diskSpace, requiredSpace, RESERVE_BYTES, shortageOf } from "@/lib/diskSpace";
import { isTauri } from "@/lib/tauri";
import { formatSizeText } from "@/lib/utils";
import { useAutoUpdates } from "@/store/autoUpdates";
import { useHistory } from "@/store/history";
import { useToasts } from "@/store/toasts";
import { seenKey, useInstallSeen } from "@/store/installSeen";
import { updateOptionsFor } from "@/store/installOptions";
import { useBusyAppIds, useJobs } from "@/store/jobs";
import { useUpdateHolds, versionKey } from "@/store/updateHolds";
import type { CatalogEntry, InstalledPackage, InstallOrigin, SourceId } from "@/types";
import { fallbackEntry, isListedInstalled, nameKey, useInstalled, useInstalledEntries } from "./usePackages";

export interface InstalledItem {
  pkg: InstalledPackage;
  entry: CatalogEntry;
}

/**
 * Řazení Nově nainstalované: nejnovější instalace nahoře. Nejdřív aplikace nainstalované
 * přes HubGet (historie operací – přesný čas) a ty, které se ve výpisu objevily nově
 * (store/installSeen), pak ostatní podle data ve Windows (záznam v registru – aplikace,
 * které se aktualizují samy, ho přepisují, proto až po skutečně nových), nakonec popularita.
 */
export function useInstallOrder(): (items: InstalledItem[]) => InstalledItem[] {
  const history = useHistory((s) => s.items);
  const seen = useInstallSeen((s) => s.seen);
  return useMemo(() => {
    const installs = new Map<string, number>();
    for (const h of history) {
      if (h.outcome === "success" && h.kind === "install") installs.set(h.appId, Math.max(installs.get(h.appId) ?? 0, Date.parse(h.finishedAt)));
    }
    const fresh = (i: InstalledItem) => Math.max(installs.get(i.entry.id) ?? 0, seen[seenKey(i.pkg)] ?? 0);
    return (items) =>
      items
        .map((item) => ({ item, fresh: fresh(item), system: item.pkg.installedAt ?? 0 }))
        .sort((a, b) => b.fresh - a.fresh || b.system - a.system || b.item.entry.popularity - a.item.entry.popularity)
        .map(({ item }) => item);
  }, [history, seen]);
}

/** Původ, u kterého aplikaci HubGet nespravuje (hry ze Steamu, programy mimo správce). */
export const isUnmanagedOrigin = (origin: InstallOrigin) => origin === "steam" || origin === "ea" || origin === "local";

/** Balíček MSIX ve výpisu wingetu („MSIX\Výrobce.Aplikace_verze_…“). */
const isMsix = (p: InstalledPackage) => p.packageId.startsWith("MSIX\\");

export function useInstalledItems() {
  const query = useInstalled();
  // Profil z katalogu podle id balíčku, jinak podle názvu (programy, které winget vidí jen v registru)
  const links = useInstalledEntries();
  const items = useMemo<InstalledItem[]>(() => {
    const seen = new Set<string>();
    const listed = (query.data ?? []).filter((p) => isListedInstalled(p, links));
    // Aplikace s klasickou instalací (registr): balíček MSIX téhož správce se stejným názvem či
    // profilem je jen její doplněk – rozšíření Průzkumníka (WinRAR, Mp3tag), „Core App“ Acrobat
    // Readeru, systémový Edge, webová aplikace Gemini – ne druhá instalace; jinak by aplikace byla
    // v Nainstalovaných dvakrát (doplněk se s katalogem většinou nespáruje a má vlastní kartu)
    const keys = (p: InstalledPackage) => {
      const linked = links.get(p);
      return [`${p.source}:${nameKey(p.name)}`, ...(linked ? [`${p.source}:${linked.id}`, `${p.source}:${nameKey(linked.name)}`] : [])];
    };
    const classic = new Set(listed.filter((p) => !isMsix(p)).flatMap(keys));
    return listed
      .filter((p) => !(isMsix(p) && keys(p).some((key) => classic.has(key))))
      .map((p) => {
        const linked = links.get(p);
        if (linked && !seen.has(linked.id)) {
          seen.add(linked.id);
          return { pkg: p, entry: linked };
        }
        const own = fallbackEntry(p.source, p.packageId, p.name, p.installedVersion);
        if (!linked) return { pkg: p, entry: own };
        // Další instalace téže aplikace jiným správcem (Git přes winget i jako závislost Scoopu):
        // profil z katalogu, ale vlastní id „zdroj:balíček“ jako v useInstalledIndex – jinak by
        // obě karty měly stejný klíč a ukazovaly první instalaci a fronta úloh by druhou přeskočila
        const sources = linked.sources.filter((s) => s.source === p.source);
        return { pkg: p, entry: { ...linked, id: own.id, sources: sources.length ? sources : linked.sources } };
      });
  }, [query.data, links]);
  return { ...query, items };
}

/** Dostupné aktualizace a jejich hromadné spuštění (volitelně jen od jednoho správce). */
export function useUpdates(source?: SourceId) {
  const { items, isLoading } = useInstalledItems();
  const busy = useBusyAppIds();
  const enqueue = useJobs((s) => s.enqueue);
  const updatable = useMemo(
    () => items.filter((i) => i.pkg.availableVersion && (!source || i.pkg.source === source)),
    [items, source],
  );
  // Aktualizace, které ještě nečekají ve frontě
  const pending = updatable.filter((i) => !busy.has(i.entry.id));
  const running = updatable.length - pending.length;

  /**
   * Zařadí do fronty aktualizace (výchozí všechny čekající), každou přes správce, kterým byla
   * aplikace nainstalována. S nastavením „bod obnovení“ (aspoň 2 aplikace) nejdřív vytvoří bod
   * obnovení systému.
   */
  const updateItems = async (chosen: InstalledItem[]) => {
    const batch = chosen.filter((i) => !busy.has(i.entry.id));
    if (batch.length >= 2 && isTauri() && useAutoUpdates.getState().restorePoint) {
      const { push } = useToasts.getState();
      push("info", i18n.t("autoUpdates.restorePointCreating"));
      const result = await invoke<string>("create_restore_point", { description: i18n.t("autoUpdates.restorePointName", { count: batch.length }) }).catch(
        () => "failed",
      );
      push(result === "created" || result === "recent" ? "success" : "info", i18n.t(`autoUpdates.restorePoint_${result}`));
    }
    // Hromadná aktualizace: když místo na disku nebude stačit na všechny, říct to předem
    // (každá operace se před spuštěním zkontroluje i sama – lib/diskSpace.ts)
    if (batch.length >= 2 && isTauri()) {
      const needed = batch.reduce((sum, { pkg, entry }) => sum + requiredSpace({ appId: entry.id, source: pkg.source, packageId: pkg.packageId }) - RESERVE_BYTES, RESERVE_BYTES);
      const lack = shortageOf(await diskSpace(), needed);
      if (lack) {
        const size = (bytes: number) => formatSizeText(bytes, i18n.language);
        useToasts.getState().push("info", i18n.t("disk.batchShortage", { drive: lack.drive, free: size(lack.free), needed: size(lack.needed) }), { record: true });
      }
    }
    for (const { pkg, entry } of batch) {
      enqueue({
        appId: entry.id,
        appName: entry.name,
        source: pkg.source,
        packageId: pkg.packageId,
        kind: "update",
        options: updateOptionsFor(entry.id, pkg, entry),
      });
    }
  };

  const updateAll = () => updateItems(pending);

  return { updatable, pending: pending.length, running, updateAll, updateItems, isLoading };
}

/**
 * Aktualizace, které automatické aktualizace odložily, protože potřebují práva správce
 * (na pozadí bez dialogu UAC) – „Čeká na potvrzení“ v Dostupných aktualizacích.
 */
export function useAdminPendingUpdates() {
  const { updatable } = useUpdates();
  const held = useUpdateHolds((s) => s.needsAdmin);
  return useMemo(() => updatable.filter(({ pkg }) => held[versionKey(pkg, pkg.availableVersion!)]), [updatable, held]);
}
