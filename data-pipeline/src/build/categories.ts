/**
 * Zařazení aplikace do kategorií podle štítků (winget, Chocolatey), názvu,
 * popisu a id balíčku. Každé klíčové slovo přidá kategorii body; aplikace
 * dostane nejvýš dvě kategorie s nejvyšším skóre.
 *
 * Signály od nejsilnějšího: štítek (2 body, víceslovný štítek „malware-scanner“
 * i po slovech za 1), známý vydavatel z id wingetu (2 – „JetBrains.Rider“ →
 * Vývoj), slovo nebo dvojice slov z názvu a popisu (1) a části id balíčku (1 –
 * „Microsoft.VisualStudio.BuildTools“ → visualstudio). Hodně balíčků wingetu
 * popis v katalogu nemá (manifest jen u nejpopulárnějších), proto záleží i na
 * štítcích z indexu a na id.
 *
 * Kategorie od verze 0.1.20 (AI, hudba a zvuk, cloud, vzdělávání, finance,
 * síť, přizpůsobení) starší verze HubGetu neznají – katalog je proto nese
 * v poli `categoriesV2` a do `categories` dá jejich nejbližší starou
 * kategorii ([legacyCategories]).
 */
import type { CategoryId } from "../../../src/types/index.ts";
import { normalize } from "../lib/text.ts";

