import { ArrowRight, ExternalLink, Image, Mail, Palette, ShieldCheck, Sparkles, Tags, Upload, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isTauri } from "@/lib/tauri";
import { GitHubIcon } from "@/components/ui/BrandIcons";
import { HubGetLogo } from "@/components/ui/Logo";
import { SourceIcon } from "@/components/package/SourceIcon";
import { VerifiedBadge } from "@/components/package/VerifiedBadge";
import { DeveloperStats } from "@/components/publish/DeveloperStats";
import { CONTACT_PATH, GITHUB_URL } from "@/config";
import { useInstallableStats } from "@/hooks/usePackages";
import { cn, formatAppCount } from "@/lib/utils";
import { getSource } from "@/services/managers";
import { useSettings } from "@/store/settings";
import type { SourceId } from "@/types";

/** Kde a jak aplikaci vydat v jednotlivých správcích. */
const CHANNELS: { source: SourceId; commands: string[]; docs: string; recommended?: boolean }[] = [
  {
    source: "winget",
    commands: ["wingetcreate new <URL instalátoru>"],
    docs: "https://learn.microsoft.com/windows/package-manager/package/",
    recommended: true,
  },
  {
    source: "chocolatey",
    commands: ["choco new mojeaplikace", "choco push"],
    docs: "https://docs.chocolatey.org/en-us/create/create-packages/",
  },
  {
    source: "scoop",
    commands: ["scoop create <URL archivu>"],
    docs: "https://github.com/ScoopInstaller/Scoop/wiki/App-Manifests",
  },
  // Nástroje a knihovny pro vývojáře (Bun instaluje z npm, oba PowerShelly z PowerShell Gallery)
  { source: "npm", commands: ["npm publish"], docs: "https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages" },
  { source: "pip", commands: ["python -m build", "twine upload dist/*"], docs: "https://packaging.python.org/tutorials/packaging-projects/" },
  { source: "cargo", commands: ["cargo publish"], docs: "https://doc.rust-lang.org/cargo/reference/publishing.html" },
  { source: "vcpkg", commands: ["vcpkg new --application"], docs: "https://learn.microsoft.com/vcpkg/get_started/get-started-adding-to-registry" },
  { source: "dotnet", commands: ["dotnet pack", "dotnet nuget push"], docs: "https://learn.microsoft.com/dotnet/core/tools/global-tools-how-to-create" },
  { source: "pwsh", commands: ["Publish-PSResource -Path ./MujModul"], docs: "https://learn.microsoft.com/powershell/gallery/how-to/publishing-packages/publishing-a-package" },
];

const VERIFY_URL = `${GITHUB_URL}/issues/new?title=${encodeURIComponent("Žádost o ověření vydavatele: ")}&labels=verification`;

/**
 * Stránka pro vývojáře: jak dostat aplikaci do HubGetu (vydat ji ve winget,
 * Chocolatey nebo Scoop), jak vylepšit její stránku a jak získat ověření.
 */
