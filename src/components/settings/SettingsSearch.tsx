/**
 * Hledání v Nastavení (jako ve VS Code / nastavení macOS): se zadaným dotazem se pod sebou
 * vykreslí všechny sekce a zůstane vidět jen to, co dotaz obsahuje – řádek karty (přímý
 * potomek jejího těla, v obalu s více řádky každý Row zvlášť), celá karta, když dotaz
 * obsahuje její nadpis, a celá sekce, když ho obsahuje její název. Ovládací prvky ve
 * výsledcích fungují jako v sekci. Shody se
 * zvýrazní přes CSS Custom Highlight API (DOM se nemění). Velká a malá písmena ani
 * diakritika nerozhodují („oznameni“ najde „Oznámení“).
 *
 * Filtruje se v DOM, ne podle seznamu položek – nový řádek v Nastavení je hned
 * dohledatelný a nic se nemusí udržovat zvlášť. Obsah, který se načte později
 * (stav správců, účet), filtr zachytí přes MutationObserver.
 */
import { SearchX } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/States";
import { normalize } from "@/lib/utils";

/** Název zvýraznění pro ::highlight() v styles/index.css. */
const HIGHLIGHT = "settings-search";

/** Text bez diakritiky malými písmeny a pro každý jeho znak pozice v původním textu. */
function fold(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const ch of normalize(text[i])) {
      folded += ch;
      at.push(i);
    }
  }
  return { folded, at };
}

const matches = (element: Element, q: string) => normalize(element.textContent ?? "").includes(q);

/** Skryje, co dotaz neobsahuje; vrátí, jestli zůstala vidět aspoň jedna sekce. */
function filter(root: HTMLElement, q: string): boolean {
  let any = false;
  for (const section of root.querySelectorAll<HTMLElement>("[data-settings-section]")) {
    const title = section.querySelector("[data-settings-section-title]");
    const whole = !!title && matches(title, q);
    const cards = section.querySelectorAll<HTMLElement>("[data-settings-card]");
    let visible = whole;
    for (const card of cards) {
      const cardTitle = card.querySelector("[data-settings-title]");
      const all = whole || (!!cardTitle && matches(cardTitle, q));
      const body = card.querySelector("[data-settings-body]");
      let cardVisible = all;
      for (const unit of body ? Array.from(body.children) : []) {
        // Obal s několika řádky (podvolby synchronizace) – každý řádek zvlášť
        const nested = unit.matches("[data-settings-row]") ? [] : Array.from(unit.querySelectorAll<HTMLElement>("[data-settings-row]"));
        let show = all;
        if (nested.length) {
          for (const row of nested) {
            row.hidden = !(all || matches(row, q));
            show ||= !row.hidden;
          }
        } else {
          show ||= matches(unit, q);
        }
        (unit as HTMLElement).hidden = !show;
        cardVisible ||= show;
      }
      card.hidden = !cardVisible;
      visible ||= cardVisible;
    }
    if (cards.length) {
      // Obsah vedle karet (upozornění nad nimi) – jen když obsahuje dotaz
      for (const child of Array.from(section.children) as HTMLElement[]) {
        if (child === title || child.matches("[data-settings-card]") || child.querySelector("[data-settings-card]")) continue;
        child.hidden = !(whole || matches(child, q));
        visible ||= !child.hidden;
      }
    } else {
      // Sekce bez karet (vlastní rozvržení) – podle textu celé sekce
      visible ||= matches(section, q);
    }
    section.hidden = !visible;
    any ||= visible;
  }
  return any;
}

/** Zvýrazní výskyty dotazu ve viditelném textu. */
function highlight(root: HTMLElement, q: string) {
  if (!("highlights" in CSS)) return;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!text.trim() || node.parentElement?.closest("[hidden]")) continue;
    const { folded, at } = fold(text);
    for (let from = folded.indexOf(q); from >= 0; from = folded.indexOf(q, from + q.length)) {
      const range = new Range();
      range.setStart(node, at[from]);
      range.setEnd(node, at[from + q.length - 1] + 1);
      ranges.push(range);
    }
  }
  CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
}

export function SettingsSearch({ query, children }: { query: string; children: ReactNode }) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = normalize(query.trim());
    const apply = () => {
      setEmpty(!filter(el, q));
      highlight(el, q);
    };
    apply();
    // Obsah načtený později (stav správců, přihlášení) – mění se jen potomci a text, ne atributy
    // (hidden nastavuje filtr sám, jinak by se volal donekonečna)
    const observer = new MutationObserver(apply);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if ("highlights" in CSS) CSS.highlights.delete(HIGHLIGHT);
    };
  }, [query]);

  return (
    <div ref={root}>
      {children}
      {empty && <EmptyState icon={SearchX} message={t("settings.searchEmpty")} />}
    </div>
  );
}
