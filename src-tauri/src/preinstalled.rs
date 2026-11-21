//! Předinstalované aplikace Windows (Přehled počítače → Předinstalované aplikace): hry, zprávy,
//! tipy a aplikace partnerů, které Windows nebo výrobce počítače nainstalují s novým účtem.
//!
//! Jen pevný seznam bezpečně odebratelných balíčků – žádné součásti systému, knihovny ani
//! aplikace, na kterých něco závisí (Microsoft Store, Instalační program aplikace s wingetem,
//! Herní panel Xboxu, kalkulačka, fotky…). Odeberou se jen aktuálnímu uživateli
//! (Remove-AppxPackage, bez práv správce) a vrátit je jde z Microsoft Storu (`store_page`).

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::powershell::{powershell_exe, ps_string};
use crate::process::background;

/// Skupina v seznamu (texty ve frontendu: preinstalled.group.*).
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Group {
    /// Hry (Solitaire, Candy Crush…).
    Games,
    /// Aplikace Microsoftu (Zprávy, Počasí, Tipy…).
    Microsoft,
    /// Aplikace partnerů (Spotify, Disney+…) – často jen odkaz na instalaci.
    Partners,
}

/// Známý balíček: název balíčku (Id.Name), název pro případ, že ho Windows nevrátí,
/// skupina a jestli ho HubGet doporučí odebrat (zbytečný pro většinu lidí – ukončená
/// nebo reklamní aplikace). Ostatní jen nabídne, vybrat je musí uživatel.
struct Known {
    name: &'static str,
    label: &'static str,
    group: Group,
    recommended: bool,
}

const fn known(name: &'static str, label: &'static str, group: Group, recommended: bool) -> Known {
    Known { name, label, group, recommended }
}

const KNOWN: &[Known] = &[
    // Hry
    known("Microsoft.MicrosoftSolitaireCollection", "Microsoft Solitaire Collection", Group::Games, true),
    known("king.com.CandyCrushSaga", "Candy Crush Saga", Group::Games, true),
    known("king.com.CandyCrushSodaSaga", "Candy Crush Soda Saga", Group::Games, true),
    known("king.com.CandyCrushFriends", "Candy Crush Friends Saga", Group::Games, true),
    known("king.com.BubbleWitch3Saga", "Bubble Witch 3 Saga", Group::Games, true),
    known("king.com.FarmHeroesSaga", "Farm Heroes Saga", Group::Games, true),
    known("Microsoft.XboxApp", "Xbox Console Companion", Group::Games, true),
    known("Microsoft.GamingApp", "Xbox", Group::Games, false),
    // Aplikace Microsoftu
    known("Microsoft.BingNews", "Microsoft News", Group::Microsoft, true),
    known("Microsoft.BingWeather", "MSN Weather", Group::Microsoft, true),
    known("Microsoft.BingFinance", "MSN Money", Group::Microsoft, true),
    known("Microsoft.BingSports", "MSN Sports", Group::Microsoft, true),
    known("Microsoft.BingSearch", "Microsoft Bing", Group::Microsoft, true),
    known("Microsoft.GetHelp", "Get Help", Group::Microsoft, true),
    known("Microsoft.Getstarted", "Tips", Group::Microsoft, true),
    known("Microsoft.MicrosoftOfficeHub", "Microsoft 365 Copilot", Group::Microsoft, false),
    known("Microsoft.WindowsFeedbackHub", "Feedback Hub", Group::Microsoft, true),
    known("Microsoft.549981C3F5F10", "Cortana", Group::Microsoft, true),
    known("Microsoft.PowerAutomateDesktop", "Power Automate", Group::Microsoft, true),
    known("Microsoft.WindowsMaps", "Windows Maps", Group::Microsoft, true),
    known("Microsoft.MixedReality.Portal", "Mixed Reality Portal", Group::Microsoft, true),
    known("Microsoft.SkypeApp", "Skype", Group::Microsoft, true),
    known("Microsoft.Microsoft3DViewer", "3D Viewer", Group::Microsoft, true),
    known("Microsoft.MSPaint", "Paint 3D", Group::Microsoft, true),
    known("Microsoft.Print3D", "Print 3D", Group::Microsoft, true),
    known("Microsoft.Wallet", "Microsoft Pay", Group::Microsoft, true),
    known("Microsoft.Messaging", "Microsoft Messaging", Group::Microsoft, true),
    known("Microsoft.OneConnect", "Mobile Plans", Group::Microsoft, true),
    known("Microsoft.People", "People", Group::Microsoft, true),
    known("Microsoft.windowscommunicationsapps", "Mail and Calendar", Group::Microsoft, true),
    known("Microsoft.Office.OneNote", "OneNote for Windows 10", Group::Microsoft, true),
    known("MicrosoftTeams", "Microsoft Teams (free)", Group::Microsoft, true),
    known("Microsoft.ZuneVideo", "Movies & TV", Group::Microsoft, true),
    known("Clipchamp.Clipchamp", "Microsoft Clipchamp", Group::Microsoft, false),
    known("Microsoft.ZuneMusic", "Media Player", Group::Microsoft, false),
    known("Microsoft.Todos", "Microsoft To Do", Group::Microsoft, false),
    known("Microsoft.YourPhone", "Phone Link", Group::Microsoft, false),
    known("Microsoft.OutlookForWindows", "Outlook (new)", Group::Microsoft, false),
    known("Microsoft.Copilot", "Microsoft Copilot", Group::Microsoft, false),
    known("Microsoft.MicrosoftJournal", "Microsoft Journal", Group::Microsoft, false),
    known("MicrosoftCorporationII.MicrosoftFamily", "Microsoft Family Safety", Group::Microsoft, false),
    // Aplikace partnerů
    known("SpotifyAB.SpotifyMusic", "Spotify", Group::Partners, false),
    known("Disney.37853FC22B2CE", "Disney+", Group::Partners, false),
    known("AmazonVideo.PrimeVideo", "Prime Video", Group::Partners, false),
    known("BytedancePte.Ltd.TikTok", "TikTok", Group::Partners, false),
    known("5319275A.WhatsAppDesktop", "WhatsApp", Group::Partners, false),
    known("Facebook.InstagramBeta", "Instagram", Group::Partners, false),
    known("7EE7776C.LinkedInforWindows", "LinkedIn", Group::Partners, false),
];

