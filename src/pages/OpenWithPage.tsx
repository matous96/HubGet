import { FileQuestion, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { PackageCollection } from "@/components/package/PackageCollection";
import { CardSkeletons, EmptyState, PageHeader } from "@/components/ui/States";
import { useCatalog, useInstalledIndex } from "@/hooks/usePackages";
import { appsForExtension, extensionOf } from "@/lib/openWith";

/**
 * „Čím otevřu tento soubor?“ (/open-with?ext=psd&file=fotka.psd): aplikace z katalogu, které
 * soubory s příponou otevírají – nainstalované první. Sem vede přetažení souboru na okno
 * HubGetu a hledání „.psd“.
 */
export function OpenWithPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // V adrese je přípona bez tečky – i delší („sketchbook“), proto s tečkou na začátku
  const ext = extensionOf(`.${(params.get("ext") ?? "").replace(/^\./, "")}`) ?? "";
  const file = params.get("file")?.slice(0, 200) ?? "";
  const { data, isLoading } = useCatalog();
  const installedIndex = useInstalledIndex();
  const [input, setInput] = useState(ext ? `.${ext}` : "");

  const { installed, others } = useMemo(() => {
    if (!data || !ext) return { installed: [], others: [] };
    const ids = new Set(installedIndex.keys());
    const apps = appsForExtension(data.catalog.packages, ext, ids);
    return { installed: apps.filter((a) => ids.has(a.id)), others: apps.filter((a) => !ids.has(a.id)) };
  }, [data, ext, installedIndex]);

  const submit = () => {
    const next = extensionOf(input);
    if (next) navigate(`/open-with?ext=${encodeURIComponent(next)}`);
  };

  return (
    <>
      <PageHeader
        title={ext ? t("openWith.title", { ext }) : t("openWith.titleEmpty")}
        subtitle={file ? t("openWith.file", { file }) : t("openWith.subtitle")}
      />
      <form
        className="mb-6 flex max-w-md items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("openWith.placeholder")}
            aria-label={t("openWith.placeholder")}
            className="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-muted focus:border-accent/50"
          />
        </div>
      </form>
      {!ext ? (
        <EmptyState icon={FileQuestion} message={t("openWith.hint")} />
      ) : isLoading ? (
        <CardSkeletons count={6} />
      ) : installed.length + others.length === 0 ? (
        <EmptyState icon={FileQuestion} message={t("openWith.none", { ext })} />
      ) : (
        <>
          {installed.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 font-display text-lg font-bold">{t("openWith.installed", { count: installed.length })}</h2>
              <PackageCollection packages={installed} />
            </section>
          )}
          {others.length > 0 && (
            <section>
              <h2 className="mb-4 font-display text-lg font-bold">{t("openWith.available", { count: others.length })}</h2>
              <PackageCollection packages={others} />
            </section>
          )}
        </>
      )}
    </>
  );
}
