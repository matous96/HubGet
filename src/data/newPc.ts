/**
 * Nový počítač (pages/NewPcPage.tsx, po vzoru Ninite): oblíbené aplikace po kategoriích
 * k zaškrtnutí a instalaci najednou. Id aplikací z katalogu; skupiny nesou id kategorie
 * (popisek z překladů categories.*). Aplikace, kterou katalog nezná, se vynechá.
 */
import type { CategoryId } from "@/types";

export interface NewPcGroup {
  category: CategoryId;
  apps: string[];
}

export const NEW_PC_GROUPS: NewPcGroup[] = [
  { category: "browsers", apps: ["mozilla-firefox", "google-chrome", "brave-brave", "vivaldi-vivaldi", "opera-opera", "microsoft-edge"] },
  {
    category: "communication",
    apps: ["discord-discord", "zoom-zoom", "microsoft-teams", "telegram-telegramdesktop", "openwhispersystems-signal", "mozilla-thunderbird"],
  },
  { category: "multimedia", apps: ["videolan-vlc", "spotify-spotify", "clsid2-mpc-hc", "audacity-audacity", "obsproject-obsstudio", "handbrake-handbrake"] },
  {
    category: "productivity",
    apps: ["thedocumentfoundation-libreoffice", "adobe-acrobat-reader-64-bit", "sumatrapdf-sumatrapdf", "notepadplusplus-notepadplusplus", "obsidian-obsidian"],
  },
  {
    category: "utilities",
    apps: ["7zip-7zip", "microsoft-powertoys", "voidtools-everything", "sharex-sharex", "windirstat-windirstat", "crystaldewworld-crystaldiskinfo", "revouninstaller-revouninstaller"],
  },
  { category: "graphics", apps: ["gimp-gimp", "inkscape-inkscape", "kde-krita", "dotpdn-paintdotnet", "irfanskiljan-irfanview", "blenderfoundation-blender"] },
  { category: "security", apps: ["bitwarden-bitwarden", "keepassxcteam-keepassxc", "malwarebytes-malwarebytes", "proton-protonvpn"] },
  { category: "cloud", apps: ["dropbox-dropbox", "google-googledrive", "microsoft-onedrive"] },
  { category: "network", apps: ["qbittorrent-qbittorrent", "teamviewer-teamviewer", "anydesk-anydesk"] },
  { category: "games", apps: ["valve-steam", "epicgames-epicgameslauncher", "gog-galaxy"] },
  {
    category: "development",
    apps: ["microsoft-visualstudiocode", "git-git", "openjs-nodejs-lts", "python-python-3-13", "microsoft-windowsterminal", "microsoft-powershell", "docker-dockerdesktop"],
  },
];
