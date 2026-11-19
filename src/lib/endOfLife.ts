/**
 * Konec podpory (end of life) nainstalovaných runtime a nástrojů podle otevřené databáze
 * endoflife.date (zdarma, bez klíče; API povoluje dotazy z prohlížeče). Balíček wingetu
 * se převede na produkt a vývojovou řadu („Python.Python.3.9“ → python 3.9) a z databáze
 * se zjistí, do kdy řada dostává bezpečnostní opravy.
 */

export interface EolCycle {
  cycle: string;
  /** Konec podpory: datum (YYYY-MM-DD), nebo false = zatím neurčen. */
  eol: string | boolean;
  latest?: string;
  lts?: boolean | string;
}

export interface EolMatch {
  product: string;
  /** Název produktu pro texty („Python“, „Node.js“). */
  label: string;
  cycle: string;
}

interface Rule {
  test: RegExp;
  product: string;
  label: string;
  /** Řada z id balíčku (skupiny regulárního výrazu) a nainstalované verze. */
  cycle: (match: RegExpMatchArray, version: string) => string | null;
}

const major = (version: string) => /^(\d+)/.exec(version)?.[1] ?? null;
const majorMinor = (version: string) => /^(\d+\.\d+)/.exec(version)?.[1] ?? null;

const RULES: Rule[] = [
  { test: /^Python\.Python\.3\.(\d+)$/i, product: "python", label: "Python", cycle: (m) => `3.${m[1]}` },
  { test: /^OpenJS\.NodeJS(\.LTS)?$/i, product: "nodejs", label: "Node.js", cycle: (_, v) => major(v) },
  {
    test: /^Microsoft\.DotNet\.(?:Runtime|SDK|DesktopRuntime|AspNetCore|HostingBundle)\.(\d+)(?:_(\d+))?$/i,
    product: "dotnet",
    label: ".NET",
    cycle: (m) => (m[2] ? `${m[1]}.${m[2]}` : m[1]),
  },
  { test: /^EclipseAdoptium\.Temurin\.(\d+)\.(?:JDK|JRE)/i, product: "eclipse-temurin", label: "Java (Temurin)", cycle: (m) => m[1] },
  { test: /^Microsoft\.OpenJDK\.(\d+)$/i, product: "microsoft-build-of-openjdk", label: "Microsoft OpenJDK", cycle: (m) => m[1] },
  { test: /^Oracle\.JDK\.(\d+)$/i, product: "oracle-jdk", label: "Java (Oracle JDK)", cycle: (m) => m[1] },
  { test: /^PostgreSQL\.PostgreSQL\.(\d+)$/i, product: "postgresql", label: "PostgreSQL", cycle: (m) => m[1] },
  { test: /^GoLang\.Go(?:\.\d+(?:\.\d+)?)?$/i, product: "go", label: "Go", cycle: (_, v) => majorMinor(v) },
  { test: /^PHP\.PHP\.(\d+\.\d+)$/i, product: "php", label: "PHP", cycle: (m) => m[1] },
  { test: /^Microsoft\.PowerShell$/i, product: "powershell", label: "PowerShell", cycle: (_, v) => majorMinor(v) },
  { test: /^Oracle\.MySQL$/i, product: "mysql", label: "MySQL", cycle: (_, v) => majorMinor(v) },
  { test: /^RubyInstallerTeam\.Ruby(?:WithDevKit)?\.(\d+\.\d+)$/i, product: "ruby", label: "Ruby", cycle: (m) => m[1] },
];

/** Produkt a řada pro balíček wingetu, null = endoflife.date ho nesleduje. */
export function eolMatch(packageId: string, version: string): EolMatch | null {
  for (const rule of RULES) {
    const match = packageId.match(rule.test);
    if (!match) continue;
    const cycle = rule.cycle(match, version);
    return cycle ? { product: rule.product, label: rule.label, cycle } : null;
  }
  return null;
}

/** Datum konce podpory řady, pokud už nastal (YYYY-MM-DD), jinak null. */
export function endedOn(cycles: EolCycle[] | undefined, cycle: string, today = new Date()): string | null {
  const found = cycles?.find((c) => c.cycle === cycle);
  if (!found || typeof found.eol !== "string") return null;
  return Date.parse(found.eol) <= today.getTime() ? found.eol : null;
}

/** Nejnovější řada s podporou (doporučení, na co přejít). */
export function newestSupported(cycles: EolCycle[] | undefined, today = new Date()): EolCycle | null {
  return cycles?.find((c) => c.eol === false || (typeof c.eol === "string" && Date.parse(c.eol) > today.getTime())) ?? null;
}

export async function fetchCycles(product: string): Promise<EolCycle[]> {
  const response = await fetch(`https://endoflife.date/api/${encodeURIComponent(product)}.json`);
  if (!response.ok) throw new Error(`endoflife.date ${response.status}`);
  return (await response.json()) as EolCycle[];
}
