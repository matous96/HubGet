//! Rychlé akce na ikoně HubGetu v hlavním panelu a v nabídce Start (jump list, pravé
//! tlačítko): Dostupné aktualizace (s počtem), Aktualizovat vše, Nainstalované, Hledat a Přehled počítače. Každá akce je
//! zástupce na HubGet s příkazem terminálu (`--cli updates` …) – spuštění projde stejnou
//! cestou jako příkaz `hubget` (cli.rs): předá ho běžícímu HubGetu, nebo ho spustí.
//! Názvy posílá frontend v jazyce aplikace (při startu a po změně jazyka).

use serde::Deserialize;

use crate::process::background;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JumpTask {
    title: String,
    /// Příkaz terminálu (cli.rs): updates | update | installed | search | overview.
    command: String,
}

/// Povolené příkazy – zástupce nesmí spouštět nic jiného.
const COMMANDS: &[&str] = &["updates", "update", "installed", "search", "overview"];

#[cfg(windows)]
fn apply(tasks: &[JumpTask]) -> windows::core::Result<()> {
    use std::mem::ManuallyDrop;
    use windows::core::{Interface, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::Foundation::E_OUTOFMEMORY;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemAlloc, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink};

    let exe = std::env::current_exe().map_err(|e| windows::core::Error::new(windows::core::HRESULT(-1), e.to_string()))?;
    let exe = HSTRING::from(exe.as_os_str());
    // SAFETY: COM se inicializuje v tomto vlákně a na konci uvolní; PROPVARIANT s názvem
    // má text z CoTaskMemAlloc a uvolní ho PropVariantClear (ManuallyDrop – žádné druhé uvolnění)
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<()> {
            let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
            if tasks.is_empty() {
                return list.DeleteList(PCWSTR::null());
            }
            let mut slots = 0u32;
            let _removed: IObjectArray = list.BeginList(&mut slots)?;
            let collection: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
            for task in tasks {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                link.SetPath(&exe)?;
                link.SetArguments(&HSTRING::from(format!("{} {}", crate::cli::CLI_FLAG, task.command)))?;
                link.SetIconLocation(&exe, 0)?;
                link.SetDescription(&HSTRING::from(task.title.as_str()))?;
                // Název akce jako VT_LPWSTR: text musí být z CoTaskMemAlloc – PropVariantClear ho
                // uvolňuje přes CoTaskMemFree (s pamětí Rustu by to poškodilo haldu)
                let title: Vec<u16> = task.title.encode_utf16().chain(Some(0)).collect();
                let text = CoTaskMemAlloc(title.len() * 2) as *mut u16;
                if text.is_null() {
                    return Err(windows::core::Error::from(E_OUTOFMEMORY));
                }
                std::ptr::copy_nonoverlapping(title.as_ptr(), text, title.len());
                let mut value = ManuallyDrop::new(PROPVARIANT {
                    Anonymous: PROPVARIANT_0 {
                        Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                            vt: VT_LPWSTR,
                            wReserved1: 0,
                            wReserved2: 0,
                            wReserved3: 0,
                            Anonymous: PROPVARIANT_0_0_0 { pwszVal: PWSTR(text) },
                        }),
                    },
                });
                let store: IPropertyStore = link.cast()?;
                let saved = store.SetValue(&PKEY_Title, &*value).and_then(|()| store.Commit());
                // SetValue si hodnotu zkopíruje – text uvolnit vždy, i po chybě
                let _ = PropVariantClear(&mut *value);
                saved?;
                collection.AddObject(&link)?;
            }
            list.AddUserTasks(&collection.cast::<IObjectArray>()?)?;
            list.CommitList()
        })();
        if com.is_ok() {
            CoUninitialize();
        }
        result
    }
}

#[cfg(not(windows))]
fn apply(_tasks: &[JumpTask]) -> Result<(), String> {
    Ok(())
}

/// Nastaví rychlé akce (prázdný seznam je smaže).
#[tauri::command]
pub async fn set_jump_list(tasks: Vec<JumpTask>) -> Result<(), String> {
    if let Some(task) = tasks.iter().find(|t| !COMMANDS.contains(&t.command.as_str()) || t.title.trim().is_empty()) {
        return Err(format!("Neplatná akce: {task:?}"));
    }
    background(move || apply(&tasks).map_err(|e| e.to_string())).await
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "zapisuje rychlé akce testovacímu programu"]
    fn nastaveni_rychlych_akci() {
        let tasks = vec![JumpTask { title: "Dostupné aktualizace".into(), command: "updates".into() }];
        apply(&tasks).unwrap();
        apply(&[]).unwrap();
    }
}