fn known_by_name(name: &str) -> Option<&'static Known> {
    KNOWN.iter().find(|k| k.name.eq_ignore_ascii_case(name))
}

/// Nalezená předinstalovaná aplikace.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preinstalled {
    /// Název balíčku („Microsoft.BingWeather“).
    name: String,
    /// Celý název balíčku (k odebrání).
    full_name: String,
    /// Rodina balíčku („Microsoft.BingWeather_8wekyb3d8bbwe“) – začátek AppID v nabídce Start
    /// (ikona) a stránka v Microsoft Storu (vrácení).
    family: String,
    /// Název, jak ho ukazují Windows (v jazyce systému).
    display_name: String,
    version: String,
    group: Group,
    recommended: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Found {
    name: String,
    full_name: String,
    family: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    version: String,
}

/// Znaky v názvech balíčků MSIX (do skriptu jdou stejně přes base64).
fn valid_package_text(text: &str) -> bool {
    !text.is_empty() && text.len() <= 200 && text.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'~'))
}

/// Skript ve vlastním procesu Windows PowerShellu (výstup v UTF-8). Ne ve sdíleném
/// (powershell.rs): ten předtím prochází nabídku Start přes Shell.Application a WinRT
/// PackageManager v témže procesu pak vrací prázdný seznam balíčků. Odebrání navíc trvá
/// i desítky sekund a sdílený PowerShell by mezitím blokoval výpis nainstalovaných.
fn run_script(script: &str, timeout: Duration) -> Result<String, String> {
    let script = format!("[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; $ProgressPreference = 'SilentlyContinue'; {script}");
    let encoded = BASE64.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>());
    let mut command = crate::process::hidden_command(&powershell_exe().to_string_lossy());
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
    let output = crate::process::run(command, timeout)?;
    if output.code != 0 {
        let last = output.stdout.lines().map(str::trim).rev().find(|l| !l.is_empty()).unwrap_or_default().to_string();
        return Err(format!("PowerShell skončil s chybou ({}): {last}", output.code));
    }
    Ok(output.stdout)
}

