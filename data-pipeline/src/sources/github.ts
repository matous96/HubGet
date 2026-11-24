/**
 * Údaje o repozitářích na GitHubu pro katalog: hvězdičky (pole `githubStars`) a u GraphQL
 * i archivace a poslední změna (`archived`, `lastCommit` – opuštěné aplikace v HubGetu)
 * a odkazy na podporu vývojáře z FUNDING.yml (`funding` – Podpořit vývojáře v detailu).
 *
 * Dva zdroje:
 *  - s tokenem (proměnná prostředí GITHUB_TOKEN, osobní token bez oprávnění)
 *    GraphQL API GitHubu – aktuální čísla, archivace a poslední push, až 100 repozitářů
 *    jedním dotazem,
 *  - bez tokenu deps.dev (Google Open Source Insights) – veřejné API bez klíče,
 *    dávky po 500 repozitářích, čísla bývají pár dní stará. Repozitáře, které
 *    deps.dev nezná, zůstanou bez čísla; detail aplikace si ho načte živě sám.
 *
 * Výsledek se ukládá do .cache/github-repos.json a platí MAX_AGE.githubStars.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR, MAX_AGE, USER_AGENT } from "../config.ts";
import { log } from "../lib/log.ts";

const CACHE_FILE = join(CACHE_DIR, "github-repos.json");
const GRAPHQL_BATCH = 100;
const DEPS_DEV_BATCH = 500;
const DEPS_DEV_URL = "https://api.deps.dev/v3alpha/projectbatch";

/** Údaje o repozitáři; archivace a poslední push jen z GraphQL (deps.dev je nezná). */
export interface RepoInfo {
  stars: number;
  archived?: boolean;
  /** Poslední push do repozitáře (ISO). */
  pushedAt?: string;
  /** Odkazy na podporu vývojáře (FUNDING.yml) – platforma malými písmeny a adresa. */
  funding?: { platform: string; url: string }[];
}

interface StarsCache {
  fetchedAt: number;
  /** owner/repo → údaje; null = repozitář neexistuje, je soukromý nebo ho zdroj nezná. */
  stars: Record<string, RepoInfo | null>;
}

async function readCache(): Promise<StarsCache> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as StarsCache;
  } catch {
    return { fetchedAt: 0, stars: {} };
  }
}

/** Jména pro GraphQL: owner/repo do řetězcového literálu (jen bezpečné znaky). */
const literal = (value: string) => JSON.stringify(value);

async function queryGraphql(token: string, repos: string[]): Promise<Record<string, RepoInfo | null>> {
  const fields = repos
    .map((repo, i) => {
      const [owner, name] = repo.split("/");
      return `r${i}: repository(owner: ${literal(owner)}, name: ${literal(name)}) { stargazerCount isArchived pushedAt fundingLinks { platform url } }`;
    })
    .join("\n");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ query: `query {\n${fields}\n}` }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL: HTTP ${response.status}`);
  // Neexistující repozitář vrátí null a chybu NOT_FOUND – zbytek dávky platí
  const body = (await response.json()) as {
    data?: Record<string, { stargazerCount: number; isArchived: boolean; pushedAt: string | null; fundingLinks?: { platform: string; url: string }[] } | null>;
  };
  if (!body.data) throw new Error("GitHub GraphQL: odpověď bez dat");
  return Object.fromEntries(
    repos.map((repo, i) => {
      const r = body.data![`r${i}`];
      const funding = (r?.fundingLinks ?? []).map((link) => ({ platform: link.platform.toLowerCase(), url: link.url }));
      return [repo, r ? { stars: r.stargazerCount, archived: r.isArchived, ...(r.pushedAt ? { pushedAt: r.pushedAt } : {}), ...(funding.length ? { funding } : {}) } : null];
    }),
  );
}

interface DepsDevBatch {
  responses?: { request: { projectKey: { id: string } }; project?: { starsCount?: number } }[];
  nextPageToken?: string;
}

async function queryDepsDev(repos: string[]): Promise<Record<string, RepoInfo | null>> {
  const result: Record<string, RepoInfo | null> = Object.fromEntries(repos.map((repo) => [repo, null]));
  const requests = repos.map((repo) => ({ projectKey: { id: `github.com/${repo}` } }));
  // Velkou odpověď deps.dev stránkuje – stejný dotaz se pošle znovu s pageToken
  let pageToken: string | undefined;
  do {
    const response = await fetch(DEPS_DEV_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ requests, pageToken }),
    });
    if (!response.ok) throw new Error(`deps.dev: HTTP ${response.status}`);
    const body = (await response.json()) as DepsDevBatch;
    for (const item of body.responses ?? []) {
      const repo = item.request.projectKey.id.replace(/^github\.com\//, "");
      if (repo in result) result[repo] = item.project?.starsCount !== undefined ? { stars: item.project.starsCount } : null;
    }
    pageToken = body.nextPageToken || undefined;
  } while (pageToken);
  return result;
}

/** Údaje o zadaných repozitářích (owner/repo malými písmeny). */
export async function loadGithubRepos(repos: string[]): Promise<Map<string, RepoInfo | null>> {
  const cache = await readCache();
  const fresh = Date.now() - cache.fetchedAt < MAX_AGE.githubStars;
  const missing = fresh ? repos.filter((repo) => !(repo in cache.stars)) : repos;
  const token = process.env.GITHUB_TOKEN;

  if (missing.length) {
    const source = token ? "GitHub" : "deps.dev";
    const batchSize = token ? GRAPHQL_BATCH : DEPS_DEV_BATCH;
    const query = token ? (batch: string[]) => queryGraphql(token, batch) : queryDepsDev;
    if (!token) log.info(`GitHub: bez GITHUB_TOKEN – hvězdičky z deps.dev (${missing.length} repozitářů)`);

    const result: Record<string, RepoInfo | null> = fresh ? { ...cache.stars } : {};
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      try {
        Object.assign(result, await query(batch));
      } catch (error) {
        // Repozitáře z nepovedené dávky zůstanou mimo mezipaměť – příští běh je zkusí znovu
        log.warn(`${source}: dávka ${i / batchSize + 1} selhala – ${(error as Error).message}`);
      }
      log.info(`${source}: ${Math.min(i + batchSize, missing.length)} / ${missing.length}`);
    }
    cache.stars = result;
    cache.fetchedAt = fresh ? cache.fetchedAt : Date.now();
    await writeFile(CACHE_FILE, JSON.stringify(cache));
  }
  return new Map(repos.filter((repo) => repo in cache.stars).map((repo) => [repo, cache.stars[repo]]));
}
