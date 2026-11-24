import { beforeEach, describe, expect, it } from "vitest";
import { dueScheduled, nextNight, useScheduled } from "./scheduled";
import { dueTrials, TRIAL_DAYS, usedDuringTrial, type Trial } from "./trials";

const DAY = 24 * 60 * 60_000;
const request = (appId: string) => ({ appId, appName: appId, source: "winget" as const, packageId: appId, kind: "install" as const });

describe("Nainstalovat později", () => {
  beforeEach(() => useScheduled.setState({ items: [] }));

  it("v noci = nejbližší 2:00 (dnes před druhou, jinak zítra)", () => {
    const evening = new Date(2026, 10, 24, 21, 30);
    expect(new Date(nextNight(evening))).toEqual(new Date(2026, 10, 25, 2, 0));
    const earlyMorning = new Date(2026, 10, 24, 1, 15);
    expect(new Date(nextNight(earlyMorning))).toEqual(new Date(2026, 10, 24, 2, 0));
    // Přesně ve 2:00 už je pozdě – další noc
    expect(new Date(nextNight(new Date(2026, 10, 24, 2, 0)))).toEqual(new Date(2026, 10, 25, 2, 0));
  });

  it("stejná aplikace nahradí dřívější čas, seznam je podle času a zařadí se jen to, co nastalo", () => {
    const { add } = useScheduled.getState();
    add(request("gimp"), 5_000);
    add(request("vlc"), 1_000);
    add(request("gimp"), 3_000);
    const { items } = useScheduled.getState();
    expect(items.map((i) => `${i.request.appId}@${i.at}`)).toEqual(["vlc@1000", "gimp@3000"]);
    expect(dueScheduled(items, 2_000).map((i) => i.request.appId)).toEqual(["vlc"]);
    useScheduled.getState().take([items[0].id]);
    useScheduled.getState().cancel("gimp");
    expect(useScheduled.getState().items).toEqual([]);
  });
});

describe("Vyzkoušet na týden", () => {
  const trial = (daysAgo: number, asked = false): Trial => ({ name: "GIMP", at: Date.now() - daysAgo * DAY, source: "winget", packageId: "GIMP.GIMP", asked });

  it("ptá se až po TRIAL_DAYS dnech a jen jednou", () => {
    const items = { fresh: trial(1), due: trial(TRIAL_DAYS + 0.1), asked: trial(TRIAL_DAYS + 3, true) };
    expect(dueTrials(items).map(([id]) => id)).toEqual(["due"]);
  });

  it("spuštění během zkoušky aplikaci ponechá, spuštění před ní ne", () => {
    const t = trial(TRIAL_DAYS);
    expect(usedDuringTrial(t, t.at + DAY)).toBe(true);
    expect(usedDuringTrial(t, t.at - DAY)).toBe(false);
    expect(usedDuringTrial(t, null)).toBe(false);
  });
});
