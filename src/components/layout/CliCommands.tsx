/**
 * Příkazy z terminálu (`hubget install vlc`, `hubget update`… – backend cli.rs):
 * backend je uloží a pošle událost „hubget-cli“, tady se vyzvednou a provedou přes
 * frontu operací (průběh v aplikaci, oznámení na konci). Příkaz napsal uživatel sám
 * na svém počítači, proto se instalace spustí hned – na rozdíl od odkazů z webu
 * (lib/deepLink.ts), které jen otevřou seznam k potvrzení.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useInstalledItems, useUpdates } from "@/hooks/useInstalledItems";
import {
  nameKey,
  parseSourceKey,
  pickSource,
  sourceKey,
  useCatalog,
  useCatalogIndex,
  useSourceIndex,
} from "@/hooks/usePackages";
import { isTauri } from "@/lib/tauri";
import { getSource } from "@/services/managers";
import { updateOptionsFor } from "@/store/installOptions";
import { useBusyAppIds, useJobs } from "@/store/jobs";
import { useSourceScope } from "@/store/sourceLock";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry } from "@/types";

interface CliCommand {
  command: "install" | "update" | "search" | "show" | "updates" | "open";
  args: string[];
}

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;
const searchUrl = (query: string) => `/search?q=${encodeURIComponent(query)}`;

/**
 * Aplikace podle toho, co uživatel napsal: id z katalogu („videolan-vlc“), balíček se
 * zdrojem („scoop:extras/vlc“), id balíčku aplikace („VideoLAN.VLC“, „vlc“, „firefox“) nebo
 * přesný název („VLC media player“). Instalace z terminálu se spouští bez potvrzení, proto
 * jen jednoznačná shoda – víc kandidátů (nebo žádný) = výsledky hledání, kde si uživatel vybere.
 */
function findApp(text: string, catalog: CatalogEntry[], byId: Map<string, CatalogEntry>, bySource: Map<string, CatalogEntry>) {
  const lower = text.toLowerCase();
  const direct = byId.get(text) ?? byId.get(lower);
  if (direct) return direct;
  const key = parseSourceKey(text);
  if (key) return bySource.get(sourceKey(key.source, key.packageId));
  const winget = bySource.get(sourceKey("winget", text));
  if (winget) return winget;
  // Id balíčku u správců aplikací (ne npm, pip… – „chrome“ nebo „code“ tam bývají knihovny)
  const byPackage = only(
    catalog.filter((e) => e.sources.some((s) => getSource(s.source).group !== "dev" && s.packageId.toLowerCase() === lower)),
  );
  if (byPackage) return byPackage;
  const wanted = nameKey(text);
  return wanted ? only(catalog.filter((e) => nameKey(e.name) === wanted)) : undefined;
}

/** Jediný kandidát, jinak nic. */
const only = <T,>(list: T[]): T | undefined => (list.length === 1 ? list[0] : undefined);

export function CliCommands() {
  const [queue, setQueue] = useState<{ id: number; command: CliCommand }[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    const take = () =>
      invoke<CliCommand[]>("take_cli_commands").then(
        (commands) => commands.length && setQueue((q) => [...q, ...commands.map((command) => ({ id: nextId.current++, command }))]),
        () => undefined,
      );
    void take();
    const unlisten = listen("hubget-cli", () => void take());
    return () => void unlisten.then((stop) => stop());
  }, []);

  // Katalog a nainstalované aplikace se načítají jen kvůli čekajícímu příkazu
  if (!queue.length) return null;
  return <CliRunner key={queue[0].id} command={queue[0].command} onDone={() => setQueue((q) => q.slice(1))} />;
}

