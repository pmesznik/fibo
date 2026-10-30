//! Organizator plików: porządkuje wskazane zdjęcia w folderach według daty wykonania (rok, rok i miesiąc albo rok i dzień).
//! Najpierw plan do sprawdzenia (nic się nie dzieje na dysku), potem przeniesienie, a po nim jedno kliknięcie cofa całą partię.
//! Przeniesienie zawsze idzie przez wspólny mechanizm przenoszenia zdjęć: nic nie jest nadpisywane, blokady folderów są respektowane,
//! a plik XMP, edycja i kopia oryginału jadą razem ze zdjęciem.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{Manager, State};

use crate::{jobs, AppState};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Pattern {
    Year,
    YearMonth,
    YearDay,
}

pub fn parse_pattern(s: &str) -> Result<Pattern, String> {
    match s {
        "year" => Ok(Pattern::Year),
        "month" => Ok(Pattern::YearMonth),
        "day" => Ok(Pattern::YearDay),
        _ => Err("Nieznany układ folderów".into()),
    }
}

/// Podfoldery docelowe dla daty „RRRR-MM-DD”: „2023”, „2023/07” albo „2023/2023-07-14”.
pub fn subfolder(day: &str, p: Pattern) -> PathBuf {
    let (y, m) = (&day[0..4], &day[5..7]);
    match p {
        Pattern::Year => PathBuf::from(y),
        Pattern::YearMonth => Path::new(y).join(m),
        Pattern::YearDay => Path::new(y).join(day),
    }
}

/// Dzień „RRRR-MM-DD” z daty wykonania zdjęcia (EXIF albo film), a gdy jej nie ma, z daty pliku. Drugi element: czy użyto daty pliku.
pub fn day_of(taken: Option<&str>, modified: i64) -> (String, bool) {
    if let Some(t) = taken {
        let b = t.as_bytes();
        if b.len() >= 10 && (b[4] == b'-' || b[4] == b':') && (b[7] == b'-' || b[7] == b':') {
            let d: String = t.chars().take(10).map(|c| if c == ':' { '-' } else { c }).collect();
            let digits_ok = d.char_indices().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
            let (m, dd) = (d[5..7].parse::<u32>().unwrap_or(0), d[8..10].parse::<u32>().unwrap_or(0));
            if digits_ok && !d.starts_with("0000") && (1..=12).contains(&m) && (1..=31).contains(&dd) {
                return (d, false);
            }
        }
    }
    let (y, m, d) = crate::civil_from_days(modified.max(0) / 86400);
    (format!("{y:04}-{m:02}-{d:02}"), true)
}

#[derive(Serialize, Debug, Clone)]
pub struct PlanItem {
    pub id: i64,
    pub name: String,
    pub from_dir: String,
    /// Folder docelowy (pełna ścieżka).
    pub to_dir: String,
    /// Podfolder względem folderu docelowego do pokazania w podglądzie („2023/07”).
    pub rel: String,
    pub file_date: bool,
}

#[derive(Serialize, Debug, Default)]
pub struct Plan {
    pub moves: Vec<PlanItem>,
    /// Zdjęcia, które już leżą we właściwym folderze.
    pub in_place: usize,
    /// Zdjęcia pominięte i powód (zablokowany folder, brak pliku).
    pub skipped: Vec<(String, String)>,
    /// Ile przenoszonych zdjęć nie miało daty wykonania (użyto daty pliku).
    pub file_dates: usize,
}

