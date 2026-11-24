import { describe, expect, it } from "vitest";
import { newDeviceApps } from "@/store/deviceInstalls";
import type { HistoryEntry } from "@/store/history";
import { isMajorUpdate, majorOf, notesTeaser } from "./majorUpdate";
import { daysSince, rateCandidate } from "./ratePrompt";

describe("významné aktualizace", () => {
  it("pozná novou hlavní verzi", () => {
    expect(majorOf("33.0.1")).toBe(33);
    expect(majorOf("v2.10.38")).toBe(2);
    expect(majorOf("beta")).toBeNull();
    expect(isMajorUpdate("32.1.2", "33.0.1")).toBe(true);
    expect(isMajorUpdate("2.10.38", "3.0.4")).toBe(true);
    expect(isMajorUpdate("0.9.1", "1.0.0")).toBe(true);
    // Vedlejší verze, sestavení (ChatGPT 26.x), data a rok místo verze – ne
    expect(isMajorUpdate("33.0.0", "33.0.1")).toBe(false);
    expect(isMajorUpdate("26.1117.4957.0", "26.1124.100.0")).toBe(false);
    expect(isMajorUpdate("2025.11.1", "2026.1.0")).toBe(false);
    expect(isMajorUpdate("20251120", "20261120")).toBe(false);
    expect(isMajorUpdate(null, "3.0")).toBe(false);
  });

  it("první věta poznámek na kartu", () => {
    expect(notesTeaser("## What's new\n- Native Wayland support.\n- Faster startup.")).toBe("Native Wayland support.");
    expect(notesTeaser("x".repeat(300), 50)).toHaveLength(50);
    expect(notesTeaser("")).toBeNull();
  });
});

describe("výzva k hodnocení", () => {
  const DAY = 24 * 60 * 60_000;
  const now = Date.parse("2026-11-24T12:00:00Z");
  const install = (appId: string, daysAgo: number, outcome: HistoryEntry["outcome"] = "success"): HistoryEntry =>
    ({ id: appId, appId, appName: appId, source: "winget", packageId: appId, kind: "install", outcome, startedAt: "", finishedAt: new Date(now - daysAgo * DAY).toISOString() }) as HistoryEntry;
  const installed = new Set(["obs", "gimp", "vlc", "old"]);

  it("nejnovější instalace starší než 3 dny, kterou uživatel má", () => {
    // Historie od nejnovější: vlc je moc čerstvá, krita odinstalovaná, obs splňuje
    const history = [install("vlc", 1), install("krita", 5), install("obs", 5), install("gimp", 10)];
    expect(rateCandidate(history, installed, {}, now)?.appId).toBe("obs");
    // Už vyřízená aplikace se přeskočí
    expect(rateCandidate(history, installed, { obs: 0 }, now)?.appId).toBe("gimp");
  });

  it("nejvýš jedna výzva denně a jen do 60 dní", () => {
    const history = [install("obs", 5)];
    expect(rateCandidate(history, installed, { gimp: now - 2 * 60 * 60_000 }, now)).toBeNull();
    expect(rateCandidate([install("old", 90)], installed, {}, now)).toBeNull();
    expect(rateCandidate([install("obs", 5, "error")], installed, {}, now)).toBeNull();
    expect(daysSince(new Date(now - 5 * DAY).toISOString(), now)).toBe(5);
  });
});

describe("automatická instalace z ostatních počítačů", () => {
  it("jen aplikace přibylé po zapamatování stavu počítače", () => {
    const devices = { pc2: ["winget:mozilla.firefox", "winget:obsproject.obsstudio"], pc3: ["winget:videolan.vlc"] };
    // pc3 ještě nemá výchozí stav – nic z něj
    expect(newDeviceApps(devices, { pc2: ["winget:mozilla.firefox"] })).toEqual([{ deviceId: "pc2", key: "winget:obsproject.obsstudio" }]);
    expect(newDeviceApps(devices, {})).toEqual([]);
  });
});
