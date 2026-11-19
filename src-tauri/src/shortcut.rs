//! Klávesová zkratka Win+Shift+H (Nastavení → Obecné): otevře HubGet odkudkoli –
//! i schovaný u hodin – a dá kurzor do vyhledávání (událost „focus-search“,
//! frontend hooks/useDesktopIntegration.ts). Zapíná / vypíná ji frontend podle
//! nastavení; když je zkratka obsazená jiným programem, vrátí chybu.

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyH)
}

/// Plugin s obsluhou zkratky: okno do popředí a fokus do vyhledávání.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, pressed, event| {
            if *pressed == shortcut() && event.state() == ShortcutState::Pressed {
                crate::tray::show_main_window(app);
                let _ = app.emit("focus-search", ());
            }
        })
        .build()
}

/// Zapne / vypne zkratku. Chyba = zkratku už používá jiný program.
#[tauri::command]
pub fn set_global_shortcut<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let registered = shortcuts.is_registered(shortcut());
    match (enabled, registered) {
        (true, false) => shortcuts.register(shortcut()).map_err(|e| e.to_string()),
        (false, true) => shortcuts.unregister(shortcut()).map_err(|e| e.to_string()),
        _ => Ok(()),
    }
}
