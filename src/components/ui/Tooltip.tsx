import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Vzhled bubliny – stejný u slibů na domovské stránce, štítku Open source i u všech popisků tlačítek. */
const BUBBLE = "rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs leading-relaxed font-normal shadow-card";

/**
 * Bublina pod tlačítkem s třídou `peer` (sourozenec) – po najetí myší s malým
 * zpožděním, ať při přejíždění neproblikává, a hned při přechodu klávesnicí.
 * Druhý řádek (hint) říká, že kliknutím se otevřou podrobnosti.
 * Tlačítko na ni odkazuje přes aria-describedby={id}.
 */
export function HoverHint({ id, hint, children, className }: { id: string; hint: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      id={id}
      role="tooltip"
      className={cn(
        BUBBLE,
        "pointer-events-none absolute top-full left-1/2 z-30 mt-2 w-72 -translate-x-1/2 translate-y-1 text-muted opacity-0 transition duration-150 peer-hover:translate-y-0 peer-hover:opacity-100 peer-hover:delay-300 peer-focus-visible:translate-y-0 peer-focus-visible:opacity-100",
        className,
      )}
    >
      <span className="block text-fg/90">{children}</span>
      <span className="mt-1.5 block text-accent">{hint}</span>
    </span>
  );
}

/** Atribut, kam se během zobrazení bubliny odloží title – systémová bublina se pak neukáže. */
const PARKED = "data-native-title";
/** Zpoždění po najetí myší (stejné jako u HoverHint). */
const DELAY = 300;
/** Odstup bubliny od prvku a od okraje okna. */
const GAP = 8;
const EDGE = 8;

const titled = (node: EventTarget | null) => (node instanceof Element ? node.closest(`[title], [${PARKED}]`) : null);
const titleOf = (el: Element) => (el.getAttribute("title") ?? el.getAttribute(PARKED) ?? "").trim();

/**
 * Popisky (atribut title) v celé aplikaci jako bublina ve stylu HoverHint místo
 * systémové bubliny Windows. Prvek pod myší dočasně přijde o title (i nadřazené
 * prvky – jinak by se ukázal jejich), po odchodu myši ho dostane zpátky.
 * Při přechodu klávesnicí se bublina ukáže hned a title zůstane (systémová se
 * u fokusu neukazuje). Skryje ji kliknutí, Esc, posun stránky i změna okna.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ id: number; text: string; anchor: DOMRect } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: Element | null = null;
    let viaFocus = false;
    let parked: Element[] = [];
    let timer = 0;
    let shown = 0;

    const park = (node: Element) => {
      const text = node.getAttribute("title");
      if (text === null) return;
      node.setAttribute(PARKED, text);
      node.removeAttribute("title");
    };
    const unpark = (node: Element) => {
      const text = node.getAttribute(PARKED);
      node.removeAttribute(PARKED);
      if (text !== null && !node.hasAttribute("title")) node.setAttribute("title", text);
    };
    // Nový title během zobrazení (přepínač motivu po kliknutí) – znovu odložit a přepsat text bubliny
    const watcher = new MutationObserver(() => {
      if (!viaFocus) parked.forEach(park);
      const text = target ? titleOf(target) : "";
      setTip((tip) => (tip && tip.text !== text ? { ...tip, text } : tip));
    });

    const hide = () => {
      clearTimeout(timer);
      setTip(null);
    };
    const release = () => {
      hide();
      watcher.disconnect();
      parked.forEach(unpark);
      parked = [];
      target = null;
      viaFocus = false;
    };
    const show = (el: Element, focus: boolean) => {
      release();
      if (!titleOf(el)) return;
      target = el;
      viaFocus = focus;
      if (!focus) {
        for (let node: Element | null = el; node; node = node.parentElement) {
          if (!node.hasAttribute("title")) continue;
          park(node);
          parked.push(node);
        }
      }
      for (const node of focus ? [el] : parked) watcher.observe(node, { attributes: true, attributeFilter: ["title"] });
      timer = window.setTimeout(
        () => {
          const text = titleOf(el);
          if (target === el && el.isConnected && text) setTip({ id: ++shown, text, anchor: el.getBoundingClientRect() });
        },
        focus ? 0 : DELAY,
      );
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = titled(e.target);
      if (el === target && !viaFocus) return;
      if (el) show(el, false);
      else if (!viaFocus) release();
    };
    // Myš opustila okno
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget && !viaFocus) release();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = titled(e.target);
      if (el && e.target instanceof Element && e.target.matches(":focus-visible")) show(el, true);
    };
    const onFocusOut = () => {
      if (viaFocus) release();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    // Po kliknutí, posunu nebo změně okna bublina zmizí; title zůstane odložený, dokud myš prvek neopustí
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", release);
    };
  }, []);

  // Pod prvek (nevejde-li se dolů, nad něj), vodorovně na střed a uvnitř okna – ještě před vykreslením
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!tip || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const { anchor } = tip;
    const below = anchor.bottom + GAP + height <= innerHeight - EDGE || anchor.top - GAP - height < EDGE;
    el.style.left = `${Math.max(EDGE, Math.min(anchor.left + anchor.width / 2 - width / 2, innerWidth - width - EDGE))}px`;
    el.style.top = `${below ? anchor.bottom + GAP : anchor.top - GAP - height}px`;
    el.dataset.side = below ? "bottom" : "top";
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      key={tip.id}
      ref={bubble}
      role="tooltip"
      className={cn(BUBBLE, "tooltip-in pointer-events-none fixed top-0 left-0 z-[60] w-max max-w-72 break-words whitespace-pre-line text-fg/90")}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
