//! Vyzkoušet aplikaci ve Windows Sandboxu (detail aplikace z WinGetu): HubGet stáhne
//! instalátor přes `winget download` (winget ho ověří kontrolním součtem z manifestu)
//! do složky aplikace, připojí ji do Sandboxu jen pro čtení a po startu instalátor
//! spustí. Sandbox je oddělené Windows, které se po zavření celé zahodí – do počítače
//! se nic nedostane. Potřebuje Windows Pro / Enterprise se zapnutou funkcí Windows Sandbox.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

use crate::process::{self, background, hidden_command};
use crate::winget;

/// Program Windows Sandboxu (jen se zapnutou volitelnou funkcí).
fn sandbox_exe() -> PathBuf {
    let windows = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    windows.join("System32").join("WindowsSandbox.exe")
}

/// Je Windows Sandbox v počítači zapnutý?
#[tauri::command]
pub fn sandbox_available() -> bool {
    cfg!(windows) && sandbox_exe().is_file()
}

/// Složka uvnitř Sandboxu, kam se připojí stažený instalátor.
const SANDBOX_FOLDER: &str = r"C:\HubGet";

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// Příkaz, který instalátor v Sandboxu spustí (podle typu souboru).
fn install_command(installer: &Path) -> Option<String> {
    let file = installer.file_name()?.to_string_lossy().to_string();
    let inside = format!(r"{SANDBOX_FOLDER}\{file}");
    let extension = installer.extension()?.to_string_lossy().to_lowercase();
    Some(match extension.as_str() {
        "msi" => format!("msiexec.exe /i \"{inside}\""),
        "msix" | "msixbundle" | "appx" | "appxbundle" => {
            format!("powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Add-AppxPackage -Path '{inside}'\"")
        }
        "exe" => format!("\"{inside}\""),
        // Archiv (zip) – otevřít složku v Průzkumníku, aplikace se spustí ručně
        _ => format!("explorer.exe \"{SANDBOX_FOLDER}\""),
    })
}

/// Konfigurace Sandboxu: složka s instalátorem jen pro čtení, po přihlášení instalátor.
fn configuration(folder: &Path, command: &str) -> String {
    format!(
        "<Configuration>\r\n  <MappedFolders>\r\n    <MappedFolder>\r\n      <HostFolder>{}</HostFolder>\r\n      <SandboxFolder>{SANDBOX_FOLDER}</SandboxFolder>\r\n      <ReadOnly>true</ReadOnly>\r\n    </MappedFolder>\r\n  </MappedFolders>\r\n  <LogonCommand>\r\n    <Command>{}</Command>\r\n  </LogonCommand>\r\n</Configuration>\r\n",
        xml_escape(&folder.to_string_lossy()),
        xml_escape(command)
    )
}

/// Stažený instalátor ve složce (winget vedle něj ukládá manifest .yaml).
fn find_installer(folder: &Path) -> Option<PathBuf> {
    std::fs::read_dir(folder)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("yaml") || e.eq_ignore_ascii_case("wsb")))
        .max_by_key(|p| p.metadata().map(|m| m.len()).unwrap_or(0))
}

/// Stáhne instalátor aplikace a spustí ho ve Windows Sandboxu.
#[tauri::command]
pub async fn sandbox_try<R: Runtime>(app: AppHandle<R>, package_id: String) -> Result<(), String> {
    if !winget::safe_show_arg(&package_id) || winget::is_store_id(&package_id) {
        return Err(format!("Balíček {package_id} nejde stáhnout pro Sandbox"));
    }
    if !sandbox_available() {
        return Err("Windows Sandbox není zapnutý".into());
    }
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("sandbox");
    background(move || {
        // Jen poslední zkoušená aplikace – starší instalátory zbytečně zabírají místo
        let _ = std::fs::remove_dir_all(&root);
        let folder = root.join(crate::leftovers::safe_file_name(&package_id));
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let mut command = hidden_command(&winget::winget_exe());
        command.args(["download", "--id", &package_id, "--exact", "--source", "winget", "--download-directory"]);
        command.arg(&folder);
        command.args(["--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"]);
        let output = process::run(command, Duration::from_secs(15 * 60))?;
        let installer = find_installer(&folder).filter(|_| output.code == 0).ok_or_else(|| {
            let detail = output.stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or_default().trim().to_string();
            format!("Instalátor se nepodařilo stáhnout ({}): {detail}", output.code)
        })?;
        let run = install_command(&installer).ok_or("Neznámý typ instalátoru")?;
        let wsb = folder.join("HubGet.wsb");
        std::fs::write(&wsb, configuration(&folder, &run)).map_err(|e| e.to_string())?;
        std::process::Command::new(sandbox_exe()).arg(&wsb).spawn().map(|_| ()).map_err(|e| e.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prikaz_instalatoru() {
        assert_eq!(install_command(Path::new(r"C:\x\setup.MSI")).unwrap(), r#"msiexec.exe /i "C:\HubGet\setup.MSI""#);
        assert_eq!(install_command(Path::new(r"C:\x\App Setup.exe")).unwrap(), r#""C:\HubGet\App Setup.exe""#);
        assert!(install_command(Path::new(r"C:\x\app.msixbundle")).unwrap().contains("Add-AppxPackage -Path 'C:\\HubGet\\app.msixbundle'"));
        assert_eq!(install_command(Path::new(r"C:\x\portable.zip")).unwrap(), r#"explorer.exe "C:\HubGet""#);
    }

    #[test]
    fn konfigurace_je_platne_xml() {
        let text = configuration(Path::new(r"C:\Users\A&B\sandbox"), r#""C:\HubGet\a.exe""#);
        assert!(text.contains(r"<HostFolder>C:\Users\A&amp;B\sandbox</HostFolder>"));
        assert!(text.contains(r"<Command>&quot;C:\HubGet\a.exe&quot;</Command>"));
        assert!(text.contains("<ReadOnly>true</ReadOnly>"));
    }
}