/// Balíčky ze seznamu nainstalované aktuálnímu uživateli. Název z Windows (WinRT
/// Package.DisplayName – v jazyce systému), bez knihoven a jazykových balíčků.
fn list() -> Result<Vec<Preinstalled>, String> {
    let names = KNOWN.iter().map(|k| ps_string(k.name)).collect::<Vec<_>>().join(", ");
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $names = @({names}); \
         $pm = [Windows.Management.Deployment.PackageManager, Windows.Management.Deployment, ContentType = WindowsRuntime]::new(); \
         foreach ($p in $pm.FindPackagesForUser('')) {{ \
           $id = $p.Id; \
           if (-not ($names -contains $id.Name) -or $p.IsFramework -or $p.IsResourcePackage) {{ continue }} \
           $display = try {{ [string]$p.DisplayName }} catch {{ '' }}; \
           $v = $id.Version; \
           [pscustomobject]@{{ name = [string]$id.Name; fullName = [string]$id.FullName; family = [string]$id.FamilyName; \
             displayName = $display; version = '' + $v.Major + '.' + $v.Minor + '.' + $v.Build + '.' + $v.Revision }} \
         }}"
    );
    let script = format!("$items = @({script}); ConvertTo-Json -InputObject $items -Compress -Depth 3");
    let stdout = run_script(&script, Duration::from_secs(60))?;
    let json = stdout.lines().map(str::trim).find(|line| line.starts_with('[')).unwrap_or("[]");
    let found: Vec<Found> = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let mut apps: Vec<Preinstalled> = found
        .into_iter()
        .filter(|f| valid_package_text(&f.full_name) && valid_package_text(&f.family))
        .filter_map(|f| {
            let known = known_by_name(&f.name)?;
            let display = f.display_name.trim();
            // Bez názvu z Windows (nebo nepřeložený odkaz na prostředek) název ze seznamu
            let display_name = if display.is_empty() || display.starts_with("ms-resource:") { known.label.to_string() } else { display.to_string() };
            Some(Preinstalled {
                name: known.name.to_string(),
                full_name: f.full_name,
                family: f.family,
                display_name,
                version: f.version,
                group: known.group,
                recommended: known.recommended,
            })
        })
        .collect();
    // Stejný balíček ve více verzích (čekající aktualizace ze Storu) jen jednou
    apps.sort_by(|a, b| a.name.cmp(&b.name).then(b.version.cmp(&a.version)));
    apps.dedup_by(|a, b| a.name == b.name);
    Ok(apps)
}

/// Předinstalované aplikace, které jde odebrat (jen ze seznamu KNOWN).
#[tauri::command]
pub async fn preinstalled_apps() -> Result<Vec<Preinstalled>, String> {
    background(list).await
}

/// Výsledek odebrání jednoho balíčku.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    name: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Výsledky z výstupu skriptu („@@ok <celý název>“, „@@err <celý název> <hláška>“).
fn parse_results(stdout: &str, targets: &[(String, String)]) -> Vec<Removed> {
    targets
        .iter()
        .map(|(name, full_name)| {
            let ok = stdout.lines().any(|line| line.trim() == format!("@@ok {full_name}"));
            let error = (!ok).then(|| {
                stdout
                    .lines()
                    .find_map(|line| line.trim().strip_prefix(&format!("@@err {full_name} ")).map(|m| m.trim().to_string()))
                    .unwrap_or_else(|| "Windows balíček neodebraly".to_string())
            });
            Removed { name: name.clone(), ok, error }
        })
        .collect()
}

/// Odebere vybrané předinstalované aplikace aktuálnímu uživateli. `names` jsou názvy balíčků
/// ze seznamu – co skutečně odebrat, zjistí backend sám (jen balíčky ze seznamu KNOWN,
/// které jsou nainstalované).
#[tauri::command]
pub async fn remove_preinstalled(names: Vec<String>) -> Result<Vec<Removed>, String> {
    background(move || {
        let installed = list()?;
        let targets: Vec<(String, String)> = installed
            .into_iter()
            .filter(|app| names.iter().any(|name| name.eq_ignore_ascii_case(&app.name)))
            .map(|app| (app.name, app.full_name))
            .collect();
        if targets.is_empty() {
            return Ok(Vec::new());
        }
        let list = targets.iter().map(|(_, full)| ps_string(full)).collect::<Vec<_>>().join(", ");
        let script = format!(
            "$ErrorActionPreference = 'Continue'; \
             foreach ($t in @({list})) {{ \
               try {{ Remove-AppxPackage -Package $t -ErrorAction Stop; Write-Output ('@@ok ' + $t) }} \
               catch {{ Write-Output ('@@err ' + $t + ' ' + ($_.Exception.Message -replace '\\s+', ' ')) }} \
             }}"
        );
        let stdout = run_script(&script, Duration::from_secs(600))?;
        Ok(parse_results(&stdout, &targets))
    })
    .await
}

