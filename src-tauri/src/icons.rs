//! Ikony aplikací s mezipamětí na disku – vlastní protokol `icon://`
//! (ve WebView2 `http://icon.localhost/…`).
//!
//! - `/remote?u=<adresa>` – ikona z internetu (katalog, favicony). Stáhne se
//!   jednou (curl.exe), uloží do mezipaměti a příště se načte hned. ICO se
//!   převede na PNG (prohlížeč některé ICO vykreslí prázdné – např. více
//!   položek 256 × 256), prázdné obrázky se odmítnou.
//! - `/app?id=<AppID>` – skutečná ikona nainstalované aplikace z její položky
//!   v nabídce Start (EXE, zástupce i aplikace ze Storu), stejně jako ji
//!   ukazuje Průzkumník (IShellItemImageFactory), uložená jako PNG.
//! - `/file?p=<cesta>` – ikona programu ze seznamu Po spuštění (startup.rs),
//!   jen pro programy z posledního výpisu (žádné libovolné cesty).
//!
//! Neúspěch se také pamatuje, ať se nefunkční zdroje nezkoušejí znovu
//! a frontend rychle přejde na další zdroj (404): zdroj bez ikony (HTTP 404,
//! 403…) den; chyba sítě a přetížený server (HTTP 429, 5xx) jen 15 minut,
//! ikona z disku (nabídka Start, Po spuštění) po opakovaném pokusu také 15 minut.
//! Stahuje se nejvýš 12 ikon najednou. Odpovědi mají
//! `Access-Control-Allow-Origin: *`, aby frontend mohl ikonu prozkoumat
//! v canvasu (barva banneru, rozpoznání bílé / prázdné ikony).

use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::process::{self, hidden_command, system_tool};

/// Název protokolu (`http://icon.localhost/…` ve WebView2).
pub const SCHEME: &str = "icon";
/// Větší soubor není ikona.
const MAX_BYTES: u64 = 4 * 1024 * 1024;
/// Jak dlouho se nezkouší zdroj, který ikonu nemá (HTTP 4xx, není to obrázek).
const FAILURE_TTL: Duration = Duration::from_secs(24 * 3600);
/// Jak dlouho se nezkouší zdroj po chybě sítě (bez připojení, časový limit) –
/// krátce, ať výpadek při spuštění nenechá aplikaci bez ikon celý den.
const TRANSIENT_FAILURE_TTL: Duration = Duration::from_secs(15 * 60);
/// Nejvíc souběžných stahování – stovky karet najednou by jinak spustily
/// stovky curl.exe a stahování by se navzájem zdržovala až do časového limitu.
/// Stahování brzdí hlavně navázání spojení (každé je nové), ne přenos – na prvním
/// spuštění, kdy není nic v mezipaměti, pomůže víc souběžných.
const MAX_DOWNLOADS: usize = 12;
/// Ikony nainstalovaných aplikací se po týdnu obnoví (aktualizace může ikonu změnit).
const APP_ICON_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// Velikost ikony z nabídky Start.
const APP_ICON_SIZE: i32 = 256;

/// Obsluha protokolu – práce běží mimo vlákno WebView.
pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let cache = cache_dir(ctx.app_handle());
    let uri = request.uri().to_string();
    std::thread::spawn(move || {
        let result = cache.ok_or_else(|| "mezipaměť není dostupná".to_string()).and_then(|dir| serve(&dir, &uri));
        responder.respond(match result {
            Ok((bytes, mime)) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::CACHE_CONTROL, "public, max-age=604800")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(Cow::Owned(bytes))
                .unwrap_or_else(|_| not_found()),
            Err(_) => not_found(),
        });
    });
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(Cow::Borrowed(&[][..]));
    *response.status_mut() = StatusCode::NOT_FOUND;
    response.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, header::HeaderValue::from_static("*"));
    response
}

fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|dir| dir.join("icons"))
}

/// Vyřídí požadavek: vrátí obrázek a jeho typ.
fn serve(dir: &Path, uri: &str) -> Result<(Vec<u8>, &'static str), String> {
    let url = tauri::Url::parse(uri).map_err(|e| e.to_string())?;
    let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    match url.path() {
        "/remote" => remote_icon(dir, &param("u").ok_or("chybí adresa")?),
        "/app" => app_icon(dir, &param("id").ok_or("chybí AppID")?).map(|bytes| (bytes, "image/png")),
        "/file" => file_icon(dir, &param("p").ok_or("chybí cesta")?).map(|bytes| (bytes, "image/png")),
        "/steam" => steam_icon(dir, &param("app").ok_or("chybí číslo hry")?).map(|bytes| (bytes, "image/png")),
        "/ea" => ea_icon(dir, &param("id").ok_or("chybí id hry")?).map(|bytes| (bytes, "image/png")),
        _ => Err("neznámá cesta".into()),
    }
}

