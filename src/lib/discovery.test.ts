import { describe, expect, it } from "vitest";
import type { CatalogEntry, CategoryId } from "@/types";
import { channelOf, channelsOf } from "./channels";
import { fundingLabel, parseFundingYml } from "./funding";
import { becauseYouHave } from "./recommendations";

const app = (id: string, category: CategoryId, popularity: number, extra: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({ id, name: id, categories: [category], tags: [], popularity, sources: [], ...extra }) as unknown as CatalogEntry;
const winget = (id: string, packageId: string, latestVersion = "1.0") =>
  ({ ...app(id, "productivity", 1), latestVersion, sources: [{ source: "winget", packageId, version: latestVersion }] }) as unknown as CatalogEntry;

describe("doporučeno pro vás", () => {
  const all = [
    app("obs", "multimedia", 90, { tags: ["streaming"] }),
    app("vlc", "multimedia", 95),
    app("streamlabs", "multimedia", 40, { tags: ["streaming"] }),
    app("handbrake", "multimedia", 60),
    app("audacity", "multimedia", 70),
    app("shotcut", "multimedia", 50),
    app("driver", "system", 99),
    app("libre", "productivity", 80),
  ];

  it("police podle kategorie, podobné dřív, bez nainstalovaných a odmítnutých", () => {
    const installed = new Set(["obs", "driver"]);
    const shelves = becauseYouHave([all[0], all[6]], all, (e) => installed.has(e.id) || e.id === "audacity");
    expect(shelves).toHaveLength(1);
    expect(shelves[0].seed.id).toBe("obs");
    // Stejný štítek (streamování) první, pak popularita; audacity uživatel kdysi odinstaloval
    expect(shelves[0].items.map((e) => e.id)).toEqual(["streamlabs", "vlc", "handbrake", "shotcut"]);
  });

  it("málo kandidátů = žádná police; kategorie jen jednou", () => {
    expect(becauseYouHave([all[7]], all, () => false)).toEqual([]);
    const shelves = becauseYouHave([all[0], all[1]], all, (e) => e.id === "obs" || e.id === "vlc");
    expect(shelves.map((s) => s.seed.id)).toEqual(["obs"]);
  });
});

describe("kanály (beta)", () => {
  const code = winget("vscode", "Microsoft.VisualStudioCode", "1.106");
  const insiders = winget("vscode-insiders", "Microsoft.VisualStudioCode.Insiders", "1.107");
  const discord = winget("discord", "Discord.Discord");
  const canary = winget("discord-canary", "Discord.Discord.Canary");
  const ptb = winget("discord-ptb", "Discord.Discord.PTB");
  const orphan = winget("tofu-alpha", "OpenTofu.Tofu.Alpha");
  const all = [code, insiders, discord, canary, ptb, orphan];

  it("pozná kanál podle přípony id", () => {
    expect(channelOf("Discord.Discord.PTB")).toBe("ptb");
    expect(channelOf("Mozilla.Firefox")).toBeNull();
    expect(channelOf("Some.Developer.Tool")).toBeNull();
  });

  it("stabilní nabízí předběžné verze, předběžná vede zpět", () => {
    expect(channelsOf(discord, all)?.variants.map((v) => v.channel)).toEqual(["ptb", "canary"]);
    const back = channelsOf(insiders, all);
    expect(back?.channel).toBe("insiders");
    expect(back?.stable?.id).toBe("vscode");
    // Předběžná verze bez stabilní v katalogu – nic
    expect(channelsOf(orphan, all)).toBeNull();
    expect(channelsOf(winget("x", "X.Y"), all)).toBeNull();
  });
});

describe("podpořit vývojáře (FUNDING.yml)", () => {
  it("platformy, seznamy, vlastní adresy a komentáře", () => {
    const links = parseFundingYml(
      [
        "# These are supported funding model platforms",
        "github: [obsproject, someone] # komentář",
        "patreon: obsproject",
        "open_collective: obsproject",
        "ko_fi: # nevyplněno",
        "custom:",
        "  - https://www.paypal.me/obs",
        "  - 'javascript:alert(1)'",
      ].join("\n"),
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://github.com/sponsors/obsproject",
      "https://github.com/sponsors/someone",
      "https://www.patreon.com/obsproject",
      "https://opencollective.com/obsproject",
      "https://www.paypal.me/obs",
    ]);
    expect(fundingLabel(links[0])).toBe("GitHub Sponsors");
    expect(fundingLabel(links[4])).toBe("paypal.me");
  });
});
