# Datová pipeline Uniboxu

Sestaví `catalog.json` – katalog aplikací, ze kterého Unibox zobrazuje obchod –
ze skutečných dat správců balíčků:

| Zdroj | Odkud | Co dává |
|---|---|---|
| **winget** | CDN Microsoftu (`cdn.winget.microsoft.com/cache`) – stejný index, jaký používá samotný winget | ~15 000 balíčků; u nejpopulárnějších manifest: popis, vydavatel, licence, ikona, SHA-256, typ instalátoru, rozsah (User/Machine), minimální Windows, závislosti, poznámky k vydání |
| **Chocolatey** | API Chocolatey Community Repository (NuGet v2 / OData) | ~12 000 balíčků, počty stažení (popularita), ikony, odkazy na zdrojový kód a dokumentaci |
| **Scoop** | buckety Main, Extras, Games a Nonportable z GitHubu (archivy tar.gz) | ~4 700 aplikací, popis, licence, architektury, SHA-256 |
| registry pro vývojáře | npm, crates.io, NuGet, PowerShell Gallery, vcpkg (GitHub) | jen počty balíčků do statistik |
| **UniGetUI** | komunitní databáze ikon a screenshotů (`Devolutions/UniGetUI`, `WebBasedData/screenshot-database-v2.json`) | screenshoty ~1 400 aplikací |

Balíčky npm, pip, Cargo… v katalogu nejsou – je jich miliony a Unibox je hledá
živě přímo u správců.

## Spuštění

```bash
pnpm pipeline --local
```

Výsledek je v `data-pipeline/out/catalog.json`. S `--local` se zkopíruje i do
`public/catalog.json`, odkud ho při `pnpm dev` načte aplikace místo ukázkového
katalogu (v Nastavení → Katalog je pak zdroj „Místní (pnpm pipeline)“).

| Parametr | Výchozí | Význam |
|---|---|---|
| `--details N` / `--details all` | 2500 | kolika nejpopulárnějším aplikacím stáhnout manifest wingetu (podrobnosti, ikony, SHA-256…) |
| `--sizes N` | 300 | kolika z nich zjistit velikost instalátoru (požadavek HEAD na server vydavatele) |
| `--limit N` | – | omezit katalog na N nejpopulárnějších aplikací (testování) |
| `--local` | – | zkopírovat výsledek do `public/catalog.json` |
| `--skip-choco`, `--skip-scoop` | – | vynechat zdroj |
| `--pretty` | – | čitelně formátovaný JSON |

Proměnné prostředí: `GITHUB_TOKEN` (vyšší limit GitHub API), `PYPI_COUNT`
(počet balíčků na PyPI – PyPI ho neposkytuje jednoduchým API, jinak se použije odhad).

Pomocné skripty:

- `node data-pipeline/scripts/inspect-catalog.ts [id…]` – statistiky, nejpopulárnější aplikace, vybrané karty,
- `node data-pipeline/scripts/check-ids.ts` – jestli aplikace z redakčního obsahu v katalogu existují,
- `node data-pipeline/scripts/show-manifest.ts <id wingetu> [pole…]` – surová data z manifestu wingetu,
- `node data-pipeline/scripts/icon-report.ts [katalog.json] [--list]` – rozlišení ikon podle zdroje,
- `node data-pipeline/scripts/probe-icon.ts <url…>` – rozměry obrázků na zadaných adresách,
- `node data-pipeline/scripts/probe-web-icons.ts <url…>` – ikony, které deklaruje web aplikace.

## Mezipaměť a limity serverů

Vše stažené se ukládá do `data-pipeline/.cache/http`:

- **index wingetu, buckety Scoopu** se pokaždé ověří podmíněným požadavkem (ETag) –
  stáhnou se jen při změně,
- **manifesty wingetu** mají v adrese hash obsahu, stahují se jen jednou,
- **Chocolatey** – stránky API platí ~20 hodin; prochází se po jedné stránce s pauzou,
  protože server při rychlém dotazování vrací 429,
