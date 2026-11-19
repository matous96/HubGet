//! Ikona v oznamovací oblasti (u hodin) a běh na pozadí.
//!
//! - Ikonu vytvoří Tauri z `tauri.conf.json` (`app.trayIcon`): jednobarevná
//!   verze loga na průhledném pozadí (`icons/tray.png`, 64 × 64, zdroj
//!   `assets/tray-icon.svg`, v krabici nápis „hubget“, u testovací verze „test“) – vypadá
//!   jako systémové ikony Windows. Na světlém hlavním panelu se přepne na tmavou variantu.
//!   Předloha se zmenší přesně na velikost ikon v oznamovací oblasti (16 px × měřítko
//!   Windows: 24 px při 150 %, 32 px při 200 %) – Windows ji pak už neškáluje.
//! - Stav je barevná tečka vpravo nahoře (`set_tray_status`, dole by zakryla nápis): modrá = probíhá
//!   instalace / aktualizace, červená = chyba, zelená = hotovo, oranžová = čekají
//!   aktualizace. Frontend posílá Idle, když je tečka v Nastavení vypnutá.
//! - Zavření okna ho jen schová, HubGet běží dál (fronta instalací doběhne);
//!   lze vypnout v Nastavení (`set_close_to_tray`).
//! - Levé tlačítko na ikoně okno ukáže. Pravé otevře nabídku po vzoru UniGetUI:
//!   Procházet balíčky, Dostupné aktualizace, Nainstalované | Zobrazit HubGet,
//!   Ukončit. Rychlé odkazy ukážou okno a frontendu pošlou stránku (událost
//!   `tray-navigate`).
//! - Texty nabídky a popisek (s počtem aktualizací) posílá frontend v jazyce
//!   aplikace (`set_tray_labels`).

use image::{imageops, RgbaImage};
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};

/// Stejné id jako `app.trayIcon.id` v tauri.conf.json.
const TRAY_ID: &str = "main";
const SHOW_ID: &str = "show";
const QUIT_ID: &str = "quit";

/// Rychlé odkazy v nabídce: id položky → stránka aplikace.
const PAGES: &[(&str, &str)] = &[
    ("browse", "/"),
    ("updates", "/installed?filter=updates"),
    ("installed", "/installed"),
];

/// Texty nabídky a popisek ikony (v jazyce aplikace, posílá frontend).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    browse: String,
    updates: String,
    installed: String,
    show: String,
    quit: String,
    tooltip: String,
}

impl Default for TrayLabels {
    fn default() -> Self {
        TrayLabels {
            browse: "Procházet balíčky".into(),
            updates: "Dostupné aktualizace".into(),
            installed: "Nainstalované".into(),
            show: "Zobrazit HubGet".into(),
            quit: "Ukončit".into(),
            tooltip: "HubGet".into(),
        }
    }
}

/// Bílá ikona (tmavý hlavní panel) a tmavá (světlý hlavní panel) – předlohy 64 × 64.
const ICON_LIGHT: &[u8] = include_bytes!("../icons/tray.png");
const ICON_DARK: &[u8] = include_bytes!("../icons/tray-dark.png");
/// Testovací verze: plná krabice s nápisem „test“ (zdroj `assets/tray-icon-test.svg`).
const ICON_TEST_LIGHT: &[u8] = include_bytes!("../icons/tray-test.png");
const ICON_TEST_DARK: &[u8] = include_bytes!("../icons/tray-test-dark.png");

/// Stav operací na ikoně (posílá frontend podle fronty úloh).
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum TrayStatus {
    #[default]
    Idle,
    /// Probíhá instalace / aktualizace / odinstalace.
    Busy,
    /// Poslední operace selhala.
    Error,
    /// Operace doběhly v pořádku.
    Done,
    /// Nic neběží a jsou k dispozici aktualizace.
    Updates,
}

impl TrayStatus {
    /// Barva tečky (RGB), None = bez tečky.
    fn color(self) -> Option<[u8; 3]> {
        match self {
            TrayStatus::Idle => None,
            TrayStatus::Busy => Some([0x3B, 0x82, 0xF6]),
            TrayStatus::Error => Some([0xEF, 0x44, 0x44]),
            TrayStatus::Done => Some([0x22, 0xC5, 0x5E]),
            TrayStatus::Updates => Some([0xF9, 0x73, 0x16]),
        }
    }
}

static STATUS: Mutex<TrayStatus> = Mutex::new(TrayStatus::Idle);

/// Zavřít okno = schovat do oznamovací oblasti (výchozí), nebo ukončit aplikaci.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

/// Testovací (vývojová) verze – identifikátor končí „.dev“ (src-tauri/tauri.dev.conf.json).
pub fn is_test_build<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.config().identifier.ends_with(".dev")
}

/// „HubGet“ v titulku okna a popisku ikony; u testovací verze „HubGet (test)“, ať nejde
/// zaměnit s nainstalovaným HubGetem, který běží vedle.
pub fn display_name<R: Runtime>(app: &AppHandle<R>, text: &str) -> String {
    if is_test_build(app) {
        text.replacen("HubGet", "HubGet (test)", 1)
    } else {
        text.to_string()
    }
}

