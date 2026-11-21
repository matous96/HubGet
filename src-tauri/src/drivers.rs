//! Ovladače z Windows Update (Přehled počítače → Ovladače): které ovladače Windows Update
//! nabízí a nejsou nainstalované (COM Microsoft.Update.Session, hledání bez práv správce).
//! Instaluje je Windows Update sám – HubGet otevře Volitelné aktualizace v Nastavení, kde je
//! uživatel vybere (ovladač ovlivní hardware, přehled a vrácení má jen Windows).

use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::process::background;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverUpdate {
    title: String,
    #[serde(default)]
    manufacturer: String,
    /// Druh zařízení (Display, Net, AudioEndpoint…).
    #[serde(default)]
    class: String,
    #[serde(default)]
    model: String,
    /// Datum verze ovladače (RRRR-MM-DD).
    #[serde(default)]
    date: String,
    /// Velikost ke stažení (bajty).
    #[serde(default)]
    size: u64,
}

const SCRIPT: &str = "$ErrorActionPreference = 'Stop'; \
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; \
    $session = New-Object -ComObject Microsoft.Update.Session; \
    $searcher = $session.CreateUpdateSearcher(); \
    $result = $searcher.Search(\"IsInstalled=0 and Type='Driver' and IsHidden=0\"); \
    $items = @(foreach ($u in $result.Updates) { [pscustomobject]@{ \
      title = [string]$u.Title; manufacturer = [string]$u.DriverManufacturer; class = [string]$u.DriverClass; \
      model = [string]$u.DriverModel; date = $(if ($u.DriverVerDate) { ([datetime]$u.DriverVerDate).ToString('yyyy-MM-dd') } else { '' }); \
      size = [int64]$u.MaxDownloadSize } }); \
    ConvertTo-Json -InputObject $items -Compress";

/// Ovladače, které nabízí Windows Update. Hledání se ptá serverů Windows Update – trvá až minuty,
/// proto vlastní proces PowerShellu (sdílený by mezitím blokoval výpis nainstalovaných).
#[tauri::command]
pub async fn driver_updates() -> Result<Vec<DriverUpdate>, String> {
    background(|| {
        let mut command = crate::process::hidden_command(&crate::powershell::powershell_exe().to_string_lossy());
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT]);
        let output = crate::process::run(command, Duration::from_secs(300))?;
        if output.code != 0 {
            return Err("Windows Update se nepodařilo prohledat (služba vypnutá nebo bez připojení)".into());
        }
        let json = output.stdout.lines().map(str::trim).find(|l| l.starts_with('[')).unwrap_or("[]");
        let mut updates: Vec<DriverUpdate> = serde_json::from_str(json).map_err(|e| e.to_string())?;
        updates.sort_by(|a, b| a.class.cmp(&b.class).then(a.title.cmp(&b.title)));
        Ok(updates)
    })
    .await
}

/// Otevře Volitelné aktualizace ve Windows Update (tam jsou nabízené ovladače).
#[tauri::command]
pub async fn open_driver_updates() -> Result<(), String> {
    crate::apps::open_uri("ms-settings:windowsupdate-optionalupdates")
}
