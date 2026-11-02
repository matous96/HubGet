/**
 * Poznámky k vydání (zobrazují se v aplikaci, fungují i bez internetu).
 * Nové vydání přidejte na začátek pole – `pnpm release` z něj zároveň
 * aktualizuje domovskou stránku webu (scripts/website-release.mjs).
 */
import type { Localized } from "./editorial";

/** Karta „To nejlepší z verze“ na domovské stránce webu. */
export interface FeaturedNews {
  title: Localized;
  text: Localized;
  /**
   * Odkaz karty na domovské stránce: kotva domovské stránky ("#stahnout") nebo podstránka,
   * která má v každém jazyce jiný soubor ({ cs: "funkce.html#po-spusteni", en: "features.html#po-spusteni" });
   * bez odkazu vede karta na záznam verze v Novinkách.
   */
  href?: string | Localized;
}

export interface Release {
  version: string;
  /** Datum vydání (YYYY-MM-DD). */
  date: string;
  highlights: Localized[];
  /** Dvě největší novinky pro web; bez nich se karty složí z prvních dvou bodů `highlights`. */
  featured?: FeaturedNews[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.1.22",
    date: "2026-11-02",
    highlights: [
      {
        cs: "Rychlejší první spuštění: na novém počítači se sekce Dnes ukáže hned i s ikonami a karty v prvních sekundách nepřeskakují.",
        en: "Faster first launch: on a new PC, the Today section appears right away with its icons, and the cards no longer jump around in the first seconds.",
      },
      {
        cs: "Ikony aplikací se stahují rychleji – až 12 najednou.",
        en: "App icons download faster – up to 12 at once.",
      },
      {
        cs: "Přepnutí světlého a tmavého motivu jedním plynulým prolnutím celého okna.",
        en: "Switching between light and dark theme is one smooth cross-fade of the whole window.",
      },
      {
        cs: "Bez internetu detail aplikace řekne, že hodnocení a snímky teď nejde načíst – místo „zatím bez hodnocení“ a „žádné snímky“.",
        en: "Offline, an app's page now says ratings and screenshots can't be loaded right now – instead of “no ratings yet” and “no screenshots”.",
      },
      {
        cs: "Když některý správce balíčků nevrátí seznam nainstalovaných, stránka Nainstalované na to upozorní a nabídne Zkusit znovu.",
        en: "When a package manager doesn't return its list of installed apps, the Installed page says so and offers Try again.",
      },
      {
        cs: "Opraveno: ikona, která se při výpadku sítě nenačetla, se už nevyřazuje natrvalo.",
        en: "Fixed: an icon that failed to load during a network outage is no longer left out for good.",
      },
    ],
    featured: [
      {
        title: { cs: "Okamžitý start", en: "Instant first launch" },
        text: {
          cs: "Na novém počítači se sekce Dnes ukáže hned i s ikonami – bez čekání na internet.",
          en: "On a new PC, the Today section appears instantly, icons included – no waiting for the internet.",
        },
      },
      {
        title: { cs: "Plynulý motiv", en: "Smooth theme switch" },
        text: {
          cs: "Světlý a tmavý motiv se přepnou jedním plynulým prolnutím celého okna.",
          en: "Light and dark themes switch with one smooth cross-fade of the whole window.",
        },
      },
    ],
  },
  {
    version: "0.1.21",
    date: "2026-11-01",
    highlights: [
      {
        cs: "Opraveno: náhled snímku obrazovky v kontaktním formuláři a u Přidat snímek v detailu aplikace zůstával prázdný.",
        en: "Fixed: the screenshot preview in the contact form and in Add screenshot on an app's page stayed empty.",
      },
    ],
    // Opravná verze – na webu dál karty hlavních novinek z 0.1.20 (0.1.21 je obsahuje také)
    featured: [
      {
        title: { cs: "Nové kategorie", en: "New categories" },
        text: {
          cs: "Umělá inteligence, Hudba a zvuk, Vzdělávání, Finance, Cloud, Internet a síť a Přizpůsobení – a přesnější zařazení aplikací.",
          en: "AI, Music & Audio, Education, Finance, Cloud, Internet & Network, and Personalization – with far more accurate sorting.",
        },
      },
      {
        title: { cs: "Aplikace z webu výrobce", en: "Apps from the vendor's website" },
        text: {
          cs: "DaVinci Resolve, VMware Workstation Pro a další – stažení z oficiálního webu, po instalaci je HubGet pozná a otevře.",
          en: "DaVinci Resolve, VMware Workstation Pro and more – download from the official website, then HubGet recognizes and opens them.",
        },
      },
    ],
  },
  {
    version: "0.1.20",
    date: "2026-11-01",
    highlights: [
      {
        cs: "Nové kategorie Umělá inteligence, Hudba a zvuk, Vzdělávání a věda, Finance, Cloud a úložiště, Internet a síť a Přizpůsobení. Aplikace jsou zařazené mnohem přesněji – hudební přehrávače a editory najdete v Hudbě a v Ostatních zůstalo jen to, co jinam opravdu nepatří.",
        en: "New categories: AI, Music & Audio, Education & Science, Finance, Cloud & Storage, Internet & Network, and Personalization. Apps are sorted much more accurately – music players and editors are in Music, and Other holds only what truly fits nowhere else.",
      },
      {
        cs: "Aplikace, které výrobce dává jen na svém webu: DaVinci Resolve, VMware Workstation Pro, Cisco Packet Tracer, Houdini a další. Tlačítko Stáhnout z webu otevře oficiální stránku a nainstalovanou aplikaci HubGet pozná a otevře.",
        en: "Apps the vendor offers only on its own website: DaVinci Resolve, VMware Workstation Pro, Cisco Packet Tracer, Houdini and more. Get from website opens the official page, and HubGet recognizes and opens the app once it's installed.",
      },
      {
        cs: "Tlačítko Otevřít u všech nainstalovaných aplikací – i u programů mimo správce balíčků. Když program spustit nejde, otevře se aspoň jeho složka.",
        en: "An Open button for every installed app – including programs outside package managers. If a program can't be started, its folder opens instead.",
      },
      {
        cs: "Kontaktní formulář v Nastavení → Kontakt (a pod ikonou obálky v horní liště): napište nám dotaz, nápad nebo chybu, i se snímky obrazovky.",
        en: "A contact form in Settings → Contact (and under the envelope icon in the top bar): send us a question, an idea or a bug, screenshots included.",
      },
      {
        cs: "Nainstalované jde seřadit podle toho, co jste nainstalovali naposledy.",
        en: "Installed apps can be sorted by what you installed most recently.",
      },
      {
        cs: "Přenosné aplikace na ploše (Tor Browser) HubGet pozná, aktualizuje i odinstaluje. Aplikace bez ikony mají dlaždici se symbolem kategorie a banner tmavého loga má jeho barvu.",
        en: "HubGet recognizes, updates and uninstalls portable apps on the desktop (Tor Browser). Apps without an icon get a tile with their category's symbol, and a dark logo gets a banner in its own color.",
      },
    ],
    featured: [
      {
        title: { cs: "Nové kategorie", en: "New categories" },
        text: {
          cs: "Umělá inteligence, Hudba a zvuk, Vzdělávání, Finance, Cloud, Internet a síť a Přizpůsobení – a přesnější zařazení aplikací.",
          en: "AI, Music & Audio, Education, Finance, Cloud, Internet & Network, and Personalization – with far more accurate sorting.",
        },
      },
      {
        title: { cs: "Aplikace z webu výrobce", en: "Apps from the vendor's website" },
        text: {
          cs: "DaVinci Resolve, VMware Workstation Pro a další – stažení z oficiálního webu, po instalaci je HubGet pozná a otevře.",
          en: "DaVinci Resolve, VMware Workstation Pro and more – download from the official website, then HubGet recognizes and opens them.",
        },
      },
    ],
  },
  {
    version: "0.1.19",
    date: "2026-10-30",
    highlights: [
      {
        cs: "Unibox se teď jmenuje HubGet a web najdete na hubget.eu. Aktualizace převede instalaci sama – nastavení, oblíbené, sady, přihlášení i historie zůstanou, stejně jako zástupci a připnutí na hlavním panelu.",
        en: "Unibox is now called HubGet, and its website lives at hubget.eu. The update moves your installation over by itself – settings, favorites, collections, sign-in and history stay, as do your shortcuts and taskbar pin.",
      },
      {
        cs: "Klidné automatické aktualizace: běžící aplikace počkají, až je zavřete, nepovedená aktualizace se zkusí příště a na pozadí nikdy nevyskočí dialog UAC. Co potřebuje práva správce, čeká v Dostupných aktualizacích – potvrdíte to všechno jedním dialogem Windows.",
        en: "Calm automatic updates: running apps wait until you close them, a failed update is retried next time, and no UAC dialog ever pops up in the background. Anything that needs administrator rights waits in Updates available – confirm it all with a single Windows dialog.",
      },
      {
        cs: "Filtr platformy x64 / ARM64 / x86 v hledání, kategoriích a Nejstahovanějších – verze pro jiné procesory výsledky nezahltí.",
        en: "A platform filter (x64 / ARM64 / x86) in search, categories and Top charts – versions for other processors no longer flood the results.",
      },
      {
        cs: "Procenta u instalace a aktualizace a oranžová tečka na ikoně u hodin, když jsou k dispozici aktualizace (vypnete v Nastavení → Obecné).",
        en: "Percentages while installing and updating, and an orange dot on the icon by the clock when updates are available (turn it off in Settings → General).",
      },
      {
        cs: "Méně chyb při aktualizacích: aplikace a moduly PowerShellu pro všechny uživatele se aktualizují rovnou jako správce, aktualizace MSI pro všechny uživatele projdou a Scoop si před kontrolou obnoví buckety.",
        en: "Fewer update errors: apps and PowerShell modules installed for all users update as administrator right away, MSI updates for all users go through, and Scoop refreshes its buckets before checking.",
      },
      {
        cs: "Nová volba v Nastavení → Obecné: běžící aplikaci před aktualizací nebo odinstalací ukončit natvrdo bez dotazu.",
        en: "A new option in Settings → General: force-close a running app before updating or uninstalling it, without asking.",
      },
    ],
    featured: [
      {
        title: { cs: "Nový název: HubGet", en: "A new name: HubGet" },
        text: {
          cs: "Unibox je teď HubGet na hubget.eu. Aktualizace převede instalaci sama – nastavení i historie zůstanou.",
          en: "Unibox is now HubGet at hubget.eu. The update moves your installation over by itself – settings and history stay.",
        },
      },
      {
        title: { cs: "Klidné aktualizace", en: "Calm updates" },
        text: {
          cs: "Běžící aplikace počkají a na pozadí nevyskočí dialog UAC – co potřebuje správce, potvrdíte jedním dialogem.",
          en: "Running apps wait and no UAC dialog pops up in the background – confirm admin updates with one dialog.",
        },
      },
    ],
  },
  {
    version: "0.1.18",
    date: "2026-10-29",
    highlights: [
      {
        cs: "Sedm jazyků: k češtině a angličtině přibyla němčina, španělština, francouzština, portugalština a čínština. Nový uživatel dostane jazyk podle Windows; přepnete ho v horní liště nebo v Nastavení → Vzhled.",
        en: "Seven languages: German, Spanish, French, Portuguese and Chinese join Czech and English. New users get the language of their Windows; switch it in the top bar or in Settings → Appearance.",
      },
      {
        cs: "Příkazy pro terminál: přehled příkazů pro WinGet, Chocolatey, Scoop i správce pro vývojáře – hledání, instalace, aktualizace, záloha a údržba, každý s vysvětlením a tlačítkem Kopírovat. Najdete je v Nápovědě, v Nastavení a u každé aplikace.",
        en: "Terminal commands: an overview of commands for WinGet, Chocolatey, Scoop and developer package managers – search, install, update, backup and maintenance, each with an explanation and a Copy button. Find them in Help, in Settings and on every app's page.",
      },
      {
        cs: "Hry ze Steamu mají svou skutečnou ikonu a HubGet pozná i hry z EA app – mají vlastní filtr mezi nainstalovanými.",
        en: "Steam games show their real icon and HubGet now recognizes EA app games too – with their own filter among installed apps.",
      },
      {
        cs: "Na kartách a v seznamech je vidět kategorie aplikace (prohlížeč, grafika…), takže hned víte, k čemu neznámá aplikace slouží.",
        en: "Cards and lists show the app's category (browser, graphics…), so you know right away what an unfamiliar app is for.",
      },
      {
        cs: "Zpět vrátí stránku tam, kde jste byli: posun i filtry na Nainstalovaných, v Nejstahovanějších a v kategoriích zůstanou.",
        en: "Back returns you to where you were: the scroll position and filters on Installed, Top charts and categories stay put.",
      },
      {
        cs: "Nové logo s tenkým nápisem „unibox“ v krabici a v Nastavení → Obecné nenápadná možnost podpořit vývoj.",
        en: "A new logo with a thin “unibox” lettering on the box, and an unobtrusive way to support development in Settings → General.",
      },
    ],
    featured: [
      {
        title: { cs: "Sedm jazyků", en: "Seven languages" },
        text: {
          cs: "Němčina, španělština, francouzština, portugalština a čínština k češtině a angličtině. Jazyk se nastaví podle Windows.",
          en: "German, Spanish, French, Portuguese and Chinese alongside Czech and English. The language follows your Windows.",
        },
      },
      {
        title: { cs: "Příkazy pro terminál", en: "Terminal commands" },
        text: {
          cs: "Přehled příkazů pro všechny správce balíčků s vysvětlením – zkopírujete je jedním kliknutím.",
          en: "An overview of commands for every package manager with explanations – copy them with one click.",
        },
        href: { cs: "spravci.html", en: "package-managers.html" },
      },
    ],
  },
  {
    version: "0.1.17",
    date: "2026-10-28",
    highlights: [
      {
        cs: "Rychlejší start: HubGet ukáže katalog hned z uložené kopie a čerstvý stáhne na pozadí – už nečeká na stažení celého katalogu (na pomalém připojení až 15 sekund).",
        en: "Faster startup: HubGet shows the catalog right away from its saved copy and downloads the fresh one in the background – no more waiting for the whole catalog (up to 15 seconds on a slow connection).",
      },
      {
        cs: "Úvodní průvodce představí i hodnocení a recenze – kde je najdete a jak přidat vlastní.",
        en: "The welcome tour now introduces ratings and reviews too – where to find them and how to add your own.",
      },
      {
        cs: "U recenzí a snímků od uživatelů se ukazuje jen křestní jméno (bez něj přezdívka z GitHubu), ne celé jméno.",
        en: "Reviews and user screenshots show only the first name (or the GitHub username without one), not the full name.",
      },
      {
        cs: "Aplikace bez hodnocení ukáže prázdné hvězdičky a jednu výzvu místo nejasné pomlčky.",
        en: "An app without ratings shows empty stars and a single prompt instead of an unclear dash.",
      },
    ],
    featured: [
      {
        title: { cs: "Rychlejší start", en: "Faster startup" },
        text: {
          cs: "Katalog se ukáže hned z uložené kopie a čerstvý se stáhne na pozadí – start nečeká na internet.",
          en: "The catalog appears right away from the saved copy and the fresh one downloads in the background – startup doesn't wait for the internet.",
        },
      },
      {
        title: { cs: "Recenze jen s křestním jménem", en: "Reviews with first names only" },
        text: {
          cs: "U recenzí a snímků od uživatelů se ukazuje jen křestní jméno nebo přezdívka. Průvodce teď představí i hodnocení.",
          en: "Reviews and user screenshots show only a first name or username. The welcome tour now introduces ratings too.",
        },
        href: { cs: "funkce.html#hodnoceni", en: "features.html#hodnoceni" },
      },
    ],
  },
  {
    version: "0.1.16",
    date: "2026-10-28",
    highlights: [
      {
        cs: "Po spuštění ukáže i aplikace ze Storu (Teams, WhatsApp, Terminál, iCloud…) s názvem, vydavatelem a ikonou. Vypnete je jedním kliknutím jako ve Správci úloh, bez práv správce – a aplikace si spouštění sama znovu nezapne.",
        en: "Startup apps now include Store apps (Teams, WhatsApp, Terminal, iCloud…) with their name, publisher and icon. Turn them off with one click like in Task Manager, no admin rights needed – and the app can't turn startup back on by itself.",
      },
      {
        cs: "Nejstahovanější po svém: řazení podle popularity, hodnocení od uživatelů nebo Skokani týdne – aplikace, kterým nejrychleji roste počet stažení.",
        en: "Top charts your way: sort by popularity, user ratings or This week's movers – the apps whose downloads are growing fastest.",
      },
      {
        cs: "Aplikace, které se aktualizují samy (Discord): když se po aktualizaci vrátí na verzi ze svého serveru, HubGet ji označí „aktualizuje se sama“ a přestane aktualizaci nabízet dokola.",
        en: "Apps that update themselves (Discord): when an app reverts to its own server's version after an update, HubGet marks it as “updates itself” and stops offering the update over and over.",
      },
      {
        cs: "Když instalátor spadne (GeForce NOW), HubGet to řekne srozumitelně a nabídne jiný zdroj – instalaci zbytečně neopakuje jako správce.",
        en: "When an installer crashes (GeForce NOW), HubGet says so clearly and offers another source – no pointless retry as administrator.",
      },
      {
        cs: "Detail aplikace na širokém okně využívá i místo vpravo, takže informace nejsou tak nahuštěné.",
        en: "On a wide window, the app detail uses the space on the right too, so the information isn't so cramped.",
      },
      {
        cs: "Opravy: aplikace nainstalovaná dvěma správci má dvě vlastní karty, ikony programů se po přechodné chybě načtou znovu, Trendy / Populární na Domů přepíná bez skoku nahoru, Esc v dialogu zavře jen horní okno a dialog aktualizace HubGetu ukáže, proč se aktualizace nepodařila.",
        en: "Fixes: an app installed by two package managers gets its own card for each, program icons load again after a temporary error, Trending / Popular on Home switches without jumping to the top, Esc in a dialog closes only the topmost window and the HubGet update dialog shows why an update failed.",
      },
    ],
    featured: [
      {
        title: { cs: "Aplikace ze Storu po spuštění", en: "Store apps at startup" },
        text: {
          cs: "Teams, WhatsApp, iCloud i další aplikace ze Storu vypnete po spuštění jedním kliknutím – a samy si spouštění znovu nezapnou.",
          en: "Turn off Teams, WhatsApp, iCloud and other Store apps at startup with one click – and they won't turn it back on by themselves.",
        },
        href: { cs: "funkce.html#po-spusteni", en: "features.html#po-spusteni" },
      },
      {
        title: { cs: "Nejstahovanější po svém", en: "Top charts your way" },
        text: {
          cs: "Řazení podle popularity, hodnocení od uživatelů nebo Skokani týdne – aplikace, kterým nejrychleji roste počet stažení.",
          en: "Sort by popularity, user ratings or This week's movers – the apps whose downloads are growing fastest.",
        },
      },
    ],
  },
  {
    version: "0.1.15",
    date: "2026-10-28",
    highlights: [
      {
        cs: "Plynulé seznamy i s tisíci aplikací: kategorie, hledání, nainstalované a oblíbené vykreslují jen to, co je vidět – scrollování zůstává svižné až na konec seznamu, bez tlačítka „Zobrazit další“.",
        en: "Smooth lists even with thousands of apps: categories, search, installed apps and favorites render only what's visible – scrolling stays snappy all the way to the end, with no “Show more” button.",
      },
      {
        cs: "Bez připojení k internetu nic nezamrzne: nainstalované aplikace, Po spuštění a nastavení fungují dál a lišta nahoře řekne, co počká na připojení. Po jeho návratu se data načtou znovu.",
        en: "Nothing freezes without an internet connection: installed apps, startup apps and settings keep working, and a bar at the top says what waits for the connection. Data reloads once it's back.",
      },
      {
        cs: "Svižnější okno: čtení přihlášení a údajů o systému běží na pozadí, ne ve vlákně okna.",
        en: "A snappier window: reading your sign-in and system details runs in the background, not on the window thread.",
      },
      {
        cs: "Zastaralý nebo neznámý odkaz otevře Domů místo prázdného okna.",
        en: "An outdated or unknown link opens Home instead of an empty window.",
      },
    ],
    featured: [
      {
        title: { cs: "Plynulé seznamy i s tisíci aplikací", en: "Smooth lists, even with thousands of apps" },
        text: {
          cs: "Kategorie, hledání i nainstalované aplikace vykreslují jen to, co je vidět – scrollování zůstává svižné až na konec seznamu.",
          en: "Categories, search and installed apps render only what's visible – scrolling stays snappy all the way to the end of the list.",
        },
      },
      {
        title: { cs: "Bez připojení nic nezamrzne", en: "No connection, no freeze" },
        text: {
          cs: "Nainstalované aplikace a nastavení fungují i offline. HubGet řekne, co počká na připojení, a po jeho návratu data načte znovu.",
          en: "Installed apps and settings work offline too. HubGet tells you what waits for the connection and reloads the data once it's back.",
        },
      },
    ],
  },
  {
    version: "0.1.14",
    date: "2026-10-28",
    highlights: [
      {
        cs: "Přihlášení přes GitHub: hodnocení hvězdičkami a recenze pod jménem z účtu – vlastní recenzi jde upravit i smazat, nevhodnou nahlásit.",
        en: "Sign in with GitHub: star ratings and reviews under your account name – edit or delete your own review, report inappropriate ones.",
      },
      {
        cs: "Snímky obrazovky od uživatelů: přihlášení mohou k aplikaci přidat aktuální snímky (výběrem, přetažením nebo Ctrl+V) – HubGet je zmenší do WebP bez metadat a po schválení je uvidí všichni.",
        en: "Screenshots from users: signed-in users can add current screenshots to an app (pick, drag or Ctrl+V) – HubGet downscales them to WebP without metadata and everyone sees them once approved.",
      },
      {
        cs: "Synchronizace mezi počítači: oblíbené, sada balíčků, předvolby vzhledu a jazyka i oznámení – každou oblast jde vypnout a data z účtu smazat.",
        en: "Sync between computers: favorites, the package bundle, appearance and language preferences and notifications – turn off any area and delete the data from your account.",
      },
      {
        cs: "Katalog aplikací je každý den čerstvý – nainstalovaný HubGet si ho stahuje z GitHubu, kde se denně generuje.",
        en: "The app catalog is fresh every day – the installed HubGet downloads it from GitHub, where it's generated daily.",
      },
      {
        cs: "Jen ostré ikony aplikací: katalog u každé aplikace vybírá nejostřejší ikonu ze všech zdrojů (i z webu aplikace) a malé favicony, které by se rozmazaly, nahradí avatar s iniciálami. Ikony se po načtení už nemění; Audacity, WinRAR a Windows Terminal mají aktuální ikony.",
        en: "Only sharp app icons: the catalog picks the sharpest icon for each app from all sources (including the app's website), and small favicons that would look blurry are replaced by an initials avatar. Icons no longer switch after loading; Audacity, WinRAR and Windows Terminal have their current icons.",
      },
      {
        cs: "Ve výsledcích hledání jsou ověřené aplikace (s fajkou) nahoře – „terminal“ ukáže nejdřív Windows Terminal.",
        en: "Verified apps (with the check mark) come first in search results – “terminal” shows Windows Terminal first.",
      },
      {
        cs: "Karty kolekcí v sekci Dnes mají barvu, která u jejich ikon převládá – výběr modrých aplikací je modrý.",
        en: "Collection cards in Today take the color that prevails in their icons – a set of blue apps is blue.",
      },
      {
        cs: "Pro vývojáře: průvodce publikováním ve WinGetu (Publikovat) – z adresy instalátoru zjistí SHA-256, typ a údaje, připraví manifest a ověří ho příkazem winget validate.",
        en: "For developers: a WinGet publishing wizard (Publish) – reads the SHA-256, type and details from the installer URL, prepares the manifest and checks it with winget validate.",
      },
      {
        cs: "Instalátor před instalací ukáže zásady ochrany soukromí a licenci. Favicony webů aplikací se už nehledají přes služby Googlu a DuckDuckGo.",
        en: "The installer shows the privacy policy and license before installing. App website favicons are no longer looked up through Google and DuckDuckGo services.",
      },
      {
        cs: "Zdrojový kód je veřejně na GitHubu (github.com/matous96/unibox, licence MIT) a aktualizace HubGetu se stahují z GitHub Releases.",
        en: "The source code is public on GitHub (github.com/matous96/unibox, MIT license) and HubGet updates are downloaded from GitHub Releases.",
      },
    ],
    featured: [
      {
        title: { cs: "Hodnocení, recenze a snímky od komunity", en: "Ratings, reviews and community screenshots" },
        text: {
          cs: "Přihlášení přes GitHub: hvězdičky a recenze pod vaším jménem a aktuální snímky obrazovky od uživatelů – zmenšené, bez metadat a po schválení.",
          en: "Sign in with GitHub: stars and reviews under your name and current screenshots from users – downscaled, without metadata and after approval.",
        },
      },
      {
        title: { cs: "Synchronizace mezi počítači", en: "Sync between computers" },
        text: {
          cs: "Oblíbené, sada balíčků a předvolby na všech vašich počítačích. Každou oblast jde vypnout a data z účtu kdykoli smazat.",
          en: "Favorites, your package bundle and preferences on all your computers. Turn off any area and delete the data from your account at any time.",
        },
      },
    ],
  },
  {
    version: "0.1.13",
    date: "2026-10-27",
    highlights: [
      {
        cs: "Správci pro vývojáře naostro: npm, Bun, pip, Cargo, vcpkg, .NET Tool, PowerShell 7 i 5.1 – hledání, instalace, aktualizace i odinstalace v režimu Vývojář.",
        en: "Developer package managers for real: npm, Bun, pip, Cargo, vcpkg, .NET Tool, PowerShell 7 and 5.1 – search, install, update and uninstall in Developer mode.",
      },
      {
        cs: "Chybějící nástroj (Node.js, Python, Rust, .NET SDK, PowerShell 7) nainstaluje HubGet jedním kliknutím přes WinGet.",
        en: "A missing tool (Node.js, Python, Rust, .NET SDK, PowerShell 7) is installed in one click via WinGet.",
      },
      {
        cs: "Filtr i pro vývojáře: klik na npm, pip, Cargo… v levém panelu ukáže přehled správce – nainstalované balíčky, hledání jen v jeho registru a oblíbené nástroje.",
        en: "A filter for developers too: click npm, pip, Cargo… in the sidebar to see the manager’s overview – installed packages, search in its registry only and popular tools.",
      },
      {
        cs: "Aktualizace jako v UniGetUI: kontrola i instalace v intervalu nebo v daný čas a dny, zmeškané termíny, minimální stáří aktualizací, výjimka pro úsporu baterie a neprojevené aktualizace se přestanou nabízet.",
        en: "Updates like in UniGetUI: checks and installs at an interval or at a set time and days, missed schedules, a minimum age for updates, a battery saver exception, and updates that never apply stop being offered.",
      },
      {
        cs: "Varování, když se instalátor nové verze (WinGet) stahuje z jiného serveru než u nainstalované verze – aktualizace se označí oranžově a automaticky se nenainstaluje.",
        en: "A warning when the new version’s installer (WinGet) comes from a different host than the installed version’s – the update is marked orange and isn’t installed automatically.",
      },
      {
        cs: "Dostupné aktualizace i u Chocolatey – v přehledu aktualizací, v počtech, v hromadné i automatické aktualizaci.",
        en: "Available updates for Chocolatey too – in the update list, the counts, and bulk and automatic updates.",
      },
      {
        cs: "Úvodní průvodce pro nové uživatele: v pěti krocích představí katalog, filtr zdrojů, pokročilou odinstalaci, Po spuštění a zálohy. Znovu ho spustíte v Nastavení → Obecné.",
        en: "A welcome tour for new users: five steps on the catalog, the source filter, advanced uninstall, startup apps and backups. Replay it in Settings → General.",
      },
      {
        cs: "Sekce Dnes vybírá ze stovek známých aplikací celého katalogu – tipy dne, výběry z kategorií a aplikace dne se už neopakují po pár dnech. Šipkami na kartách listujete dalšími výběry.",
        en: "The Today section picks from hundreds of well-known apps across the catalog – daily tips, category picks and the app of the day no longer repeat after a few days. Browse more picks with the arrows on the cards.",
      },
      {
        cs: "Stabilnější a plynulejší: chyba na jedné stránce už neshodí celé okno, selhání správce balíčků HubGet oznámí a scrollování seznamů běží bez zasekávání.",
        en: "More stable and smoother: an error on one page no longer takes down the whole window, HubGet reports when a package manager fails, and lists scroll without stutter.",
      },
      {
        cs: "Uložené volby instalace (jako správce, parametry, složka…) platí i pro aktualizace; nově i odinstalace předchozí verze a vlastní parametry jen pro aktualizace.",
        en: "Saved install options (as administrator, arguments, folder…) apply to updates too; new: uninstall the previous version and custom arguments just for updates.",
      },
    ],
    featured: [
      {
        title: { cs: "Správci pro vývojáře naostro", en: "Developer package managers for real" },
        text: {
          cs: "npm, Bun, pip, Cargo, vcpkg, .NET Tool a PowerShell – hledání, instalace, aktualizace i odinstalace knihoven a nástrojů přímo v HubGetu.",
          en: "npm, Bun, pip, Cargo, vcpkg, .NET Tool and PowerShell – search, install, update and uninstall libraries and tools right in HubGet.",
        },
        href: { cs: "spravci.html#vyvojari", en: "package-managers.html#vyvojari" },
      },
      {
        title: { cs: "Aktualizace pod kontrolou", en: "Updates under control" },
        text: {
          cs: "Kontrola i instalace v daný čas a dny, minimální stáří aktualizací, výjimky pro baterii a měřené připojení a uložené volby i pro aktualizace.",
          en: "Checks and installs at a set time and days, a minimum age for updates, battery and metered-connection exceptions, and saved options for updates too.",
        },
      },
    ],
  },
  {
    version: "0.1.12",
    date: "2026-10-27",
    highlights: [
      {
        cs: "Nový instalátor ve stylu HubGetu – logo ve vysokém rozlišení, písmo Segoe UI, ostrá grafika i na displejích s vysokým rozlišením a jazyk podle Windows.",
        en: "A new installer in HubGet style – a high-resolution logo, the Segoe UI font, sharp graphics on high-DPI displays and the language of your Windows.",
      },
      {
        cs: "Novinky v Nastavení: okno Co je nového jde kdykoli znovu otevřít a je tam i historie všech verzí.",
        en: "What’s new in Settings: reopen the What’s new window any time and browse the history of every version.",
      },
    ],
    featured: [
      {
        title: { cs: "Nový instalátor", en: "A new installer" },
        text: {
          cs: "Úvodní a závěrečná obrazovka s logem HubGetu ve vysokém rozlišení, písmo Segoe UI a ostrá grafika i na displejích s vysokým rozlišením.",
          en: "Welcome and finish screens with a high-resolution HubGet logo, the Segoe UI font and sharp graphics even on high-DPI displays.",
        },
        href: "#stahnout",
      },
      {
        title: { cs: "Novinky v Nastavení", en: "What’s new in Settings" },
        text: {
          cs: "Okno Co je nového jde kdykoli znovu otevřít – třeba když ho po aktualizaci omylem zavřete. Je tam i historie všech verzí.",
          en: "Reopen the What’s new window any time – for example if you closed it by accident after an update. The history of every version is there too.",
        },
      },
    ],
  },
  {
    version: "0.1.11",
    date: "2026-10-26",
    highlights: [
      {
        cs: "Chocolatey a Scoop naostro – hledání, instalace, aktualizace i odinstalace; chybějící správce se nainstaluje jedním kliknutím.",
        en: "Chocolatey and Scoop for real – search, install, update and uninstall; a missing package manager is installed in one click.",
      },
      {
        cs: "Režim jednoho zdroje: klik na WinGet, Chocolatey nebo Scoop v levém panelu ukáže jen aplikace z něj a instaluje jen odtud.",
        en: "Single-source mode: click WinGet, Chocolatey or Scoop in the sidebar to see only its apps and install only from it.",
      },
      {
        cs: "Automatická kontrola a instalace aktualizací na pozadí, centrum oznámení se zvonečkem a předvolby oznámení.",
        en: "Automatic background update checks and installs, a notification center with a bell and notification preferences.",
      },
      {
        cs: "Když instalace selže (nefunkční odkaz, běžící jiná instalace…), HubGet nabídne jiný zdroj – Chocolatey nebo Scoop.",
        en: "When an install fails (broken link, another install running…), HubGet offers another source – Chocolatey or Scoop.",
      },
      {
        cs: "Odkazy unibox:// – kolekce a aplikace z webu se otevřou rovnou v HubGetu.",
        en: "unibox:// links – collections and apps from the web open right in HubGet.",
      },
      {
        cs: "Spolehlivější rozpoznání nainstalovaných aplikací na každém počítači – ověří spustitelný soubor (zbytky v registru už nesvítí jako „Nainstalováno“), najde aplikace v profilu uživatele a funguje i bez modulu WinGetu.",
        en: "More reliable detection of installed apps on any PC – it checks the executable (registry leftovers no longer show as installed), finds apps in the user profile and works even without the WinGet module.",
      },
      {
        cs: "Běžící aplikace už instalaci nezablokuje: proces na pozadí (třeba OBS u hodin) HubGet před instalací, aktualizací či odinstalací sám ukončí, otevřenou aplikaci nabídne zavřít jedním kliknutím.",
        en: "A running app no longer blocks an install: HubGet ends a background process (such as OBS in the tray) before an install, update or uninstall, and offers to close an open app in one click.",
      },
      {
        cs: "Pokročilá odinstalace (v Nastavení): po odinstalaci najde zbytky v Program Files, ProgramData, zástupcích i registru a nabídne je smazat – nebo je smaže automaticky. Registr se před smazáním zálohuje.",
        en: "Advanced uninstall (in Settings): after an uninstall it finds leftovers in Program Files, ProgramData, shortcuts and the registry and offers to delete them – or deletes them automatically. The registry is backed up first.",
      },
      {
        cs: "Nová sekce Po spuštění: programy spouštěné po přihlášení (registr, složka Po spuštění, plánovač úloh) – zapnout, vypnout nebo odstranit jedním kliknutím, i s vlivem na rychlost startu.",
        en: "New Startup apps section: programs that start at sign-in (registry, Startup folder, Task Scheduler) – enable, disable or remove them in one click, with their startup impact.",
      },
      {
        cs: "Sledování instalace: snímek disku a registru před instalací a po ní – po odinstalaci HubGet nabídne smazat vše, co instalátor vytvořil.",
        en: "Install monitoring: a disk and registry snapshot before and after an install – after an uninstall, HubGet offers to remove everything the installer created.",
      },
      {
        cs: "Ignorovat aktualizace u kterékoli aplikace nebo je odložit o den, týden či měsíc; přehled a zrušení v Nastavení.",
        en: "Ignore updates for any app or postpone them for a day, a week or a month; review and undo them in Settings.",
      },
      {
        cs: "Export profilu do JSON i do přehledné stránky HTML, i s nastavením aktualizací; po importu nainstalujete chybějící aplikace jedním kliknutím.",
        en: "Export your profile as JSON or as a readable HTML page, update settings included; after an import, install the missing apps in one click.",
      },
      {
        cs: "Po aktualizaci HubGet jednou ukáže okno „Co je nového“ s novinkami všech vydání, která jste přeskočili.",
        en: "After an update, HubGet shows a “What’s new” window once, covering every release you skipped.",
      },
      {
        cs: "Celý katalog WinGetu (15 776 balíčků), hvězdičky z GitHubu na kartách, ověřené aplikace a vlastní barva zvýraznění.",
        en: "The full WinGet catalog (15,776 packages), GitHub stars on cards, verified apps and a custom accent color.",
      },
      {
        cs: "Rychlejší hledání a plynulá odezva během instalací; nastavení oprávnění správce a nebezpečných voleb.",
        en: "Faster search and a smooth UI during installs; administrator rights and dangerous settings.",
      },
    ],
  },
  {
    version: "0.1.10",
    date: "2026-10-23",
    highlights: [
      {
        cs: "Nefunkční odkaz na stažení ve WinGetu (chyba 404)? HubGet zkusí Chocolatey nebo Scoop.",
        en: "A broken download link in WinGet (error 404)? HubGet tries Chocolatey or Scoop.",
      },
      { cs: "Velké karty na domovské stránce jsou klikatelné celé.", en: "The large home page cards are clickable everywhere." },
    ],
  },
  {
    version: "0.1.9",
    date: "2026-10-23",
    highlights: [
      {
        cs: "Detail kolekce přes celou obrazovku jako v App Storu – popis, seznam aplikací a instalace všech najednou.",
        en: "An App Store-style full-screen collection page – a description, the list of apps and installing them all at once.",
      },
    ],
  },
  {
    version: "0.1.8",
    date: "2026-10-23",
    highlights: [
      {
        cs: "Stav aplikace se po instalaci a odinstalaci změní okamžitě, včetně tlačítka Otevřít; rychlejší odezva a hledání.",
        en: "An app’s state changes right after install and uninstall, Open button included; faster response and search.",
      },
      { cs: "Spouštění při startu Windows (Nastavení).", en: "Start with Windows (Settings)." },
    ],
  },
  {
    version: "0.1.7",
    date: "2026-10-22",
    highlights: [
      {
        cs: "Správný název WinGet v celé aplikaci; aplikace z Microsoft Storu jako „WinGet (Microsoft Store)“.",
        en: "The correct WinGet name throughout the app; Microsoft Store apps shown as “WinGet (Microsoft Store)”.",
      },
    ],
  },
  {
    version: "0.1.6",
    date: "2026-10-22",
    highlights: [
      {
        cs: "Barva banneru podle ikony, kterou aplikace opravdu zobrazuje, a čitelné popisky.",
        en: "Banner color from the icon the app actually shows, with readable labels.",
      },
    ],
  },
  {
    version: "0.1.5",
    date: "2026-10-22",
    highlights: [
      {
        cs: "Volby instalace v detailu schované pod odkazem, změněné volby ve stručném souhrnu.",
        en: "Install options in the app detail tucked behind a link, with a short summary of changes.",
      },
    ],
  },
  {
    version: "0.1.4",
    date: "2026-10-22",
    highlights: [
      {
        cs: "Tichá instalace, spuštění jako správce a instalace pro všechny uživatele; indikátor ověření SHA-256.",
        en: "Silent install, run as administrator and install for all users; a SHA-256 verification indicator.",
      },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-10-22",
    highlights: [
      {
        cs: "Hromadná instalace, export a import aplikací, přeskakování a zamykání verzí, úklid po odinstalaci.",
        en: "Bulk install, app export and import, skipping and pinning versions, cleanup after uninstall.",
      },
      { cs: "Počet hvězdiček z GitHubu v detailu open-source aplikací.", en: "GitHub star counts in open-source app details." },
    ],
  },
  {
    version: "0.1.2",
    date: "2026-10-22",
    highlights: [
      {
        cs: "Lepší rozpoznání nainstalovaných aplikací (např. Google Chrome) a spolehlivější ikony.",
        en: "Better detection of installed apps (e.g. Google Chrome) and more reliable icons.",
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-10-22",
    highlights: [
      {
        cs: "Okno ve stylu Windows 11 a běh na pozadí u hodin – instalace doběhnou i po zavření okna.",
        en: "A Windows 11-style window and background mode in the tray – installs finish even after closing the window.",
      },
      {
        cs: "Tlačítko Otevřít, snímky obrazovky v detailu, průběh stahování v procentech a přepínač motivu.",
        en: "An Open button, screenshots in app details, download progress in percent and a theme toggle.",
      },
      {
        cs: "Spolehlivé aktualizace a odinstalace, ikony i pro aplikace bez ikony v manifestu.",
        en: "Reliable updates and uninstalls, icons even for apps without one in the manifest.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-21",
    highlights: [
      {
        cs: "Jeden obchod pro winget, Chocolatey a Scoop – aplikace dostupná ve více zdrojích má jeden profil.",
        en: "One store for winget, Chocolatey and Scoop – an app available in several sources has a single profile.",
      },
      {
        cs: "Správci pro vývojáře: npm, Bun, pip, Cargo, vcpkg, .NET Tool a PowerShell 7 i 5.",
        en: "Developer package managers: npm, Bun, pip, Cargo, vcpkg, .NET Tool and PowerShell 7 and 5.",
      },
      {
        cs: "Sekce Dnes, žebříček nejstahovanějších, kategorie s filtrem správců a naposledy zobrazené aplikace.",
        en: "Today section, top charts, categories with a source filter and recently viewed apps.",
      },
      {
        cs: "Profil aplikace s bannerem, technickými údaji, ochranou soukromí, architekturami a staršími verzemi.",
        en: "App profiles with a banner, technical details, privacy labels, architectures and older versions.",
      },
      {
        cs: "Sady balíčků: hromadná instalace, uložení do souboru .ubundle a vytvoření skriptu PowerShellu.",
        en: "Package bundles: bulk install, save as a .ubundle file and create a PowerShell script.",
      },
      {
        cs: "Rychlé akce na kartách – kopírování příkazu, oblíbené a přidání do sady bez otevření profilu.",
        en: "Quick actions on cards – copy the command, favorite or add to a bundle without opening the profile.",
      },
      {
        cs: "Historie operací a protokoly správců balíčků pro snadné řešení potíží.",
        en: "Operation history and package manager logs for easy troubleshooting.",
      },
    ],
  },
];
