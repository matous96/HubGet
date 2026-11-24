/**
 * Nahlásit chybu v manifestu wingetu (UpdateDoctorDialog): odkaz na nové hlášení v repozitáři
 * microsoft/winget-pkgs s předvyplněným nadpisem a textem podle jejich šablony „Package Issue“
 * (šablona nemá id polí, takže jde předvyplnit jen prázdné hlášení). Odeslání je na uživateli –
 * HubGet nic neposílá sám. Bez osobních údajů: jen id balíčku, verze, chyba a verze Windows.
 */
import type { HistoryEntry } from "@/store/history";

/** Chyby, za které nejspíš může manifest (odkaz, součet, kód instalátoru, který winget nezná). */
export const MANIFEST_ERRORS = new Set(["linkBroken", "hashMismatch", "inUseByOther", "installerFailed", "noInstaller"]);

const HINTS: Record<string, string> = {
  linkBroken: "The InstallerUrl in the manifest no longer works (HTTP error) – it probably needs to point to the new download location.",
  hashMismatch: "The installer at InstallerUrl doesn't match InstallerSha256 – the file was probably replaced on the server.",
  inUseByOther:
    "The installer exits with a non-zero code when its files are in use by other applications, but this version of the manifest doesn't map that code, so winget only reports a generic installer failure. Please add ExpectedReturnCodes (for example InstallerReturnCode 6 → packageInUseByApplication, as earlier versions of this package had).",
  installerFailed: "The installer fails with the arguments from the manifest.",
  noInstaller: "The manifest has no installer applicable to this system.",
};

export function manifestIssueUrl(entry: Pick<HistoryEntry, "packageId" | "kind" | "error" | "errorKey" | "version" | "toVersion">, windows?: string): string {
  const version = entry.toVersion ?? entry.version;
  const command = `winget ${entry.kind === "install" ? "install" : "upgrade"} --id ${entry.packageId} --exact${version ? ` --version ${version}` : ""}`;
  const hint = (entry.errorKey && HINTS[entry.errorKey]) || "";
  const body = [
    "### Category of the issue",
    entry.errorKey === "hashMismatch" ? "Installer hash mismatch." : "Installation issue.",
    "",
    "### Brief description of your issue",
    `${entry.packageId}${version ? ` ${version}` : ""} fails to ${entry.kind === "install" ? "install" : "update"} via winget. ${hint}`.trim(),
    "",
    "### Steps to reproduce",
    "```",
    command,
    "```",
    "",
    "### Actual behavior",
    entry.error ?? "",
    "",
    "### Expected behavior",
    "The package installs successfully.",
    "",
    "### Environment",
    windows ?? "Windows",
    "Reported with HubGet.",
  ].join("\n");
  const params = new URLSearchParams({ title: `[Package Issue]: ${entry.packageId}`, body, labels: "Issue-Bug" });
  return `https://github.com/microsoft/winget-pkgs/issues/new?${params}`;
}
