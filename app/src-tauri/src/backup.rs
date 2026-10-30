//! Kopia zapasowa biblioteki FIBO (baza: zdjęcia, tagi, oceny, albumy, osoby) i jej przywracanie.
//! Kopia nie zawiera zdjęć ani danych twarzy, tylko dane biblioteki (zdjęcia, tagi, oceny, albumy, obserwowane foldery).
//! Po przywróceniu analiza twarzy (jeśli włączona) liczy się od nowa.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tauri::State;

use crate::AppState;

/// Tabele biblioteki przenoszone w kopii (kolejność ma znaczenie tylko dla czytelności, nie ma kluczy obcych).
// Dane twarzy nie są w kopii dla użytkownika (FACE_TABLES): po przywróceniu numery zdjęć się zmieniają, a analiza twarzy i tak liczy się lokalnie od nowa.
const TABLES: [&str; 6] = ["photos", "tags", "photo_tags", "roots", "albums", "album_photos"];
// Tabele dodane później: starsze kopie ich nie mają, wtedy zostają bez zmian.
const OPTIONAL: [&str; 2] = ["props", "smart_albums"];

fn stamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (y, m, d) = crate::civil_from_days(secs / 86400);
    let rem = secs % 86400;
    format!("{y:04}-{m:02}-{d:02}_{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn unique_file(dir: &Path, base: &str) -> PathBuf {
    let first = dir.join(format!("{base}.db"));
    if !first.exists() {
        return first;
    }
    (1..).map(|n| dir.join(format!("{base}_{n}.db"))).find(|p| !p.exists()).unwrap_or(first)
}

/// Tabele z danymi twarzy: nie trafiają do kopii dla użytkownika (są w nich imiona osób, położenie twarzy i zaszyfrowane wektory).
const FACE_TABLES: [&str; 5] = ["faces", "people", "face_scan", "face_not", "clip_vec"];

/// Zapisuje spójną kopię bazy w podanym folderze (VACUUM INTO) bez danych twarzy. Nigdy nie nadpisuje istniejącego pliku.
pub fn backup_core(conn: &Connection, dest_dir: &Path) -> Result<PathBuf, String> {
    backup_named(conn, dest_dir, "fibo-biblioteka", false)
}

/// Kopia z wybraną nazwą. `with_faces` zostawia dane twarzy: tylko dla kopii bezpieczeństwa w folderze danych programu, która ma pozwolić cofnąć przywrócenie.
pub fn backup_named(conn: &Connection, dest_dir: &Path, base: &str, with_faces: bool) -> Result<PathBuf, String> {
    if !dest_dir.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    let target = unique_file(dest_dir, &format!("{base}_{}", stamp()));
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()]).map_err(|e| e.to_string())?;
    if !with_faces {
        let result = (|| -> Result<(), String> {
            let copy = Connection::open(&target).map_err(|e| e.to_string())?;
            for t in FACE_TABLES {
                copy.execute(&format!("DROP TABLE IF EXISTS {t}"), []).map_err(|e| e.to_string())?;
            }
            // Po usunięciu tabel plik wciąż zawiera ich strony, dopóki baza nie zostanie przepakowana.
            copy.execute_batch("VACUUM").map_err(|e| e.to_string())
        })();
        if let Err(e) = result {
            let _ = std::fs::remove_file(&target);
            return Err(format!("Nie udało się usunąć danych twarzy z kopii: {e}"));
        }
    }
    Ok(target)
}

fn columns(conn: &Connection, schema: &str, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}', '{schema}')")).map_err(|e| e.to_string())?;
    let v = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(v)
}

/// Kolumny do przeniesienia z kopii. Kopia starsza od programu może nie mieć kolumn dodanych później (np. ukrycie albumu): dostają wartości
/// domyślne. Kopia z kolumną, której program nie zna, pochodzi z nowszej wersji i jest odrzucana.
fn restore_columns(conn: &Connection, t: &str) -> Result<Vec<String>, String> {
    let (a, b) = (columns(conn, "main", t)?, columns(conn, "kopia", t)?);
    if b.iter().any(|c| !a.contains(c)) {
        return Err(format!("Kopia pochodzi z innej wersji programu (tabela {t} ma inne kolumny)"));
    }
    Ok(a.into_iter().filter(|c| b.contains(c)).collect())
}

