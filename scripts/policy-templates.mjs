// Šablona zásad skupiny: policies/HubGet.admx + cs-CZ / en-US ADML ze seznamu níže.
//   node scripts/policy-templates.mjs   (z kořene repozitáře, po změně zásad v org_policy.rs)
import fs from "node:fs";
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KEY = "Software\\Policies\\HubGet";
// Zásady: shodně s src-tauri/src/org_policy.rs
const P = [
  { name: "AllowedSources", kind: "text",
    cs: ["Povolení správci balíčků", "Správce balíčků, které HubGet smí používat, oddělené středníkem: winget, chocolatey, scoop, npm, bun, pip, cargo, vcpkg, dotnet, pwsh, powershell.\n\nNapříklad „winget;scoop“. Instalaci a aktualizaci přes jiného správce HubGet odmítne a v Nastavení ho nejde zapnout.\n\nNení-li zásada nastavená, uživatel může používat všechny správce.", "Správci (oddělte středníkem):"],
    en: ["Allowed package managers", "Package managers HubGet may use, separated by semicolons: winget, chocolatey, scoop, npm, bun, pip, cargo, vcpkg, dotnet, pwsh, powershell.\n\nFor example “winget;scoop”. HubGet refuses to install or update through any other manager, and it can’t be turned on in Settings.\n\nIf this policy isn’t configured, all package managers can be used.", "Package managers (separated by semicolons):"] },
  { name: "AllowedApps", kind: "list",
    cs: ["Schválené aplikace", "Jen tyto aplikace půjde v HubGetu nainstalovat. Zadejte id balíčku (VideoLAN.VLC) nebo zdroj a id (scoop:extras/vlc), každé zvlášť.\n\nAktualizace a odinstalace už nainstalovaných aplikací zůstanou možné. Hodí se pro firmy i jako rodičovská kontrola.\n\nNení-li zásada nastavená, lze instalovat jakoukoli aplikaci.", "Povolené aplikace:"],
    en: ["Approved apps", "Only these apps can be installed in HubGet. Enter the package id (VideoLAN.VLC) or the source and id (scoop:extras/vlc), one per line.\n\nUpdating and uninstalling apps that are already installed stays possible. Useful in companies and as parental control.\n\nIf this policy isn’t configured, any app can be installed.", "Allowed apps:"] },
  { name: "DisableDeveloperMode", kind: "flag",
    cs: ["Zakázat režim Vývojář", "HubGet nebude nabízet režim Vývojář ani instalovat přes npm, Bun, pip, Cargo, vcpkg, .NET Tool a PowerShell."],
    en: ["Turn off Developer mode", "HubGet won’t offer Developer mode and won’t install through npm, Bun, pip, Cargo, vcpkg, .NET Tool and PowerShell."] },
  { name: "DisableCustomCommands", kind: "flag",
    cs: ["Zakázat vlastní argumenty a příkazy", "Vlastní argumenty instalátoru a příkazy před instalací a po ní nepůjde zapnout ani převzít z importované sady; HubGet je zahodí."],
    en: ["Turn off custom arguments and commands", "Custom installer arguments and commands before and after installation can’t be turned on or taken over from an imported bundle; HubGet discards them."] },
  { name: "DisableSignIn", kind: "flag",
    cs: ["Zakázat přihlášení a synchronizaci", "HubGet nenabídne přihlášení přes GitHub, synchronizaci mezi počítači, hodnocení ani snímky od uživatelů. Přihlášený uživatel se odhlásí."],
    en: ["Turn off sign-in and sync", "HubGet won’t offer GitHub sign-in, sync between PCs, reviews or user screenshots. A signed-in user is signed out."] },
  { name: "ForceAutomaticUpdates", kind: "flag",
    cs: ["Vynutit automatické aktualizace", "HubGet bude aktualizace kontrolovat a instalovat automaticky u všech aplikací (podle plánu v Nastavení); uživatel je nemůže vypnout."],
    en: ["Require automatic updates", "HubGet checks for and installs updates automatically for all apps (on the schedule in Settings); the user can’t turn this off."] },
  { name: "MinimumUpdateAgeDays", kind: "decimal",
    cs: ["Minimální stáří aktualizací", "Nová verze se nabídne až po zadaném počtu dní od vydání (0–365). Bezpečnostní aktualizace podle Nastavení nečekají.", "Počet dní:"],
    en: ["Minimum update age", "A new version is offered only after the given number of days since its release (0–365). Security updates don’t wait, depending on Settings.", "Number of days:"] },
  { name: "DisableSelfUpdate", kind: "flag",
    cs: ["Zakázat aktualizace HubGetu", "HubGet nebude hledat ani instalovat své nové verze – hodí se, když HubGet nasazujete jako MSI a verze spravujete sami."],
    en: ["Turn off HubGet updates", "HubGet won’t look for or install its own new versions – useful when you deploy HubGet as an MSI and manage versions yourself."] },
];