export function PublishPage() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { total } = useInstallableStats();

  const steps = [
    { title: t("publish.step1Title"), text: t("publish.step1Text") },
    { title: t("publish.step2Title"), text: t("publish.step2Text") },
    { title: t("publish.step3Title"), text: t("publish.step3Text") },
  ];

  const improvements = [
    { Icon: Image, text: t("publish.improveScreenshots") },
    { Icon: Palette, text: t("publish.improveBanner") },
    { Icon: Tags, text: t("publish.improveCategories") },
    { Icon: ShieldCheck, text: t("publish.improvePrivacy") },
  ];

  return (
    <div>
      {/* Úvod */}
      <section className="relative mb-10 overflow-hidden rounded-3xl border border-line bg-surface p-10 shadow-card">
        <div aria-hidden className="absolute -top-24 -right-10 size-80 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-8">
          <HubGetLogo size={88} className="rounded-[21px] shadow-xl shadow-accent/30" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">{t("publish.eyebrow")}</p>
            <h1 className="mt-1 font-display text-4xl font-bold tracking-tight">{t("publish.title")}</h1>
            <p className="mt-2 max-w-xl text-lg text-muted">
              {t("publish.subtitle", { count: formatAppCount(total, language) })}
            </p>
          </div>
        </div>
      </section>

      {/* Jak to funguje */}
      <Section title={t("publish.howTitle")}>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-surface p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent font-display text-sm font-bold text-accent-fg">
                {i + 1}
              </span>
              <p className="mt-3 font-semibold">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Kde aplikaci vydat */}
      <Section title={t("publish.whereTitle")} subtitle={t("publish.whereSubtitle")}>
        {/* Zvlášť aplikace a nástroje / knihovny pro vývojáře */}
        {(["apps", "dev"] as const).map((group) => (
          <div key={group} className="mb-6 last:mb-0">
            <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">{t(`sources.group.${group}`)}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {CHANNELS.filter((c) => getSource(c.source).group === group).map((channel) => (
                <ChannelCard key={channel.source} {...channel} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* Vylepšete stránku + ověření */}
      <div className="mb-10 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-line bg-surface p-7">
          <p className="flex items-center gap-2 font-display text-xl font-bold">
            <Sparkles className="size-5 text-amber-400" />
            {t("publish.improveTitle")}
          </p>
          <p className="mt-2 text-sm text-muted">{t("publish.improveText")}</p>
          <ul className="mt-4 flex flex-col gap-2.5">
            {improvements.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
                  <Icon className="size-3.5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface-2 px-5 text-sm font-semibold transition-colors hover:bg-surface-3"
          >
            <GitHubIcon className="size-4" />
            {t("publish.improveCta")}
          </a>
        </div>

        <div className="rounded-3xl border border-line bg-surface p-7">
          <p className="flex items-center gap-2 font-display text-xl font-bold">
            <VerifiedBadge size={22} />
            {t("publish.verifyTitle")}
          </p>
          <p className="mt-2 text-sm text-muted">{t("publish.verifyText")}</p>
          <ol className="mt-4 flex flex-col gap-2 text-sm">
            <li className="flex gap-2">
              <span className="font-semibold text-accent">1.</span>
              <span>
                {t("publish.verifyStep1")}{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs select-text">hubget-verify=&lt;id&gt;</code>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-accent">2.</span>
              <span>{t("publish.verifyStep2")}</span>
            </li>
          </ol>
          <a
            href={VERIFY_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
          >
            <Upload className="size-4" />
            {t("publish.verifyCta")}
            <ArrowRight className="size-4" />
          </a>
        </div>
      </div>

      {/* Instalace vaší aplikace přes HubGet a co lidé v katalogu postrádají */}
      <DeveloperStats />

      {/* Dotazy */}
      <section className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-surface-2/60 px-7 py-6">
        <div>
          <p className="font-semibold">{t("publish.questionsTitle")}</p>
          <p className="text-sm text-muted">{t("publish.questionsText")}</p>
        </div>
        <div className="flex gap-2">
          <Link
            to={CONTACT_PATH}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold transition-colors hover:bg-surface-3"
          >
            <Mail className="size-4" />
            {t("community.contact")}
          </Link>
        </div>
      </section>
    </div>
  );
}

/** Karta jednoho správce: k čemu je, příkazy pro vydání a odkaz na dokumentaci. */
function ChannelCard({ source, commands, docs, recommended }: (typeof CHANNELS)[number]) {
  const { t } = useTranslation();
  const meta = getSource(source);
  return (
    <div className={cn("flex flex-col rounded-2xl border bg-surface p-5", recommended ? "border-accent/50" : "border-line")}>
      <div className="flex items-center gap-2">
        <SourceIcon source={source} className="text-muted" />
        <p className="font-semibold">{meta.label}</p>
        {recommended && (
          <span className="ml-auto rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent">
            {t("publish.recommended")}
          </span>
        )}
      </div>
      <p className="mt-2 flex-1 text-sm text-muted">{t(`publish.channel_${source}`)}</p>
      <div className="mt-4 flex flex-col gap-1.5">
        {commands.map((c) => (
          <code key={c} className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs select-text">
            {c}
          </code>
        ))}
      </div>
      {/* WinGet: manifest jde vytvořit a odeslat přímo v HubGetu (desktop) */}
      {source === "winget" && isTauri() && (
        <Link
          to="/publish/winget"
          className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
        >
          <Wand2 className="size-4" />
          {t("publish.wingetWizard")}
        </Link>
      )}
      <a
        href={docs}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
      >
        {t("publish.docs")}
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