/// Plan porządkowania: dla każdego zdjęcia docelowy folder wynikający z jego daty. Niczego nie zmienia na dysku ani w bazie.
pub fn plan_core(conn: &Connection, ids: &[i64], dest: &Path, pattern: Pattern) -> Result<Plan, String> {
    if !dest.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    let mut plan = Plan::default();
    let mut seen = std::collections::HashSet::new();
    for &id in ids {
        if !seen.insert(id) {
            continue;
        }
        let row: Option<(String, Option<String>, i64)> = conn.query_row("SELECT path, taken, modified FROM photos WHERE id = ?1 AND hidden = 0", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).ok();
        let Some((path, taken, modified)) = row else { continue };
        let src = Path::new(&path);
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !src.is_file() {
            plan.skipped.push((name, "pliku nie ma na dysku".into()));
            continue;
        }
        if crate::locks::is_locked(conn, src) {
            plan.skipped.push((name, "folder jest zablokowany przed zmianami".into()));
            continue;
        }
        let (day, file_date) = day_of(taken.as_deref(), modified);
        let rel = subfolder(&day, pattern);
        let to_dir = dest.join(&rel);
        if src.parent() == Some(to_dir.as_path()) {
            plan.in_place += 1;
            continue;
        }
        if file_date {
            plan.file_dates += 1;
        }
        plan.moves.push(PlanItem {
            id,
            name,
            from_dir: src.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            to_dir: to_dir.to_string_lossy().to_string(),
            rel: rel.to_string_lossy().replace('\\', "/"),
            file_date,
        });
    }
    Ok(plan)
}

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS organize_log (id INTEGER PRIMARY KEY AUTOINCREMENT, batch INTEGER NOT NULL, photo_id INTEGER NOT NULL, from_path TEXT NOT NULL, to_path TEXT NOT NULL);")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Serialize, Default)]
pub struct ApplyReport {
    pub batch: i64,
    pub done: usize,
    pub errors: Vec<String>,
}

/// Wykonuje plan: tworzy foldery i przenosi zdjęcia po jednym, zapisując każde przeniesienie w dzienniku (do cofnięcia).
pub fn apply_core(state: &AppState, plan: &Plan, dest: &Path) -> Result<ApplyReport, String> {
    let batch = now_ms();
    let mut rep = ApplyReport { batch, ..Default::default() };
    let canon_dest = std::fs::canonicalize(dest).map_err(|e| e.to_string())?;
    for (i, m) in plan.moves.iter().enumerate() {
        jobs::tick("organize", i, plan.moves.len());
        let to_dir = PathBuf::from(&m.to_dir);
        // Folder docelowy musi leżeć wewnątrz wskazanego folderu (żadnych „..” w planie).
        if !to_dir.starts_with(dest) || to_dir.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            rep.errors.push(format!("{}: zły folder docelowy", m.name));
            continue;
        }
        if let Err(e) = std::fs::create_dir_all(&to_dir) {
            rep.errors.push(format!("{}: {e}", m.name));
            continue;
        }
        if !std::fs::canonicalize(&to_dir).map(|c| c.starts_with(&canon_dest)).unwrap_or(false) {
            rep.errors.push(format!("{}: folder docelowy wychodzi poza wskazany folder", m.name));
            continue;
        }
        match crate::move_photo_to(state, m.id, &to_dir) {
            Ok(Some((from, to))) => {
                if let Ok(conn) = state.db.lock() {
                    let _ = conn.execute(
                        "INSERT INTO organize_log (batch, photo_id, from_path, to_path) VALUES (?1, ?2, ?3, ?4)",
                        params![batch, m.id, from.to_string_lossy(), to.to_string_lossy()],
                    );
                }
                rep.done += 1;
            }
            Ok(None) => {}
            Err(e) => rep.errors.push(format!("{}: {e}", m.name)),
        }
    }
    // Pamiętamy tylko kilka ostatnich partii.
    if let Ok(conn) = state.db.lock() {
        let _ = conn.execute("DELETE FROM organize_log WHERE batch NOT IN (SELECT DISTINCT batch FROM organize_log ORDER BY batch DESC LIMIT 5)", []);
    }
    Ok(rep)
}

#[derive(Serialize)]
pub struct LastBatch {
    pub batch: i64,
    pub count: i64,
}

pub fn last_batch(conn: &Connection) -> Option<LastBatch> {
    conn.query_row("SELECT batch, COUNT(*) FROM organize_log WHERE batch = (SELECT MAX(batch) FROM organize_log)", [], |r| Ok(LastBatch { batch: r.get(0)?, count: r.get(1)? })).ok().filter(|b| b.count > 0)
}