fn hash(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn is_fresh(path: &Path, ttl: Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .is_ok_and(|modified| SystemTime::now().duration_since(modified).unwrap_or_default() < ttl)
}

/// Značky v souboru `.fail`: zdroj ikonu nemá (platí den) / chyba sítě (15 minut).
const PERMANENT_MARK: &[u8] = b"permanent";
const TRANSIENT_MARK: &[u8] = b"transient";

/// Zapamatuje si trvalý neúspěch (soubor `.fail`) a vrátí chybu.
fn remember_failure<T>(fail: &Path, error: impl Into<String>) -> Result<T, String> {
    let _ = std::fs::write(fail, PERMANENT_MARK);
    Err(error.into())
}

/// Selhal zdroj nedávno? Prázdná značka je z verze 0.1.1, která za trvalé
/// brala i přetížený server (HTTP 429) – taková se zkusí znovu.
fn failed_recently(fail: &Path) -> bool {
    match std::fs::read(fail) {
        Ok(mark) if mark == PERMANENT_MARK => is_fresh(fail, FAILURE_TTL),
        Ok(mark) if mark == TRANSIENT_MARK => is_fresh(fail, TRANSIENT_FAILURE_TTL),
        _ => false,
    }
}

/// Chyba stažení: `permanent` = server ikonu nemá (zapamatuje se na den),
/// jinak chyba sítě (zkusí se znovu za chvíli).
struct DownloadError {
    permanent: bool,
    message: String,
}

/// Počet běžících stahování a signál uvolnění místa.
static DOWNLOAD_SLOTS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

/// Místo pro jedno stahování – uvolní se při zahození.
struct DownloadSlot;

impl DownloadSlot {
    fn acquire() -> Self {
        let (busy, freed) = &DOWNLOAD_SLOTS;
        let mut busy = busy.lock().unwrap_or_else(|e| e.into_inner());
        while *busy >= MAX_DOWNLOADS {
            busy = freed.wait(busy).unwrap_or_else(|e| e.into_inner());
        }
        *busy += 1;
        DownloadSlot
    }
}

impl Drop for DownloadSlot {
    fn drop(&mut self) {
        let (busy, freed) = &DOWNLOAD_SLOTS;
        *busy.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
        freed.notify_one();
    }
}

// ── Ikony z internetu ────────────────────────────────────────────────────

fn remote_icon(dir: &Path, url: &str) -> Result<(Vec<u8>, &'static str), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("neplatná adresa".into());
    }
    let name = hash(url);
    let path = dir.join(&name);
    let fail = dir.join(format!("{name}.fail"));
    if !path.exists() {
        if failed_recently(&fail) {
            return Err("zdroj nedávno selhal".into());
        }
        let _slot = DownloadSlot::acquire();
        // Mezitím ji mohl stáhnout souběžný požadavek (ikona + barva banneru)
        if !path.exists() {
            let raw = match download(url) {
                Ok(raw) => raw,
                Err(e) if e.permanent => return remember_failure(&fail, e.message),
                Err(e) => {
                    let _ = std::fs::write(&fail, TRANSIENT_MARK);
                    return Err(e.message);
                }
            };
            // Uložit už upravenou podobu (ICO → PNG), příště se jen přečte
            let Some(normalized) = normalize(raw) else { return remember_failure(&fail, "není to použitelný obrázek") };
            std::fs::write(&path, &normalized).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&fail);
        }
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mime = sniff(&bytes).ok_or("neznámý formát")?;
    Ok((bytes, mime))
}

