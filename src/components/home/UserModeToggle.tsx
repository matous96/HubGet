import { Code, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useOrgPolicy } from "@/store/orgPolicy";
import type { UserMode } from "@/types";

/**
 * Přepínač režimu Běžný uživatel / Vývojář. Běžný uživatel vidí jen
 * desktopové aplikace, vývojář navíc knihovny a nástroje z npm, pip, Cargo…
 * a na domovské stránce je má hned nahoře.
 */
export function UserModeToggle() {
  const { t } = useTranslation();
  const mode = useSettings((s) => s.userMode);
  const setMode = useSettings((s) => s.setUserMode);
  // Firemní zásady: režim Vývojář zakázaný – přepínač nemá smysl
  const locked = useOrgPolicy((p) => p.disableDeveloperMode);
  const options: { id: UserMode; icon: typeof User }[] = [
    { id: "regular", icon: User },
    { id: "developer", icon: Code },
  ];

  if (locked) return null;
  return (
    <div className="flex rounded-full border border-line bg-surface-2 p-0.5" role="group" aria-label={t("userMode.label")}>
      {options.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          title={t(`userMode.${id}Hint`)}
          onClick={() => setMode(id)}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors",
            mode === id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          <Icon className="size-3.5" />
          {t(`userMode.${id}`)}
        </button>
      ))}
    </div>
  );
}
