import { ExternalLink, Flag, Mail, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import pkgJson from "../../../package.json";
import { GitHubIcon } from "@/components/ui/BrandIcons";
import { Modal } from "@/components/ui/Modal";
import { CONTACT_PATH, GITHUB_URL } from "@/config";
import { cn } from "@/lib/utils";
import { getSource, sourcePackageUrl } from "@/services/managers";
import { useContact } from "@/store/contact";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry, PackageSource, SourceId } from "@/types";

type ProblemType = "install" | "info" | "outdated" | "malicious" | "other";
const PROBLEM_TYPES: ProblemType[] = ["install", "info", "outdated", "malicious", "other"];

/** Kde nahlásit podezřelý balíček přímo u správce zdroje. */
function sourceReportUrl(source: SourceId, packageId: string): string {
  switch (source) {
    case "winget":
      return "https://github.com/microsoft/winget-pkgs/issues/new/choose";
    case "chocolatey":
      return `https://community.chocolatey.org/packages/${encodeURIComponent(packageId)}`;
    case "scoop": {
      // Bucket „extras/firefox“ → repozitář ScoopInstaller/Extras
      const bucket = packageId.includes("/") ? packageId.split("/")[0] : "main";
      return `https://github.com/ScoopInstaller/${bucket.charAt(0).toUpperCase()}${bucket.slice(1)}/issues/new/choose`;
    }
    // Registry pro vývojáře mají na stránce balíčku odkaz pro nahlášení (malware, zneužití)
    case "npm":
    case "bun":
    case "pip":
    case "cargo":
      return sourcePackageUrl(source, packageId);
    case "vcpkg":
      return `https://github.com/microsoft/vcpkg/issues/new?title=${encodeURIComponent(`[${packageId}] `)}`;
    case "dotnet":
      return `https://www.nuget.org/packages/${encodeURIComponent(packageId)}/ReportAbuse`;
    case "pwsh":
    case "powershell":
      return `https://www.powershellgallery.com/packages/${encodeURIComponent(packageId)}/ReportAbuse`;
  }
}

interface ReportButtonProps {
  entry: CatalogEntry;
  /** Zdroj, kterého se hlášení týká (zvolený / nainstalovaný); aplikace jen z webu výrobce žádný nemá. */
  pkg: PackageSource | undefined;
  installedVersion?: string;
}

/**
 * Nahlášení problému s aplikací. Hlášení se odešle jako předvyplněné issue
 * na GitHubu projektu (nebo zprávou přes kontaktní formulář) včetně údajů
 * o balíčku a verzi HubGetu.
 */
export function ReportButton({ entry, pkg, installedVersion }: ReportButtonProps) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const navigate = useNavigate();
  const prefillContact = useContact((s) => s.prefill);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ProblemType>("install");
  const [details, setDetails] = useState("");

  const sourceLabel = pkg ? getSource(pkg.source).label : "";
  const typeLabel = t(`report.types.${type}`);

  // Automaticky přiložené údaje (zobrazí se i uživateli, nic se neposílá skrytě)
  const diagnostics = [
    `${t("report.diagApp")}: ${entry.name} (${entry.id})`,
    pkg
      ? `${t("report.diagSource")}: ${sourceLabel} – ${pkg.packageId} ${pkg.version}`
      : `${t("report.diagSource")}: ${entry.downloadUrl ?? "—"}`,
    installedVersion ? `${t("report.diagInstalled")}: ${installedVersion}` : null,
    `HubGet ${pkgJson.version}`,
  ].filter(Boolean) as string[];

  const title = `[${typeLabel}] ${entry.name}`;
  const body = [
    `**${t("report.diagType")}:** ${typeLabel}`,
    "",
    `**${t("report.details")}:**`,
    details.trim() || "_—_",
    "",
    "---",
    ...diagnostics.map((d) => `- ${d}`),
  ].join("\n");

  const githubUrl = `${GITHUB_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent("report")}`;

  // Zpráva přes kontaktní formulář: hlášení se předvyplní, e-mail pro odpověď doplní uživatel
  const writeToUs = () => {
    prefillContact("bug", `${title}\n\n${body.replace(/\*\*/g, "").replace("_—_", "—")}`);
    setOpen(false);
    setDetails("");
    navigate(CONTACT_PATH);
  };

  const sent = () => {
    setOpen(false);
    setDetails("");
    toast("success", t("report.thanks"));
  };

  return (
    <>
      <button
        type="button"
        aria-label={t("report.button")}
        title={t("report.button")}
        onClick={() => setOpen(true)}
        className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-fg transition-colors hover:bg-danger/12 hover:text-danger"
      >
        <Flag className="size-5" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("report.title", { name: entry.name })}
        className="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={writeToUs}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface-2 px-4 text-sm font-semibold transition-colors hover:bg-surface-3"
            >
              <Mail className="size-4" />
              {t("report.sendMessage")}
            </button>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              onClick={sent}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:brightness-110"
            >
              <GitHubIcon className="size-4" />
              {t("report.sendGithub")}
              <ExternalLink className="size-3.5 opacity-70" />
            </a>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted">{t("report.intro")}</p>

        {/* Typ problému */}
        <div role="radiogroup" aria-label={t("report.diagType")} className="flex flex-col gap-1.5">
          {PROBLEM_TYPES.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={type === id}
              onClick={() => setType(id)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors",
                type === id ? "border-accent/50 bg-accent/10" : "border-line hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                  type === id ? "border-accent" : "border-muted/50",
                )}
              >
                {type === id && <span className="size-2 rounded-full bg-accent" />}
              </span>
              {t(`report.types.${id}`)}
            </button>
          ))}
        </div>

        {/* U podezřelého balíčku odkaz na nahlášení přímo správci zdroje */}
        {type === "malicious" && pkg && (
          <a
            href={sourceReportUrl(pkg.source, pkg.packageId)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-start gap-2.5 rounded-xl bg-danger/10 px-3.5 py-2.5 text-xs text-danger hover:underline"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {t("report.maliciousHint", { source: sourceLabel })}
          </a>
        )}

        <label className="mt-4 block text-sm font-medium" htmlFor="report-details">
          {t("report.details")}
        </label>
        <textarea
          id="report-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t("report.detailsPlaceholder")}
          rows={4}
          maxLength={2000}
          className="mt-1.5 w-full resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none transition-shadow select-text placeholder:text-muted focus:border-accent/50 focus:ring-4 focus:ring-accent/15"
        />

        {/* Přiložené údaje – viditelně, ať uživatel ví, co se odešle */}
        <p className="mt-4 mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{t("report.attached")}</p>
        <ul className="rounded-xl bg-surface-2 px-3.5 py-2.5 font-mono text-[11px] leading-5 text-muted select-text">
          {diagnostics.map((d) => (
            <li key={d} className="truncate">
              {d}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