fn download(url: &str) -> Result<Vec<u8>, DownloadError> {
    let mut command = hidden_command(&system_tool("curl.exe").to_string_lossy());
    command
        .args(["--location", "--fail", "--silent", "--connect-timeout", "5", "--max-time", "15", "--max-filesize"])
        .arg(MAX_BYTES.to_string())
        // Některé servery bez User-Agentu prohlížeče obrázek nevydají
        .args(["--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HubGet"])
        // Stavový kód HTTP na stderr (data jdou na stdout)
        .args(["--write-out", "%{stderr}%{response_code}"])
        .args(["--output", "-"])
        .arg(url);
    let output = process::run_bytes(command, Duration::from_secs(20))
        .map_err(|message| DownloadError { permanent: false, message })?;
    let status: u16 = String::from_utf8_lossy(&output.stderr).trim().parse().unwrap_or(0);
    let failure = |permanent: bool, reason: &str| DownloadError {
        permanent,
        message: format!("{reason} (curl {}, HTTP {status})", output.code),
    };
    match output.code {
        0 if !output.stdout.is_empty() => Ok(output.stdout),
        // Přetížený server (HTTP 429 – omezení počtu požadavků, 5xx) to zkusí znovu za chvíli
        22 if is_transient_status(status) => Err(failure(false, "server je přetížený")),
        // 0 bez dat, 3 neplatná adresa, 22 HTTP 4xx (ikona neexistuje), 63 příliš velký soubor
        0 | 3 | 22 | 63 => Err(failure(true, "zdroj ikonu nemá")),
        // DNS, připojení, časový limit, TLS… – chyba sítě
        _ => Err(failure(false, "chyba sítě")),
    }
}

/// Odpověď HTTP, po které má smysl to zkusit znovu: časový limit (408),
/// omezení počtu požadavků (429 – Wikimedia, Chocolatey) a chyby serveru (5xx).
fn is_transient_status(status: u16) -> bool {
    status == 408 || status == 429 || status >= 500
}

/// Použitelný obrázek: ICO se převede na PNG, ostatní rastrové formáty a SVG
/// zůstanou. Prázdný (zcela průhledný) obrázek ani HTML stránka neprojdou.
fn normalize(bytes: Vec<u8>) -> Option<Vec<u8>> {
    match sniff(&bytes)? {
        "image/x-icon" => ico_to_png(&bytes),
        "image/png" => (!is_blank_png(&bytes)).then_some(bytes),
        _ => Some(bytes),
    }
}

/// Největší obrázek z ICO jako PNG (image vybere nejlepší položku, PNG i BMP).
fn ico_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut image = ico_image(bytes)?;
    // Větší než 256 px (Zaklínač 3 má v ICO 512 px) – do mezipaměti stačí 256
    if image.width() > ICO_MAX || image.height() > ICO_MAX {
        image = image::imageops::resize(&image, ICO_MAX, ICO_MAX, image::imageops::FilterType::Lanczos3);
    }
    if is_blank(image.as_raw()) {
        return None;
    }
    encode_png(image.width(), image.height(), image.as_raw())
}

/// Největší rozměr ikony uložené z ICO.
const ICO_MAX: u32 = 256;

/// Největší obrázek z ICO. Záznamy PNG se dekódují zvlášť – crate image je v ICO bere jen
/// jako 8bitové RGBA se stejnou velikostí jako v adresáři a jinak odmítne celý soubor; Steam
/// ale ukládá i RGB bez průhlednosti, 16bitové RGBA nebo 512 px v záznamu „256“ (Zaklínač 3,
/// Cooking Simulator, Subnautica: Below Zero). Záznamy BMP dekóduje crate image jako dřív.
fn ico_image(bytes: &[u8]) -> Option<image::RgbaImage> {
    let count = bytes.get(4..6).map_or(0, |b| u16::from_le_bytes([b[0], b[1]]) as usize);
    let png = (0..count)
        .filter_map(|i| {
            let entry = bytes.get(6 + i * 16..6 + i * 16 + 16)?;
            let size = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
            let offset = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
            let data = bytes.get(offset..offset.checked_add(size)?)?;
            if !data.starts_with(b"\x89PNG") {
                return None;
            }
            Some(image::load_from_memory_with_format(data, image::ImageFormat::Png).ok()?.to_rgba8())
        })
        .max_by_key(|image| image.width() * image.height());
    let whole = image::load_from_memory_with_format(bytes, image::ImageFormat::Ico).ok().map(|image| image.to_rgba8());
    [png, whole].into_iter().flatten().max_by_key(|image| image.width() * image.height())
}

fn is_blank_png(bytes: &[u8]) -> bool {
    image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .map(|image| is_blank(image.to_rgba8().as_raw()))
        .unwrap_or(false)
}

