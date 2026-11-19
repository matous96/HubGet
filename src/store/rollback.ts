/**
 * Vrácení aktualizace (RollbackDialog): aplikace se po aktualizaci chová špatně –
 * nainstalovat zpět verzi, která byla před ní. Správci downgrade odmítají, proto
 * se nainstalovaná verze nejdřív odinstaluje (Job.replaceInstalled) a vadnou verzi
 * pak automatické aktualizace přeskočí (připnutí „skip“), dokud nevyjde novější.
 */
import { create } from "zustand";
import type { CatalogEntry, SourceId } from "@/types";
import { useUpdateHolds, versionKey } from "./updateHolds";
import { pinKey, useUpdatePins } from "./updatePins";

export interface RollbackRequest {
  entry: CatalogEntry;
  source: SourceId;
  packageId: string;
  /** Verze, na kterou se vrací (byla před aktualizací). */
  toVersion: string;
  /** Nainstalovaná (vadná) verze. */
  currentVersion: string;
}

interface RollbackState {
  request: RollbackRequest | null;
  open: (request: RollbackRequest) => void;
  close: () => void;
}

/**
 * Po úspěšném vrácení (store/jobs.ts): vadnou verzi nenabízet znovu (nabídne se až novější)
 * a nehlídat ji jako „aplikace se vrátila sama“ – to by aplikaci označilo, že se aktualizuje
 * sama, a aktualizace by se jí nenabízely vůbec.
 */
export function skipBadVersion(pkg: { source: SourceId; packageId: string }, version: string, name: string) {
  useUpdatePins.setState((s) => ({
    pins: { ...s.pins, [pinKey(pkg)]: { kind: "skip", version, name, at: new Date().toISOString() } },
  }));
  useUpdateHolds.setState((s) => {
    const watched = { ...s.watched };
    delete watched[versionKey(pkg, version)];
    return { watched };
  });
}

export const useRollbackUi = create<RollbackState>()((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));
