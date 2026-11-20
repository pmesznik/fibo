//! Ochrona bazy biblioteki: sprawdzenie spójności przy starcie, cotygodniowa kopia automatyczna (trzy ostatnie, w folderze danych programu)
//! i scalenie dziennika WAL z bazą przy zamykaniu, żeby plik `library.db` zawsze sam zawierał całą bibliotekę.
//! Kopia i sprawdzenie używają osobnego połączenia tylko do odczytu, więc nie blokują programu.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use rusqlite::{Connection, OpenFlags};
use tauri::Emitter;

/// Podfolder folderu danych programu z kopiami automatycznymi.
pub const AUTO_DIR: &str = "kopie-automatyczne";
const PREFIX: &str = "fibo-auto";
/// Ile kopii automatycznych trzymamy.
pub const KEEP: usize = 3;
/// Co ile robimy nową kopię.
pub const EVERY: Duration = Duration::from_secs(7 * 86_400);

fn autos(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let mut v: Vec<(PathBuf, SystemTime)> = fs::read_dir(dir)
        .map(|d| {
            d.flatten()
                .filter(|e| e.file_name().to_string_lossy().starts_with(PREFIX))
                .filter_map(|e| Some((e.path(), e.metadata().ok()?.modified().ok()?)))
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v
}

/// Czy pora na kopię: brak kopii albo najnowsza jest starsza niż `EVERY`.
pub fn backup_due(dir: &Path, now: SystemTime) -> bool {
    match autos(dir).first() {
        None => true,
        Some((_, t)) => now.duration_since(*t).map(|d| d >= EVERY).unwrap_or(false),
    }
}

/// Usuwa najstarsze kopie automatyczne ponad `keep`. Innych plików w folderze nie rusza.
pub fn prune(dir: &Path, keep: usize) {
    for (p, _) in autos(dir).into_iter().skip(keep) {
        let _ = fs::remove_file(p);
    }
}

/// Szybkie sprawdzenie spójności bazy. Zwraca None, gdy wszystko w porządku, albo opis problemu.
pub fn check(conn: &Connection) -> Option<String> {
    match conn.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)) {
        Ok(s) if s == "ok" => None,
        Ok(s) => Some(s),
        Err(e) => Some(e.to_string()),
    }
}

/// Sprawdza bazę i, jeśli pora, zapisuje kopię automatyczną. Uszkodzonej bazy nie kopiujemy, żeby nie wypchnąć dobrych starszych kopii.
pub fn care(db: &Path, data_dir: &Path, now: SystemTime) -> Result<Option<PathBuf>, String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| e.to_string())?;
    if let Some(problem) = check(&conn) {
        return Err(problem);
    }
    let dir = data_dir.join(AUTO_DIR);
    if !backup_due(&dir, now) {
        return Ok(None);
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = crate::backup::backup_named(&conn, &dir, PREFIX, true)?;
    prune(&dir, KEEP);
    Ok(Some(file))
}

/// Po starcie programu (z opóźnieniem, żeby nie spowalniać wczytywania) sprawdza bazę i robi kopię. Problem trafia do okna jako zdarzenie `db-problem`.
pub fn start(app: tauri::AppHandle, db: PathBuf, data_dir: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(25));
        if let Err(problem) = care(&db, &data_dir, SystemTime::now()) {
            let _ = app.emit(
                "db-problem",
                format!("Baza biblioteki może być uszkodzona ({problem}). Nie usuwaj żadnych plików; kopie automatyczne są w folderze danych programu, w „{AUTO_DIR}”."),
            );
        }
    });
}

/// Przy zamykaniu programu przenosi dziennik WAL do pliku bazy i go opróżnia.
pub fn checkpoint(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_with_photos(path: &Path, n: i64) {
        let c = crate::open_db(path).unwrap();
        for i in 0..n {
            c.execute("INSERT INTO photos (path, folder, name, size, modified) VALUES (?1, 'C:\\x', 'a.jpg', 1, 1)", [format!("C:\\x\\{i}.jpg")]).unwrap();
        }
    }

    #[test]
    fn weekly_backup_keeps_three_newest_and_skips_damaged_database() {
        let dir = std::env::temp_dir().join("mz-dbcare");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("library.db");
        db_with_photos(&db, 5);

        let now = SystemTime::now();
        let first = care(&db, &dir, now).unwrap().expect("pierwsza kopia");
        let n: i64 = Connection::open(&first).unwrap().query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 5, "kopia zawiera bibliotekę");
        assert!(care(&db, &dir, now).unwrap().is_none(), "w tym samym tygodniu drugiej kopii nie robimy");
        assert!(!backup_due(&dir.join(AUTO_DIR), now + Duration::from_secs(86_400)));
        assert!(backup_due(&dir.join(AUTO_DIR), now + EVERY + Duration::from_secs(60)));

        // Starsze kopie: zostają trzy najnowsze, inne pliki w folderze nietknięte.
        let auto = dir.join(AUTO_DIR);
        fs::write(auto.join("notatka.txt"), "x").unwrap();
        for i in 0..4 {
            let p = auto.join(format!("{PREFIX}_stara{i}.db"));
            fs::write(&p, "x").unwrap();
            let f = fs::File::options().write(true).open(&p).unwrap();
            f.set_modified(now - Duration::from_secs(86_400 * (10 + i))).unwrap();
        }
        prune(&auto, KEEP);
        let left: Vec<String> = fs::read_dir(&auto).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(left.iter().filter(|n| n.starts_with(PREFIX)).count(), 3);
        assert!(left.iter().any(|n| n == &first.file_name().unwrap().to_string_lossy()), "najnowsza zostaje");
        assert!(left.contains(&"notatka.txt".to_string()));

        // Uszkodzona baza: błąd i żadnej nowej kopii.
        let bad = dir.join("zla.db");
        db_with_photos(&bad, 200);
        Connection::open(&bad).unwrap().execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        let mut bytes = fs::read(&bad).unwrap();
        let len = bytes.len();
        for b in &mut bytes[len / 2..len / 2 + 4096] {
            *b = 0xAB;
        }
        fs::write(&bad, bytes).unwrap();
        let before = fs::read_dir(&auto).unwrap().count();
        assert!(care(&bad, &dir, now + EVERY * 2).is_err());
        assert_eq!(fs::read_dir(&auto).unwrap().count(), before);
    }

    #[test]
    fn checkpoint_moves_wal_into_the_database_file() {
        let dir = std::env::temp_dir().join("mz-dbcare-wal");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("library.db");
        let c = crate::open_db(&db).unwrap();
        c.execute_batch("PRAGMA wal_autocheckpoint = 0;").unwrap();
        for i in 0..300 {
            c.execute("INSERT INTO photos (path, folder, name, size, modified) VALUES (?1, 'C:\\x', 'a.jpg', 1, 1)", [format!("C:\\x\\{i}.jpg")]).unwrap();
        }
        let wal = dir.join("library.db-wal");
        assert!(fs::metadata(&wal).unwrap().len() > 0);
        checkpoint(&c);
        assert_eq!(fs::metadata(&wal).map(|m| m.len()).unwrap_or(0), 0, "dziennik opróżniony");
        drop(c);
        // Sam plik bazy (bez dziennika) zawiera wszystko.
        let _ = fs::remove_file(&wal);
        let n: i64 = Connection::open(&db).unwrap().query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 300);
    }
}
