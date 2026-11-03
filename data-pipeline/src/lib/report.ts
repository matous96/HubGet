/**
 * Výpis z běhu pipeline – workflow Katalog ho zveřejní na hubget.eu/catalog-report.json
 * (logy GitHub Actions jsou jen pro přihlášené, takže by se příčina problému s katalogem
 * jinak jen odhadovala). Obsahuje jen veřejné údaje: počty, adresy obrázků, názvy aplikací.
 * scripts/check-catalog.mjs do něj doplní porovnání se zveřejněným katalogem.
 */
import { writeFile } from "node:fs/promises";
import { logLines } from "./log.ts";

const metrics: Record<string, unknown> = {};

/** Údaj do výpisu (počty ikon, nalezené obecné obrázky…). */
export function reportMetric(key: string, value: unknown) {
  metrics[key] = value;
}

export async function writeReport(file: string, generatedAt: string) {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const report = {
    generatedAt,
    run: GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : null,
    metrics,
    warnings: logLines.filter((line) => /^\S+ s\s+! /.test(line)).map((line) => line.replace(/^\S+ s\s+! /, "")),
    log: logLines,
  };
  await writeFile(file, JSON.stringify(report, null, 1));
}
