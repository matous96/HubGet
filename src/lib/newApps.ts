/** Nově v katalogu (pages/NewPage.tsx): výběr podle data přidání do katalogu. */
const DAY_MS = 24 * 60 * 60_000;

/** Aplikace přidané do katalogu za posledních `days` dní, od nejnovější (bez data se vynechají). */
export function newInCatalog<T extends { addedAt?: string }>(packages: readonly T[], days: number, now = Date.now()): T[] {
  const since = now - days * DAY_MS;
  return packages
    .filter((p) => p.addedAt && Date.parse(p.addedAt) >= since)
    .sort((a, b) => Date.parse(b.addedAt!) - Date.parse(a.addedAt!));
}
