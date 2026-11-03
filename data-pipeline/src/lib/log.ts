/** Jednoduchý výpis průběhu pipeline s časem od startu. */
const start = Date.now();

const elapsed = () => `${((Date.now() - start) / 1000).toFixed(1).padStart(6)} s`;

/** Řádky výpisu (bez průběhu smyček) pro veřejný výpis z běhu – lib/report.ts. */
export const logLines: string[] = [];

function print(line: string, record: boolean, warn = false) {
  (warn ? console.warn : console.log)(line);
  if (record) logLines.push(line.trim());
}

export const log = {
  step: (text: string) => print(`\n${elapsed()}  ▸ ${text}`, true),
  info: (text: string) => print(`${elapsed()}    ${text}`, true),
  warn: (text: string) => print(`${elapsed()}  ! ${text}`, true, true),
};

/** Průběh dlouhé smyčky – vypíše se nejvýš každých pár sekund (do výpisu z běhu nepatří). */
export function progress(label: string, total: number) {
  let done = 0;
  let last = 0;
  return () => {
    done++;
    const now = Date.now();
    if (now - last > 3000 || done === total) {
      last = now;
      print(`${elapsed()}    ${label}: ${done} / ${total}`, false);
    }
  };
}
