//! Pamięć podręczna miniatur: rozmiar i czyszczenie. Czyszczenie usuwa tylko miniatury zdjęć (nazwa „numer_data.jpg”), które program zrobi od nowa przy
//! następnym pokazaniu. Zostają wycinki twarzy, znak wodny i miniatury zdjęć z zapisaną edycją (ich edytowanego wyglądu nie da się odtworzyć bez edytora).

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::AppState;

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct CacheInfo {
    pub files: usize,
    pub bytes: u64,
}

/// Numer zdjęcia z nazwy miniatury „numer_data.jpg”; inne pliki to None.
fn thumb_id(name: &str) -> Option<i64> {
    let stem = name.strip_suffix(".jpg")?;
    let (id, modified) = stem.split_once('_')?;
    modified.parse::<i64>().ok()?;
    id.parse().ok()
}

/// Rozmiar miniatur w katalogu (bez podkatalogów i plików, które nie są miniaturami zdjęć).
pub fn info_core(dir: &Path) -> CacheInfo {
    let mut out = CacheInfo::default();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        if thumb_id(&e.file_name().to_string_lossy()).is_none() {
            continue;
        }
        if let Ok(m) = e.metadata() {
            if m.is_file() {
                out.files += 1;
                out.bytes += m.len();
            }
        }
    }
    out
}

/// Usuwa miniatury zdjęć poza `keep` (zdjęcia z zapisaną edycją). Zwraca, ile usunięto.
pub fn clear_core(dir: &Path, keep: &HashSet<i64>) -> CacheInfo {
    let mut out = CacheInfo::default();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let Some(id) = thumb_id(&e.file_name().to_string_lossy()) else { continue };
        if keep.contains(&id) {
            continue;
        }
        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
        if e.metadata().map(|m| m.is_file()).unwrap_or(false) && fs::remove_file(e.path()).is_ok() {
            out.files += 1;
            out.bytes += size;
        }
    }
    out
}

#[tauri::command]
pub fn thumb_cache_info(state: State<'_, AppState>) -> CacheInfo {
    info_core(&state.thumbs)
}

#[tauri::command]
pub fn thumb_cache_clear(state: State<'_, AppState>) -> Result<CacheInfo, String> {
    let keep: HashSet<i64> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT photo_id FROM edits").map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    Ok(clear_core(&state.thumbs, &keep))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_photo_thumbnails_are_counted_and_edited_ones_survive_clearing() {
        let dir = std::env::temp_dir().join("mz-cache-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("faces")).unwrap();
        for (n, size) in [("1_100.jpg", 10), ("2_200.jpg", 20), ("3_300.jpg", 30), ("watermark-text.png", 5), ("faces/9.jpg", 7), ("notes.jpg", 4), ("4_x.jpg", 4)] {
            fs::write(dir.join(n), vec![0u8; size]).unwrap();
        }
        assert_eq!(info_core(&dir), CacheInfo { files: 3, bytes: 60 });
        let removed = clear_core(&dir, &[2].into_iter().collect());
        assert_eq!(removed, CacheInfo { files: 2, bytes: 40 });
        assert!(dir.join("2_200.jpg").exists(), "miniatura zdjęcia z edycją zostaje");
        assert!(!dir.join("1_100.jpg").exists() && !dir.join("3_300.jpg").exists());
        for keep in ["watermark-text.png", "faces/9.jpg", "notes.jpg", "4_x.jpg"] {
            assert!(dir.join(keep).exists(), "{keep} nie jest miniaturą zdjęcia");
        }
        assert_eq!(info_core(&dir.join("brak")), CacheInfo::default());
    }
}