const policy = (p) => {
  const head = `    <policy name="${p.name}" class="Both" displayName="$(string.${p.name})" explainText="$(string.${p.name}_Help)"`;
  const tail = `      <parentCategory ref="HubGet" />\n      <supportedOn ref="SUPPORTED_HubGet" />`;
  if (p.kind === "flag") {
    return `${head} key="${KEY}" valueName="${p.name}">\n${tail}\n      <enabledValue><decimal value="1" /></enabledValue>\n      <disabledValue><decimal value="0" /></disabledValue>\n    </policy>`;
  }
  const element =
    p.kind === "text"
      ? `<text id="${p.name}Value" valueName="${p.name}" required="true" />`
      : p.kind === "list"
        ? `<list id="${p.name}Value" key="${KEY}\\${p.name}" valuePrefix="" />`
        : `<decimal id="${p.name}Value" valueName="${p.name}" minValue="0" maxValue="365" required="true" />`;
  return `${head} presentation="$(presentation.${p.name})" key="${KEY}">\n${tail}\n      <elements>\n        ${element}\n      </elements>\n    </policy>`;
};

const NS = `xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" revision="1.0" schemaVersion="1.0" xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions"`;
const admx = `<?xml version="1.0" encoding="utf-8"?>
<!-- Zásady skupiny pro HubGet (src-tauri/src/org_policy.rs). HubGet.admx a složky jazyků
     zkopírujte do C:\\Windows\\PolicyDefinitions (nebo do centrálního úložiště domény). -->
<policyDefinitions ${NS}>
  <policyNamespaces>
    <target prefix="hubget" namespace="HubGet.Policies.HubGet" />
    <using prefix="windows" namespace="Microsoft.Policies.Windows" />
  </policyNamespaces>
  <resources minRequiredRevision="1.0" />
  <supportedOn>
    <definitions>
      <definition name="SUPPORTED_HubGet" displayName="$(string.SUPPORTED_HubGet)" />
    </definitions>
  </supportedOn>
  <categories>
    <category name="HubGet" displayName="$(string.HubGet)" />
  </categories>
  <policies>
${P.map(policy).join("\n")}
  </policies>
</policyDefinitions>
`;
fs.writeFileSync("policies/HubGet.admx", admx);

const adml = (lang, description, supported) => {
  const strings = [
    `      <string id="HubGet">HubGet</string>`,
    `      <string id="SUPPORTED_HubGet">${esc(supported)}</string>`,
    ...P.flatMap((p) => [`      <string id="${p.name}">${esc(p[lang][0])}</string>`, `      <string id="${p.name}_Help">${esc(p[lang][1])}</string>`]),
  ];
  const presentations = P.filter((p) => p.kind !== "flag").map((p) => {
    const label = esc(p[lang][2]);
    const inner =
      p.kind === "text"
        ? `<textBox refId="${p.name}Value"><label>${label}</label><defaultValue>winget</defaultValue></textBox>`
        : p.kind === "list"
          ? `<listBox refId="${p.name}Value">${label}</listBox>`
          : `<decimalTextBox refId="${p.name}Value" defaultValue="7">${label}</decimalTextBox>`;
    return `      <presentation id="${p.name}">\n        ${inner}\n      </presentation>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitionResources ${NS}>
  <displayName>HubGet</displayName>
  <description>${esc(description)}</description>
  <resources>
    <stringTable>
${strings.join("\n")}
    </stringTable>
    <presentationTable>
${presentations.join("\n")}
    </presentationTable>
  </resources>
</policyDefinitionResources>
`;
};
fs.writeFileSync("policies/cs-CZ/HubGet.adml", adml("cs", "Zásady skupiny pro HubGet – obchod s aplikacemi pro Windows.", "HubGet se zásadami skupiny"));
fs.writeFileSync("policies/en-US/HubGet.adml", adml("en", "Group Policy settings for HubGet – an app store for Windows.", "HubGet with Group Policy support"));
console.log("ok");
