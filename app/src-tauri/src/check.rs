//! Sprawdzanie plików biblioteki: brakujące, puste i uszkodzone zdjęcia. Tylko odczyt, nic nie jest zmieniane ani usuwane.

use std::path::Path;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::AppState;

#[derive(Serialize, Debug)]
pub struct Broken {
    id: i64,
    path: String,
    error: String,
}

/// Błąd odczytu jednego pliku zdjęcia albo None, gdy plik jest w porządku.
/// Szybkie sprawdzenie czyta tylko nagłówek obrazu; dokładne dekoduje cały obraz (wolniejsze, ale wykrywa też ucięte pliki).
fn check_file(path: &Path, deep: bool) -> Option<String> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Some("Pliku nie ma na dysku".into()),
    };
    if !meta.is_file() {
        return Some("To nie jest plik".into());
    }
    if meta.len() == 0 {
        return Some("Pusty plik".into());
    }
    // Formaty, których nie czyta biblioteka `image`: HEIC, JPEG XL, PSD i RAW sprawdzamy ich własnymi dekoderami, a AVIF i SVG dekoduje tylko okno aplikacji.
    let ext = crate::formats::ext_of(path);
    if crate::formats::is_raw(path) || matches!(ext.as_str(), "heic" | "heif" | "hif" | "jxl" | "psd") {
        if deep {
            return crate::formats::open_preview(path).err().map(|e| format!("Nie da się odczytać obrazu: {e}"));
        }
        let header_ok = !matches!(ext.as_str(), "heic" | "heif" | "hif" | "psd") || crate::formats::dimensions(path).is_some();
        return if header_ok { None } else { Some("Uszkodzony nagłówek obrazu".into()) };
    }
    if crate::formats::ui_only(path) {
        return None;
    }
    if deep {
        // Dekoder JPEG często „wybacza” ucięty plik i oddaje szary obraz, więc sprawdzamy znacznik końca (FFD9) w ostatnich bajtach.
        let is_jpeg = path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg")).unwrap_or(false);
        if is_jpeg {
            use std::io::{Read, Seek, SeekFrom};
            if let Ok(mut f) = std::fs::File::open(path) {
                let tail_len = meta.len().min(256);
                let mut tail = vec![0u8; tail_len as usize];
                if f.seek(SeekFrom::End(-(tail_len as i64))).is_ok() && f.read_exact(&mut tail).is_ok() && !tail.windows(2).any(|w| w == [0xFF, 0xD9]) {
                    return Some("Plik JPEG jest ucięty (brak końca pliku)".into());
                }
            }
        }
        return image::open(path).err().map(|e| format!("Nie da się odczytać obrazu: {e}"));
    }
    let probe = image::ImageReader::open(path).and_then(|r| r.with_guessed_format()).map_err(|e| e.to_string()).and_then(|r| r.into_dimensions().map_err(|e| e.to_string()));
    probe.err().map(|e| format!("Uszkodzony nagłówek obrazu: {e}"))
}

pub fn check_core(state: &AppState, deep: bool, progress: &dyn Fn(usize, usize)) -> Result<Vec<Broken>, String> {
    let rows: Vec<(i64, String)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id, path FROM photos WHERE hidden = 0 ORDER BY id").map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    let total = rows.len();
    let mut out = Vec::new();
    for (i, (id, path)) in rows.into_iter().enumerate() {
        if let Some(error) = check_file(Path::new(&path), deep) {
            out.push(Broken { id, path, error });
        }
        if i % 25 == 0 || i + 1 == total {
            progress(i + 1, total);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn check_files(app: tauri::AppHandle, deep: bool) -> Result<Vec<Broken>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        check_core(&app.state::<AppState>(), deep, &move |d, t| {
            let _ = emitter.emit("check-progress", (d, t));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_missing_empty_garbage_and_truncated_files() {
        let dir = std::env::temp_dir().join("mz-check-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("thumbs")).unwrap();
        let lib = dir.join("lib");
        fs::create_dir_all(&lib).unwrap();
        let st = AppState {
            db: std::sync::Mutex::new(crate::open_db(&dir.join("t.db")).unwrap()),
            thumbs: dir.join("thumbs"),
            sidecar: std::sync::atomic::AtomicBool::new(true),
        };
        // Zdjęcie z szumem, żeby plik JPEG miał sporo danych do ucięcia.
        let mut img = image::RgbImage::new(200, 200);
        for (x, y, p) in img.enumerate_pixels_mut() { *p = image::Rgb([(x * 7 % 256) as u8, (y * 13 % 256) as u8, ((x * y) % 256) as u8]); }
        for n in ["ok.jpg", "pusty.jpg", "smiec.jpg", "ucięty.jpg", "znikniety.jpg"] {
            img.save(lib.join(n)).unwrap();
        }
        crate::scan_blocking(&st, lib.to_str().unwrap(), &|_| {}).unwrap();
        // Po skanowaniu psujemy pliki na dysku.
        fs::write(lib.join("pusty.jpg"), b"").unwrap();
        fs::write(lib.join("smiec.jpg"), b"to nie jest jpeg").unwrap();
        let full = fs::read(lib.join("ucięty.jpg")).unwrap();
        fs::write(lib.join("ucięty.jpg"), &full[..full.len() / 2]).unwrap();
        fs::remove_file(lib.join("znikniety.jpg")).unwrap();

        let quick = check_core(&st, false, &|_, _| {}).unwrap();
        let names = |v: &Vec<Broken>| -> Vec<String> { let mut n: Vec<String> = v.iter().map(|b| Path::new(&b.path).file_name().unwrap().to_string_lossy().to_string()).collect(); n.sort(); n };
        let q = names(&quick);
        assert!(q.contains(&"pusty.jpg".to_string()) && q.contains(&"smiec.jpg".to_string()) && q.contains(&"znikniety.jpg".to_string()), "{q:?}");
        assert!(!q.contains(&"ok.jpg".to_string()));
        // Dokładne sprawdzenie wykrywa także ucięty plik.
        let deep = check_core(&st, true, &|_, _| {}).unwrap();
        let d = names(&deep);
        assert!(d.contains(&"ucięty.jpg".to_string()) && !d.contains(&"ok.jpg".to_string()), "{d:?}");
        assert!(deep.iter().all(|b| !b.error.is_empty()));
    }
}
