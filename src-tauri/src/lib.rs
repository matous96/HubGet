//! Backend HubGetu (Tauri 2).
//!
//! - `system` – architektura a verze Windows,
//! - `apps` – spouštění nainstalovaných aplikací (položky nabídky Start),
//! - `arp` – záznamy Programy a funkce: ověření, že program na disku opravdu je,
//! - `icons` – ikony s mezipamětí na disku (protokol icon://, ikony z EXE),
//! - `leftovers` – zbytky po odinstalaci v AppData (přesun do Koše),
//! - `oauth` – přihlášení v systémovém prohlížeči (návrat na 127.0.0.1),
//! - `secure_store` – šifrované uložení přihlášení (Windows DPAPI),
//! - `tray` – ikona v oznamovací oblasti a běh na pozadí,
//! - `process` – CLI motor (skryté spouštění, výstup po řádcích, zrušení),
//! - `download` – stažení instalátoru předem přes curl.exe s průběhem,
//! - `elevation` – spuštění s právy správce (UAC) přes pomocný proces,
//! - `files` – uložení exportu přes dialog „Uložit jako“,
//! - `powershell` – trvale běžící PowerShell pro modul Microsoft.WinGet.Client,
//! - `operations` – fronta operací nad balíčky,
//! - `progress` – fáze a procenta operace (i když správce průběh nevypisuje),
//! - `winget` – správce balíčků winget,
//! - `choco` – Chocolatey (stav, nainstalované balíčky z jeho manifestů, operace),
//! - `scoop` – Scoop (stav, nainstalované aplikace ze složek Scoopu, operace),
//! - `dev` – správci pro vývojáře (npm, Bun, pip, Cargo, vcpkg, .NET Tool, PowerShell 7 a 5.1),
//! - `security` – oprávnění správce a nebezpečná nastavení (povýšení, vlastní argumenty, cesty),
//! - `running` – běžící procesy aplikace (zavření před aktualizací, když aplikace běží),
//! - `startup` – aplikace po spuštění (registr Run, složky Po spuštění, plánovač, vliv na start),
//! - `tracker` – sledování instalace (snímek disku a registru) pro čisté odinstalování.
//!
//! Správci pro vývojáře přibudou ve stejné podobě.

mod apps;
mod arp;
mod choco;
mod dev;
mod disk;
mod download;
mod elevation;
mod files;
mod icons;
mod leftovers;
mod oauth;
mod operations;
mod powershell;
mod process;
mod progress;
mod publish;
mod running;
mod scoop;
mod secure_store;
mod security;
mod startup;
mod system;
mod tracker;
mod tray;
mod version_info;
mod winget;

pub use elevation::{helper_main as elevated_main, session_main as elevated_session_main, ELEVATED_FLAG, ELEVATED_SESSION_FLAG};
pub use leftovers::{elevated_cleanup_main, ELEVATED_CLEANUP_FLAG};
pub use startup::{elevated_startup_main, ELEVATED_STARTUP_FLAG};

