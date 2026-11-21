/**
 * Aplikace, které se aktualizují samy (vlastní aktualizátor na pozadí – prohlížeče, komunikátory,
 * herní obchody, cloudová úložiště…). Id balíčků wingetu malými písmeny; poznají se i instalace
 * téže aplikace přes Chocolatey či Scoop (stejný profil v katalogu – store/updateRules.ts).
 *
 * Jejich aktualizace HubGet nezapočítává do Dostupných aktualizací, dokud jim nedá čas
 * aktualizovat se samy (SELF_UPDATE_GRACE_DAYS) – jinak by je stahoval podruhé, často zrovna
 * ve chvíli, kdy je aplikace má připravené. Když se aplikace sama neaktualizuje (vypnutý
 * aktualizátor, firemní zásady), HubGet aktualizaci po lhůtě nabídne. Vypnout: Nastavení →
 * Aktualizace balíčků → Aplikace, které se aktualizují samy.
 */
export const SELF_UPDATING_WINGET: ReadonlySet<string> = new Set(
  [
    // Prohlížeče a pošta
    "Google.Chrome", "Google.Chrome.Beta", "Google.Chrome.Dev", "Mozilla.Firefox", "Mozilla.Firefox.ESR", "Mozilla.Firefox.DeveloperEdition",
    "Mozilla.Firefox.Beta", "Mozilla.Firefox.Nightly", "Mozilla.Thunderbird", "Microsoft.Edge", "Microsoft.Edge.Beta", "Microsoft.Edge.Dev",
    "Brave.Brave", "Opera.Opera", "Opera.OperaGX", "Vivaldi.Vivaldi",
    // Komunikace
    "Discord.Discord", "SlackTechnologies.Slack", "Zoom.Zoom", "Microsoft.Teams", "Telegram.TelegramDesktop", "OpenWhisperSystems.Signal",
    "Element.Element",
    // Hudba a herní obchody
    "Spotify.Spotify", "Valve.Steam", "EpicGames.EpicGamesLauncher", "ElectronicArts.EADesktop", "Ubisoft.Connect", "GOG.Galaxy",
    "Blizzard.BattleNet",
    // Cloudová úložiště
    "Dropbox.Dropbox", "Microsoft.OneDrive", "Google.GoogleDrive",
    // Práce a vývoj
    "Notion.Notion", "Figma.Figma", "Postman.Postman", "GitHub.GitHubDesktop", "Obsidian.Obsidian", "Microsoft.VisualStudioCode",
    "Anysphere.Cursor", "Codeium.Windsurf", "JetBrains.Toolbox", "Anthropic.Claude",
    // Hesla a příslušenství
    "AgileBits.1Password", "Bitwarden.Bitwarden", "Logitech.GHUB",
  ].map((id) => id.toLowerCase()),
);

/** Kolik dní nechat aplikaci, aby se aktualizovala sama, než HubGet aktualizaci nabídne. */
export const SELF_UPDATE_GRACE_DAYS = 14;
/** U bezpečnostní opravy kratší lhůta. */
export const SELF_UPDATE_SECURITY_GRACE_DAYS = 3;
