// Testy logiky frontendu (pnpm test): soubory src/**/*.test.ts, prostředí Node (bez okna
// a backendu Tauri – testuje se čistá logika: pravidla aktualizací, rozpoznání bezpečnostních
// oprav, alternativy, odhad času, odkazy unibox://, exporty). Spouští je i workflow Kontrola.
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    environment: "node",
  },
});
