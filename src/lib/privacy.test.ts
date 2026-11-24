import { describe, expect, it } from "vitest";
import { installedPrivacyIds, privacyIdFor } from "./privacy";

describe("Soukromí aplikací – které programy mají přepínač", () => {
  it("pozná aplikace podle názvu nainstalovaného programu", () => {
    expect(privacyIdFor("Mozilla Firefox (x64 cs)")).toBe("firefox");
    expect(privacyIdFor("Firefox Developer Edition")).toBe("firefox");
    expect(privacyIdFor("Google Chrome")).toBe("chrome");
    expect(privacyIdFor("Microsoft Edge")).toBe("edge");
    expect(privacyIdFor("Microsoft Visual Studio Code (User)")).toBe("vscode");
    expect(privacyIdFor("Visual Studio Community 2022")).toBe("visualStudio");
    expect(privacyIdFor("Microsoft .NET SDK 9.0.100 (x64)")).toBe("dotnet");
    expect(privacyIdFor("PowerShell 7-x64")).toBe("powershell");
    expect(privacyIdFor("Microsoft 365 Apps for enterprise - cs-cz")).toBe("office");
  });

  it("nezamění podobné programy s jinými zásadami", () => {
    expect(privacyIdFor("Microsoft Edge WebView2 Runtime")).toBeNull();
    expect(privacyIdFor("Microsoft Visual Studio Code Insiders (User)")).toBeNull();
    expect(privacyIdFor("Microsoft .NET Runtime - 9.0.0 (x64)")).toBeNull();
    expect(privacyIdFor("Windows PowerShell")).toBeNull();
    expect(privacyIdFor("Chromium")).toBeNull();
  });

  it("každé nastavení jednou, v pevném pořadí", () => {
    expect(installedPrivacyIds(["PowerShell 7-x64", "Google Chrome", "Mozilla Firefox", "Mozilla Firefox ESR"])).toEqual(["firefox", "chrome", "powershell"]);
  });
});