- při **429 / 5xx** se požadavek opakuje s rostoucí pauzou (u 429 podle `Retry-After`),
- když je server **nedostupný**, použije se starší uložená kopie (pipeline běží i offline).

První běh trvá ~5 minut (hlavně Chocolatey), další s mezipamětí ~40 sekund.

## Párování do jedné karty aplikace

Základem je winget. Balíček z Chocolatey / Scoopu se k němu přiřadí podle signálů
s různou váhou (`src/build/match.ts`):

| Signál | Váha | Příklad |
|---|---|---|
| shoda s monikerem wingetu | 100 | Chocolatey `vlc` = winget moniker `vlc` |
| stejný název | 85 | „Mozilla Firefox“ = „Mozilla Firefox (en-US)“ |
| shoda s celým id wingetu | 75 | `googlechrome` = `Google.Chrome` |
| stejný název bez přívěsků | 70 | „Signal Desktop“ = „Signal“, „Zoom Client“ = „Zoom“ |
| shoda s poslední částí id | 60 | `git` = `Git.Git` |

Název (ani moniker) nestačí – „mc“ je MinIO Client i Midnight Commander, „Pastel“ od
Japplis i od sharkdp. Proto se porovná **vlastník**: z webu balíčku Chocolatey / Scoopu
(účet a repozitář na GitHubu, doména, autoři) a z balíčku wingetu (vydavatel v id
a v indexu, název produktu, weby z manifestu). Jasně jiný vlastník spojení zamítne,
stejný mu dá přednost i před monikerem (`zap` z Chocolatey = OWASP `ZAP.ZAP`, ne
`Zaptronics.Zap`). Weby, které o vlastníkovi nic neřeknou (Discord, PyPI, Softpedia…),
se nepočítají a bez webu na straně wingetu se nezamítá. „+“ se v názvech počítá
(„Notepad++“ ≠ „Notepad--“).

Přiřazuje se od nejsilnějších shod; každý balíček wingetu má nejvýš jeden protějšek
z každého správce. Chocolatey a Scoop bez wingetu se párují podle id, názvu (i bez
přívěsků) a webu aplikace – u GitHubu včetně repozitáře (`github.com/sharkdp/bat`).
Dvojice Chocolatey `app.install` / `app.portable` se sloučí. Co se nespáruje, je samostatná karta.

**Varianty wingetu** – jazykové (`Mozilla.Firefox.cs`, `Mozilla.Firefox.en-GB`) a s jiným
typem instalátoru (`Google.Chrome.EXE`, `Mozilla.Firefox.MSIX`, `KDE.Kate.appx`) – nemají
vlastní kartu, ale v katalogu zůstávají: zdroj winget karty základního balíčku má pole
`variants` (`{ packageId, code }`) a aplikace je nabídne ve volbách instalace („Varianta
balíčku“). Katalog tak obsahuje všechny balíčky wingetu (statistika `bySource.winget`
je jejich celkový počet). Krátké přípony, které jazykem nejsou (`.dev`, `.cli`, `.pro`…),
jsou samostatné balíčky – pravidlo je společné s aplikací (`src/lib/wingetVariant.ts`).

**Ověření (modrá fajfka)** – pole `verified` u aplikací od vydavatelů ze seznamu oficiálních
firem, nadací a projektů (`src/lib/verified.ts`, sdílené s aplikací).

## Ikony

Kandidáti v pořadí podle důvěryhodnosti zdroje:

1. ikona z manifestu wingetu (`cdn.winget.microsoft.com/icons/…`, PNG má přednost před ICO),
2. ikona z komunitní databáze UniGetUI (~6 000 balíčků),
3. ikona balíčku Chocolatey (odkazy na zaniklá CDN rawgit.com a cdn.staticaly.com se
   přepíšou na jsDelivr, viz `src/lib/images.ts`),
