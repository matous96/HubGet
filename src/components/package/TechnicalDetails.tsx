import { useQuery } from "@tanstack/react-query";
import {
  FileType,
  ArrowRight,
  Check,
  CircleAlert,
  Cpu,
  Download,
  ExternalLink,
  FlaskConical,
  HardDrive,
  Layers,
  MonitorCheck,
  Package,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { queryKeys } from "@/app/queryClient";
import { useDeviceArch } from "@/hooks/useDeviceArch";
import { useSystemInfo } from "@/hooks/useSystemInfo";
import { useCatalog, useInstalledIndex } from "@/hooks/usePackages";
import { allArchitectures, ARCH_LABEL, ARCHES, compatibility } from "@/lib/arch";
import { cn, formatSizeText } from "@/lib/utils";
import { windowsRequirement } from "@/lib/windows";
import { getSource, managers, sourceCommand } from "@/services/managers";
import { useInstallUi } from "@/store/installUi";
import { useSettings } from "@/store/settings";
import type { CatalogEntry, Dependency, PackageSource } from "@/types";
import { CopyCommand } from "./ManualInstallDialog";

/** Kde se aplikace typicky nainstaluje (podle zdroje a rozsahu). */
const LOCATION: Partial<Record<PackageSource["source"], string>> = {
  scoop: "%USERPROFILE%\\scoop\\apps",
  npm: "%APPDATA%\\npm",
  bun: "%USERPROFILE%\\.bun\\bin",
  pip: "%APPDATA%\\Python",
  cargo: "%USERPROFILE%\\.cargo\\bin",
  dotnet: "%USERPROFILE%\\.dotnet\\tools",
};

/**
 * Technické údaje aplikace pro zvolený zdroj: systémové požadavky, kontrolní
 * součet SHA-256, rozsah instalace (User / Machine), velikost ke stažení
 * a na disku, způsob odinstalace a závislosti.
 */
export function TechnicalDetails({ entry, pkg }: { entry: CatalogEntry; pkg: PackageSource }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { data } = useCatalog();
  const meta = getSource(pkg.source);
  const isSample = !!data?.catalog.sample;

  return (
    <section className="mb-10 border-t border-line pt-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-bold">{t("tech.title")}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {t("tech.forSource", { source: meta.label })}
        </span>
        {isSample && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            <FlaskConical className="size-3" />
            {t("reviews.sample")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        <Requirements entry={entry} pkg={pkg} />
        <Checksum pkg={pkg} />
        <Scope entry={entry} pkg={pkg} />
        <Sizes pkg={pkg} language={language} />
        <Uninstall pkg={pkg} language={language} />
        <FileTypes entry={entry} />
      </div>

      <Dependencies entry={entry} pkg={pkg} />
    </section>
  );
}

/** Soubory, které aplikace otevírá (přípony z manifestu wingetu) – odkazy na „Čím otevřu“. */
function FileTypes({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const extensions = entry.fileExtensions ?? [];
  if (!extensions.length) return null;
  const shown = all ? extensions : extensions.slice(0, 24);
  return (
    <Card icon={FileType} title={t("tech.fileTypes", { count: extensions.length })}>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((ext) => (
          <Link
            key={ext}
            to={`/open-with?ext=${encodeURIComponent(ext)}`}
            title={t("openWith.title", { ext })}
            className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs transition-colors hover:bg-surface-3 hover:text-accent"
          >
            .{ext}
          </Link>
        ))}
        {extensions.length > shown.length && (
          <button type="button" onClick={() => setAll(true)} className="cursor-pointer px-1 text-xs font-semibold text-accent hover:underline">
            {t("tech.fileTypesMore", { count: extensions.length - shown.length })}
          </button>
        )}
      </div>
    </Card>
  );
}

/** Karta s ikonou a nadpisem. */
function Card({ icon: Icon, title, children, className }: { icon: LucideIcon; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface p-5", className)}>
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-accent" />
        {title}
      </p>
      {children}
    </div>
  );
}

/** Systémové požadavky: verze Windows, architektury a kompatibilita s tímto PC. */
function Requirements({ entry, pkg }: { entry: CatalogEntry; pkg: PackageSource }) {
  const { t } = useTranslation();
  const device = useDeviceArch();
  const system = useSystemInfo();
  const req = windowsRequirement(pkg.minOsVersion);
  // Minimální sestavení Windows z manifestu („10.0.17763.0“ → 17763)
  const requiredBuild = Number(pkg.minOsVersion?.split(".")[2] ?? 0);
  const osOk = !system || system.osBuild >= requiredBuild;
  const archs = pkg.architectures?.length ? pkg.architectures : allArchitectures(entry.sources);
  const only64 = archs.length > 0 && !archs.includes("x86");
  const compat = device && archs.length ? compatibility(device, archs) : null;

  const os = !req.os
    ? t("tech.osAny")
    : req.os === "Windows 10"
      ? req.version
        ? t("tech.osWin10From", { version: req.version })
        : t("tech.osAny")
      : req.version
        ? t("tech.osWin11From", { version: req.version })
        : t("tech.osWin11");

  return (
    <Card icon={Cpu} title={t("tech.requirements")}>
      <p className="text-[15px] font-medium">{os}</p>
      {archs.length > 0 && (
        <p className="mt-1 text-sm text-muted">
          {only64 ? t("tech.bits64") : t("tech.bits3264")} · {ARCHES.filter((a) => archs.includes(a)).map((a) => ARCH_LABEL[a]).join(", ")}
        </p>
      )}
      {compat && (
        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-xs font-medium",
            compat === "unsupported" ? "text-danger" : "text-success",
          )}
        >
          {compat === "unsupported" ? <CircleAlert className="size-3.5" /> : <MonitorCheck className="size-3.5" />}
          {t(`tech.compat_${compat}`, { arch: ARCH_LABEL[device!] })}
        </p>
      )}
      {/* Verze Windows tohoto počítače (jen v desktopové aplikaci) */}
      {system && system.osBuild > 0 && (
        <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs font-medium", osOk ? "text-success" : "text-danger")}>
          {osOk ? <MonitorCheck className="size-3.5" /> : <CircleAlert className="size-3.5" />}
          {t(osOk ? "tech.osOk" : "tech.osTooOld", {
            os: [system.osName, system.osDisplayVersion].filter(Boolean).join(" "),
            build: requiredBuild,
          })}
        </p>
      )}
    </Card>
  );
}

/** Kontrolní součet SHA-256 s kopírováním a informací, kdy se ověřuje. */
function Checksum({ pkg }: { pkg: PackageSource }) {
  const { t } = useTranslation();
  const meta = getSource(pkg.source);
  // Správci aplikací součet před instalací vždy ověří
  const verified = meta.group === "apps";

  return (
    <Card icon={ShieldCheck} title={t("tech.checksum")}>
      {pkg.sha256 ? (
        <>
          <CopyCommand command={pkg.sha256} />
          <p className={cn("mt-2 flex items-start gap-1.5 text-xs", verified ? "text-success" : "text-muted")}>
            {verified ? <Check className="mt-px size-3.5 shrink-0" /> : <ShieldCheck className="mt-px size-3.5 shrink-0" />}
            {verified ? t("tech.checksumVerified", { source: meta.label }) : t("tech.checksumRegistry", { source: meta.label })}
          </p>
          {/* Výsledky antivirů pro tentýž soubor – stránka VirusTotalu podle otisku, bez klíče a bez nahrávání */}
          <a
            href={`https://www.virustotal.com/gui/file/${pkg.sha256.toLowerCase()}`}
            target="_blank"
            rel="noreferrer"
            title={t("tech.virusTotalHint")}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {t("tech.virusTotal")}
          </a>
        </>
      ) : (
        <p className="text-sm text-muted">{t("tech.checksumNone")}</p>
      )}
    </Card>
  );
}

/** Rozsah instalace (User / Machine) a obvyklé umístění. */
function Scope({ entry, pkg }: { entry: CatalogEntry; pkg: PackageSource }) {
  const { t } = useTranslation();
  const openOptions = useInstallUi((s) => s.openOptions);
  const scopes = pkg.scopes ?? [];
  const both = scopes.includes("user") && scopes.includes("machine");
  const machine = scopes[0] === "machine";
  const location =
    LOCATION[pkg.source] ?? (machine ? "C:\\Program Files" : scopes.length ? "%LOCALAPPDATA%\\Programs" : null);

  return (
    <Card icon={Users} title={t("tech.scope")}>
      {scopes.length === 0 ? (
        <p className="text-sm text-muted">{t("tech.scopeUnknown")}</p>
      ) : (
        <>
          <p className="text-[15px] font-medium">
            {machine ? t("tech.scopeMachine") : t("tech.scopeUser")}{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">{machine ? "Machine" : "User"}</code>
          </p>
          {both && <p className="mt-1 text-sm text-muted">{t(machine ? "tech.scopeAlsoUser" : "tech.scopeAlsoMachine")}</p>}
          {location && <p className="mt-1 truncate font-mono text-xs text-muted">{location}\…</p>}
          {both && scopeConfigurable(pkg) && (
            <button
              type="button"
              onClick={() => openOptions(entry, pkg.source)}
              className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              {t("tech.scopeChange")}
              <ArrowRight className="size-3.5" />
            </button>
          )}
        </>
      )}
    </Card>
  );
}

/** Volbu rozsahu lze změnit jen u správců, které ji podporují. */
const scopeConfigurable = (pkg: PackageSource) => getSource(pkg.source).options.scope;

/** Velikost ke stažení vs. místo na disku po instalaci. */
function Sizes({ pkg, language }: { pkg: PackageSource; language: string }) {
  const { t } = useTranslation();
  if (!pkg.size) {
    return (
      <Card icon={HardDrive} title={t("tech.size")}>
        <p className="text-sm text-muted">{t("tech.sizeUnknown")}</p>
      </Card>
    );
  }
  const disk = pkg.installedSize ?? null;
  const ratio = disk ? Math.min(pkg.size / disk, 1) : 1;

  return (
    <Card icon={HardDrive} title={t("tech.size")}>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-1.5 text-muted">
            <Download className="size-3.5" />
            {t("tech.download")}
          </dt>
          <dd className="font-semibold tabular-nums">{formatSizeText(pkg.size, language)}</dd>
        </div>
        {disk && (
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-muted">
              <HardDrive className="size-3.5" />
              {t("tech.onDisk")}
            </dt>
            <dd className="font-semibold tabular-nums">~{formatSizeText(disk, language)}</dd>
          </div>
        )}
      </dl>
      {/* Poměr stažení / místo na disku */}
      {disk && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(ratio * 100, 4)}%` }} />
        </div>
      )}
    </Card>
  );
}

/** Jak se aplikace odinstaluje a kolik místa uvolní. */
function Uninstall({ pkg, language }: { pkg: PackageSource; language: string }) {
  const { t } = useTranslation();
  const meta = getSource(pkg.source);
  const free = pkg.installedSize ? formatSizeText(pkg.installedSize, language) : null;
  const text =
    pkg.source === "scoop"
      ? t("tech.uninstallScoop")
      : meta.group === "apps"
        ? t("tech.uninstallApps")
        : t("tech.uninstallDev", { source: meta.label });

  return (
    <Card icon={Trash2} title={t("tech.uninstall")}>
      <p className="text-sm text-muted">{text}</p>
      {free && <p className="mt-2 text-sm font-medium">{t("tech.frees", { size: free })}</p>}
      {meta.group === "dev" && (
        <div className="mt-3">
          <CopyCommand command={sourceCommand(pkg.source, "uninstall", pkg.packageId)} />
        </div>
      )}
    </Card>
  );
}

/**
 * Závislosti: z katalogu (WSL, WebView2, Java…) a běhové prostředí, které
 * potřebují balíčky vývojářských správců (Node.js u npm, Python u pip…).
 */
function Dependencies({ entry, pkg }: { entry: CatalogEntry; pkg: PackageSource }) {
  const { t } = useTranslation();
  const meta = getSource(pkg.source);
  const fromCatalog = (entry.dependencies ?? []).filter((d) => !d.source || d.source === pkg.source);
  const runtime: Dependency | null = meta.runtime ? { name: meta.runtime.name, appId: meta.runtime.appId, kind: "runtime" } : null;
  const deps = runtime ? [runtime, ...fromCatalog] : fromCatalog;

  return (
    <div className="mt-6">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Layers className="size-5 text-accent" />
        {t("tech.dependencies")}
      </h3>
      {deps.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-5 py-4 text-sm text-muted">
          <Check className="size-4 text-success" />
          {t("tech.noDependencies")}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
          {deps.map((d, i) => (
            <DependencyRow key={`${d.name}-${i}`} dep={d} pkg={pkg} isRuntime={d === runtime} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DependencyRow({ dep, pkg, isRuntime }: { dep: Dependency; pkg: PackageSource; isRuntime: boolean }) {
  const { t } = useTranslation();
  const installedIndex = useInstalledIndex();
  // Běhové prostředí vývojářského správce je k dispozici, když správce funguje
  const status = useQuery({
    queryKey: queryKeys.managerStatus(pkg.source),
    queryFn: () => managers[pkg.source].getStatus(),
    enabled: isRuntime,
  });
  const Icon = dep.kind === "feature" ? Layers : dep.kind === "runtime" ? Cpu : Package;
  const installed = (dep.appId && installedIndex.has(dep.appId)) || (isRuntime && status.data?.available);

  let state: { text: string; tone: string };
  if (installed) state = { text: t("tech.depInstalled"), tone: "text-success" };
  else if (dep.kind === "feature") state = { text: t("tech.depFeature"), tone: "text-muted" };
  else if (pkg.source === "winget" && dep.kind === "package") state = { text: t("tech.depAuto"), tone: "text-accent" };
  else state = { text: dep.optional ? t("tech.depRecommended") : t("tech.depNeeded"), tone: dep.optional ? "text-muted" : "text-amber-500" };

  const name = (
    <span className="font-medium">
      {dep.name}
      {dep.minVersion && <span className="ml-1.5 text-muted">≥ {dep.minVersion}</span>}
    </span>
  );

  return (
    <li className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {dep.appId ? (
          <Link to={`/package/${encodeURIComponent(dep.appId)}`} className="hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
        <p className="text-xs text-muted">
          {t(`tech.depKind_${dep.kind}`)}
          {dep.optional && ` · ${t("tech.depOptional")}`}
          {isRuntime && ` · ${t("tech.depForSource", { source: getSource(pkg.source).label })}`}
        </p>
      </div>
      <span className={cn("flex shrink-0 items-center gap-1 text-xs font-semibold", state.tone)}>
        {installed && <Check className="size-3.5" />}
        {state.text}
      </span>
    </li>
  );
}
