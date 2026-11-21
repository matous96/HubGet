/**
 * Běžící aplikace a operace nad ní (AppInUseDialog):
 *  - před operací: aplikace běží s oknem (nebo se proces našel jen podle
 *    názvu) – fronta úloh se zeptá, jestli ji zavřít, a počká na odpověď,
 *  - po neúspěchu: operace selhala, protože aplikace běží (winget „inUse“ –
 *    např. OBS při aktualizaci) – dialog nabídne aplikaci zavřít a operaci
 *    zopakovat.
 * Jen u operací spuštěných uživatelem – automatické aktualizace na pozadí
 * aplikace s oknem nezavírají. Se zapnutým „Zavírat běžící aplikace bez dotazu“ (výchozí)
 * se dialog před operací neukáže – fronta úloh aplikaci zavře sama (u dotazu na uložení
 * práce počká, až ji zavře uživatel) a po chybě „aplikace běží“ ji zavře a operaci jednou
 * zopakuje; dialog po neúspěchu až potom.
 */
import { create } from "zustand";
import type { RunningProcess } from "@/services/processes";
import type { OperationKind } from "@/types";
import type { EnqueueRequest } from "./jobs";

/** Otázka před operací. */
export interface BeforeOperation {
  appName: string;
  kind: OperationKind;
  processes: RunningProcess[];
}

interface AppInUseState {
  /** Operace, která selhala kvůli běžící aplikaci (nabídka zavřít a zopakovat). */
  request: EnqueueRequest | null;
  /**
   * Soubory aplikace drží jiné programy (winget „inUseByOther“ – virtuální kamera OBS
   * v prohlížeči): dialog nabídne zavřít je, ne aplikaci samotnou.
   */
  otherApps: boolean;
  open: (request: EnqueueRequest, otherApps?: boolean) => void;
  close: () => void;
  /** Otázka před operací (null = žádná). */
  before: BeforeOperation | null;
  resolveBefore: ((proceed: boolean) => void) | null;
  /** Zeptá se před operací; true = pokračovat (aplikace zavřená, nebo uživatel chce pokračovat i tak). */
  ask: (question: BeforeOperation) => Promise<boolean>;
  /** Odpověď z dialogu. */
  answer: (proceed: boolean) => void;
}

export const useAppInUse = create<AppInUseState>()((set, get) => ({
  request: null,
  otherApps: false,
  open: (request, otherApps = false) => set({ request, otherApps }),
  close: () => set({ request: null, otherApps: false }),
  before: null,
  resolveBefore: null,
  ask: (question) =>
    new Promise<boolean>((resolve) => {
      get().resolveBefore?.(false);
      set({ before: question, resolveBefore: resolve });
    }),
  answer: (proceed) => {
    get().resolveBefore?.(proceed);
    set({ before: null, resolveBefore: null });
  },
}));
