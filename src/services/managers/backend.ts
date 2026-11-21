/**
 * Spuštění operace (instalace, aktualizace, odinstalace, stažení) v Rust
 * backendu – společné pro všechny skutečné správce (winget, Chocolatey, Scoop).
 *
 * Průběh a výstup příkazu posílá backend kanálem; výstup se zapisuje do
 * protokolu správce. Výsledek nese klíč chyby, podle kterého fronta úloh
 * pozná např. nefunkční odkaz na instalátor (záložní zdroj instalace).
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { writeLog } from "@/store/logs";
import type { OperationOutcome, OperationPhase, OperationProgress, SourceId } from "@/types";
import type { OperationHandle, OperationRequest } from "./types";

/** Zpráva z backendu během operace. */
type BackendEvent =
  | { type: "progress"; phase: OperationPhase; percent: number | null }
  | { type: "line"; text: string }
  /** Hláška HubGetu (předstažení selhalo, opakování jako správce…). */
  | { type: "notice"; key: string; detail: string | null };

export interface BackendResult {
  outcome: OperationOutcome;
  /** Návratový kód správce (u wingetu HRESULT). */
  code: number;
  /** Klíč chybové zprávy (wingetError.*, managerError.*). */
  errorKey: string | null;
  restartRequired: boolean;
  /** Poslední řádek výstupu – vodítko u neznámé chyby. */
  detail: string | null;
  /** Kdo podepsal stažený instalátor („“ = bez podpisu; chybí = nezjišťovalo se). */
  signer?: string;
}

/** Návratový kód jako HRESULT („0x8A150011“). */
export const hex = (code: number) => `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;

/**
 * Spustí operaci příkazem backendu (`winget_operation`, `choco_operation`…).
 * `errorMessage` převede neúspěšný výsledek na srozumitelnou zprávu, `extra`
 * jsou další parametry příkazu (u vývojářských správců `source`).
 */
export function startBackendOperation(
  source: SourceId,
  command: string,
  request: OperationRequest,
  onProgress: (progress: OperationProgress) => void,
  errorMessage: (result: BackendResult) => string,
  extra: Record<string, unknown> = {},
): OperationHandle {
  const id = crypto.randomUUID();
  const channel = new Channel<BackendEvent>();
  channel.onmessage = (event) => {
    if (event.type === "progress") onProgress({ phase: event.phase, percent: event.percent });
    else if (event.type === "line") writeLog(source, "output", event.text);
    else writeLog(source, event.key === "signedBy" ? "info" : "warning", i18n.t(`logs.notice.${event.key}`, { detail: event.detail ?? "" }));
  };

  const done = invoke<BackendResult>(command, { ...extra, id, request, onEvent: channel }).then(
    (result) => ({
      outcome: result.outcome,
      error: result.outcome === "error" ? errorMessage(result) : undefined,
      errorKey: result.outcome === "error" ? (result.errorKey ?? undefined) : undefined,
      restartRequired: result.restartRequired,
      signer: result.signer,
    }),
    (e: unknown) => ({ outcome: "error" as const, error: String(e) }),
  );
  return { done, cancel: () => void invoke("cancel_operation", { id }) };
}

/** Chyba Chocolatey / Scoopu: obecná zpráva s kódem a posledním řádkem výstupu. */
export function managerErrorMessage(label: string) {
  return (result: BackendResult) => {
    const key = result.errorKey ?? "failed";
    // Pád instalátoru: kód pádu z výstupu (0xC0000005) místo návratového kódu správce
    const code = key === "installerCrashed" && result.detail ? result.detail : result.code;
    const message = i18n.t(`managerError.${key}`, { name: label, code });
    return result.detail && key === "failed" ? `${message} – ${result.detail}` : message;
  };
}
