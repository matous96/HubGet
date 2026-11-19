/**
 * Offline balíček ze sady (Sady balíčků → Připravit pro offline, backend offline.rs):
 * instalátory aplikací z WinGetu do vybrané složky (třeba na USB) se skriptem install.cmd,
 * který je na počítači bez internetu nainstaluje potichu. Průběh ukazuje stránka Sad
 * (useOfflineBundle), výsledek oznámení.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import i18n from "@/i18n";
import { isStoreId } from "@/lib/profile";
import type { BundleItem } from "@/store/bundle";
import { useToasts } from "@/store/toasts";

interface OfflineState {
  running: boolean;
  /** Hotové aplikace z celkového počtu a právě stahovaná. */
  done: number;
  total: number;
  name: string;
}

export const useOfflineBundle = create<OfflineState>(() => ({ running: false, done: 0, total: 0, name: "" }));

interface OfflineResult {
  folder: string;
  saved: string[];
  manual: string[];
  failed: { name: string; error: string }[];
  cancelled: boolean;
}

/** Aplikace sady, které jde stáhnout (WinGet mimo Microsoft Store). */
export const offlineCandidates = (items: BundleItem[]) => items.filter((i) => i.source === "winget" && !isStoreId(i.packageId));

export async function prepareOffline(items: BundleItem[], title: string) {
  const { push } = useToasts.getState();
  const packages = offlineCandidates(items);
  if (!packages.length || useOfflineBundle.getState().running) return;
  const skipped = items.length - packages.length;
  // Nejdřív výběr složky (dialog), pak průběh po aplikacích
  useOfflineBundle.setState({ running: true, done: 0, total: 0, name: "" });
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<{ done: number; total: number; name: string }>("offline-progress", ({ payload }) =>
      useOfflineBundle.setState({ running: true, ...payload }),
    );
    const result = await invoke<OfflineResult | null>("offline_bundle", {
      packages: packages.map((p) => ({ packageId: p.packageId, name: p.name, version: p.version ?? null })),
      texts: {
        title,
        adminHint: i18n.t("offline.scriptAdmin"),
        done: i18n.t("offline.scriptDone"),
        manual: i18n.t("offline.readmeManual"),
        readme: i18n.t("offline.readmeIntro"),
      },
    });
    if (!result) return;
    const tone = result.failed.length ? "error" : "success";
    push(tone, i18n.t(result.cancelled ? "offline.cancelled" : "offline.done", { count: result.saved.length + result.manual.length, folder: result.folder }));
    if (result.manual.length) push("info", i18n.t("offline.manual", { names: result.manual.join(", ") }));
    if (result.failed.length) push("error", i18n.t("offline.failed", { names: result.failed.map((f) => f.name).join(", ") }), { record: true });
    if (skipped) push("info", i18n.t("offline.skipped", { count: skipped }));
    // Skript rovnou ukázat v Průzkumníku
    void revealItemInDir(`${result.folder}\\install.cmd`).catch(() => undefined);
  } catch (error) {
    push("error", i18n.t("offline.error", { error: String(error) }));
  } finally {
    unlisten?.();
    useOfflineBundle.setState({ running: false, done: 0, total: 0, name: "" });
  }
}

export const cancelOffline = () => void invoke("offline_cancel").catch(() => undefined);
