/**
 * Lišta „Porovnat (n)“ vpravo dole – když jsou v porovnání aplikace a uživatel není na stránce
 * Porovnat ani nemá hromadný výběr (ten má vlastní lištu uprostřed dole).
 */
import { Columns3, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { useCompare } from "@/store/compare";
import { useSelection } from "@/store/selection";

export function CompareBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { ids, clear } = useCompare();
  const selecting = useSelection((s) => Object.keys(s.items).length > 0);
  const show = ids.length > 0 && pathname !== "/compare" && !selecting;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          role="region"
          aria-label={t("compare.title")}
          className="fixed right-6 bottom-6 z-40 flex items-center gap-1 rounded-full border border-line bg-surface/95 p-1.5 shadow-card-hover backdrop-blur"
        >
          <Link
            to="/compare"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition hover:brightness-110"
          >
            <Columns3 className="size-4" aria-hidden />
            {t("compare.open", { count: ids.length })}
          </Link>
          <button
            type="button"
            onClick={clear}
            aria-label={t("compare.clear")}
            title={t("compare.clear")}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
