/**
 * Ovladače z Windows Update (Přehled počítače): které ovladače Windows Update nabízí
 * (src-tauri/src/drivers.rs). Hledání se ptá serverů Microsoftu a trvá desítky sekund, proto
 * až na požádání. Instalaci HubGet předá Windows Update (Volitelné aktualizace) – ovladač
 * ovlivní hardware a přehled i vrácení ovladače má jen Windows.
 */
import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Cpu, ExternalLink, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/States";
import { formatSizeText } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";

interface DriverUpdate {
  title: string;
  manufacturer: string;
  class: string;
  model: string;
  date: string;
  size: number;
}

export function DriversPanel() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const search = useMutation({ mutationFn: () => invoke<DriverUpdate[]>("driver_updates") });
  const open = () => invoke("open_driver_updates").catch((error) => toast("error", String(error)));
  const drivers = search.data;

  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Cpu className="size-5 text-accent" />
          {t("drivers.title")}
        </h2>
        {drivers?.length ? (
          <Button onClick={() => void open()}>
            <ExternalLink className="size-4" />
            {t("drivers.open")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => search.mutate()} disabled={search.isPending}>
            {search.isPending ? <Spinner className="size-4" /> : <Search className="size-4" />}
            {search.isPending ? t("drivers.searching") : t("drivers.check")}
          </Button>
        )}
      </div>
      <p className="mb-3 text-sm text-muted">{t("drivers.hint")}</p>
      {search.isError && <p className="text-sm text-danger">{String(search.error)}</p>}
      {drivers && drivers.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          {t("drivers.none")}
        </p>
      )}
      {drivers && drivers.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {drivers.map((d) => (
            <li key={d.title} className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={d.title}>
                  {d.manufacturer || d.title}
                </span>
                <span className="block truncate text-xs text-muted" title={d.title}>
                  {[d.class, d.date && new Date(d.date).toLocaleDateString(language), d.title].filter(Boolean).join(" · ")}
                </span>
              </span>
              {d.size > 0 && <span className="shrink-0 text-xs text-muted tabular-nums">{formatSizeText(d.size, language)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
