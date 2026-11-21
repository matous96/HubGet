/**
 * Vydavatelé instalátorů (digitální podpis Authenticode – signatures.rs): u každé aplikace,
 * kterou HubGet nainstaloval nebo aktualizoval přes winget, kdo podepsal její instalátor.
 * Při další aktualizaci ho backend porovná: instalátor podepsaný někým jiným nebo bez podpisu
 * (dříve podepsaný) se nespustí – podvržený balíček s jiným instalátorem by se tak neprosadil
 * (doplňuje kontrolu SHA-256 z manifestu a změny serveru instalátoru, store/installerUrls.ts).
 * Změnu jde přijmout v detailu aplikace („Důvěřovat novému vydavateli“).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SignerChange {
  /** Dřívější vydavatel. */
  from: string;
  /** Nový („“ = instalátor bez podpisu). */
  to: string;
  /** Verze, kterou HubGet kvůli změně nenainstaloval. */
  version?: string;
  at: string;
}

interface SignersState {
  /** Klíč pinKey („winget:Mozilla.Firefox“) → vydavatel posledního instalátoru („“ = bez podpisu). */
  known: Record<string, string>;
  /** Zastavené instalace kvůli změně vydavatele (klíč pinKey). */
  changed: Record<string, SignerChange>;
  remember: (key: string, signer: string) => void;
  markChanged: (key: string, change: Omit<SignerChange, "at">) => void;
  /** Přijmout nového vydavatele – příští instalace ho bude brát jako známého. */
  trust: (key: string) => void;
}

export const useSigners = create<SignersState>()(
  persist(
    (set, get) => ({
      known: {},
      changed: {},
      remember: (key, signer) => {
        const changed = { ...get().changed };
        delete changed[key];
        set({ known: { ...get().known, [key]: signer }, changed });
      },
      markChanged: (key, change) => set({ changed: { ...get().changed, [key]: { ...change, at: new Date().toISOString() } } }),
      trust: (key) => {
        const change = get().changed[key];
        if (!change) return;
        const changed = { ...get().changed };
        delete changed[key];
        set({ known: { ...get().known, [key]: change.to }, changed });
      },
    }),
    { name: "unibox-signers" },
  ),
);

/** Kontroluje se podpis? Jen winget – instalátor stahuje předem HubGet (operations.rs). */
export const checksSigner = (source: string, kind: string) => source === "winget" && (kind === "install" || kind === "update");
