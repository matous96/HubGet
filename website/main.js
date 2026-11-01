// ==========================================================================
// Odkazy webu na jednom místě. Až bude e-mail hotový,
// stačí je vyplnit tady – všechny prvky s data-link="…" se aktualizují samy.
// Prázdná hodnota = zástupný odkaz (zatím nikam nevede).
// ==========================================================================
const LINKS = {
  github: "https://github.com/matous96/unibox",
  releases: "https://github.com/matous96/unibox/releases",
  // Instalátory z vydání na GitHubu – verzi přepisuje `pnpm website:release` (scripts/website-release.mjs)
  downloadExe: "https://github.com/matous96/unibox/releases/download/v0.1.21/HubGet_0.1.21_x64-setup.exe",
  downloadMsi: "https://github.com/matous96/unibox/releases/download/v0.1.21/HubGet_0.1.21_x64_en-US.msi",
  email: "",        // např. "mailto:ahoj@unibox.app"
};

// Texty, které vkládá skript – podle jazyka stránky (<html lang="…">)
const TEXTS = {
  cs: {
    placeholder: "Odkaz brzy doplníme", copy: "Kopírovat", copied: "Zkopírováno ✓", copyFailed: "Nelze kopírovat",
    menuOpen: "Otevřít menu", menuClose: "Zavřít menu", linkCopied: "Odkaz zkopírován ✓",
  },
  en: {
    placeholder: "Link coming soon", copy: "Copy", copied: "Copied ✓", copyFailed: "Can’t copy",
    menuOpen: "Open menu", menuClose: "Close menu", linkCopied: "Link copied ✓",
  },
};
const T = TEXTS[document.documentElement.lang] || TEXTS.cs;

for (const el of document.querySelectorAll("[data-link]")) {
  const url = LINKS[el.dataset.link];
  if (url) {
    el.href = url;
    if (/^https?:/.test(url) && !url.endsWith(".exe") && !url.endsWith(".msi")) {
      el.target = "_blank";
      el.rel = "noopener";
    }
  } else {
    el.classList.add("is-placeholder");
    el.title = T.placeholder;
    el.addEventListener("click", (e) => e.preventDefault());
  }
}

// ---------- Přepínač jazyka: zapamatovat volbu a zůstat na stejném místě stránky ----------
// Uložená volba má přednost před jazykem prohlížeče (viz skript v <head>).
for (const el of document.querySelectorAll("[data-lang-switch]")) {
  el.addEventListener("click", () => {
    try { localStorage.setItem("unibox-lang", el.hreflang); } catch {}
    if (location.hash) el.href = el.href.split("#")[0] + location.hash;
  });
}

// ---------- Motiv: světlý / tmavý ----------
const root = document.documentElement;
const media = matchMedia("(prefers-color-scheme: dark)");
document.getElementById("theme-toggle").addEventListener("click", () => {
  const current = root.dataset.theme || (media.matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  // Když se volba shoduje se systémem, nic neukládat – web pak dál sleduje Windows
  if (next === (media.matches ? "dark" : "light")) {
    delete root.dataset.theme;
    try { localStorage.removeItem("unibox-theme"); } catch {}
  } else {
    root.dataset.theme = next;
    try { localStorage.setItem("unibox-theme", next); } catch {}
  }
});

// ---------- Snímky obrazovky: chybějící soubor nechá zástupnou pozici ----------
// Chybí-li světlá varianta, zobrazí se v obou motivech tmavá.
for (const img of document.querySelectorAll(".shot__img")) {
  const hide = () => {
    if (img.classList.contains("shot__img--light")) {
      img.parentElement.querySelector(".shot__img--dark")?.classList.remove("shot__img--dark");
    }
    img.remove();
  };
  if (img.complete && img.naturalWidth === 0) hide();
  else img.addEventListener("error", hide, { once: true });
}

// ---------- Navigace: oddělovač po posunu ----------
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- Mobilní menu ----------
// Na úzké obrazovce se odkazy hlavičky schovají za tlačítko. Hlavička je v každé
// stránce zvlášť, proto tlačítko vkládá skript (bez skriptu by menu stejně nešlo otevřít).
const menu = nav.querySelector(".nav__links");
if (menu) {
  menu.id = "menu";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "icon-btn nav__toggle";
  toggle.setAttribute("aria-controls", "menu");
  toggle.innerHTML =
    '<svg class="i-menu" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>' +
    '<svg class="i-close" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>';
  nav.querySelector(".nav__actions").append(toggle);

  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? T.menuClose : T.menuOpen);
  };
  setOpen(false);
  toggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
  // Zavřít po výběru odkazu, klávesou Esc, klepnutím mimo hlavičku a při rozšíření okna
  menu.addEventListener("click", (e) => e.target.closest("a") && setOpen(false));
  addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
  document.addEventListener("click", (e) => !nav.contains(e.target) && setOpen(false));
  matchMedia("(min-width: 861px)").addEventListener("change", (e) => e.matches && setOpen(false));
}

// ---------- Telefon: poslat si odkaz do počítače ----------
// Sdílení systému (zpráva, e-mail…), jinak zkopírování odkazu do schránky.
for (const button of document.querySelectorAll("[data-share]")) {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    const url = location.href.split("#")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      button.textContent = T.linkCopied;
    } catch (error) {
      // Zavřené sdílení není chyba; jinak zkusit aspoň schránku
      if (error?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = T.linkCopied;
      } catch {
        button.textContent = T.copyFailed;
      }
    }
    setTimeout(() => (button.textContent = label), 2200);
  });
}

// ---------- Ukázka příkazů CLI (jen na úvodní stránce) ----------
const tabs = document.querySelectorAll(".term__tabs [role=tab]");
const cmd = document.getElementById("term-cmd");
const copyBtn = document.getElementById("term-copy");
if (cmd && copyBtn) {
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const t of tabs) t.setAttribute("aria-selected", String(t === tab));
      cmd.textContent = tab.dataset.cmd;
      copyBtn.textContent = T.copy;
    });
  }
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cmd.textContent);
      copyBtn.textContent = T.copied;
    } catch {
      copyBtn.textContent = T.copyFailed;
    }
    setTimeout(() => (copyBtn.textContent = T.copy), 1800);
  });
}

// ---------- Plynulé objevování sekcí ----------
const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add("is-visible"));
}
