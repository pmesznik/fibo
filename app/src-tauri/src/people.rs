//! Osoby na zdjęciach: indeksowanie twarzy w tle, grupowanie w osoby i polecenia dla interfejsu.
//!
//! Zasady prywatności:
//! - wszystko dzieje się na tym komputerze, moduł nie używa sieci (pilnują tego testy bezpieczeństwa),
//! - funkcja jest domyślnie wyłączona i włącza ją użytkownik,
//! - wektory twarzy są w bazie zaszyfrowane kluczem konta Windows (DPAPI),
//! - imiona osób zostają tylko w bazie FIBO, nie trafiają do plików zdjęć ani XMP,
//! - jedno polecenie usuwa wszystkie dane twarzy (baza, wycinki twarzy, ustawienie).

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use image::{imageops::FilterType, DynamicImage, RgbImage};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, State};

use crate::faces::{cosine, normalize, Detection, Engine, EMB_LEN};
use crate::secure::{open_embedding, seal_embedding};
use crate::AppState;

const SETTING: &str = "faces-enabled";
const YUNET_SHA256: &str = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const SFACE_SHA256: &str = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79";
/// Najmniejsza twarz (w pikselach), jaką bierzemy pod uwagę: mniejsze dają niewiarygodne wektory.
const MIN_FACE_PX: f32 = 36.0;
const MIN_SCORE: f32 = 0.8;
/// Podobieństwo kosinusowe, od którego twarz trafia do istniejącej osoby (próg tożsamości SFace to ok. 0.36).
const JOIN_THRESHOLD: f32 = 0.42;
/// Większe zdjęcia są przed analizą zmniejszane (oszczędza pamięć i czas).
const MAX_SIDE: u32 = 2000;
const CROP_SIZE: u32 = 128;

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, name TEXT, ignored INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS faces (
            id INTEGER PRIMARY KEY, photo_id INTEGER NOT NULL, person_id INTEGER,
            x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, score REAL NOT NULL, emb BLOB NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id);
         CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id);
         CREATE TABLE IF NOT EXISTS face_scan (photo_id INTEGER PRIMARY KEY, scanned_mod INTEGER NOT NULL);",
    )?;
    // Migracja: twarz wybrana przez użytkownika jako okładka osoby (błąd „duplicate column” oznacza, że kolumna już jest).
    let _ = conn.execute("ALTER TABLE people ADD COLUMN cover_face INTEGER", []);
    Ok(())
}

pub fn crops_dir(thumbs: &Path) -> PathBuf {
    thumbs.join("faces")
}

static THUMBS_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_thumbs_dir(p: &Path) {
    let _ = THUMBS_DIR.set(p.to_path_buf());
}

/// Jak `forget_faces_of_photo`, z katalogiem miniatur ustawionym przy starcie programu.
pub fn forget_faces(conn: &Connection, photo_id: i64) {
    if let Some(t) = THUMBS_DIR.get() {
        forget_faces_of_photo(conn, t, photo_id);
    } else {
        let _ = conn.execute("DELETE FROM faces WHERE photo_id = ?1", [photo_id]);
        let _ = conn.execute("DELETE FROM face_scan WHERE photo_id = ?1", [photo_id]);
    }
}

/// Wywoływane, gdy zdjęcie znika z biblioteki: jego twarze i wycinki nie mogą zostać.
pub fn forget_faces_of_photo(conn: &Connection, thumbs: &Path, photo_id: i64) {
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM faces WHERE photo_id = ?1")
        .and_then(|mut s| s.query_map([photo_id], |r| r.get(0)).map(|r| r.filter_map(Result::ok).collect()))
        .unwrap_or_default();
    for id in ids {
        let _ = fs::remove_file(crops_dir(thumbs).join(format!("{id}.jpg")));
    }
    let _ = conn.execute("DELETE FROM faces WHERE photo_id = ?1", [photo_id]);
    let _ = conn.execute("DELETE FROM face_scan WHERE photo_id = ?1", [photo_id]);
    let _ = conn.execute("DELETE FROM people WHERE id NOT IN (SELECT person_id FROM faces WHERE person_id IS NOT NULL)", []);
}

fn enabled(conn: &Connection) -> bool {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [SETTING], |r| r.get::<_, String>(0)).map(|v| v == "1").unwrap_or(false)
}

fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

/// Wczytuje modele dołączone do programu i sprawdza ich sumy SHA256 (podmieniony model nie zostanie użyty).
fn load_engine(app: &tauri::AppHandle) -> Result<Engine, String> {
    let find = |name: &str| -> Result<Vec<u8>, String> {
        let mut candidates = Vec::new();
        if let Ok(p) = app.path().resolve(format!("models/{name}"), tauri::path::BaseDirectory::Resource) {
            candidates.push(p);
        }
        candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join(name));
        for c in candidates {
            if let Ok(b) = fs::read(&c) {
                return Ok(b);
            }
        }
        Err(format!("Brak modelu {name} w programie"))
    };
    let (y, s) = (find("yunet.onnx")?, find("sface.onnx")?);
    if sha256_hex(&y) != YUNET_SHA256 || sha256_hex(&s) != SFACE_SHA256 {
        return Err("Modele rozpoznawania twarzy mają niewłaściwą sumę kontrolną, nie używam ich".into());
    }
    Engine::new(&y, &s)
}

/// Obraz do analizy: zmniejszony i obrócony zgodnie ze znacznikiem EXIF (twarze muszą stać prosto).
fn load_oriented(path: &Path) -> Result<RgbImage, String> {
    let orientation = crate::read_exif(path).orientation;
    let mut img = image::open(path).map_err(|e| e.to_string())?;
    if img.width().max(img.height()) > MAX_SIDE {
        img = img.resize(MAX_SIDE, MAX_SIDE, FilterType::Triangle);
    }
    let img = match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        6 => img.rotate90(),
        8 => img.rotate270(),
        _ => img,
    };
    Ok(img.to_rgb8())
}

/// Kwadratowy wycinek twarzy z marginesem, do pokazania w oknie Ludzie.
fn crop_face(img: &RgbImage, d: &Detection) -> RgbImage {
    let side = (d.w.max(d.h) * 1.6).max(8.0);
    let (cx, cy) = (d.x + d.w / 2.0, d.y + d.h / 2.0);
    let x0 = (cx - side / 2.0).clamp(0.0, (img.width() as f32 - 1.0).max(0.0)) as u32;
    let y0 = (cy - side / 2.0).clamp(0.0, (img.height() as f32 - 1.0).max(0.0)) as u32;
    let w = (side as u32).min(img.width() - x0).max(1);
    let h = (side as u32).min(img.height() - y0).max(1);
    let sub = image::imageops::crop_imm(img, x0, y0, w, h).to_image();
    DynamicImage::ImageRgb8(sub).resize_to_fill(CROP_SIZE, CROP_SIZE, FilterType::Triangle).to_rgb8()
}

/// Środki osób (średnie znormalizowanych wektorów) do porównywania nowych twarzy.
struct Centroids {
    sums: HashMap<i64, Vec<f32>>,
}

impl Centroids {
    fn load(conn: &Connection) -> Result<Centroids, String> {
        let mut sums: HashMap<i64, Vec<f32>> = HashMap::new();
        let mut stmt = conn.prepare("SELECT person_id, emb FROM faces WHERE person_id IS NOT NULL").map_err(|e| e.to_string())?;
        let rows: Vec<(i64, Vec<u8>)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        for (pid, blob) in rows {
            if let Ok(v) = open_embedding(&blob) {
                let s = sums.entry(pid).or_insert_with(|| vec![0.0; EMB_LEN]);
                s.iter_mut().zip(&v).for_each(|(a, b)| *a += b);
            }
        }
        Ok(Centroids { sums })
    }