/** Klíčová slova → kategorie (jedno slovo může patřit do více kategorií). */
const KEYWORDS: Record<CategoryId, string[]> = {
  ai: [
    "voice-assistant", "ia", "assistant-vocal",
    "ai", "artificial-intelligence", "llm", "llms", "chatgpt", "gpt", "openai", "ollama", "machine-learning", "deep-learning",
    "neural-network", "stable-diffusion", "copilot", "chatbot", "generative-ai", "genai", "claude", "gemini", "transcription",
    "ml", "nlp", "llama", "mistral", "huggingface", "diffusion", "comfyui", "speech-to-text", "whisper", "ocr", "computer-vision",
    "image-generation", "ai-assistant", "ai-agent", "ai-coding", "prompt", "rag",
    "人工智能", "大语言模型", "大模型", "智能体", "聊天机器人", "自主智能", "deepseek", "qwen", "agentic", "coding-agent",
  ],
  browsers: ["browser", "web-browser", "webbrowser", "chromium", "firefox", "chrome", "browsers"],
  development: [
    "olap", "ssas", "mdx", "powerbuilder", "vs2010", "vs2012", "vs2015", "vs2017", "vs2019", "vs2022", "repositories", "repository", "hexdump", "service-wrapper", "windows-service",
    "xaml", "winui", "ui-library", "selenium", "webdriver", "apk", "smali", "protobuf", "protoc", "salt", "saltstack", "minion", "awk", "gawk", "text-processor", "sed", "grep", "cake", "bison", "lexer", "parser-generator", "tree-sitter", "parser", "scintilla", "source-editing", "kafka", "message-broker", "rabbitmq", "command-processor", "window-inspector", "elasticsearch", "toolchain", "api-testing", "mock-server",
    "development", "developer", "developer-tools", "devtools", "ide", "code-editor", "programming", "compiler", "sdk",
    "git", "version-control", "vcs", "debugger", "database", "api", "javascript", "python", "nodejs", "rust", "java",
    "dotnet", "docker", "container", "kubernetes", "terminal", "shell", "cli", "command-line", "devops", "json", "graphql", "rest-client", "http-client",
    "vscode", "vscode-extension", "visual-studio", "visualstudio", "vsix", "xml", "xslt", "xsd", "yaml", "sql", "mysql",
    "postgresql", "postgres", "sqlite", "mongodb", "redis", "php", "c#", "csharp", "golang", "c++", "cpp", "typescript",
    "testing", "unit-testing", "test-automation", "ci", "cicd", "ci-cd", "build-tool", "build-system", "framework", "jdk",
    "jre", "openjdk", "unity", "unity3d", "game-engine", "godot", "unreal-engine", "adb", "android-sdk", "android-studio",
    "xcode", "wsl", "linux", "documentation", "diff", "merge", "lint", "linter", "linting", "formatter", "ctags", "terraform",
    "ansible", "puppet", "vagrant", "azure-cli", "aws-cli", "gcloud", "npm", "yarn", "pnpm", "deno", "ruby", "perl", "lua",
    "haskell", "erlang", "elixir", "kotlin", "scala", "swift", "dart", "flutter", "rstudio", "jupyter", "regex", "postman",
    "grpc", "websocket", "debugging", "profiler", "profiling", "decompiler", "disassembler", "reverse-engineering", "hex-editor",
    "vim", "neovim", "emacs", "text-editor", "source-code", "programming-language", "scripting", "powershell", "web-server",
    "webserver", "http-server", "xampp", "nginx", "iis", "localhost", "sdk-tools", "software-development", "coding", "mingw",
    "msys2", "cygwin", "llvm", "clang", "gcc", "cmake", "maven", "gradle", "nuget", "pip", "conda", "anaconda", "jetbrains",
    "sonarqube", "sonar", "nunit", "xunit", "junit", "test-runner", "tests", "unit-tests", "code-analysis", "static-analysis",
    "package-manager", "dsc", "boxstarter", "sdk-manager", "emulator-android",
    "代码", "编程", "编程语言", "开发", "runtime", "assembler", "nasm", "shared-library", "environment-variables",
    "installer-builder", "setup-builder", "installation-builder", "msi-builder", "harmonyos", "openharmony", "chef", "infrastructure",
    "devcontainer", "snippet", "snippets", "json-viewer", "svn", "subversion", "mercurial", "zig", "nim", "cms", "static-site", "static-site-generator", "site-generator",
  ],
  communication: [
    "chat", "messaging", "messenger", "email", "e-mail", "mail", "voip", "video-conferencing", "conference", "conferencing",
    "meeting", "meetings", "webinar", "irc", "slack", "discord", "telegram", "softphone", "sip", "pbx", "telephony",
    "telephone", "phone", "sms", "collaboration", "team-chat", "outlook", "thunderbird", "zoom", "teams", "skype", "whatsapp",
    "signal", "matrix", "xmpp", "jabber", "mattermost", "social", "social-media", "twitter", "mastodon", "email-client",
    "即时通讯", "聊天", "通讯", "instant-messaging", "im-client", "qq", "wechat", "viber", "feishu", "dingtalk", "lark",
  ],
  games: [
    "uplay", "ubisoft", "ubisoft-connect", "battle-net", "origin-client",
    "game", "games", "gaming", "launcher", "steam", "emulator", "minecraft", "esports", "mod", "mods", "modding",
    "mod-manager", "gamepad", "joystick", "retro", "retroarch", "roms", "rom", "nintendo", "playstation",
    "chess", "rpg", "shooter", "game-launcher", "epic-games", "gog", "itch", "speedrun", "trainer", "puzzle", "arcade",
    "multiplayer", "game-server", "游戏启动器", "steam-deck", "videogame", "video-game", "wad", "megawad", "doom", "brutaldoom", "游戏", "mmorpg", "fps-game",
  ],
  // Hudba a Video jen podle jednoznačných slov – „media“, „player“, „streaming“ či „recording“
  // mají hudební přehrávače stejně jako video (AIMP, Spotify by jinak skončily ve Videu)
  audio: [
    "earbuds", "freebuds", "headset", "airpods", "famitracker", "chiptune", "tracker-music",
    "audio", "music", "mp3", "flac", "podcast", "podcasts", "audio-editor", "audio-player", "music-player", "music-streaming",
    "audio-recording", "daw", "midi", "synthesizer", "sound", "spotify", "radio", "equalizer", "karaoke", "tagger", "audiobook",
    "songs", "playlist", "playlists", "lyrics", "music-streamer", "audio-editing", "sound-editor",
    "music-production", "music-editor", "music-notation", "notation", "sheet-music", "scorewriter", "mixing", "mastering",
    "sequencer", "vst", "wave-editor", "waveform", "guitar", "piano", "musician", "volume", "audio-devices", "sound-devices",
    "audio-controls", "soundboard", "voice-changer", "microphone", "headphones", "speakers", "asio", "ringtone",
    "音乐", "歌单", "歌手", "专辑", "听歌", "音频", "music-library", "audio-interface", "amp-modeler", "line6",
  ],
  multimedia: [
    "video", "videos", "video-player", "video-editor", "video-editing", "multimedia", "multimedia-player", "codec", "codecs", "youtube", "dvd", "blu-ray", "obs",
    "screen-recorder", "screen-recording", "movie", "movies", "film", "cinema", "tv", "iptv", "subtitles", "webcam", "mkv", "mp4",
    "media-server", "media-streamer", "media-center", "home-theater", "jellyfin", "plex", "emby", "camera", "cast", "casting",
    "chromecast", "dlna", "upnp", "twitch", "live-streaming", "mpv", "vlc", "ffmpeg", "transcode", "transcoding", "anime",
    "播放器", "视频", "剪辑", "影片", "电影", "影视", "直播", "番剧", "video-downloader",
  ],
  utilities: [
    "smart-home", "home-automation", "hue", "philips-hue", "loxone",
    "altdrag", "alt-drag", "drag-windows", "resize", "window-size", "extract", "extractor", "unpacker", "unpack", "flipper-zero", "flipperzero", "spell-checker",
    "utility", "utilities", "tool", "tools", "file-manager", "archive", "archiver", "zip", "7z", "rar", "clipboard", "screenshot",
    "search", "launcher", "rename", "file", "files", "folder", "folders", "file-explorer", "converter", "convert", "conversion",
    "compression", "compress", "decompress", "unlocker", "unlock", "calculator", "timer", "stopwatch", "clock", "alarm",
    "automation", "automate", "macro", "macros", "hotkey", "hotkeys", "keyboard-shortcuts", "quicklook", "preview", "viewer",
    "batch", "duplicate", "duplicates", "finder", "qr", "barcode", "magnifier", "screen-capture", "copy", "accessibility",
    "speech", "text-to-speech", "tts", "msspeech", "narrator", "screen-reader", "diff", "compare", "merge", "explorer",
    "context-menu", "shell-extension", "productivity-tool", "ime", "input-method", "pinyin", "keyboard-layout", "gps", "navigation", "drone", "dji",
    "输入法", "工具", "window-manager", "window-management", "always-on-top", "topmost", "snap", "tiling", "awake",
    "keep-awake", "prevent-sleep", "caffeine", "keymap", "empty-folders", "empty-directories", "remap", "key-remapping", "expander", "text-expander", "autotext", "text-snippets",
  ],
  security: [
    "authentication", "mfa", "authenticator-app", "dnie", "nitrokey", "surveillance", "cctv", "nvr", "dvr", "ip-camera", "video-surveillance",
    "openssl", "cryptography", "yubikey", "yubico", "piv", "fido", "fido2", "security-key",
    "security", "password", "password-manager", "vpn", "antivirus", "anti-malware", "malware", "encryption", "privacy", "firewall",
    "2fa", "authenticator", "adware", "spyware", "virus", "forensics", "forensic", "certificate", "certificates", "ssl", "tls",
    "pki", "gpg", "pgp", "totp", "keepass", "veracrypt", "encrypt", "decrypt", "hash", "checksum", "sandbox", "pentest",
    "penetration-testing", "vulnerability", "anonymity", "secrets", "zero-trust", "openvpn", "wireguard", "passwords", "adblock", "ad-blocker", "adblocker", "antispy", "telemetry", "signature", "code-signing",
    "anti-theft", "access-control", "eid", "smartcard", "smart-card", "identity", "defender", "安全", "杀毒",
  ],
  productivity: [
    "blog", "blogging", "hexo", "pomodoro", "focus-timer", "distraction", "distraction-free", "documentation-viewer",
    "grammar", "spelling", "proofreading", "1c",
    "office", "productivity", "notes", "note-taking", "pdf", "todo", "calendar", "document", "spreadsheet", "markdown",
    "writing", "ebook", "reader", "notepad", "mind-map", "mind-mapping", "mindmap", "diagram", "diagrams", "flowchart",
    "latex", "tex", "typesetting", "label", "labels", "printing", "printer", "translation", "translator", "word", "excel",
    "powerpoint", "presentation", "journal", "diary", "wiki", "knowledge-base", "kanban", "project-management", "tasks",
    "time-tracking", "timesheet", "crm", "erp", "business", "epub", "comics", "manga", "bookmark", "bookmarks",
    "business-intelligence", "analytics", "dashboard", "data-analysis", "documents", "text-editor", "word-processor", "translate", "signage", "reporting", "forms", "invoice-generator",
    "recipe", "recipes", "meal-planning", "tiddlywiki", "reminder", "reminders", "break-reminder", "办公", "文档", "笔记",
    "restaurant", "pos", "inventory", "erp-client", "knowledge-management", "pkm", "logseq", "outliner", "gantt", "甘特图", "项目管理",
  ],
  graphics: [
    "slicer", "gcode", "3d-printing", "3dprinting", "3d-printer", "cura", "prusaslicer",
    "graphics", "image", "image-editor", "photo", "photography", "drawing", "paint", "3d", "design", "svg", "vector", "cad",
    "animation", "icon", "font", "fonts", "solidworks", "revit", "autocad", "sketchup", "rhino", "绘图", "图形", "设计", "normal-map", "texture-generator", "typeface", "palette", "color", "colors", "colour", "color-picker", "photogrammetry",
    "texture", "render", "rendering", "renderer", "3d-modeling", "modeling", "modelling", "sculpting", "pixel-art", "sprite",
    "gif", "raw", "photoshop", "krita", "inkscape", "gimp", "comic", "whiteboard", "image-viewer", "photo-viewer", "gallery",
    "icons", "ui-design", "prototyping", "wireframe", "figma", "graphic", "graphic-design", "images", "photos", "pictures",
  ],
  system: [
    "raspberry-pi", "raspbian", "raspberrypi", "disable-updates",
    "chocolatey", "winget", "package-management", "winlogbeat", "event-logs", "io-tester", "disk-benchmark", "dell-update", "dism", "armoury-crate", "wmi", "tail", "log-file", "log-monitoring",
    "system", "hardware", "monitoring", "driver", "drivers", "disk", "benchmark", "backup", "cleanup", "registry", "uninstaller",
    "cpu", "gpu", "partition", "boot", "usb", "keyboard", "mouse", "peripherals", "monitor", "recovery", "data-recovery",
    "file-recovery", "undelete", "restore", "sysinternals", "process", "processes", "diagnostics", "diagnostic", "firmware",
    "bios", "uefi", "imager", "flash", "bootable", "iso", "uninstall", "cleaner", "junk", "optimizer", "optimization",
    "display", "brightness", "night-light", "power", "battery", "temperature", "fan", "sensors", "virtualization",
    "virtual-machine", "vm", "hypervisor", "virtualbox", "vmware", "hyper-v", "redistributable", "vcredist", "directx",
    "task-manager", "startup", "autostart", "defrag", "ssd", "hdd", "windows-update", "sysadmin", "administration",
    "active-directory", "rsat", "event-log", "log-viewer", "system-information", "system-tools", "rgb", "lighting",
    "logging", "syslog", "log-management", "etw", "event-tracing", "administrator", "elevation", "admin-rights",
    "adk", "winpe", "waik", "deployment", "imaging", "kernel", "update-assistant", "driver-update", "updater",
    "veeam", "vspc", "io-benchmark", "系统", "驱动", "pxe", "blue-light", "gamma",
  ],
  cloud: [
    "rclone",
    "cloud", "cloud-storage", "sync", "file-sync", "synchronization", "onedrive", "dropbox", "google-drive", "nextcloud", "owncloud",
    "mega", "amazon-s3", "aws-s3", "webdav", "file-synchronization", "syncthing", "azure", "aws", "gcp", "google-cloud",
    "object-storage", "icloud", "pcloud", "sharepoint", "cloud-backup", "online-backup", "nas", "synology", "qnap", "private-cloud", "云盘", "网盘", "云存储", "同步",
  ],
  education: [
    "robotics", "frc", "orienteering", "sports-science",
    "theorem", "prover", "smt-solver", "sat-solver",
    "education", "educational", "learning", "e-learning", "science", "math", "mathematics", "physics", "chemistry", "astronomy",
    "biology", "geography", "flashcards", "anki", "dictionary", "school", "students", "teaching", "statistics", "language-learning",
    "geotechnical", "geotechnics", "geotechnik", "engineering", "civil-engineering", "electronics", "circuit", "simulation",
    "lab", "laboratory", "research", "academic", "scientific", "data-acquisition", "physiology", "medical", "medicine",
    "health", "anatomy", "earth", "globe", "gis", "geographic", "planetarium", "telescope", "genealogy",
    "family-tree", "bible", "quiz", "exam", "typing", "graphing", "plotting", "matlab", "octave", "maxima", "geometry", "algebra",
    "dicom", "healthcare", "bioinformatics", "thermodynamics", "refrigeration", "hvac", "bim", "construction", "hydrology", "energy-modeling", "load-calculation",
    "religion", "scripture", "microscopy", "spectroscopy", "seismic", "surveying", "weather", "meteorology", "astrophotography",
    "教育", "学习", "学生", "数学", "hec-ras", "clinical", "clinicians", "ornithology", "birds", "physiology-lab", "daq",
  ],
  // Bez „crypto“ – to bývá kryptografie (XCA, Minisign, IIS Crypto)
  finance: [
    "finance", "financial", "money", "budget", "budgeting", "accounting", "invoice", "invoicing", "banking",
    "cryptocurrency", "bitcoin", "ethereum", "blockchain", "wallet", "trading", "stock", "stocks", "portfolio", "tax",
    "crypto-wallet", "bank", "payment", "payments", "expense", "expenses", "payroll", "point-of-sale", "monero", "litecoin",
    "solana", "defi", "forex", "bookkeeping", "irpf", "imposto", "steuer", "finanzen", "金融", "财务", "股票", "digital-cash", "dashcore", "crypto-currency", "altcoin",
  ],
  network: [
    "nntp", "newsgroups",
    "port-scanner", "openssh", "nmap",
    "network", "networking", "torrent", "bittorrent", "p2p", "download-manager", "downloader", "remote-desktop", "remote-access",
    "remote", "ssh", "ftp", "sftp", "vnc", "rdp", "proxy", "dns", "wifi", "lan", "packet", "file-transfer", "sniffer",
    "network-sniffer", "networksniffer", "network-capture", "networkcapture", "packet-capture", "network-analyzer",
    "protocol-analyzer", "network-monitoring", "tunnel", "tunneling", "reverse-proxy", "port-forwarding", "ngrok", "cloudflare",
    "socks", "ip-scanner", "network-scanner", "ping", "traceroute", "bandwidth", "speedtest", "router", "modem", "telnet",
    "putty", "ssh-client", "teamviewer", "anydesk", "download", "downloads", "torrent-client", "usenet", "nzb", "dhcp",
    "tftp", "smb", "nfs", "samba", "wake-on-lan", "file-sharing", "internet", "http", "web-scraping", "crawler",
    "clash", "v2ray", "shadowsocks", "name-server", "共享", "分享", "下载", "代理", "远程",
  ],
  // Ostatní = bez kategorie (ukazuje ji jen aplikace) – žádná slova
  other: [],
  personalization: [
    "status-bar", "statusbar", "topbar", "menubar",
    "wallpaper", "wallpapers", "screensaver", "theme", "themes", "customization", "customize", "taskbar", "start-menu", "widgets",
    "widget", "rainmeter", "skin", "skins", "cursor", "dock", "desktop-customization", "tweaks", "dark-mode", "icon-pack",
    "start-button", "visual-styles", "transparency", "translucent", "acrylic", "mica", "lockscreen", "lock-screen", "cursors",
  ],
};