/// Méně než 1 % viditelných pixelů = prázdný obrázek.
fn is_blank(rgba: &[u8]) -> bool {
    let pixels = rgba.len() / 4;
    let visible = rgba.chunks_exact(4).filter(|p| p[3] > 32).count();
    pixels == 0 || visible * 100 < pixels
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(rgba, width, height, image::ExtendedColorType::Rgba8)
        .ok()?;
    Some(out)
}

use image::ImageEncoder;

/// Typ obrázku podle prvních bajtů (servery často posílají špatný Content-Type).
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    let starts = |prefix: &[u8]| bytes.starts_with(prefix);
    if starts(b"\x89PNG") {
        Some("image/png")
    } else if starts(b"\xFF\xD8\xFF") {
        Some("image/jpeg")
    } else if starts(b"GIF8") {
        Some("image/gif")
    } else if starts(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if starts(b"\x00\x00\x01\x00") {
        Some("image/x-icon")
    } else if starts(b"BM") {
        Some("image/bmp")
    } else if bytes.get(4..12) == Some(b"ftypavif") {
        Some("image/avif")
    } else {
        // SVG je text – stačí najít značku <svg na začátku souboru
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
        head.contains("<svg").then_some("image/svg+xml")
    }
}

// ── Ikony nainstalovaných aplikací ───────────────────────────────────────

fn app_icon(dir: &Path, app_id: &str) -> Result<Vec<u8>, String> {
    // Jen aplikace z nabídky Start (žádné libovolné cesty)
    if !crate::apps::is_known_app(app_id)? {
        return Err("aplikace v nabídce Start není".into());
    }
    shell_icon(dir, &format!("app-{}.png", hash(app_id)), &format!("shell:AppsFolder\\{app_id}"))
}

/// Ikona programu podle cesty – jen programy ze seznamu Po spuštění (startup.rs).
fn file_icon(dir: &Path, path: &str) -> Result<Vec<u8>, String> {
    if !crate::startup::is_listed_target(path) {
        return Err("program není v seznamu po spuštění".into());
    }
    shell_icon(dir, &format!("file-{}.png", hash(&path.to_lowercase())), path)
}

/// Ikona hry ze Steamu podle čísla hry: soubor .ico, který Steam uloží do
/// `…\Steam\steam\games\` a uvede v DisplayIcon záznamu „Steam App <číslo>“
/// v Programech a funkcích (většinou až 256 px). Jen soubory z té složky.
fn steam_icon(dir: &Path, app: &str) -> Result<Vec<u8>, String> {
    if app.is_empty() || app.len() > 10 || !app.bytes().all(|b| b.is_ascii_digit()) {
        return Err("neplatné číslo hry".into());
    }
    let path = dir.join(format!("steam-{app}.png"));
    if is_fresh(&path, APP_ICON_TTL) {
        return std::fs::read(&path).map_err(|e| e.to_string());
    }
    let icon = steam_icon_file(app).ok_or("hra ikonu nemá")?;
    let png = ico_to_png(&std::fs::read(&icon).map_err(|e| e.to_string())?).ok_or("ikona hry je prázdná")?;
    std::fs::write(&path, &png).map_err(|e| e.to_string())?;
    Ok(png)
}

/// Ikona hry z EA app podle id záznamu v registru („ARP\Machine\X86\{…}“): DisplayIcon
/// hry (.ico nebo spustitelný soubor). Jen záznamy, které jsou opravdu hrou z EA app.
fn ea_icon(dir: &Path, package_id: &str) -> Result<Vec<u8>, String> {
    let name = format!("ea-{}.png", hash(&package_id.to_lowercase()));
    let path = dir.join(&name);
    if is_fresh(&path, APP_ICON_TTL) {
        return std::fs::read(&path).map_err(|e| e.to_string());
    }
    let registry = crate::arp::Registry::load();
    let entry = registry.by_winget_id(package_id).filter(|entry| entry.is_ea_game()).ok_or("hra z EA app nenalezena")?;
    let icon = entry.icon_file().ok_or("hra ikonu nemá")?;
    if !icon.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("ico")) {
        // Spustitelný soubor – ikona přes shell (stejně jako u programů z nabídky Start)
        return shell_icon(dir, &name, &icon.to_string_lossy());
    }
    let png = ico_to_png(&std::fs::read(&icon).map_err(|e| e.to_string())?).ok_or("ikona hry je prázdná")?;
    std::fs::write(&path, &png).map_err(|e| e.to_string())?;
    Ok(png)
}

