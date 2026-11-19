/**
 * Přetažení souboru na okno HubGetu → „Čím otevřu tento soubor?“ (/open-with). Nativní
 * přetahování Tauri je vypnuté (dragDropEnabled: false), soubory chodí jako běžné události
 * prohlížeče – stačí název souboru, cesta ani obsah se nečtou. Místa, která soubory přijímají
 * sama (snímky obrazovky, přílohy kontaktního formuláře), si přetažení vyřídí sama
 * (preventDefault) – tady se pak nic neděje. Bez tohoto by WebView2 puštěný soubor otevřel
 * místo aplikace.
 */
import { FileQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { extensionOf } from "@/lib/openWith";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

export function FileDropOpenWith() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Nad místem, které soubor přijme samo, nápověda zmizí
      setDragging(!e.defaultPrevented);
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      const handled = e.defaultPrevented;
      e.preventDefault();
      if (handled) return;
      const name = e.dataTransfer?.files[0]?.name ?? "";
      const ext = extensionOf(name.includes(".") ? name : "");
      if (ext) navigate(`/open-with?ext=${encodeURIComponent(ext)}&file=${encodeURIComponent(name)}`);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [navigate]);

  if (!dragging) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-accent/10 p-8 backdrop-blur-[2px]">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-surface/95 px-10 py-8 text-center shadow-card-hover">
        <FileQuestion className="size-10 text-accent" />
        <p className="font-display text-lg font-bold">{t("openWith.dropTitle")}</p>
        <p className="text-sm text-muted">{t("openWith.dropText")}</p>
      </div>
    </div>
  );
}
