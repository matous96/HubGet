//! Běžící procesy aplikace.
//!
//! Před instalací, aktualizací a odinstalací (a po neúspěchu s chybou „inUse“ –
//! winget 0x8A150101 / 0x8A150111) HubGet najde procesy aplikace a zavře je –
//! jinak instalátor běžící soubory nepřepíše (OBS v oznamovací oblasti u hodin,
//! proces, který v paměti zůstal po zavření okna nebo po odinstalaci).
//!
//! Proces patří aplikaci, když jeho spustitelný soubor leží:
//!  - ve složce instalace ze záznamu „Programy a funkce“ (InstallLocation, jinak
//!    složka ikony / odinstalátoru – bez podsložek typu `bin\64bit`) – jistá shoda,
//!  - ve složce pojmenované jako aplikace („obs-studio“ = OBS Studio), nebo se
//!    jako aplikace jmenuje sám („Discord.exe“) – i bez záznamu v registru
//!    (aplikace už odinstalovaná, proces visí v paměti).
//!
//! U každého procesu backend řekne, jestli má viditelné okno a jestli je to
//! okenní program (ne konzolový) – frontend podle toho rozhodne, jestli ho
//! ukončí sám (proces na pozadí), nebo se zeptá. Složky instalace si backend
//! pamatuje: po odinstalaci záznam z registru zmizí, ale procesy, které ze
//! složky dál běží, se dají dohledat a ukončit.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::arp;
use crate::leftovers;
use crate::process::{background, hidden_command, system_tool};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunningProcess {
    pid: u32,
    name: String,
    path: String,
    /// Má viditelné okno (i minimalizované) – uživatel s aplikací pracuje.
    visible: bool,
    /// Okenní program (subsystém GUI) – konzolové programy (python.exe, skripty) se bez dotazu nezavírají.
    gui: bool,
    /// Leží ve složce instalace ze záznamu v registru (ne jen podle názvu).
    certain: bool,
}

/// Podsložky, ze kterých se složka instalace vystoupá výš („obs-studio\bin\64bit“ → „obs-studio“,
/// „GeForceNOW\CEF“ → „GeForceNOW“ – aplikace postavené na Chromium Embedded Framework).
const NESTED: &[&str] = &["bin", "bin64", "bin32", "64bit", "32bit", "x64", "x86", "app", "current", "cef"];

/// Složky instalace z posledních hledání podle id balíčku (malými písmeny, se „\“ na konci).
static KNOWN_DIRS: Mutex<Option<HashMap<String, Vec<String>>>> = Mutex::new(None);

/// Složky, které nikdy nejsou složkou jedné aplikace (celé Program Files apod.).
fn too_broad(dir: &Path) -> bool {
    let depth = dir.components().count();
    let name = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    depth < 3 || ["program files", "program files (x86)", "programs", "appdata", "local", "roaming", "windows", "system32"].contains(&name.as_str())
}

/// Složky instalace k záznamu programu.
fn install_dirs(entry: &arp::ArpEntry) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for path in arp::referenced_paths(entry) {
        let mut dir = if path.extension().is_some() { path.parent().map(Path::to_path_buf) } else { Some(path) };
        while let Some(current) = dir.as_ref() {
            let name = current.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !NESTED.contains(&name.as_str()) {
                break;
            }
            dir = current.parent().map(Path::to_path_buf);
        }
        if let Some(dir) = dir.filter(|d| !too_broad(d)) {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

/// Běží proces z dané složky (`dir` malými písmeny se „\“ na konci)?
fn inside(path: &str, dir: &str) -> bool {
    path.to_lowercase().starts_with(dir)
}

/// Jmenuje se proces nebo některá jeho složka jako aplikace (klíče názvu aplikace)?
fn named_like_app(path: &str, apps: &HashSet<String>) -> bool {
    let path = Path::new(path);
    let stem = path.file_stem().map(|s| arp::name_key(&s.to_string_lossy())).unwrap_or_default();
    apps.contains(&stem)
        || path
            .parent()
            .into_iter()
            .flat_map(Path::components)
            .any(|part| apps.contains(&arp::name_key(&part.as_os_str().to_string_lossy())))
}

/// Proces Windows (C:\Windows\…) – nikdy nepatří instalované aplikaci.
fn in_windows(path: &str) -> bool {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    inside(path, &format!("{}\\", root.trim_end_matches('\\').to_lowercase()))
}

/// Běžící proces: id, název a cesta ke spustitelnému souboru.
struct Process {
    pid: u32,
    name: String,
    path: String,
}

/// Běžící procesy (id, název, cesta ke spustitelnému souboru).
#[cfg(windows)]
fn processes() -> Vec<Process> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};

    let mut list = Vec::new();
    // SAFETY: snapshot a handly procesů se zavřou; řetězce se čtou jen v délce, kterou vrátí systém
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return list;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snapshot, &mut entry) != 0;
        while ok {
            let pid = entry.th32ProcessID;
            let name_len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !handle.is_null() {
                let mut buffer = [0u16; 1024];
                let mut size = buffer.len() as u32;
                if QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size) != 0 {
                    list.push(Process { pid, name, path: String::from_utf16_lossy(&buffer[..size as usize]) });
                }
                CloseHandle(handle);
            }
            ok = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    list
}