/// Příznak spuštění při startu Windows (zapisuje ho tauri-plugin-autostart do registru).
const AUTOSTART_FLAG: &str = "--autostart";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Musí být první: druhé spuštění HubGetu jen ukáže už běžící okno
        // (odkaz unibox://, kterým bylo spuštěné, předá běžícímu přes deep-link)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main_window(app)))
        // Odkazy unibox:// z webu a sdílených sad – zpracuje je frontend (lib/deepLink.ts)
        .plugin(tauri_plugin_deep_link::init())
        // Otevírání odkazů v systémovém prohlížeči a e-mailovém klientovi
        .plugin(tauri_plugin_opener::init())
        // Systémové dialogy (Uložit jako) – volá je jen backend (files.rs)
        .plugin(tauri_plugin_dialog::init())
        // Aktualizace HubGetu: latest.json z GitHub Releases, ověření podpisu, instalace
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Restart po instalaci aktualizace
        .plugin(tauri_plugin_process::init())
        // Oznámení Windows (výsledky operací, nalezené aktualizace) – podle Nastavení → Oznámení
        .plugin(tauri_plugin_notification::init())
        // Spouštění při startu Windows – s příznakem, aby se HubGet spustil schovaný u hodin
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        // Ikony aplikací s mezipamětí na disku (http://icon.localhost/…)
        .register_asynchronous_uri_scheme_protocol(icons::SCHEME, icons::handle)
        .setup(|app| {
            tray::setup(app.handle())?;
            // Testovací verze: „HubGet (test)“ a oranžová ikona s nápisem „test“ na hlavním panelu
            // (popisek a ikonu u hodin nastaví tray)
            if tray::is_test_build(app.handle()) {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title(&tray::display_name(app.handle(), "HubGet"));
                    if let Some(icon) = tray::test_window_icon() {
                        let _ = window.set_icon(icon);
                    }
                }
            }
            // Obsluha odkazů hubget:// a unibox:// (dřívější název) pro tento HubGet (HKCU, bez práv správce). Instalátor ji
            // zapíše sám; tady kvůli vývojové verzi a přenosnému spuštění. Selhání start nezastaví.
            #[cfg(windows)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register_all() {
                    eprintln!("Odkazy hubget:// a unibox:// se nepodařilo zaregistrovat: {error}");
                }
            }
            // Okno se vytváří skryté: po spuštění s Windows zůstane jen ikona u hodin
            if !std::env::args().any(|arg| arg == AUTOSTART_FLAG) {
                tray::show_main_window(app.handle());
            }
            winget::warm_up();
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            system::system_info,
            apps::start_apps,
            apps::launch_app,
            apps::launch_info,
            apps::launch_installed,
            tray::set_close_to_tray,
            tray::set_tray_labels,
            tray::set_tray_status,
            operations::cancel_operation,
            operations::elevated_batch_begin,
            operations::elevated_batch_end,
            oauth::oauth_listen,
            oauth::oauth_wait,
            oauth::oauth_cancel,
            secure_store::secure_get,
            secure_store::secure_set,
            secure_store::secure_remove,
            files::save_text_file,
            leftovers::leftover_scan,
            leftovers::remove_leftovers,
            winget::winget_status,
            winget::winget_setup,
            winget::winget_installed,
            winget::winget_search,
            winget::winget_versions,
            winget::winget_cache,
            winget::winget_clear_cache,
            winget::winget_operation,
            winget::winget_installer_url,
            choco::choco_outdated,
            choco::choco_status,
            choco::choco_installed,
            choco::choco_search,
            choco::choco_versions,
            choco::choco_setup,
            choco::choco_operation,
            scoop::scoop_status,
            scoop::scoop_installed,
            scoop::scoop_refresh_buckets,
            scoop::scoop_search,
            scoop::scoop_versions,
            scoop::scoop_setup,
            scoop::scoop_operation,
            dev::dev_status,
            dev::dev_installed,
            dev::dev_search,
            dev::dev_versions,
            dev::dev_setup,
            dev::dev_operation,
            security::set_security_policy,
            security::check_manager_path,
            system::power_network_status,
            system::devolutions_agent_status,
            running::app_processes,
            running::close_processes,
            running::end_processes,
            startup::startup_items,
            startup::startup_set_enabled,
            startup::startup_delete,
            startup::startup_measure_impact,
            tracker::trace_begin,
            tracker::trace_end,
            tracker::trace_discard,
            tracker::install_traces,
            tracker::forget_trace,
            publish::publish_analyze_installer,
            publish::publish_validate_manifest,
            publish::publish_save_manifest,
            publish::github_device_start,
            publish::github_device_poll,
        ])
        .run(tauri::generate_context!())
        .expect("HubGet se nepodařilo spustit");
}
