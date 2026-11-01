import { Check, Heart, PackagePlus, Terminal } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useEffectiveSource } from "@/hooks/usePackages";
import { cn } from "@/lib/utils";
import { isWebOnly } from "@/lib/webOnly";
import { sourceCommand } from "@/services/managers";
import { useBundle } from "@/store/bundle";
import { useFavorites } from "@/store/favorites";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry, PackageSource } from "@/types";

/** Přepínač oblíbených s oznámením (sdílí karta, řádek i detail aplikace). */
export function useFavoriteToggle(entry: CatalogEntry) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const active = useFavorites((s) => s.items.some((i) => i.appId === entry.id));
  const toggleFavorite = useFavorites((s) => s.toggle);
  const toggle = () => {
    const added = toggleFavorite({ appId: entry.id, name: entry.name, version: entry.latestVersion });
    toast(added ? "success" : "info", t(added ? "quick.favAdded" : "quick.favRemoved", { name: entry.name }));
  };
  return { active, toggle, label: active ? t("quick.unfavorite") : t("quick.favorite") };
}

/** Přepínač „v sadě balíčků“ s oznámením; do sady se uloží zadaný zdroj (bez zdroje nic nedělá). */
export function useBundleToggle(entry: CatalogEntry, source: PackageSource | undefined) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const active = useBundle((s) => s.items.some((i) => i.appId === entry.id));
  const toggleBundle = useBundle((s) => s.toggle);
  const toggle = () => {
    if (!source) return;
    toggleBundle({ appId: entry.id, name: entry.name, source: source.source, packageId: source.packageId });
    toast(active ? "info" : "success", t(active ? "quick.bundleRemoved" : "quick.bundleAdded", { name: entry.name }));
  };
  return { active, toggle, label: active ? t("quick.unbundle") : t("quick.bundle") };
}

/**
 * Rychlé akce při prohlížení (bez otevření profilu aplikace):
 * kopírovat příkaz pro instalaci, přidat do oblíbených, přidat do sady balíčků
 * (aplikace jen z webu výrobce příkaz ani zdroj pro sadu nemá – jen oblíbené).
 * Pozici (relative / absolute) určuje volající – musí ležet nad roztaženým odkazem karty.
 */
export function QuickActions({ entry, className }: { entry: CatalogEntry; className?: string }) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const effective = useEffectiveSource(entry);
  const source: PackageSource | undefined = isWebOnly(entry) ? undefined : (effective ?? entry.sources[0]);
  const favorite = useFavoriteToggle(entry);
  const bundle = useBundleToggle(entry, source);

  // Klik uvnitř karty nesmí zároveň otevřít detail
  const handle = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  const copy = async () => {
    if (!source) return;
    const command = sourceCommand(source.source, "install", source.packageId);
    try {
      await navigator.clipboard.writeText(command);
      toast("success", t("quick.copied", { command }));
    } catch {
      toast("error", t("common.error"));
    }
  };

  return (
    <div className={cn("z-10 flex items-center gap-0.5", className)}>
      {source && (
        <ActionButton label={t("quick.copy")} onClick={handle(() => void copy())}>
          <Terminal className="size-4" />
        </ActionButton>
      )}
      <ActionButton label={favorite.label} active={favorite.active} activeClass="text-rose-500" onClick={handle(favorite.toggle)}>
        <Heart className={cn("size-4", favorite.active && "fill-current")} />
      </ActionButton>
      {source && (
        <ActionButton label={bundle.label} active={bundle.active} activeClass="text-accent" onClick={handle(bundle.toggle)}>
          {bundle.active ? <Check className="size-4" /> : <PackagePlus className="size-4" />}
        </ActionButton>
      )}
    </div>
  );
}

/** Kulatá tlačítka Oblíbené a Přidat do sady v záhlaví profilu aplikace (vedle Sdílet). */
export function DetailLibraryButtons({ entry, pkg }: { entry: CatalogEntry; pkg: PackageSource | undefined }) {
  const favorite = useFavoriteToggle(entry);
  const bundle = useBundleToggle(entry, pkg);
  const round = "flex size-11 cursor-pointer items-center justify-center rounded-full bg-surface-2 transition-colors hover:bg-surface-3";

  return (
    <>
      <button
        type="button"
        aria-label={favorite.label}
        title={favorite.label}
        aria-pressed={favorite.active}
        onClick={favorite.toggle}
        className={cn(round, favorite.active ? "text-rose-500" : "text-fg")}
      >
        <Heart className={cn("size-5", favorite.active && "fill-current")} />
      </button>
      {pkg && (
        <button
          type="button"
          aria-label={bundle.label}
          title={bundle.label}
          aria-pressed={bundle.active}
          onClick={bundle.toggle}
          className={cn(round, bundle.active ? "text-accent" : "text-fg")}
        >
          {bundle.active ? <Check className="size-5" /> : <PackagePlus className="size-5" />}
        </button>
      )}
    </>
  );
}

function ActionButton({
  label,
  active,
  activeClass,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  activeClass?: string;
  onClick: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-surface-3",
        active ? activeClass : "text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