/**
 * Známí vydavatelé (první část id wingetu) → kategorie. Jen ti, jejichž aplikace
 * patří do jedné oblasti – vydavatelé se vším možným (Microsoft, Google, Apache) tu nejsou.
 */
const PUBLISHERS: Record<string, CategoryId> = {
  jetbrains: "development", github: "development", gitkraken: "development", docker: "development", hashicorp: "development",
  python: "development", openjs: "development", golang: "development", rustlang: "development", azul: "development",
  bellsoft: "development", eclipseadoptium: "development", adoptium: "development", altova: "development", postman: "development",
  kong: "development", sublimehq: "development", kitware: "development", llvm: "development", jfrog: "development",
  vercel: "development", mongodb: "development", oracle: "development", rstudio: "development", posit: "development",
  veeam: "system", nirsoft: "system", cpuid: "system", intel: "system", amd: "system", nvidia: "system", realtek: "system",
  logitech: "system", corsair: "system", asus: "system", dell: "system", lenovo: "system", piriform: "system", iobit: "system",
  vovsoft: "utilities", sordum: "utilities", voidtools: "utilities",
  adinstruments: "education", visionaid: "utilities", nuance: "utilities",
  valve: "games", epicgames: "games", gog: "games", ubisoft: "games", electronicarts: "games", riotgames: "games",
  blizzard: "games", mojang: "games", playnite: "games", heroicgameslauncher: "games",
  adobe: "graphics", autodesk: "graphics", blenderfoundation: "graphics", serif: "graphics", corel: "graphics",
  malwarebytes: "security", bitwarden: "security", eset: "security", kaspersky: "security", avast: "security",
  bitdefender: "security", nordsecurity: "security", agilebits: "security",
  zoom: "communication", slacktechnologies: "communication", discord: "communication", telegram: "communication",
  mattermost: "communication", whatsapp: "communication",
  dropbox: "cloud", nextcloud: "cloud", owncloud: "cloud",
  openai: "ai", anthropic: "ai", ollama: "ai",
};

