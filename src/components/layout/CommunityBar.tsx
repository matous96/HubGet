import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation, useSearchParams } from "react-router";
import { AccountButton } from "@/components/auth/AccountButton";
import { GitHubIcon } from "@/components/ui/BrandIcons";
import { CONTACT_PATH, GITHUB_URL } from "@/config";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NotificationCenter } from "./NotificationCenter";
import { OpenSourceBadge } from "./OpenSourceBadge";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Pravá část horní lišty: štítek Open source, odkaz na GitHub
 * a kontaktní formulář, centrum oznámení (zvoneček), vpravo přepínač
 * tmavého / světlého režimu, jazyka a přihlášení / účet.
 * (Zdroje balíčků jsou v levém panelu – viz SourcesPanel.)
 */
export function CommunityBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const onContact = pathname === "/settings" && params.get("section") === "contact";

  const iconLink =
    "flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg";

  const textLink = "rounded-full px-3 py-1.5 text-sm font-semibold text-fg/80 transition-colors hover:bg-surface-2 hover:text-fg";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {/* Textové odkazy jako na Flathubu: pro vývojáře a komunitu */}
      <nav className="mr-1 hidden items-center xl:flex">
        <NavLink to="/publish" className={({ isActive }) => cn(textLink, isActive && "bg-surface-2 text-fg")}>
          {t("nav.publish")}
        </NavLink>
        <NavLink to="/about" className={({ isActive }) => cn(textLink, isActive && "bg-surface-2 text-fg")}>
          {t("nav.about")}
        </NavLink>
      </nav>

      {/* Open source – bublina a okno s podrobnostmi */}
      <OpenSourceBadge />

      <a href={GITHUB_URL} target="_blank" rel="noreferrer" title="GitHub" aria-label="GitHub" className={iconLink}>
        <GitHubIcon className="size-[18px]" />
      </a>
      {/* Kontaktní formulář (Nastavení → Kontaktovat HubGet) */}
      <Link
        to={CONTACT_PATH}
        title={t("community.contact")}
        aria-label={t("community.contact")}
        className={cn(iconLink, onContact && "bg-surface-2 text-fg")}
      >
        <Mail className="size-[18px]" />
      </Link>

      {/* Historie oznámení a chyb (odznak s počtem nových chyb) */}
      <NotificationCenter />

      <span aria-hidden className="mx-1.5 h-5 w-px bg-line" />

      {/* Tmavý / světlý režim */}
      <ThemeToggle />

      {/* Jazyk aplikace */}
      <LanguageSwitcher />

      {/* Přihlášení / účet */}
      <AccountButton />
    </div>
  );
}
