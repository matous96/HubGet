/**
 * Firemní zásady z registru (zásady skupiny, Intune – backend org_policy.rs, šablona ADMX
 * ve složce policies/). Načtou se jednou při startu a hned se promítnou do nastavení:
 * povolení správci, režim Vývojář, vlastní argumenty a příkazy, automatické aktualizace,
 * minimální stáří aktualizací, přihlášení a aktualizace HubGetu. Zamčená nastavení
 * Nastavení ukáže jako „Spravuje vaše organizace“. Instalace mimo povolené zdroje
 * a aplikace odmítne i backend.
 */
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauri } from "@/lib/tauri";
import type { SourceId } from "@/types";

export interface OrgPolicy {
  managed: boolean;
  /** Povolení správci (id zdrojů malými písmeny); null = všichni. */
  allowedSources: string[] | null;
  /** Povolené aplikace (id balíčku nebo „zdroj:id“, malými písmeny); null = všechny. */
  allowedApps: string[] | null;
  disableDeveloperMode: boolean;
  disableCustomCommands: boolean;
  disableSignIn: boolean;
  forceAutomaticUpdates: boolean;
  minimumUpdateAgeDays: number | null;
  disableSelfUpdate: boolean;
}

export const NO_POLICY: OrgPolicy = {
  managed: false,
  allowedSources: null,
  allowedApps: null,
  disableDeveloperMode: false,
  disableCustomCommands: false,
  disableSignIn: false,
  forceAutomaticUpdates: false,
  minimumUpdateAgeDays: null,
  disableSelfUpdate: false,
};

export const useOrgPolicy = create<OrgPolicy>(() => NO_POLICY);

/** Správce smí používat (povolené zdroje, režim Vývojář). */
export function sourceAllowed(source: SourceId, policy: OrgPolicy = useOrgPolicy.getState()) {
  return !policy.allowedSources || policy.allowedSources.includes(source);
}

/** Aplikaci smí nainstalovat (schválené aplikace). */
export function appAllowed(source: SourceId, packageId: string, policy: OrgPolicy = useOrgPolicy.getState()) {
  if (!policy.allowedApps) return true;
  const id = packageId.toLowerCase();
  return policy.allowedApps.includes(id) || policy.allowedApps.includes(`${source}:${id}`);
}

/** Načte zásady (jednou při startu). Promítnutí do nastavení: hooks/useOrgPolicySync.ts. */
let loading: Promise<OrgPolicy> | null = null;
export const loadOrgPolicy = () =>
  (loading ??= isTauri()
    ? invoke<OrgPolicy>("get_org_policy").then(
        (policy) => {
          useOrgPolicy.setState(policy, true);
          return policy;
        },
        () => NO_POLICY,
      )
    : Promise.resolve(NO_POLICY));
