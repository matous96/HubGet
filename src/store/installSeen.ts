/**
 * Kdy HubGet poprvé uviděl nainstalovaný balíček – řazení Nově nainstalované
 * v Nainstalovaných (useInstallOrder).
 *
 * Datum ve Windows (záznam v registru) samo nestačí: aplikace, které se
 * aktualizují samy (Edge, Brave, Copilot), ho při každé aktualizaci přepíšou.
 * Balíček, který tu HubGet už viděl, se proto za nový nepočítá, ať ho aktualizuje
 * cokoli; nově objevený dostane datum z Windows (installedAt), jinak čas, kdy se
 * objevil. První výpis každého správce se zapamatuje jako výchozí stav (vše staré)
 * – instalace z doby předtím ukáže jen historie operací HubGetu.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { installedNameKey } from "@/lib/nameKey";
import type { InstalledPackage, SourceId } from "@/types";

/**
 * Klíč balíčku, který aktualizace nezmění: id MSIX bez verze
 * („MSIX\5319275A.WhatsAppDesktop_2.2641.101.0_x64__cv1g…“), záznam v registru podle
 * názvu (MSI mění GUID s verzí), program na disku podle složky – stejný i po převodu
 * rozbaleného programu na id wingetu (withPortablePackages).
 */
export function seenKey(p: InstalledPackage): string {
  if (p.diskLocation) return `disk:${p.diskLocation.toLowerCase()}`;
  const id = p.packageId.toLowerCase();
  if (id.startsWith("msix\\")) return `${p.source}:${id.replace(/^(msix\\[^_]+)_[^_]*_/, "$1_")}`;
  if (id.startsWith("arp\\")) return `${p.source}:arp:${installedNameKey(p.name)}`;
  return `${p.source}:${id}`;
}

interface InstallSeenState {
  /** Správci, jejichž výchozí stav už je zapamatovaný (od kdy). */
  sources: Partial<Record<SourceId, number>>;
  /** Klíč balíčku → kdy byl nainstalován (0 = byl tu už při prvním výpisu). */
  seen: Record<string, number>;
  /** Zapamatuje balíčky z nového výpisu nainstalovaných. */
  observe: (list: InstalledPackage[]) => void;
}

export const useInstallSeen = create<InstallSeenState>()(
  persist(
    (set, get) => ({
      sources: {},
      seen: {},
      observe: (list) => {
        const { sources, seen } = get();
        const now = Date.now();
        const nextSources = { ...sources };
        let next: Record<string, number> | null = null;
        for (const p of list) {
          const key = seenKey(p);
          if (key in seen || (next && key in next)) continue;
          // První výpis správce (i po jeho dřívějším selhání) = výchozí stav
          nextSources[p.source] ??= now;
          const since = nextSources[p.source]!;
          next ??= { ...seen };
          next[key] = since === now ? 0 : p.installedAt && p.installedAt >= since ? p.installedAt : now;
        }
        if (next) set({ sources: nextSources, seen: next });
      },
    }),
    {
      name: "unibox-install-seen",
      // Verze 1: klíče MSIX bez verze a záznamy z registru podle názvu – výchozí stav znovu
      version: 1,
      migrate: () => ({ sources: {}, seen: {} }),
    },
  ),
);
