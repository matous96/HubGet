import { useReducer } from "react";
import { usePackageIndex } from "@/store/packageIndex";
import {
  canInspect,
  failedIconSources as failedIcons,
  inspectIcon,
  isRemoteIcon,
  MAX_UPSCALE,
  MIN_ICON,
  remoteIconSrc,
  useIconSources,
} from "@/lib/icons";
import { analyzeIconTile, colorTile, iconTileOf } from "@/lib/iconTile";
import { placeholderLook } from "@/lib/placeholderIcon";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/types";
import { iconPixels, recordIconSize, VECTOR_ICON } from "@/store/iconQuality";

/**
 * Ikony, které jsou téměř celé bílé – sdílené všemi kartami (nefunkční zdroje
 * sdílí i barva banneru: failedIconSources v lib/icons.ts).
 */
const lightIcons = new Set<string>();

/**
 * Ikony, které se už jednou načetly a prošly kontrolou – další karta se stejnou ikonou
 * ji ukáže hned, bez dlaždice kategorie a prolnutí.
 */
const shownIcons = new Set<string>();

interface PackageIconProps {
  id: string;
  name: string;
  iconUrl: string | null;
  /** Velikost v pixelech. */
  size?: number;
  className?: string;
}

/**
 * Ikona aplikace se záložními zdroji (viz lib/icons.ts): ikona nainstalované
 * aplikace z nabídky Start → ikona z katalogu → favicon webu vydavatele →
 * vygenerovaná dlaždice se symbolem kategorie (lib/placeholderIcon.ts).
 * Zdroj, který se nenačte, je prázdný nebo (z internetu) malý a rozmazaný,
 * se přeskočí. Tvar jako na iOS (.icon-squircle); každá ikona – i symbol kategorie –
 * leží s okrajem v bílé dlaždici s nádechem své barvy a stínem pod logem
 * (lib/iconTile.ts), téměř bílá v tmavé, aby nezmizela.
 * Než se ikona stáhne, je místo prázdné bílé dlaždice vidět dlaždice kategorie –
 * skutečná ikona se přes ni prolne.
 */
export function PackageIcon({ id, name, iconUrl, size = 48, className }: PackageIconProps) {
  const sources = useIconSources(id, name, iconUrl);
  const category = usePackageIndex((s) => s.catalog.get(id)?.categories[0]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const src = sources.find((source) => !failedIcons.has(source));

  const tile = (tileClassName?: string) => <CategoryTile id={id} name={name} category={category} size={size} className={tileClassName} />;

  if (src) {
    const inspectable = canInspect(src);
    const ready = shownIcons.has(src);
    const fail = () => {
      failedIcons.add(src);
      rerender();
    };
    const show = () => {
      shownIcons.add(src);
      // Stejná ikona se mohla načíst zároveň jinde (banner a hlavička detailu) – i tak překreslit
      if (!ready) rerender();
    };
    const look = iconTileOf(src);
    return (
      <div className={cn("icon-squircle relative shrink-0", className)} style={{ width: size, height: size }}>
        {!ready && tile("icon-placeholder absolute inset-0")}
        <div
          className={cn(
            "icon-squircle absolute inset-0 flex items-center justify-center overflow-hidden ring-1 ring-black/5 transition-opacity duration-200 dark:ring-white/12",
            !look && (lightIcons.has(src) ? "bg-zinc-800" : "bg-white/95"),
            ready ? "opacity-100" : "opacity-0",
          )}
          style={{ background: look?.background, padding: size * 0.16 }}
        >
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          // Ikony z mezipaměti HubGetu jde zkontrolovat v canvasu (posílají hlavičku CORS)
          crossOrigin={inspectable ? "anonymous" : undefined}
          onLoad={(e) => {
            const img = e.currentTarget;
            // Rozlišení ikony z katalogu – podle něj se volí pořadí zdrojů (lib/icons.ts)
            if (iconUrl && src === remoteIconSrc(iconUrl)) recordIconSize(iconUrl, img);
            const pixels = iconPixels(src, img);
            // Malá ikona z internetu (favicon 16–32 px) by se rozmazala – další zdroj, nebo avatar
            if (isRemoteIcon(src) && pixels < MIN_ICON) return fail();
            // Menší ikonu nezvětšovat víc než 2× – ve velké dlaždici (detail) bude menší, ale ostrá
            if (pixels < VECTOR_ICON) {
              img.style.maxWidth = `${(img.naturalWidth * MAX_UPSCALE) / devicePixelRatio}px`;
              img.style.maxHeight = `${(img.naturalHeight * MAX_UPSCALE) / devicePixelRatio}px`;
            }
            if (!inspectable) return show();
            const verdict = inspectIcon(img, src);
            if (verdict === "blank") return fail();
            if (verdict === "light") lightIcons.add(src);
            analyzeIconTile(img, src, verdict === "light");
            show();
          }}
          onError={fail}
          className="size-full object-contain"
          // Měkký stín pod logem úměrný velikosti ikony
          style={look && { filter: `drop-shadow(0 ${size * 0.025}px ${size * 0.05}px ${look.shadow})` }}
        />
        </div>
      </div>
    );
  }

  // Žádný zdroj nefunguje – dlaždice kategorie natrvalo
  return tile(cn("shrink-0", className));
}

/**
 * Bílá dlaždice jako u skutečných ikon se symbolem kategorie v její barvě a prvním
 * písmenem v rohu (v malé velikosti jen symbol) – místo ikony, která chybí nebo se stahuje.
 */
function CategoryTile({
  id,
  name,
  category,
  size,
  className,
}: {
  id: string;
  name: string;
  category: CategoryId | undefined;
  size: number;
  className?: string;
}) {
  const look = placeholderLook(id, name, category);
  const Icon = look.icon;
  const { background, shadow } = colorTile(look.to);
  return (
    <div
      aria-hidden
      className={cn("icon-squircle relative flex items-center justify-center overflow-hidden ring-1 ring-black/5 dark:ring-white/12", className)}
      style={{ width: size, height: size, background, color: look.to }}
    >
      <Icon
        style={{ width: size * 0.46, height: size * 0.46, filter: `drop-shadow(0 ${size * 0.025}px ${size * 0.05}px ${shadow})` }}
        strokeWidth={size >= 64 ? 1.75 : 2}
      />
      {size >= 32 && (
        <span
          className="absolute font-display leading-none font-bold opacity-70"
          style={{ right: size * 0.1, bottom: size * 0.08, fontSize: Math.max(10, size * 0.18) }}
        >
          {look.letter}
        </span>
      )}
    </div>
  );
}
