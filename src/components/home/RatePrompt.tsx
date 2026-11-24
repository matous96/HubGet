/**
 * Výzva k hodnocení na Domů (jako žádost o hodnocení v App Storu): aplikace nainstalovaná přes
 * HubGet před pár dny (lib/ratePrompt), kterou uživatel ještě má a zatím neohodnotil. Hvězdičky
 * hodnotí jedním kliknutím (přihlášení si vyžádá až klik), „Teď ne“ výzvu u té aplikace
 * ukončí, „Neptat se“ je vypne úplně. Nejvýš jedna výzva denně.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { queryClient, queryKeys } from "@/app/queryClient";
import { PackageIcon } from "@/components/package/PackageIcon";
import { ratingsEnabled } from "@/components/package/RatingsSection";
import { IconButton } from "@/components/ui/Button";
import { StarInput } from "@/components/ui/Stars";
import { useCatalogIndex, useInstalledIndex } from "@/hooks/usePackages";
import { daysSince, rateCandidate } from "@/lib/ratePrompt";
import { reviews, type ReviewDraft } from "@/services/reviews";
import { useAuth } from "@/store/auth";
import { useHistory } from "@/store/history";
import { useRatePrompts } from "@/store/ratePrompts";
import { useToasts } from "@/store/toasts";

const detailUrl = (id: string) => `/package/${encodeURIComponent(id)}`;

export function RatePrompt() {
  const { t } = useTranslation();
  const history = useHistory((s) => s.items);
  const installed = useInstalledIndex();
  const catalog = useCatalogIndex();
  const { done, off, finish, skip, setOff } = useRatePrompts();
  const requireAuth = useAuth((s) => s.requireAuth);
  const userId = useAuth((s) => s.user?.id);
  const toast = useToasts((s) => s.push);

  const candidate = useMemo(() => (off || !ratingsEnabled ? null : rateCandidate(history, installed, done)), [off, history, installed, done]);
  const entry = candidate ? catalog.get(candidate.appId) : undefined;

  // Už ohodnocená aplikace (v detailu) – výzvu přeskočit
  const { data: mine } = useQuery({
    queryKey: queryKeys.myReview(entry?.id ?? "", userId),
    queryFn: () => reviews.getMine(entry!.id),
    enabled: !!entry,
  });
  useEffect(() => {
    if (entry && mine) skip(entry.id);
  }, [entry, mine, skip]);

  // Ohodnoceno – poděkování s nabídkou napsat i recenzi (než se výzva zavře)
  const [rated, setRated] = useState<{ id: string; name: string } | null>(null);
  const submit = useMutation({
    mutationFn: (draft: ReviewDraft) => reviews.submit(entry!.id, draft),
    onSuccess: () => {
      for (const key of [queryKeys.ratingSummary(entry!.id), queryKeys.ratingSummaries, ["my-review", entry!.id]]) void queryClient.invalidateQueries({ queryKey: key });
      if (reviews.supportsText) setRated({ id: entry!.id, name: entry!.name });
      else toast("success", t("reviews.thanks"));
      finish(entry!.id);
    },
    onError: () => toast("error", t("reviews.failed")),
  });

  if (rated) {
    return (
      <section className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-3xl border border-line bg-surface px-5 py-4 shadow-card">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t("ratePrompt.thanks")}</h2>
          <p className="text-sm text-muted">{t("ratePrompt.writeHint", { name: rated.name })}</p>
        </div>
        <Link to={`${detailUrl(rated.id)}?review=write`} className="inline-flex h-9 items-center rounded-full bg-surface-2 px-4 text-sm font-semibold hover:bg-surface-3">
          {t("reviews.write")}
        </Link>
        <IconButton onClick={() => setRated(null)} title={t("common.close")} aria-label={t("common.close")}>
          <X className="size-4" />
        </IconButton>
      </section>
    );
  }

  if (!candidate || !entry || mine) return null;

  return (
    <section aria-label={t("ratePrompt.title", { name: entry.name })} className="relative mb-8 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-3xl border border-line bg-surface px-5 py-4 shadow-card">
      <Link to={detailUrl(entry.id)} className="shrink-0">
        <PackageIcon id={entry.id} name={entry.name} iconUrl={entry.iconUrl} size={56} />
      </Link>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{t("ratePrompt.title", { name: entry.name })}</h2>
        <p className="text-sm text-muted">{t("ratePrompt.text", { count: daysSince(candidate.finishedAt) })}</p>
      </div>
      <StarInput
        value={0}
        // Hodnotit mohou jen přihlášení – po přihlášení se hodnocení rovnou uloží
        onChange={(rating) => requireAuth(() => submit.mutate({ rating, title: "", body: "" }), "review")}
        label={(n) => t("reviews.starLabel", { count: n })}
      />
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setOff(true)} className="cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg">
          {t("ratePrompt.never")}
        </button>
        <IconButton onClick={() => finish(entry.id)} title={t("ratePrompt.later")} aria-label={t("ratePrompt.later")}>
          <X className="size-4" />
        </IconButton>
      </div>
    </section>
  );
}
