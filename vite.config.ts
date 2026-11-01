import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

/**
 * Ve vývoji stejná pravidla CSP jako v sestavené aplikaci (app.security.csp v src-tauri/tauri.conf.json).
 * Stránku ve vývoji servíruje Vite, ne Tauri – bez toho by se CSP neuplatnila a co blokuje, by se
 * ukázalo až po vydání (0.1.20: náhled snímku přes blob:). Navíc jen to, co potřebuje vývojový
 * server: vložený skript React Refresh a spojení HMR.
 */
function productionCsp(): Plugin {
  const config = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const csp: string = config.app.security.csp;
  const dev = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (d.startsWith("connect-src ") ? `${d} ws://localhost:1420` : d))
    .concat("script-src 'self' 'unsafe-inline'")
    .join("; ");
  return {
    name: "hubget-production-csp",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Content-Security-Policy", dev);
        next();
      });
    },
  };
}

// Konfigurace Vite. Port 1420 očekává Tauri (`devUrl` v src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react(), tailwindcss(), productionCsp()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Výpisy Rustu (tauri dev) se nemají mazat
  clearScreen: false,
  // Proměnné TAURI_ENV_* (platforma, ladění) jsou dostupné i ve frontendu
  envPrefix: ["VITE_", "TAURI_ENV_"],
  server: {
    port: 1420,
    strictPort: true,
    // Na tomto disku nativní sledování souborů občas vynechá rychle po sobě
    // uložené změny (stránka pak zůstane prázdná). Polling je spolehlivější.
    // Rust (src-tauri) a data pipeline Vite sledovat nemusí – hlavně ne obří src-tauri/target.
    watch: { usePolling: true, interval: 300, ignored: ["**/src-tauri/**", "**/data-pipeline/**"] },
  },
  build: {
    // WebView2 ve Windows 10/11 je vždy aktuální Chromium
    target: "chrome120",
  },
});
