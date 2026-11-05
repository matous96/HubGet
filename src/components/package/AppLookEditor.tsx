/**
 * Vlastní vzhled aplikace (tlačítko v pravém horním rohu banneru v detailu):
 * barva banneru a karet a vlastní ikona. Ukládá se jen v tomto počítači
 * (store/appLooks.ts) – nikdo jiný změnu neuvidí a nesynchronizuje se.
 */
import { Check, ImageUp, Palette, Pipette, RotateCcw, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@/lib/utils";
import { IconImportError, importIconFile, useAppLooks } from "@/store/appLooks";
import type { CatalogEntry } from "@/types";
import { PackageIcon } from "./PackageIcon";

/** Nabízené barvy banneru (sytá barva – v tmavém i světlém tématu se z ní spočítá odstín plochy). */
const PRESETS = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#db2777",
  "#475569",
];

/** Výchozí barva ve výběru vlastní barvy, dokud žádná není. */
const PICKER_DEFAULT = "#2563eb";

/** Obrázky, které jde vybrat jako ikonu (WebView2 je umí načíst). */
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/x-icon,.ico,.svg";

const glass = (ink: string, percent: number) => `color-mix(in srgb, ${ink} ${percent}%, transparent)`;

export function AppLookEditor({ entry, ink }: { entry: CatalogEntry; ink: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Proč vybraný soubor nejde použít – přímo pod výběrem ikony (chyba souboru, ne aplikace: do zvonečku nepatří)
  const [iconError, setIconError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useDismiss(root, open, () => {
    setOpen(false);
    setIconError(null);
  });

  const look = useAppLooks((s) => s.looks[entry.id]);
  const { setColor, setIcon, reset } = useAppLooks.getState();
  const color = look?.color;
  const custom = !!color && !PRESETS.includes(color);

  const pickIcon = async (file: File | undefined) => {
    if (!file) return;
    try {
      setIcon(entry.id, await importIconFile(file));
      setIconError(null);
    } catch (error) {
      const problem = error instanceof IconImportError ? error.problem : "unreadable";
      setIconError(t(`appLook.iconProblem.${problem}`, { file: file.name }));
    }
  };

  const swatch = "relative flex size-8 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110";
  const selected = "ring-2 ring-fg/60 ring-offset-2 ring-offset-surface";

  return (
    <div ref={root} className="absolute top-4 right-4 z-20">
      <button
        type="button"
        aria-label={t("appLook.button")}
        title={t("appLook.button")}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setIconError(null);
        }}
        className="flex size-10 cursor-pointer items-center justify-center rounded-full backdrop-blur-md transition-[background-color,transform] hover:scale-105 active:scale-95"
        style={{ background: glass(ink, open ? 28 : 16), color: ink }}
      >
        <Palette className="size-5" />
        {/* Tečka: aplikace má vlastní vzhled */}
        {look && <span className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-white/80" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-[22rem] origin-top-right overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-card-hover"
          >
            <div className="border-b border-line px-4 pt-3.5 pb-3">
              <p className="text-sm font-semibold">{t("appLook.title")}</p>
              <p className="mt-0.5 text-xs text-muted">{t("appLook.onlyYou")}</p>
            </div>

            {/* Barva */}
            <div className="px-4 pt-3 pb-4">
              <p className="mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{t("appLook.color")}</p>
              <div className="grid grid-cols-7 gap-2">
                <button
                  type="button"
                  onClick={() => setColor(entry.id, null)}
                  aria-pressed={!color}
                  aria-label={t("appLook.colorAuto")}
                  title={t("appLook.colorAuto")}
                  className={cn(swatch, "bg-surface-2 text-muted", !color && selected)}
                >
                  <Sparkles className="size-4" />
                </button>
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setColor(entry.id, preset)}
                    aria-pressed={color === preset}
                    aria-label={preset}
                    title={preset.toUpperCase()}
                    className={cn(swatch, color === preset && selected)}
                    style={{ background: preset }}
                  >
                    {color === preset && <Check className="size-4 text-white drop-shadow" strokeWidth={3} />}
                  </button>
                ))}
                {/* Vlastní barva – systémový výběr barvy */}
                <label
                  title={t("appLook.colorCustom")}
                  className={cn(swatch, "overflow-hidden", custom && selected)}
                  style={{ background: custom ? color : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
                >
                  {custom ? <Check className="size-4 text-white drop-shadow" strokeWidth={3} /> : <Pipette className="size-4 text-white drop-shadow" />}
                  <input
                    type="color"
                    value={color ?? PICKER_DEFAULT}
                    onChange={(e) => setColor(entry.id, e.target.value)}
                    aria-label={t("appLook.colorCustom")}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>

            {/* Ikona */}
            <div className="border-t border-line px-4 pt-3 pb-4">
              <p className="mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{t("appLook.icon")}</p>
              <div className="flex items-center gap-3">
                <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={48} />
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-semibold transition-colors hover:bg-surface-3"
                    >
                      <ImageUp className="size-3.5" />
                      {t("appLook.iconPick")}
                    </button>
                    {look?.icon && (
                      <button
                        type="button"
                        onClick={() => {
                          setIcon(entry.id, null);
                          setIconError(null);
                        }}
                        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                      >
                        {t("appLook.iconOriginal")}
                      </button>
                    )}
                  </div>
                  {iconError ? (
                    <p role="alert" className="text-[11px] font-medium text-danger">
                      {iconError}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted">{t("appLook.iconFormats")}</p>
                  )}
                </div>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  void pickIcon(e.target.files?.[0]);
                  // Stejný soubor jde vybrat znovu
                  e.target.value = "";
                }}
              />
            </div>

            {look && (
              <div className="border-t border-line p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    reset(entry.id);
                    setIconError(null);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  <RotateCcw className="size-4" />
                  {t("appLook.reset")}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
