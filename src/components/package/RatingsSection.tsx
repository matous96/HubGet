/**
 * Sekce „Hodnocení a recenze“ v detailu balíčku (styl App Store):
 * průměr + počet, histogram, police recenzí (vlastní první, pak nejnovější),
 * hodnocení kliknutím, napsání / úprava / smazání vlastní recenze,
 * nahlášení cizí recenze a odkaz na podporu.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleHelp, Flag, FlaskConical, SquarePen, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient, queryKeys } from "@/app/queryClient";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Shelf } from "@/components/ui/Shelf";
import { StarInput, Stars } from "@/components/ui/Stars";
import { cn, formatRelative } from "@/lib/utils";
import { publicName } from "@/services/auth";
import { reviews, type RatingSummary, type ReportReason, type Review, type ReviewDraft } from "@/services/reviews";
import { useAuth } from "@/store/auth";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry } from "@/types";

/** Ve vývojovém režimu jde sekci s ukázkovými daty zapnout (vyzkoušení rozhraní bez Supabase). */
function devSampleReviews(): boolean {
  try {
    return import.meta.env.DEV && localStorage.getItem("unibox-dev-sample-reviews") === "1";
  } catch {
    return false;
  }
}

/** Zobrazovat hodnocení? Jen se skutečnými daty (Supabase), ne s ukázkovými. */
export const ratingsEnabled = !reviews.isSample || devSampleReviews();

const REPORT_REASONS: ReportReason[] = ["spam", "offensive", "offtopic", "other"];
const PROVIDER_LABEL = { github: "GitHub", microsoft: "Microsoft", google: "Google" } as const;

/** Souhrn hodnocení balíčku (sdílí ho i pruh s údaji v hlavičce). */
export function useRatingSummary(entry: CatalogEntry) {
  return useQuery({
    queryKey: queryKeys.ratingSummary(entry.id),
    queryFn: () => reviews.getSummary(entry.id, entry.popularity),
    enabled: ratingsEnabled,
  });
}

const NO_SUMMARIES = new Map<string, RatingSummary>();

/** Souhrny všech hodnocených aplikací – jeden požadavek pro všechny karty. */
export function useRatingSummaries(): Map<string, RatingSummary> {
  const { data } = useQuery({
    queryKey: queryKeys.ratingSummaries,
    queryFn: () => reviews.getAllSummaries(),
    enabled: ratingsEnabled,
    staleTime: 5 * 60_000,
  });
  return data ?? NO_SUMMARIES;
}

/** Formátování průměru („4,8“) a počtu („22 tis.“) podle jazyka. */
export function useRatingFormat() {
  const language = useSettings((s) => s.language);
  return {
    average: (n: number) => n.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    count: (n: number) => new Intl.NumberFormat(language, { notation: "compact" }).format(n),
  };
}

