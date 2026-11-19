import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedCatalog } from "@/services/catalog";
import { isSecurityNote, isSecurityRelease, osvUrl, queryOsv } from "./securityUpdates";

describe("isSecurityNote", () => {
  it.each([
    "Fixed CVE-2026-12345 in the parser",
    "This is a security release.",
    "Security fixes: avoid unbounded buffer",
    "• Fixed a security issue where files were sent",
    "Some bugs and vulnerabilities were fixed.",
    "Heap overflow vulnerability is fixed in RAR5",
    "Bump Go for GHSA-55r2-34wg-8mv9",
    "Opravena zranitelnost v importu",
    "Bezpečnostní opravy knihoven",
  ])("bezpečnostní: %s", (text) => expect(isSecurityNote(text)).toBe(true));

  it.each([
    "New Windows Security integration",
    "Added security key support",
    "Report aliased OSV records as a single vulnerability in uv audit",
    "Include vulnerability severity and rating in CycloneDX output",
    "Bug fixes and performance improvements",
    "",
    null,
  ])("obyčejná: %s", (text) => expect(isSecurityNote(text)).toBe(false));
});

describe("isSecurityRelease", () => {
  const catalog = {
    catalog: {
      packages: [
        {
          id: "7zip-7zip",
          latestVersion: "26.06",
          releaseNotes: "Some bugs and vulnerabilities were fixed.",
          sources: [
            { source: "winget", packageId: "7zip.7zip", version: "26.06" },
            { source: "scoop", packageId: "main/7zip", version: "26.05" },
          ],
        },
      ],
    },
  } as unknown as LoadedCatalog;

  it("jen nabízená verze, ke které poznámky patří", () => {
    expect(isSecurityRelease(catalog, { source: "winget", packageId: "7zip.7zip" }, "26.06")).toBe(true);
    expect(isSecurityRelease(catalog, { source: "winget", packageId: "7zip.7zip" }, "26.05")).toBe(false);
    // Scoop má starší verzi – poznámky k ní nepatří
    expect(isSecurityRelease(catalog, { source: "scoop", packageId: "main/7zip" }, "26.05")).toBe(false);
    expect(isSecurityRelease(undefined, { source: "winget", packageId: "7zip.7zip" }, "26.06")).toBe(false);
  });
});

describe("queryOsv", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pošle jen balíčky, které OSV zná, a vrátí nálezy", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.queries).toEqual([
        { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.15" },
        { package: { name: "requests", ecosystem: "PyPI" }, version: "2.0.0" },
      ]);
      return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-b" }, { id: "GHSA-a" }, { id: "GHSA-a" }] }, {}] }));
    });
    vi.stubGlobal("fetch", fetch);
    const found = await queryOsv([
      { source: "npm", packageId: "lodash", installedVersion: "4.17.15" },
      { source: "winget", packageId: "VideoLAN.VLC", installedVersion: "3.0.21" },
      { source: "pip", packageId: "requests", installedVersion: "2.0.0" },
      { source: "npm", packageId: "bez-verze", installedVersion: "Unknown" },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(found).toEqual({ "npm:lodash": { version: "4.17.15", ids: ["GHSA-a", "GHSA-b"] } });
  });

  it("chyba serveru = výjimka (zkusí se později)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(queryOsv([{ source: "npm", packageId: "x", installedVersion: "1.0.0" }])).rejects.toThrow("503");
  });

  it("odkaz na zranitelnost", () => {
    expect(osvUrl("GHSA-xx/yy")).toBe("https://osv.dev/vulnerability/GHSA-xx%2Fyy");
  });
});