    /// Najbliższa osoba i podobieństwo.
    fn best(&self, emb: &[f32]) -> Option<(i64, f32)> {
        self.sums
            .iter()
            .map(|(id, sum)| {
                let mut c = sum.clone();
                normalize(&mut c);
                (*id, cosine(&c, emb))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
    }

    fn add(&mut self, id: i64, emb: &[f32]) {
        let s = self.sums.entry(id).or_insert_with(|| vec![0.0; EMB_LEN]);
        s.iter_mut().zip(emb).for_each(|(a, b)| *a += b);
    }
}

/// Twarz znaleziona na zdjęciu: prostokąt, wektor, wycinek i wymiary analizowanego obrazu.
type Found = (Detection, Vec<f32>, RgbImage, f32, f32);

/// Zapisuje twarze jednego zdjęcia: wektor zaszyfrowany, przypisanie do osoby (istniejącej albo nowej), wycinek i znacznik „przeanalizowano”.
fn store_faces(conn: &Connection, thumbs: &Path, centroids: &mut Centroids, photo_id: i64, modified: i64, found: Vec<Found>) -> Result<usize, String> {
    // Poprzednie twarze tego zdjęcia (po zmianie pliku) znikają razem z wycinkami.
    forget_faces_of_photo(conn, thumbs, photo_id);
    let mut n = 0;
    for (d, emb, crop, iw, ih) in found {
        let sealed = seal_embedding(&emb)?;
        let person = match centroids.best(&emb) {
            Some((pid, sim)) if sim >= JOIN_THRESHOLD => pid,
            _ => {
                conn.execute("INSERT INTO people (name) VALUES (NULL)", []).map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        centroids.add(person, &emb);
        conn.execute(
            "INSERT INTO faces (photo_id, person_id, x, y, w, h, score, emb) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![photo_id, person, d.x / iw, d.y / ih, d.w / iw, d.h / ih, d.score, sealed],
        )
        .map_err(|e| e.to_string())?;
        let face_id = conn.last_insert_rowid();
        let _ = crop.save_with_format(crops_dir(thumbs).join(format!("{face_id}.jpg")), image::ImageFormat::Jpeg);
        n += 1;
    }
    conn.execute("INSERT OR REPLACE INTO face_scan (photo_id, scanned_mod) VALUES (?1, ?2)", params![photo_id, modified]).map_err(|e| e.to_string())?;
    Ok(n)
}

#[derive(Serialize, Clone, Default)]
pub struct Progress {
    done: usize,
    total: usize,
    faces: usize,
    finished: bool,
    error: Option<String>,
}

/// Analizuje po kolei zdjęcia, które jeszcze nie były analizowane (lub zmieniły się od ostatniego razu).
/// Można przerwać w każdej chwili: już policzone zdjęcia zostają, następne uruchomienie kontynuuje.
fn index_blocking(app: &tauri::AppHandle) -> Result<Progress, String> {
    let state = app.state::<AppState>();
    let engine = load_engine(app)?;
    let todo: Vec<(i64, String, i64)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.path, p.modified FROM photos p LEFT JOIN face_scan f ON f.photo_id = p.id
                 WHERE p.hidden = 0 AND (f.photo_id IS NULL OR f.scanned_mod != p.modified) ORDER BY p.id",
            )
            .map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    let mut centroids = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        Centroids::load(&conn)?
    };
    fs::create_dir_all(crops_dir(&state.thumbs)).map_err(|e| e.to_string())?;
    let mut prog = Progress { total: todo.len(), ..Default::default() };
    for (id, path, modified) in todo {
        if CANCEL.load(Ordering::SeqCst) {
            break;
        }
        // Zdjęcia, których nie da się odczytać, zaznaczamy jako sprawdzone, żeby nie blokowały kolejnych uruchomień.
        let found = load_oriented(Path::new(&path)).ok().map(|img| {
            let dets = engine.detect(&img, MIN_SCORE).unwrap_or_default();
            let mut out = Vec::new();
            for d in dets.into_iter().filter(|d| d.w >= MIN_FACE_PX && d.h >= MIN_FACE_PX) {
                if let Ok(emb) = engine.embed(&img, &d) {
                    let crop = crop_face(&img, &d);
                    out.push((d, emb, crop, img.width() as f32, img.height() as f32));
                }
            }
            out
        });
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let still_there: bool = conn.query_row("SELECT 1 FROM photos WHERE id = ?1 AND hidden = 0", [id], |_| Ok(())).is_ok();
        if still_there {
            prog.faces += store_faces(&conn, &state.thumbs, &mut centroids, id, modified, found.unwrap_or_default())?;
        }
        drop(conn);
        prog.done += 1;
        if prog.done % 5 == 0 || prog.done == prog.total {
            let _ = app.emit("faces-progress", prog.clone());
        }
    }
    prog.finished = true;
    Ok(prog)
}

#[derive(Serialize)]
pub struct FacesStatus {
    enabled: bool,
    models_ok: bool,
    running: bool,
    photos: i64,
    scanned: i64,
    faces: i64,
    people: i64,
}

#[tauri::command]
pub fn faces_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<FacesStatus, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let n = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
    let models_ok = ["yunet.onnx", "sface.onnx"].iter().all(|m| {
        app.path().resolve(format!("models/{m}"), tauri::path::BaseDirectory::Resource).map(|p| p.exists()).unwrap_or(false)
            || Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join(m).exists()
    });
    Ok(FacesStatus {
        enabled: enabled(&conn),
        models_ok,
        running: BUSY.load(Ordering::SeqCst),
        photos: n("SELECT COUNT(*) FROM photos WHERE hidden = 0"),
        scanned: n("SELECT COUNT(*) FROM face_scan f JOIN photos p ON p.id = f.photo_id WHERE p.hidden = 0 AND f.scanned_mod = p.modified"),
        faces: n("SELECT COUNT(*) FROM faces"),
        people: n("SELECT COUNT(DISTINCT person_id) FROM faces f JOIN people p ON p.id = f.person_id WHERE p.ignored = 0"),
    })
}

#[tauri::command]
pub fn set_faces_enabled(state: State<'_, AppState>, on: bool) -> Result<(), String> {
    if !on {
        CANCEL.store(true, Ordering::SeqCst);
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)", params![SETTING, if on { "1" } else { "0" }]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Uruchamia analizę w tle (jeśli funkcja jest włączona i nic już nie działa).
#[tauri::command]
pub fn faces_start(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let on = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        enabled(&conn)
    };
    if !on {
        return Err("Rozpoznawanie twarzy jest wyłączone".into());
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    CANCEL.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let result = index_blocking(&app);
        BUSY.store(false, Ordering::SeqCst);
        let fin = match result {
            Ok(p) => p,
            Err(e) => Progress { finished: true, error: Some(e), ..Default::default() },
        };
        let _ = app.emit("faces-progress", fin);
    });
    Ok(true)
}

