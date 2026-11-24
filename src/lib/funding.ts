/**
 * Podpořit vývojáře (components/package/FundingButton): odkazy z FUNDING.yml repozitáře na
 * GitHubu – v katalogu z data pipeline (GraphQL fundingLinks), jinak je detail načte živě
 * (services/funding.ts). HubGet z darů nic nebere – odkazy vedou přímo k vývojářům.
 *
 * Formát FUNDING.yml: „platforma: jméno“ nebo „platforma: [jméno, jméno]“, „custom“ je adresa.
 * https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository
 */
import type { FundingLink } from "@/types";

/** Platforma → adresa podle jména účtu (malými písmeny jako GraphQL fundingLinks). */
const PLATFORMS: Record<string, (name: string) => string> = {
  github: (n) => `https://github.com/sponsors/${n}`,
  patreon: (n) => `https://www.patreon.com/${n}`,
  open_collective: (n) => `https://opencollective.com/${n}`,
  ko_fi: (n) => `https://ko-fi.com/${n}`,
  liberapay: (n) => `https://liberapay.com/${n}`,
  buy_me_a_coffee: (n) => `https://www.buymeacoffee.com/${n}`,
  polar: (n) => `https://polar.sh/${n}`,
  thanks_dev: (n) => `https://thanks.dev/${n}`,
  tidelift: (n) => `https://tidelift.com/funding/github/${n}`,
  issuehunt: (n) => `https://issuehunt.io/r/${n}`,
  lfx_crowdfunding: (n) => `https://crowdfunding.lfx.linuxfoundation.org/projects/${n}`,
  community_bridge: (n) => `https://crowdfunding.lfx.linuxfoundation.org/projects/${n}`,
};

/** Název platformy pro tlačítko. */
const LABELS: Record<string, string> = {
  github: "GitHub Sponsors",
  patreon: "Patreon",
  open_collective: "Open Collective",
  ko_fi: "Ko-fi",
  liberapay: "Liberapay",
  buy_me_a_coffee: "Buy Me a Coffee",
  polar: "Polar",
  thanks_dev: "thanks.dev",
  tidelift: "Tidelift",
  issuehunt: "IssueHunt",
  lfx_crowdfunding: "LFX Crowdfunding",
  community_bridge: "LFX Crowdfunding",
};

/** Popisek odkazu: známá platforma, u vlastní adresy jen doména („paypal.me“). */
export function fundingLabel(link: FundingLink): string {
  if (LABELS[link.platform]) return LABELS[link.platform];
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

/** Jen bezpečné adresy (https) – soubor z cizího repozitáře. */
function safeUrl(url: string): string | null {
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(full);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Hodnoty řádku: „jméno“, „[a, b]“, „'jméno'“ (bez komentářů). */
function values(raw: string): string[] {
  const text = raw.replace(/\s+#.*$/, "").trim();
  const list = text.startsWith("[") ? text.replace(/^\[|\]$/g, "").split(",") : [text];
  return list.map((v) => v.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** Odkazy z obsahu FUNDING.yml (víceřádkové seznamy „- jméno“ pod klíčem také). */
export function parseFundingYml(text: string): FundingLink[] {
  const links: FundingLink[] = [];
  let current: string | null = null;
  const add = (platform: string, value: string) => {
    const url = platform === "custom" ? safeUrl(value) : PLATFORMS[platform] && /^[\w.\-/@]+$/.test(value) ? PLATFORMS[platform](value) : null;
    if (url && !links.some((l) => l.url === url)) links.push({ platform, url });
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (item && current) {
      for (const value of values(item[1])) add(current, value);
      continue;
    }
    const pair = /^([a-z_]+)\s*:\s*(.*)$/i.exec(line.trim());
    if (!pair) continue;
    current = pair[1].toLowerCase();
    for (const value of values(pair[2])) add(current, value);
  }
  return links;
}
