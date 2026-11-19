/**
 * Export a import profilu počítače – seznamu nainstalovaných aplikací a jejich
 * nastavení (přenos na nový počítač, záloha). Sdílí ho karta Rychlé akce na
 * domovské stránce, Nastavení a otevírání souborů v Sadách balíčků.
 *
 *  - Export: profil HubGetu (.json – všichni správci, volby instalace,
 *    ignorované / odložené / automatické aktualizace), přehledná stránka
 *    (.html – lze i importovat), nebo `winget export` (.json – umí ho i samotný
 *    winget: `winget import -i soubor.json`).
 *  - Import: dialog se souhrnem a „Nainstalovat vše“ (ProfileImportDialog);
 *    ze Sad balíčků se soubor jen otevře v seznamu.
 */
import { useTranslation } from "react-i18next";
import { useInstalledItems } from "@/hooks/useInstalledItems";
import { sourceKey, useSourceIndex } from "@/hooks/usePackages";
import { safeFileName } from "@/lib/download";
import { buildProfile, buildProfileHtml, buildWingetConfiguration, buildWingetExport, parseProfileFile, portableItems, profileConfig } from "@/lib/profile";
import { APP_VERSION } from "@/services/updates";
import { useAutoUpdates } from "@/store/autoUpdates";
import { useBundle } from "@/store/bundle";
import { installFlags, useInstallOptions } from "@/store/installOptions";
import { useProfileImport } from "@/store/profileImport";
import { useToasts } from "@/store/toasts";
import { snoozeActive, useUpdatePins } from "@/store/updatePins";
import { useSaveFile } from "./useSaveFile";

export type ProfileFormat = "json" | "html";

/** Přípony souborů, které import přijme (sada, profil, stránka profilu, export wingetu). */
export const PROFILE_ACCEPT = ".ubundle,.json,.html,.htm";

export function useProfileTransfer() {
  const { t, i18n } = useTranslation();
  const toast = useToasts((s) => s.push);
  const saveFile = useSaveFile();
  const { items } = useInstalledItems();
  const sourceIndex = useSourceIndex();
  const loadBundle = useBundle((s) => s.load);
  const showImport = useProfileImport((s) => s.show);

  const portableCount = portableItems(items).length;
  const wingetCount = items.filter((i) => i.pkg.source === "winget" && (i.pkg.origin === "winget" || i.pkg.origin === "msstore")).length;

  /** Profil se všemi spravovanými aplikacemi, jejich volbami instalace a nastavením aktualizací. */
  const exportProfile = async (format: ProfileFormat = "json") => {
    const name = t("profile.defaultName", { date: new Date().toLocaleDateString() });
    const byApp = useInstallOptions.getState().byApp;
    const profile = buildProfile(items, name);
    profile.packages = profile.packages.map((p) => {
      const options = installFlags(byApp[p.appId]);
      return options ? { ...p, options } : p;
    });
    const pins = Object.fromEntries(Object.entries(useUpdatePins.getState().pins).filter(([, pin]) => snoozeActive(pin)));
    const config = profileConfig(profile.packages, pins, useAutoUpdates.getState().selected);
    if (config) profile.config = config;

    const base = safeFileName(name, "profil");
    const describe = (path: string) => t("profile.exportedTo", { count: portableCount, path });
    if (format === "html") {
      await saveFile(`${base}.html`, buildProfileHtml(profile, items, i18n.language, APP_VERSION), "text/html", describe);
    } else {
      await saveFile(`${base}.json`, JSON.stringify(profile, null, 2), "application/json", describe);
    }
  };

  /** Soubor pro `winget import` (jen aplikace z wingetu a Microsoft Storu). */
  const exportWinget = async () => {
    await saveFile("winget-export.json", JSON.stringify(buildWingetExport(items), null, 2), "application/json", (path) =>
      t("profile.exportedTo", { count: wingetCount, path }),
    );
  };

  /** Konfigurace pro `winget configure` (YAML) – nový počítač jedním příkazem, i ve firmách. */
  const exportConfiguration = async () => {
    const { yaml, count } = buildWingetConfiguration(portableItems(items), t("profile.configurationTitle"));
    await saveFile("hubget.winget", yaml, "text/yaml", (path) => t("profile.exportedTo", { count, path }));
  };

  /**
   * Načte soubor profilu (.json, .html, .ubundle nebo export wingetu): ukáže
   * dialog s instalací všeho, nebo (ze Sad balíčků) soubor rovnou otevře v seznamu.
   */
  const importFile = async (file: File, { navigate: withDialog = true }: { navigate?: boolean } = {}) => {
    try {
      const profile = parseProfileFile(await file.text(), (packageId) => {
        const entry = sourceIndex.get(sourceKey("winget", packageId));
        return { appId: entry?.id ?? sourceKey("winget", packageId), name: entry?.name ?? packageId };
      });
      if (withDialog) {
        showImport(profile);
      } else {
        loadBundle(profile);
        toast("success", t("profile.imported", { count: profile.packages.length }));
      }
    } catch {
      toast("error", t("profile.importFailed"));
    }
  };

  return { portableCount, wingetCount, exportProfile, exportWinget, exportConfiguration, importFile };
}
