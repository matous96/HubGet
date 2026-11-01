import { Check, Link2, Mail, MessageCircle, MessagesSquare, Share, Share2, Terminal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "@/components/ui/BrandIcons";
import { appDeepLink, appWebLink } from "@/config";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@/lib/utils";
import { sourceCommand } from "@/services/managers";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry, PackageSource } from "@/types";
import { PackageIcon } from "./PackageIcon";

interface ShareButtonProps {
  entry: CatalogEntry;
  /** Zdroj pro příkaz k instalaci (zvolený / nainstalovaný); aplikace jen z webu výrobce žádný nemá. */
  pkg: PackageSource | undefined;
}

/**
 * Sdílení aplikace: odkaz do HubGetu, příkaz pro instalaci, systémové
 * sdílení Windows a rychlé sdílení e-mailem či na sociální sítě.
 */
export function ShareButton({ entry, pkg }: ShareButtonProps) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"link" | "command" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));

  // Po 2 s zrušit potvrzení „Zkopírováno“
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const link = appWebLink(entry.id) ?? appDeepLink(entry.id);
  // Na sociální sítě je potřeba webová adresa – bez webu projektu přiložíme web aplikace
  const publicUrl = appWebLink(entry.id) ?? entry.homepage ?? link;
  const command = pkg ? sourceCommand(pkg.source, "install", pkg.packageId) : null;
  const description = entry.description || entry.publisher;
  const message = command
    ? t("share.message", { name: entry.name, description, link, command })
    : t("share.messageNoCommand", { name: entry.name, description, link });

  const copy = async (kind: "link" | "command") => {
    try {
      await navigator.clipboard.writeText(kind === "link" ? link : (command ?? ""));
      setCopied(kind);
    } catch {
      toast("error", t("common.error"));
    }
  };

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const nativeShare = async () => {
    setOpen(false);
    try {
      await navigator.share({ title: entry.name, text: message, url: publicUrl });
    } catch {
      /* uživatel sdílení zavřel – nic se neděje */
    }
  };

  const enc = encodeURIComponent;
  const targets: { label: string; href: string; Icon: ComponentType<{ className?: string }> }[] = [
    { label: t("share.email"), href: `mailto:?subject=${enc(entry.name)}&body=${enc(message)}`, Icon: Mail },
    { label: "X", href: `https://x.com/intent/post?text=${enc(t("share.short", { name: entry.name }))}&url=${enc(publicUrl)}`, Icon: XIcon },
    { label: "Reddit", href: `https://www.reddit.com/submit?url=${enc(publicUrl)}&title=${enc(t("share.short", { name: entry.name }))}`, Icon: MessagesSquare },
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(message)}`, Icon: MessageCircle },
  ];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={t("share.button")}
        title={t("share.button")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors",
          open ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg hover:bg-surface-3",
        )}
      >
        <Share2 className="size-5" />
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
            {/* Náhled toho, co se sdílí */}
            <div className="flex items-center gap-3 border-b border-line p-4">
              <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{entry.name}</p>
                <p className="truncate font-mono text-[11px] text-muted">{link}</p>
              </div>
            </div>

            <div className="p-1.5">
              <MenuItem
                icon={copied === "link" ? Check : Link2}
                done={copied === "link"}
                title={copied === "link" ? t("share.copied") : t("share.copyLink")}
                hint={t("share.copyLinkHint")}
                onClick={() => void copy("link")}
              />
              {command && (
                <MenuItem
                  icon={copied === "command" ? Check : Terminal}
                  done={copied === "command"}
                  title={copied === "command" ? t("share.copied") : t("share.copyCommand")}
                  hint={<span className="font-mono">{command}</span>}
                  onClick={() => void copy("command")}
                />
              )}
              {canNativeShare && (
                <MenuItem icon={Share} title={t("share.native")} hint={t("share.nativeHint")} onClick={() => void nativeShare()} />
              )}
            </div>

            {/* Rychlé sdílení */}
            <div className="border-t border-line px-4 pt-3 pb-4">
              <p className="mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{t("share.via")}</p>
              <div className="grid grid-cols-4 gap-2">
                {targets.map(({ label, href, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex flex-col items-center gap-1.5 rounded-xl py-2 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <span className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-fg">
                      <Icon className="size-4" />
                    </span>
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  title,
  hint,
  done,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint: ReactNode;
  done?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2"
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          done ? "bg-success/15 text-success" : "bg-accent/12 text-accent",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm font-medium", done && "text-success")}>{title}</span>
        <span className="block truncate text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}
