import { beforeEach, describe, expect, it } from "vitest";
import { useEverInstalled } from "./everInstalled";
import type { HistoryEntry } from "./history";

const entry = (appId: string, kind: HistoryEntry["kind"], outcome: HistoryEntry["outcome"] = "success"): HistoryEntry =>
  ({ id: `${appId}-${kind}`, appId, appName: appId, source: "winget", packageId: appId, kind, outcome, startedAt: "2026-01-01T10:00:00Z", finishedAt: "2026-01-01T10:01:00Z" }) as HistoryEntry;

describe("dřív nainstalované aplikace (mráček)", () => {
  beforeEach(() => useEverInstalled.setState({ ids: {}, seeded: false }));

  it("poprvé doplní aplikace z historie – i odinstalované, ne neúspěšné a stažené", () => {
    const history = [entry("gimp-gimp", "uninstall"), entry("videolan-vlc", "update"), entry("obsproject-obsstudio", "install", "error"), entry("7zip-7zip", "download")];
    useEverInstalled.getState().observe([], history);
    expect(Object.keys(useEverInstalled.getState().ids).sort()).toEqual(["gimp-gimp", "videolan-vlc"]);
    // Historie se čte jen jednou
    useEverInstalled.getState().observe([], [entry("kde-krita", "install")]);
    expect(useEverInstalled.getState().ids["kde-krita"]).toBeUndefined();
  });

  it("zapamatuje nainstalované z katalogu, ne programy mimo něj", () => {
    useEverInstalled.getState().observe(["mozilla-firefox", "winget:Some.Tool"], []);
    const { ids } = useEverInstalled.getState();
    expect(ids["mozilla-firefox"]).toBeTypeOf("number");
    expect("winget:Some.Tool" in ids).toBe(false);
    // Opakovaný výpis datum nepřepíše
    const first = ids["mozilla-firefox"];
    useEverInstalled.getState().observe(["mozilla-firefox"], []);
    expect(useEverInstalled.getState().ids["mozilla-firefox"]).toBe(first);
  });

  it("vymazání historie nechá jen právě nainstalované", () => {
    useEverInstalled.getState().observe(["mozilla-firefox", "gimp-gimp"], []);
    useEverInstalled.getState().reset(["mozilla-firefox"]);
    expect(Object.keys(useEverInstalled.getState().ids)).toEqual(["mozilla-firefox"]);
  });
});
