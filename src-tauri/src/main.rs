// V produkčním sestavení bez okna konzole (jen okno aplikace)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Pomocný režim: HubGet spuštěný s právy správce kvůli jedné operaci
    // (viz elevation.rs) – provede ji a skončí, okno aplikace neotevírá.
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 && args[1] == unibox_lib::ELEVATED_FLAG {
        std::process::exit(unibox_lib::elevated_main(&args[2]));
    }
    // Povýšený pomocník pro celé spuštění HubGetu („požádat o práva správce jen jednou“)
    if args.len() == 3 && args[1] == unibox_lib::ELEVATED_SESSION_FLAG {
        std::process::exit(unibox_lib::elevated_session_main(&args[2]));
    }
    // Povýšený úklid zbytků po odinstalaci (Program Files, ProgramData, HKLM – viz leftovers.rs)
    if args.len() == 3 && args[1] == unibox_lib::ELEVATED_CLEANUP_FLAG {
        std::process::exit(unibox_lib::elevated_cleanup_main(&args[2]));
    }
    // Povýšená změna položky po spuštění (HKLM, společná složka, úlohy správce) a měření vlivu – startup.rs
    if args.len() == 3 && args[1] == unibox_lib::ELEVATED_STARTUP_FLAG {
        std::process::exit(unibox_lib::elevated_startup_main(&args[2]));
    }
    // Povýšené vytvoření bodu obnovení systému před hromadnou aktualizací – restore.rs
    if args.len() == 3 && args[1] == unibox_lib::ELEVATED_RESTORE_FLAG {
        std::process::exit(unibox_lib::elevated_restore_main(&args[2]));
    }
    // Příkaz `hubget` v terminálu (skript hubget.cmd): předá příkaz HubGetu a skončí – cli.rs
    if args.len() >= 2 && args[1] == unibox_lib::CLI_FLAG {
        std::process::exit(unibox_lib::cli_main(&args[2..]));
    }
    unibox_lib::run()
}
