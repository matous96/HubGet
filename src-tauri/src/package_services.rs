//! Dokončení aktualizace MSIX, kterou Windows odložily (winget.rs): když balíček používá běžící
//! aplikace – u ChatGPT (balíček OpenAI.Codex) vlastní služba Windows, kterou Windows při nasazení
//! samy spustí – registrace nové verze skončí 0x80073D02 a winget ji odloží („Restart the
//! application to complete the upgrade“): nová verze je připravená ve WindowsApps a použije se až
//! po restartu. Winget registraci s vynuceným zavřením aplikace nikdy nepoužívá, HubGet ji proto
//! dokončí sám: připravený balíček zjistí z protokolu nasazení (událost 638 „Directly serviced
//! packages“) a zaregistruje ho s právy správce přes Add-AppxPackage -ForceApplicationShutdown.
//!
//! Bezpečnost: povýšený pomocník přijme jedině přesně tento příkaz PowerShellu a jen pro balíček,
//! který už leží v „C:\Program Files\WindowsApps\“ (podepsaný, nainstalovaný Windows) –
//! `is_register_command` se ověřuje i v povýšeném procesu.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::process::system_tool;

/// Složka s balíčky MSIX.
fn windows_apps() -> PathBuf {
    let program_files = std::env::var_os("ProgramW6432").or_else(|| std::env::var_os("ProgramFiles")).unwrap_or_else(|| r"C:\Program Files".into());
    PathBuf::from(program_files).join("WindowsApps")
}

/// Úplné jméno balíčku „Název_Verze_Architektura__IdVydavatele“ (OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0).
fn is_full_name(name: &str) -> bool {
    let Some((head, publisher)) = name.split_once("__") else { return false };
    let mut parts = head.split('_');
    let (Some(package), Some(version), Some(arch), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else { return false };
    !package.is_empty()
        && package.len() <= 64
        && package.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !version.is_empty()
        && version.chars().all(|c| c.is_ascii_digit() || c == '.')
        && matches!(arch.to_ascii_lowercase().as_str(), "x64" | "x86" | "arm64" | "arm" | "neutral")
        && publisher.len() == 13
        && publisher.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Verze z úplného jména balíčku.
fn version_of(full_name: &str) -> Option<&str> {
    full_name.split('_').nth(1)
}

/// Připravené balíčky ze zpráv o odložené registraci („Directly serviced packages: {A B}“) –
/// jen úplná jména s nabízenou verzí aplikace.
fn deferred_in(messages: &str, version: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in messages.lines().filter(|l| l.contains("Directly serviced packages")) {
        let Some(start) = line.find("Directly serviced packages: {") else { continue };
        let rest = &line[start + "Directly serviced packages: {".len()..];
        let list = rest.split('}').next().unwrap_or_default();
        for name in list.split_whitespace().filter(|n| is_full_name(n) && version_of(n).is_some_and(|v| v.eq_ignore_ascii_case(version))) {
            if !found.iter().any(|f: &String| f.eq_ignore_ascii_case(name)) {
                found.push(name.to_string());
            }
        }
    }
    found
}

/// Balíčky, jejichž registraci Windows za posledních `seconds` sekund odložily, s verzí `version`.
pub(crate) fn deferred_packages(seconds: u64, version: &str) -> Vec<String> {
    let script = format!(
        "Get-WinEvent -FilterHashtable @{{ LogName = 'Microsoft-Windows-AppXDeploymentServer/Operational'; Id = 638; StartTime = (Get-Date).AddSeconds(-{seconds}) }} -ErrorAction SilentlyContinue | ForEach-Object {{ $_.Message -replace '\\s+', ' ' }}"
    );
    crate::preinstalled::run_script(&script, Duration::from_secs(30)).map(|out| deferred_in(&out, version)).unwrap_or_default()
}

/// Příkaz registrace připraveného balíčku (pro povýšený běh).
fn register_script(full_name: &str) -> String {
    let manifest = windows_apps().join(full_name).join("AppxManifest.xml");
    format!("Add-AppxPackage -DisableDevelopmentMode -ForceApplicationShutdown -Register '{}'", manifest.display())
}

pub(crate) fn register_command(full_name: &str) -> (String, Vec<String>) {
    let program = system_tool(r"WindowsPowerShell\v1.0\powershell.exe").to_string_lossy().to_string();
    (program, vec!["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), register_script(full_name)])
}

/// Smí povýšený pomocník spustit tento příkaz? Jen systémový powershell.exe s přesně tímto
/// příkazem a jen pro připravený balíček, který leží ve WindowsApps.
pub(crate) fn is_register_command(program: &str, args: &[String]) -> bool {
    let expected = system_tool(r"WindowsPowerShell\v1.0\powershell.exe");
    if !Path::new(program).to_string_lossy().eq_ignore_ascii_case(&expected.to_string_lossy()) {
        return false;
    }
    let [no_profile, non_interactive, command, script] = args else { return false };
    if no_profile != "-NoProfile" || non_interactive != "-NonInteractive" || command != "-Command" {
        return false;
    }
    let prefix = format!("Add-AppxPackage -DisableDevelopmentMode -ForceApplicationShutdown -Register '{}\\", windows_apps().display());
    let Some(rest) = script.strip_prefix(&prefix).and_then(|r| r.strip_suffix("\\AppxManifest.xml'")) else { return false };
    is_full_name(rest) && *script == register_script(rest) && windows_apps().join(rest).join("AppxManifest.xml").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn odlozena_registrace() {
        let messages = "Packages were not updated because affected apps are still running. Running apps: {OpenAI.Codex_2p2nqsd0c76g0!App}, Directly serviced packages: {OpenAI.Codex_26.1117.3838.0_x64__2p2nqsd0c76g0 OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0}, Indirectly serviced packages: {NULL}\n\
                        Packages were not updated because affected apps are still running. Running apps: {X}, Directly serviced packages: {OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0}, Indirectly serviced packages: {NULL}";
        assert_eq!(deferred_in(messages, "26.1117.4957.0"), ["OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0"]);
        assert!(deferred_in(messages, "1.0").is_empty());
    }

    #[test]
    fn uplne_jmeno_balicku() {
        assert!(is_full_name("OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0"));
        assert!(!is_full_name("OpenAI.Codex_26.1117.4957.0_x64__2p2nq'; calc"));
        assert!(!is_full_name("..\\..\\Windows_1.0_x64__2p2nqsd0c76g0"));
        assert!(!is_full_name("OpenAI.Codex"));
    }

    #[test]
    fn povyseni_jen_pro_pripraveny_balicek() {
        let (program, args) = register_command("OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0");
        assert!(args[3].ends_with(r"\OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0\AppxManifest.xml'"));
        // Jiný program nebo jiný příkaz – nikdy
        assert!(!is_register_command(r"C:\evil\powershell.exe", &args));
        let mut evil = args.clone();
        evil[3] = format!("{}; Remove-Item C:\\ -Recurse", args[3]);
        assert!(!is_register_command(&program, &evil));
        // Balíček, který ve WindowsApps není (bez povýšení složku nevidíme – v testu nikdy není)
        let (program, args) = register_command("Neexistuje.Balicek_1.0.0.0_x64__abcdefghijklm");
        assert!(!is_register_command(&program, &args));
    }
}
