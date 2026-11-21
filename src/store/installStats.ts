/**
 * Žebříček instalací v HubGetu (Nejstahovanější → Nejinstalovanější v HubGetu, Supabase –
 * supabase/migrations/20261121120000_install_reports.sql): dobrovolné anonymní hlášení
 * instalace aplikace z katalogu (Nastavení → Aktualizace balíčků, výchozí vypnuto) a souhrn
 * za 30, 90 nebo 365 dní. Posílá se jen id aplikace z katalogu a náhodné id této instalace
 * HubGetu (store/reliability.ts → communityReporter) – žádný účet, verze ani jiné aplikace.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryClient, queryKeys } from "@/app/queryClient";
import type { LoadedCatalog } from "@/services/catalog";
import type { OperationResult } from "@/services/managers";
import { supabase } from "@/services/supabase";
import type { Job } from "@/types";
import { useAutoUpdates } from "./autoUpdates";
import { communityReporter } from "./reliability";

/** Období žebříčku (ve dnech) – stejná jako ve funkci install_ranking. */
export const INSTALL_PERIODS = [30, 90, 365] as const;
export type InstallPeriod = (typeof INSTALL_PERIODS)[number];

/** Id aplikace v katalogu – stejné pravidlo jako v tabulce install_reports. */
const APP_ID = /^[a-z0-9][a-z0-9._+-]{0,199}$/;

export const installStatsAvailable = () => !!supabase;

/** Mají se instalace hlásit? (Nastavení a Supabase.) */
export const reportsInstalls = () => !!supabase && useAutoUpdates.getState().communityInstalls;

/**
 * Úspěšná instalace aplikace z katalogu (store/jobs.ts). Ne vrácení aktualizace (instalace
 * starší verze), ne balíčky mimo katalog. Chyba odeslání nevadí – hlášení je jen příspěvek.
 */
export function reportInstall(job: Job, result: OperationResult) {
  if (!reportsInstalls() || job.kind !== "install" || result.outcome !== "success" || job.replaceInstalled) return;
  if (!APP_ID.test(job.appId)) return;
  const catalog = queryClient.getQueryData<LoadedCatalog>(queryKeys.catalog);
  if (!catalog?.catalog.packages.some((p) => p.id === job.appId)) return;
  void supabase!.rpc("report_install", { p_app_id: job.appId, p_reporter: communityReporter() }).then(undefined, () => undefined);
}

/** Počty instalací za období: id aplikace → počet (jen aplikace s aspoň 3 hlasy). */
export function useInstallRanking(days: InstallPeriod, enabled: boolean) {
  return useQuery({
    queryKey: ["install-ranking", days],
    queryFn: async () => {
      const { data, error } = await supabase!.rpc("install_ranking", { p_days: days });
      if (error) throw error;
      return new Map(((data ?? []) as { app_id: string; installs: number }[]).map((r) => [r.app_id, r.installs]));
    },
    enabled: enabled && !!supabase,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/**
 * Přírůstek popularity podle skutečných instalací v HubGetu za rok (0–15 bodů, logaritmicky):
 * výchozí popularita z katalogu zvýhodňuje aplikace se stažením z Chocolatey – nové aplikace
 * jen ve WinGetu (winget počty stažení nezveřejňuje) tak dohoní, co lidé opravdu instalují.
 */
export function usePopularityBoost(): (appId: string) => number {
  const { data } = useInstallRanking(365, installStatsAvailable());
  return useCallback(
    (appId: string) => {
      const installs = data?.get(appId);
      return installs ? Math.min(15, Math.round(Math.log10(1 + installs) * 6)) : 0;
    },
    [data],
  );
}
