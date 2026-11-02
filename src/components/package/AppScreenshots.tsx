/**
 * Snímky obrazovky v detailu aplikace: z katalogu (komunitní databáze) a od
 * uživatelů HubGetu (services/appScreenshots.ts). Přihlášený uživatel přidá
 * aktuální snímky – vybere, přetáhne nebo vloží ze schránky; aplikace je zmenší
 * do WebP bez metadat a nahraje. Ostatní je uvidí po schválení správcem, autor
 * hned (se štítkem „Čeká na schválení“). Cizí snímek jde nahlásit, vlastní smazat.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, Flag, FlaskConical, ImagePlus, Trash2, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient, queryKeys } from "@/app/queryClient";
import { ratingsEnabled } from "@/components/package/RatingsSection";
import { ScreenshotGallery, type GalleryItem } from "@/components/package/ScreenshotGallery";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/States";
import { prepareScreenshot, ScreenshotError, SCREENSHOT_TYPES, type PreparedScreenshot } from "@/lib/screenshotImage";
import { cn, formatRelative } from "@/lib/utils";
import {
  appScreenshots,
  AppScreenshotUploadError,
  SCREENSHOTS_PER_APP,
  type CommunityScreenshot,
} from "@/services/appScreenshots";
import { publicName } from "@/services/auth";
import type { ReportReason } from "@/services/reviews";
import { useAuth } from "@/store/auth";
import { useSettings } from "@/store/settings";
import { useToasts } from "@/store/toasts";
import type { CatalogEntry } from "@/types";

const REPORT_REASONS: ReportReason[] = ["spam", "offensive", "offtopic", "other"];
const PROVIDER_LABEL = { github: "GitHub", microsoft: "Microsoft", google: "Google" } as const;

export function AppScreenshots({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const toast = useToasts((s) => s.push);
  const requireAuth = useAuth((s) => s.requireAuth);
  const user = useAuth((s) => s.user);
  const [adding, setAdding] = useState(false);
  // Snímky od uživatelů jen se skutečným přihlášením (Supabase), stejně jako hodnocení
  const enabled = ratingsEnabled;
  const listKey = queryKeys.appScreenshots(entry.id, user?.id);

  const { data: community = [] } = useQuery({
    queryKey: listKey,
    queryFn: () => appScreenshots.list(entry.id),
    enabled,
    // Podepsané adresy platí hodinu
    staleTime: 30 * 60_000,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["app-screenshots", entry.id] });

  const remove = useMutation({
    mutationFn: (shot: CommunityScreenshot) => appScreenshots.remove(shot),
    onSuccess: () => {
      toast("success", t("appScreenshots.deleted"));
      refresh();
    },
    onError: (error) => {
      console.error("Snímek se nepodařilo smazat:", error);
      toast("error", t("appScreenshots.deleteFailed"));
    },
  });

  const report = useMutation({
    mutationFn: ({ shot, reason }: { shot: CommunityScreenshot; reason: ReportReason }) => appScreenshots.report(shot.id, reason),
    onSuccess: () => {
      toast("success", t("appScreenshots.reportThanks"));
      refresh();
    },
    onError: (error) => {
      console.error("Snímek se nepodařilo nahlásit:", error);
      toast("error", t("appScreenshots.reportFailed"));
    },
  });

  // Snímky od uživatelů první – bývají aktuálnější než ty z katalogu
  const items: GalleryItem[] = [
    ...community.map((shot) => ({
      id: shot.id,
      url: shot.url,
      thumbUrl: shot.thumbUrl,
      badge: <CommunityBadge pending={!shot.approved} />,
      caption: t("appScreenshots.by", {
        name: shot.mine && user ? publicName(user) : shot.author,
        date: formatRelative(shot.date, language),
      }),
      actions: shot.mine ? (
        <DeleteShot pending={remove.isPending} onDelete={() => remove.mutate(shot)} />
      ) : (
        <ReportShot
          key={shot.id}
          reported={shot.reported}
          pending={report.isPending}
          onReport={(reason) => requireAuth(() => report.mutate({ shot, reason }), "screenshot")}
        />
      ),
    })),
    ...(entry.screenshots ?? []).map((url) => ({ id: url, url })),
  ];
  const ownCount = community.filter((s) => s.mine).length;

  return (
    <>
      <ScreenshotGallery
        items={items}
        name={entry.name}
        sources={entry.screenshotSources}
        action={
          enabled && (
            <Button variant="secondary" size="sm" onClick={() => requireAuth(() => setAdding(true), "screenshot")}>
              <ImagePlus className="size-4" />
              {t("appScreenshots.add")}
            </Button>
          )
        }
        empty={<p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">{t("appScreenshots.empty")}</p>}
        unavailable={<p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">{t("appScreenshots.loadFailed")}</p>}
      />
      {enabled && (
        <AddScreenshotsDialog
          open={adding}
          appId={entry.id}
          appName={entry.name}
          ownCount={ownCount}
          onClose={() => setAdding(false)}
          onUploaded={refresh}
        />
      )}
    </>
  );
}

/** Štítek snímku od uživatele v rohu karuselu. */
function CommunityBadge({ pending }: { pending: boolean }) {
  const { t } = useTranslation();
  const Icon = pending ? Clock : Users;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur",
        pending ? "bg-amber-600/85" : "bg-black/60",
      )}
    >
      <Icon className="size-3" />
      {t(pending ? "appScreenshots.pending" : "appScreenshots.community")}
    </span>
  );
}

