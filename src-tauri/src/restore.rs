//! Bod obnovení systému před hromadnou aktualizací (Nastavení → Aktualizace
//! balíčků, jen u ručního „Aktualizovat vše“ – na pozadí by čekal dialog UAC).
//!
//! Bod vytvoří HubGet spuštěný s právy správce v pomocném režimu
//! (`--unibox-elevated-restore-point`) pevným příkazem PowerShellu – z okna
//! aplikace přichází jen popis, který pomocník znovu ověří. Windows vytvoří
//! nejvýš jeden bod za 24 hodin (jinak tiše nic) a s vypnutou Ochranou
//! systému žádný – obojí se hlásí zvlášť.

use serde::Serialize;

use crate::process::{background, hidden_command, system_tool};

pub const ELEVATED_RESTORE_FLAG: &str = "--unibox-elevated-restore-point";

/// Výsledek vytvoření bodu obnovení.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RestorePoint {
    /// Bod obnovení vytvořen.
    Created,
    /// Windows nový bod nevytvořil – poslední je mladší než 24 hodin.
    Recent,
    /// Ochrana systému je vypnutá.
    Disabled,
    /// Dialog UAC odmítnut.
    Cancelled,
    Failed,
}

/// Popis bodu obnovení: jen písmena, číslice, mezery a běžná interpunkce, nejvýš 60 znaků
/// (vkládá se do příkazu PowerShellu v apostrofech).
fn safe_description(text: &str) -> Option<String> {
    let text = text.trim();
    let ok = !text.is_empty()
        && text.chars().count() <= 60
        && text.chars().all(|c| c.is_alphanumeric() || " .,:-()".contains(c));
    ok.then(|| text.to_string())
}

/// Návratové kódy pomocníka.
const CODE_CREATED: i32 = 0;
const CODE_RECENT: i32 = 2;
const CODE_DISABLED: i32 = 3;

/// Vytvoří bod obnovení (jedno potvrzení UAC).
#[tauri::command]
pub async fn create_restore_point(description: String) -> Result<RestorePoint, String> {
    let description = safe_description(&description).ok_or("Neplatný popis bodu obnovení")?;
    background(move || {
        Ok(match crate::elevation::run_self_elevated(ELEVATED_RESTORE_FLAG, &description.replace(' ', "_"))? {
            None => RestorePoint::Cancelled,
            Some(code) => match code as i32 {
                CODE_CREATED => RestorePoint::Created,
                CODE_RECENT => RestorePoint::Recent,
                CODE_DISABLED => RestorePoint::Disabled,
                _ => RestorePoint::Failed,
            },
        })
    })
    .await
}

/// Vstupní bod povýšeného pomocníka: vytvoří bod obnovení a vrátí kód výsledku.
pub fn elevated_restore_main(payload: &str) -> i32 {
    let Some(description) = safe_description(&payload.replace('_', " ")) else {
        return -1;
    };
    // Počet bodů před a po – Checkpoint-Computer při limitu 24 hodin jen varuje, nic nevytvoří
    let script = format!(
        "$ErrorActionPreference = 'Stop'; try {{ $before = @(Get-ComputerRestorePoint).Count; \
         Checkpoint-Computer -Description '{description}' -RestorePointType MODIFY_SETTINGS -WarningAction SilentlyContinue; \
         if (@(Get-ComputerRestorePoint).Count -gt $before) {{ exit {CODE_CREATED} }} else {{ exit {CODE_RECENT} }} }} \
         catch {{ exit {CODE_DISABLED} }}"
    );
    let mut command = hidden_command(&system_tool(r"WindowsPowerShell\v1.0\powershell.exe").to_string_lossy());
    command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script]);
    match command.status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(_) => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popis_bodu_obnoveni() {
        assert_eq!(safe_description(" Před aktualizací HubGet (5 aplikací) "), Some("Před aktualizací HubGet (5 aplikací)".into()));
        assert_eq!(safe_description("x'; Remove-Item C:\\ -Recurse; '"), None);
        assert_eq!(safe_description(""), None);
        assert_eq!(safe_description(&"a".repeat(61)), None);
    }
}
