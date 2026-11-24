import { beforeEach, describe, expect, it } from "vitest";
import { commandsFor, DEVICE_COMMAND_DAYS, DEVICE_COMMAND_KINDS, freshCommands, useDevices, waitingSince, type DeviceCommand, type DeviceRecord } from "./devices";
import { SYNC_KIND_LIST } from "./syncKinds";

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-11-24T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const command = (id: string, target: string, daysAgo = 0): DeviceCommand => ({ id, target, kind: "updateAll", at: at(daysAgo) });
const device = (name: string, commands?: DeviceCommand[]): DeviceRecord => ({ name, seen: at(0), apps: [], ...(commands && { commands }) });

describe("Aktualizovat tam – žádosti pro jiné počítače", () => {
  beforeEach(() => useDevices.setState({ deviceId: "self", devices: {}, commands: [], handled: [] }));

  it("starší žádosti než DEVICE_COMMAND_DAYS se zahodí", () => {
    const list = [command("a", "x", 1), command("b", "x", DEVICE_COMMAND_DAYS + 1)];
    expect(freshCommands(list, NOW).map((c) => c.id)).toEqual(["a"]);
    expect(freshCommands(undefined, NOW)).toEqual([]);
  });

  it("tento počítač vyřídí jen žádosti pro sebe, z cizích záznamů a každou jednou", () => {
    const devices = {
      self: device("Tento", [command("own", "self")]),
      laptop: device("Notebook", [command("c1", "self"), command("c2", "desk"), command("old", "self", DEVICE_COMMAND_DAYS + 2)]),
      desk: device("Stolní", [command("c3", "self")]),
    };
    const due = commandsFor("self", devices, ["c3"], NOW);
    expect(due.map((d) => [d.from.name, d.command.id])).toEqual([["Notebook", "c1"]]);
  });

  it("nová žádost nahradí předchozí pro stejný počítač a hned je ve vlastním záznamu", () => {
    const { setSelf } = useDevices.getState();
    setSelf(device("Tento"));
    useDevices.getState().request("laptop");
    useDevices.getState().request("laptop");
    useDevices.getState().request("desk");
    const { commands, devices } = useDevices.getState();
    expect(commands.map((c) => c.target)).toEqual(["laptop", "desk"]);
    expect(devices.self.commands).toEqual(commands);
    // Přehled tohoto počítače (DeviceReporter) žádosti ani schopnost vyřizovat je neztratí
    useDevices.getState().setSelf(device("Tento"));
    expect(useDevices.getState().devices.self.commands).toEqual(commands);
    expect(useDevices.getState().devices.self.accepts).toEqual(DEVICE_COMMAND_KINDS);
  });

  it("Nainstalovat na jiný počítač: každá aplikace zvlášť, stejná nahradí předchozí", () => {
    useDevices.getState().setSelf(device("Tento"));
    const app = (id: string) => ({ appId: id, name: id, source: "winget" as const, packageId: id });
    const { request } = useDevices.getState();
    request("laptop", "install", app("gimp"));
    request("laptop", "install", app("vlc"));
    request("laptop", "install", app("gimp"));
    request("laptop");
    const commands = useDevices.getState().commands;
    expect(commands.map((c) => `${c.kind}:${c.app?.appId ?? ""}`)).toEqual(["install:vlc", "install:gimp", "updateAll:"]);
    // Čeká, dokud se cílový počítač po odeslání neozval
    const laptop = { ...device("Notebook"), seen: new Date(Date.parse(commands[1].at) - 1000).toISOString() };
    const isGimp = (c: DeviceCommand) => c.kind === "install" && c.app?.appId === "gimp";
    expect(waitingSince(commands, "laptop", laptop, isGimp)).toBe(commands[1].at);
    expect(waitingSince(commands, "laptop", { ...laptop, seen: new Date(Date.parse(commands[1].at) + 1000).toISOString() }, isGimp)).toBeNull();
  });

  it("synchronizace převezme platné žádosti a zahodí neznámé druhy", () => {
    const kind = SYNC_KIND_LIST.find((k) => k.id === "devices")!;
    kind.apply({
      laptop: {
        ...device("Notebook"),
        accepts: ["updateAll", "formatDisk", "install", "install"],
        commands: [
          command("ok", "self"),
          { id: "bad", target: "self", kind: "formatDisk", at: at(0) },
          { id: "x".repeat(100), target: "self", kind: "updateAll", at: at(0) },
          // Instalace musí nést platnou aplikaci, Aktualizovat tam žádnou
          { id: "inst", target: "self", kind: "install", at: at(0), app: { appId: "gimp", name: "GIMP", source: "winget", packageId: "GIMP.GIMP" } },
          { id: "noapp", target: "self", kind: "install", at: at(0) },
          { id: "badsrc", target: "self", kind: "install", at: at(0), app: { appId: "x", name: "X", source: "evil", packageId: "x" } },
          { id: "extra", target: "self", kind: "updateAll", at: at(0), app: { appId: "gimp", name: "GIMP", source: "winget", packageId: "GIMP.GIMP" } },
        ],
      },
    });
    const laptop = useDevices.getState().devices.laptop;
    expect(laptop.commands?.map((c) => c.id)).toEqual(["ok", "inst"]);
    expect(laptop.accepts).toEqual(["updateAll", "install"]);
  });
});
