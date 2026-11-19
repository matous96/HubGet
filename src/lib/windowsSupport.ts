/**
 * Podpora verze Windows (Přehled počítače → Stav Windows): řada z endoflife.date
 * (produkt „windows“, stejná databáze jako u runtime – lib/endOfLife.ts) podle čísla
 * sestavení a edice. Domácí a Pro edice („W“) mají kratší podporu než Enterprise
 * a Education („E“); LTSC a IoT mají vlastní řady.
 */
import type { EolCycle } from "./endOfLife";

export interface WindowsCycle extends EolCycle {
  releaseLabel?: string;
}

/** Řada pro tento počítač podle sestavení („10.0.26100“) a názvu edice, nebo null. */
export function windowsCycle(cycles: WindowsCycle[], osName: string, osBuild: number): WindowsCycle | null {
  const name = osName.toLowerCase();
  const sameBuild = cycles.filter((c) => typeof c.latest === "string" && Number(c.latest.split(".")[2]) === osBuild);
  const lts = /ltsc|ltsb/.test(name);
  const iot = /\biot\b/.test(name);
  const fitting = sameBuild.filter((c) => c.cycle.includes("-lts") === lts && c.cycle.includes("-iot") === iot);
  const enterprise = /enterprise|education/.test(name);
  return (
    fitting.find((c) => c.cycle.endsWith(enterprise ? "-e" : "-w")) ??
    fitting.find((c) => (enterprise ? c.cycle.endsWith("-e-lts") : false)) ??
    // Windows 10 22H2 má jednu řadu pro všechny edice
    fitting.find((c) => !/-(e|w)$/.test(c.cycle)) ??
    null
  );
}

export type SupportState = "ok" | "ending" | "ended";

/** Stav podpory k danému dni: končí do 90 dní = „ending“. */
export function supportState(cycle: WindowsCycle, today = new Date()): { state: SupportState; until: string | null } {
  if (typeof cycle.eol !== "string") return { state: "ok", until: null };
  const left = Date.parse(cycle.eol) - today.getTime();
  return { state: left <= 0 ? "ended" : left < 90 * 86_400_000 ? "ending" : "ok", until: cycle.eol };
}