/// Připojí nabídku a obsluhu kliknutí k ikoně z konfigurace (texty zatím
/// česky, frontend je hned přepíše). Bez ikony v konfiguraci ji vytvoří.
pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(tray) => tray,
        None => TrayIconBuilder::with_id(TRAY_ID).build(app)?,
    };
    tray.set_tooltip(Some(display_name(app, "HubGet")))?;
    tray.set_menu(Some(menu(app, &TrayLabels::default())?))?;
    tray.set_show_menu_on_left_click(false)?;
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        SHOW_ID => show_main_window(app),
        QUIT_ID => app.exit(0),
        id => {
            if let Some((_, path)) = PAGES.iter().find(|(page, _)| *page == id) {
                show_main_window(app);
                let _ = app.emit("tray-navigate", *path);
            }
        }
    });
    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            show_main_window(tray.app_handle());
        }
    });
    apply_icon(&tray);
    Ok(())
}

fn menu<R: Runtime>(app: &AppHandle<R>, labels: &TrayLabels) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    Menu::with_items(
        app,
        &[
            &item("browse", &labels.browse)?,
            &item("updates", &labels.updates)?,
            &item("installed", &labels.installed)?,
            &PredefinedMenuItem::separator(app)?,
            &item(SHOW_ID, &labels.show)?,
            &item(QUIT_ID, &labels.quit)?,
        ],
    )
}

/// Nastaví ikonu: barva podle hlavního panelu (bílá na tmavém, tmavá na světlém),
/// velikost podle měřítka Windows a tečka podle stavu operací.
fn apply_icon<R: Runtime>(tray: &TrayIcon<R>) {
    // Testovací verze má v krabici nápis „test“ místo „hubget“
    let master = match (is_test_build(tray.app_handle()), taskbar_is_light()) {
        (false, false) => ICON_LIGHT,
        (false, true) => ICON_DARK,
        (true, false) => ICON_TEST_LIGHT,
        (true, true) => ICON_TEST_DARK,
    };
    let status = *STATUS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(icon) = render_icon(master, tray_icon_size(), status) {
        let _ = tray.set_icon(Some(Image::new_owned(icon.as_raw().clone(), icon.width(), icon.height())));
    }
}

/// Ikona okna testovací verze (hlavní panel, Alt+Tab): oranžové logo s nápisem „test“
/// (zdroj `assets/unibox-test.svg`), ať nejde zaměnit s nainstalovaným HubGetem.
const WINDOW_ICON_TEST: &[u8] = include_bytes!("../icons/window-test.png");

/// Ikona okna testovací verze zmenšená na velké ikony Windows (32 px × měřítko) –
/// hlavní panel ji pak už neškáluje z 256 px.
pub fn test_window_icon() -> Option<Image<'static>> {
    let master = image::load_from_memory(WINDOW_ICON_TEST).ok()?.to_rgba8();
    let size = window_icon_size();
    let icon = imageops::resize(&master, size, size, imageops::FilterType::Lanczos3);
    Some(Image::new_owned(icon.into_raw(), size, size))
}

/// Velikost velkých ikon (okno, hlavní panel) v pixelech.
#[cfg(windows)]
fn window_icon_size() -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXICON};
    // SAFETY: GetSystemMetrics jen čte systémovou hodnotu
    let size = unsafe { GetSystemMetrics(SM_CXICON) };
    if (16..=256).contains(&size) { size as u32 } else { 48 }
}

#[cfg(not(windows))]
fn window_icon_size() -> u32 {
    48
}

/// Velikost ikon v oznamovací oblasti v pixelech (16 × měřítko Windows).
#[cfg(windows)]
fn tray_icon_size() -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};
    // SAFETY: GetSystemMetrics jen čte systémovou hodnotu
    let size = unsafe { GetSystemMetrics(SM_CXSMICON) };
    if (16..=64).contains(&size) { size as u32 } else { 32 }
}

#[cfg(not(windows))]
fn tray_icon_size() -> u32 {
    32
}

/// Poloměr tečky stavu a její odstup od okraje (podíl velikosti ikony).
const DOT_RADIUS: f32 = 0.22;
const DOT_MARGIN: f32 = 0.02;