/// Otevře stránku aplikace v Microsoft Storu (vrácení odebrané aplikace). Jen rodina
/// balíčku ze seznamu KNOWN („Microsoft.BingWeather_8wekyb3d8bbwe“).
#[tauri::command]
pub async fn preinstalled_store_page(family: String) -> Result<(), String> {
    let (name, publisher) = family.rsplit_once('_').ok_or("Neplatná rodina balíčku")?;
    if known_by_name(name).is_none() || !valid_package_text(&family) || publisher.is_empty() {
        return Err("Aplikace není v seznamu předinstalovaných".into());
    }
    crate::apps::open_uri(&format!("ms-windows-store://pdp/?PFN={family}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_list_is_safe() {
        // Součásti, které se odebrat nesmí (Store, winget, Herní panel, knihovny; Dev Home jsou
        // v nových Windows Pokročilá nastavení)
        for name in ["Microsoft.Windows.DevHome", "Microsoft.WindowsStore", "Microsoft.DesktopAppInstaller", "Microsoft.XboxGamingOverlay", "Microsoft.VCLibs.140.00", "Microsoft.WindowsCalculator", "Microsoft.Windows.Photos"] {
            assert!(known_by_name(name).is_none(), "{name}");
        }
        assert!(KNOWN.iter().all(|k| valid_package_text(k.name)));
        let mut names: Vec<String> = KNOWN.iter().map(|k| k.name.to_lowercase()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), KNOWN.len(), "zdvojený balíček v seznamu");
    }

    #[test]
    fn results() {
        let targets = vec![
            ("Microsoft.BingWeather".to_string(), "Microsoft.BingWeather_4.53_x64__8wekyb3d8bbwe".to_string()),
            ("king.com.CandyCrushSaga".to_string(), "king.com.CandyCrushSaga_1.0_x86__kgqvnymyfvs32".to_string()),
            ("Microsoft.GetHelp".to_string(), "Microsoft.GetHelp_10.0_x64__8wekyb3d8bbwe".to_string()),
        ];
        let stdout = "@@ok Microsoft.BingWeather_4.53_x64__8wekyb3d8bbwe\r\n@@err king.com.CandyCrushSaga_1.0_x86__kgqvnymyfvs32 Deployment failed 0x80073CFA\r\n";
        let results = parse_results(stdout, &targets);
        assert!(results[0].ok && results[0].error.is_none());
        assert_eq!(results[1].error.as_deref(), Some("Deployment failed 0x80073CFA"));
        assert!(!results[2].ok && results[2].error.is_some());
    }

    /// Skutečný výpis v tomto počítači: cargo test preinstalled::tests::live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live() {
        let apps = list().unwrap();
        for app in &apps {
            println!("{} | {} | {}", app.name, app.display_name, app.recommended);
        }
        assert!(apps.iter().all(|app| known_by_name(&app.name).is_some()));
    }

    /// Jako v aplikaci: sdílený PowerShell předtím prošel nabídku Start (Shell.Application) –
    /// ve stejném procesu by WinRT PackageManager vrátil prázdný seznam, proto vlastní proces.
    #[test]
    #[ignore]
    fn live_after_start_menu() {
        let start = crate::powershell::call(
            "foreach ($i in (New-Object -ComObject Shell.Application).NameSpace('shell:AppsFolder').Items()) { [string]$i.Name }",
            Duration::from_secs(60),
        )
        .unwrap();
        println!("nabídka Start: {}", start.as_array().map_or(0, Vec::len));
        let apps = list().unwrap();
        println!("předinstalované: {}", apps.len());
        assert!(!apps.is_empty());
    }

    #[test]
    fn package_text() {
        assert!(valid_package_text("Microsoft.BingWeather_4.53.50501.0_x64__8wekyb3d8bbwe"));
        assert!(!valid_package_text("a'; Remove-Item C:\\"));
        assert!(!valid_package_text(""));
    }
}
