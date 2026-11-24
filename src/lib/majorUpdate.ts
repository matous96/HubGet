/**
 * Významná (velká) aktualizace – jako „Události“ v App Storu: nabízená verze má vyšší hlavní
 * číslo verze než nainstalovaná (OBS 32 → 33, GIMP 2.10 → 3.0, 7-Zip 25 → 26). Na Domů má
 * vlastní karty (components/home/MajorUpdates), v seznamu aktualizací a v detailu štítek.
 *
 * Verze ve tvaru data nebo čísla sestavení („2026.11.20“, „20261120“) se nepočítají – první
 * číslo se jim mění každý rok, o novou hlavní verzi nejde.
 */

/** První číslo verze („v33.0.1“ → 33); null = verze nezačíná číslem. */
export function majorOf(version: string): number | null {
  const match = /^v?(\d+)(?=[.\-_+ ]|$)/i.exec(version.trim());
  return match ? Number(match[1]) : null;
}

/** Je aktualizace z `from` na `to` nová hlavní verze? */
export function isMajorUpdate(from: string | null | undefined, to: string | null | undefined): boolean {
  if (!from || !to) return false;
  const current = majorOf(from);
  const next = majorOf(to);
  if (current === null || next === null) return false;
  // Rok nebo sestavení místo verze
  if (current >= 1000 || next >= 1000) return false;
  return next > current;
}

/** První věta poznámek k vydání pro kartu (bez odrážek a nadpisů Markdownu), nejvýš `max` znaků. */
export function notesTeaser(notes: string | null | undefined, max = 160): string | null {
  if (!notes) return null;
  const text = notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#+|[-*•]|\d+\.)\s*/, "").trim())
    .filter((line) => line && !/^(what'?s new|changelog|release notes|novinky)[:\s]*$/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const sentence = /^(.{20,}?[.!?])\s/.exec(text)?.[1] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}
