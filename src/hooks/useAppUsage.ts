/**
 * Nepoužívané aplikace (Nainstalované → Nepoužívané): kdy byla aplikace naposledy
 * spuštěna podle záznamů Windows (backend usage.rs, UserAssist). Za nepoužívanou se
 * považuje spustitelná aplikace (zástupce v nabídce Start nebo záznam spuštění), která
 * neběží, nespouští se po přihlášení a nikdo ji nespustil UNUSED_DAYS dní – u aplikace
 * bez záznamu rozhoduje datum instalace. HubGet ji umí odinstalovat (ne Steam, EA…).
 * Stejný dotaz vrací i velikost aplikací na disku (řazení podle velikosti).
 */
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/lib/tauri";
import { formatRelative, formatSizeText } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import type { CategoryId } from "@/types";
import { isUnmanagedOrigin, type InstalledItem } from "./useInstalledItems";
import { nameKey, useInstalled } from "./usePackages";

/** Po kolika dnech bez spuštění je aplikace nepoužívaná. */
export const UNUSED_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;

interface AppUsage {
  lastUsed: number | null;
  inUse: boolean;
  /** Spouští se po přihlášení. */
  autostart: boolean;
  launchable: boolean;
  /** Velikost na disku podle instalátoru (bajty). */
  size: number | null;
}

export interface UnusedApp {
  item: InstalledItem;
  /** Poslední spuštění (ms), null = žádný záznam. */
  lastUsed: number | null;
  size: number | null;
}

/**
 * Aplikace, které po spuštění pracují na pozadí a ručně se neotevírají (synchronizace cloudu,
 * antivir, VPN, ovladače, tapety) – u nich spouštění s Windows bez ručního otevření nevadí.
 */
const BACKGROUND_CATEGORIES = new Set<CategoryId>(["cloud", "security", "system", "network", "personalization"]);

/** Balíček MSIX s rozšířením kontextové nabídky Průzkumníka (WinRAR, Mp3tag ve Windows 11). */
const SHELL_EXTENSION = /^MSIX\\.*(shellext|contextmenu)/i;

/**
 * Nepoužívané aplikace (nejdéle nespuštěné první), poznámky „Naposledy spuštěno… · 1,2 GB“
 * pro karty, velikosti všech aplikací (řazení podle velikosti) a kolik místa nepoužívané zabírají.
 */
export function useUnusedApps(items: InstalledItem[], enabled: boolean) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  // Aplikace s rozšířením Průzkumníka se používá přes pravé tlačítko, aniž by se spouštěl její program
  const { data: raw } = useInstalled();
  const withShellExtension = useMemo(
    () => new Set((raw ?? []).filter((p) => SHELL_EXTENSION.test(p.packageId)).map((p) => nameKey(p.name))),
    [raw],
  );
  // Údaje se zjistí u všech aplikací (velikost i u her ze Steamu); za nepoužívané se
  // počítají jen ty, které HubGet umí odinstalovat
  const known = useMemo(() => items.filter((i) => !i.pkg.diskLocation), [items]);
  const signature = known.map((i) => `${i.pkg.source}:${i.pkg.packageId}`).join("|");

  const { data, isLoading } = useQuery({
    queryKey: ["app-usage", signature],
    queryFn: () => invoke<AppUsage[]>("app_last_used", { apps: known.map((i) => ({ packageId: i.pkg.packageId, name: i.pkg.name })) }),
    enabled: enabled && isTauri() && known.length > 0,
    staleTime: 10 * 60_000,
  });

  return useMemo(() => {
    const sizes = new Map<string, number>();
    // Spouštějí se s Windows, ale ručně je nikdo dlouho neotevřel – zbytečně zdržují start
    const idleAutostart: UnusedApp[] = [];
    if (!data || data.length !== known.length) {
      return { unused: [] as UnusedApp[], notes: new Map<string, string>(), sizes, unusedSize: 0, idleAutostart, isLoading };
    }
    const now = Date.now();
    const limit = now - UNUSED_DAYS * DAY_MS;
    const unused: UnusedApp[] = [];
    known.forEach((item, i) => {
      const usage = data[i];
      if (!usage) return;
      if (usage.size) sizes.set(item.entry.id, usage.size);
      const background = item.entry.categories.some((c) => BACKGROUND_CATEGORIES.has(c));
      if (usage.autostart && usage.launchable && !background && (usage.lastUsed === null || usage.lastUsed < limit)) {
        idleAutostart.push({ item, lastUsed: usage.lastUsed, size: usage.size });
      }
      const shellExtension = withShellExtension.has(nameKey(item.pkg.name)) || withShellExtension.has(nameKey(item.entry.name));
      if (isUnmanagedOrigin(item.pkg.origin) || shellExtension || usage.inUse || !usage.launchable) return;
      const old = usage.lastUsed !== null ? usage.lastUsed < limit : item.pkg.installedAt !== undefined && item.pkg.installedAt < limit;
      if (old) unused.push({ item, lastUsed: usage.lastUsed, size: usage.size });
    });
    // Nikdy nespuštěné první, pak od nejdéle nespuštěných
    unused.sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0));
    const notes = new Map(
      unused.map(({ item, lastUsed, size }) => {
        const when =
          lastUsed !== null ? t("unused.lastUsed", { when: formatRelative(new Date(lastUsed).toISOString(), language) }) : t("unused.never");
        return [item.entry.id, size ? `${when} · ${formatSizeText(size, language)}` : when] as const;
      }),
    );
    const unusedSize = unused.reduce((sum, u) => sum + (u.size ?? 0), 0);
    return { unused, notes, sizes, unusedSize, idleAutostart, isLoading };
  }, [data, known, withShellExtension, isLoading, t, language]);
}