/// Zastępuje dane biblioteki danymi z pliku kopii. Plik musi być bazą FIBO z tymi samymi tabelami i kolumnami (ta sama wersja programu).
/// Przed zastąpieniem aktualna biblioteka jest zapisywana w `safety_dir`, więc przywrócenie można cofnąć.
pub fn restore_core(conn: &mut Connection, file: &Path, safety_dir: &Path) -> Result<usize, String> {
    if !file.is_file() {
        return Err("Wskazany plik nie istnieje".into());
    }
    // Kopia bezpieczeństwa leży w folderze danych programu i zawiera też osoby, żeby przywrócenie dało się w pełni cofnąć. Trzymamy tylko najnowszą.
    let previous: Vec<PathBuf> = std::fs::read_dir(safety_dir)
        .map(|d| d.flatten().map(|e| e.path()).filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with("fibo-przed-przywroceniem_")).unwrap_or(false)).collect())
        .unwrap_or_default();
    let safety = backup_named(conn, safety_dir, "fibo-przed-przywroceniem", true)?;
    for old in previous {
        let _ = std::fs::remove_file(old);
    }
    let path = file.to_string_lossy().to_string();
    conn.execute("ATTACH DATABASE ?1 AS kopia", [&path]).map_err(|e| e.to_string())?;
    let result = (|| -> Result<usize, String> {
        // Sprawdzenie, czy to na pewno kopia FIBO tej samej wersji.
        for t in TABLES {
            if columns(conn, "kopia", t)?.is_empty() {
                return Err(format!("To nie jest kopia biblioteki FIBO (brak tabeli {t})"));
            }
            restore_columns(conn, t)?;
        }
        let optional: Vec<&str> = OPTIONAL.iter().copied().filter(|t| columns(conn, "kopia", t).map(|c| !c.is_empty()).unwrap_or(false)).collect();
        for t in &optional {
            restore_columns(conn, t)?;
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for t in TABLES.iter().chain(optional.iter()) {
            tx.execute(&format!("DELETE FROM main.{t}"), []).map_err(|e| e.to_string())?;
            let cols = restore_columns(&tx, t)?.join(", ");
            tx.execute(&format!("INSERT INTO main.{t} ({cols}) SELECT {cols} FROM kopia.{t}"), []).map_err(|e| e.to_string())?;
        }
        tx.execute_batch("DELETE FROM main.faces; DELETE FROM main.people; DELETE FROM main.face_scan;").map_err(|e| e.to_string())?;
        let n: i64 = tx.query_row("SELECT COUNT(*) FROM main.photos", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(n as usize)
    })();
    let _ = conn.execute("DETACH DATABASE kopia", []);
    result.map_err(|e| format!("{e}. Biblioteka nie została zmieniona (kopia bezpieczeństwa: {})", safety.display()))
}

#[tauri::command]
pub fn backup_library(state: State<'_, AppState>, dest: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    backup_core(&conn, Path::new(&dest)).map(|p| p.to_string_lossy().to_string())
}

/// Przywraca bibliotekę z kopii. Zwraca liczbę zdjęć w przywróconej bibliotece.
#[tauri::command]
pub fn restore_library(state: State<'_, AppState>, file: String) -> Result<usize, String> {
    let safety_dir = state.thumbs.parent().ok_or("brak folderu danych")?.to_path_buf();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let n = restore_core(&mut conn, Path::new(&file), &safety_dir)?;
    // Wycinki twarzy dotyczyły starej biblioteki.
    let crops = crate::people::crops_dir(&state.thumbs);
    if crops.is_dir() {
        for e in std::fs::read_dir(&crops).map_err(|e| e.to_string())?.flatten() {
            if e.path().extension().map(|x| x == "jpg").unwrap_or(false) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn lib() -> Connection {
        // Każdy test ma własny folder, bo testy działają równolegle.
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("mz-backup-test-lib-{}", N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        crate::open_db(&dir.join("t.db")).unwrap()
    }

    #[test]
    fn backup_and_restore_roundtrip_with_safety_copy() {
        let mut c = lib();
        let out = std::env::temp_dir().join("mz-backup-test-out");
        let safety = std::env::temp_dir().join("mz-backup-test-safety");
        for d in [&out, &safety] {
            let _ = std::fs::remove_dir_all(d);
            std::fs::create_dir_all(d).unwrap();
        }
        for i in 1..=3 {
            c.execute("INSERT INTO photos (path, folder, name, size, modified) VALUES (?1, 'f', ?2, 1, 1)", params![format!("f/{i}.jpg"), format!("{i}.jpg")]).unwrap();
        }
        c.execute("INSERT INTO tags (id, name) VALUES (1, 'morze')", []).unwrap();
        let file = backup_core(&c, &out).unwrap();
        assert!(file.is_file());
        // Druga kopia nie nadpisuje pierwszej.
        let second = backup_core(&c, &out).unwrap();
        assert_ne!(file, second);

        c.execute("DELETE FROM photos", []).unwrap();
        c.execute("DELETE FROM tags", []).unwrap();
        assert_eq!(restore_core(&mut c, &file, &safety).unwrap(), 3);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM tags WHERE name = 'morze'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        // Przed przywróceniem powstała kopia bezpieczeństwa (z pustą biblioteką).
        assert_eq!(std::fs::read_dir(&safety).unwrap().count(), 1);

        // Plik, który nie jest kopią FIBO, jest odrzucany, a biblioteka zostaje bez zmian.
        let bogus = out.join("cos.db");
        Connection::open(&bogus).unwrap().execute_batch("CREATE TABLE x (a INTEGER);").unwrap();
        assert!(restore_core(&mut c, &bogus, &safety).is_err());
        let n: i64 = c.query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 3);
        assert!(restore_core(&mut c, &out.join("brak.db"), &safety).is_err());
        assert!(backup_core(&c, &out.join("brak")).is_err());
    }

    #[test]
    fn user_backup_has_no_face_data_but_safety_copy_keeps_it() {
        let mut c = lib();
        let out = std::env::temp_dir().join("mz-backup-test-faces-out");
        let safety = std::env::temp_dir().join("mz-backup-test-faces-safety");
        for d in [&out, &safety] {
            let _ = std::fs::remove_dir_all(d);
            std::fs::create_dir_all(d).unwrap();
        }
        c.execute("INSERT INTO photos (id, path, folder, name, size, modified) VALUES (1, 'f/1.jpg', 'f', '1.jpg', 1, 1)", []).unwrap();
        c.execute("INSERT INTO people (id, name) VALUES (1, 'Jan Kowalski')", []).unwrap();
        c.execute("INSERT INTO faces (photo_id, person_id, x, y, w, h, score, emb) VALUES (1, 1, 0, 0, 1, 1, 1, x'0102')", []).unwrap();
        c.execute("INSERT INTO face_not (face_id, person_id) VALUES (1, 1)", []).unwrap();
        let file = backup_core(&c, &out).unwrap();
        let copy = Connection::open(&file).unwrap();
        for t in FACE_TABLES {
            let n: i64 = copy.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = ?1", [t], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "tabela {t} nie może być w kopii");
        }
        let bytes = std::fs::read(&file).unwrap();
        assert!(!bytes.windows(12).any(|w| w == b"Jan Kowalski"), "imię nie zostaje w wolnych stronach pliku");
        assert_eq!(copy.query_row::<i64, _, _>("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap(), 1);
        // Kopia bezpieczeństwa zachowuje osoby i jest tylko jedna.
        restore_core(&mut c, &file, &safety).unwrap();
        restore_core(&mut c, &file, &safety).unwrap();
        let files: Vec<_> = std::fs::read_dir(&safety).unwrap().flatten().collect();
        assert_eq!(files.len(), 1, "stara kopia bezpieczeństwa jest zastępowana");
    }


    #[test]
    fn restores_backup_made_before_a_column_was_added() {
        let mut c = lib();
        let out = std::env::temp_dir().join("mz-backup-test-old-out");
        let safety = std::env::temp_dir().join("mz-backup-test-old-safety");
        for d in [&out, &safety] {
            let _ = std::fs::remove_dir_all(d);
            std::fs::create_dir_all(d).unwrap();
        }
        c.execute("INSERT INTO albums (id, name) VALUES (1, 'Wakacje')", []).unwrap();
        let file = backup_core(&c, &out).unwrap();
        // Kopia sprzed wersji z ukrywaniem albumów nie ma kolumny `hidden`.
        Connection::open(&file).unwrap().execute("ALTER TABLE albums DROP COLUMN hidden", []).unwrap();
        c.execute("DELETE FROM albums", []).unwrap();
        restore_core(&mut c, &file, &safety).unwrap();
        let (name, hidden): (String, i64) = c.query_row("SELECT name, hidden FROM albums", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((name.as_str(), hidden), ("Wakacje", 0));
    }
}
