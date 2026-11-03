/**
 * Aktualizace samotného HubGetu (tauri-plugin-updater).
 *
 * Nainstalovaný HubGet si stáhne latest.json z GitHub Releases, když GitHub neodpoví,
 * kopii z hubget.eu (adresy v tauri.conf.json → plugins.updater.endpoints, v tomto
 * pořadí; plugin vezme první platnou odpověď). Je-li tam novější verze,
 * nabídne ji; instalátor se po stažení ověří podpisem (veřejný klíč je
 * v aplikaci, soukromý jen u vydavatele – scripts/release.mjs) a spustí se
 * v pasivním režimu, po instalaci se HubGet znovu spustí.
 * Ve webové verzi se aktualizace nehledají.
 */
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "@/lib/tauri";
import pkgJson from "../../package.json";

export type { Update };

export const APP_VERSION: string = pkgJson.version;

/** Novější verze HubGetu, nebo null (aktuální verze / webová verze). */
export async function findUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  return check({ timeout: 20_000 });
}

/** Nejdelší stahování instalátoru (~6 MB) – i na pomalém připojení. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/**
 * Stáhne aktualizaci, ověří podpis, nainstaluje a restartuje HubGet.
 * `onProgress` dostává procenta stažení (null = velikost neznámá).
 */
export async function installUpdate(update: Update, onProgress: (percent: number | null) => void): Promise<void> {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall(
    (event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        received += event.data.chunkLength;
        onProgress(total ? Math.min(100, (received / total) * 100) : null);
      } else onProgress(100);
    },
    // Vlastní limit pro stažení – jinak platí 20 s z kontroly (findUpdate) na celý instalátor
    { timeout: DOWNLOAD_TIMEOUT_MS },
  );
  // Instalátor Windows HubGet obvykle ukončí sám; jinak restart tady
  await relaunch();
}
