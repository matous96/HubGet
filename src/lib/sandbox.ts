/**
 * Vyzkoušet aplikaci ve Windows Sandboxu (nabídka u tlačítka Instalovat, jen WinGet):
 * backend (sandbox.rs) stáhne instalátor přes winget a spustí ho v Sandboxu –
 * oddělených Windows, která se po zavření zahodí. Bez zapnutého Sandboxu poradí, jak ho zapnout.
 */
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { useToasts } from "@/store/toasts";

let available: Promise<boolean> | null = null;

/** Je Windows Sandbox zapnutý (zjistí se jednou za běh). */
export const sandboxAvailable = () => (available ??= invoke<boolean>("sandbox_available").catch(() => false));

/** Právě se připravuje (stahování instalátoru) – druhé kliknutí nic nespustí. */
const preparing = new Set<string>();

export async function trySandbox(packageId: string, name: string) {
  const { push } = useToasts.getState();
  if (!(await sandboxAvailable())) {
    push("info", i18n.t("sandbox.unavailable"));
    return;
  }
  if (preparing.has(packageId)) return;
  preparing.add(packageId);
  push("info", i18n.t("sandbox.preparing", { name }));
  try {
    await invoke("sandbox_try", { packageId });
    push("success", i18n.t("sandbox.started", { name }));
  } catch (error) {
    push("error", i18n.t("sandbox.failed", { name, error: String(error) }));
  } finally {
    preparing.delete(packageId);
  }
}
