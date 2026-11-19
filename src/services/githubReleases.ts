/**
 * Co je nového mezi verzemi: když aktualizace přeskakuje několik verzí, detail aplikace
 * ukáže poznámky ke všem vydáním od nainstalované verze po nabízenou – u aplikací
 * s repozitářem na GitHubu z jejich vydání (api.github.com, bez přihlášení; limit
 * 60 požadavků za hodinu sdílí s hvězdičkami – services/github.ts). Katalog má poznámky
 * jen k nejnovější verzi.
 */
import { useQuery } from "@tanstack/react-query";
import { githubRepoOf } from "@/lib/github";
import { compareVersions } from "@/lib/version";
import type { CatalogEntry, InstalledPackage } from "@/types";
import { BLOCKED_KEY } from "./github";

export interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

export interface ReleaseNote {
  version: string;
  title: string;
  date: string | null;
  body: string;
  url: string;
}

/** Nejvíc vydání najednou (jeden požadavek). */
const PER_PAGE = 50;
/** Text jednoho vydání v detailu (zbytek na GitHubu). */
const MAX_BODY = 1500;

/** Verze z názvu značky: „v1.2.3“, „release-2024.10“, „VLC-3.0.21“ → číslo; jinak null. */
export function versionOfTag(tag: string): string | null {
  const match = tag.match(/(\d+(?:[.-]\d+)+|\d+)/);
  return match ? match[1].replace(/-/g, ".") : null;
}

/**
 * Poznámky z Markdownu na prostý text (nadpisy, odkazy, obrázky, HTML komentáře, citace
 * a upozornění GitHubu „> [!IMPORTANT]“, konce řádků Windows).
 */
export function plainNotes(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim, "")
    .replace(/^>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Vydání mezi nainstalovanou (bez ní) a nabízenou verzí (s ní), od nejnovějšího.
 * Bez konceptů a předběžných verzí; značky bez čísla verze se vynechají.
 */
export function releasesBetween(releases: GithubRelease[], installed: string, available: string): ReleaseNote[] {
  return releases
    .filter((r) => !r.draft && !r.prerelease)
    .flatMap((r) => {
      const version = versionOfTag(r.tag_name);
      if (!version || compareVersions(version, installed) <= 0 || compareVersions(version, available) > 0) return [];
      const body = plainNotes(r.body ?? "");
      return [{ version, title: r.name?.trim() || r.tag_name, date: r.published_at, body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}…` : body, url: r.html_url }];
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}

async function fetchReleases(repo: string): Promise<GithubRelease[]> {
  // Vyčerpaný limit GitHub API – do jeho obnovy nic
  if (Date.now() < Number(localStorage.getItem(BLOCKED_KEY) ?? 0)) return [];
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=${PER_PAGE}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    localStorage.setItem(BLOCKED_KEY, String(reset > Date.now() ? reset : Date.now() + 3600_000));
    return [];
  }
  if (!response.ok) return [];
  return (await response.json()) as GithubRelease[];
}

/**
 * Poznámky k vydáním, které aktualizace přinese – jen když přeskakuje víc než jednu verzi
 * (k jediné stačí Co je nového z katalogu) a aplikace má repozitář na GitHubu.
 */
export function useReleasesBetween(entry: CatalogEntry, installed: InstalledPackage | undefined) {
  const repo = githubRepoOf(entry);
  const from = installed?.installedVersion;
  const to = installed?.availableVersion;
  const query = useQuery({
    queryKey: ["github-releases", repo],
    queryFn: () => fetchReleases(repo!),
    enabled: !!repo && !!from && !!to,
    staleTime: 6 * 3600_000,
    retry: false,
  });
  const notes = query.data && from && to ? releasesBetween(query.data, from, to) : [];
  return { notes, isLoading: query.isLoading && query.fetchStatus !== "idle", repo };
}
