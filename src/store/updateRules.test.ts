import { describe, expect, it } from "vitest";
import type { InstalledPackage } from "@/types";
import { applyUpdateRules, type UpdateRules } from "./updateRules";

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");

const pkg = (over: Partial<InstalledPackage> = {}): InstalledPackage => ({
  source: "winget",
  packageId: "VideoLAN.VLC",
  name: "VLC media player",
  installedVersion: "3.0.20",
  availableVersion: "3.0.21",
  origin: "winget",
  ...over,
});

const rules = (over: Partial<UpdateRules> = {}): UpdateRules => ({
  pins: {},
  minAge: () => 0,
  releasedAt: () => undefined,
  firstSeen: {},
  stuck: {},
  allowed: {},
  selfUpdating: {},
  knownSelfUpdating: () => false,
  selfOffer: {},
  selfUpdatingWait: true,
  stuckLimit: 3,
  now: NOW,
  security: () => false,
  securityNoWait: true,
  ...over,
});

describe("aplikace, které se aktualizují samy", () => {
  const chrome = pkg({ packageId: "Google.Chrome", name: "Google Chrome", installedVersion: "142.0.1", availableVersion: "142.0.2" });
  const known = (p: InstalledPackage) => p.packageId === "Google.Chrome";

  it("známou aplikaci podrží 14 dní od vydání a pak nabídne", () => {
    const [held] = applyUpdateRules([chrome], rules({ knownSelfUpdating: known, releasedAt: () => NOW - 2 * DAY }));
    expect(held.availableVersion).toBeNull();
    expect(held.pin).toBe("self");
    expect(Date.parse(held.pinUntil!)).toBe(NOW + 12 * DAY);
    const [offered] = applyUpdateRules([chrome], rules({ knownSelfUpdating: known, releasedAt: () => NOW - 15 * DAY }));
    expect(offered.availableVersion).toBe("142.0.2");
  });

  it("bezpečnostní opravu nabídne už po 3 dnech", () => {
    const [held] = applyUpdateRules([chrome], rules({ knownSelfUpdating: known, security: () => true, releasedAt: () => NOW - 2 * DAY }));
    expect(Date.parse(held.pinUntil!)).toBe(NOW + DAY);
    const [offered] = applyUpdateRules([chrome], rules({ knownSelfUpdating: known, security: () => true, releasedAt: () => NOW - 4 * DAY }));
    expect(offered.availableVersion).toBe("142.0.2");
  });

  it("„Nabídnout znovu“ a vypnuté nastavení podržení zruší, jiné aplikace se netýká", () => {
    expect(applyUpdateRules([chrome], rules({ knownSelfUpdating: known, selfOffer: { "winget:Google.Chrome": "x" } }))[0].availableVersion).toBe("142.0.2");
    expect(applyUpdateRules([chrome], rules({ knownSelfUpdating: known, selfUpdatingWait: false }))[0].availableVersion).toBe("142.0.2");
    expect(applyUpdateRules([pkg()], rules({ knownSelfUpdating: known }))[0].availableVersion).toBe("3.0.21");
  });
});

describe("applyUpdateRules", () => {
  it("bez pravidel aktualizaci nabídne", () => {
    expect(applyUpdateRules([pkg()], rules())[0].availableVersion).toBe("3.0.21");
  });

  it("minimální stáří podrží verzi vydanou před 2 dny (7 dní)", () => {
    const [held] = applyUpdateRules([pkg()], rules({ minAge: () => 7, releasedAt: () => NOW - 2 * DAY }));
    expect(held.availableVersion).toBeNull();
    expect(held.heldVersion).toBe("3.0.21");
    expect(held.pin).toBe("age");
    expect(Date.parse(held.pinUntil!)).toBe(NOW + 5 * DAY);
  });

  it("starší verze minimální stáří splní", () => {
    expect(applyUpdateRules([pkg()], rules({ minAge: () => 7, releasedAt: () => NOW - 8 * DAY }))[0].availableVersion).toBe("3.0.21");
  });

  it("bezpečnostní aktualizace nečeká na minimální stáří – jen s nastavením", () => {
    const base = { minAge: () => 7, releasedAt: () => NOW - DAY, security: () => true };
    expect(applyUpdateRules([pkg()], rules(base))[0].availableVersion).toBe("3.0.21");
    expect(applyUpdateRules([pkg()], rules({ ...base, securityNoWait: false }))[0].pin).toBe("age");
  });

  it("neprojevená aktualizace po limitu a aplikace, která se aktualizuje sama", () => {
    expect(applyUpdateRules([pkg()], rules({ stuck: { "winget:VideoLAN.VLC@3.0.21": 3 } }))[0].pin).toBe("stuck");
    expect(applyUpdateRules([pkg()], rules({ selfUpdating: { "winget:VideoLAN.VLC": { version: "3.0.20" } as never } }))[0].pin).toBe("self");
  });

  it("„Nabídnout hned“ obejde stáří i neprojevenou aktualizaci", () => {
    const allowed = { "winget:VideoLAN.VLC@3.0.21": "2026-11-20" };
    const out = applyUpdateRules([pkg()], rules({ allowed, minAge: () => 30, stuck: { "winget:VideoLAN.VLC@3.0.21": 9 } }));
    expect(out[0].availableVersion).toBe("3.0.21");
  });

  it("přeskočená verze a zámek uživatele", () => {
    const skip = rules({ pins: { "winget:VideoLAN.VLC": { kind: "skip", version: "3.0.21", name: "VLC" } as never } });
    expect(applyUpdateRules([pkg()], skip)[0].pin).toBe("skip");
    // Novější než přeskočená se zase nabídne
    expect(applyUpdateRules([pkg({ availableVersion: "3.0.22" })], skip)[0].availableVersion).toBe("3.0.22");
    const lock = rules({ pins: { "winget:VideoLAN.VLC": { kind: "lock", name: "VLC" } as never } });
    expect(applyUpdateRules([pkg()], lock)[0].pin).toBe("lock");
  });

  it("balíček bez aktualizace zůstane beze změny", () => {
    const current = pkg({ availableVersion: null });
    expect(applyUpdateRules([current], rules({ minAge: () => 7 }))[0]).toBe(current);
  });
});