const lightboxPill =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-default disabled:opacity-50";

/** Smazání vlastního snímku v prohlížeči – na dvě kliknutí. */
function DeleteShot({ pending, onDelete }: { pending: boolean; onDelete: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => (confirming ? onDelete() : setConfirming(true))}
      className={cn(lightboxPill, confirming && "bg-red-600/80 hover:bg-red-600")}
    >
      <Trash2 className="size-4" />
      {t(confirming ? "appScreenshots.deleteConfirm" : "appScreenshots.delete")}
    </button>
  );
}

/** Nahlášení cizího snímku v prohlížeči: tlačítko, po kliknutí výběr důvodu. */
function ReportShot({ reported, pending, onReport }: { reported: boolean; pending: boolean; onReport: (reason: ReportReason) => void }) {
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  if (reported) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 text-sm text-white/70">
        <Flag className="size-3.5" />
        {t("appScreenshots.reported")}
      </span>
    );
  }
  if (!choosing) {
    return (
      <button type="button" className={lightboxPill} onClick={() => setChoosing(true)}>
        <Flag className="size-3.5" />
        {t("appScreenshots.report")}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="mr-1 text-sm text-white/80">{t("appScreenshots.reportWhy")}</span>
      {REPORT_REASONS.map((reason) => (
        <button key={reason} type="button" disabled={pending} className={lightboxPill} onClick={() => onReport(reason)}>
          {t(`reviews.reason.${reason}`)}
        </button>
      ))}
      <button type="button" className={lightboxPill} onClick={() => setChoosing(false)}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

interface Pending {
  key: string;
  name: string;
  shot?: PreparedScreenshot;
  preview?: string;
}

interface AddScreenshotsDialogProps {
  open: boolean;
  appId: string;
  appName: string;
  /** Kolik vlastních snímků už aplikace má (limit 4). */
  ownCount: number;
  onClose: () => void;
  onUploaded: () => void;
}

/** Dialog pro přidání snímků: výběr, přetažení i vložení ze schránky, náhledy, nahrání. */
function AddScreenshotsDialog({ open, appId, appName, ownCount, onClose, onUploaded }: AddScreenshotsDialogProps) {
  const { t } = useTranslation();
  const toast = useToasts((s) => s.push);
  const user = useAuth((s) => s.user);
  const [items, setItems] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const remaining = Math.max(0, SCREENSHOTS_PER_APP - ownCount - items.length);

  // Náhledy jsou adresy objektů – uvolnit po odebrání a zavření
  const release = (list: Pending[]) => list.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));

  const close = () => {
    release(items);
    setItems([]);
    onClose();
  };

  const addFiles = (files: File[]) => {
    const accepted = files.slice(0, remaining);
    for (const file of accepted) {
      const key = crypto.randomUUID();
      const name = file.name || t("appScreenshots.add");
      setItems((prev) => [...prev, { key, name }]);
      prepareScreenshot(file)
        .then((shot) => {
          const preview = URL.createObjectURL(shot.thumb);
          setItems((prev) => prev.map((item) => (item.key === key ? { ...item, shot, preview } : item)));
        })
        .catch((error) => {
          setItems((prev) => prev.filter((item) => item.key !== key));
          const problem = error instanceof ScreenshotError ? error.problem : "decode";
          toast("error", t(`appScreenshots.problem.${problem}`, { file: name }));
        });
    }
  };

  // Vložení ze schránky (Ctrl+V) kdekoli, dokud je dialog otevřený
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const upload = useMutation({
    mutationFn: (shots: PreparedScreenshot[]) => appScreenshots.upload(appId, shots),
    onSuccess: ({ published }) => {
      toast("success", t(published ? "appScreenshots.published" : "appScreenshots.thanks"));
      onUploaded();
      close();
    },
    onError: (error) => {
      console.error("Snímky se nepodařilo nahrát:", error);
      const limit = error instanceof AppScreenshotUploadError && error.reason === "limit";
      toast("error", t(limit ? "appScreenshots.limit" : "appScreenshots.failed"));
      if (error instanceof AppScreenshotUploadError && error.uploaded > 0) onUploaded();
    },
  });

  const ready = items.filter((item) => item.shot).map((item) => item.shot!);
  const processing = items.some((item) => !item.shot);
  const full = ownCount + items.length >= SCREENSHOTS_PER_APP;

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("appScreenshots.addTitle", { name: appName })}
      className="max-w-xl"
      footer={
        <>
          {appScreenshots.isSample && (
            <span className="mr-auto inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <FlaskConical className="size-3.5" />
              {t("appScreenshots.sample")}
            </span>
          )}
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button disabled={ready.length === 0 || processing || upload.isPending} onClick={() => upload.mutate(ready)}>
            {upload.isPending && <Spinner className="size-4" />}
            {t(upload.isPending ? "appScreenshots.uploading" : "appScreenshots.upload")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Výběr / přetažení */}
        <button
          type="button"
          disabled={full}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!full) addFiles([...e.dataTransfer.files]);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-8 text-center transition-colors hover:border-accent/50 hover:bg-accent/5",
            dragging && "border-accent bg-accent/10",
            full && "cursor-default opacity-60 hover:border-line hover:bg-transparent",
          )}
        >
          <ImagePlus className="size-8 text-accent" />
          <span className="text-sm font-medium">{t("appScreenshots.choose")}</span>
          <span className="text-xs text-muted">{t("appScreenshots.formats")}</span>
        </button>
        <input
          ref={input}
          type="file"
          accept={SCREENSHOT_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />

        {/* Náhledy vybraných */}
        {items.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {items.map((item) => (
              <div key={item.key} className="relative aspect-[16/10] overflow-hidden rounded-xl border border-line bg-surface-2">
                {item.preview ? (
                  <img src={item.preview} alt={item.name} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center">
                    <Spinner className="size-5" />
                  </span>
                )}
                <button
                  type="button"
                  aria-label={t("appScreenshots.remove")}
                  title={t("appScreenshots.remove")}
                  disabled={upload.isPending}
                  onClick={() => {
                    release([item]);
                    setItems((prev) => prev.filter((p) => p.key !== item.key));
                  }}
                  className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5 text-xs text-muted">
          <p>{full ? t("appScreenshots.limitReached") : t("appScreenshots.remaining", { count: remaining })}</p>
          <p>{t("appScreenshots.privacy")}</p>
          {user && <p>{t("appScreenshots.publicName", { name: publicName(user), provider: PROVIDER_LABEL[user.provider] })}</p>}
        </div>
      </div>
    </Modal>
  );
}