/// Soubor ikony hry z registru – jen .ico ve složce `steam\games` instalace Steamu.
#[cfg(windows)]
fn steam_icon_file(app: &str) -> Option<PathBuf> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;
    let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App {app}");
    [KEY_WOW64_64KEY, KEY_WOW64_32KEY].into_iter().find_map(|view| {
        let value: String = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(&key, KEY_READ | view).ok()?.get_value("DisplayIcon").ok()?;
        steam_games_icon(&value)
    })
}

#[cfg(not(windows))]
fn steam_icon_file(_app: &str) -> Option<PathBuf> {
    None
}

/// Hodnota DisplayIcon („C:\…\Steam\steam\games\<hash>.ico“, případně v uvozovkách
/// a s „,0“) → cesta, jen když jde o existující .ico ve složce `steam\games`.
fn steam_games_icon(value: &str) -> Option<PathBuf> {
    let value = value.trim().trim_matches('"');
    let value = value.rsplit_once(',').filter(|(_, index)| index.trim().parse::<i32>().is_ok()).map_or(value, |(path, _)| path);
    let path = PathBuf::from(value.trim().trim_matches('"'));
    let is_ico = path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("ico"));
    let games = path.parent()?;
    let in_steam_games = games.file_name().is_some_and(|n| n.eq_ignore_ascii_case("games"))
        && games.parent()?.file_name().is_some_and(|n| n.eq_ignore_ascii_case("steam"))
        && !value.contains("..");
    (is_ico && in_steam_games && path.is_file()).then_some(path)
}

/// Ikona položky shellu (`parsing_name`) s mezipamětí v souboru `name`.
///
/// Extrakce z existujícího souboru selže jen výjimečně a přechodně – hlavně když
/// stránka (Po spuštění, Nainstalované) požádá o desítky ikon najednou. Proto ještě
/// jeden pokus a neúspěch se pamatuje jen krátce (i dřívější značka „permanent“),
/// jinak by program zůstal den bez ikony.
fn shell_icon(dir: &Path, name: &str, parsing_name: &str) -> Result<Vec<u8>, String> {
    let path = dir.join(name);
    let fail = dir.join(format!("{name}.fail"));
    if is_fresh(&path, APP_ICON_TTL) {
        return std::fs::read(&path).map_err(|e| e.to_string());
    }
    if fail.exists() && is_fresh(&fail, TRANSIENT_FAILURE_TTL) {
        return Err("ikonu nedávno nešlo získat".into());
    }
    let extracted = extract_shell_icon(parsing_name).or_else(|_| {
        std::thread::sleep(Duration::from_millis(200));
        extract_shell_icon(parsing_name)
    });
    match extracted {
        Ok(png) => {
            std::fs::write(&path, &png).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&fail);
            Ok(png)
        }
        Err(e) => {
            let _ = std::fs::write(&fail, TRANSIENT_MARK);
            Err(e)
        }
    }
}

/// Ikona položky shellu jako PNG – položka nabídky Start (`shell:AppsFolder\<AppID>`)
/// nebo soubor programu, přes IShellItemImageFactory (EXE, zástupci i aplikace ze Storu).
#[cfg(windows)]
fn extract_shell_icon(parsing_name: &str) -> Result<Vec<u8>, String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };

    // SAFETY: COM se inicializuje v tomto vlákně a na konci uvolní; bitmapa
    // i DC se uvolní v každé větvi.
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> Result<Vec<u8>, String> {
            let path = HSTRING::from(parsing_name);
            let factory: IShellItemImageFactory =
                SHCreateItemFromParsingName(&path, None::<&IBindCtx>).map_err(|e| e.to_string())?;
            let flags = SIIGBF(SIIGBF_ICONONLY.0 | SIIGBF_BIGGERSIZEOK.0);
            let bitmap = factory
                .GetImage(SIZE { cx: APP_ICON_SIZE, cy: APP_ICON_SIZE }, flags)
                .map_err(|e| e.to_string())?;
            let object = HGDIOBJ(bitmap.0);

            let mut info = BITMAP::default();
            GetObjectW(object, std::mem::size_of::<BITMAP>() as i32, Some(&mut info as *mut _ as *mut _));
            let (width, height) = (info.bmWidth, info.bmHeight.abs());
            let mut header = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height, // shora dolů
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; (width * height * 4) as usize];
            let dc = CreateCompatibleDC(None);
            let lines = GetDIBits(
                dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut header,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(dc);
            let _ = DeleteObject(object);
            if lines == 0 || width <= 0 {
                return Err("bitmapu ikony nejde přečíst".into());
            }

            // BGRA s přednásobenou průhledností → RGBA
            for p in pixels.chunks_exact_mut(4) {
                let (b, g, r, a) = (p[0], p[1], p[2], p[3]);
                let unmultiply = |c: u8| if a == 0 { 0 } else { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 };
                p.copy_from_slice(&[unmultiply(r), unmultiply(g), unmultiply(b), a]);
            }
            if is_blank(&pixels) {
                return Err("prázdná ikona".into());
            }
            let (width, height, pixels) = trim_padding(width as u32, height as u32, pixels);
            encode_png(width, height, &pixels).ok_or_else(|| "PNG se nepodařilo vytvořit".into())
        })();
        if com.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(not(windows))]
