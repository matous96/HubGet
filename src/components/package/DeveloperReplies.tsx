/**
 * Odpovědi vývojářů na recenze (services/community.ts, Supabase):
 *  - useReviewReplies – odpovědi u recenzí aplikace (veřejné),
 *  - ReplyBlock – odpověď pod recenzí a u schváleného vývojáře editor odpovědi,
 *  - MaintainerLink – „Jsem vývojář této aplikace“: žádost (jen s účtem GitHub), stav žádosti.
 * Vývojáře schvaluje správce HubGetu (SQL v migraci) – podle GitHub účtu a repozitáře aplikace.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgeCheck, MessageSquareReply } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "@/app/queryClient";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatRelative } from "@/lib/utils";
import {
  communityAvailable,
  githubRepo,
  maintainerStatus,
  replyToReview,
  requestMaintainer,
  reviewReplies,
  type ReviewReply,
} from "@/services/community";
import { useAuth } from "@/store/auth";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry } from "@/types";

const repliesKey = (appId: string) => ["review-replies", appId] as const;
const statusKey = (appId: string, userId: string | undefined) => ["maintainer-status", appId, userId] as const;

export function useReviewReplies(appId: string, enabled: boolean) {
  return useQuery({
    queryKey: repliesKey(appId),
    queryFn: () => reviewReplies(appId),
    enabled: enabled && communityAvailable(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function useMaintainerStatus(appId: string) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: statusKey(appId, userId),
    queryFn: () => maintainerStatus(appId),
    enabled: !!userId && communityAvailable(),
    retry: false,
  });
}

/** Odpověď vývojáře pod recenzí; schválený vývojář ji tu napíše nebo upraví. */
export function ReplyBlock({ appId, reviewId, reply }: { appId: string; reviewId: string; reply: ReviewReply | undefined }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const { data: status } = useMaintainerStatus(appId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(reply?.body ?? "");
  const save = useMutation({
    mutationFn: () => replyToReview(reviewId, text),
    onSuccess: () => {
      toast("success", t(text.trim() ? "devReplies.saved" : "devReplies.deleted"));
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: repliesKey(appId) });
    },
    onError: (error) => toast("error", t("devReplies.failed", { error: String((error as Error).message ?? error) })),
  });

  return (
    <div className="mt-4">
      {reply && !editing && (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
            <BadgeCheck className="size-3.5 text-accent" aria-hidden />
            {t("devReplies.title", { author: reply.author })}
            <span className="font-normal text-muted">· {formatRelative(reply.updatedAt, language)}</span>
          </p>
          <p className="text-sm leading-6 whitespace-pre-line select-text">{reply.body}</p>
        </div>
      )}
      {status === "approved" &&
        (editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              rows={4}
              aria-label={t("devReplies.write")}
              className="w-full rounded-xl border border-line bg-surface-2 p-3 text-sm outline-none focus:border-accent/50"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {t("devReplies.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setText(reply?.body ?? "");
              setEditing(true);
            }}
          >
            <MessageSquareReply className="size-3.5" />
            {t(reply ? "devReplies.edit" : "devReplies.write")}
          </Button>
        ))}
    </div>
  );
}

/** „Jsem vývojář této aplikace“ – žádost o odpovídání na recenze a její stav. */
export function MaintainerLink({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const requireAuth = useAuth((s) => s.requireAuth);
  const userId = useAuth((s) => s.user?.id);
  const { data: status } = useMaintainerStatus(entry.id);
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(() => githubRepo(entry.repositoryUrl) ?? githubRepo(entry.homepage) ?? "");
  const send = useMutation({
    mutationFn: () => requestMaintainer(entry.id, repo.trim()),
    onSuccess: (result) => {
      toast("success", t(result === "approved" ? "devReplies.approved" : "devReplies.requested"));
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: statusKey(entry.id, userId) });
    },
    onError: (error) => {
      const github = /github/i.test(String((error as Error).message ?? error));
      toast("error", github ? t("devReplies.githubOnly") : t("devReplies.failed", { error: String((error as Error).message ?? error) }));
    },
  });
  if (!communityAvailable()) return null;
  if (status === "pending") return <p className="text-xs text-muted">{t("devReplies.pending")}</p>;
  if (status === "approved") return <p className="text-xs text-muted">{t("devReplies.youAreMaintainer")}</p>;

  return (
    <>
      <button type="button" onClick={() => requireAuth(() => setOpen(true), "review")} className="cursor-pointer text-xs font-medium text-accent hover:underline">
        {t("devReplies.claim")}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("devReplies.claimTitle", { name: entry.name })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => send.mutate()} disabled={send.isPending}>
              {t("devReplies.send")}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">{t("devReplies.claimText")}</p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("devReplies.repo")}
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            className="h-10 rounded-lg border border-line bg-surface-2 px-3 font-mono text-sm outline-none focus:border-accent/50"
          />
        </label>
      </Modal>
    </>
  );
}
