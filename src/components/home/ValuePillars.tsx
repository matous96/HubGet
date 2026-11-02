import {
  Ban,
  BadgeCheck,
  Boxes,
  Fingerprint,
  LayoutGrid,
  ListOrdered,
  MousePointerClick,
  Power,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { HubGetLogo } from "@/components/ui/Logo";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

type PillarId = "safe" | "simple" | "manage";

interface Pillar {
  id: PillarId;
  Icon: LucideIcon;
  /** Barva ikony a podklad ikony v okně s podrobnostmi. */
  tone: string;
  tint: string;
  /** Body vysvětlení (klíče pillars.<id>.points.<bod>) s ikonami. */
  points: [string, LucideIcon][];
}

const PILLARS: Pillar[] = [
  {
    id: "safe",
    Icon: ShieldCheck,
    tone: "text-emerald-500",
    tint: "bg-emerald-500/12",
    points: [
      ["sources", Boxes],
      ["checksum", Fingerprint],
      ["antivirus", ShieldCheck],
      ["publishers", BadgeCheck],
    ],
  },
  {
    id: "simple",
    Icon: MousePointerClick,
    tone: "text-accent",
    tint: "bg-accent/12",
    points: [
      ["silent", Zap],
      ["noExtras", Ban],
      ["queue", ListOrdered],
      ["fallback", Repeat],
    ],
  },
  {
    id: "manage",
    Icon: RefreshCw,
    tone: "text-violet-400",
    tint: "bg-violet-500/12",
    points: [
      ["overview", LayoutGrid],
      ["updates", RefreshCw],
      ["uninstall", Trash2],
      ["startup", Power],
    ],
  },
];

/** Název a krátký popis slibu (stejné texty jako dřív v bublině). */
const TITLE: Record<PillarId, string> = { safe: "hero.safeTitle", simple: "hero.simpleTitle", manage: "hero.manageTitle" };
const SHORT: Record<PillarId, string> = { safe: "hero.safeText", simple: "hero.simpleText", manage: "hero.manageText" };

/**
 * Minimalistický řádek nahoře na domovské stránce: „Obchod s aplikacemi
 * pro Windows“ a tři hlavní sliby – bezpečné (bez virů), jednoduché,
 * vše pod kontrolou. Po najetí myší krátké vysvětlení v bublině, kliknutím
 * okno s podrobnostmi (odkud aplikace jsou, tichá instalace, aktualizace…).
 */
export function ValuePillars({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<PillarId | null>(null);
  // Naposledy otevřený slib – obsah zůstane při animaci zavírání
  const [shown, setShown] = useState<PillarId>("safe");
  const tooltipBase = useId();

  const openPillar = (id: PillarId) => {
    setShown(id);
    setOpen(id);
  };
  const pillar = PILLARS.find((p) => p.id === shown)!;

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm", className)}>
      {/* Nadpis „Obchod s aplikacemi pro Windows“ jen tam, kde je místo (jinak se řádek nevejde vedle „Dnes“) */}
      <span className="hidden items-center gap-2 text-xs font-semibold tracking-[0.14em] text-muted uppercase 2xl:flex">
        <HubGetLogo size={16} className="rounded-[4px]" />
        {t("hero.eyebrow")}
      </span>
      <ul className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {PILLARS.map(({ id, Icon, tone }) => (
          <li key={id} className="relative">
            <button
              type="button"
              onClick={() => openPillar(id)}
              aria-haspopup="dialog"
              aria-describedby={`${tooltipBase}-${id}`}
              className="peer flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-fg/85 transition-colors hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2 focus-visible:outline-none"
            >
              <Icon className={cn("size-4", tone)} />
              {t(TITLE[id])}
            </button>
            {/* Bublina po najetí myší (i při přechodu klávesnicí) – s malým zpožděním, ať při přejíždění neproblikává */}
            <span
              id={`${tooltipBase}-${id}`}
              role="tooltip"
              className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 w-72 -translate-x-1/2 translate-y-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-muted opacity-0 shadow-card transition duration-150 peer-hover:translate-y-0 peer-hover:opacity-100 peer-hover:delay-300 peer-focus-visible:translate-y-0 peer-focus-visible:opacity-100"
            >
              <span className="block text-fg/90">{t(SHORT[id])}</span>
              <span className="mt-1.5 block text-accent">{t("pillars.hint")}</span>
            </span>
          </li>
        ))}
      </ul>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        className="max-w-xl"
        title={
          <span className="flex items-center gap-3">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", pillar.tint)}>
              <pillar.Icon className={cn("size-5", pillar.tone)} />
            </span>
            {t(TITLE[pillar.id])}
          </span>
        }
        footer={<Button onClick={() => setOpen(null)}>{t("pillars.close")}</Button>}
      >
        <p className="text-muted">{t(`pillars.${pillar.id}.lead`)}</p>
        <ul className="mt-5 grid gap-4">
          {pillar.points.map(([key, PointIcon]) => (
            <li key={key} className="flex gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2">
                <PointIcon className={cn("size-4", pillar.tone)} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{t(`pillars.${pillar.id}.points.${key}.title`)}</p>
                <p className="text-sm text-muted">{t(`pillars.${pillar.id}.points.${key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