#[cfg(not(windows))]
fn processes() -> Vec<Process> {
    Vec::new()
}

/// Procesy, které mají viditelné okno nejvyšší úrovně s titulkem (i minimalizované).
#[cfg(windows)]
fn visible_window_pids() -> HashSet<u32> {
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
    };

    // SAFETY: lparam je ukazatel na množinu z volající funkce, která žije po celý
    // výčet; handle okna předává systém během výčtu
    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let pids = &mut *(lparam as *mut HashSet<u32>);
        if IsWindowVisible(hwnd) != 0 && GetWindow(hwnd, GW_OWNER).is_null() && GetWindowTextLengthW(hwnd) > 0 {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            pids.insert(pid);
        }
        1
    }

    let mut pids = HashSet::new();
    // SAFETY: zpětné volání dostane jen ukazatel na `pids`, který přežije celé volání
    unsafe { EnumWindows(Some(collect), &mut pids as *mut HashSet<u32> as LPARAM) };
    pids
}

#[cfg(not(windows))]
fn visible_window_pids() -> HashSet<u32> {
    HashSet::new()
}

/// Běží nějaký program ze složky `dir` (nebo jejích podsložek)?
pub fn any_running_in(dir: &Path) -> bool {
    let prefix = format!("{}\\", arp::folder_key(dir));
    processes().iter().any(|p| inside(&p.path, &prefix))
}

/// Je spustitelný soubor okenní program? Subsystém z hlavičky PE (2 = GUI, 3 = konzole).
pub fn is_gui_program(path: &str) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let read = || -> std::io::Result<u16> {
        let mut file = std::fs::File::open(path)?;
        let mut word = [0u8; 4];
        file.seek(SeekFrom::Start(0x3C))?;
        file.read_exact(&mut word)?;
        let pe = u32::from_le_bytes(word) as u64;
        // Podpis „PE\0\0“ (4 B) + hlavička COFF (20 B) + posun pole Subsystem v nepovinné hlavičce (68 B)
        file.seek(SeekFrom::Start(pe + 4 + 20 + 68))?;
        let mut subsystem = [0u8; 2];
        file.read_exact(&mut subsystem)?;
        Ok(u16::from_le_bytes(subsystem))
    };
    read().is_ok_and(|subsystem| subsystem == 2)
}

/// Procesy aplikace: podle složek instalace (registr + zapamatované z dřívějška)
/// a podle názvu aplikace / id balíčku.
#[tauri::command]
pub async fn app_processes(package_id: String, name: String) -> Result<Vec<RunningProcess>, String> {
    background(move || {
        let registry = arp::Registry::load();
        let mut dirs: Vec<String> = registry
            .matching(&package_id, &name, "")
            .into_iter()
            .flat_map(install_dirs)
            .map(|d| format!("{}\\", d.to_string_lossy().trim_end_matches('\\').to_lowercase()))
            .collect();
        // Program rozbalený na ploše (Tor Browser) záznam v registru nemá – jeho složka
        if dirs.is_empty() {
            dirs.extend(crate::disk::portable_folder(&name).map(|dir| format!("{}\\", arp::folder_key(&dir))));
        }
        {
            let mut known = KNOWN_DIRS.lock().unwrap_or_else(|e| e.into_inner());
            let known = known.get_or_insert_with(HashMap::new);
            if dirs.is_empty() {
                dirs = known.get(&package_id).cloned().unwrap_or_default();
            } else {
                known.insert(package_id.clone(), dirs.clone());
            }
        }
        let (apps, _) = leftovers::name_keys(&name, &package_id);
        let own = std::process::id();
        let own_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| format!("{}\\", d.to_string_lossy().to_lowercase())));
        let windows = visible_window_pids();
        Ok(processes()
            .into_iter()
            .filter(|p| p.pid != own && !in_windows(&p.path) && own_dir.as_deref().map_or(true, |dir| !inside(&p.path, dir)))
            .filter_map(|p| {
                let certain = dirs.iter().any(|dir| inside(&p.path, dir));
                (certain || named_like_app(&p.path, &apps)).then(|| RunningProcess {
                    visible: windows.contains(&p.pid),
                    gui: is_gui_program(&p.path),
                    certain,
                    pid: p.pid,
                    name: p.name,
                    path: p.path,
                })
            })
            .collect())
    })
    .await
}