function CliRunner({ command, onDone }: { command: CliCommand; onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading: catalogLoading } = useCatalog();
  const byId = useCatalogIndex();
  const bySource = useSourceIndex();
  const { items, isLoading: installedLoading } = useInstalledItems();
  const { pending, updateAll } = useUpdates();
  const busy = useBusyAppIds();
  const enqueue = useJobs((s) => s.enqueue);
  const { enabled, preferred } = useSourceScope();
  const done = useRef(false);

  const needsInstalled = command.command === "install" || command.command === "update";
  const ready = !catalogLoading && (!needsInstalled || !installedLoading);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const toast = useToasts.getState().push;
    const catalog = data?.catalog.packages ?? [];
    const { args } = command;

    switch (command.command) {
      case "install": {
        const queued: CatalogEntry[] = [];
        const names: string[] = [];
        const already: string[] = [];
        const missing: string[] = [];
        for (const text of args) {
          const entry = findApp(text, catalog, byId, bySource);
          const key = parseSourceKey(text);
          if (!entry) {
            // Balíček mimo katalog se zdrojem („scoop:extras/neco“) jde nainstalovat i tak
            if (key) {
              enqueue({ appId: text, appName: key.packageId, source: key.source, packageId: key.packageId, kind: "install" });
              names.push(key.packageId);
            } else missing.push(text);
            continue;
          }
          // Podle nainstalovaných z tohoto vykreslení (index pro karty se po startu doplní až o chvíli později)
          if (items.some((i) => i.entry.id === entry.id)) {
            already.push(entry.name);
            continue;
          }
          const source = key ? entry.sources.find((s) => s.source === key.source) : pickSource(entry, enabled, preferred);
          if (!source) {
            missing.push(text);
            continue;
          }
          if (!busy.has(entry.id)) {
            enqueue({ appId: entry.id, appName: entry.name, source: source.source, packageId: source.packageId, kind: "install" });
          }
          queued.push(entry);
          names.push(entry.name);
        }
        if (names.length) toast("success", t("cli.installQueued", { names: names.join(", ") }));
        if (already.length) toast("info", t("cli.alreadyInstalled", { names: already.join(", ") }));
        if (missing.length) toast("info", t("cli.notFound", { names: missing.join(", ") }));
        // Jedna aplikace → její detail s průběhem, víc → seznam; nic nalezeno → výsledky hledání
        if (queued.length === 1) navigate(detailUrl(queued[0].id));
        else if (queued.length > 1) navigate(`/bundles/shared?apps=${encodeURIComponent(queued.map((e) => e.id).join(","))}`);
        else if (missing.length && !names.length) navigate(searchUrl(missing[0]));
        break;
      }
      case "update": {
        if (!args.length) {
          if (pending) {
            void updateAll();
            toast("success", t("cli.updateAll", { count: pending }));
          } else toast("info", t("cli.noUpdates"));
          navigate("/installed?filter=updates");
          break;
        }
        const queued: string[] = [];
        const current: string[] = [];
        const missing: string[] = [];
        for (const text of args) {
          const lower = text.toLowerCase();
          const wanted = nameKey(text);
          // Přesné id, jinak jediná nainstalovaná aplikace toho názvu (víc shod = nic, ať se neaktualizuje jiná)
          const item =
            items.find((i) => i.entry.id === text || i.pkg.packageId.toLowerCase() === lower) ??
            only(items.filter((i) => nameKey(i.entry.name) === wanted || nameKey(i.pkg.name) === wanted));
          if (!item) missing.push(text);
          else if (!item.pkg.availableVersion) current.push(item.entry.name);
          else {
            if (!busy.has(item.entry.id)) {
              enqueue({
                appId: item.entry.id,
                appName: item.entry.name,
                source: item.pkg.source,
                packageId: item.pkg.packageId,
                kind: "update",
                options: updateOptionsFor(item.entry.id, item.pkg, item.entry),
              });
            }
            queued.push(item.entry.name);
          }
        }
        if (queued.length) toast("success", t("cli.updateQueued", { names: queued.join(", ") }));
        if (current.length) toast("info", t("cli.upToDate", { names: current.join(", ") }));
        if (missing.length) toast("info", t("cli.notInstalled", { names: missing.join(", ") }));
        if (queued.length) navigate("/installed?filter=updates");
        break;
      }
      case "search":
        navigate(searchUrl(args[0] ?? ""));
        break;
      case "show": {
        const entry = args[0] ? findApp(args[0], catalog, byId, bySource) : undefined;
        navigate(entry ? detailUrl(entry.id) : searchUrl(args[0] ?? ""));
        break;
      }
      case "updates":
        navigate("/installed?filter=updates");
        break;
      // „open“: okno už ukázal backend
    }
    onDone();
  });

  return null;
}
