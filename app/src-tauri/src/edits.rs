//! Edycja nieniszcząca: przepis na edycję (korekty, efekty, kadrowanie, napisy, ustawienia wywołania RAW) zapisany jako tekst JSON, a nie jako nowy plik.
//! Oryginalne zdjęcie nigdy się nie zmienia. Przepis leży w bazie i, gdy włączony jest zapis metadanych obok zdjęć, także w pliku
//! `<zdjęcie>.fibo.json`, więc przeżywa utratę biblioteki. Każdy zapis trafia też do historii (ostatnie 20 wersji), z której można go przywrócić po latach.
//! Program nie interpretuje treści przepisu (robi to edytor w oknie); sprawdza tylko, że to poprawny JSON o rozsądnym rozmiarze.

use std::{fs, path::{Path, PathBuf}};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::{locks, AppState};

/// Największy dopuszczalny przepis (napisy i dziesiątki poprawek mieszczą się w kilku KB; większy to nie jest edycja).
const MAX_RECIPE: usize = 256 * 1024;
const KEEP_VERSIONS: i64 = 20;
const SUFFIX: &str = ".fibo.json";

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS edits (photo_id INTEGER PRIMARY KEY, recipe TEXT NOT NULL, updated INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS edit_history (id INTEGER PRIMARY KEY AUTOINCREMENT, photo_id INTEGER NOT NULL, recipe TEXT NOT NULL, created INTEGER NOT NULL);
         CREATE INDEX IF NOT EXISTS idx_edit_history_photo ON edit_history(photo_id);",
    )
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn sidecar_path(photo: &Path) -> PathBuf {
    let mut s = photo.as_os_str().to_os_string();
    s.push(SUFFIX);
    PathBuf::from(s)
}

/// Sprawdza, że tekst jest obiektem JSON w dopuszczalnym rozmiarze.
pub fn validate_recipe(recipe: &str) -> Result<(), String> {
    if recipe.len() > MAX_RECIPE {
        return Err("Edycja jest za duża".into());
    }
    match serde_json::from_str::<serde_json::Value>(recipe) {
        Ok(v) if v.is_object() => Ok(()),
        _ => Err("Zły zapis edycji".into()),
    }
}