/// Pošle procesům požadavek na zavření (taskkill; s `force` natvrdo) a počká
/// nejvýš `wait`, než skončí. Vrátí ty, které běží dál.
fn terminate(pids: &[u32], force: bool, wait: Duration) -> Vec<u32> {
    let own = std::process::id();
    let pids: Vec<u32> = pids.iter().copied().filter(|&p| p != own).collect();
    for pid in &pids {
        let mut command = hidden_command(&system_tool("taskkill.exe").to_string_lossy());
        command.args(["/PID", &pid.to_string(), "/T"]);
        if force {
            command.arg("/F");
        }
        let _ = crate::process::run(command, Duration::from_secs(15));
    }
    let deadline = Instant::now() + wait;
    loop {
        let alive: Vec<u32> = {
            let running: Vec<u32> = processes().iter().map(|p| p.pid).collect();
            pids.iter().copied().filter(|p| running.contains(p)).collect()
        };
        if alive.is_empty() || Instant::now() > deadline {
            return alive;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// Zavře procesy aplikace: nejdřív slušně (zpráva o zavření oknům – aplikace
/// se může zeptat na uložení), s `force` natvrdo. Vrátí procesy, které běží dál.
#[tauri::command]
pub async fn close_processes(pids: Vec<u32>, force: bool) -> Result<Vec<u32>, String> {
    background(move || Ok(terminate(&pids, force, Duration::from_secs(if force { 5 } else { 10 })))).await
}

/// Ukončí procesy bez dotazu (procesy na pozadí před operací, pozůstatky po
/// odinstalaci): nejdřív slušně s krátkým čekáním, kdo nereaguje, natvrdo.
/// Vrátí procesy, které ukončit nešlo (běží s právy správce).
#[tauri::command]
pub async fn end_processes(pids: Vec<u32>) -> Result<Vec<u32>, String> {
    background(move || {
        let alive = terminate(&pids, false, Duration::from_secs(3));
        Ok(if alive.is_empty() { alive } else { terminate(&alive, true, Duration::from_secs(5)) })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_install_dirs() {
        let entry = arp::ArpEntry::with_paths(r"", r"C:\Program Files\obs-studio\bin\64bit\obs64.exe");
        assert_eq!(install_dirs(&entry), [PathBuf::from(r"C:\Program Files\obs-studio")]);
        // GeForce NOW: ikona v podsložce CEF, procesy běží z celé složky aplikace
        let gfn = arp::ArpEntry::with_paths("", r"C:\Users\u\AppData\Local\NVIDIA Corporation\GeForceNOW\CEF\GeForceNOW.exe,0");
        assert!(install_dirs(&gfn).contains(&PathBuf::from(r"C:\Users\u\AppData\Local\NVIDIA Corporation\GeForceNOW")));
        let broad = arp::ArpEntry::with_paths(r"C:\Program Files\", "");
        assert!(install_dirs(&broad).is_empty());
    }

    #[test]
    fn processes_named_like_app() {
        let (obs, _) = leftovers::name_keys("OBS Studio", "OBSProject.OBSStudio");
        assert!(named_like_app(r"C:\Program Files\obs-studio\bin\64bit\obs64.exe", &obs));
        assert!(!named_like_app(r"C:\Program Files\Mozilla Firefox\firefox.exe", &obs));
        let (discord, _) = leftovers::name_keys("Discord", r"ARP\User\X64\Discord");
        assert!(named_like_app(r"C:\Users\x\AppData\Local\Discord\app-1.0.9264\Discord.exe", &discord));
        // „NVIDIA App“ bez vydavatele je jen „app“ – obecné slovo nesmí chytit cizí složku „app“
        let (nvidia, _) = leftovers::name_keys("NVIDIA App", "Nvidia.NvidiaApp");
        assert!(named_like_app(r"C:\Program Files\NVIDIA Corporation\NVIDIA App\CEF\NVIDIA Overlay.exe", &nvidia));
        assert!(!named_like_app(r"C:\Users\x\AppData\Local\ChatGPT\app\ChatGPT.exe", &nvidia));
    }

    #[test]
    fn gui_subsystem() {
        let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        assert!(is_gui_program(&format!(r"{windows}\explorer.exe")));
        assert!(!is_gui_program(&format!(r"{windows}\System32\cmd.exe")));
        assert!(!is_gui_program(r"C:\Neexistujici HubGet\app.exe"));
    }
}
