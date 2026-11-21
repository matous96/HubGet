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

describe("nedávno aktualizováno", async () => {
  const { dayLabel, recentUpdates } = await import("./recentUpdates");
  const now = new Date(2026, 10, 20, 16, 30).getTime();
  const h = (appId: string, finished: Date, over: Record<string, unknown> = {}) =>
    ({ id: `${appId}-${finished.getTime()}`, appId, appName: appId, source: "winget", packageId: appId, kind: "update", outcome: "success", startedAt: finished.toISOString(), finishedAt: finished.toISOString(), ...over }) as never;
  it("jen úspěšné aktualizace za 30 dní, u aplikace poslední, od nejnovější", () => {
    const history = [
      h("vlc", new Date(2026, 10, 20, 9)),
      h("git", new Date(2026, 10, 19, 22)),
      h("vlc", new Date(2026, 10, 10)),
      h("x", new Date(2026, 10, 20, 10), { outcome: "error" }),
      h("y", new Date(2026, 10, 20, 11), { kind: "install" }),
      h("old", new Date(2026, 9, 1)),
    ];
    const out = recentUpdates(history, now) as unknown as { appId: string; finishedAt: string }[];
    expect(out.map((e) => e.appId)).toEqual(["vlc", "git"]);
    expect(out[0].finishedAt).toBe(new Date(2026, 10, 20, 9).toISOString());
  });
  it("den jako v App Storu", () => {
    const today = new Date(2026, 10, 20, 16, 30);
    expect(dayLabel(new Date(2026, 10, 20, 0, 5).toISOString(), "cs", today)).toBe("Dnes");
    expect(dayLabel(new Date(2026, 10, 19, 23, 59).toISOString(), "cs", today)).toBe("Včera");
    expect(dayLabel(new Date(2026, 10, 16).toISOString(), "cs", today)).toBe("Před 4 dny");
    expect(dayLabel(new Date(2026, 10, 1).toISOString(), "cs", today)).toBe("1. 11.");
    expect(dayLabel(new Date(2026, 10, 20).toISOString(), "en", today)).toBe("Today");
  });
});

describe("nedávno aktualizováno – bez aplikací s další aktualizací", async () => {
  const { visibleRecentUpdates } = await import("./recentUpdates");
  const now = new Date(2026, 10, 20, 16).getTime();
  const h = (appId: string) =>
    ({ id: appId, appId, appName: appId, source: "winget", packageId: appId, kind: "update", outcome: "success", startedAt: new Date(2026, 10, 19).toISOString(), finishedAt: new Date(2026, 10, 19).toISOString() }) as never;
  it("aplikace s nabízenou aktualizací ani odinstalovaná tu nejsou", () => {
    const installed = new Map([
      ["gemini", { availableVersion: null }],
      ["chatgpt", { availableVersion: "26.1117.3838.0" }],
    ]);
    const out = visibleRecentUpdates([h("gemini"), h("chatgpt"), h("odinstalovana")], installed, now) as unknown as { appId: string }[];
    expect(out.map((e) => e.appId)).toEqual(["gemini"]);
  });
});

describe("opravit aplikaci", async () => {
  const { canRepair } = await import("./repair");
  const pkg = (over: Partial<InstalledPackage>) => ({ source: "winget", packageId: "VideoLAN.VLC", name: "VLC", installedVersion: "3.0", availableVersion: null, origin: "winget", ...over }) as InstalledPackage;
  it("jen winget a programy z Aplikací ve Windows", () => {
    expect(canRepair(pkg({}))).toBe(true);
    expect(canRepair(pkg({ packageId: String.raw`ARP\Machine\X64\{GUID}`, origin: "local" }))).toBe(true);
    expect(canRepair(pkg({ source: "chocolatey", origin: "chocolatey" }))).toBe(false);
    expect(canRepair(pkg({ packageId: String.raw`ARP\Machine\X64\Steam App 730`, origin: "steam" }))).toBe(false);
    expect(canRepair(pkg({ packageId: String.raw`EPIC\Fortnite`, origin: "epic" }))).toBe(false);
    expect(canRepair(pkg({ packageId: String.raw`DISK\C:\Tools\x`, origin: "local", diskLocation: String.raw`C:\Tools\x` }))).toBe(false);
    expect(canRepair(pkg({ portable: true }))).toBe(false);
    expect(canRepair(undefined)).toBe(false);
  });
});

