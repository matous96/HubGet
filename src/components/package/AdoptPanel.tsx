/**
 * Převzít do správy (lib/adopt.ts, store/adopted.ts):
 *  - AdoptPanel – nad seznamem Nainstalovaných: programy z webu výrobce, které jsou i ve WinGetu,
 *    s převzetím jednotlivě i najednou,
 *  - AdoptNote – v detailu aplikace: nabídka převzetí, u převzaté aplikace jeho zrušení.
 * Převzetí v počítači nic nemění – jen HubGet začne program vést pod balíčkem wingetu
 * a nabízet mu aktualizace (aktualizace = instalace nové verze přes winget).
 */
import { ArrowRight, ChevronDown, PackageCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import type { InstalledItem } from "@/hooks/useInstalledItems";
import { adoptionSource } from "@/lib/adopt";
import { cn } from "@/lib/utils";
import { useAdopted } from "@/store/adopted";
import { useToasts } from "@/store/toasts";
import { pinKey } from "@/store/updatePins";
import type { CatalogEntry, InstalledPackage } from "@/types";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function AdoptPanel({ items }: { items: InstalledItem[] }) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const adopt = useAdopted((s) => s.adopt);
  const [open, setOpen] = useState(false);
  const candidates = useMemo(
    () => items.flatMap((item) => {
      const source = adoptionSource(item.pkg, item.entry);
      return source ? [{ item, source }] : [];
    }),
    [items],
  );
  if (!candidates.length) return null;

  const adoptAll = () => {
    for (const { item, source } of candidates) adopt(pinKey(item.pkg), { wingetId: source.packageId, name: item.pkg.name });
    toast("success", t("adopt.adoptedAll", { count: candidates.length }));
  };

  return (
    <section aria-label={t("adopt.title", { count: candidates.length })} className="mb-5 flex gap-4 rounded-2xl border border-line bg-surface px-4 py-3">
      <PackageCheck className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("adopt.title", { count: candidates.length })}</p>
            <p className="text-xs text-muted">{t("adopt.text")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full px-3 text-sm font-medium text-accent hover:bg-accent/10"
            >
              {t(open ? "adopt.hide" : "adopt.show")}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
            <Button size="sm" onClick={adoptAll}>
              {t("adopt.adoptAll", { count: candidates.length })}
            </Button>
          </div>
        </div>
        {open && (
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {candidates.map(({ item, source }) => (
              <li key={pinKey(item.pkg)} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link to={detailUrl(item.entry.id)} className="font-medium hover:underline">
                  {item.pkg.name}
                </Link>
                <ArrowRight className="size-3.5 text-muted" aria-hidden />
                <span className="font-mono text-xs text-muted">{source.packageId}</span>
                <span className="text-xs text-muted tabular-nums">
                  {item.pkg.installedVersion || "?"} → {source.version}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    adopt(pinKey(item.pkg), { wingetId: source.packageId, name: item.pkg.name });
                    toast("success", t("adopt.adopted", { name: item.entry.name, id: source.packageId }));
                  }}
                  className="ml-auto cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10"
                >
                  {t("adopt.adopt")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Detail aplikace: nabídka převzetí programu mimo správce, u převzatého jeho zrušení. */
export function AdoptNote({ pkg, entry }: { pkg: InstalledPackage | undefined; entry: CatalogEntry }) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const { adopt, release } = useAdopted();
  if (!pkg) return null;
  if (pkg.adoptedFrom) {
    return (
      <p className="text-xs text-muted">
        {t("adopt.adoptedNote", { id: pkg.packageId })}{" "}
        <button
          type="button"
          onClick={() => {
            release(pinKey({ source: pkg.source, packageId: pkg.adoptedFrom! }));
            toast("info", t("adopt.released", { name: entry.name }));
          }}
          className="cursor-pointer font-medium text-accent hover:underline"
        >
          {t("adopt.release")}
        </button>
      </p>
    );
  }
  const source = adoptionSource(pkg, entry);
  if (!source) return null;
  return (
    <div className="flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
      <PackageCheck className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1">{t("adopt.offer", { id: source.packageId })}</span>
      <Button
        size="sm"
        onClick={() => {
          adopt(pinKey(pkg), { wingetId: source.packageId, name: pkg.name });
          toast("success", t("adopt.adopted", { name: entry.name, id: source.packageId }));
        }}
      >
        {t("adopt.adopt")}
      </Button>
    </div>
  );
}
