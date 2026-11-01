import { useReducer } from "react";
import { useCatalogIndex } from "@/hooks/usePackages";
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
import { placeholderLook } from "@/lib/placeholderIcon";
import { cn } from "@/lib/utils";
import { iconPixels, recordIconSize, VECTOR_ICON } from "@/store/iconQuality";

/**
 * Ikony, které jsou téměř celé bílé – sdílené všemi kartami (nefunkční zdroje
 * sdílí i barva banneru: failedIconSources v lib/icons.ts).
 */
const lightIcons = new Set<string>();

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
 * se přeskočí; téměř bílá ikona dostane tmavou dlaždici, aby na bílé nezmizela.
 */
export function PackageIcon({ id, name, iconUrl, size = 48, className }: PackageIconProps) {
  const sources = useIconSources(id, name, iconUrl);
  const category = useCatalogIndex().get(id)?.categories[0];
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const radius = Math.round(size * 0.24); // „squircle“ zaoblení úměrné velikosti
  const src = sources.find((source) => !failedIcons.has(source));

  if (src) {
    const inspectable = canInspect(src);
    const fail = () => {
      failedIcons.add(src);
      rerender();
    };
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center ring-1 ring-black/5",
          lightIcons.has(src) ? "bg-zinc-800" : "bg-white/95",
          className,
        )}
        style={{ width: size, height: size, borderRadius: radius, padding: size * 0.16 }}
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
            if (!inspectable) return;
            const verdict = inspectIcon(img, src);
            if (verdict === "blank") fail();
            else if (verdict === "light" && !lightIcons.has(src)) {
              lightIcons.add(src);
              rerender();
            }
          }}
          onError={fail}
          className="size-full object-contain"
        />
      </div>
    );
  }

  // Žádný zdroj nefunguje – dlaždice s přechodem a symbolem kategorie, kruhy podle názvu
  // a první písmeno v rohu (v malé velikosti jen symbol)
  const look = placeholderLook(id, name, category);
  const Icon = look.icon;
  return (
    <div
      aria-hidden
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden text-white shadow-inner", className)}
      style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(135deg, ${look.from}, ${look.to})` }}
    >
      {size >= 24 &&
        look.circles.map((c, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white/15"
            style={{ width: c.size * size, height: c.size * size, left: (c.x - c.size / 2) * size, top: (c.y - c.size / 2) * size }}
          />
        ))}
      <Icon className="relative" style={{ width: size * 0.46, height: size * 0.46 }} strokeWidth={size >= 64 ? 1.75 : 2} />
      {size >= 32 && (
        <span
          className="absolute font-display leading-none font-bold opacity-85"
          style={{ right: size * 0.1, bottom: size * 0.08, fontSize: Math.max(10, size * 0.18) }}
        >
          {look.letter}
        </span>
      )}
    </div>
  );
}
