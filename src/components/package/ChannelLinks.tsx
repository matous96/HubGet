/**
 * Kanály aplikace v detailu (lib/channels – jako TestFlight): u stabilní aplikace „Vyzkoušet
 * předběžnou verzi: Beta · Insiders“, u předběžné verze upozornění, že jde o nestabilní
 * kanál, s odkazem na stabilní verzi. Předběžná verze je samostatný balíček – instaluje se
 * vedle stabilní.
 */
import { FlaskConical } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useCatalog } from "@/hooks/usePackages";
import { channelsOf } from "@/lib/channels";
import type { CatalogEntry } from "@/types";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;
const chip = "inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold transition-colors hover:bg-surface-2";

export function ChannelLinks({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const { data } = useCatalog();
  const channels = useMemo(() => (data ? channelsOf(entry, data.catalog.packages) : null), [entry, data]);
  if (!channels) return null;

  // Předběžná verze: upozornění a cesta zpět na stabilní
  if (channels.channel) {
    return (
      <p className="flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm">
        <FlaskConical className="size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1">{t("channels.prerelease", { channel: t(`channels.name.${channels.channel}`) })}</span>
        {channels.stable && (
          <Link to={detailUrl(channels.stable.id)} className={chip}>
            {t("channels.stable", { name: channels.stable.name })}
          </Link>
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-1 inline-flex items-center gap-1.5 text-muted">
        <FlaskConical className="size-4" />
        {t("channels.try")}
      </span>
      {channels.variants.map(({ channel, entry: variant }) => (
        <Link key={variant.id} to={detailUrl(variant.id)} className={chip} title={variant.name}>
          {t(`channels.name.${channel}`)}
          <span className="font-normal text-muted tabular-nums">{variant.latestVersion}</span>
        </Link>
      ))}
    </div>
  );
}
