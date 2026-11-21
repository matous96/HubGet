/**
 * Opuštěné aplikace: nainstalovaná aplikace, která se už nejspíš nevyvíjí – nedostane opravy
 * chyb ani bezpečnostní záplaty (Nainstalované → panel nad seznamem, detail aplikace):
 *  - repozitář na GitHubu je archivovaný (`archived` z data pipeline) – vývoj výslovně skončil,
 *  - na GitHubu se 2 roky nic nezměnilo (`lastCommit`),
 *  - bez GitHubu poslední verze starší 3 let (`releaseDate` z manifestu – mírnější práh,
 *    manifesty nebývají vždy aktuální).
 * Hry se vynechávají – hotová hra se dál nevyvíjet nemusí.
 */
import type { CatalogEntry } from "@/types";

const DAY_MS = 24 * 60 * 60_000;
/** Na GitHubu bez změn – tolik let. */
export const STALE_COMMIT_YEARS = 2;
/** Bez nové verze (jen podle manifestu) – tolik let. */
export const STALE_RELEASE_YEARS = 3;

export type AbandonedReason = { kind: "archived" } | { kind: "noCommits"; since: string } | { kind: "noRelease"; since: string };

/**
 * Knihovny a runtime (Visual C++ Redistributable, DirectX, OpenAL, Microsoft.UI.Xaml…) – stará
 * verze je u nich záměr (programy je potřebují v konkrétní verzi), o podpoře rozhoduje konec
 * podpory (lib/endOfLife.ts), ne datum vydání.
 */
const RUNTIME = /redistributable|runtime|directx|openal|\bxaml\b|framework|vcredist|\bsdk\b|\blibrar(y|ies)\b|\bdriver/i;

export function abandonedReason(entry: CatalogEntry, now = Date.now()): AbandonedReason | null {
  if (entry.categories.includes("games")) return null;
  if (RUNTIME.test(`${entry.name} ${entry.id}`)) return null;
  if (entry.archived) return { kind: "archived" };
  if (entry.lastCommit) {
    const last = Date.parse(entry.lastCommit);
    return last < now - STALE_COMMIT_YEARS * 365 * DAY_MS ? { kind: "noCommits", since: entry.lastCommit } : null;
  }
  if (entry.releaseDate) {
    const released = Date.parse(entry.releaseDate);
    if (released < now - STALE_RELEASE_YEARS * 365 * DAY_MS) return { kind: "noRelease", since: entry.releaseDate };
  }
  return null;
}