describe("hry z herních obchodů", async () => {
  const { detectWingetOrigin, gameStoreOf, rememberGame } = await import("@/services/managers/sources");
  it("Steam podle id, Epic podle předpony, ostatní podle výpisu backendu", () => {
    const gog = String.raw`ARP\Machine\X86\1207658924_is1`;
    expect(gameStoreOf(String.raw`ARP\Machine\X64\Steam App 730`)).toBe("steam");
    expect(gameStoreOf(String.raw`EPIC\Fortnite`)).toBe("epic");
    expect(gameStoreOf(gog)).toBeNull();
    rememberGame(gog, "gog");
    expect(detectWingetOrigin(gog, null)).toBe("gog");
    expect(detectWingetOrigin("VideoLAN.VLC", "winget")).toBe("winget");
    // Hru z Ubisoftu pozná backend (gameStore ve výpisu), ne frontend podle id
    expect(detectWingetOrigin(String.raw`ARP\Machine\X64\Uplay Install 635`, null)).toBe("local");
  });
});

describe("porovnání aplikací", async () => {
  const { bestIndex, compareFacts } = await import("./compare");
  it("nejlepší hodnota jen s jasným vítězem", () => {
    expect(bestIndex([3, 5, 4], true)).toBe(1);
    expect(bestIndex([3, 5, 4], false)).toBe(0);
    expect(bestIndex([5, null, 5], true)).toBeNull();
    expect(bestIndex([5, null, undefined], true)).toBeNull();
    expect(bestIndex([null, 2, 9], false)).toBe(1);
  });
  it("údaje přes všechny zdroje", () => {
    const facts = compareFacts(
      entry("vlc", {
        license: "GPL-2.0",
        releaseDate: "2026-06-01",
        sources: [
          { source: "winget", packageId: "VideoLAN.VLC", version: "3.0", size: 44_000_000, architectures: ["x64", "x86"], minOsVersion: "10.0.17763.0", installedSize: 180_000_000 },
          { source: "chocolatey", packageId: "vlc", version: "3.0", size: 40_000_000, architectures: ["arm64", "x64"], minOsVersion: "10.0.10240.0" },
          { source: "winget", packageId: "VideoLAN.VLC.Nightly", version: "4.0" },
        ],
      }),
    );
    expect(facts.size).toBe(40_000_000);
    expect(facts.installedSize).toBe(180_000_000);
    expect(facts.architectures).toEqual(["x64", "arm64", "x86"]);
    expect(facts.sources).toEqual(["winget", "chocolatey"]);
    expect(facts.minOs).toBe("10.0.10240.0");
    expect(facts.license).toBe("licenseOpen");
  });
});

describe("porovnání – výběr aplikací", async () => {
  const { useCompare } = await import("@/store/compare");
  it("nejvýš 4 aplikace, opakované přidání odebere", () => {
    const { toggle, clear } = useCompare.getState();
    clear();
    expect(["a", "b", "c", "d"].map((id) => toggle(id))).toEqual(["added", "added", "added", "added"]);
    expect(toggle("e")).toBe("full");
    expect(toggle("b")).toBe("removed");
    expect(useCompare.getState().ids).toEqual(["a", "c", "d"]);
    useCompare.getState().set(["x", "x", "y", "z", "w", "v"]);
    expect(useCompare.getState().ids).toEqual(["x", "y", "z", "w"]);
    clear();
  });
});

