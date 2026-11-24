/**
 * Odkazy na podporu vývojáře (lib/funding.ts): z katalogu (data pipeline, GraphQL), jinak
 * živě ze souboru FUNDING.yml – v repozitáři (.github/FUNDING.yml, FUNDING.yml), nebo ve
 * výchozím repozitáři „.github“ vlastníka, jak to dělá i GitHub. raw.githubusercontent.com
 * nemá limit API; výsledek platí den.
 */
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/app/queryClient";
import { parseFundingYml } from "@/lib/funding";
import { githubRepoOf } from "@/lib/github";
import type { CatalogEntry, FundingLink } from "@/types";

const TTL = 24 * 3600_000;

async function fetchFunding(repo: string): Promise<FundingLink[]> {
  const owner = repo.split("/")[0];
  const candidates = [
    `https://raw.githubusercontent.com/${repo}/HEAD/.github/FUNDING.yml`,
    `https://raw.githubusercontent.com/${repo}/HEAD/FUNDING.yml`,
    `https://raw.githubusercontent.com/${owner}/.github/HEAD/FUNDING.yml`,
  ];
  for (const url of candidates) {
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) continue;
    const links = parseFundingYml(await response.text());
    if (links.length) return links;
  }
  return [];
}

/** Odkazy na podporu vývojáře aplikace (prázdné = nejsou nebo repozitář není na GitHubu). */
export function useFunding(entry: CatalogEntry): FundingLink[] {
  const repo = githubRepoOf(entry);
  const known = entry.funding?.length ? entry.funding : null;
  const { data } = useQuery({
    queryKey: queryKeys.funding(repo ?? ""),
    queryFn: () => fetchFunding(repo!),
    enabled: !known && !!repo,
    staleTime: TTL,
    retry: false,
  });
  return known ?? data ?? [];
}