4. ikony deklarované na webu aplikace – `<link rel="icon" sizes>`, apple-touch-icon,
   ikony z web manifestu, bez nich `/apple-touch-icon.png` a `/favicon.ico` v kořeni
   webu (jen když předchozí nejsou ostré; weby služeb jako GitHub, Steam nebo
   SourceForge se přeskočí a stejně tak web, na kterém mají stránku tři a víc
   aplikací z katalogu – apps.kde.org – nebo ikona, kterou sdílí tři a víc
   aplikací: je to logo webu nebo vydavatele, ne aplikace). Odhadnuté ikony
   z kořene webu se použijí, jen když se je podařilo změřit. Stránka se čte až po `</head>` (odkazy na ikony bývají
   za stovkami kB vložených stylů). Weby, které neodpoví, se ještě v témže běhu
   zkusí znovu pomaleji a pak zase příští den; neexistující doména nebo vadný
   certifikát je trvalá odpověď. První prohledání ~3 700 webů trvá kolem 25 minut,
   výsledek platí 30 dní.

**Jen ostré ikony** (`src/build/icons.ts`): rozlišení každého kandidáta se zjistí
z hlavičky obrázku (stačí začátek souboru; PNG, ICO, JPEG, GIF, WebP, SVG –
`src/lib/imageSize.ts`) a vybere se první s aspoň 128 px nebo vektor, jinak
největší s aspoň 48 px (aplikace ji nezvětší víc než 2×, v detailu je tedy
o kousek menší, ale ostrá). Menší ikony (favicony 16–32 px) by byly rozmazané
všude – aplikace bez použitelné ikony nemá `iconUrl` a Unibox vykreslí avatar
s iniciálami (v desktopové aplikaci má přednost skutečná ikona nainstalovaného
programu – viz README.cs.md). Stejnou mez hlídá i aplikace u ikon, které se
změnily po sestavení katalogu. Ikonu, kterou kvůli výpadku serveru nešlo změřit,
pipeline nezahodí (zkusí ji znovu příští den). Změřené rozměry jsou
v `.cache/icon-sizes.json`, ikony webů v `.cache/web-icons.json` (platí 30 dní).

Přehled podle zdrojů: `node data-pipeline/scripts/icon-report.ts [katalog.json] [--list]`
(s `--list` i nejpopulárnější aplikace s malou ikonou).

Náhledy z Wikimedia Commons (ikony i screenshoty) existují jen ve standardních
šířkách (120, 250, 330, 500, 960, 1280, 1920 px); jiná šířka („512px-…“) vrací
chybu 400, proto se zaokrouhlí na nejbližší standardní (`fixWikimediaThumb`).

## Repozitář aplikace

Odkazy na repozitář si mezi správci často odporují: Chocolatey mívá zastaralý zdroj
(OBS Studio → `jp9000/OBS` místo `obsproject/obs-studio`), winget repozitář
s instalátory (`vim/vim-win32-installer`) a komunitní balíčky repozitář samotného
balíčku (`…/chocolatey-packages`). Pole `repositoryUrl` proto vybírá
`src/build/repository.ts` hlasováním ze všech odkazů:

- každý odkaz dá repozitáři body podle spolehlivosti pole – winget (web balíčku,
  poznámky k vydání, podpora) víc než metadata Chocolatey, která se léta neaktualizují,
- pomocné repozitáře (instalátory, buildy pro Windows, web, dokumentace, hlášení
  chyb) dostanou čtvrtinu bodů; má-li stejný vlastník hlavní repozitář, připadnou jemu,
- repozitáře balíčků správců body nedostanou, vyhrají jen bez jiné možnosti,
- poznámky k vydání zavedou jen hlavní repozitář a web ze spárovaného balíčku
  Chocolatey / Scoopu jen přidá body (párování se může splést – „warp“ u Cloudflare WARP).

## Hvězdičky na GitHubu

