/**
 * Chvíle, kdy uživatel s oknem nepracuje – pro těžkou práci za běhu, která na pár
 * set ms zablokuje hlavní vlákno (nový katalog: parsování 18 MB, indexy nad 25 000
 * aplikacemi, překreslení). Splní se, když je okno skryté (minimalizované, v oznamovací
 * oblasti), nebo když uživatel `quietMs` nehne myší, neťukne do klávesnice ani neposune
 * stránku. Zaseknutí tak nikdy nepřijde pod rukama.
 */
const INPUT_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart"] as const;

export function whenQuiet(quietMs = 4000): Promise<void> {
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, restart, true);
      document.removeEventListener("visibilitychange", onVisibility);
      resolve();
    };
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(done, quietMs);
    };
    const onVisibility = () => {
      if (document.hidden) done();
    };
    for (const type of INPUT_EVENTS) window.addEventListener(type, restart, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    restart();
  });
}