/// Cofa partię: każde zdjęcie wraca na swoje dawne miejsce, o ile nadal leży tam, gdzie je przeniesiono, a dawna ścieżka jest wolna.
pub fn undo_core(state: &AppState, batch: i64) -> Result<ApplyReport, String> {
    let rows: Vec<(i64, String, String)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT photo_id, from_path, to_path FROM organize_log WHERE batch = ?1 ORDER BY id DESC").map_err(|e| e.to_string())?;
        let v = stmt.query_map([batch], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    let mut rep = ApplyReport { batch, ..Default::default() };
    for (i, (id, from, to)) in rows.iter().enumerate() {
        jobs::tick("organize", i, rows.len());
        let (from_p, to_p) = (Path::new(from), Path::new(to));
        let name = from_p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let current: Option<String> = state.db.lock().ok().and_then(|c| c.query_row("SELECT path FROM photos WHERE id = ?1", [id], |r| r.get(0)).ok());
        if current.as_deref() != Some(to.as_str()) || !to_p.is_file() {
            rep.errors.push(format!("{name}: zdjęcie zostało w międzyczasie przeniesione lub usunięte, nie ruszam"));
            continue;
        }
        if from_p.exists() {
            rep.errors.push(format!("{name}: dawne miejsce jest zajęte, nie ruszam"));
            continue;
        }
        let Some(from_dir) = from_p.parent() else { continue };
        if let Err(e) = std::fs::create_dir_all(from_dir) {
            rep.errors.push(format!("{name}: {e}"));
            continue;
        }
        match crate::move_photo_exact(state, *id, from_p) {
            Ok(()) => {
                rep.done += 1;
                // Puste foldery po porządkowaniu znikają (tylko puste, od najgłębszego w górę).
                let mut dir = to_p.parent().map(Path::to_path_buf);
                while let Some(d) = dir {
                    // Pusty folder na kopie oryginałów (po przeniesieniu kopii z powrotem) też jest sprzątany.
                    let _ = std::fs::remove_dir(d.join(crate::ORIGINALS_DIR));
                    if std::fs::remove_dir(&d).is_err() {
                        break;
                    }
                    dir = d.parent().map(Path::to_path_buf);
                }
            }
            Err(e) => rep.errors.push(format!("{name}: {e}")),
        }
    }
    if let Ok(conn) = state.db.lock() {
        let _ = conn.execute("DELETE FROM organize_log WHERE batch = ?1", [batch]);
    }
    Ok(rep)
}

#[tauri::command]
pub fn organize_plan(state: State<'_, AppState>, ids: Vec<i64>, dest: String, pattern: String) -> Result<Plan, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    plan_core(&conn, &ids, Path::new(&dest), parse_pattern(&pattern)?)
}

#[tauri::command]
pub async fn organize_apply(app: tauri::AppHandle, ids: Vec<i64>, dest: String, pattern: String) -> Result<ApplyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _job = jobs::Guard::new("organize");
        let dest = PathBuf::from(dest);
        // Plan liczymy od nowa: nie ufamy ścieżkom z okna, a stan dysku mógł się zmienić od podglądu.
        let plan = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            plan_core(&conn, &ids, &dest, parse_pattern(&pattern)?)?
        };
        apply_core(&state, &plan, &dest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn organize_last(state: State<'_, AppState>) -> Result<Option<LastBatch>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(last_batch(&conn))
}

#[tauri::command]
pub async fn organize_undo(app: tauri::AppHandle, batch: i64) -> Result<ApplyReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = jobs::Guard::new("organize");
        undo_core(&app.state::<AppState>(), batch)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_use_exif_first_then_file_date_and_reject_nonsense() {
        assert_eq!(day_of(Some("2023-07-14 12:00:00"), 0), ("2023-07-14".to_string(), false));
        assert_eq!(day_of(Some("2023:07:14 12:00:00"), 0), ("2023-07-14".to_string(), false));
        // 1700000000 s od 1970 to 2023-11-14.
        assert_eq!(day_of(None, 1_700_000_000), ("2023-11-14".to_string(), true));
        for bad in ["0000-00-00 00:00:00", "brak daty", "2023-13-40 00:00:00", "20230714"] {
            assert!(day_of(Some(bad), 1_700_000_000).1, "{bad} powinno dać datę pliku");
        }
    }

    #[test]
    fn subfolders_follow_the_chosen_pattern() {
        assert_eq!(subfolder("2023-07-14", Pattern::Year), PathBuf::from("2023"));
        assert_eq!(subfolder("2023-07-14", Pattern::YearMonth), Path::new("2023").join("07"));
        assert_eq!(subfolder("2023-07-14", Pattern::YearDay), Path::new("2023").join("2023-07-14"));
        assert!(parse_pattern("year").is_ok() && parse_pattern("day").is_ok() && parse_pattern("../x").is_err());
    }
}
