/**
 * Hledání podle účelu česky: „stříhání videa“, „čtečka PDF“, „rozbalit zip“ najdou aplikace,
 * i když tato slova nemají v názvu – popisy a štítky katalogu jsou anglicky. Slovník českých
 * výrazů (kmeny slov bez diakritiky – „strih vide“ = střih videa, stříhání videí…) → anglické
 * výrazy v popisu, štítcích nebo názvu. Bez služby a bez AI, jen v aplikaci (pages/SearchPage.tsx).
 */
import type { SearchRecord } from "@/hooks/usePackages";

interface Intent {
  /** České výrazy jako kmeny slov (malými písmeny, bez diakritiky), mezerou oddělená slova. */
  phrases: string[];
  /** Anglické výrazy v popisu, štítcích nebo názvu aplikace (normalizované). */
  terms: string[];
}

const INTENTS: Intent[] = [
  { phrases: ["strih vide", "strihani vide", "editac vide", "uprav vide", "editor vide", "sestrih vide"], terms: ["video editor", "video editing", "video-editor", "video-editing"] },
  { phrases: ["prehravac vide", "prehrava vide", "prehravac film", "pusteni film", "sledovani film"], terms: ["media player", "video player", "media-player", "video-player"] },
  { phrases: ["prehravac hudb", "poslech hudb", "hudb", "prehravac mp3"], terms: ["music player", "audio player", "music-player", "audio-player", "music streaming"] },
  { phrases: ["ctecka pdf", "prohlizec pdf", "otevr pdf", "cteni pdf"], terms: ["pdf reader", "pdf viewer", "pdf-reader", "pdf-viewer"] },
  { phrases: ["uprav pdf", "editor pdf", "spoj pdf", "upravit pdf", "podeps pdf"], terms: ["pdf editor", "pdf-editor", "merge pdf", "edit pdf", "pdf tools"] },
  { phrases: ["rozbal", "archiv", "kompres", "zabal", "zip", "rar"], terms: ["archiver", "archive manager", "file archiver", "compression", "7z"] },
  { phrases: ["nahravani obrazovk", "zaznam obrazovk", "natoc obrazovk", "nahra obrazovk"], terms: ["screen recorder", "screen recording", "screen-recorder", "screencast"] },
  { phrases: ["snimek obrazovk", "snimk obrazovk", "screenshot"], terms: ["screenshot", "screen capture", "screen-capture"] },
  { phrases: ["spravce hesel", "hesl"], terms: ["password manager", "password-manager"] },
  { phrases: ["antivir", "virus", "malwar", "ochran pred vir"], terms: ["antivirus", "anti-malware", "antimalware", "malware"] },
  { phrases: ["vpn", "anonymn prohliz"], terms: ["vpn"] },
  { phrases: ["uprav fot", "editor fot", "fotk", "editor obrazk", "uprav obrazk", "retus"], terms: ["photo editor", "image editor", "photo-editor", "image-editor", "photo editing", "raster graphics"] },
  { phrases: ["prohlizec obrazk", "prohlizec fot", "prohlizen fot"], terms: ["image viewer", "photo viewer", "image-viewer", "picture viewer"] },
  { phrases: ["kresl", "malova"], terms: ["drawing", "painting", "digital painting", "illustration"] },
  { phrases: ["vektor"], terms: ["vector graphics", "vector editor", "vector-graphics", "svg editor"] },
  { phrases: ["3d model", "modelova", "3d tisk"], terms: ["3d modeling", "3d modelling", "3d-modeling", "3d printing", "slicer"] },
  { phrases: ["poznamk", "zapisk"], terms: ["note taking", "note-taking", "notes app", "notebook", "notes"] },
  { phrases: ["kancelar", "textovy procesor", "tabulk", "prezentac", "word", "excel"], terms: ["office suite", "word processor", "spreadsheet", "presentation"] },
  { phrases: ["editor kod", "programova", "vyvojove prostred"], terms: ["code editor", "code-editor", "ide", "integrated development environment"] },
  { phrases: ["textovy editor", "poznamkovy blok"], terms: ["text editor", "text-editor", "notepad"] },
  { phrases: ["e-mail", "email", "postovni klient", "post"], terms: ["email client", "e-mail client", "mail client", "email"] },
  { phrases: ["videohovor", "videokonferenc", "schuzk"], terms: ["video conferencing", "video call", "video calls", "meetings", "conferencing"] },
  { phrases: ["chat", "zprav", "komunikac", "messenger"], terms: ["chat", "messaging", "messenger", "instant messaging"] },
  { phrases: ["stahova vide", "stahnout vide", "stazen vide", "youtube"], terms: ["video downloader", "youtube downloader", "youtube-dl", "yt-dlp"] },
  { phrases: ["torrent"], terms: ["torrent", "bittorrent"] },
  { phrases: ["spravce stahova", "stahova soubor"], terms: ["download manager", "download-manager", "download accelerator"] },
  { phrases: ["vzdalen ploch", "vzdalen pristup", "vzdalen sprav", "ovladani na dalku"], terms: ["remote desktop", "remote access", "remote-desktop", "remote control"] },
  { phrases: ["zaloh"], terms: ["backup", "backup software"] },
  { phrases: ["synchroniz", "cloud", "uloziste"], terms: ["cloud storage", "file sync", "file synchronization", "file-sync"] },
  { phrases: ["virtualiz", "virtualni pocitac", "virtualni stroj"], terms: ["virtualization", "virtual machine", "hypervisor"] },
  { phrases: ["prekl"], terms: ["translator", "translation", "translate"] },
  { phrases: ["streamova", "vysilani", "zive vysila"], terms: ["live streaming", "streaming", "broadcast"] },
  { phrases: ["podcast", "nahravani zvuk", "strih zvuk", "editor zvuk", "uprav zvuk"], terms: ["audio editor", "audio recording", "audio-editor", "sound editor", "audio recorder"] },
  { phrases: ["vypal", "vypalova"], terms: ["burning", "cd burner", "dvd burner", "disc burning"] },
  { phrases: ["cisten disk", "uklid pocitac", "vycist", "zrychl pocitac"], terms: ["disk cleanup", "cleaner", "junk files", "disk cleaner"] },
  { phrases: ["odinstal"], terms: ["uninstaller"] },
  { phrases: ["elektronick knih", "ctecka knih", "e-knih", "epub"], terms: ["ebook", "e-book", "epub"] },
  { phrases: ["kalendar"], terms: ["calendar"] },
  { phrases: ["webkamer", "kamer"], terms: ["webcam", "camera"] },
  { phrases: ["teplot", "monitorova system", "vykon pocitac", "zatizeni"], terms: ["system monitor", "hardware monitor", "temperature", "system information"] },
  { phrases: ["ovladac"], terms: ["driver", "drivers"] },
  { phrases: ["financ", "ucetnictv", "rozpoct"], terms: ["finance", "accounting", "budget"] },
  { phrases: ["map", "navigac"], terms: ["maps", "gps", "navigation"] },
  { phrases: ["umela inteligenc", "chatbot", "jazykovy model"], terms: ["artificial intelligence", "chatgpt", "llm", "chatbot", "ai assistant"] },
  { phrases: ["herni obchod", "hry"], terms: ["game launcher", "game store", "game library"] },
];

/**
 * Výrazy z dotazu: každé slovo výrazu (kmen) musí v dotazu mít slovo, které jím začíná;
 * poslední slovo dotazu může být rozepsané (začátek kmene, aspoň 3 znaky).
 */
export function intentTerms(query: string): string[] {
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const last = words[words.length - 1];
  const wordMatches = (stem: string) =>
    words.some((w) => w.startsWith(stem)) || (last.length >= 3 && stem.startsWith(last) && words.length > 1);
  const found = new Set<string>();
  for (const intent of INTENTS) {
    if (intent.phrases.some((phrase) => phrase.split(" ").every(wordMatches))) for (const term of intent.terms) found.add(term);
  }
  return [...found];
}

/** Odpovídá aplikace některému z výrazů? (Název, štítky a popis – už normalizované.) */
export function matchesIntent(record: Pick<SearchRecord, "name" | "extra">, terms: readonly string[]): boolean {
  return terms.some((term) => record.extra.includes(term) || record.name.includes(term));
}
