/**
 * Nedávno aktualizované aplikace (Nainstalované → Dostupné aktualizace, sekce pod seznamem
 * jako v App Storu): úspěšné aktualizace z historie operací za posledních RECENT_DAYS dní,
 * u každé aplikace jen ta poslední, od nejnovější.
 */
import type { HistoryEntry } from "@/store/history";
import type { InstalledPackage } from "@/types";

export const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

export function recentUpdates(history: readonly HistoryEntry[], now = Date.now(), days = RECENT_DAYS): HistoryEntry[] {
  const since = now - days * DAY_MS;
  const seen = new Set<string>();
  return history
    .filter((h) => h.kind === "update" && h.outcome === "success" && Date.parse(h.finishedAt) >= since)
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .filter((h) => !seen.has(h.appId) && !!seen.add(h.appId));
}

/**
 * Co ukázat v „Nedávno aktualizováno“: jen aplikace, které jsou pořád nainstalované a nečeká je
 * další aktualizace – ta je v seznamu dostupných aktualizací nahoře a aplikace nemá být dvakrát.
 * Po její aktualizaci se aplikace do této sekce vrátí.
 */
export function visibleRecentUpdates(
  history: readonly HistoryEntry[],
  installed: ReadonlyMap<string, Pick<InstalledPackage, "availableVersion">>,
  now = Date.now(),
): HistoryEntry[] {
  return recentUpdates(history, now).filter((h) => {
    const pkg = installed.get(h.appId);
    return !!pkg && !pkg.availableVersion;
  });
}

/**
 * Den aktualizace jako v App Storu: „Dnes“, „Včera“, „Předevčírem“ / „před 3 dny“ (do týdne),
 * pak datum. Podle kalendářních dnů, ne po 24 hodinách.
 */
export function dayLabel(iso: string, locale: string, now = new Date()): string {
  const date = new Date(iso);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(date)) / DAY_MS);
  if (days >= 0 && days < 7) {
    const text = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  }
  return date.toLocaleDateString(locale, { day: "numeric", month: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