describe("převzít do správy", async () => {
  const { adoptionSource } = await import("./adopt");
  const { withAdoptedPackages } = await import("@/hooks/usePackages");
  const firefox = entry("mozilla-firefox", {
    name: "Mozilla Firefox",
    sources: [
      { source: "winget", packageId: "Mozilla.Firefox", version: "146.0" },
      { source: "chocolatey", packageId: "firefox", version: "146.0" },
    ],
  });
  const arpId = "ARP" + String.fromCharCode(92) + "Machine" + String.fromCharCode(92) + "X64" + String.fromCharCode(92) + "Mozilla Firefox";
  const local = { source: "winget", packageId: arpId, name: "Mozilla Firefox (x64 cs)", installedVersion: "144.0.2", availableVersion: null, origin: "local" } as InstalledPackage;
  it("jen program mimo správce s balíčkem wingetu v katalogu", () => {
    expect(adoptionSource(local, firefox)?.packageId).toBe("Mozilla.Firefox");
    expect(adoptionSource({ ...local, origin: "winget" }, firefox)).toBeNull();
    expect(adoptionSource({ ...local, diskLocation: "C:" }, firefox)).toBeNull();
    // Bez verze programu nebo se starším balíčkem v katalogu (jiná řada – Windows SDK) převzetí nic nepřinese
    expect(adoptionSource({ ...local, installedVersion: "" }, firefox)).toBeNull();
    expect(adoptionSource({ ...local, installedVersion: "200.0" }, firefox)).toBeNull();
    expect(adoptionSource({ ...local, installedVersion: "146.0" }, firefox)?.packageId).toBe("Mozilla.Firefox");
    expect(adoptionSource(local, entry("web", { sources: [], downloadUrl: "https://example.com" }))).toBeNull();
    expect(adoptionSource(local, entry("store", { sources: [{ source: "winget", packageId: "9NKSQGP7F2NH", version: "1" }] }))).toBeNull();
  });
  it("převzatý program pod id balíčku s aktualizací z katalogu", () => {
    const catalog = { catalog: { packages: [firefox] } } as never;
    const adopted = { [`winget:${arpId}`]: { wingetId: "Mozilla.Firefox", name: local.name, at: "" } };
    const [out] = withAdoptedPackages([local], catalog, adopted);
    expect(out).toMatchObject({ packageId: "Mozilla.Firefox", origin: "winget", adoptedFrom: arpId, availableVersion: "146.0" });
    // Winget už program vidí sám – převzetí se neuplatní (aplikace by byla dvakrát)
    const listed = { ...local, packageId: "Mozilla.Firefox", origin: "winget" } as InstalledPackage;
    expect(withAdoptedPackages([local, listed], catalog, adopted)[0].packageId).toBe(arpId);
    // Bez verze v registru se aktualizace nenabízí
    expect(withAdoptedPackages([{ ...local, installedVersion: "" }], catalog, adopted)[0].availableVersion).toBeNull();
  });
});

describe("nově v katalogu", async () => {
  const { newInCatalog } = await import("./newApps");
  it("za období, od nejnovější, bez data se vynechá", () => {
    const now = Date.parse("2026-11-21T12:00:00Z");
    const apps = [
      { id: "a", addedAt: "2026-11-20T10:00:00Z" },
      { id: "b", addedAt: "2026-11-01T10:00:00Z" },
      { id: "c", addedAt: "2026-11-21T08:00:00Z" },
      { id: "d" },
      { id: "e", addedAt: "2026-08-01T10:00:00Z" },
    ];
    expect(newInCatalog(apps, 7, now).map((a) => a.id)).toEqual(["c", "a"]);
    expect(newInCatalog(apps, 30, now).map((a) => a.id)).toEqual(["c", "a", "b"]);
  });
});

describe("známé aplikace s vlastním aktualizátorem", async () => {
  const { isKnownSelfUpdating } = await import("@/store/updateRules");
  it("podle id wingetu (i varianty) a podle profilu v katalogu", () => {
    const none = new Set<string>();
    expect(isKnownSelfUpdating({ source: "winget", packageId: "Google.Chrome" }, none)).toBe(true);
    expect(isKnownSelfUpdating({ source: "winget", packageId: "google.chrome.EXE" }, none)).toBe(true);
    expect(isKnownSelfUpdating({ source: "winget", packageId: "VideoLAN.VLC" }, none)).toBe(false);
    expect(isKnownSelfUpdating({ source: "chocolatey", packageId: "googlechrome" }, new Set(["chocolatey:googlechrome"]))).toBe(true);
  });
});

describe("hledání podle účelu česky", async () => {
  const { intentTerms, matchesIntent } = await import("./searchIntents");
  const { normalize } = await import("./utils");
  const terms = (q: string) => intentTerms(normalize(q));
  it("české výrazy i se skloňováním", () => {
    expect(terms("stříhání videa")).toContain("video editor");
    expect(terms("střih videí")).toContain("video editor");
    expect(terms("čtečka PDF")).toContain("pdf reader");
    expect(terms("rozbalit zip")).toContain("archiver");
    expect(terms("správce hesel")).toContain("password manager");
    expect(terms("firefox")).toEqual([]);
    // Rozepsané poslední slovo u víceslovného dotazu
    expect(terms("nahrávání obraz")).toContain("screen recorder");
  });
  it("shoda v popisu nebo názvu", () => {
    expect(matchesIntent({ name: "shotcut", extra: "free open source video editor" }, terms("střih videa"))).toBe(true);
    expect(matchesIntent({ name: "vlc", extra: "media player" }, terms("střih videa"))).toBe(false);
  });
});

