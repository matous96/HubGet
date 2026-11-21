/**
 * Navržené aplikace (/requests): aplikace, které lidé v HubGetu postrádají, s hlasováním
 * (services/community.ts). Navrhnout jde i z hledání bez výsledků (?name=…). Hlasovat
 * a navrhovat mohou přihlášení; stav „Přidáno“ nastavuje správce HubGetu.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Lightbulb, Plus, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { queryClient } from "@/app/queryClient";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { CardSkeletons, EmptyState, PageHeader } from "@/components/ui/States";
import { cn } from "@/lib/utils";
import { communityAvailable, requestApp, toggleRequestVote, topRequests } from "@/services/community";
import { useAuth } from "@/store/auth";
import { useToasts } from "@/store/toasts";

const REQUESTS_KEY = ["app-requests"] as const;

export function RequestsPage() {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const requireAuth = useAuth((s) => s.requireAuth);
  const userId = useAuth((s) => s.user?.id);
  const [params, setParams] = useSearchParams();
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: [...REQUESTS_KEY, userId],
    queryFn: topRequests,
    enabled: communityAvailable(),
    retry: false,
  });

  // Z hledání bez výsledků: rovnou otevřít návrh s názvem z dotazu
  useEffect(() => {
    const name = params.get("name");
    if (name !== null) {
      requireAuth(() => setSuggesting(name), "general");
      setParams({}, { replace: true });
    }
  }, [params, setParams, requireAuth]);

  const vote = useMutation({
    mutationFn: toggleRequestVote,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY }),
    onError: (error) => toast("error", t("requests.failed", { error: String((error as Error).message ?? error) })),
  });

  return (
    <>
      <PageHeader
        title={t("requests.title")}
        subtitle={t("requests.subtitle")}
        actions={
          communityAvailable() && (
            <Button onClick={() => requireAuth(() => setSuggesting(""), "general")}>
              <Plus className="size-4" />
              {t("requests.suggest")}
            </Button>
          )
        }
      />
      {!communityAvailable() || isError ? (
        <EmptyState icon={Lightbulb} message={t("requests.unavailable")} />
      ) : isLoading ? (
        <CardSkeletons count={3} />
      ) : !data?.length ? (
        <EmptyState icon={Lightbulb} message={t("requests.empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {data.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-4 py-3">
              <button
                type="button"
                aria-pressed={r.voted}
                aria-label={t(r.voted ? "requests.unvote" : "requests.vote", { name: r.name })}
                title={t(r.voted ? "requests.unvote" : "requests.vote", { name: r.name })}
                disabled={r.status !== "open" || vote.isPending}
                onClick={() => requireAuth(() => vote.mutate(r.id), "general")}
                className={cn(
                  "flex w-14 shrink-0 cursor-pointer flex-col items-center rounded-xl border py-1.5 text-xs font-semibold tabular-nums transition-colors disabled:cursor-default",
                  r.voted ? "border-accent/40 bg-accent/12 text-accent" : "border-line hover:bg-surface-2",
                )}
              >
                <ThumbsUp className={cn("size-4", r.voted && "fill-current")} aria-hidden />
                {r.votes}
              </button>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {r.name}
                  {r.status === "added" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
                      <Check className="size-3" aria-hidden />
                      {t("requests.added")}
                    </span>
                  )}
                </p>
                {r.note && <p className="truncate text-sm text-muted">{r.note}</p>}
              </div>
              {r.url && (
                <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline">
                  {t("requests.web")}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <SuggestDialog initialName={suggesting} onClose={() => setSuggesting(null)} />
    </>
  );
}

function SuggestDialog({ initialName, onClose }: { initialName: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (initialName !== null) {
      setName(initialName);
      setUrl("");
      setNote("");
    }
  }, [initialName]);
  const validUrl = !url.trim() || /^https:\/\/\S{3,300}$/.test(url.trim());
  const send = useMutation({
    mutationFn: () => requestApp(name.trim(), url.trim(), note.trim()),
    onSuccess: () => {
      toast("success", t("requests.thanks", { name: name.trim() }));
      void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      onClose();
    },
    onError: (error) => toast("error", t("requests.failed", { error: String((error as Error).message ?? error) })),
  });
  const field = "h-10 rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent/50";

  return (
    <Modal
      open={initialName !== null}
      onClose={onClose}
      title={t("requests.suggestTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending || name.trim().length < 2 || !validUrl}>
            {t("requests.send")}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">{t("requests.suggestText")}</p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("requests.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("requests.url")}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={cn(field, !validUrl && "border-danger")} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("requests.note")}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className="rounded-lg border border-line bg-surface-2 p-3 text-sm outline-none focus:border-accent/50" />
        </label>
      </div>
    </Modal>
  );
}