export function RatingsSection({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const fmt = useRatingFormat();
  const toast = useToasts((s) => s.push);
  const requireAuth = useAuth((s) => s.requireAuth);
  const userId = useAuth((s) => s.user?.id);
  const [writing, setWriting] = useState(false);
  const [reading, setReading] = useState<Review | null>(null);
  const withText = reviews.supportsText;

  const { data: summary, isError: summaryFailed, refetch: retrySummary, isFetching: retrying } = useRatingSummary(entry);
  const { data: list } = useQuery({
    queryKey: queryKeys.reviews(entry.id),
    queryFn: () => reviews.getReviews(entry.id),
    enabled: withText,
  });
  const { data: mine } = useQuery({
    queryKey: queryKeys.myReview(entry.id, userId),
    queryFn: () => reviews.getMine(entry.id),
  });

  const submit = useMutation({
    mutationFn: (draft: ReviewDraft) => reviews.submit(entry.id, draft),
    onSuccess: (_, draft) => {
      // Prázdný nadpis u dřívější recenze = smazání textu
      toast("success", t(!draft.title && mine?.title ? "reviews.deleted" : "reviews.thanks"));
      for (const key of [queryKeys.ratingSummary(entry.id), queryKeys.ratingSummaries, queryKeys.reviews(entry.id), ["my-review", entry.id]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error) => {
      console.error("Hodnocení se nepodařilo uložit:", error);
      toast("error", t("reviews.failed"));
    },
  });

  const report = useMutation({
    mutationFn: ({ review, reason }: { review: Review; reason: ReportReason }) => reviews.report(review.id, reason),
    onSuccess: (_, { review }) => {
      toast("success", t("reviews.reportThanks"));
      setReading((current) => (current?.id === review.id ? { ...current, reported: true } : current));
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviews(entry.id) });
    },
    onError: (error) => {
      console.error("Recenzi se nepodařilo nahlásit:", error);
      toast("error", t("reviews.reportFailed"));
    },
  });

  // Hodnocení kliknutím zachová případný text dřívější recenze.
  const rate = (rating: ReviewDraft["rating"]) =>
    submit.mutate({ rating, title: mine?.title ?? "", body: mine?.body ?? "" });

  return (
    <section className="border-t border-line pt-6">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-2xl font-bold">{t(withText ? "reviews.title" : "reviews.titleRatings")}</h2>
        {reviews.isSample && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
            <FlaskConical className="size-3" />
            {t("reviews.sample")}
          </span>
        )}
      </div>

      {/* Průměr a histogram */}
      <div className="mt-3 mb-8 flex flex-wrap items-end justify-between gap-8">
        {!summary && summaryFailed ? (
          // Bez internetu nebo výpadek služby – ne věčné načítání ani „zatím bez hodnocení“
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-muted">{t("reviews.loadFailed")}</span>
            <Button variant="secondary" size="sm" disabled={retrying} onClick={() => void retrySummary()}>
              {t("reviews.retry")}
            </Button>
          </div>
        ) : !summary ? (
          // Načítání – místo velkého čísla jen obrys, ať se sekce neposkočí
          <span className="h-[75px] w-40 animate-pulse rounded-2xl bg-surface-2" />
        ) : summary.count > 0 ? (
          <div className="flex items-end gap-4">
            <span className="font-display text-[88px] leading-[0.85] font-bold tracking-tight">{fmt.average(summary.average)}</span>
            <span className="pb-1 text-lg text-muted">{t("reviews.ratingsCount", { formatted: fmt.count(summary.count) })}</span>
          </div>
        ) : (
          // Bez hodnocení prázdné hvězdičky – pomlčka v písmu 88 px vypadala jako bílý obdélník
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Stars value={0} size={30} className="gap-1 text-fg" />
            <span className="text-lg text-muted">{t("reviews.noRatings")}</span>
          </div>
        )}
        {summary && summary.count > 0 && <Histogram summary={summary} />}
      </div>

      {/* Nejužitečnější recenze; bez hodnocení stačí výzva výše, druhé „buďte první“ by se opakovalo */}
      {withText &&
        (list && list.length > 0 ? (
          <Shelf title={t("reviews.mostHelpful")}>
            {list.map((review) => (
              <ReviewCard key={review.id} review={review} onOpen={() => setReading(review)} />
            ))}
          </Shelf>
        ) : (
          list && !!summary?.count && <p className="mb-8 text-sm text-muted">{t("reviews.noReviews")}</p>
        ))}

      {/* Hodnocení kliknutím + akce */}
      <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex items-center gap-4">
          {/* Po hlasování „Vaše hodnocení“ – kliknutím jde hlas změnit */}
          <span className="text-[15px] font-semibold">{mine ? t("reviews.yourRating") : t("reviews.rateByClick")}</span>
          <StarInput
            value={mine?.rating ?? 0}
            // Hodnotit mohou jen přihlášení – po přihlášení se hodnocení rovnou uloží
            onChange={(n) => requireAuth(() => rate(n), "review")}
            label={(n) => t("reviews.starLabel", { count: n })}
          />
        </div>
        <div className="ml-auto flex gap-3">
          {withText && (
            <Button variant="secondary" size="lg" className="min-w-52" onClick={() => requireAuth(() => setWriting(true), "review")}>
              <SquarePen className="size-4" />
              {mine?.title ? t("reviews.edit") : t("reviews.write")}
            </Button>
          )}
          {entry.supportUrl && (
            <a
              href={entry.supportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 min-w-52 items-center justify-center gap-2 rounded-full border border-line bg-surface-2 px-6 text-sm font-semibold transition-colors hover:bg-surface-3"
            >
              <CircleHelp className="size-4" />
              {t("reviews.support")}
            </a>
          )}
        </div>
      </div>

      <WriteReviewDialog
        open={writing}
        initial={mine ?? null}
        appName={entry.name}
        onClose={() => setWriting(false)}
        onSubmit={(draft) => {
          submit.mutate(draft);
          setWriting(false);
        }}
      />

      <Modal
        open={reading !== null}
        onClose={() => setReading(null)}
        title={reading?.title || t("reviews.title")}
        className="max-w-xl"
        footer={
          reading &&
          !reading.mine && (
            <ReportReview
              key={reading.id}
              review={reading}
              pending={report.isPending}
              onReport={(reason) => requireAuth(() => report.mutate({ review: reading, reason }), "review")}
            />
          )
        }
      >
        {reading && (
          <>
            <ReviewMeta review={reading} />
            <p className="mt-3 text-[15px] leading-7 whitespace-pre-line select-text">{reading.body}</p>
          </>
        )}
      </Modal>
    </section>
  );
}

/** Pruhy s počty hodnocení 5 → 1 hvězdička. */
function Histogram({ summary }: { summary: RatingSummary }) {
  const max = Math.max(...summary.histogram, 1);
  return (
    <div className="flex w-full max-w-md flex-col gap-1.5" aria-hidden>
      {summary.histogram.map((n, i) => (
        <div key={i} className="flex items-center gap-3">
          {/* Jen vyplněné hvězdičky, zarovnané doprava */}
          <span className="flex w-16 justify-end gap-px text-fg/70">
            {Array.from({ length: 5 - i }, (_, k) => (
              <Star key={k} className="size-2.5" fill="currentColor" strokeWidth={0} />
            ))}
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-fg/70" style={{ width: `${(n / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function ReviewMeta({ review }: { review: Review }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  // U vlastní recenze jméno přihlášeného uživatele
  const user = useAuth((s) => s.user);
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Stars value={review.rating} size={13} className="text-fg/80" />
      <span>
        {formatRelative(review.date, language)} · {review.mine ? (user ? publicName(user) : t("reviews.you")) : review.author}
      </span>
    </div>
  );
}

function ReviewCard({ review, onOpen }: { review: Review; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-56 w-[380px] shrink-0 cursor-pointer snap-start flex-col rounded-2xl bg-surface-2 p-5 text-left transition-colors hover:bg-surface-3",
        review.mine && "ring-2 ring-accent/40",
      )}
    >
      <p className="truncate text-[16px] font-semibold">{review.title || "—"}</p>
      <div className="mt-1.5">
        <ReviewMeta review={review} />
      </div>
      <p className="mt-2 line-clamp-5 text-[14px] leading-6 text-muted">{review.body}</p>
    </button>
  );
}

/** Nahlášení cizí recenze: tlačítko, po kliknutí výběr důvodu. */
function ReportReview({ review, pending, onReport }: { review: Review; pending: boolean; onReport: (reason: ReportReason) => void }) {
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);

  if (review.reported) {
    return (
      <span className="mr-auto inline-flex items-center gap-1.5 text-sm text-muted">
        <Flag className="size-3.5" />
        {t("reviews.reported")}
      </span>
    );
  }
  if (!choosing) {
    return (
      <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setChoosing(true)}>
        <Flag className="size-3.5" />
        {t("reviews.report")}
      </Button>
    );
  }
  return (
    <div className="mr-auto flex flex-col gap-2">
      <p className="text-sm font-medium">{t("reviews.reportWhy")}</p>
      <div className="flex flex-wrap gap-1.5">
        {REPORT_REASONS.map((reason) => (
          <Button key={reason} variant="secondary" size="sm" disabled={pending} onClick={() => onReport(reason)}>
            {t(`reviews.reason.${reason}`)}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setChoosing(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

interface WriteReviewDialogProps {
  open: boolean;
  initial: ReviewDraft | null;
  appName: string;
  onClose: () => void;
  onSubmit: (draft: ReviewDraft) => void;
}

/** Dialog pro napsání / úpravu vlastní recenze. */
function WriteReviewDialog({ open, initial, appName, onClose, onSubmit }: WriteReviewDialogProps) {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const [rating, setRating] = useState<number>(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [lastOpen, setLastOpen] = useState(open);

  // Při každém otevření načíst aktuální hodnoty (bez efektu – úprava stavu během renderu).
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setRating(initial?.rating ?? 0);
      setTitle(initial?.title ?? "");
      setBody(initial?.body ?? "");
    }
  }

  const valid = rating > 0 && title.trim().length > 0;
  const inputClass =
    "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none transition-shadow placeholder:text-muted focus:border-accent/50 focus:ring-4 focus:ring-accent/15";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t("reviews.write")} – ${appName}`}
      footer={
        <>
          {/* Smazat jde jen text – hvězdičky zůstanou */}
          {initial?.title && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => onSubmit({ rating: initial.rating, title: "", body: "" })}>
              <Trash2 className="size-4" />
              {t("reviews.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("package.cancel")}
          </Button>
          <Button
            disabled={!valid}
            onClick={() => onSubmit({ rating: rating as ReviewDraft["rating"], title: title.trim(), body: body.trim() })}
          >
            {t("reviews.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex justify-center py-2">
          <StarInput value={rating} onChange={setRating} size={34} label={(n) => t("reviews.starLabel", { count: n })} />
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("reviews.formTitle")}
          maxLength={80}
          className={inputClass}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("reviews.formBody")}
          rows={6}
          maxLength={2000}
          className={cn(inputClass, "resize-none select-text")}
        />
        {user && (
          <p className="text-xs text-muted">{t("reviews.publicName", { name: publicName(user), provider: PROVIDER_LABEL[user.provider] })}</p>
        )}
      </div>
    </Modal>
  );
}
