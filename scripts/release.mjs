// Vydání nové verze HubGetu:
//  1. zvýší verzi (0.1.2 → 0.1.3; nebo zadaná: `pnpm release 0.2.0`),
//  2. sestaví instalátory s podpisem pro automatické aktualizace
//     (klíč %USERPROFILE%\.tauri\unibox-updater.key, nebo UNIBOX_UPDATER_KEY)
//     a – je-li v prostředí certifikát – s digitálním podpisem kódu
//     (Authenticode, scripts/sign.mjs: unibox.exe, instalátor NSIS i MSI),
//  3. aktualizuje domovskou stránku webu – verzi, velikost instalátorů a sekci
//     „To nejlepší z verze“ z src/data/changelog.ts (scripts/website-release.mjs) –
//     a Novinky s Co chystáme z website/content/ (scripts/website-content.mjs),
//  4. vytvoří latest.json – soubor, podle kterého nainstalované HubGet
//     poznají novou verzi. Nahrajte ho spolu s instalátorem do GitHub Release
//     se značkou v<verze> (viz README.cs.md → Aktualizace HubGetu).
//
//   pnpm release                     → další číslo verze
//   pnpm release 0.2.0               → konkrétní verze
//   pnpm release -- --notes "Co je nového"
//   pnpm release -- --no-bump        → bez změny verze (opakované sestavení)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeIdentity, signingIdentity } from "./sign.mjs";
import { writeUpdaterManifest } from "./updater-manifest.mjs";
import { updateContent } from "./website-content.mjs";
import { updateWebsite } from "./website-release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : (args[i + 1] ?? "");
};
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

const run = (command, env = {}) => {
  const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// 1. Verze
if (!args.includes("--no-bump")) run(`node scripts/bump-version.mjs ${version ?? ""}`);
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const current = config.version;

// 2. Sestavení – s podpisem aktualizací, je-li k dispozici klíč,
//    a s podpisem kódu, je-li v prostředí certifikát (jinak varování SmartScreenu)
const key = process.env.UNIBOX_UPDATER_KEY ?? join(homedir(), ".tauri", "unibox-updater.key");
const updater = existsSync(key);
if (!updater) {
  console.warn(`\n! Klíč pro podpis aktualizací nenalezen (${key}) – sestaví se instalátor bez aktualizačních souborů.\n`);
}
const identity = signingIdentity();
if (identity) {
  console.log(`\nPodpis kódu: ${describeIdentity(identity)}\n`);
} else {
  console.warn(
    "\n! Certifikát pro podpis kódu není nastavený (UNIBOX_SIGN_PFX nebo UNIBOX_SIGN_THUMBPRINT) – instalátor\n" +
      "  nebude podepsaný a Windows SmartScreen ho označí jako neznámý. Viz README.cs.md → Podpis kódu.\n",
  );
}
const bundleConfig = {};
if (updater) bundleConfig.createUpdaterArtifacts = true;
// Tauri zavolá podpis pro každý soubor zvlášť, %1 = cesta k souboru (objektový zápis kvůli mezerám v cestách)
if (identity) bundleConfig.windows = { signCommand: { cmd: process.execPath, args: [join(root, "scripts", "sign.mjs"), "%1"] } };
const override = join(tmpdir(), "unibox-release-build.json");
writeFileSync(override, JSON.stringify({ bundle: bundleConfig }));
run(
  `pnpm tauri build --config "${override}"`,
  updater ? { TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.UNIBOX_UPDATER_KEY_PASSWORD ?? "" } : {},
);

// 3. Domovská stránka webu podle nové verze
const websiteWarnings = await updateWebsite(root, current);
console.log(`\nWeb: domovská stránka aktualizována na verzi ${current} (website/index.html, website/en/index.html).`);
for (const warning of websiteWarnings) console.warn(`! ${warning}`);
const content = updateContent(root);
console.log(`Web: Novinky (${content.versions.length} verzí) a Co chystáme vygenerované z website/content/.`);
for (const { file, message } of content.warnings) console.warn(`! ${file}: ${message}`);
if (!content.versions.includes(current)) console.warn(`! V Novinkách chybí verze ${current} – přidejte ji v Pages CMS (website/content/novinky/).`);
if (!updater) process.exit(0);

// 4. latest.json pro GitHub Releases
const { bundle, installer, endpoint } = writeUpdaterManifest(flag("notes"));

console.log(`\nHubGet ${current} je připravený k vydání (${bundle}):`);
console.log(`  ${installer}   – instalátor`);
console.log(`  latest.json${" ".repeat(Math.max(1, installer.length - 11))}   – informace o verzi pro automatické aktualizace`);
console.log(identity ? `  Podpis kódu: ${describeIdentity(identity)}` : "  Bez podpisu kódu – Windows SmartScreen bude varovat.");
console.log(`\nNahrajte oba soubory do GitHub Release se značkou v${current}.`);
if (endpoint.includes("YOUR-ORG")) {
  console.warn("! V src-tauri/tauri.conf.json (plugins.updater.endpoints) je zatím zástupná adresa YOUR-ORG/unibox.");
}