#[tauri::command]
pub fn faces_stop() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Usuwa wszystkie dane twarzy i wyłącza funkcję. Zdjęcia nie są ruszane.
#[tauri::command]
pub async fn faces_delete_all(state: State<'_, AppState>) -> Result<(), String> {
    CANCEL.store(true, Ordering::SeqCst);
    // Czekamy chwilę, aż analiza w tle zauważy przerwanie.
    for _ in 0..100 {
        if !BUSY.load(Ordering::SeqCst) {
            break;
        }
        tokio_sleep().await;
    }
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("DELETE FROM faces; DELETE FROM people; DELETE FROM face_scan; VACUUM;").map_err(|e| e.to_string())?;
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?1, '0')", [SETTING]).map_err(|e| e.to_string())?;
    }
    let dir = crops_dir(&state.thumbs);
    if dir.is_dir() {
        // Katalog zawiera wyłącznie wycinki twarzy utworzone przez FIBO.
        for e in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "jpg").unwrap_or(false) {
                let _ = fs::remove_file(p);
            }
        }
        let _ = fs::remove_dir(&dir);
    }
    Ok(())
}

async fn tokio_sleep() {
    tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(50))).await.ok();
}

#[derive(Serialize)]
pub struct Person {
    id: i64,
    name: Option<String>,
    count: i64,
    photos: i64,
    cover: Option<i64>,
    ignored: bool,
}

