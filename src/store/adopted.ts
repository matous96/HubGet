/**
 * Převzaté programy (Převzít do správy, jako „adopt“ v Homebrew): program nainstalovaný mimo
 * správce balíčků (štítek Lokální – instalátor z webu výrobce), který uživatel převzal pod
 * balíček wingetu z katalogu. HubGet ho pak vede pod id balíčku (usePackages → withAdoptedPackages):
 * nabízí aktualizace podle verze v katalogu a aktualizace = instalace nové verze přes winget
 * (instalátor ji nainstaluje přes starou, program zůstane, kde je); odinstalace a oprava jdou dál
 * přes původní záznam ve Windows (store/jobs.ts → adoptedRequest). Po první aktualizaci přes winget
 * ho winget obvykle pozná sám a převzetí už není potřeba.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { queryClient, queryKeys } from "@/app/queryClient";
import type { InstalledPackage, Job } from "@/types";

export interface Adoption {
  /** Id balíčku wingetu z katalogu („Mozilla.Firefox“). */
  wingetId: string;
  /** Název programu, jak ho vidí Windows (kvůli kontrole a výpisu). */
  name: string;
  at: string;
}

interface AdoptedState {
  /** Klíč = pinKey původního záznamu („winget:ARP\Machine\X64\Mozilla Firefox“). */
  items: Record<string, Adoption>;
  adopt: (key: string, adoption: Omit<Adoption, "at">) => void;
  release: (key: string) => void;
}

export const useAdopted = create<AdoptedState>()(
  persist(
    (set, get) => ({
      items: {},
      adopt: (key, adoption) => set({ items: { ...get().items, [key]: { ...adoption, at: new Date().toISOString() } } }),
      release: (key) => {
        const items = { ...get().items };
        delete items[key];
        set({ items });
      },
    }),
    { name: "unibox-adopted" },
  ),
);

/**
 * Původní id záznamu ve Windows („ARP\…“) převzatého programu k balíčku wingetu (úloha ve frontě,
 * kontrola stavu po operaci) – jen dokud ho winget sám nevidí pod id balíčku (pak už převzetí
 * není potřeba) a dokud je program nainstalovaný.
 */
export function adoptedIdOf(job: Pick<Job, "source" | "packageId">): string | undefined {
  if (job.source !== "winget") return undefined;
  const id = job.packageId.toLowerCase();
  const key = Object.entries(useAdopted.getState().items).find(([, a]) => a.wingetId.toLowerCase() === id)?.[0];
  const arp = key?.slice("winget:".length);
  if (!arp) return undefined;
  const data = queryClient.getQueriesData<InstalledPackage[]>({ queryKey: queryKeys.installed }).flatMap(([, d]) => d ?? []);
  const listed = data.some((p) => p.source === "winget" && p.origin !== "local" && p.packageId.toLowerCase() === id);
  return !listed && data.some((p) => p.source === "winget" && p.packageId === arp) ? arp : undefined;
}
