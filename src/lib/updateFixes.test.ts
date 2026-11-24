import { describe, expect, it } from "vitest";
import { deferredDue, retryRequest, type DeferredUpdate } from "@/store/updateFixes";
import { manifestIssueUrl } from "./manifestIssue";

describe("nahlásit chybu v manifestu", () => {
  it("předvyplněné hlášení do winget-pkgs bez osobních údajů", () => {
    const url = new URL(
      manifestIssueUrl(
        { packageId: "OBSProject.OBSStudio", kind: "update", error: "Instalátor skončil s chybou (0x8A150006).", errorKey: "inUseByOther", toVersion: "33.0.3" },
        "Windows 11 Pro 26H2",
      ),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/microsoft/winget-pkgs/issues/new");
    expect(url.searchParams.get("title")).toBe("[Package Issue]: OBSProject.OBSStudio");
    expect(url.searchParams.get("labels")).toBe("Issue-Bug");
    const body = url.searchParams.get("body")!;
    expect(body).toContain("winget upgrade --id OBSProject.OBSStudio --exact --version 33.0.3");
    expect(body).toContain("ExpectedReturnCodes");
    expect(body).toContain("Windows 11 Pro 26H2");
    expect(body).not.toMatch(/Users\\|@/);
  });
});

describe("dokončit při příštím přihlášení", () => {
  const item = (boot: number): DeferredUpdate => ({ request: retryRequest({ appId: "obs", appName: "OBS", source: "winget", packageId: "OBSProject.OBSStudio", kind: "update" }), boot, at: 0 });

  it("po přihlášení nebo novém startu počítače, ne hned v téže relaci", () => {
    expect(deferredDue([item(100)], { autostart: false, boot: 100 })).toEqual([]);
    expect(deferredDue([item(100)], { autostart: true, boot: 100 })).toHaveLength(1);
    expect(deferredDue([item(100)], { autostart: false, boot: 200 })).toHaveLength(1);
  });

  it("opakování hlídá programy, které drží soubory, a zachová volby", () => {
    const request = retryRequest(
      { appId: "x", appName: "X", source: "winget", packageId: "X.Y", kind: "update", options: { scope: "machine" } },
      { asAdmin: true },
    );
    expect(request.options).toEqual({ scope: "machine", closeFileUsers: true, asAdmin: true });
  });
});
