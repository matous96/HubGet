/**
 * Počet hvězdiček repozitáře na GitHubu (open-source aplikace).
 *
 * Repozitář se pozná z odkazů aplikace (zdrojový kód, web, hlášení chyb).
 * Počet je ve dvou podobách:
 *  - v katalogu (`githubStars`, doplní data pipeline z deps.dev nebo GitHubu) – karty,
 *  - živě z GitHub API v detailu aplikace, s mezipamětí na 24 hodin
 *    v localStorage (karty pak ukazují i čerstvější číslo).
 * GitHub API bez přihlášení povolí 60 požadavků za hodinu – po vyčerpání se
 * do jeho obnovy (hlavička x-ratelimit-reset) nezkouší a zůstane poslední
 * známé číslo.
 */
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/app/queryClient";
import { githubRepoOf } from "@/lib/github";
import type { CatalogEntry } from "@/types";

export { githubRepoOf };

const CACHE_KEY = "unibox-github-stars";
/** Do kdy GitHub API neodpovídá (vyčerpaný limit) – sdílí hvězdičky i poznámky k vydáním. */
export const BLOCKED_KEY = "unibox-github-blocked-until";
const TTL = 24 * 3600_000;
const MAX_CACHED = 2000;

interface Cached {
  /** null = repozitář neexistuje (smazaný, soukromý). */
  stars: number | null;
  at: number;
}

let cache: Record<string, Cached> | null = null;

function readCache(): Record<string, Cached> {
  if (!cache) {
    try {
      cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, Cached>;
    } catch {
      cache = {};
    }
  }
  return cache;
}

function remember(repo: string, stars: number | null) {
  const all = readCache();
  delete all[repo]; // nový záznam na konec – nejstarší se zahazují první
  all[repo] = { stars, at: Date.now() };
  const keys = Object.keys(all);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHED))) delete all[key];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* plné úložiště – číslo se příště stáhne znovu */
  }
}

/** Poslední známý počet (i starší než 24 h), bez požadavku na síť. */
export function cachedGithubStars(repo: string): number | null | undefined {
  return readCache()[repo]?.stars;
}

/** Aktuální počet hvězdiček z GitHub API (z mezipaměti, je-li mladší než 24 h). */
export async function fetchGithubStars(repo: string): Promise<number | null> {
  const cached = readCache()[repo];
  if (cached && Date.now() - cached.at < TTL) return cached.stars;
  // Vyčerpaný limit požadavků – do jeho obnovy jen poslední známé číslo
  if (Date.now() < Number(localStorage.getItem(BLOCKED_KEY) ?? 0)) return cached?.stars ?? null;

  const response = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) {
    remember(repo, null);
    return null;
  }
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    localStorage.setItem(BLOCKED_KEY, String(reset > Date.now() ? reset : Date.now() + 3600_000));
    return cached?.stars ?? null;
  }
  if (!response.ok) throw new Error(`GitHub API: ${response.status}`);
  const stars = ((await response.json()) as { stargazers_count?: number }).stargazers_count ?? null;
  remember(repo, stars);
  return stars;
}

/** Známý počet hvězdiček bez požadavku na síť: mezipaměť z detailu, jinak katalog (karty). */
export function knownGithubStars(entry: CatalogEntry): number | null {
  const repo = githubRepoOf(entry);
  if (!repo) return null;
  const cached = cachedGithubStars(repo);
  return cached !== undefined ? cached : (entry.githubStars ?? null);
}

/**
 * Hvězdičky aplikace na GitHubu. `live` = stáhnout aktuální počet (detail),
 * jinak jen z katalogu a mezipaměti (karty – stovky karet by vyčerpaly limit API).
 */
export function useGithubStars(entry: CatalogEntry, live = false): { repo: string | null; stars: number | null } {
  const repo = githubRepoOf(entry);
  const { data } = useQuery({
    queryKey: queryKeys.githubStars(repo ?? ""),
    queryFn: () => fetchGithubStars(repo!),
    enabled: live && !!repo,
    staleTime: TTL,
    retry: false,
  });
  if (!repo) return { repo, stars: null };
  const known = data !== undefined ? data : cachedGithubStars(repo);
  return { repo, stars: known !== undefined ? known : (entry.githubStars ?? null) };
}
