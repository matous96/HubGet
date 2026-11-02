import { Code2, ExternalLink, Gift, GitPullRequest, Heart, Scale, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitHubIcon } from "@/components/ui/BrandIcons";
import { Button } from "@/components/ui/Button";
import { HoverHint } from "@/components/ui/Tooltip";
import { Modal } from "@/components/ui/Modal";
import { GITHUB_URL } from "@/config";

/** Body vysvětlení (klíče community.openSourceInfo.points.<bod>) s ikonami. */
const POINTS: [string, LucideIcon][] = [
  ["code", Code2],
  ["free", Gift],
  ["license", Scale],
  ["contribute", GitPullRequest],
];

/**
 * Štítek Open source v horní liště – stejně jako sliby na domovské stránce
 * (ValuePillars): po najetí myší bublina, kliknutím okno s podrobnostmi
 * (veřejný kód, zdarma, licence MIT, zapojení) a odkazem na GitHub.
 */
export function OpenSourceBadge() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const tooltip = useId();

  return (
    <div className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-describedby={tooltip}
        className="peer inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/15 focus-visible:bg-emerald-500/15 focus-visible:outline-none dark:text-emerald-400"
      >
        <Heart className="size-3 fill-current" />
        {t("community.openSource")}
      </button>
      <HoverHint id={tooltip} hint={t("pillars.hint")}>
        {t("community.openSourceTitle")}
      </HoverHint>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        className="max-w-xl"
        title={
          <span className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/12">
              <Heart className="size-5 fill-current text-emerald-500" />
            </span>
            {t("community.openSource")}
          </span>
        }
        footer={
          <>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface-2 px-4 text-sm font-semibold text-fg transition hover:bg-surface-3"
            >
              <GitHubIcon className="size-4" />
              {t("community.openSourceInfo.github")}
              <ExternalLink className="size-3.5 opacity-70" />
            </a>
            <Button onClick={() => setOpen(false)}>{t("pillars.close")}</Button>
          </>
        }
      >
        <p className="text-muted">{t("community.openSourceInfo.lead")}</p>
        <ul className="mt-5 grid gap-4">
          {POINTS.map(([key, PointIcon]) => (
            <li key={key} className="flex gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2">
                <PointIcon className="size-4 text-emerald-500" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{t(`community.openSourceInfo.points.${key}.title`)}</p>
                <p className="text-sm text-muted">{t(`community.openSourceInfo.points.${key}.text`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
