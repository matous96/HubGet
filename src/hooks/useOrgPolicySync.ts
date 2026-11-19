/**
 * Promítnutí firemních zásad (store/orgPolicy.ts) do nastavení: po startu a po každé
 * změně nastavení – volba, kterou zásady nedovolují, se hned vrátí (zamčené prvky
 * v Nastavení ukazují, proč). Přihlášený uživatel se zásadou „bez přihlášení“ se odhlásí.
 */
import { useEffect } from "react";
import { SOURCE_IDS } from "@/services/managers/sources";
import { useAuth } from "@/store/auth";
import { useAutoUpdates } from "@/store/autoUpdates";
import { loadOrgPolicy, sourceAllowed, type OrgPolicy } from "@/store/orgPolicy";
import { useSecurity } from "@/store/security";
import { useSettings } from "@/store/settings";

function enforceSettings(policy: OrgPolicy) {
  const s = useSettings.getState();
  const patch: Partial<ReturnType<typeof useSettings.getState>> = {};
  if (policy.allowedSources) {
    const enabled = s.enabledSources.filter((id) => sourceAllowed(id, policy));
    const fallback = SOURCE_IDS.filter((id) => sourceAllowed(id, policy));
    const next = enabled.length ? enabled : fallback;
    if (next.length && next.length !== s.enabledSources.length) patch.enabledSources = next;
    if (next.length && !next.includes(s.preferredSource)) patch.preferredSource = next[0];
  }
  if (policy.disableDeveloperMode && s.userMode === "developer") patch.userMode = "regular";
  if (Object.keys(patch).length) useSettings.setState(patch);
}

function enforceSecurity(policy: OrgPolicy) {
  const s = useSecurity.getState();
  if (policy.disableCustomCommands && (s.allowCustomArgs || s.allowPrePostCommands || s.allowImportCustomArgs || s.allowImportPrePostCommands)) {
    s.set({ allowCustomArgs: false, allowPrePostCommands: false, allowImportCustomArgs: false, allowImportPrePostCommands: false });
  }
}

function enforceUpdates(policy: OrgPolicy) {
  const a = useAutoUpdates.getState();
  const patch: Parameters<typeof a.set>[0] = {};
  if (policy.forceAutomaticUpdates && (a.autoInstall !== "all" || !a.autoCheck)) Object.assign(patch, { autoInstall: "all", autoCheck: true });
  const days = policy.minimumUpdateAgeDays;
  if (days !== null && (a.minAgeDays !== days || Object.keys(a.minAgeBySource).length)) Object.assign(patch, { minAgeDays: days, minAgeBySource: {} });
  if (Object.keys(patch).length) a.set(patch);
}

export function useOrgPolicySync() {
  useEffect(() => {
    let stop: (() => void)[] = [];
    let cancelled = false;
    void loadOrgPolicy().then((policy) => {
      if (cancelled || !policy.managed) return;
      enforceSettings(policy);
      enforceSecurity(policy);
      enforceUpdates(policy);
      stop = [
        useSettings.subscribe(() => enforceSettings(policy)),
        useSecurity.subscribe(() => enforceSecurity(policy)),
        useAutoUpdates.subscribe(() => enforceUpdates(policy)),
      ];
      if (policy.disableSignIn) {
        const signOut = () => {
          const auth = useAuth.getState();
          if (auth.user) void auth.signOut();
          if (auth.dialogOpen) auth.closeLogin();
        };
        signOut();
        stop.push(useAuth.subscribe(signOut));
      }
    });
    return () => {
      cancelled = true;
      stop.forEach((s) => s());
    };
  }, []);
}