describe("opuštěné aplikace", async () => {
  const { abandonedReason } = await import("./abandoned");
  const now = Date.parse("2026-11-22T12:00:00Z");
  it("archivovaný repozitář, dlouho bez změn, stará verze; hry ne", () => {
    expect(abandonedReason(entry("atom", { archived: true }), now)?.kind).toBe("archived");
    expect(abandonedReason(entry("old", { lastCommit: "2023-05-01T00:00:00Z" }), now)?.kind).toBe("noCommits");
    expect(abandonedReason(entry("fresh", { lastCommit: "2026-10-01T00:00:00Z", releaseDate: "2020-01-01" }), now)).toBeNull();
    expect(abandonedReason(entry("norepo", { releaseDate: "2022-06-01" }), now)?.kind).toBe("noRelease");
    expect(abandonedReason(entry("norepo2", { releaseDate: "2024-06-01" }), now)).toBeNull();
    expect(abandonedReason(entry("game", { archived: true, categories: ["games"] }), now)).toBeNull();
  });
});

describe("váš rok s HubGetem", async () => {
  const { addToYear, savedMinutes } = await import("@/store/yearStats");
  const h = (kind: string, finishedAt: string, over: Record<string, unknown> = {}) =>
    ({ id: finishedAt + kind, appId: "vlc", appName: "VLC", source: "winget", packageId: "VideoLAN.VLC", kind, outcome: "success", startedAt: finishedAt, finishedAt, ...over }) as never;
  it("počty po letech a měsících", () => {
    let years = {};
    years = addToYear(years, h("install", "2026-03-02T10:00:00Z"));
    years = addToYear(years, h("update", "2026-05-02T10:00:00Z", { background: true }));
    years = addToYear(years, h("update", "2026-05-09T10:00:00Z"));
    years = addToYear(years, h("update", "2026-06-01T10:00:00Z", { outcome: "error" }));
    years = addToYear(years, h("download", "2026-06-01T10:00:00Z"));
    years = addToYear(years, h("install", "2025-12-30T10:00:00Z"));
    const y = (years as Record<string, ReturnType<typeof Object>>)["2026"] as { installs: number; updates: number; automatic: number; failed: number; months: number[]; apps: Record<string, { updates: number }> };
    expect([y.installs, y.updates, y.automatic, y.failed]).toEqual([1, 2, 1, 1]);
    expect(y.months[4]).toBe(2);
    expect(y.apps.vlc.updates).toBe(2);
    expect(Object.keys(years).sort()).toEqual(["2025", "2026"]);
    expect(savedMinutes(y as never)).toBe(1 * 5 + 2 * 3);
  });
});

describe("komunita – pomocné funkce", async () => {
  const { githubRepo } = await import("@/services/community");
  it("repozitář z adresy", () => {
    expect(githubRepo("https://github.com/videolan/vlc")).toBe("videolan/vlc");
    expect(githubRepo("https://github.com/microsoft/PowerToys.git")).toBe("microsoft/PowerToys");
    expect(githubRepo("https://github.com/owner/repo/releases")).toBe("owner/repo");
    expect(githubRepo("https://example.com/x")).toBeNull();
  });
});

describe("opuštěné aplikace – bez knihoven a runtime", async () => {
  const { abandonedReason } = await import("./abandoned");
  it("Redistributable, DirectX, OpenAL, Xaml se nehlásí", () => {
    const now = Date.parse("2026-11-22T12:00:00Z");
    for (const name of ["Microsoft Visual C++ 2013 Redistributable", "DirectX End-User Runtime Installer", "OpenAL", "Microsoft.UI.Xaml"]) {
      expect(abandonedReason(entry(name.toLowerCase().replace(/\W+/g, "-"), { name, releaseDate: "2014-01-01" }), now)).toBeNull();
    }
    expect(abandonedReason(entry("icloud", { name: "iCloud (Legacy)", releaseDate: "2020-09-01" }), now)?.kind).toBe("noRelease");
  });
});