U aplikací s repozitářem na GitHubu (odkaz na zdrojový kód, web nebo hlášení chyb)
doplní pipeline pole `githubStars` (`src/sources/github.ts`, mezipaměť
`.cache/github-stars.json` na 24 h). S osobním tokenem bez oprávnění v proměnné
`GITHUB_TOKEN` jde o aktuální čísla z GraphQL API GitHubu (100 repozitářů na dotaz),
bez něj o čísla z deps.dev (veřejné API bez klíče, 500 repozitářů na dotaz, staré
pár dní). Repozitáře, které deps.dev nezná, zůstanou bez čísla – aplikace si ho
načte až v detailu.

## Screenshoty

Manifesty wingetu ani Scoopu screenshoty nemají. Pipeline je proto skládá ze dvou
komunitních zdrojů (nejvýš 8 na aplikaci, bez duplicit, pole `screenshots`
a `screenshotSources`):

1. **databáze UniGetUI** (`src/sources/unigetui.ts`) – klíčem je zjednodušené id
   (`vlc`, `firefox`, `obs-studio`, `notepadplusplus`); aplikace se hledá podle id
   z Chocolatey, názvu ze Scoopu, id wingetu bez vydavatele a názvu aplikace,
2. **obrázky z popisu balíčku v Chocolatey** – Markdown `![…](…)` a `<img>`; odznaky,
   loga, ikony a bannery se vynechají (`descriptionImages` v `src/lib/images.ts`).

Adresy se převedou na HTTPS (aplikace jiné obrázky nenačte) a zaniklá CDN na jsDelivr.
Výsledek: screenshoty u ~2 500 aplikací (~5 700 obrázků). Obrázky, které se nepodaří
načíst, galerie v aplikaci tiše vynechá.

## Ručně spravované údaje

`curated.json` doplňuje to, co ve zdrojích není: doporučené aplikace (Aplikace dne),
barvu banneru, kategorie, alternativy a volitelné části instalátoru (PATH, zástupci).
`iconUrl` nahradí ikonu ze zdrojů – když mají zastaralé logo nebo malé rozlišení
(např. Audacity 4: oficiální ikona z `audacity/audacity`, `share/icons/AppIcon`; Windows Terminal
z `microsoft/terminal`; WinRAR – současná ikona v 256 px z balíčku Chocolatey).

`web-only.json` – aplikace, které výrobce dává ke stažení jen na svém webu a žádný správce
balíčků je nemá (DaVinci Resolve). Katalog je nese mimo `packages` v poli `webOnly` (HubGet
do 0.1.19 počítá u každé aplikace se zdrojem): aplikace je ukáže s odkazem `downloadUrl`
na oficiální stránku ke stažení a nainstalované pozná podle názvu v registru a otevře –
neinstaluje, neaktualizuje ani neodinstaluje je. Verzi a datum vydání produktů Blackmagic
Design (`blackmagic`: id produktu) doplní jejich veřejný seznam stažení, jinak platí ručně
uvedená `latestVersion`; bez ní aplikace verzi neukazuje (zastaralá by mátla). Program, který se
v registru jmenuje jinak než aplikace, spáruje `installedNames` – regulární výrazy názvů
(„^VMware Workstation$“ u VMware Workstation Pro); názvy s verzí nebo architekturou
(„Cisco Packet Tracer 9.0 64Bit“, „Houdini 21.0.440“) se spárují samy.

## Popularita a „Nové“

Popularita 0–100 = počet stažení z Chocolatey (logaritmicky) + počet zdrojů + moniker
wingetu (mají ho známé aplikace). Kdy se aplikace v katalogu objevila poprvé, si
pipeline pamatuje v `.cache/first-seen.json` – při úplně prvním běhu je datum neznámé.

## Nasazení

Workflow `.github/workflows/catalog.yml` spouští pipeline každý den na GitHub Actions
(mezipaměť `.cache` se přenáší mezi běhy přes mezipaměť Actions) a katalog po kontrole
(`scripts/check-catalog.mjs`) zveřejní na GitHub Pages – výchozí adresa katalogu
v sestavené aplikaci. Aplikace si poslední staženou kopii drží v mezipaměti a funguje
i offline. Podrobnosti v README.cs.md (Vzdálený katalog).
