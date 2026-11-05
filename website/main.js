// ==========================================================================
// Odkazy webu na jednom místě – všechny prvky s data-link="…" se aktualizují samy.
// Prázdná hodnota = zástupný odkaz (zatím nikam nevede).
// ==========================================================================
const LINKS = {
  github: "https://github.com/matous96/HubGet",
  releases: "https://github.com/matous96/HubGet/releases",
  // Instalátory z vydání na GitHubu – verzi přepisuje `pnpm website:release` (scripts/website-release.mjs)
  downloadExe: "https://github.com/matous96/HubGet/releases/download/v0.2.1/HubGet_0.2.1_x64-setup.exe",
  downloadMsi: "https://github.com/matous96/HubGet/releases/download/v0.2.1/HubGet_0.2.1_x64_en-US.msi",
};

// Kontaktní formulář (stránka Kontakt): stejná služba a přístupový klíč jako formulář
// v aplikaci (src/config.ts – CONTACT_FORM_KEY). Klíč je veřejný a sdílí měsíční limit.
const CONTACT_FORM_KEY = "b43a3256-556d-4f08-a4e2-45d6b81e0c66";

// Texty, které vkládá skript – podle jazyka stránky (<html lang="…">). Upravují se v Pages CMS
// (website/content/texty/<jazyk>/spolecne.json → hlasky), přepisuje je scripts/website-texts.mjs.
const TEXTS = {
  cs: {
    placeholder: "Odkaz brzy doplníme",
    copy: "Kopírovat",
    copied: "Zkopírováno ✓",
    copyFailed: "Nelze kopírovat",
    menuOpen: "Otevřít menu",
    menuClose: "Zavřít menu",
    sending: "Odesílám…",
    contactOffline: "Zprávu se nepodařilo odeslat. Zkontrolujte připojení k internetu.",
    contactRateLimit: "Teď nejde odeslat další zprávu. Zkuste to prosím za chvíli.",
    contactFailed: "Zprávu se nepodařilo odeslat. Zkuste to prosím znovu, nebo problém nahlaste na GitHubu.",
    contactReason: "Důvod",
  },
  en: {
    placeholder: "Link coming soon",
    copy: "Copy",
    copied: "Copied ✓",
    copyFailed: "Can’t copy",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    sending: "Sending…",
    contactOffline: "The message couldn’t be sent. Check your internet connection.",
    contactRateLimit: "Another message can’t be sent right now. Please try again in a moment.",
    contactFailed: "The message couldn’t be sent. Please try again, or report the problem on GitHub.",
    contactReason: "Reason",
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
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const current = root.dataset.theme || (media.matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  const apply = () => {
    // Když se volba shoduje se systémem, nic neukládat – web pak dál sleduje Windows
    if (next === (media.matches ? "dark" : "light")) {
      delete root.dataset.theme;
      try { localStorage.removeItem("unibox-theme"); } catch {}
    } else {
      root.dataset.theme = next;
      try { localStorage.setItem("unibox-theme", next); } catch {}
    }
  };
  // Jedno plynulé prolnutí celé stránky (View Transitions) – jinak se pozadí přebarví hned,
  // tlačítka za 0,15 s a snímky aplikace přeskočí. Vlastní přechody prvků během něj stojí
  // (theme-switching), ať se nic neanimuje dvakrát. Bez podpory nebo s omezeným pohybem hned.
  if (!document.startViewTransition || reducedMotion.matches) return apply();
  root.classList.add("theme-switching");
  // Přerušené prolnutí (změna velikosti okna) odmítne „ready“ – motiv se přepne i tak, jen bez animace
  const transition = document.startViewTransition(apply);
  transition.ready.catch(() => {});
  transition.finished.catch(() => {}).finally(() => root.classList.remove("theme-switching"));
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
  const actions = nav.querySelector(".nav__actions");
  actions.append(toggle);

  // Na telefonu se jazyk a motiv přesunou z hlavičky na konec menu – vedle loga,
  // Stáhnout a tlačítka menu by se nevešly. Přesouvají se samotné prvky (i s obsluhou).
  const tools = document.createElement("div");
  tools.className = "nav__menu-tools";
  menu.append(tools);
  const movable = [nav.querySelector(".lang-switch"), document.getElementById("theme-toggle")].filter(Boolean);
  const homes = movable.map((el) => el.nextElementSibling);
  const narrow = matchMedia("(max-width: 640px)");
  const place = () => {
    if (narrow.matches) tools.append(...movable);
    else movable.forEach((el, i) => actions.insertBefore(el, homes[i]));
  };
  narrow.addEventListener("change", place);
  place();

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

// ---------- Kontaktní formulář (jen stránka Kontakt) ----------
// Web3Forms pošle zprávu e-mailem autorovi, „Odpovědět“ míří na e-mail odesílatele.
const contactForm = document.getElementById("contact-form");
const contactDone = document.getElementById("contact-done");
if (contactForm && contactDone) {
  const status = contactForm.querySelector(".contact-form__status");
  const submit = contactForm.querySelector("[type=submit]");
  const submitLabel = submit.querySelector("span");
  const sendLabel = submitLabel.textContent;
  // E-mail čte autor – téma vždy česky, bez ohledu na jazyk stránky
  const TOPICS = { question: "Dotaz", bug: "Chyba", idea: "Nápad", collaboration: "Spolupráce", other: "Jiné" };

  // Vrátí text chyby, nebo null po úspěšném odeslání
  const send = async (body) => {
    let response;
    try {
      response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        // JSON, ne formulář – na x-www-form-urlencoded služba odpoví přesměrováním (CORS chyba)
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return T.contactOffline;
    }
    if (response.status === 429) return T.contactRateLimit;
    const result = await response.json().catch(() => null);
    if (response.ok && result?.success) return null;
    // Důvod odmítnutí od služby (např. podezření na spam) – anglicky, ale řekne víc než obecná chyba
    return result?.message ? `${T.contactFailed} ${T.contactReason}: ${result.message}` : T.contactFailed;
  };

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(contactForm);
    const topic = TOPICS[data.get("topic")] || TOPICS.other;
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    status.textContent = "";
    submit.disabled = true;
    submitLabel.textContent = T.sending;
    const error = await send({
      access_key: CONTACT_FORM_KEY,
      subject: `HubGet (web): ${topic}${name ? ` – ${name}` : ""}`,
      from_name: "HubGet – web",
      name: name || "—",
      email,
      Téma: topic,
      message: String(data.get("message") || "").trim(),
      Odkud: `web hubget.eu (${document.documentElement.lang === "en" ? "anglicky" : "česky"})`,
      // Zaškrtnutá past = robot, Web3Forms zprávu zahodí
      ...(data.has("botcheck") && { botcheck: true }),
    });
    submit.disabled = false;
    submitLabel.textContent = sendLabel;
    if (error) {
      status.textContent = error;
      return;
    }
    contactDone.querySelector("[data-email]").textContent = email;
    contactForm.reset();
    contactForm.hidden = true;
    contactDone.hidden = false;
    contactDone.querySelector("h2").focus();
  });

  contactDone.querySelector("button").addEventListener("click", () => {
    contactDone.hidden = true;
    contactForm.hidden = false;
    contactForm.querySelector("textarea").focus();
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
