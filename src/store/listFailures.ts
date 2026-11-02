/**
 * Správci, kteří při posledním načtení nevrátili seznam nainstalovaných aplikací
 * (services/managers – getAllInstalled). Stránka Nainstalované podle toho upozorní,
 * že seznam není úplný – jinak by vypadalo, že jejich aplikace nainstalované nejsou.
 */
import { create } from "zustand";
import type { SourceId } from "@/types";

export const useListFailures = create<{ sources: SourceId[] }>(() => ({ sources: [] }));
