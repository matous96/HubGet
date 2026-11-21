/**
 * Aplikace vybrané k porovnání (stránka Porovnat, /compare) – přidávají se z nabídky
 * aplikace (pravé tlačítko) nebo z lišty hromadného výběru. Nejvýš COMPARE_MAX aplikací.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { COMPARE_MAX } from "@/lib/compare";

interface CompareState {
  /** Id aplikací v katalogu, v pořadí přidání. */
  ids: string[];
  /** Přidá aplikaci, nebo ji z porovnání odebere; „full“ = porovnání je plné. */
  toggle: (id: string) => "added" | "removed" | "full";
  set: (ids: string[]) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useCompare = create<CompareState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (id) => {
        const { ids } = get();
        if (ids.includes(id)) {
          set({ ids: ids.filter((x) => x !== id) });
          return "removed";
        }
        if (ids.length >= COMPARE_MAX) return "full";
        set({ ids: [...ids, id] });
        return "added";
      },
      set: (ids) => set({ ids: [...new Set(ids)].slice(0, COMPARE_MAX) }),
      remove: (id) => set({ ids: get().ids.filter((x) => x !== id) }),
      clear: () => set({ ids: [] }),
    }),
    { name: "unibox-compare" },
  ),
);
