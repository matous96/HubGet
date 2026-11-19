import { ExternalLink, History, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isSecurityNote } from "@/lib/securityUpdates";
import { formatRelative } from "@/lib/utils";
import { useReleasesBetween } from "@/services/githubReleases";
import { useSettings } from "@/store/settings";
import type { CatalogEntry, InstalledPackage } from "@/types";

/** Kolik vydání ukázat hned (zbytek po rozbalení). */
const SHOWN = 3;

/**
 * Co je nového od vaší verze: poznámky ke všem vydáním, které aktualizace přeskočí
 * (services/githubReleases.ts) – jen u nainstalované aplikace s aktualizací přes víc verzí.
 */
export function ReleaseHistory({ entry, installed }: { entry: CatalogEntry; installed: InstalledPackage | undefined }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const { notes } = useReleasesBetween(entry, installed);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Jedno vydání = totéž co Co je nového z katalogu
  if (!installed?.availableVersion || notes.length < 2) return null;
  const shown = all ? notes : notes.slice(0, SHOWN);

  return (
    <section className="border-b border-line py-6">
      <h2 className="mb-1 flex items-center gap-2 font-display text-2xl font-bold">
        <History className="size-5 text-accent" />
        {t("releaseHistory.title", { version: installed.installedVersion })}
      </h2>
      <p className="mb-4 text-sm text-muted">{t("releaseHistory.subtitle", { count: notes.length, version: installed.availableVersion })}</p>
      <ol className="flex max-w-3xl flex-col gap-4">
        {shown.map((note) => {
          const expanded = open === note.version;
          return (
            <li key={note.version} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold tabular-nums">{note.version}</span>
                {note.title !== note.version && <span className="min-w-0 truncate text-sm text-muted">{note.title}</span>}
                {isSecurityNote(note.body) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-xs font-semibold text-danger">
                    <ShieldAlert className="size-3.5" />
                    {t("security.badge")}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted">{note.date && formatRelative(note.date, language)}</span>
              </div>
              {note.body && (
                <p className={`mt-2 text-sm leading-relaxed whitespace-pre-line ${expanded ? "" : "line-clamp-4"}`}>{note.body}</p>
              )}
              <div className="mt-1.5 flex items-center gap-4 text-sm">
                {note.body.split("\n").length > 4 || note.body.length > 300 ? (
                  <button type="button" onClick={() => setOpen(expanded ? null : note.version)} className="cursor-pointer font-semibold text-accent hover:underline">
                    {expanded ? t("whatsNew.less") : t("whatsNew.more")}
                  </button>
                ) : null}
                <a href={note.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-fg">
                  GitHub
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </li>
          );
        })}
      </ol>
      {notes.length > SHOWN && !all && (
        <button type="button" onClick={() => setAll(true)} className="mt-3 cursor-pointer text-sm font-semibold text-accent hover:underline">
          {t("releaseHistory.more", { count: notes.length - SHOWN })}
        </button>
      )}
    </section>
  );
}
