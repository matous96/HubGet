/**
 * Soukromí aplikací (backend privacy.rs): které nainstalované aplikace mají v HubGetu přepínač
 * „Neodesílat telemetrii“ – podle názvu nainstalovaného programu (stejně u všech správců).
 */

export type PrivacyId = "firefox" | "thunderbird" | "chrome" | "edge" | "brave" | "vscode" | "visualStudio" | "office" | "dotnet" | "powershell";

/** Název aplikace v Soukromí aplikací a jak ji poznat podle názvu nainstalovaného programu. */
export const PRIVACY_APPS: { id: PrivacyId; name: string; match: RegExp; exclude?: RegExp }[] = [
  { id: "firefox", name: "Mozilla Firefox", match: /^(Mozilla )?Firefox\b/i },
  { id: "thunderbird", name: "Mozilla Thunderbird", match: /^(Mozilla )?Thunderbird\b/i },
  { id: "chrome", name: "Google Chrome", match: /^Google Chrome\b/i },
  // Jen prohlížeč – ne Microsoft Edge WebView2 Runtime
  { id: "edge", name: "Microsoft Edge", match: /^Microsoft Edge$/i },
  { id: "brave", name: "Brave", match: /^Brave\b/i },
  // Insiders má vlastní klíč zásad
  { id: "vscode", name: "Visual Studio Code", match: /^(Microsoft )?Visual Studio Code\b/i, exclude: /Insiders/i },
  { id: "visualStudio", name: "Visual Studio", match: /^(Microsoft )?Visual Studio (Community|Professional|Enterprise|Build Tools)\b/i },
  { id: "office", name: "Microsoft 365 / Office", match: /^Microsoft (Office|365)\b/i },
  { id: "dotnet", name: ".NET SDK", match: /\.NET( Core)? SDK\b/i },
  { id: "powershell", name: "PowerShell 7", match: /^PowerShell 7\b/i },
];

/** Nastavení soukromí pro program s tímto názvem, jinak null. */
export function privacyIdFor(name: string): PrivacyId | null {
  return PRIVACY_APPS.find((a) => a.match.test(name) && !a.exclude?.test(name))?.id ?? null;
}

/** Nastavení soukromí u nainstalovaných programů (každé jednou, v pořadí PRIVACY_APPS). */
export function installedPrivacyIds(names: Iterable<string>): PrivacyId[] {
  const found = new Set<PrivacyId>();
  for (const name of names) {
    const id = privacyIdFor(name);
    if (id) found.add(id);
  }
  return PRIVACY_APPS.map((a) => a.id).filter((id) => found.has(id));
}
