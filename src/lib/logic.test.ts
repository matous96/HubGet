// Čisté funkce napříč aplikací: alternativy, odhad průběhu, plán úloh, verze, odkazy, exporty
import { describe, expect, it } from "vitest";
import { roundRemaining } from "@/hooks/useJobPercent";
import { appAllowed, NO_POLICY, sourceAllowed } from "@/store/orgPolicy";
import { problemShare, reliabilityKey, reliabilityWarning } from "@/store/reliability";
import type { CatalogEntry, InstalledPackage } from "@/types";
import { isClosed, licenseKind, openSourceAlternatives } from "./alternatives";
import { decodeBundle, encodeBundle } from "./bundleShare";
import { deepLinkToPath } from "./deepLink";
import { estimatePercent, overallPercent } from "./phaseEstimate";
import { buildWingetConfiguration, isStoreId } from "./profile";
import { dueTime, nextTime } from "./schedule";
import { compareVersions } from "./version";

const entry = (id: string, over: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({ id, name: id, publisher: "", description: "", categories: ["productivity"], tags: [], iconUrl: null, homepage: null, license: "MIT", latestVersion: "1.0", popularity: 0, addedAt: "2026-01-01", sources: [], ...over }) as CatalogEntry;

describe("open-source alternativy", () => {
  it("druh licence", () => {
    expect(licenseKind("Proprietary")).toBe("licenseProprietary");
    expect(licenseKind("Freeware")).toBe("licenseFree");
    expect(licenseKind("GPL-3.0-or-later")).toBe("licenseOpen");
    expect(licenseKind("GNU General Public License")).toBe("licenseOpen");
    expect(licenseKind(null)).toBeNull();
  });

  it("hry náhradu nehledají", () => {
    expect(isClosed(entry("steam", { license: "Proprietary", categories: ["games"] }))).toBe(false);
    expect(isClosed(entry("word", { license: "Proprietary" }))).toBe(true);
  });

  it("náhrada ze stejné kategorie se společnými štítky, kurátorská první", () => {
    const closed = entry("acrobat", { license: "Proprietary", tags: ["pdf", "reader", "viewer"], alternatives: ["sumatra"] } as Partial<CatalogEntry>);
    const sumatra = entry("sumatra", { license: "GPL-3.0", tags: ["ebook"] });
    const okular = entry("okular", { license: "GPL-2.0", tags: ["pdf", "viewer"], popularity: 5 });
    const unrelated = entry("gimp", { license: "GPL-3.0", tags: ["image", "viewer"], categories: ["graphics"] });
    const closedToo = entry("foxit", { license: "Freeware", tags: ["pdf", "reader", "viewer"] });
    const catalog = [closed, sumatra, okular, unrelated, closedToo];
    const byId = new Map(catalog.map((e) => [e.id, e]));
    expect(openSourceAlternatives(closed, catalog, byId).map((e) => e.id)).toEqual(["sumatra", "okular"]);
  });
});

describe("průběh a zbývající čas", () => {
  it("jedno procento za stahování a instalaci", () => {
    expect(overallPercent("downloading", 50, 0.4)).toBe(20);
    expect(overallPercent("installing", 0, 0.4)).toBe(40);
    expect(overallPercent("installing", 100, 0.4)).toBe(99);
  });

  it("odhad roste a 100 % nedosáhne", () => {
    expect(estimatePercent(0, 10_000)).toBe(0);
    expect(estimatePercent(10_000, 10_000)).toBe(85);
    expect(estimatePercent(1e9, 10_000)).toBe(99);
  });

  it("zaokrouhlení zbývajícího času", () => {
    expect(roundRemaining(1_000)).toEqual({ seconds: 5 });
    expect(roundRemaining(42_000)).toEqual({ seconds: 45 });
    expect(roundRemaining(61_000)).toEqual({ minutes: 2 });
  });
});

describe("plán úloh", () => {
  const now = new Date(2026, 10, 20, 12, 0).getTime(); // pátek 20. 11. 2026 12:00
  it("interval od posledního spuštění", () => {
    expect(dueTime({ repeat: "interval", intervalMs: 3_600_000 }, null, now)).toBe(now);
    expect(dueTime({ repeat: "interval", intervalMs: 3_600_000 }, now - 1_000, now)).toBeNull();
  });
  it("denně v čas a ve vybrané dny", () => {
    const daily = { repeat: "daily" as const, time: "10:00", days: [] };
    expect(dueTime(daily, null, now)).toBe(new Date(2026, 10, 20, 10, 0).getTime());
    expect(dueTime(daily, new Date(2026, 10, 20, 10, 5).getTime(), now)).toBeNull();
    expect(nextTime(daily, null, now)).toBe(new Date(2026, 10, 21, 10, 0).getTime());
    // Jen v pondělí: příště 23. 11.
    expect(nextTime({ repeat: "days", time: "10:00", days: [1] }, null, now)).toBe(new Date(2026, 10, 23, 10, 0).getTime());
  });
});

describe("verze, odkazy, sdílení", () => {
  it("porovnání verzí", () => {
    expect(compareVersions("0.1.11", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.2-beta", "1.3")).toBeLessThan(0);
  });

  it("odkazy unibox:// a hubget://", () => {
    expect(deepLinkToPath("unibox://app/videolan-vlc")).toBe("/app/videolan-vlc");
    expect(deepLinkToPath("hubget://app/videolan-vlc")).toBe("/app/videolan-vlc");
    expect(deepLinkToPath("https://example.com")).toBeNull();
  });

  it("sada v odkazu tam a zpět (i diakritika)", () => {
    const items = [{ appId: "videolan-vlc", name: "Přehrávač VLC", source: "winget" as const, packageId: "VideoLAN.VLC", version: "3.0.21" }];
    const back = decodeBundle(encodeBundle("Nový počítač", items));
    expect(back.name).toBe("Nový počítač");
    expect(back.packages).toEqual(items);
  });

  it("export pro winget configure", () => {
    expect(isStoreId("9NKSQGP7F2NH")).toBe(true);
    expect(isStoreId("VideoLAN.VLC")).toBe(false);
    const { yaml, count } = buildWingetConfiguration(
      [
        { source: "winget", packageId: "VideoLAN.VLC", name: "VLC" },
        { source: "winget", packageId: "9NKSQGP7F2NH", name: "WhatsApp" },
        { source: "scoop", packageId: "extras/vlc", name: "VLC (Scoop)" },
      ],
      "Nový počítač",
    );
    expect(count).toBe(2);
    expect(yaml).toContain('id: "VideoLAN.VLC"');
    expect(yaml).toContain("source: msstore");
    expect(yaml).not.toContain("extras/vlc");
  });
});

describe("firemní zásady a spolehlivost verzí", () => {
  it("povolené zdroje a schválené aplikace", () => {
    const policy = { ...NO_POLICY, managed: true, allowedSources: ["winget"], allowedApps: ["videolan.vlc", "scoop:extras/vlc"] };
    expect(sourceAllowed("winget", policy)).toBe(true);
    expect(sourceAllowed("scoop", policy)).toBe(false);
    expect(appAllowed("winget", "VideoLAN.VLC", policy)).toBe(true);
    expect(appAllowed("scoop", "extras/vlc", policy)).toBe(true);
    expect(appAllowed("winget", "Mozilla.Firefox", policy)).toBe(false);
    expect(appAllowed("winget", "Mozilla.Firefox", NO_POLICY)).toBe(true);
  });

  it("varování od 10 % problémů", () => {
    const pkg = { source: "winget", packageId: "X.Y", availableVersion: "2.0" } as InstalledPackage;
    const key = reliabilityKey("winget", "X.Y", "2.0");
    expect(problemShare({ reports: 20, failed: 1, rolledBack: 3 })).toBe(0.2);
    expect(reliabilityWarning({ [key]: { reports: 20, failed: 1, rolledBack: 1 } }, pkg)).toBeTruthy();
    expect(reliabilityWarning({ [key]: { reports: 20, failed: 1, rolledBack: 0 } }, pkg)).toBeUndefined();
    expect(reliabilityWarning({}, pkg)).toBeUndefined();
  });
});

describe("Čím otevřu tento soubor", async () => {
  const { appsForExtension, countForExtension, extensionOf, extensionQuery } = await import("./openWith");
  it("přípona z názvu, cesty i samotného textu", () => {
    expect(extensionOf(".PSD")).toBe("psd");
    expect(extensionOf("fotka.Final.psd")).toBe("psd");
    expect(extensionOf(String.raw`C:\Videa.2026\film 2.MKV`)).toBe("mkv");
    expect(extensionOf(String.raw`C:\Videa.2026\film`)).toBeNull();
    expect(extensionOf("psd")).toBe("psd");
    expect(extensionOf("photoshop")).toBeNull();
    expect(extensionOf("soubor.")).toBeNull();
    expect(extensionQuery(".epub")).toBe("epub");
    expect(extensionQuery("epub")).toBeNull();
  });
  it("nainstalované první, pak specializované, pak popularita", () => {
    const sevenZip = entry("7zip", { popularity: 100, fileExtensions: Array.from({ length: 40 }, (_, i) => (i ? `x${i}` : "zip")) });
    const nano = entry("nanozip", { popularity: 1, fileExtensions: ["zip"] });
    const peazip = entry("peazip", { popularity: 50, fileExtensions: ["zip", "rar"] });
    const catalog = [sevenZip, nano, peazip, entry("other")];
    expect(appsForExtension(catalog, "zip", new Set()).map((e) => e.id)).toEqual(["peazip", "nanozip", "7zip"]);
    expect(appsForExtension(catalog, "ZIP", new Set(["7zip"])).map((e) => e.id)[0]).toBe("7zip");
    expect(countForExtension(catalog, "rar")).toBe(1);
    expect(countForExtension(catalog, "psd")).toBe(0);
  });
});

describe("místo na disku", async () => {
  const { requiredSpace, RESERVE_BYTES, shortageOf } = await import("./diskSpace");
  const MB = 1024 * 1024;
  const catalog = {
    catalog: { packages: [{ id: "big", sources: [{ source: "winget", packageId: "Big.App", version: "1", size: 100 * MB, installedSize: 900 * MB }] }, { id: "small", sources: [{ source: "winget", packageId: "Small.App", version: "1", size: 10 * MB }] }] },
  } as never;
  it("instalátor + rozbalená aplikace + rezerva", () => {
    expect(requiredSpace({ appId: "big", source: "winget", packageId: "Big.App" }, catalog)).toBe(1000 * MB + RESERVE_BYTES);
    // Bez velikosti po instalaci trojnásobek instalátoru
    expect(requiredSpace({ appId: "small", source: "winget", packageId: "Small.App" }, catalog)).toBe(40 * MB + RESERVE_BYTES);
    expect(requiredSpace({ appId: "neznama", source: "winget", packageId: "X" }, catalog)).toBe(RESERVE_BYTES);
  });
  it("nedostatek jen když místo opravdu chybí (a je známé)", () => {
    expect(shortageOf({ drive: "C:", free: 300 * MB, total: 1 }, 600 * MB)).toEqual({ drive: "C:", free: 300 * MB, needed: 600 * MB });
    expect(shortageOf({ drive: "C:", free: 900 * MB, total: 1 }, 600 * MB)).toBeNull();
    expect(shortageOf(null, 600 * MB)).toBeNull();
  });
});

describe("co je nového mezi verzemi", async () => {
  const { plainNotes, releasesBetween, versionOfTag } = await import("@/services/githubReleases");
  const release = (tag: string, over: Record<string, unknown> = {}) => ({ tag_name: tag, name: null, body: `Notes ${tag}`, html_url: `https://github.com/x/y/releases/${tag}`, published_at: null, draft: false, prerelease: false, ...over });
  it("verze ze značky", () => {
    expect(versionOfTag("v1.2.3")).toBe("1.2.3");
    expect(versionOfTag("release-2024.10")).toBe("2024.10");
    expect(versionOfTag("VLC-3.0.21")).toBe("3.0.21");
    expect(versionOfTag("nightly")).toBeNull();
  });
  it("jen vydání mezi nainstalovanou a nabízenou verzí, od nejnovějšího", () => {
    const releases = [release("v1.0.0"), release("v1.1.0"), release("v1.2.0-beta", { prerelease: true }), release("v1.2.0"), release("v1.3.0"), release("v2.0.0", { draft: true })];
    expect(releasesBetween(releases, "1.0.0", "1.3.0").map((n) => n.version)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
    expect(releasesBetween(releases, "1.3.0", "1.3.0")).toEqual([]);
  });
  it("Markdown na prostý text", () => {
    expect(plainNotes("## Changes\n- Fixed [bug](https://x) in **parser**\n<!-- skryté -->\n![obr](a.png)`kód`")).toBe("Changes\n• Fixed bug in parser\n\nkód");
  });
});

describe("diagnostika bez osobních údajů", async () => {
  const { redact } = await import("./diagnostics");
  it("cesty k profilu, e-maily a jméno počítače", () => {
    const text = String.raw`Chyba v C:\Users\Jan Novák\AppData\Local\x.log; kontakt jan@example.cz; počítač DESKTOP-JAN`;
    expect(redact(text, { computer: "DESKTOP-JAN" })).toBe(String.raw`Chyba v %USERPROFILE%\AppData\Local\x.log; kontakt <e-mail>; počítač <počítač>`);
  });
});

describe("podpora Windows", async () => {
  const { supportState, windowsCycle } = await import("./windowsSupport");
  const cycles = [
    { cycle: "11-26h2-e", eol: "2029-10-09", latest: "10.0.26300" },
    { cycle: "11-26h2-w", eol: "2028-10-10", latest: "10.0.26300" },
    { cycle: "11-24h2-e-lts", eol: "2029-10-09", latest: "10.0.26100" },
    { cycle: "11-24h2-e", eol: "2027-10-12", latest: "10.0.26100" },
    { cycle: "11-24h2-w", eol: "2026-10-13", latest: "10.0.26100" },
    { cycle: "10-22h2", eol: "2025-10-14", latest: "10.0.19045" },
  ];
  it("řada podle sestavení a edice", () => {
    expect(windowsCycle(cycles, "Windows 11 Pro", 26300)?.cycle).toBe("11-26h2-w");
    expect(windowsCycle(cycles, "Windows 11 Enterprise", 26100)?.cycle).toBe("11-24h2-e");
    expect(windowsCycle(cycles, "Windows 11 Enterprise LTSC", 26100)?.cycle).toBe("11-24h2-e-lts");
    expect(windowsCycle(cycles, "Windows 10 Home", 19045)?.cycle).toBe("10-22h2");
    expect(windowsCycle(cycles, "Windows 11 Pro", 99999)).toBeNull();
  });
  it("stav podpory", () => {
    const today = new Date("2026-11-20");
    expect(supportState(cycles[1], today).state).toBe("ok");
    expect(supportState(cycles[4], today).state).toBe("ended");
    expect(supportState({ cycle: "x", eol: "2027-01-10" }, today).state).toBe("ending");
    expect(supportState({ cycle: "x", eol: false }, today)).toEqual({ state: "ok", until: null });
  });
});

describe("poznámky z GitHubu – upozornění a konce řádků", async () => {
  const { plainNotes } = await import("@/services/githubReleases");
  it("bez značek [!IMPORTANT] a citací", () => {
    expect(plainNotes("> [!IMPORTANT]\r\n> The certificate changed.\r\n\r\n### Fixes\r\n- One")).toBe("The certificate changed.\n\nFixes\n• One");
  });
});