#[tauri::command]
pub fn list_people(state: State<'_, AppState>) -> Result<Vec<Person>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.ignored, COUNT(f.id), COUNT(DISTINCT f.photo_id),
                    COALESCE((SELECT f3.id FROM faces f3 WHERE f3.id = p.cover_face AND f3.person_id = p.id),
                             (SELECT f2.id FROM faces f2 WHERE f2.person_id = p.id ORDER BY f2.score * f2.w DESC LIMIT 1))
             FROM people p JOIN faces f ON f.person_id = p.id JOIN photos ph ON ph.id = f.photo_id AND ph.hidden = 0
             GROUP BY p.id ORDER BY (p.name IS NULL), COUNT(DISTINCT f.photo_id) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Person {
                id: r.get(0)?,
                name: r.get(1)?,
                ignored: r.get::<_, i64>(2)? != 0,
                count: r.get(3)?,
                photos: r.get(4)?,
                cover: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Wycinek twarzy (JPEG) przez IPC; id jest liczbą, więc nie da się wskazać dowolnego pliku.
#[tauri::command]
pub fn face_crop(state: State<'_, AppState>, id: i64) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(crops_dir(&state.thumbs).join(format!("{id}.jpg"))).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Twarze osoby (do wyboru okładki): od najpewniejszych, najwyżej 80.
#[tauri::command]
pub fn person_faces(state: State<'_, AppState>, id: i64) -> Result<Vec<i64>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT f.id FROM faces f JOIN photos p ON p.id = f.photo_id AND p.hidden = 0 WHERE f.person_id = ?1 ORDER BY f.score * f.w DESC LIMIT 80")
        .map_err(|e| e.to_string())?;
    let v = stmt.query_map([id], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(v)
}

/// Ustawia okładkę osoby; twarz musi należeć do tej osoby.
#[tauri::command]
pub fn set_person_cover(state: State<'_, AppState>, id: i64, face: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let ok: bool = conn.query_row("SELECT 1 FROM faces WHERE id = ?1 AND person_id = ?2", params![face, id], |_| Ok(())).is_ok();
    if !ok {
        return Err("Ta twarz nie należy do tej osoby".into());
    }
    conn.execute("UPDATE people SET cover_face = ?1 WHERE id = ?2", params![face, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Przenosi twarze danej osoby na jednym zdjęciu do innej osoby (poprawka błędnego rozpoznania) albo do nowej osoby (`to` = None).
pub fn reassign_core(conn: &Connection, photo_id: i64, from: i64, to: Option<i64>) -> Result<i64, String> {
    let target = match to {
        Some(t) => {
            if t == from {
                return Ok(t);
            }
            let exists: bool = conn.query_row("SELECT 1 FROM people WHERE id = ?1", [t], |_| Ok(())).is_ok();
            if !exists {
                return Err("Nie ma takiej osoby".into());
            }
            t
        }
        None => {
            conn.execute("INSERT INTO people (name) VALUES (NULL)", []).map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    let n = conn.execute("UPDATE faces SET person_id = ?3 WHERE photo_id = ?1 AND person_id = ?2", params![photo_id, from, target]).map_err(|e| e.to_string())?;
    if n == 0 {
        if to.is_none() {
            let _ = conn.execute("DELETE FROM people WHERE id = ?1", [target]);
        }
        return Err("Na tym zdjęciu nie ma twarzy tej osoby".into());
    }
    // Osoba bez twarzy znika (razem z imieniem, jeśli nie ma już nic do pokazania).
    conn.execute("DELETE FROM people WHERE id NOT IN (SELECT person_id FROM faces WHERE person_id IS NOT NULL)", []).map_err(|e| e.to_string())?;
    Ok(target)
}

#[tauri::command]
pub fn reassign_person_faces(state: State<'_, AppState>, photo_id: i64, from: i64, to: Option<i64>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    reassign_core(&conn, photo_id, from, to)
}

#[derive(Serialize)]
pub struct PhotoPerson {
    id: i64,
    name: Option<String>,
    face: i64,
}

/// Osoby rozpoznane na zdjęciu (bez pominiętych), z twarzą do pokazania na znaczku.
#[tauri::command]
pub fn photo_people(state: State<'_, AppState>, id: i64) -> Result<Vec<PhotoPerson>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, MIN(f.id) FROM faces f JOIN people p ON p.id = f.person_id
             WHERE f.photo_id = ?1 AND p.ignored = 0 GROUP BY p.id ORDER BY MIN(f.x)",
        )
        .map_err(|e| e.to_string())?;
    let v = stmt
        .query_map([id], |r| Ok(PhotoPerson { id: r.get(0)?, name: r.get(1)?, face: r.get(2)? }))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(v)
}

#[tauri::command]
pub fn person_photos(state: State<'_, AppState>, id: i64) -> Result<Vec<i64>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT f.photo_id FROM faces f JOIN photos p ON p.id = f.photo_id AND p.hidden = 0 WHERE f.person_id = ?1")
        .map_err(|e| e.to_string())?;
    let v = stmt.query_map([id], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(v)
}

#[tauri::command]
pub fn rename_person(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    let name: String = name.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(80).collect();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let value: Option<&str> = if name.is_empty() { None } else { Some(&name) };
    conn.execute("UPDATE people SET name = ?1 WHERE id = ?2", params![value, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Łączy dwie osoby (ta sama osoba rozpoznana jako dwie): twarze przechodzą do `into`.
#[tauri::command]
pub fn merge_people(state: State<'_, AppState>, from: i64, into: i64) -> Result<(), String> {
    if from == into {
        return Ok(());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE faces SET person_id = ?1 WHERE person_id = ?2", params![into, from]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE people SET name = COALESCE(name, (SELECT name FROM people WHERE id = ?2)) WHERE id = ?1", params![into, from]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM people WHERE id = ?1", [from]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Ukrywa osobę na liście Ludzie (np. przypadkowy przechodzień). Jej twarze zostają, żeby kolejne zdjęcia nie tworzyły jej od nowa.
#[tauri::command]
pub fn ignore_person(state: State<'_, AppState>, id: i64, ignored: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE people SET ignored = ?1 WHERE id = ?2", params![ignored as i64, id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE photos (id INTEGER PRIMARY KEY, hidden INTEGER NOT NULL DEFAULT 0);").unwrap();
        init_schema(&c).unwrap();
        c
    }

    #[test]
    fn disabled_by_default() {
        assert!(!enabled(&db()));
    }

    #[test]
    fn model_hashes_match_pinned_constants() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("models");
        if let (Ok(y), Ok(s)) = (fs::read(dir.join("yunet.onnx")), fs::read(dir.join("sface.onnx"))) {
            assert_eq!(sha256_hex(&y), YUNET_SHA256);
            assert_eq!(sha256_hex(&s), SFACE_SHA256);
        }
    }

    #[test]
    fn forgetting_a_photo_removes_its_faces_and_empty_people() {
        let c = db();
        let tmp = std::env::temp_dir().join("mz-people-test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(crops_dir(&tmp)).unwrap();
        c.execute("INSERT INTO photos (id) VALUES (1)", []).unwrap();
        c.execute("INSERT INTO people (id, name) VALUES (7, 'Ala')", []).unwrap();
        c.execute("INSERT INTO faces (id, photo_id, person_id, x, y, w, h, score, emb) VALUES (3, 1, 7, 0, 0, 1, 1, 1, x'00')", []).unwrap();
        c.execute("INSERT INTO face_scan (photo_id, scanned_mod) VALUES (1, 5)", []).unwrap();
        fs::write(crops_dir(&tmp).join("3.jpg"), b"x").unwrap();
        forget_faces_of_photo(&c, &tmp, 1);
        let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!((n("SELECT COUNT(*) FROM faces"), n("SELECT COUNT(*) FROM people"), n("SELECT COUNT(*) FROM face_scan")), (0, 0, 0));
        assert!(!crops_dir(&tmp).join("3.jpg").exists());
    }

    #[cfg(windows)]
    #[test]
    fn stored_faces_are_encrypted_grouped_and_forgotten() {
        let c = db();
        let tmp = std::env::temp_dir().join("mz-people-store-test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(crops_dir(&tmp)).unwrap();
        for id in 1..=3 {
            c.execute("INSERT INTO photos (id) VALUES (?1)", [id]).unwrap();
        }
        let mut cent = Centroids { sums: HashMap::new() };
        let unit = |i: usize| { let mut v = vec![0.0f32; EMB_LEN]; v[i] = 1.0; v };
        let det = || Detection { x: 10.0, y: 10.0, w: 50.0, h: 50.0, score: 0.95, lm: [(0.0, 0.0); 5] };
        let crop = || RgbImage::from_pixel(CROP_SIZE, CROP_SIZE, image::Rgb([200, 150, 100]));
        // Zdjęcia 1 i 2: ta sama osoba (prawie ten sam wektor), zdjęcie 3: inna.
        let mut near = unit(0);
        near[1] = 0.1;
        normalize(&mut near);
        store_faces(&c, &tmp, &mut cent, 1, 5, vec![(det(), unit(0), crop(), 200.0, 100.0)]).unwrap();
        store_faces(&c, &tmp, &mut cent, 2, 5, vec![(det(), near, crop(), 200.0, 100.0)]).unwrap();
        store_faces(&c, &tmp, &mut cent, 3, 5, vec![(det(), unit(5), crop(), 200.0, 100.0)]).unwrap();
        let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(n("SELECT COUNT(*) FROM faces"), 3);
        assert_eq!(n("SELECT COUNT(*) FROM people"), 2, "dwie osoby");
        assert_eq!(n("SELECT COUNT(*) FROM face_scan"), 3);
        // Wektor w bazie jest zaszyfrowany: nie zawiera jawnych liczb f32 wektora.
        let blob: Vec<u8> = c.query_row("SELECT emb FROM faces WHERE photo_id = 1", [], |r| r.get(0)).unwrap();
        let plain: Vec<u8> = unit(0).iter().flat_map(|x| x.to_le_bytes()).collect();
        assert_ne!(blob, plain);
        assert_eq!(open_embedding(&blob).unwrap(), unit(0));
        assert_eq!(fs::read_dir(crops_dir(&tmp)).unwrap().count(), 3);
        // Ponowna analiza zdjęcia nie dubluje twarzy.
        store_faces(&c, &tmp, &mut cent, 1, 6, vec![(det(), unit(0), crop(), 200.0, 100.0)]).unwrap();
        assert_eq!(n("SELECT COUNT(*) FROM faces WHERE photo_id = 1"), 1);
        // Usunięcie zdjęcia usuwa twarz, wycinek i osobę bez twarzy.
        forget_faces_of_photo(&c, &tmp, 3);
        assert_eq!(n("SELECT COUNT(*) FROM faces"), 2);
        assert_eq!(fs::read_dir(crops_dir(&tmp)).unwrap().count(), 2);
        assert_eq!(n("SELECT COUNT(*) FROM people"), 1);
    }

    #[test]
    fn reassigning_faces_moves_them_and_cleans_up() {
        let c = db();
        for id in 1..=2 {
            c.execute("INSERT INTO photos (id) VALUES (?1)", [id]).unwrap();
        }
        c.execute("INSERT INTO people (id, name) VALUES (1, 'Ala'), (2, 'Ola')", []).unwrap();
        for (fid, photo, person) in [(1, 1, 1), (2, 2, 1), (3, 2, 2)] {
            c.execute("INSERT INTO faces (id, photo_id, person_id, x, y, w, h, score, emb) VALUES (?1, ?2, ?3, 0, 0, 1, 1, 1, x'00')", params![fid, photo, person]).unwrap();
        }
        let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
        // Zdjęcie 2: twarz Ali to naprawdę Ola.
        assert_eq!(reassign_core(&c, 2, 1, Some(2)).unwrap(), 2);
        assert_eq!(n("SELECT COUNT(*) FROM faces WHERE person_id = 2"), 2);
        assert_eq!(n("SELECT COUNT(*) FROM faces WHERE person_id = 1"), 1);
        // Nowa osoba z jednej twarzy; zła osoba i brak twarzy dają błąd bez skutków ubocznych.
        let new = reassign_core(&c, 1, 1, None).unwrap();
        assert!(new > 2);
        assert_eq!(n("SELECT COUNT(*) FROM people WHERE id = 1"), 0, "Ala nie ma już twarzy, więc znika");
        assert!(reassign_core(&c, 1, 99, None).is_err());
        assert_eq!(n("SELECT COUNT(*) FROM people"), 2, "nieudana próba nie zostawia pustej osoby");
        assert!(reassign_core(&c, 1, new, Some(777)).is_err());
    }

    #[test]
    fn centroids_assign_similar_and_separate_different() {
        let mut c = Centroids { sums: HashMap::new() };
        let mut a = vec![0.0; EMB_LEN];
        a[0] = 1.0;
        let mut b = vec![0.0; EMB_LEN];
        b[1] = 1.0;
        assert!(c.best(&a).is_none());
        c.add(1, &a);
        let (id, sim) = c.best(&a).unwrap();
        assert!(id == 1 && sim > 0.99);
        assert!(c.best(&b).unwrap().1 < JOIN_THRESHOLD);
    }
}
