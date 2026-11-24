/**
 * Soukromí aplikací (backend privacy.rs, lib/privacy.ts):
 *  - PrivacyPanel – Přehled počítače: přepínač „Neodesílat telemetrii“ u každé nainstalované
 *    aplikace ze seznamu,
 *  - PrivacySwitch – totéž v detailu nainstalované aplikace.
 * Zásady pro celý počítač se potvrzují dialogem UAC (odmítnutí stav nezmění).
 */
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "@/app/queryClient";
import { SwitchRow } from "@/components/settings/SettingsUi";
import { useInstalled } from "@/hooks/usePackages";
import { installedPrivacyIds, PRIVACY_APPS, type PrivacyId } from "@/lib/privacy";
import { isTauri } from "@/lib/tauri";
import { useToasts } from "@/store/toasts";

interface PrivacyState {
  id: PrivacyId;
  off: boolean;
  machine: boolean;
}

const PRIVACY_KEY = ["privacy-status"];

function usePrivacy() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: PRIVACY_KEY, queryFn: () => invoke<PrivacyState[]>("privacy_status"), enabled: isTauri(), staleTime: 60_000 });
  const set = useMutation({
    mutationFn: ({ id, off }: { id: PrivacyId; off: boolean }) => invoke<boolean>("privacy_set", { id, off }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: PRIVACY_KEY }),
    onError: (error) => {
      // Odmítnutý dialog UAC – stav zůstal
      if (String(error) !== "cancelled") useToasts.getState().push("error", t("privacy.failed", { error: String(error) }));
    },
  });
  const states = useMemo(() => new Map((status.data ?? []).map((s) => [s.id, s])), [status.data]);
  return { states, set };
}

function PrivacyRow({ id, states, set }: { id: PrivacyId } & ReturnType<typeof usePrivacy>) {
  const { t } = useTranslation();
  const state = states.get(id);
  const app = PRIVACY_APPS.find((a) => a.id === id)!;
  return (
    <SwitchRow
      label={t("privacy.row", { name: app.name })}
      hint={t(`privacy.hint.${id}`) + (state?.machine ? ` ${t("privacy.machine")}` : "")}
      checked={!!state?.off}
      disabled={!state || set.isPending}
      onChange={(off) => set.mutate({ id, off })}
    />
  );
}

export function PrivacyPanel() {
  const { t } = useTranslation();
  const { data } = useInstalled();
  const privacy = usePrivacy();
  const ids = useMemo(() => installedPrivacyIds((data ?? []).map((p) => p.name)), [data]);
  if (!isTauri() || !ids.length) return null;
  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold">
        <EyeOff className="size-5 text-accent" />
        {t("privacy.title")}
      </h2>
      <p className="mb-2 text-sm text-muted">{t("privacy.intro")}</p>
      <div className="-mx-4 divide-y divide-line">
        {ids.map((id) => (
          <PrivacyRow key={id} id={id} {...privacy} />
        ))}
      </div>
    </section>
  );
}

/** Přepínač v detailu nainstalované aplikace (jen u aplikací ze seznamu). */
export function PrivacySwitch({ id }: { id: PrivacyId }) {
  const { t } = useTranslation();
  const privacy = usePrivacy();
  if (!isTauri()) return null;
  return (
    <section aria-label={t("privacy.title")} className="rounded-2xl border border-line bg-surface">
      <PrivacyRow id={id} {...privacy} />
    </section>
  );
}
