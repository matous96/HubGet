import { Bug, ChevronDown, ChevronRight, CircleQuestionMark, Mail, Terminal, type LucideIcon } from "lucide-react";
import { useEffect, type ComponentType } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "@/components/ui/States";
import { CONTACT_PATH, GITHUB_URL } from "@/config";

/** Témata častých otázek (texty v překladech: help.faq.<id>.q / .a). Bezpečnost jako první. */
const FAQ = ["safe", "how", "source", "uac", "bundles", "failed", "add"] as const;

/**
 * Nápověda: časté otázky a kam se obrátit, když nic z toho nepomůže.
 * Odkaz /help?faq=<id> rovnou otevře a ukáže danou otázku.
 */
export function HelpPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const openId = params.get("faq");

  // Otevřenou otázku posunout do zorného pole
  useEffect(() => {
    if (openId) document.getElementById(`faq-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openId]);

  const contacts: { label: string; hint: string; href: string; Icon: LucideIcon | ComponentType<{ className?: string }> }[] = [
    { label: t("help.bug"), hint: t("help.bugHint"), href: `${GITHUB_URL}/issues/new`, Icon: Bug },
    { label: t("help.contactForm"), hint: t("help.contactFormHint"), href: `#${CONTACT_PATH}`, Icon: Mail },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("help.title")} subtitle={t("help.subtitle")} />

      <section className="mb-10">
        <h2 className="mb-3 font-display text-xl font-bold">{t("help.faqTitle")}</h2>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {FAQ.map((id) => (
            <details key={id} id={`faq-${id}`} open={id === openId} className="group border-b border-line last:border-b-0">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-semibold transition-colors hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
                <CircleQuestionMark className="size-4 shrink-0 text-accent" />
                <span className="flex-1">{t(`help.faq.${id}.q`)}</span>
                <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-5 pb-4 pl-12 text-sm leading-6 text-muted">
                {/* Odkazy v odpovědích (<logs>, <history>, <bundles>, <publish>) vedou na stránky aplikace */}
                <Trans
                  i18nKey={`help.faq.${id}.a`}
                  components={{
                    logs: <Link to="/logs" className="font-medium text-accent hover:underline" />,
                    history: <Link to="/settings?section=history" className="font-medium text-accent hover:underline" />,
                    bundles: <Link to="/bundles" className="font-medium text-accent hover:underline" />,
                    publish: <Link to="/publish" className="font-medium text-accent hover:underline" />,
                    settings: <Link to="/settings" className="font-medium text-accent hover:underline" />,
                  }}
                />
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Výuka příkazů pro terminál – pro ty, kdo mají raději příkazový řádek */}
      <Link
        to="/commands"
        className="mb-10 flex items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 transition-colors hover:bg-surface-2"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
          <Terminal className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t("help.commandsTitle")}</span>
          <span className="block text-sm text-muted">{t("help.commandsText")}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted" />
      </Link>

      <section className="mb-10">
        <h2 className="font-display text-xl font-bold">{t("help.contactTitle")}</h2>
        <p className="mt-1 mb-3 text-sm text-muted">{t("help.contactText")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {contacts.map(({ label, hint, href, Icon }) => (
            <a
              key={label}
              href={href}
              target={href.startsWith("#") ? undefined : "_blank"}
              rel="noreferrer"
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block truncate text-xs text-muted">{hint}</span>
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
