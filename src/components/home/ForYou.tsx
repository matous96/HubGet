/**
 * Doporučeno pro vás na Domů (lib/recommendations): police „Protože máte …“ podle
 * nainstalovaných aplikací. Bez aplikací, které uživatel má, kdysi měl (store/everInstalled –
 * odinstaloval je, nechce je), a bez balíčků jen pro vývojáře u běžného uživatele.
 */
import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PackageCard } from "@/components/package/PackageCard";
import { Shelf, ShelfItem } from "@/components/ui/Shelf";
import { useCatalog, useInstalledIndex, useModeFilter } from "@/hooks/usePackages";
import { becauseYouHave } from "@/lib/recommendations";
import { useEverInstalled } from "@/store/everInstalled";
import { useHistory } from "@/store/history";
import type { CatalogEntry } from "@/types";

export function ForYou() {
  const { t } = useTranslation();
  const { data } = useCatalog();
  const installed = useInstalledIndex();
  const ever = useEverInstalled((s) => s.ids);
  const history = useHistory((s) => s.items);
  const modeFilter = useModeFilter();

  const shelves = useMemo(() => {
    const all = data?.catalog.packages;
    if (!all || !installed.size) return [];
    const byId = new Map(all.map((e) => [e.id, e]));
    // Nainstalované přes HubGet (nejnovější první), pak ostatní nainstalované podle popularity
    const recent = history.filter((h) => h.kind === "install" && h.outcome === "success" && installed.has(h.appId)).map((h) => byId.get(h.appId));
    const rest = [...installed.keys()].map((id) => byId.get(id)).sort((a, b) => (b?.popularity ?? 0) - (a?.popularity ?? 0));
    const seeds = [...new Set([...recent, ...rest])].filter((e): e is CatalogEntry => !!e);
    const visible = modeFilter(all);
    return becauseYouHave(seeds, visible, (e) => installed.has(e.id) || e.id in ever);
  }, [data, installed, ever, history, modeFilter]);

  if (!shelves.length) return null;
  return (
    <>
      {shelves.map(({ seed, items }) => (
        <div key={seed.id} className="mb-8">
          <Shelf title={t("forYou.because", { name: seed.name })} icon={<Sparkles className="size-5 text-accent" />}>
            {items.map((entry) => (
              <ShelfItem key={entry.id}>
                <PackageCard entry={entry} />
              </ShelfItem>
            ))}
          </Shelf>
        </div>
      ))}
    </>
  );
}