/// Zapisuje przepis edycji zdjęcia (baza i historia). Zwraca numer wersji w historii.
pub fn save_recipe(conn: &Connection, photo_id: i64, recipe: &str) -> Result<i64, String> {
    validate_recipe(recipe)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let t = now();
    tx.execute("INSERT OR REPLACE INTO edits (photo_id, recipe, updated) VALUES (?1, ?2, ?3)", params![photo_id, recipe, t]).map_err(|e| e.to_string())?;
    // Taki sam przepis jak ostatni w historii nie tworzy nowej wersji.
    let last: Option<String> = tx.query_row("SELECT recipe FROM edit_history WHERE photo_id = ?1 ORDER BY id DESC LIMIT 1", [photo_id], |r| r.get(0)).ok();
    let version = if last.as_deref() == Some(recipe) {
        tx.query_row("SELECT MAX(id) FROM edit_history WHERE photo_id = ?1", [photo_id], |r| r.get(0)).map_err(|e| e.to_string())?
    } else {
        tx.execute("INSERT INTO edit_history (photo_id, recipe, created) VALUES (?1, ?2, ?3)", params![photo_id, recipe, t]).map_err(|e| e.to_string())?;
        tx.last_insert_rowid()
    };
    tx.execute(
        "DELETE FROM edit_history WHERE photo_id = ?1 AND id NOT IN (SELECT id FROM edit_history WHERE photo_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![photo_id, KEEP_VERSIONS],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(version)
}

fn write_sidecar(photo: &Path, recipe: &str, updated: i64) -> Result<(), String> {
    let body = format!("{{\"fibo_edit\":1,\"updated\":{updated},\"recipe\":{recipe}}}\n");
    crate::write_atomic(&sidecar_path(photo), body.as_bytes())
}

/// Wczytuje przepis z pliku obok zdjęcia (tylko własny plik FIBO, z limitem rozmiaru).
pub fn read_sidecar(photo: &Path) -> Option<(String, i64)> {
    let p = sidecar_path(photo);
    if fs::metadata(&p).ok()?.len() as usize > MAX_RECIPE + 1024 {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&fs::read(&p).ok()?).ok()?;
    if v["fibo_edit"].as_i64() != Some(1) || !v["recipe"].is_object() {
        return None;
    }
    let recipe = v["recipe"].to_string();
    validate_recipe(&recipe).ok()?;
    Some((recipe, v["updated"].as_i64().unwrap_or(0)))
}

/// Przy dodaniu nowego zdjęcia do biblioteki: jeśli obok leży plik z edycją i zdjęcie jeszcze jej nie ma, wczytujemy ją.
pub fn import_sidecar(conn: &Connection, photo_id: i64, photo: &Path) {
    if let Some((recipe, updated)) = read_sidecar(photo) {
        let has: bool = conn.query_row("SELECT 1 FROM edits WHERE photo_id = ?1", [photo_id], |_| Ok(())).is_ok();
        if !has {
            let _ = conn.execute("INSERT INTO edits (photo_id, recipe, updated) VALUES (?1, ?2, ?3)", params![photo_id, recipe, updated]);
            let _ = conn.execute("INSERT INTO edit_history (photo_id, recipe, created) VALUES (?1, ?2, ?3)", params![photo_id, recipe, updated]);
        }
    }
}

fn path_of(conn: &Connection, id: i64) -> Result<String, String> {
    conn.query_row("SELECT path FROM photos WHERE id = ?1", [id], |r| r.get(0)).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct EditRecord {
    recipe: String,
    updated: i64,
}

#[tauri::command]
pub fn get_edit(state: State<'_, AppState>, id: i64) -> Result<Option<EditRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(conn.query_row("SELECT recipe, updated FROM edits WHERE photo_id = ?1", [id], |r| Ok(EditRecord { recipe: r.get(0)?, updated: r.get(1)? })).ok())
}

/// Zapisuje edycję zdjęcia nieniszcząco (baza, historia i plik obok zdjęcia, jeśli zapis metadanych jest włączony i folder nie jest zablokowany).
#[tauri::command]
pub fn save_edit_recipe(state: State<'_, AppState>, id: i64, recipe: String) -> Result<i64, String> {
    validate_recipe(&recipe)?;
    let (path, version) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let path = path_of(&conn, id)?;
        (path, save_recipe(&conn, id, &recipe)?)
    };
    if state.sidecar.load(std::sync::atomic::Ordering::Relaxed) {
        let p = Path::new(&path);
        let unlocked = state.db.lock().map(|c| !locks::is_locked(&c, p)).unwrap_or(false);
        if unlocked {
            // Błąd zapisu pliku obok zdjęcia (np. dysk tylko do odczytu) nie psuje zapisu w bazie.
            let _ = write_sidecar(p, &recipe, now());
        }
    }
    Ok(version)
}

/// Miniatura zdjęcia z naniesioną edycją, zrobiona w oknie programu: podmienia miniaturę w pamięci podręcznej, więc biblioteka pokazuje edytowaną wersję.
#[tauri::command]
pub fn put_edit_thumbnail(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych obrazu".into()) };
    let id: i64 = request.headers().get("id").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()).ok_or("zły id")?;
    if bytes.len() > 2 * 1024 * 1024 || bytes.len() < 4 || bytes[..3] != [0xFF, 0xD8, 0xFF] {
        return Err("miniatura musi być plikiem JPEG do 2 MB".into());
    }
    let (modified, has): (i64, bool) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let modified: i64 = conn.query_row("SELECT modified FROM photos WHERE id = ?1 AND video = 0", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        let has = conn.query_row("SELECT 1 FROM edits WHERE photo_id = ?1", [id], |_| Ok(())).is_ok();
        (modified, has)
    };
    // Miniaturę z edycją przyjmujemy tylko dla zdjęcia, które ją ma zapisaną.
    if !has {
        return Err("to zdjęcie nie ma zapisanej edycji".into());
    }
    let dst = state.thumbs.join(format!("{id}_{modified}.jpg"));
    crate::write_atomic(&dst, bytes)
}

