/**
 * Podpořit vývojáře (detail aplikace, vpravo nahoře vedle Sdílet): odkazy z FUNDING.yml
 * repozitáře na GitHubu (services/funding.ts) – GitHub Sponsors, Open Collective, Ko-fi…
 * HubGet z darů nic nebere, odkazy vedou přímo k vývojářům. Bez odkazů se tlačítko neukáže.
 */
import { ExternalLink, HandHeart } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fundingLabel } from "@/lib/funding";
import { cn } from "@/lib/utils";
import { useFunding } from "@/services/funding";
import type { CatalogEntry } from "@/types";

export function FundingButton({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const links = useFunding(entry);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Zavřít klikem mimo nabídku a klávesou Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!links.length) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={t("funding.button")}
        title={t("funding.button")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors",
          open ? "bg-pink-500 text-white" : "bg-surface-2 text-pink-500 hover:bg-surface-3",
        )}
      >
        <HandHeart className="size-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 z-30 mt-2 w-80 origin-top-right overflow-hidden rounded-2xl border border-line bg-surface shadow-card-hover"
          >
            <div className="border-b border-line p-4">
              <p className="text-sm font-semibold">{t("funding.title", { name: entry.name })}</p>
              <p className="mt-1 text-xs text-muted">{t("funding.hint")}</p>
            </div>
            <ul className="p-1.5">
              {links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
                  >
                    <span className="truncate">{fundingLabel(link)}</span>
                    <ExternalLink className="size-4 shrink-0 text-muted" />
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
