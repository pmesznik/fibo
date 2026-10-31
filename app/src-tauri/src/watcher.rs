//! Natychmiastowe wykrywanie zmian w obserwowanych folderach: system zgłasza nowe, zmienione i usunięte pliki, a program po chwili ciszy
//! (żeby nie liczyć przy każdym pliku z kopiowanej serii) wysyła do okna zdarzenie „files-changed”. Okno robi wtedy zwykłe sprawdzenie folderów.
//! Obserwator niczego nie czyta ani nie zapisuje, tylko nasłuchuje; nic nie wychodzi z komputera.

use std::path::Path;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, State};

use crate::AppState;

/// Po tylu milisekundach ciszy od ostatniego zdarzenia zgłaszamy zmianę.
const QUIET_MS: u64 = 1500;
/// Najkrótszy odstęp między zgłoszeniami.
const MIN_GAP_MS: u64 = 3000;

static WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);
static TX: OnceLock<Sender<()>> = OnceLock::new();

/// Czy zmiana pliku może dotyczyć biblioteki. Własne pliki FIBO (XMP, przepis edycji, kopie oryginałów, pliki tymczasowe) pomijamy,
/// żeby zapis metadanych nie wywoływał kolejnego sprawdzenia.
pub fn relevant(path: &Path) -> bool {
    let s = path.to_string_lossy().to_ascii_lowercase();
    if s.contains(&format!("{}{}", std::path::MAIN_SEPARATOR, crate::ORIGINALS_DIR.to_ascii_lowercase())) {
        return false;
    }
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if matches!(ext.as_str(), "xmp" | "json" | "tmp" | "part" | "crdownload" | "db" | "ini" | "lnk") {
        return false;
    }
    !path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false)
}

fn interesting(ev: &Event) -> bool {
    matches!(ev.kind, EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(notify::event::ModifyKind::Name(_)) | EventKind::Modify(notify::event::ModifyKind::Data(_)))
        && ev.paths.iter().any(|p| relevant(p))
}

fn sender(app: &tauri::AppHandle) -> Sender<()> {
    TX.get_or_init(|| {
        let (tx, rx) = channel::<()>();
        let app = app.clone();
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                // Czekamy na ciszę: kolejne zdarzenia przesuwają zgłoszenie.
                while rx.recv_timeout(Duration::from_millis(QUIET_MS)).is_ok() {}
                let _ = app.emit("files-changed", ());
                std::thread::sleep(Duration::from_millis(MIN_GAP_MS));
            }
        });
        tx
    })
    .clone()
}

/// Ustawia obserwowanie wszystkich obserwowanych folderów biblioteki (wywoływane przy starcie i po zmianie listy folderów).
/// Zwraca liczbę folderów, które udało się objąć obserwowaniem (niedostępne dyski są pomijane).
#[tauri::command]
pub fn watch_roots(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let roots: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT path FROM roots").map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    let tx = sender(&app);
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(ev) = res {
            if interesting(&ev) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    let mut ok = 0;
    for r in &roots {
        let p = Path::new(r);
        if p.is_dir() && watcher.watch(p, RecursiveMode::Recursive).is_ok() {
            ok += 1;
        }
    }
    *WATCHER.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(ok)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn own_and_temporary_files_do_not_trigger_rescans() {
        assert!(relevant(&PathBuf::from("C:\\Zdjecia\\IMG_1.JPG")));
        assert!(relevant(&PathBuf::from("C:\\Zdjecia\\film.mp4")));
        assert!(!relevant(&PathBuf::from("C:\\Zdjecia\\IMG_1.JPG.xmp")));
        assert!(!relevant(&PathBuf::from("C:\\Zdjecia\\IMG_1.JPG.fibo.json")));
        assert!(!relevant(&PathBuf::from("C:\\Zdjecia\\.originals\\IMG_1.JPG")));
        assert!(!relevant(&PathBuf::from("C:\\Zdjecia\\IMG_1.jpg.tmp")));
        assert!(!relevant(&PathBuf::from("C:\\Zdjecia\\.hidden.jpg")));
        assert!(!relevant(&PathBuf::from("C:\\Zdjecia\\Thumbs.db")));
    }

    #[test]
    fn real_folder_changes_are_reported_after_quiet() {
        let dir = std::env::temp_dir().join("mz-watch-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, rx) = channel::<()>();
        let mut w = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                if interesting(&ev) {
                    let _ = tx.send(());
                }
            }
        })
        .unwrap();
        w.watch(&dir, RecursiveMode::Recursive).unwrap();
        std::fs::write(dir.join("a.xmp"), b"x").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(800)).is_err(), "plik XMP nie jest zmianą biblioteki");
        std::fs::write(dir.join("nowe.jpg"), b"x").unwrap();
        assert!(rx.recv_timeout(Duration::from_secs(5)).is_ok(), "nowy plik zdjęcia musi zostać zgłoszony");
    }
}