/// Usuwa edycję zdjęcia (oryginał zostaje, jak był). Historia zostaje, więc edycję można przywrócić. Miniatura wróci do oryginału przy następnym pokazaniu.
#[tauri::command]
pub fn delete_edit(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let (path, modified) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let (path, modified): (String, i64) = conn.query_row("SELECT path, modified FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM edits WHERE photo_id = ?1", [id]).map_err(|e| e.to_string())?;
        (path, modified)
    };
    let _ = fs::remove_file(state.thumbs.join(format!("{id}_{modified}.jpg")));
    let side = sidecar_path(Path::new(&path));
    if side.is_file() && fs::read(&side).map(|b| b.starts_with(b"{\"fibo_edit\"")).unwrap_or(false) {
        let _ = fs::remove_file(side);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct EditVersion {
    id: i64,
    created: i64,
}

#[tauri::command]
pub fn list_edit_history(state: State<'_, AppState>, id: i64) -> Result<Vec<EditVersion>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, created FROM edit_history WHERE photo_id = ?1 ORDER BY id DESC").map_err(|e| e.to_string())?;
    let v = stmt.query_map([id], |r| Ok(EditVersion { id: r.get(0)?, created: r.get(1)? })).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(v)
}

/// Przepis z historii (tylko dla zdjęcia, do którego należy).
#[tauri::command]
pub fn get_edit_version(state: State<'_, AppState>, id: i64, version: i64) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT recipe FROM edit_history WHERE id = ?1 AND photo_id = ?2", params![version, id], |r| r.get(0)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_schema(&c).unwrap();
        c
    }

    #[test]
    fn recipes_must_be_small_json_objects() {
        assert!(validate_recipe("{\"v\":1}").is_ok());
        assert!(validate_recipe("[]").is_err());
        assert!(validate_recipe("nie json").is_err());
        assert!(validate_recipe("\"tekst\"").is_err());
        assert!(validate_recipe(&format!("{{\"a\":\"{}\"}}", "x".repeat(MAX_RECIPE))).is_err());
    }

    #[test]
    fn history_keeps_distinct_versions_dedupes_repeats_and_trims() {
        let c = db();
        let v1 = save_recipe(&c, 1, "{\"n\":1}").unwrap();
        let again = save_recipe(&c, 1, "{\"n\":1}").unwrap();
        assert_eq!(v1, again, "ten sam przepis nie tworzy nowej wersji");
        save_recipe(&c, 2, "{\"n\":99}").unwrap();
        for n in 2..=30 {
            save_recipe(&c, 1, &format!("{{\"n\":{n}}}")).unwrap();
        }
        let count: i64 = c.query_row("SELECT COUNT(*) FROM edit_history WHERE photo_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(count, KEEP_VERSIONS);
        let other: i64 = c.query_row("SELECT COUNT(*) FROM edit_history WHERE photo_id = 2", [], |r| r.get(0)).unwrap();
        assert_eq!(other, 1, "historia innego zdjęcia nietknięta");
        let cur: String = c.query_row("SELECT recipe FROM edits WHERE photo_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(cur, "{\"n\":30}");
        let oldest: String = c.query_row("SELECT recipe FROM edit_history WHERE photo_id = 1 ORDER BY id LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(oldest, "{\"n\":11}");
        assert!(save_recipe(&c, 1, "zepsute").is_err());
    }

    #[test]
    fn sidecar_roundtrip_imports_only_own_valid_files_and_only_once() {
        let dir = std::env::temp_dir().join("mz-edit-sidecar");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("a.jpg");
        fs::write(&photo, b"x").unwrap();
        write_sidecar(&photo, "{\"v\":1,\"adj\":{\"fill\":5}}", 1700).unwrap();
        assert!(sidecar_path(&photo).to_string_lossy().ends_with("a.jpg.fibo.json"));
        let (recipe, updated) = read_sidecar(&photo).unwrap();
        assert_eq!(updated, 1700);
        assert!(recipe.contains("\"fill\":5"));
        let c = db();
        import_sidecar(&c, 7, &photo);
        import_sidecar(&c, 7, &photo);
        assert_eq!(c.query_row::<i64, _, _>("SELECT COUNT(*) FROM edits", [], |r| r.get(0)).unwrap(), 1);
        assert_eq!(c.query_row::<i64, _, _>("SELECT COUNT(*) FROM edit_history", [], |r| r.get(0)).unwrap(), 1, "wczytanie dwa razy nie dubluje historii");
        // Cudzy lub zepsuty plik nie jest wczytywany.
        fs::write(sidecar_path(&photo), b"{\"cos\":1}").unwrap();
        assert!(read_sidecar(&photo).is_none());
        fs::write(sidecar_path(&photo), b"nie json").unwrap();
        assert!(read_sidecar(&photo).is_none());
        fs::write(sidecar_path(&photo), vec![b' '; MAX_RECIPE + 5000]).unwrap();
        assert!(read_sidecar(&photo).is_none(), "za duży plik pomijamy bez czytania");
    }
}
