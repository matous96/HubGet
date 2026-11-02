/**
 * Listování v kartách sekce „Dnes“ (šipky ‹ › na kartách) – posun každé karty
 * o „dny“ v pořadí výběru (lib/today.ts). Pamatuje si ho do zavření HubGetu,
 * aby návrat z detailu aplikace ukázal stejné karty; s novým dnem začíná od nuly.
 */
import { create } from "zustand";
import { dayIndex } from "@/data/editorial";
import { NO_SHIFT, type TodayShift } from "@/lib/today";
import { useIconQuality } from "@/store/iconQuality";

/** Karty, které jde listovat (aplikace dne je jedna na celý den). */
export type TodaySlot = "story" | "collection0" | "collection1";

interface TodayPagerState {
  /** Den, ke kterému posun patří. */
  day: number;
  shift: TodayShift;
  move: (slot: TodaySlot, by: number) => void;
}

export const useTodayPager = create<TodayPagerState>()((set, get) => ({
  day: dayIndex(),
  shift: NO_SHIFT,
  move: (slot, by) => {
    const today = dayIndex();
    const { story, collections } = get().day === today ? get().shift : NO_SHIFT;
    const shift: TodayShift =
      slot === "story"
        ? { story: story + by, collections }
        : { story, collections: slot === "collection0" ? [collections[0] + by, collections[1]] : [collections[0], collections[1] + by] };
    set({ day: today, shift });
  },
}));

/** Posun pro dnešek (posun z minulého dne už neplatí). */
export const useTodayShift = () => useTodayPager((s) => (s.day === dayIndex() ? s.shift : NO_SHIFT));

const FIRST_DAY_KEY = "unibox-first-day";

/**
 * Je dnes první den po instalaci? Sekce Dnes pak ukazuje ručně psaný obsah
 * s přibalenými ikonami (lib/today.ts – firstRun). Den se zapíše při prvním
 * dotazu; dřívější instalace (už mají změřené ikony) první den nemají.
 */
export function isFirstDay(): boolean {
  try {
    let saved = localStorage.getItem(FIRST_DAY_KEY);
    if (saved === null) {
      saved = String(Object.keys(useIconQuality.getState().sizes).length ? 0 : dayIndex());
      localStorage.setItem(FIRST_DAY_KEY, saved);
    }
    return Number(saved) === dayIndex();
  } catch {
    return false;
  }
}
