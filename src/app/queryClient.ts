import { QueryClient } from "@tanstack/react-query";

/**
 * Sdílený klient TanStack Query (cache dat z katalogu a od správců balíčků).
 *
 * networkMode "always": výchozí "online" by po ztrátě připojení dotazy i akce
 * tiše pozastavil – i ty, které síť nepotřebují (nainstalované aplikace, Po
 * spuštění, nastavení), a okno by čekalo bez konce. Takhle se vše spustí;
 * co síť potřebuje, skončí chybou se srozumitelnou hláškou a tlačítkem Zkusit
 * znovu (katalog má vlastní zálohy – mezipaměť, přibalený soubor). Po návratu
 * připojení se zastaralá data načtou znovu (refetchOnReconnect).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
      networkMode: "always",
    },
    mutations: {
      networkMode: "always",
    },
  },
});

/** Klíče dotazů na jednom místě, ať se nepletou. */
export const queryKeys = {
  catalog: ["catalog"] as const,
  installed: ["installed"] as const,
  managerStatus: (source: string) => ["manager-status", source] as const,
  search: (q: string) => ["search", q] as const,
  versions: (source: string, packageId: string) => ["versions", source, packageId] as const,
  ratingSummary: (id: string) => ["rating-summary", id] as const,
  /** Souhrny hodnocení všech aplikací (karty). */
  ratingSummaries: ["rating-summaries"] as const,
  reviews: (id: string) => ["reviews", id] as const,
  /** Vlastní hodnocení – podle uživatele, po přihlášení / odhlášení se načte znovu. */
  myReview: (id: string, userId?: string | null) => ["my-review", id, userId ?? null] as const,
  /** Snímky aplikace od uživatelů – podle uživatele (vlastní čekající vidí jen autor). */
  appScreenshots: (id: string, userId?: string | null) => ["app-screenshots", id, userId ?? null] as const,
  githubStars: (repo: string) => ["github-stars", repo] as const,
  /** Odkazy na podporu vývojáře z FUNDING.yml (services/funding.ts). */
  funding: (repo: string) => ["funding", repo] as const,
  /** Aplikace po spuštění Windows (stránka Po spuštění). */
  startup: ["startup"] as const,
  /** Zaznamenané instalace (sledování instalace). */
  installTraces: ["install-traces"] as const,
};