/// Zmenší předlohu na `size` × `size` a vpravo nahoře (místo pravé aplikace, nápis v krabici
/// zůstane) přidá tečku stavu s průhledným lemem, aby se oddělila od kresby (vyhlazené okraje).
fn render_icon(master_png: &[u8], size: u32, status: TrayStatus) -> Option<RgbaImage> {
    let master = image::load_from_memory(master_png).ok()?.to_rgba8();
    let mut icon = imageops::resize(&master, size, size, imageops::FilterType::Lanczos3);
    let Some([r, g, b]) = status.color() else { return Some(icon) };

    let s = size as f32;
    let radius = s * DOT_RADIUS;
    let gap = (s * 0.07).max(1.0);
    let center_x = s - radius - s * DOT_MARGIN;
    let center_y = radius + s * DOT_MARGIN;
    for (x, y, pixel) in icon.enumerate_pixels_mut() {
        let distance = ((x as f32 + 0.5 - center_x).powi(2) + (y as f32 + 0.5 - center_y).powi(2)).sqrt();
        // Lem: kresba pod ním zmizí (podíl pokrytí pixelu kvůli vyhlazení)
        let cut = (radius + gap + 0.5 - distance).clamp(0.0, 1.0);
        let base_alpha = pixel[3] as f32 / 255.0 * (1.0 - cut);
        let dot = (radius + 0.5 - distance).clamp(0.0, 1.0);
        let alpha = dot + base_alpha * (1.0 - dot);
        if alpha <= 0.0 {
            *pixel = image::Rgba([0, 0, 0, 0]);
            continue;
        }
        let mix = |dot_channel: u8, base_channel: u8| {
            ((dot_channel as f32 * dot + base_channel as f32 * base_alpha * (1.0 - dot)) / alpha).round() as u8
        };
        *pixel = image::Rgba([mix(r, pixel[0]), mix(g, pixel[1]), mix(b, pixel[2]), (alpha * 255.0).round() as u8]);
    }
    Some(icon)
}

/// Má hlavní panel světlý motiv? (Nastavení → Přizpůsobení → Barvy → režim Windows)
#[cfg(windows)]
fn taskbar_is_light() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    winreg::RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|key| key.get_value::<u32, _>("SystemUsesLightTheme"))
        .is_ok_and(|value| value == 1)
}

#[cfg(not(windows))]
fn taskbar_is_light() -> bool {
    false
}

/// Ukáže hlavní okno (i z minimalizace) a přepne na něj.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Ukáže hlavní okno z frontendu (klik na oznámení Windows nebo jeho tlačítko).
#[tauri::command]
pub fn show_window<R: Runtime>(app: AppHandle<R>) {
    show_main_window(&app);
}

/// Zavření okna: schovat do oznamovací oblasti místo ukončení.
/// Změna motivu Windows: přebarvit ikonu podle hlavního panelu.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::SeqCst) => {
            api.prevent_close();
            let _ = window.hide();
        }
        WindowEvent::ThemeChanged(_) => {
            if let Some(tray) = window.app_handle().tray_by_id(TRAY_ID) {
                apply_icon(&tray);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::SeqCst);
}

/// Texty nabídky a popisek ikony v jazyce aplikace.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, labels: TrayLabels) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("Ikona v oznamovací oblasti chybí")?;
    tray.set_menu(Some(menu(&app, &labels).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(display_name(&app, &labels.tooltip))).map_err(|e| e.to_string())
}

/// Stav operací – barevná tečka na ikoně (při stejném stavu se ikona nepřekresluje).
#[tauri::command]
pub fn set_tray_status(app: AppHandle, status: TrayStatus) -> Result<(), String> {
    {
        let mut current = STATUS.lock().unwrap_or_else(|e| e.into_inner());
        if *current == status {
            return Ok(());
        }
        *current = status;
    }
    let tray = app.tray_by_id(TRAY_ID).ok_or("Ikona v oznamovací oblasti chybí")?;
    apply_icon(&tray);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_dot_in_corner() {
        for size in [16, 24, 32] {
            for master in [ICON_LIGHT, ICON_TEST_LIGHT] {
                let plain = render_icon(master, size, TrayStatus::Idle).unwrap();
                assert_eq!(plain.dimensions(), (size, size));
                let busy = render_icon(master, size, TrayStatus::Busy).unwrap();
                // Střed tečky vpravo nahoře má barvu stavu a je neprůhledný
                let x = (size as f32 * (1.0 - DOT_RADIUS - DOT_MARGIN)) as u32;
                let y = (size as f32 * (DOT_RADIUS + DOT_MARGIN)) as u32;
                let pixel = busy.get_pixel(x, y);
                assert_eq!((pixel[0], pixel[1], pixel[2], pixel[3]), (0x3B, 0x82, 0xF6, 255), "velikost {size}");
                // Krabice s nápisem dole zůstane beze změny
                assert_eq!(busy.get_pixel(size / 2, size - 3), plain.get_pixel(size / 2, size - 3));
                assert_eq!(busy.get_pixel(x, size - 3), plain.get_pixel(x, size - 3));
            }
        }
        // Náhled ikon pro kontrolu očima: UNIBOX_TRAY_PREVIEW=<složka> cargo test status_dot
        if let Some(dir) = std::env::var_os("UNIBOX_TRAY_PREVIEW") {
            let statuses = [
                ("idle", TrayStatus::Idle),
                ("busy", TrayStatus::Busy),
                ("error", TrayStatus::Error),
                ("done", TrayStatus::Done),
                ("updates", TrayStatus::Updates),
            ];
            for (name, status) in statuses {
                let variants = [("light", ICON_LIGHT), ("dark", ICON_DARK), ("test-light", ICON_TEST_LIGHT), ("test-dark", ICON_TEST_DARK)];
                for (variant, master) in variants {
                    for size in [24, 32] {
                        let path = std::path::Path::new(&dir).join(format!("tray-{variant}-{name}-{size}.png"));
                        render_icon(master, size, status).unwrap().save(path).unwrap();
                    }
                }
            }
        }
    }
}