fn extract_shell_icon(_parsing_name: &str) -> Result<Vec<u8>, String> {
    Err("jen ve Windows".into())
}

/// Malá ikona v rámečku – aplikace bez velké ikony (PowerToys…) vrací shell
/// jako malou ikonu (72 px) uprostřed průhledné plochy 256 px se slabým
/// rámečkem při okraji. Ořízne se na obsah, ať je v kartě stejně velká jako
/// ostatní. Běžné ikony (obsah přes většinu plochy, výrazný okraj) zůstanou
/// beze změny.
fn trim_padding(width: u32, height: u32, rgba: Vec<u8>) -> (u32, u32, Vec<u8>) {
    let alpha = |x: u32, y: u32| rgba[((y * width + x) * 4 + 3) as usize];
    // Pás při okraji (u 256 px 8 px), kde shell kreslí rámeček
    let margin = (width.min(height) / 32).max(2);
    if width <= margin * 4 || height <= margin * 4 {
        return (width, height, rgba);
    }
    let in_margin = |x: u32, y: u32| x < margin || y < margin || x >= width - margin || y >= height - margin;

    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
    for y in 0..height {
        for x in 0..width {
            let a = alpha(x, y);
            if in_margin(x, y) {
                // Výrazný pixel při okraji = ikona přes celou plochu, ne rámeček
                if a >= 128 {
                    return (width, height, rgba);
                }
            } else if a > 16 {
                (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
            }
        }
    }
    if x0 > x1 {
        return (width, height, rgba);
    }
    let (w, h) = (x1 - x0 + 1, y1 - y0 + 1);
    // Obsah vyplňuje většinu plochy → ořezávat není co
    if w * 4 > width * 3 && h * 4 > height * 3 {
        return (width, height, rgba);
    }
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for y in y0..=y1 {
        let start = ((y * width + x0) * 4) as usize;
        out.extend_from_slice(&rgba[start..start + (w * 4) as usize]);
    }
    (w, h, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ICO s jedním záznamem PNG (velikost v adresáři 256 = 0) z dodaného PNG.
    fn ico_with_png(png: &[u8]) -> Vec<u8> {
        let mut ico = vec![0, 0, 1, 0, 1, 0];
        ico.extend([0, 0, 0, 0, 1, 0, 32, 0]);
        ico.extend((png.len() as u32).to_le_bytes());
        ico.extend(22u32.to_le_bytes());
        ico.extend(png);
        ico
    }

    fn png_of(image: image::DynamicImage) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn ico_with_png_in_other_formats() {
        // Steam: RGB bez průhlednosti (Subnautica: Below Zero), 16bitové RGBA (Cooking Simulator),
        // 512 px v záznamu „256“ (Zaklínač 3) – crate image takové ICO odmítne celé
        let rgb = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(256, 256, image::Rgb([200, 40, 40])));
        let rgba16 = image::DynamicImage::ImageRgba16(image::ImageBuffer::from_pixel(256, 256, image::Rgba([60000u16, 0, 0, 65535])));
        let big = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(512, 512, image::Rgb([10, 200, 10])));
        for (name, source) in [("rgb", rgb), ("rgba16", rgba16), ("512", big)] {
            let png = ico_to_png(&ico_with_png(&png_of(source))).unwrap_or_else(|| panic!("{name}: ikona se nepřevedla"));
            let decoded = image::load_from_memory(&png).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (256, 256), "{name}");
        }
    }

    #[test]
    fn steam_icons_only_from_steam_games_folder() {
        let root = std::env::temp_dir().join(format!("unibox-steam-icon-test-{}", std::process::id()));
        let games = root.join("Steam").join("steam").join("games");
        std::fs::create_dir_all(&games).unwrap();
        let icon = games.join("3d642f225dfb.ico");
        std::fs::write(&icon, b"x").unwrap();
        let other = root.join("other.ico");
        std::fs::write(&other, b"x").unwrap();

        let shown = icon.to_string_lossy().to_string();
        assert_eq!(steam_games_icon(&shown), Some(icon.clone()));
        assert_eq!(steam_games_icon(&format!("\"{shown}\",0")), Some(icon.clone()));
        // Mimo steam\games, jiný typ souboru, neexistující soubor, „..“
        assert_eq!(steam_games_icon(&other.to_string_lossy()), None);
        assert_eq!(steam_games_icon(&games.join("game.exe").to_string_lossy()), None);
        assert_eq!(steam_games_icon(&games.join("missing.ico").to_string_lossy()), None);
        assert_eq!(steam_games_icon(&format!(r"{}\..\games\3d642f225dfb.ico", games.display())), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sniffs_formats() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(sniff(b"\x00\x00\x01\x00\x01\x00"), Some("image/x-icon"));
        assert_eq!(sniff(b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\">"), Some("image/svg+xml"));
        assert_eq!(sniff(b"<html><body>404</body></html>"), None);
    }

    #[test]
    fn blank_detection() {
        let transparent = vec![0u8; 16 * 16 * 4];
        assert!(is_blank(&transparent));
        let mut icon = transparent.clone();
        for p in icon.chunks_exact_mut(4).take(40) {
            p.copy_from_slice(&[255, 128, 0, 255]);
        }
        assert!(!is_blank(&icon));
    }

    #[test]
    fn failure_marks() {
        let dir = std::env::temp_dir().join(format!("unibox-icons-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mark = |name: &str, content: &[u8]| {
            let path = dir.join(name);
            std::fs::write(&path, content).unwrap();
            path
        };
        assert!(failed_recently(&mark("a.fail", PERMANENT_MARK)));
        assert!(failed_recently(&mark("b.fail", TRANSIENT_MARK)));
        assert!(!failed_recently(&mark("c.fail", b""))); // značka z verze 0.1.1 → zkusit znovu
        assert!(!failed_recently(&dir.join("chybi.fail")));
        let _ = std::fs::remove_dir_all(&dir);

        assert!(is_transient_status(429) && is_transient_status(503) && is_transient_status(408));
        assert!(!is_transient_status(404) && !is_transient_status(403));
    }

    /// Obrázek size × size vyplněný barvou `fill`, uprostřed čtverec `inner` px barvy `dot`.
    fn plate(size: u32, fill: [u8; 4], inner: u32, dot: [u8; 4]) -> Vec<u8> {
        let start = (size - inner) / 2;
        (0..size * size)
            .flat_map(|i| {
                let (x, y) = (i % size, i / size);
                let inside = (start..start + inner).contains(&x) && (start..start + inner).contains(&y);
                if inside { dot } else { fill }
            })
            .collect()
    }

    #[test]
    fn trims_small_icon_in_frame() {
        // Malá ikona uprostřed průhledné plochy se slabým rámečkem → jen ikona
        let mut framed = plate(64, [0, 0, 0, 0], 16, [220, 40, 40, 255]);
        for p in framed.chunks_exact_mut(4).take(64) {
            p.copy_from_slice(&[255, 255, 255, 66]); // horní řádek = rámeček
        }
        let (w, h, out) = trim_padding(64, 64, framed);
        assert_eq!((w, h), (16, 16));
        assert!(out.chunks_exact(4).all(|p| p == [220, 40, 40, 255]));
        // Ikona s plným pozadím ani velká ikona se neořezává
        assert_eq!(trim_padding(64, 64, plate(64, [220, 40, 40, 255], 16, [255, 255, 255, 255])).0, 64);
        assert_eq!(trim_padding(64, 64, plate(64, [0, 0, 0, 0], 56, [220, 40, 40, 255])).0, 64);
    }
}
