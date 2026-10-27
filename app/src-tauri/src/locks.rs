//! Blokowanie folderów: w zablokowanym folderze (i jego podfolderach) FIBO nie zmienia, nie przenosi, nie usuwa ani nie nadpisuje zdjęć.
//! To ochrona przed przypadkowym zniszczeniem cennych zdjęć (np. archiwum rodzinnego). Kopiowanie i eksport nadal działają.

use std::path::Path;

use rusqlite::{params, Connection};
use tauri::State;

use crate::AppState;

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS locked_folders (path TEXT PRIMARY KEY);")
}

/// Czy ścieżka leży w zablokowanym folderze (dokładnie ten folder albo dowolny podfolder).
pub fn is_locked(conn: &Connection, path: &Path) -> bool {
    let sep = std::path::MAIN_SEPARATOR.to_string();
    let p = path.to_string_lossy().to_string();
    conn.query_row(
        "SELECT 1 FROM locked_folders WHERE ?1 = path OR substr(?1, 1, length(path) + 1) = path || ?2 LIMIT 1",
        params![p, sep],
        |_| Ok(()),
    )
    .is_ok()
}

pub fn ensure_unlocked(conn: &Connection, path: &Path) -> Result<(), String> {
    if is_locked(conn, path) {
        let folder = path.parent().unwrap_or(path).display();
        Err(format!("Folder jest zablokowany przed zmianami: {folder}. Odblokuj go w menu → Foldery."))
    } else {
        Ok(())
    }
}

pub fn ensure_unlocked_state(state: &AppState, path: &Path) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    ensure_unlocked(&conn, path)
}

#[tauri::command]
pub fn list_locked(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT path FROM locked_folders ORDER BY path").map_err(|e| e.to_string())?;
    let v = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(v)
}

#[tauri::command]
pub fn set_folder_locked(state: State<'_, AppState>, path: String, locked: bool) -> Result<(), String> {
    if path.is_empty() || path.chars().count() > 1000 {
        return Err("Nieprawidłowa ścieżka".into());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if locked {
        conn.execute("INSERT OR IGNORE INTO locked_folders (path) VALUES (?1)", [&path]).map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM locked_folders WHERE path = ?1", [&path]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_cover_subfolders_but_not_lookalike_names() {
        let c = Connection::open_in_memory().unwrap();
        init_schema(&c).unwrap();
        let sep = std::path::MAIN_SEPARATOR;
        let root = format!("{sep}foto{sep}rodzina");
        c.execute("INSERT INTO locked_folders (path) VALUES (?1)", [&root]).unwrap();
        assert!(is_locked(&c, Path::new(&format!("{root}{sep}a.jpg"))));
        assert!(is_locked(&c, Path::new(&format!("{root}{sep}2024{sep}b.jpg"))));
        assert!(!is_locked(&c, Path::new(&format!("{root}2{sep}a.jpg"))), "folder o podobnej nazwie nie jest zablokowany");
        assert!(!is_locked(&c, Path::new(&format!("{sep}foto{sep}inne{sep}a.jpg"))));
        assert!(ensure_unlocked(&c, Path::new(&format!("{root}{sep}a.jpg"))).is_err());
    }
}
