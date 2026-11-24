/**
 * Kanály aplikace (jako TestFlight): předběžné verze ve WinGetu jsou samostatné balíčky
 * s příponou id – „Microsoft.VisualStudioCode.Insiders“, „Discord.Discord.Canary“,
 * „voidtools.Everything.Beta“. Detail stabilní aplikace nabídne vyzkoušet předběžné verze,
 * detail předběžné verze odkáže zpátky na stabilní (components/package/ChannelLinks).
 * Předběžná verze se instaluje vedle stabilní (vlastní balíček), stabilní zůstane.
 */
import type { CatalogEntry } from "@/types";

/** Přípona id balíčku → kanál (malými písmeny, klíč překladu channels.*). */
const SUFFIX = /\.(beta|preview|insiders|dev|canary|nightly|ptb|alpha|rc|eap)$/i;

export type Channel = "beta" | "preview" | "insiders" | "dev" | "canary" | "nightly" | "ptb" | "alpha" | "rc" | "eap";

/** Pořadí kanálů od nejstabilnějšího. */
const ORDER: Channel[] = ["rc", "beta", "preview", "insiders", "ptb", "eap", "dev", "alpha", "canary", "nightly"];

/** Kanál balíčku podle id („Discord.Discord.PTB“ → ptb); null = stabilní. */
export function channelOf(packageId: string): Channel | null {
  return (SUFFIX.exec(packageId)?.[1].toLowerCase() as Channel | undefined) ?? null;
}

export interface ChannelVariant {
  channel: Channel;
  entry: CatalogEntry;
}

export interface Channels {
  /** Stabilní verze (u předběžné verze); u stabilní null. */
  stable: CatalogEntry | null;
  /** Kanál této aplikace (null = stabilní). */
  channel: Channel | null;
  /** Předběžné verze téže aplikace (bez té, na kterou se díváme). */
  variants: ChannelVariant[];
}

const wingetId = (entry: CatalogEntry) => entry.sources.find((s) => s.source === "winget")?.packageId ?? null;

/** Rejstřík: stabilní id ve WinGetu (malými) → stabilní aplikace a předběžné verze. */
const indexes = new WeakMap<readonly CatalogEntry[], Map<string, { stable?: CatalogEntry; variants: ChannelVariant[] }>>();

function channelIndex(all: readonly CatalogEntry[]) {
  let index = indexes.get(all);
  if (index) return index;
  index = new Map();
  for (const entry of all) {
    const id = wingetId(entry);
    if (!id) continue;
    const channel = channelOf(id);
    const base = id.replace(SUFFIX, "").toLowerCase();
    const group = index.get(base) ?? { variants: [] };
    if (channel) group.variants.push({ channel, entry });
    else group.stable = entry;
    index.set(base, group);
  }
  for (const group of index.values()) group.variants.sort((a, b) => ORDER.indexOf(a.channel) - ORDER.indexOf(b.channel));
  indexes.set(all, index);
  return index;
}

/** Kanály aplikace; null = žádné předběžné verze (ani stabilní k předběžné). */
export function channelsOf(entry: CatalogEntry, all: readonly CatalogEntry[]): Channels | null {
  const id = wingetId(entry);
  if (!id) return null;
  const group = channelIndex(all).get(id.replace(SUFFIX, "").toLowerCase());
  if (!group) return null;
  const channel = channelOf(id);
  const variants = group.variants.filter((v) => v.entry.id !== entry.id);
  // Předběžná verze bez stabilní v katalogu („OpenTofu.Tofu.Alpha“ bez OpenTofu.Tofu) – nic nenabízet
  const stable = channel ? (group.stable ?? null) : null;
  if (!variants.length && !stable) return null;
  return { stable, channel, variants };
}