/** Opačná mapa slovo → kategorie. */
const BY_WORD = new Map<string, CategoryId[]>();
for (const [category, words] of Object.entries(KEYWORDS) as [CategoryId, string[]][]) {
  for (const word of words) BY_WORD.set(word, [...(BY_WORD.get(word) ?? []), category]);
}

/** Slova mimo latinku (čínština) – v názvu a popisu se hledají jako podřetězec, mezery mezi slovy nemají. */
const NON_LATIN = [...BY_WORD.keys()].filter((word) => /[^ -]/.test(word));

/** Co o aplikaci víme: štítky, název, popis a id balíčků („JetBrains.Rider“, „extras/firefox“). */
export interface CategoryInput {
  tags: string[];
  name: string;
  description: string;
  ids?: string[];
}

/** Dvě kategorie s nejvyšším skóre; `as` převede kategorii klíčového slova (null = nepočítat). */
function score({ tags, name, description, ids = [] }: CategoryInput, as: (c: CategoryId) => CategoryId | null): CategoryId[] {
  const points = new Map<CategoryId, number>();
  const give = (found: CategoryId, weight: number) => {
    const c = as(found);
    if (c) points.set(c, (points.get(c) ?? 0) + weight);
  };
  const add = (word: string, weight: number) => {
    for (const found of BY_WORD.get(word) ?? []) give(found, weight);
  };
  for (const tag of tags) {
    const t = normalize(tag);
    add(t, 2);
    // Víceslovný štítek i po slovech: „malware-scanner“ → malware
    const parts = t.split("-");
    if (parts.length > 1) for (const part of parts) if (part.length > 2) add(part, 1);
  }
  const words = normalize(`${name} ${description}`).split(/[^a-z0-9+#-]+/).filter(Boolean);
  // I dvojice slov jako štítek: „music player“ = music-player, „web browser“, „password manager“
  words.forEach((word, i) => {
    add(word, 1);
    if (i > 0) add(`${words[i - 1]}-${word}`, 1);
    // „emacs-pdumper“ → emacs, „audio-interface“ i jako audio
    if (word.includes("-")) for (const part of word.split("-")) if (part.length > 2) add(part, 1);
  });
  const text = normalize(`${name} ${description}`);
  for (const word of NON_LATIN) if (text.includes(word)) add(word, 1);
  for (const id of ids) {
    const segments = normalize(id).split(/[./\\]/).filter(Boolean);
    // Vydavatel jen u id wingetu („JetBrains.Rider“), ne u bucketu Scoopu („extras/…“)
    const publisher = id.includes(".") && !id.includes("/") ? PUBLISHERS[segments[0]] : undefined;
    if (publisher) give(publisher, 2);
    for (const part of segments.slice(publisher ? 1 : 0)) for (const word of part.split(/[-_]/)) if (word.length > 1) add(word, 1);
  }

  // Při shodě Video před Hudbou – nástroje pro zvuk i video (FFmpeg, yt-dlp, MediaInfo); hudební přehrávače
  // a editory mají hudebních slov víc
  const tie = (c: CategoryId) => (c === "multimedia" ? 1 : 0);
  // Silná shoda (štítek, dvě slova) má přednost; bez ní stačí jediné slovo z názvu a popisu
  // („disk space analyzer“ → Systém) – jinak by polovina katalogu zůstala bez kategorie
  const best = Math.max(0, ...points.values());
  const ranked = [...points.entries()]
    .filter(([, s]) => s >= Math.min(2, best))
    .sort((a, b) => b[1] - a[1] || tie(b[0]) - tie(a[0]))
    .map(([c]) => c);
  // Hudba a Video se vylučují – zůstane ta, která převažuje (VLC jen Video, iTunes jen Hudba),
  // ať v Hudbě nejsou přehrávače videa jen proto, že umí i zvuk
  const media = ranked.find((c) => c === "audio" || c === "multimedia");
  return ranked.filter((c) => (c !== "audio" && c !== "multimedia") || c === media).slice(0, 2);
}

export function categorize(input: CategoryInput): CategoryId[] {
  return score(input, (c) => c);
}

/** Kategorie, které zná i HubGet 0.1.19 a starší (pole `categories` v katalogu). */
const LEGACY = new Set<CategoryId>(["browsers", "development", "communication", "games", "multimedia", "utilities", "security", "productivity", "graphics", "system"]);

/**
 * Kategorie pro starší verze – jako před verzí 0.1.20: slova o zvuku a hudbě patří
 * k multimédiím, slova nových kategorií se nepočítají.
 */
export function categorizeLegacy(input: CategoryInput): CategoryId[] {
  return score(input, (c) => (c === "audio" ? "multimedia" : LEGACY.has(c) ? c : null));
}

/** Ruční kategorie (curated.json) pro starší verze: jen ty, které znají. */
export function legacyCategories(categories: CategoryId[]): CategoryId[] {
  return categories.map((c) => (c === "audio" ? "multimedia" : c)).filter((c, i, all) => LEGACY.has(c) && all.indexOf(c) === i);
}
