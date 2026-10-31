#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, File},
    io::BufReader,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};

mod backup;
mod calendar;
mod clip;
mod color;
mod formats;
mod jobs;
mod photos_backup;
mod rawdev;
mod rotate;
mod check;
mod cluster;
mod edits;
mod faces;
mod gallery;
mod locks;
mod organize;
mod places;
mod cache;
mod watcher;
mod quality;
mod ocr;
mod pdf;
mod people;
mod secure;
mod video;
mod watermark;

use image::imageops::FilterType;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

const THUMB_SIZE: u32 = 360;

struct AppState {
    db: Mutex<Connection>,
    thumbs: PathBuf,
    /// Czy zapisywać tagi, oceny i ulubione do plików XMP obok zdjęć (ustawienie z bazy).
    sidecar: AtomicBool,
}

#[derive(Serialize)]
struct Photo {
    id: i64,
    path: String,
    name: String,
    size: i64,
    modified: i64,
    taken: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    camera: Option<String>,
    rating: i64,
    favorite: bool,
    tags: Vec<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    albums: Vec<i64>,
    caption: Option<String>,
    exif: Option<String>,
    author: Option<String>,
    copyright: Option<String>,
    color: Option<i64>,
    /** Flaga selekcji: 1 wybrane, -1 odrzucone, 0 brak. */
    flag: i64,
    /** Etykieta kolorowa: 1 czerwona, 2 żółta, 3 zielona, 4 niebieska, 0 brak. */
    label: i64,
    /// Film (odtwarzany przez okno aplikacji), a nie zdjęcie.
    video: bool,
    /// Czas trwania filmu w sekundach.
    duration: Option<f64>,
    /// Zdjęcie ma zapisaną edycję nieniszczącą.
    edited: bool,
    /** Najbliższa miejscowość ze współrzędnych GPS (None = jeszcze nie ustalono, pusty tekst = brak w pobliżu) i kod kraju. */
    place: Option<String>,
    country: Option<String>,
    /** Pola IPTC wpisane przez użytkownika. */
    title: Option<String>,
    iptc_city: Option<String>,
    iptc_country: Option<String>,
    /** Ocena jakości (zob. quality.rs): ostrość, średnia jasność, odsetek prześwietlonych i czarnych pikseli. None = jeszcze nie oceniono. */
    q_sharp: Option<f64>,
    q_mean: Option<f64>,
    q_hi: Option<f64>,
    q_lo: Option<f64>,
}

fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // Tryb WAL: zapisy (np. analiza twarzy) nie blokują odczytów i są wielokrotnie szybsze niż domyślny dziennik. Dla bazy w pamięci pragma jest ignorowana.
    let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0)).unwrap_or_default();
    conn.execute_batch("PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            folder TEXT NOT NULL,
            name TEXT NOT NULL,
            size INTEGER NOT NULL,
            modified INTEGER NOT NULL,
            taken TEXT,
            width INTEGER,
            height INTEGER,
            camera TEXT,
            rating INTEGER NOT NULL DEFAULT 0,
            favorite INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_photos_folder ON photos(folder);
        CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS photo_tags (
            photo_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (photo_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag_id);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS roots (path TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS albums (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS album_photos (
            album_id INTEGER NOT NULL,
            photo_id INTEGER NOT NULL,
            PRIMARY KEY (album_id, photo_id)
        );
        CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos(photo_id);",
    )?;
    // Migracja: współrzędne GPS dla mapy. Błąd "duplicate column" oznacza, że kolumny już są.
    for col in ["lat", "lon"] {
        let _ = conn.execute(&format!("ALTER TABLE photos ADD COLUMN {col} REAL"), []);
    }
    // Migracja: skróty do wyszukiwania duplikatów (suma kontrolna pliku, hash percepcyjny, wersja pliku, dla której je policzono).
    for col in ["fhash", "dhash", "hashed_mod"] {
        let _ = conn.execute(&format!("ALTER TABLE photos ADD COLUMN {col} INTEGER"), []);
    }
    // Migracja: zdjęcia ukryte w bibliotece (pliki zostają na dysku, skan ich nie dodaje ponownie).
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0", []);
    // Migracja: filmy (znacznik i czas trwania w sekundach).
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN video INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN duration REAL", []);
    // Migracja: flagi selekcji (wybierz/odrzuć) i etykiety kolorowe, zapisywane też do XMP.
    for col in ["flag", "label"] {
        let _ = conn.execute(&format!("ALTER TABLE photos ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0"), []);
    }
    // Migracja: albumy ukryte (znikają z list, nic nie jest kasowane; można je przywrócić).
    let _ = conn.execute("ALTER TABLE albums ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0", []);
    // Migracja: własna kolejność zdjęć w albumie (puste = jeszcze nieustawiona, wtedy decyduje data).
    let _ = conn.execute("ALTER TABLE album_photos ADD COLUMN pos INTEGER", []);
    people::init_schema(&conn)?;
    clip::init_schema(&conn)?;
    edits::init_schema(&conn)?;
    organize::init_schema(&conn)?;
    places::init_schema(&conn)?;
    quality::init_schema(&conn)?;
    ocr::init_schema(&conn)?;
    locks::init_schema(&conn)?;
    // Albumy inteligentne: nazwa i zapisane filtry (JSON); zawartość liczy się na bieżąco z biblioteki.
    conn.execute_batch("CREATE TABLE IF NOT EXISTS smart_albums (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, filters TEXT NOT NULL);")?;
    // Właściwości albumów i folderów: opis, miejsce, data (rodzaj: "album" z numerem albumu albo "folder" ze ścieżką).
    conn.execute_batch("CREATE TABLE IF NOT EXISTS props (kind TEXT NOT NULL, key TEXT NOT NULL, description TEXT, place TEXT, date TEXT, PRIMARY KEY (kind, key));")?;
    // Migracja: lokalizacja ustawiona ręcznie ma pierwszeństwo przed danymi GPS z pliku.
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN geo_manual INTEGER NOT NULL DEFAULT 0", []);
    // Migracje: opis zdjęcia oraz data ustawiona ręcznie (ma pierwszeństwo przed datą z pliku).
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN caption TEXT", []);
    // Migracje: autor i prawa autorskie (zapisywane też w pliku XMP) oraz kolor dominujący (0 do 11, zob. color.rs).
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN author TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN copyright TEXT", []);
    // Migracja: pola IPTC wpisane przez użytkownika: tytuł oraz miejscowość i kraj (zapisywane też w pliku XMP).
    for col in ["title", "iptc_city", "iptc_country"] {
        let _ = conn.execute(&format!("ALTER TABLE photos ADD COLUMN {col} TEXT"), []);
    }
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN color INTEGER", []);
    // Migracja: tekst z danych EXIF (aparat, obiektyw, ISO, przysłona…) do szukania; uzupełnia się przy skanowaniu lub „Odśwież dane zdjęć”.
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN exif_text TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN taken_manual INTEGER NOT NULL DEFAULT 0", []);
    Ok(conn)
}

#[derive(Default)]
struct ExifInfo {
    taken: Option<String>,
    camera: Option<String>,
    orientation: u32,
    lat: Option<f64>,
    lon: Option<f64>,
    /// Słowa kluczowe i ocena zapisane w EXIF (np. „Tagi” i „Oceny” z Eksploratora Windows).
    keywords: Vec<String>,
    rating: i64,
    /// Najważniejsze dane EXIF jako jeden tekst do przeszukiwania (np. „Canon EOS R6 ISO 400 f/4”).
    summary: String,
}

/// Stopnie, minuty i sekundy z EXIF na stopnie dziesiętne; S i W dają wartość ujemną.
fn gps_coord(exif: &exif::Exif, tag: exif::Tag, ref_tag: exif::Tag) -> Option<f64> {
    let field = exif.get_field(tag, exif::In::PRIMARY)?;
    let exif::Value::Rational(v) = &field.value else { return None };
    if v.len() < 3 {
        return None;
    }
    let deg = v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0;
    let hemi = exif
        .get_field(ref_tag, exif::In::PRIMARY)
        .map(|f| f.display_value().to_string())
        .unwrap_or_default();
    Some(if hemi.contains('S') || hemi.contains('W') { -deg } else { deg })
}

fn read_exif(path: &Path) -> ExifInfo {
    let mut info = ExifInfo { taken: None, camera: None, orientation: 1, lat: None, lon: None, keywords: Vec::new(), rating: 0, summary: String::new() };
    let Ok(file) = File::open(path) else { return info };
    let Ok(exif) = exif::Reader::new().read_from_container(&mut BufReader::new(file)) else {
        return info;
    };
    let text = |tag| {
        exif.get_field(tag, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string().trim_matches('"').trim().to_string())
            .filter(|s| !s.is_empty())
    };
    info.taken = text(exif::Tag::DateTimeOriginal);
    info.summary = exif_summary(&exif);
    info.camera = text(exif::Tag::Model);
    info.orientation = exif
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1);
    let lat = gps_coord(&exif, exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef);
    let lon = gps_coord(&exif, exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef);
    // Współrzędne 0,0 to zwykle brak sygnału GPS, a nie punkt na Oceanie Atlantyckim.
    if let (Some(la), Some(lo)) = (lat, lon) {
        if la.abs() <= 90.0 && lo.abs() <= 180.0 && !(la == 0.0 && lo == 0.0) {
            info.lat = Some(la);
            info.lon = Some(lo);
        }
    }
    // Windows zapisuje „Tagi” jako XPKeywords (UTF-16, rozdzielone średnikami), a „Oceny” jako Rating (1-5)
    // albo RatingPercent (1, 25, 50, 75, 99).
    let tiff = |code: u16| exif::Tag(exif::Context::Tiff, code);
    if let Some(f) = exif.get_field(tiff(0x9C9E), exif::In::PRIMARY) {
        if let exif::Value::Byte(bytes) = &f.value {
            let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            info.keywords = String::from_utf16_lossy(&units)
                .trim_end_matches('\0')
                .split(';')
                .filter_map(norm_tag)
                .collect();
        }
    }
    let stars = exif.get_field(tiff(0x4746), exif::In::PRIMARY).and_then(|f| f.value.get_uint(0)).map(|v| v as i64);
    let percent = exif.get_field(tiff(0x4749), exif::In::PRIMARY).and_then(|f| f.value.get_uint(0)).map(|v| v as i64);
    info.rating = match (stars, percent) {
        (Some(s), _) if (1..=5).contains(&s) => s,
        (_, Some(p)) if p >= 1 => match p { 1..=12 => 1, 13..=37 => 2, 38..=62 => 3, 63..=87 => 4, _ => 5 },
        _ => 0,
    };
    info
}

fn is_photo(path: &Path) -> bool {
    formats::is_supported(path) || formats::is_video(path)
}

struct Row {
    path: String,
    folder: String,
    name: String,
    size: i64,
    modified: i64,
    exif: ExifInfo,
    dims: (Option<i64>, Option<i64>),
    /// Metadane z pliku XMP obok zdjęcia; wczytywane tylko dla zdjęć, których jeszcze nie ma w bibliotece.
    sidecar: Option<Sidecar>,
    video: bool,
    duration: Option<f64>,
}

/// Folder z kopiami oryginałów obok zdjęć (jak .picasaoriginals w Picasie).
const ORIGINALS_DIR: &str = ".originals";

fn build_row(path: &Path) -> Option<Row> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if formats::is_video(path) {
        // Film: data, rozmiar obrazu i czas z opisu MP4/MOV; zdjęciowych metadanych (EXIF) nie szukamy.
        let info = video::read_info(path).unwrap_or_default();
        let exif = ExifInfo { taken: info.taken.clone(), ..Default::default() };
        return Some(Row {
            path: path.to_string_lossy().to_string(),
            folder: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            size: meta.len() as i64,
            modified,
            exif,
            dims: (info.width.map(i64::from), info.height.map(i64::from)),
            sidecar: read_sidecar(path),
            video: true,
            duration: info.duration,
        });
    }
    let mut exif = read_exif(path);
    // Zdjęcia RAW często nie mają danych w formacie, który czyta biblioteka EXIF: data i aparat pochodzą wtedy z dekodera RAW.
    if formats::is_raw(path) && (exif.taken.is_none() || exif.camera.is_none()) {
        if let Some(rm) = formats::raw_meta(path) {
            exif.taken = exif.taken.or(rm.taken);
            exif.camera = exif.camera.or(rm.camera);
        }
    }
    let heic = matches!(formats::ext_of(path).as_str(), "heic" | "heif" | "hif");
    let (mut w, mut h) = formats::dimensions(path).map(|(w, h)| (Some(w as i64), Some(h as i64))).unwrap_or((None, None));
    // Orientacje 5-8 obracają zdjęcie o 90°, więc proporcje z nagłówka trzeba zamienić (HEIC ma obrót już uwzględniony w rozmiarze).
    if (5..=8).contains(&exif.orientation) && !heic {
        std::mem::swap(&mut w, &mut h);
    }
    // Metadane już zapisane w zdjęciu lub w pliku XMP (np. z innego programu).
    let embedded = read_metadata(path, Some(&exif));
    Some(Row {
        path: path.to_string_lossy().to_string(),
        folder: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        size: meta.len() as i64,
        modified,
        exif,
        dims: (w, h),
        sidecar: embedded,
        video: false,
        duration: None,
    })
}

fn flush(state: &AppState, rows: &mut Vec<Row>) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for r in rows.drain(..) {
        let existed = tx.query_row("SELECT 1 FROM photos WHERE path = ?1", [&r.path], |_| Ok(())).is_ok();
        // Ocena i ulubione zostają, gdy zdjęcie jest skanowane ponownie.
        tx.execute(
            "INSERT INTO photos (path, folder, name, size, modified, taken, width, height, camera, lat, lon, exif_text, video, duration)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(path) DO UPDATE SET video=?13, duration=?14, exif_text=?12, size=?4, modified=?5, taken=CASE WHEN taken_manual = 1 THEN taken ELSE ?6 END, width=?7, height=?8, camera=?9,
                 lat=CASE WHEN geo_manual = 1 THEN lat ELSE COALESCE(?10, lat) END, lon=CASE WHEN geo_manual = 1 THEN lon ELSE COALESCE(?11, lon) END,
                 place=CASE WHEN geo_manual = 1 OR ?10 IS NULL OR lat IS ?10 THEN place ELSE NULL END",
            params![r.path, r.folder, r.name, r.size, r.modified, r.exif.taken, r.dims.0, r.dims.1, r.exif.camera, r.exif.lat, r.exif.lon, r.exif.summary, r.video as i64, r.duration],
        )
        .map_err(|e| e.to_string())?;
        // Nowe zdjęcie z plikiem XMP: przywracamy jego tagi, ocenę i ulubione (np. po odtworzeniu biblioteki).
        if !existed {
            if let Some(sc) = &r.sidecar {
                let id: i64 = tx.query_row("SELECT id FROM photos WHERE path = ?1", [&r.path], |x| x.get(0)).map_err(|e| e.to_string())?;
                apply_sidecar(&tx, id, sc).map_err(|e| e.to_string())?;
            }
            // Edycja nieniszcząca zapisana obok zdjęcia (np. po odtworzeniu biblioteki).
            if let Ok(id) = tx.query_row("SELECT id FROM photos WHERE path = ?1", [&r.path], |x| x.get::<_, i64>(0)) {
                edits::import_sidecar(&tx, id, Path::new(&r.path));
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Zdjęcia, które już są w bibliotece w tej samej wersji pliku (ścieżka, rozmiar, data zmiany).
fn known_files(state: &AppState) -> Result<std::collections::HashSet<(String, i64, i64)>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT path, size, modified FROM photos").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Skanuje partiami po 64 zdjęcia; blokada bazy jest trzymana tylko podczas zapisu partii.
/// Pliki niezmienione od ostatniego skanu są pomijane, więc ponowne skanowanie dużego folderu jest szybkie.
/// Zwraca liczbę nowych lub zmienionych zdjęć.
fn scan_blocking(state: &AppState, root: &str, progress: &dyn Fn(usize)) -> Result<usize, String> {
    scan_blocking_stats(state, root, progress, &|_, _| {})
}

/// To samo co `scan_blocking`, a `stats(zrobione, razem)` dostaje też łączną liczbę plików do wczytania (znaną po szybkim przejściu po folderze),
/// z czego okno postępu liczy procenty i przybliżony czas do końca.
fn scan_blocking_stats(state: &AppState, root: &str, progress: &dyn Fn(usize), stats: &dyn Fn(usize, usize)) -> Result<usize, String> {
    let known = known_files(state)?;
    // Najpierw lista plików do wczytania (tanie: tylko nazwy i daty), żeby znać ich liczbę.
    let mut todo: Vec<PathBuf> = Vec::new();
    let walker = WalkDir::new(root).into_iter().filter_entry(|e| e.file_name() != ORIGINALS_DIR);
    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if !entry.file_type().is_file() || !formats::should_scan(path) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if known.contains(&(path.to_string_lossy().to_string(), meta.len() as i64, mtime_secs(&meta))) {
                continue;
            }
        }
        todo.push(path.to_path_buf());
    }
    let total = todo.len();
    stats(0, total);
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).clamp(1, 8);
    let mut count = 0;
    let mut done = 0;
    for chunk in todo.chunks(64) {
        // Odczyt EXIF i wymiarów to głównie praca procesora i dysku, więc partię wczytujemy na kilku wątkach.
        let mut rows: Vec<Row> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..threads.min(chunk.len()))
                .map(|t| s.spawn(move || chunk.iter().skip(t).step_by(threads).filter_map(|p| build_row(p)).collect::<Vec<Row>>()))
                .collect();
            handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
        });
        count += rows.len();
        flush(state, &mut rows)?;
        done += chunk.len();
        progress(count);
        stats(done, total);
    }
    Ok(count)
}

#[tauri::command]
async fn scan_folder(app: tauri::AppHandle, path: String, watch: Option<bool>) -> Result<usize, String> {
    // Skanowanie jest blokujące, więc nie powinno zajmować wątku interfejsu.
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        let state = app.state::<AppState>();
        // Dodany folder jest od teraz obserwowany (nowe zdjęcia pojawią się same), chyba że wybrano skan jednorazowy.
        if watch.unwrap_or(true) {
            add_root(&state, &path)?;
        }
        // Ręczne dodanie folderu przywraca jego zdjęcia ukryte wcześniej.
        state.db.lock().map_err(|e| e.to_string())?
            .execute("UPDATE photos SET hidden = 0 WHERE hidden = 1 AND substr(path, 1, length(?1)) = ?1", [&path])
            .map_err(|e| e.to_string())?;
        let stats_emitter = emitter.clone();
        scan_blocking_stats(&state, &path, &move |n| {
            let _ = emitter.emit("scan-progress", n);
        }, &move |done, total| {
            let _ = stats_emitter.emit("scan-stats", (done, total));
        })
    })
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Default, Debug)]
struct DropReport {
    folders: usize,
    files: usize,
    added: usize,
}

/// Dodaje do biblioteki to, co użytkownik upuścił na okno z Eksploratora: foldery (jak „Dodaj folder”, obserwowane) i pojedyncze pliki zdjęć.
/// Pliki innych rodzajów są pomijane, a łącze symboliczne nie jest śledzone.
fn add_dropped_blocking(state: &AppState, paths: &[String], progress: &dyn Fn(usize), stats: &dyn Fn(usize, usize)) -> Result<DropReport, String> {
    let mut rep = DropReport::default();
    let mut rows: Vec<Row> = Vec::new();
    for p in paths.iter().take(2000) {
        let path = Path::new(p);
        let Ok(meta) = fs::symlink_metadata(path) else { continue };
        if meta.is_dir() {
            add_root(state, p)?;
            state.db.lock().map_err(|e| e.to_string())?
                .execute("UPDATE photos SET hidden = 0 WHERE hidden = 1 AND substr(path, 1, length(?1)) = ?1", [p])
                .map_err(|e| e.to_string())?;
            rep.folders += 1;
            rep.added += scan_blocking_stats(state, p, progress, stats)?;
        } else if meta.is_file() && formats::should_scan(path) {
            rep.files += 1;
            if let Some(row) = build_row(path) {
                state.db.lock().map_err(|e| e.to_string())?
                    .execute("UPDATE photos SET hidden = 0 WHERE hidden = 1 AND path = ?1", [p])
                    .map_err(|e| e.to_string())?;
                rows.push(row);
            }
        }
    }
    rep.added += rows.len();
    flush(state, &mut rows)?;
    Ok(rep)
}

#[tauri::command]
async fn add_dropped(app: tauri::AppHandle, paths: Vec<String>) -> Result<DropReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        let state = app.state::<AppState>();
        let stats_emitter = emitter.clone();
        add_dropped_blocking(&state, &paths, &move |n| { let _ = emitter.emit("scan-progress", n); }, &move |done, total| { let _ = stats_emitter.emit("scan-stats", (done, total)); })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ponownie czyta metadane wszystkich zdjęć z dysku (GPS, wymiary po obrocie). Pliki, które zniknęły, zostają bez zmian.
#[tauri::command]
async fn refresh_library(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = jobs::Guard::new("refresh");
        let state = app.state::<AppState>();
        let paths: Vec<String> = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn.prepare("SELECT path FROM photos").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            rows
        };
        let mut batch = Vec::new();
        let mut count = 0;
        let total = paths.len();
        for (k, p) in paths.into_iter().enumerate() {
            if let Some(row) = build_row(Path::new(&p)) {
                batch.push(row);
                count += 1;
            }
            jobs::tick("refresh", k + 1, total);
            if batch.len() >= 50 {
                flush(&state, &mut batch)?;
                let _ = app.emit("scan-progress", count);
            }
        }
        flush(&state, &mut batch)?;
        let _ = app.emit("scan-progress", count);
        Ok(count)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_photos(state: State<'_, AppState>) -> Result<Vec<Photo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, name, size, modified, taken, width, height, camera, rating, favorite,
                    (SELECT group_concat(t.name, char(31)) FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
                     WHERE pt.photo_id = photos.id), lat, lon,
                    (SELECT group_concat(album_id) FROM album_photos WHERE photo_id = photos.id), caption, exif_text, author, copyright, color, flag, label, video, duration,
                    EXISTS(SELECT 1 FROM edits e WHERE e.photo_id = photos.id), place, country, title, iptc_city, iptc_country, q_sharp, q_mean, q_hi, q_lo
             FROM photos WHERE hidden = 0 ORDER BY COALESCE(taken, datetime(modified,'unixepoch')) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Photo {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                size: r.get(3)?,
                modified: r.get(4)?,
                taken: r.get(5)?,
                width: r.get(6)?,
                height: r.get(7)?,
                camera: r.get(8)?,
                rating: r.get(9)?,
                favorite: r.get::<_, i64>(10)? != 0,
                tags: r
                    .get::<_, Option<String>>(11)?
                    .map(|s| s.split('\u{1f}').map(str::to_string).collect())
                    .unwrap_or_default(),
                lat: r.get(12)?,
                lon: r.get(13)?,
                albums: r
                    .get::<_, Option<String>>(14)?
                    .map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect())
                    .unwrap_or_default(),
                caption: r.get(15)?,
                exif: r.get(16)?,
                author: r.get(17)?,
                copyright: r.get(18)?,
                color: r.get(19)?,
                flag: r.get(20)?,
                label: r.get(21)?,
                video: r.get::<_, i64>(22)? != 0,
                duration: r.get(23)?,
                edited: r.get::<_, i64>(24)? != 0,
                place: r.get(25)?,
                country: r.get(26)?,
                title: r.get(27)?,
                iptc_city: r.get(28)?,
                iptc_country: r.get(29)?,
                q_sharp: r.get(30)?,
                q_mean: r.get(31)?,
                q_hi: r.get(32)?,
                q_lo: r.get(33)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// JPEG dekodowany od razu w zmniejszeniu (skala 1/2, 1/4, 1/8 pomija część pracy): kilka razy szybciej niż pełne dekodowanie.
/// Wynik ma dłuższy bok co najmniej `want` pikseli. None, gdy to nie JPEG albo dekoder go nie obsługuje.
fn decode_jpeg_for_thumb(path: &Path, want: u16) -> Option<image::DynamicImage> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if ext != "jpg" && ext != "jpeg" {
        return None;
    }
    let mut dec = jpeg_decoder::Decoder::new(std::io::BufReader::new(File::open(path).ok()?));
    dec.read_info().ok()?;
    let info = dec.info()?;
    let (rw, rh) = if info.width >= info.height {
        (want, ((info.height as u32 * want as u32) / info.width.max(1) as u32).max(1) as u16)
    } else {
        (((info.width as u32 * want as u32) / info.height.max(1) as u32).max(1) as u16, want)
    };
    dec.scale(rw, rh).ok()?;
    let pixels = dec.decode().ok()?;
    let info = dec.info()?;
    let (w, h) = (info.width as u32, info.height as u32);
    match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => image::RgbImage::from_raw(w, h, pixels).map(image::DynamicImage::ImageRgb8),
        jpeg_decoder::PixelFormat::L8 => image::GrayImage::from_raw(w, h, pixels).map(image::DynamicImage::ImageLuma8),
        _ => None,
    }
}

fn make_thumb(src: &Path, dst: &Path) -> Result<(), String> {
    make_thumb_dims(src, dst).map(|_| ())
}

/// Robi miniaturę i zwraca rozmiar zdjęcia po ustawieniu prosto (None, gdy użyto szybkiego dekodowania JPEG, które go nie zna).
fn make_thumb_dims(src: &Path, dst: &Path) -> Result<Option<(u32, u32)>, String> {
    let (thumb, dims) = if let Some(img) = decode_jpeg_for_thumb(src, THUMB_SIZE as u16) {
        let orientation = read_exif(src).orientation;
        (formats::orient(img.resize(THUMB_SIZE, THUMB_SIZE, FilterType::Triangle), orientation as u16), None)
    } else {
        let (img, orientation) = formats::open_preview(src)?;
        let img = formats::orient(img, orientation);
        let dims = Some((img.width(), img.height()));
        (img.resize(THUMB_SIZE, THUMB_SIZE, FilterType::Triangle), dims)
    };
    thumb.to_rgb8().save_with_format(dst, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
    Ok(dims)
}

/// Zwraca ścieżkę miniatury z pamięci podręcznej, tworząc ją przy pierwszym użyciu.
#[tauri::command]
async fn thumbnail(state: State<'_, AppState>, id: i64) -> Result<String, String> {
    let (src, modified): (String, i64) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT path, modified FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
    };
    let dst = state.thumbs.join(format!("{id}_{modified}.jpg"));
    if !dst.exists() {
        // Miniatury powstają po kilka naraz, a nie wszystkie od razu: przy tysiącach zdjęć cały procesor i pamięć
        // zajęłyby setki równoległych dekodowań i program przestawał odpowiadać.
        static SLOTS: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
        let slots = SLOTS.get_or_init(|| tokio::sync::Semaphore::new(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).clamp(2, 6)));
        let _permit = slots.acquire().await.map_err(|e| e.to_string())?;
        // W kolejce ktoś inny mógł już zrobić tę miniaturę.
        if !dst.exists() {
            let dst2 = dst.clone();
            tauri::async_runtime::spawn_blocking(move || {
                // Najpierw plik tymczasowy: przerwane zapisywanie nie zostawi uciętej miniatury.
                let tmp = dst2.with_extension("tmp");
                let dims = make_thumb_dims(Path::new(&src), &tmp)?;
                fs::rename(&tmp, &dst2).map_err(|e| e.to_string())?;
                Ok::<_, String>((dims, color::dominant_of_file(&dst2)))
            })
            .await
            .map_err(|e| e.to_string())?
            .map(|(dims, dominant)| {
                if let (Some(c), Ok(conn)) = (dominant, state.db.lock()) {
                    let _ = conn.execute("UPDATE photos SET color = ?2 WHERE id = ?1", params![id, c]);
                }
                // Formaty bez taniego odczytu rozmiaru (RAW, JPEG XL) dostają go przy pierwszej miniaturze: siatka układa je wtedy w dobrych proporcjach.
                if let Some((w, h)) = dims {
                    if let Ok(conn) = state.db.lock() {
                        let _ = conn.execute("UPDATE photos SET width = ?2, height = ?3 WHERE id = ?1 AND (width IS NOT ?2 OR height IS NOT ?3)", params![id, w as i64, h as i64]);
                    }
                }
            })?;
        }
    }
    Ok(dst.to_string_lossy().to_string())
}

/// Miniatura zrobiona w oknie aplikacji dla formatów bez dekodera w programie (AVIF, SVG): zapisujemy ją w pamięci podręcznej, żeby nie robić jej za każdym razem.
/// Przyjmujemy tylko JPEG o rozsądnym rozmiarze i tylko dla formatów, których program sam nie dekoduje.
#[tauri::command]
fn put_thumbnail(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych obrazu".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let id: i64 = header("id").parse().map_err(|_| "zły id")?;
    let (w, h): (i64, i64) = (header("width").parse().map_err(|_| "zła szerokość")?, header("height").parse().map_err(|_| "zła wysokość")?);
    if !(1..=100_000).contains(&w) || !(1..=100_000).contains(&h) {
        return Err("zły rozmiar zdjęcia".into());
    }
    if bytes.len() > 2 * 1024 * 1024 || bytes.len() < 4 || bytes[..3] != [0xFF, 0xD8, 0xFF] {
        return Err("miniatura musi być plikiem JPEG do 2 MB".into());
    }
    let (src, modified): (String, i64) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT path, modified FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
    };
    if !formats::ui_only(Path::new(&src)) {
        return Err("ten format ma miniaturę z programu".into());
    }
    let dst = state.thumbs.join(format!("{id}_{modified}.jpg"));
    let tmp = dst.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE photos SET width = ?2, height = ?3 WHERE id = ?1", params![id, w, h]).map_err(|e| e.to_string())?;
    if let Some(c) = color::dominant_of_file(&dst) {
        let _ = conn.execute("UPDATE photos SET color = ?2 WHERE id = ?1", params![id, c]);
    }
    Ok(())
}

/// Bajty miniatury przez IPC (bez protokołu asset i bez dostępu okna do plików na dysku).
#[tauri::command]
async fn thumbnail_data(state: State<'_, AppState>, id: i64) -> Result<tauri::ipc::Response, String> {
    let path = thumbnail(state.clone(), id).await?;
    Ok(tauri::ipc::Response::new(fs::read(path).map_err(|e| e.to_string())?))
}

fn photo_path(state: &AppState, id: i64) -> Result<(String, Option<String>, Option<String>), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT path, taken, camera FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())
}

/// Wpisuje plik do biblioteki; dane z EXIF oryginału zostają, bo edytor je gubi przy zapisie.
fn reindex(state: &AppState, path: &Path, taken: Option<String>, camera: Option<String>) -> Result<i64, String> {
    let mut row = build_row(path).ok_or("nie można odczytać zapisanego pliku")?;
    row.exif.taken = row.exif.taken.or(taken);
    row.exif.camera = row.exif.camera.or(camera);
    flush(state, &mut vec![row])?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT id FROM photos WHERE path = ?1", [path.to_string_lossy()], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Zapis edycji. Nagłówki: id, mode ("overwrite" | "copy"), ext. Ciało: bajty obrazu.
/// Przy nadpisaniu oryginał trafia najpierw do .originals (tylko za pierwszym razem).
#[tauri::command]
fn save_edit(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<i64, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych obrazu".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let id: i64 = header("id").parse().map_err(|_| "zły id")?;
    let (path, taken, camera) = photo_path(&state, id)?;
    let path = PathBuf::from(path);
    let dir = path.parent().ok_or("brak folderu")?.to_path_buf();
    let ext = match header("ext").as_str() { "png" => "png", "webp" => "webp", _ => "jpg" };
    // Nadpisać można tylko plik w tym samym formacie (JPEG, PNG, WebP). Zdjęcie w innym formacie (HEIC, RAW, TIFF, PSD...) zawsze zostaje
    // nietknięte, a edycja trafia do nowej kopii: inaczej bajty JPEG wylądowałyby w pliku o innym rozszerzeniu i zniszczyły oryginał.
    let copy_only = formats::rewritable_ext(&path) != Some(ext);
    if header("mode") == "overwrite" && !copy_only {
        locks::ensure_unlocked_state(&state, &path)?;
    }

    let target = if header("mode") == "copy" || copy_only {
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let mut n = 0;
        loop {
            let name = if n == 0 { format!("{stem}_edit.{ext}") } else { format!("{stem}_edit{n}.{ext}") };
            let candidate = dir.join(name);
            if !candidate.exists() { break candidate; }
            n += 1;
        }
    } else {
        let backup = dir.join(ORIGINALS_DIR).join(path.file_name().ok_or("brak nazwy")?);
        ensure_original_backup(&path, &backup)?;
        path.clone()
    };
    write_atomic(&target, bytes)?;
    reindex(&state, &target, taken, camera)
}

/// Zapis kolażu jako nowego pliku obok zdjęcia `id`. Nagłówki: id, name (sam plik, bez folderu).
#[tauri::command]
fn save_collage(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<i64, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych obrazu".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let id: i64 = header("id").parse().map_err(|_| "zły id")?;
    let (path, taken, camera) = photo_path(&state, id)?;
    let dir = Path::new(&path).parent().ok_or("brak folderu")?.to_path_buf();
    // Tylko nazwa pliku ASCII, żeby nagłówek HTTP i ścieżka były bezpieczne.
    let name: String = header("name").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let name = if name.is_empty() { "kolaz".to_string() } else { name };
    let mut target = dir.join(format!("{name}.jpg"));
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{name}_{n}.jpg"));
        n += 1;
    }
    fs::write(&target, bytes).map_err(|e| e.to_string())?;
    reindex(&state, &target, taken, camera)
}

/// Surowe bajty zdjęcia dla edytora (pomija CORS protokołu asset).
/// Plik muzyczny do pokazu slajdów (tylko znane rozszerzenia dźwięku, do 80 MB), przekazany jako bajty; nic nie jest wysyłane w sieć.
#[tauri::command]
fn read_audio(path: String) -> Result<tauri::ipc::Response, String> {
    let p = Path::new(&path);
    let ok = p.extension().and_then(|e| e.to_str()).map(|e| ["mp3", "m4a", "aac", "ogg", "oga", "wav", "flac"].contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false);
    if !ok {
        return Err("To nie jest obsługiwany plik muzyczny (mp3, m4a, aac, ogg, wav, flac)".into());
    }
    let meta = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("To nie jest zwykły plik".into());
    }
    if meta.len() > 80 * 1024 * 1024 {
        return Err("Plik muzyczny jest za duży (limit 80 MB)".into());
    }
    Ok(tauri::ipc::Response::new(fs::read(p).map_err(|e| e.to_string())?))
}

#[tauri::command]
async fn read_image(state: State<'_, AppState>, id: i64) -> Result<tauri::ipc::Response, String> {
    let (path, _, _) = photo_path(&state, id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || display_bytes(Path::new(&path))).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Bajty obrazu, które okno aplikacji potrafi wyświetlić: oryginalny plik (JPEG, PNG, WebP, AVIF, SVG...) albo, dla pozostałych formatów
/// (TIFF, HEIC, RAW, PSD, JPEG XL...), obraz przekonwertowany po stronie programu do JPEG (z przezroczystością do PNG). Plik na dysku się nie zmienia.
fn display_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if formats::passes_through(path) {
        return fs::read(path).map_err(|e| e.to_string());
    }
    let img = formats::open_upright(path)?;
    let mut out = std::io::Cursor::new(Vec::new());
    if img.color().has_alpha() {
        img.write_to(&mut out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    } else {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 92).encode_image(&img.to_rgb8()).map_err(|e| e.to_string())?;
    }
    Ok(out.into_inner())
}

#[tauri::command]
fn has_original(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
    let (path, _, _) = photo_path(&state, id)?;
    let p = Path::new(&path);
    Ok(p.parent().zip(p.file_name()).map(|(d, n)| d.join(ORIGINALS_DIR).join(n).exists()).unwrap_or(false))
}

#[tauri::command]
fn restore_original(state: State<'_, AppState>, id: i64) -> Result<i64, String> {
    let (path, taken, camera) = photo_path(&state, id)?;
    let p = Path::new(&path);
    locks::ensure_unlocked_state(&state, p)?;
    let backup = p.parent().zip(p.file_name()).map(|(d, n)| d.join(ORIGINALS_DIR).join(n)).ok_or("brak ścieżki")?;
    if !backup.exists() {
        return Err("Brak kopii oryginału".into());
    }
    let original = fs::read(&backup).map_err(|e| e.to_string())?;
    write_atomic(p, &original)?;
    reindex(&state, p, taken, camera)
}

// ---- Metadane w plikach XMP obok zdjęć -----------------------------------
// Tagi, oceny i ulubione trafiają do pliku `<zdjęcie>.xmp` (standard XMP: dc:subject, xmp:Rating).
// Oryginalne zdjęcia nie są zmieniane. Pliki XMP innych programów (rozpoznajemy je po braku znacznika FIBO)
// zostają nietknięte.

const XMP_MARKER: &str = "x:xmptk=\"FIBO\"";

#[derive(Default, Clone, Debug, PartialEq)]
struct Iptc {
    title: Option<String>,
    city: Option<String>,
    country: Option<String>,
}

struct Sidecar {
    rating: i64,
    favorite: bool,
    tags: Vec<String>,
    author: Option<String>,
    copyright: Option<String>,
    /** Pola IPTC: tytuł (dc:title), miejscowość (photoshop:City) i kraj (photoshop:Country). */
    iptc: Iptc,
    /** 1 wybrane, -1 odrzucone (xmpDM:pick), 0 brak. */
    flag: i64,
    /** Numer etykiety kolorowej (xmp:Label), 0 brak. */
    label: i64,
}

/// Nazwy etykiet kolorowych w XMP (te same, których używają Lightroom i Bridge).
const LABELS: [&str; 4] = ["Red", "Yellow", "Green", "Blue"];

fn label_number(name: &str) -> i64 {
    LABELS.iter().position(|l| l.eq_ignore_ascii_case(name.trim())).map(|i| i as i64 + 1).unwrap_or(0)
}

fn xmp_path(photo: &Path) -> PathBuf {
    let mut s = photo.as_os_str().to_os_string();
    s.push(".xmp");
    PathBuf::from(s)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn build_xmp(rating: i64, favorite: bool, tags: &[String]) -> String {
    build_xmp_full(rating, favorite, tags, None, None)
}

/// To samo z autorem (`dc:creator`) i prawami autorskimi (`dc:rights`), czyli polami, które czytają inne programy do zdjęć.
fn build_xmp_full(rating: i64, favorite: bool, tags: &[String], author: Option<&str>, copyright: Option<&str>) -> String {
    build_xmp_marks(rating, favorite, tags, author, copyright, 0, 0)
}

/// To samo z flagą selekcji (`xmpDM:pick`) i etykietą kolorową (`xmp:Label`). Gdy ich nie ma, plik jest bajt w bajt taki jak dawniej.
fn build_xmp_marks(rating: i64, favorite: bool, tags: &[String], author: Option<&str>, copyright: Option<&str>, flag: i64, label: i64) -> String {
    build_xmp_iptc(rating, favorite, tags, author, copyright, flag, label, &Iptc::default())
}

/// To samo z polami IPTC (tytuł, miejscowość, kraj). Bez nich plik jest bajt w bajt taki jak dawniej.
#[allow(clippy::too_many_arguments)]
fn build_xmp_iptc(rating: i64, favorite: bool, tags: &[String], author: Option<&str>, copyright: Option<&str>, flag: i64, label: i64, iptc: &Iptc) -> String {
    let pick = if flag != 0 { format!("\n    xmpDM:pick=\"{}\"", flag.clamp(-1, 1)) } else { String::new() };
    let pick_ns = if flag != 0 { "\n    xmlns:xmpDM=\"http://ns.adobe.com/xmp/1.0/DynamicMedia/\"" } else { "" };
    let label_attr = LABELS.get((label - 1).max(0) as usize).filter(|_| label > 0).map(|l| format!("\n    xmp:Label=\"{l}\"")).unwrap_or_default();
    let creator = author.map(|a| format!("   <dc:creator>\n    <rdf:Seq>\n     <rdf:li>{}</rdf:li>\n    </rdf:Seq>\n   </dc:creator>\n", xml_escape(a))).unwrap_or_default();
    let rights = copyright.map(|c| format!("   <dc:rights>\n    <rdf:Alt>\n     <rdf:li xml:lang=\"x-default\">{}</rdf:li>\n    </rdf:Alt>\n   </dc:rights>\n", xml_escape(c))).unwrap_or_default();
    let items: String = tags.iter().map(|t| format!("     <rdf:li>{}</rdf:li>\n", xml_escape(t))).collect();
    let subject = if tags.is_empty() {
        String::new()
    } else {
        format!("   <dc:subject>\n    <rdf:Bag>\n{items}    </rdf:Bag>\n   </dc:subject>\n")
    };
    let fav = if favorite { "True" } else { "False" };
    let has_place = iptc.city.is_some() || iptc.country.is_some();
    let place_ns = if has_place { "\n    xmlns:photoshop=\"http://ns.adobe.com/photoshop/1.0/\"" } else { "" };
    let place_attr = format!(
        "{}{}",
        iptc.city.as_deref().map(|c| format!("\n    photoshop:City=\"{}\"", xml_escape(c))).unwrap_or_default(),
        iptc.country.as_deref().map(|c| format!("\n    photoshop:Country=\"{}\"", xml_escape(c))).unwrap_or_default()
    );
    let title = iptc.title.as_deref().map(|t| format!("   <dc:title>\n    <rdf:Alt>\n     <rdf:li xml:lang=\"x-default\">{}</rdf:li>\n    </rdf:Alt>\n   </dc:title>\n", xml_escape(t))).unwrap_or_default();
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n\
<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" {XMP_MARKER}>\n\
 <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n\
  <rdf:Description rdf:about=\"\"\n\
    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n\
    xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n\
    xmlns:fibo=\"https://pmesznik.github.io/fibo/ns/1.0/\"{pick_ns}{place_ns}\n\
    xmp:Rating=\"{rating}\"{label_attr}{pick}{place_attr}\n\
    fibo:Favorite=\"{fav}\">\n\
{subject}{title}{creator}{rights}  </rdf:Description>\n\
 </rdf:RDF>\n\
</x:xmpmeta>\n\
<?xpacket end=\"w\"?>\n"
    )
}

/// Wartość jako atrybut (`name="3"`) albo element (`<name>3</name>`).
fn xmp_value(text: &str, name: &str) -> Option<String> {
    let attr = format!("{name}=\"");
    if let Some(i) = text.find(&attr) {
        let rest = &text[i + attr.len()..];
        return rest.find('"').map(|j| rest[..j].to_string());
    }
    let open = format!("<{name}>");
    let i = text.find(&open)?;
    let rest = &text[i + open.len()..];
    rest.find('<').map(|j| rest[..j].to_string())
}

/// Słowa kluczowe z pakietu XMP (`dc:subject`).
/// Pierwszy element listy z pola `dc:creator` albo `dc:rights` (tekst bez znaczników), obcięty do rozsądnej długości.
/// Tekst pola bez znaków sterujących, przycięty i obcięty do rozsądnej długości.
fn clean_credit(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(MAX_CREDIT).collect::<String>().trim().to_string()
}

fn parse_xmp_first_li(text: &str, field: &str) -> Option<String> {
    let start = text.find(&format!("<{field}>"))?;
    let rest = &text[start..];
    let rest = &rest[..rest.find(&format!("</{field}>"))?];
    let li = &rest[rest.find("<rdf:li")?..];
    let body = &li[li.find('>')? + 1..];
    let v: String = xml_unescape(&body[..body.find("</rdf:li>")?]).chars().filter(|c| !c.is_control()).take(MAX_CREDIT).collect();
    let v = v.trim().to_string();
    (!v.is_empty()).then_some(v)
}

fn parse_xmp_tags(text: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    if let Some(start) = text.find("<dc:subject>") {
        let rest = &text[start..];
        let mut seg = &rest[..rest.find("</dc:subject>").unwrap_or(rest.len())];
        while let Some(i) = seg.find("<rdf:li") {
            if tags.len() >= MAX_TAGS_PER_FILE {
                break;
            }
            let after = &seg[i..];
            let Some(gt) = after.find('>') else { break };
            let body = &after[gt + 1..];
            let Some(close) = body.find("</rdf:li>") else { break };
            if let Some(t) = norm_tag(&xml_unescape(&body[..close])) {
                if !tags.contains(&t) {
                    tags.push(t);
                }
            }
            seg = &body[close + "</rdf:li>".len()..];
        }
    }
    tags
}

fn parse_xmp_rating(text: &str) -> i64 {
    xmp_value(text, "xmp:Rating").and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(0).clamp(0, 5)
}

/// Najwięcej, co wczytujemy z jednego pliku XMP; większy plik nie jest nasz i nie ładujemy go do pamięci.
const MAX_XMP_BYTES: u64 = 1 << 20;
/// Najwięcej tagów brane z jednego pliku (zabezpieczenie przed plikiem z milionami wpisów).
const MAX_TAGS_PER_FILE: usize = 200;

fn read_xmp_limited(p: &Path) -> Option<Vec<u8>> {
    if fs::metadata(p).ok()?.len() > MAX_XMP_BYTES {
        return None;
    }
    fs::read(p).ok()
}

fn read_sidecar(photo: &Path) -> Option<Sidecar> {
    let bytes = read_xmp_limited(&xmp_path(photo))?;
    let text = String::from_utf8_lossy(&bytes);
    Some(Sidecar {
        rating: parse_xmp_rating(&text),
        favorite: text.to_ascii_lowercase().contains("fibo:favorite=\"true\""),
        tags: parse_xmp_tags(&text),
        author: parse_xmp_first_li(&text, "dc:creator"),
        copyright: parse_xmp_first_li(&text, "dc:rights"),
        iptc: Iptc {
            title: parse_xmp_first_li(&text, "dc:title"),
            city: xmp_value(&text, "photoshop:City").map(|v| clean_credit(&xml_unescape(&v))).filter(|v| !v.is_empty()),
            country: xmp_value(&text, "photoshop:Country").map(|v| clean_credit(&xml_unescape(&v))).filter(|v| !v.is_empty()),
        },
        flag: xmp_value(&text, "xmpDM:pick").and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(0).clamp(-1, 1),
        label: xmp_value(&text, "xmp:Label").map(|v| label_number(&v)).unwrap_or(0),
    })
}

/// Segmenty nagłówka JPEG (znacznik, zawartość) aż do początku danych obrazu.
fn jpeg_segments(bytes: &[u8]) -> Vec<(u8, &[u8])> {
    let mut out = Vec::new();
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return out;
    }
    let mut i = 2;
    while i + 4 <= bytes.len() && bytes[i] == 0xFF {
        let m = bytes[i + 1];
        if m == 0xFF {
            i += 1;
            continue;
        }
        if m == 0xDA || m == 0xD9 {
            break; // początek danych obrazu albo koniec pliku
        }
        if m == 0x01 || (0xD0..=0xD7).contains(&m) {
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        if len < 2 || i + 2 + len > bytes.len() {
            break;
        }
        out.push((m, &bytes[i + 4..i + 2 + len]));
        i += 2 + len;
    }
    out
}

/// Słowa kluczowe IPTC (rekord 2, zbiór 25) z segmentu „Photoshop 3.0” (tak zapisuje m.in. Picasa).
fn iptc_keywords(app13: &[u8]) -> Vec<String> {
    let mut tags = Vec::new();
    let Some(mut rest) = app13.strip_prefix(b"Photoshop 3.0\0") else { return tags };
    while rest.len() >= 12 && &rest[..4] == b"8BIM" {
        let id = u16::from_be_bytes([rest[4], rest[5]]);
        let name_len = rest[6] as usize;
        let name_total = (1 + name_len + 1) & !1; // bajt długości + nazwa, wyrównane do parzystej liczby
        if rest.len() < 6 + name_total + 4 {
            break;
        }
        let size_at = 6 + name_total;
        let size = u32::from_be_bytes([rest[size_at], rest[size_at + 1], rest[size_at + 2], rest[size_at + 3]]) as usize;
        let data_start = size_at + 4;
        if rest.len() < data_start + size {
            break;
        }
        if id == 0x0404 {
            let mut d = &rest[data_start..data_start + size];
            while d.len() >= 5 && d[0] == 0x1C {
                let (record, dataset) = (d[1], d[2]);
                let len = u16::from_be_bytes([d[3], d[4]]) as usize;
                if len & 0x8000 != 0 || d.len() < 5 + len {
                    break;
                }
                if record == 2 && dataset == 25 {
                    let raw = &d[5..5 + len];
                    // IPTC bez deklaracji kodowania bywa w UTF-8 albo w ISO-8859-1.
                    let text = String::from_utf8(raw.to_vec()).unwrap_or_else(|_| raw.iter().map(|&b| b as char).collect());
                    if let Some(t) = norm_tag(&text) {
                        if !tags.contains(&t) {
                            tags.push(t);
                        }
                    }
                }
                d = &d[5 + len..];
            }
        }
        let next = data_start + ((size + 1) & !1);
        if next >= rest.len() {
            break;
        }
        rest = &rest[next..];
    }
    tags
}

/// Tagi i ocena już zapisane w samym zdjęciu: EXIF (Eksplorator Windows), XMP i IPTC w plikach JPEG.
fn read_embedded(path: &Path, exif: Option<&ExifInfo>) -> Option<Sidecar> {
    let owned;
    let ex = match exif {
        Some(e) => e,
        None => {
            owned = read_exif(path);
            &owned
        }
    };
    let mut rating = ex.rating;
    let mut tags = ex.keywords.clone();
    let is_jpeg = path.extension().and_then(|e| e.to_str()).map(|e| matches!(e.to_ascii_lowercase().as_str(), "jpg" | "jpeg")).unwrap_or(false);
    if is_jpeg {
        // Nagłówek z metadanymi mieści się w pierwszych kilkuset KB pliku.
        use std::io::Read;
        let mut buf = Vec::new();
        File::open(path).ok()?.take(768 * 1024).read_to_end(&mut buf).ok()?;
        for (marker, payload) in jpeg_segments(&buf) {
            let mut extra: Vec<String> = Vec::new();
            if marker == 0xE1 {
                if let Some(xml) = payload.strip_prefix(b"http://ns.adobe.com/xap/1.0/\0") {
                    let text = String::from_utf8_lossy(xml);
                    if rating == 0 {
                        rating = parse_xmp_rating(&text);
                    }
                    extra = parse_xmp_tags(&text);
                }
            } else if marker == 0xED {
                extra = iptc_keywords(payload);
            }
            for t in extra {
                if !tags.contains(&t) {
                    tags.push(t);
                }
            }
        }
    }
    (rating > 0 || !tags.is_empty()).then_some(Sidecar { rating, favorite: false, tags, author: None, copyright: None, iptc: Iptc::default(), flag: 0, label: 0 })
}

/// Wszystko, co zdjęcie już ma: plik XMP obok (pierwszeństwo) i metadane wewnątrz pliku.
fn read_metadata(path: &Path, exif: Option<&ExifInfo>) -> Option<Sidecar> {
    let file = read_sidecar(path);
    let embedded = read_embedded(path, exif);
    match (file, embedded) {
        (None, None) => None,
        (Some(f), None) => Some(f),
        (None, Some(e)) => Some(e),
        (Some(mut f), Some(e)) => {
            if f.rating == 0 {
                f.rating = e.rating;
            }
            if f.flag == 0 {
                f.flag = e.flag;
            }
            if f.label == 0 {
                f.label = e.label;
            }
            for t in e.tags {
                if !f.tags.contains(&t) {
                    f.tags.push(t);
                }
            }
            Some(f)
        }
    }
}

/// Dokłada metadane z pliku XMP do biblioteki, nie nadpisując tego, co użytkownik już ma: ocenę ustawia tylko
/// gdy była zerowa, ulubione tylko włącza, tagi dodaje. Zwraca liczbę zmienionych wierszy.
fn apply_sidecar(conn: &Connection, id: i64, sc: &Sidecar) -> rusqlite::Result<usize> {
    let mut changed = 0;
    if sc.rating > 0 {
        changed += conn.execute("UPDATE photos SET rating = ?2 WHERE id = ?1 AND rating = 0", params![id, sc.rating])?;
    }
    if sc.favorite {
        changed += conn.execute("UPDATE photos SET favorite = 1 WHERE id = ?1 AND favorite = 0", [id])?;
    }
    if sc.flag != 0 {
        changed += conn.execute("UPDATE photos SET flag = ?2 WHERE id = ?1 AND flag = 0", params![id, sc.flag])?;
    }
    if sc.label != 0 {
        changed += conn.execute("UPDATE photos SET label = ?2 WHERE id = ?1 AND label = 0", params![id, sc.label])?;
    }
    if let Some(a) = &sc.author {
        changed += conn.execute("UPDATE photos SET author = ?2 WHERE id = ?1 AND author IS NULL", params![id, a])?;
    }
    if let Some(c) = &sc.copyright {
        changed += conn.execute("UPDATE photos SET copyright = ?2 WHERE id = ?1 AND copyright IS NULL", params![id, c])?;
    }
    if let Some(t) = &sc.iptc.title {
        changed += conn.execute("UPDATE photos SET title = ?2 WHERE id = ?1 AND title IS NULL", params![id, t])?;
    }
    if let Some(c) = &sc.iptc.city {
        changed += conn.execute("UPDATE photos SET iptc_city = ?2 WHERE id = ?1 AND iptc_city IS NULL", params![id, c])?;
    }
    if let Some(c) = &sc.iptc.country {
        changed += conn.execute("UPDATE photos SET iptc_country = ?2 WHERE id = ?1 AND iptc_country IS NULL", params![id, c])?;
    }
    for t in &sc.tags {
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [t])?;
        changed += conn.execute(
            "INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) SELECT ?1, id FROM tags WHERE name = ?2",
            params![id, t],
        )?;
    }
    Ok(changed)
}

#[derive(PartialEq, Debug)]
enum SidecarOutcome {
    Written,
    Removed,
    Skipped,   // istnieje plik XMP innego programu
    Unchanged,
}

/// Zapisuje (albo usuwa, gdy nie ma już żadnych metadanych) plik XMP zdjęcia `id`.
fn write_sidecar(state: &AppState, id: i64) -> Result<SidecarOutcome, String> {
    let (path, rating, favorite, tags, author, copyright, flag, label, iptc) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let (path, rating, fav, author, copyright, flag, label, iptc): (String, i64, i64, Option<String>, Option<String>, i64, i64, Iptc) = conn
            .query_row("SELECT path, rating, favorite, author, copyright, flag, label, title, iptc_city, iptc_country FROM photos WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, Iptc { title: r.get(7)?, city: r.get(8)?, country: r.get(9)? }))
            })
            .map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.photo_id = ?1 ORDER BY t.name")
            .map_err(|e| e.to_string())?;
        let tags: Vec<String> = stmt.query_map([id], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        (path, rating, fav != 0, tags, author, copyright, flag, label, iptc)
    };
    let xmp = xmp_path(Path::new(&path));
    // Zbyt duży plik XMP na pewno nie jest nasz: nie wczytujemy go i nie nadpisujemy.
    if matches!(fs::metadata(&xmp), Ok(m) if m.len() > MAX_XMP_BYTES) {
        return Ok(SidecarOutcome::Skipped);
    }
    let existing = fs::read(&xmp).ok().map(|b| String::from_utf8_lossy(&b).into_owned());
    if existing.as_deref().map(|t| !t.contains(XMP_MARKER)).unwrap_or(false) {
        return Ok(SidecarOutcome::Skipped);
    }
    if rating == 0 && !favorite && tags.is_empty() && author.is_none() && copyright.is_none() && iptc == Iptc::default() && flag == 0 && label == 0 {
        return match existing {
            Some(_) => fs::remove_file(&xmp).map(|_| SidecarOutcome::Removed).map_err(|e| e.to_string()),
            None => Ok(SidecarOutcome::Unchanged),
        };
    }
    let xml = build_xmp_iptc(rating, favorite, &tags, author.as_deref(), copyright.as_deref(), flag, label, &iptc);
    if existing.as_deref() == Some(xml.as_str()) {
        return Ok(SidecarOutcome::Unchanged);
    }
    fs::write(&xmp, xml).map_err(|e| e.to_string())?;
    Ok(SidecarOutcome::Written)
}

/// Po zmianie metadanych odświeża pliki XMP (jeśli zapisywanie jest włączone); błędy nie przerywają zmiany w bibliotece.
fn sync_ids(state: &AppState, ids: &[i64]) {
    if !state.sidecar.load(Ordering::Relaxed) {
        return;
    }
    for &id in ids {
        let _ = write_sidecar(state, id);
    }
}

#[derive(Serialize, Default)]
struct SidecarReport {
    written: usize,
    removed: usize,
    skipped: usize,
    unchanged: usize,
    failed: usize,
}

#[derive(Serialize, Default)]
struct ImportReport {
    files: usize,
    changed: usize,
}

#[tauri::command]
fn get_sidecar_enabled(state: State<'_, AppState>) -> bool {
    state.sidecar.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_sidecar_enabled(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.sidecar.store(enabled, Ordering::Relaxed);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('sidecar', ?1)", [if enabled { "1" } else { "0" }])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_skip_gif_png() -> bool {
    formats::skip_gif_png()
}

#[tauri::command]
fn set_skip_gif_png(state: State<'_, AppState>, skip: bool) -> Result<(), String> {
    formats::set_skip_gif_png(skip);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('skip-gif-png', ?1)", [if skip { "1" } else { "0" }]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Karta pamięci aparatu: dysk z folderem DCIM. Szukamy tylko liter od D do Z (A i B to dawne stacje dyskietek, a odłączone dyski sieciowe
/// potrafią długo nie odpowiadać), a dyski już obserwowane przez FIBO pomijamy.
#[tauri::command]
async fn detect_cards(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    static BUSY: AtomicBool = AtomicBool::new(false);
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(Vec::new());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let roots: Vec<String> = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn.prepare("SELECT path FROM roots").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            rows
        };
        let mut found = Vec::new();
        if cfg!(windows) {
            for letter in 'D'..='Z' {
                let drive = format!("{letter}:\\");
                if roots.iter().any(|r| r.to_uppercase().starts_with(&drive.to_uppercase())) {
                    continue;
                }
                if fs::metadata(format!("{drive}DCIM")).map(|m| m.is_dir()).unwrap_or(false) {
                    found.push(drive);
                }
            }
        }
        Ok::<_, String>(found)
    })
    .await
    .map_err(|e| e.to_string());
    BUSY.store(false, Ordering::SeqCst);
    result?
}

const MAX_CREDIT: usize = 200;

/// Autor i prawa autorskie wybranych zdjęć (puste pole usuwa wartość). Zapisują się w bibliotece i, gdy włączono pliki XMP, obok zdjęć;
/// plików zdjęć program nie zmienia.
#[tauri::command]
fn set_credits(state: State<'_, AppState>, ids: Vec<i64>, author: String, copyright: String) -> Result<usize, String> {
    let clean = |s: String| -> Option<String> {
        let t: String = s.chars().filter(|c| !c.is_control()).take(MAX_CREDIT).collect::<String>().trim().to_string();
        (!t.is_empty()).then_some(t)
    };
    let (author, copyright) = (clean(author), clean(copyright));
    let mut n = 0;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for id in &ids {
            n += conn.execute("UPDATE photos SET author = ?2, copyright = ?3 WHERE id = ?1", params![id, author, copyright]).map_err(|e| e.to_string())?;
        }
    }
    sync_ids(&state, &ids);
    Ok(n)
}

/// Pola IPTC wybranych zdjęć: tytuł, miejscowość i kraj (puste pole czyści wartość). Zapisują się w bibliotece i w plikach XMP.
#[tauri::command]
fn set_iptc(state: State<'_, AppState>, ids: Vec<i64>, title: String, city: String, country: String) -> Result<usize, String> {
    let clean = |s: String| -> Option<String> { let t = clean_credit(&s); (!t.is_empty()).then_some(t) };
    let (title, city, country) = (clean(title), clean(city), clean(country));
    let mut n = 0;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for id in &ids {
            n += conn.execute("UPDATE photos SET title = ?2, iptc_city = ?3, iptc_country = ?4 WHERE id = ?1", params![id, title, city, country]).map_err(|e| e.to_string())?;
        }
    }
    sync_ids(&state, &ids);
    Ok(n)
}

fn all_photo_ids(state: &AppState) -> Result<Vec<(i64, String)>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, path FROM photos").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(rows)
}

/// Zapisuje metadane wszystkich zdjęć do plików XMP (niezależnie od ustawienia automatycznego zapisu).
#[tauri::command]
async fn export_sidecars(app: tauri::AppHandle) -> Result<SidecarReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _job = jobs::Guard::new("sidecar");
        let mut rep = SidecarReport::default();
        let all_ids = all_photo_ids(&state)?;
        let total = all_ids.len();
        for (n, (id, _)) in all_ids.into_iter().enumerate() {
            jobs::tick("sidecar", n, total);
            match write_sidecar(&state, id) {
                Ok(SidecarOutcome::Written) => rep.written += 1,
                Ok(SidecarOutcome::Removed) => rep.removed += 1,
                Ok(SidecarOutcome::Skipped) => rep.skipped += 1,
                Ok(SidecarOutcome::Unchanged) => rep.unchanged += 1,
                Err(_) => rep.failed += 1,
            }
            if n % 100 == 0 {
                let _ = app.emit("scan-progress", n);
            }
        }
        Ok(rep)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Wczytuje metadane z plików XMP do biblioteki (uzupełnia, nie nadpisuje).
#[tauri::command]
async fn import_sidecars(app: tauri::AppHandle) -> Result<ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut rep = ImportReport::default();
        for (id, path) in all_photo_ids(&state)? {
            if let Some(sc) = read_metadata(Path::new(&path), None) {
                rep.files += 1;
                let conn = state.db.lock().map_err(|e| e.to_string())?;
                rep.changed += apply_sidecar(&conn, id, &sc).map_err(|e| e.to_string())?;
            }
        }
        Ok(rep)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- Obserwowane foldery, albumy i operacje na plikach -------------------

fn add_root_conn(conn: &Connection, root: &str) -> rusqlite::Result<()> {
    let existing: Vec<String> = {
        let mut stmt = conn.prepare("SELECT path FROM roots")?;
        let rows = stmt.query_map([], |r| r.get(0))?.filter_map(Result::ok).collect();
        rows
    };
    // Podfolder folderu, który już jest obserwowany, nie potrzebuje własnego wpisu.
    if existing.iter().any(|r| Path::new(root).starts_with(r)) {
        return Ok(());
    }
    for r in &existing {
        if Path::new(r).starts_with(root) {
            conn.execute("DELETE FROM roots WHERE path = ?1", [r])?;
        }
    }
    conn.execute("INSERT OR IGNORE INTO roots (path) VALUES (?1)", [root])?;
    Ok(())
}

fn add_root(state: &AppState, root: &str) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    add_root_conn(&conn, root).map_err(|e| e.to_string())
}

/// Biblioteka sprzed wprowadzenia obserwowania: foldery główne wyznaczamy z folderów zdjęć.
fn backfill_roots(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM roots", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }
    let mut folders: Vec<String> = {
        let mut stmt = conn.prepare("SELECT DISTINCT folder FROM photos")?;
        let rows = stmt.query_map([], |r| r.get(0))?.filter_map(Result::ok).collect();
        rows
    };
    folders.sort_by_key(|f| f.len()); // foldery nadrzędne są krótsze, więc dochodzą pierwsze
    for f in folders {
        add_root_conn(conn, &f)?;
    }
    Ok(())
}

#[tauri::command]
fn list_roots(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT path FROM roots ORDER BY path").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(rows)
}

/// Przestaje obserwować folder; zdjęcia zostają w bibliotece.
#[tauri::command]
fn remove_root(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM roots WHERE path = ?1", [&path]).map_err(|e| e.to_string())?;
    Ok(())
}

fn forget_photo(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    people::forget_faces(conn, id);
    conn.execute("DELETE FROM clip_vec WHERE photo_id = ?1", [id])?;
    conn.execute("DELETE FROM edits WHERE photo_id = ?1", [id])?;
    conn.execute("DELETE FROM edit_history WHERE photo_id = ?1", [id])?;
    conn.execute("DELETE FROM photo_tags WHERE photo_id = ?1", [id])?;
    conn.execute("DELETE FROM album_photos WHERE photo_id = ?1", [id])?;
    conn.execute("DELETE FROM photos WHERE id = ?1", [id])?;
    Ok(())
}

/// Zapis pliku przez plik tymczasowy: przerwanie (brak prądu, pełny dysk) zostawia albo starą, albo nową całą zawartość, nigdy ułamek.
pub(crate) fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut tmp = target.as_os_str().to_os_string();
    tmp.push(".fibo-tmp");
    let tmp = PathBuf::from(tmp);
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)
    })();
    result.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Kopia oryginału przed pierwszą zmianą zdjęcia. Powstaje przez plik tymczasowy i jest sprawdzana (rozmiar), więc przerwane kopiowanie
/// nie zostawia uciętej „kopii”, której późniejsze przywracanie zniszczyłoby zdjęcie. Pusty plik kopii (ślad po dawnym błędzie) jest robiony od nowa.
pub(crate) fn ensure_original_backup(src: &Path, backup: &Path) -> Result<(), String> {
    if fs::metadata(backup).map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(());
    }
    if let Some(dir) = backup.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut tmp = backup.as_os_str().to_os_string();
    tmp.push(".fibo-tmp");
    let tmp = PathBuf::from(tmp);
    let result = (|| -> Result<(), String> {
        let n = fs::copy(src, &tmp).map_err(|e| e.to_string())?;
        if n != fs::metadata(src).map_err(|e| e.to_string())?.len() {
            return Err("Kopia oryginału jest niepełna (brak miejsca na dysku?). Zdjęcie nie zostało zmienione".into());
        }
        fs::rename(&tmp, backup).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Usuwa z katalogu miniatur pliki zdjęć, które zniknęły z biblioteki (nazwa miniatury to „numer_data.jpg”). Jedno przejście katalogu dla wszystkich.
fn sweep_thumbs(thumbs: &Path, gone: &std::collections::HashSet<i64>) {
    if gone.is_empty() {
        return;
    }
    let Ok(dir) = fs::read_dir(thumbs) else { return };
    for e in dir.flatten() {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if let Some(id) = name.split('_').next().and_then(|n| n.parse::<i64>().ok()) {
            if name.ends_with(".jpg") && gone.contains(&id) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

#[derive(Serialize, Default, Debug)]
struct RescanReport {
    added: usize,
    removed: usize,
    roots: usize,
}

/// Przeszukuje obserwowane foldery (pomijając niezmienione pliki) i usuwa z biblioteki zdjęcia, których plików już nie ma.
/// Zdjęcie znika z biblioteki tylko wtedy, gdy jego folder istnieje, a pliku w nim nie ma (odłączony dysk niczego nie kasuje).
fn rescan_blocking(state: &AppState) -> Result<RescanReport, String> {
    rescan_with_stats(state, &|_, _| {})
}

fn rescan_with_stats(state: &AppState, stats: &dyn Fn(usize, usize)) -> Result<RescanReport, String> {
    let roots: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT path FROM roots").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        rows
    };
    let mut rep = RescanReport::default();
    for root in &roots {
        if !Path::new(root).is_dir() {
            continue;
        }
        rep.roots += 1;
        rep.added += scan_blocking_stats(state, root, &|_| {}, stats)?;
    }
    let rows = all_photo_ids(state)?;
    // Sprawdzanie plików (dysk może spać albo być siecią) odbywa się bez blokady bazy.
    let missing: Vec<i64> = rows
        .iter()
        .filter(|(_, path)| {
            let p = Path::new(path);
            matches!(fs::metadata(p), Err(e) if e.kind() == std::io::ErrorKind::NotFound) && p.parent().map(|d| d.is_dir()).unwrap_or(false)
        })
        .map(|(id, _)| *id)
        .collect();
    if !missing.is_empty() {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for id in &missing {
            forget_photo(&tx, *id).map_err(|e| e.to_string())?;
        }
        tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags)", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        rep.removed = missing.len();
        drop(conn);
        sweep_thumbs(&state.thumbs, &missing.iter().copied().collect());
    }
    Ok(rep)
}

#[tauri::command]
async fn rescan_roots(app: tauri::AppHandle) -> Result<RescanReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        rescan_with_stats(&app.state::<AppState>(), &move |done, total| {
            let _ = emitter.emit("scan-stats", (done, total));
        })
    })
        .await
        .map_err(|e| e.to_string())?
}

// Własne albumy: zdjęcie może być w wielu albumach, a album nie zależy od folderów.

#[derive(Serialize)]
struct Album {
    id: i64,
    name: String,
    count: i64,
    hidden: bool,
}

fn clean_album_name(s: &str) -> Result<String, String> {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        Err("Podaj nazwę albumu".into())
    } else if t.chars().count() > 60 {
        Err("Nazwa albumu może mieć najwyżej 60 znaków".into())
    } else {
        Ok(t)
    }
}

fn album_error(e: rusqlite::Error) -> String {
    if e.to_string().contains("UNIQUE") { "Album o takiej nazwie już istnieje".into() } else { e.to_string() }
}

#[tauri::command]
fn list_albums(state: State<'_, AppState>) -> Result<Vec<Album>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT a.id, a.name, (SELECT COUNT(*) FROM album_photos WHERE album_id = a.id), a.hidden FROM albums a ORDER BY a.name COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok(Album { id: r.get(0)?, name: r.get(1)?, count: r.get(2)?, hidden: r.get::<_, i64>(3)? != 0 }))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[tauri::command]
fn create_album(state: State<'_, AppState>, name: String) -> Result<Album, String> {
    let name = clean_album_name(&name)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO albums (name) VALUES (?1)", [&name]).map_err(album_error)?;
    Ok(Album { id: conn.last_insert_rowid(), name, count: 0, hidden: false })
}

#[tauri::command]
fn rename_album(state: State<'_, AppState>, id: i64, name: String) -> Result<(), String> {
    let name = clean_album_name(&name)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE albums SET name = ?2 WHERE id = ?1", params![id, name]).map_err(album_error)?;
    Ok(())
}

/// Otwiera zdjęcie znane FIBO w domyślnym programie Windows (np. do edycji w Paincie); ścieżka pochodzi z biblioteki, nie od interfejsu.
#[tauri::command]
fn open_photo_external(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let (path, _, _) = photo_path(&state, id)?;
    if !Path::new(&path).is_file() {
        return Err("Pliku nie ma już na dysku".into());
    }
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
}

/// Własna kolejność zdjęć w albumie: numery zdjęć od pierwszego do ostatniego (tylko te, którym ją ustawiono).
#[tauri::command]
fn list_album_order(state: State<'_, AppState>, album_id: i64) -> Result<Vec<i64>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT photo_id FROM album_photos WHERE album_id = ?1 AND pos IS NOT NULL ORDER BY pos").map_err(|e| e.to_string())?;
    let v = stmt.query_map([album_id], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(v)
}

/// Zapisuje kolejność zdjęć w albumie (zdjęcia spoza albumu są pomijane).
#[tauri::command]
fn set_album_order(state: State<'_, AppState>, album_id: i64, ids: Vec<i64>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE album_photos SET pos = ?3 WHERE album_id = ?1 AND photo_id = ?2", params![album_id, id, i as i64]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Ukrywa album na listach albo go przywraca; nic nie jest usuwane.
#[tauri::command]
fn set_album_hidden(state: State<'_, AppState>, id: i64, hidden: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE albums SET hidden = ?2 WHERE id = ?1", params![id, hidden as i64]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Usuwa sam album; zdjęcia zostają w bibliotece i na dysku.
#[tauri::command]
fn delete_album(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM album_photos WHERE album_id = ?1", [id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM albums WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM props WHERE kind = 'album' AND key = ?1", [id.to_string()]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_to_album(state: State<'_, AppState>, album_id: i64, ids: Vec<i64>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in ids {
        tx.execute("INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?1, ?2)", params![album_id, id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_from_album(state: State<'_, AppState>, album_id: i64, ids: Vec<i64>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in ids {
        tx.execute("DELETE FROM album_photos WHERE album_id = ?1 AND photo_id = ?2", params![album_id, id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

// Zmiana nazwy, przenoszenie i kopiowanie plików (razem z plikiem XMP zdjęcia).

/// Nazwa pliku bez rozszerzenia, dozwolona w Windows.
fn valid_stem(s: &str) -> Result<String, String> {
    let t = s.trim();
    if t.is_empty() {
        return Err("Podaj nazwę pliku".into());
    }
    if t.chars().count() > 150 {
        return Err("Nazwa pliku jest za długa".into());
    }
    if t.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c)) {
        return Err("Nazwa nie może zawierać znaków \\ / : * ? \" < > |".into());
    }
    // Niewidoczne znaki formatujące (zmiana kierunku tekstu, zero-width) pozwalają podszyć się pod inną nazwę.
    if t.chars().any(|c| matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')) {
        return Err("Nazwa zawiera niewidoczne znaki sterujące".into());
    }
    if t.ends_with('.') {
        return Err("Nazwa nie może kończyć się kropką".into());
    }
    let base = t.split('.').next().unwrap_or("").to_uppercase();
    // Nazwy urządzeń Windows: CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9 i LPT0-9 (także z indeksem górnym ¹ ² ³).
    let numbered = base.strip_prefix("COM").or_else(|| base.strip_prefix("LPT")).map(|r| {
        let mut it = r.chars();
        matches!((it.next(), it.next()), (Some(c), None) if c.is_ascii_digit() || matches!(c, '¹' | '²' | '³'))
    });
    let reserved = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&base.as_str()) || numbered.unwrap_or(false);
    if reserved {
        return Err("Ta nazwa jest zarezerwowana przez Windows".into());
    }
    Ok(t.to_string())
}

/// Ścieżka w `dir` o danej nazwie; gdy zajęta, dopisuje _1, _2 itd.
fn unique_target(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..)
        .map(|n| dir.join(format!("{stem}_{n}{ext}")))
        .find(|c| !c.exists())
        .unwrap_or(first)
}

/// Przenosi plik; między dyskami (rename zawodzi) kopiuje, sprawdza rozmiar i dopiero wtedy usuwa źródło.
fn move_file(src: &Path, dst: &Path) -> Result<(), String> {
    if fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    fs::copy(src, dst).map_err(|e| e.to_string())?;
    let same = fs::metadata(src).map(|m| m.len()).ok() == fs::metadata(dst).map(|m| m.len()).ok();
    if !same {
        let _ = fs::remove_file(dst);
        return Err("Kopia pliku jest niepełna, źródło zostało nietknięte".into());
    }
    fs::remove_file(src).map_err(|e| e.to_string())
}

/// Pliki towarzyszące zdjęciu idą razem z nim: XMP (własny albo cudzy), plik z edycją nieniszczącą (`.fibo.json`) oraz, przy przenoszeniu,
/// kopia oryginału z folderu `.originals` (bez niej „Przywróć oryginał” przestałby działać).
fn carry_sidecar(src_photo: &Path, dst_photo: &Path, copy: bool) {
    let carry = |s: PathBuf, d: PathBuf| {
        if s.exists() {
            let _ = if copy { fs::copy(&s, &d).map(|_| ()).map_err(|e| e.to_string()) } else { move_file(&s, &d) };
        }
    };
    carry(xmp_path(src_photo), xmp_path(dst_photo));
    carry(edits::sidecar_path(src_photo), edits::sidecar_path(dst_photo));
    if !copy {
        if let (Some(sd), Some(dd), Some(sn), Some(dn)) = (src_photo.parent(), dst_photo.parent(), src_photo.file_name(), dst_photo.file_name()) {
            let backup = sd.join(ORIGINALS_DIR).join(sn);
            if backup.is_file() {
                let target = dd.join(ORIGINALS_DIR).join(dn);
                if fs::create_dir_all(dd.join(ORIGINALS_DIR)).is_ok() {
                    let _ = move_file(&backup, &target);
                }
            }
        }
    }
}

/// Zapisuje w bazie nowe miejsce zdjęcia po przeniesieniu pliku.
fn relocate_in_db(state: &AppState, id: i64, target: &Path, dest: &Path) -> Result<(), String> {
    let new_name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    // Nieaktualny wiersz o tej ścieżce (pliku już nie ma) nie może zablokować przeniesienia.
    conn.execute("DELETE FROM photos WHERE path = ?1 AND id != ?2", params![target.to_string_lossy(), id]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE photos SET path = ?2, folder = ?3, name = ?4 WHERE id = ?1", params![id, target.to_string_lossy(), dest.to_string_lossy(), new_name]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Przenosi zdjęcie do folderu `dest`. Zajęta nazwa dostaje końcówkę _1, _2 (nic nie jest nadpisywane), a zablokowany folder odrzuca przeniesienie.
/// Zwraca (skąd, dokąd) albo None, gdy zdjęcie już tam leży.
pub(crate) fn move_photo_to(state: &AppState, id: i64, dest: &Path) -> Result<Option<(PathBuf, PathBuf)>, String> {
    let (path, _, _) = photo_path(state, id)?;
    let src = PathBuf::from(&path);
    locks::ensure_unlocked_state(state, &src)?;
    if src.parent() == Some(dest) {
        return Ok(None);
    }
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let target = unique_target(dest, &name);
    move_file(&src, &target)?;
    carry_sidecar(&src, &target, false);
    relocate_in_db(state, id, &target, dest)?;
    Ok(Some((src, target)))
}

/// Przenosi zdjęcie dokładnie pod wskazaną ścieżkę (do cofania przeniesień). Zajętej ścieżki nie nadpisuje.
pub(crate) fn move_photo_exact(state: &AppState, id: i64, target: &Path) -> Result<(), String> {
    let (path, _, _) = photo_path(state, id)?;
    let src = PathBuf::from(&path);
    locks::ensure_unlocked_state(state, &src)?;
    if target.exists() {
        return Err("miejsce docelowe jest zajęte".into());
    }
    let dest = target.parent().ok_or("brak folderu")?;
    move_file(&src, target)?;
    carry_sidecar(&src, target, false);
    relocate_in_db(state, id, target, dest)
}

/// Zmienia nazwę pliku zdjęcia (rozszerzenie zostaje). Zwraca nową nazwę z rozszerzeniem.
#[tauri::command]
fn rename_photo(state: State<'_, AppState>, id: i64, new_stem: String) -> Result<String, String> {
    rename_photo_core(&state, id, &new_stem)
}

fn rename_photo_core(state: &AppState, id: i64, new_stem: &str) -> Result<String, String> {
    let stem = valid_stem(new_stem)?;
    let (path, _, _) = photo_path(state, id)?;
    let src = PathBuf::from(&path);
    locks::ensure_unlocked_state(state, &src)?;
    let dir = src.parent().ok_or("brak folderu")?.to_path_buf();
    let old_name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let new_name = match src.extension() {
        Some(e) => format!("{stem}.{}", e.to_string_lossy()),
        None => stem,
    };
    let dst = dir.join(&new_name);
    if dst.exists() && new_name.to_lowercase() != old_name.to_lowercase() {
        return Err("Plik o tej nazwie już istnieje w tym folderze".into());
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    carry_sidecar(&src, &dst, false);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE photos SET path = ?2, name = ?3 WHERE id = ?1",
        params![id, dst.to_string_lossy(), new_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_name)
}

#[derive(Serialize, Default, Debug)]
struct MoveReport {
    done: usize,
    errors: Vec<String>,
}

/// Przenosi lub kopiuje zdjęcia do wskazanego folderu. Przy zajętej nazwie dopisuje _1, _2, nic nie nadpisuje.
fn move_photos_blocking(state: &AppState, ids: &[i64], dest: &Path, copy: bool) -> Result<MoveReport, String> {
    if !dest.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    let mut rep = MoveReport::default();
    for &id in ids {
        if !copy {
            let (path, _, _) = photo_path(state, id)?;
            match move_photo_to(state, id, dest) {
                Ok(Some(_)) => rep.done += 1,
                Ok(None) => {} // już tam jest
                Err(e) => rep.errors.push(format!("{path}: {e}")),
            }
            continue;
        }
        let (path, taken, camera) = photo_path(state, id)?;
        let src = PathBuf::from(&path);
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let target = unique_target(dest, &name);
        if let Err(e) = fs::copy(&src, &target) {
            rep.errors.push(format!("{name}: {e}"));
            continue;
        }
        carry_sidecar(&src, &target, true);
        reindex(state, &target, taken, camera)?;
        rep.done += 1;
    }
    Ok(rep)
}

#[tauri::command]
async fn move_photos(app: tauri::AppHandle, ids: Vec<i64>, dest: String, copy: bool) -> Result<MoveReport, String> {
    tauri::async_runtime::spawn_blocking(move || move_photos_blocking(&app.state::<AppState>(), &ids, Path::new(&dest), copy))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Default, Debug)]
struct PhotoImportReport {
    copied: usize,
    skipped: usize,
    errors: Vec<String>,
}

/// Importuje zdjęcia z karty pamięci lub folderu do biblioteki: kopiuje je do `dest/RRRR/RRRR-MM-DD/` według daty wykonania.
/// Pliki źródłowe nie są zmieniane ani usuwane. Zdjęcie już zaimportowane (ta sama nazwa i rozmiar w folderze dnia) jest pomijane,
/// a inny plik o tej samej nazwie dostaje końcówkę _1, _2, nic nie jest nadpisywane.
fn import_blocking(src: &Path, dest: &Path, progress: &dyn Fn(usize)) -> Result<PhotoImportReport, String> {
    let _job = jobs::Guard::new("import");
    if !src.is_dir() || !dest.is_dir() {
        return Err("Folder źródłowy i docelowy muszą istnieć".into());
    }
    let (cs, cd) = (fs::canonicalize(src).map_err(|e| e.to_string())?, fs::canonicalize(dest).map_err(|e| e.to_string())?);
    if cs == cd || cd.starts_with(&cs) {
        return Err("Folder docelowy nie może być tym samym folderem ani leżeć w folderze źródłowym".into());
    }
    let mut rep = PhotoImportReport::default();
    let walker = WalkDir::new(src).into_iter().filter_entry(|e| e.file_name() != ORIGINALS_DIR);
    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if !entry.file_type().is_file() || !formats::should_scan(path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let day: String = read_exif(path)
            .taken
            .map(|t| t.chars().take(10).map(|c| if c == ':' { '-' } else { c }).collect::<String>())
            .filter(|d| d.len() == 10 && d.chars().all(|c| c.is_ascii_digit() || c == '-') && !d.starts_with("0000"))
            .unwrap_or_else(|| {
                let secs = mtime_secs(&meta).max(0);
                let (y, m, d) = civil_from_days(secs / 86400);
                format!("{y:04}-{m:02}-{d:02}")
            });
        let target_dir = dest.join(&day[..4]).join(&day);
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let existing = target_dir.join(&name);
        if existing.is_file() && fs::metadata(&existing).map(|m| m.len() == meta.len()).unwrap_or(false) {
            rep.skipped += 1;
            continue;
        }
        let result = fs::create_dir_all(&target_dir).map_err(|e| e.to_string()).and_then(|_| {
            let target = unique_target(&target_dir, &name);
            fs::copy(path, &target).map_err(|e| e.to_string())?;
            if fs::metadata(&target).map(|m| m.len()).unwrap_or(0) != meta.len() {
                let _ = fs::remove_file(&target);
                return Err("rozmiar kopii się nie zgadza".to_string());
            }
            // Plik XMP zdjęcia (tagi, oceny) idzie razem z nim.
            let xmp = xmp_path(path);
            if xmp.is_file() {
                let _ = fs::copy(&xmp, xmp_path(&target));
            }
            Ok(())
        });
        match result {
            Ok(()) => {
                rep.copied += 1;
                progress(rep.copied);
            }
            Err(e) => rep.errors.push(format!("{}: {e}", path.display())),
        }
    }
    Ok(rep)
}

/// Data (rok, miesiąc, dzień) z liczby dni od 1970-01-01 (algorytm Howarda Hinnanta).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[tauri::command]
async fn import_photos(app: tauri::AppHandle, src: String, dest: String) -> Result<PhotoImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        import_blocking(Path::new(&src), Path::new(&dest), &move |n| {
            let _ = emitter.emit("scan-progress", n);
            jobs::stage("import", n, 0, &format!("Skopiowano zdjęć: {n}"));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Nazwa z szablonu: [data]_[prefiks]_[numer]. Numer ma co najmniej 3 cyfry (więcej, gdy zdjęć jest dużo).
fn batch_stem(prefix: &str, date: Option<&str>, n: u32, width: usize) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(d) = date {
        parts.push(d.to_string());
    }
    let p = prefix.trim();
    if !p.is_empty() {
        parts.push(p.to_string());
    }
    parts.push(format!("{n:0width$}"));
    parts.join("_")
}

/// Zmienia nazwy wielu zdjęć naraz według szablonu. Każda nazwa przechodzi tę samą walidację co pojedyncza zmiana nazwy,
/// nic nie jest nadpisywane, a błędy są zgłaszane osobno dla zdjęć, których nie udało się zmienić.
fn rename_batch_core(state: &AppState, ids: &[i64], prefix: &str, with_date: bool, start: u32) -> Result<MoveReport, String> {
    if ids.len() > 100_000 {
        return Err("Zbyt wiele zdjęć".into());
    }
    let last = start.checked_add(ids.len() as u32).ok_or("Zbyt duży numer początkowy")?;
    let width = last.to_string().len().max(3);
    let mut rep = MoveReport::default();
    for (i, &id) in ids.iter().enumerate() {
        let date = if with_date {
            let taken: Option<String> = state.db.lock().map_err(|e| e.to_string())?
                .query_row("SELECT COALESCE(taken, datetime(modified,'unixepoch')) FROM photos WHERE id = ?1", [id], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            taken.map(|t| t.chars().take(10).map(|c| if c == ':' { '-' } else { c }).collect::<String>())
        } else {
            None
        };
        let stem = batch_stem(prefix, date.as_deref(), start + i as u32, width);
        match rename_photo_core(state, id, &stem) {
            Ok(_) => rep.done += 1,
            Err(e) => rep.errors.push(format!("{stem}: {e}")),
        }
    }
    Ok(rep)
}

#[tauri::command]
async fn rename_batch(app: tauri::AppHandle, ids: Vec<i64>, prefix: String, with_date: bool, start: u32) -> Result<MoveReport, String> {
    tauri::async_runtime::spawn_blocking(move || rename_batch_core(&app.state::<AppState>(), &ids, &prefix, with_date, start))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct Prop {
    kind: String,
    key: String,
    description: String,
    place: String,
    date: String,
}

#[tauri::command]
fn list_props(state: State<'_, AppState>) -> Result<Vec<Prop>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT kind, key, COALESCE(description,''), COALESCE(place,''), COALESCE(date,'') FROM props").map_err(|e| e.to_string())?;
    let v = stmt
        .query_map([], |r| Ok(Prop { kind: r.get(0)?, key: r.get(1)?, description: r.get(2)?, place: r.get(3)?, date: r.get(4)? }))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(v)
}

fn clean_prop(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect::<String>().trim().to_string()
}

/// Zapisuje opis, miejsce i datę albumu lub folderu (same puste pola usuwają wpis). Dane są przeszukiwalne i zostają w bibliotece FIBO.
fn set_props_core(conn: &Connection, kind: &str, key: &str, description: &str, place: &str, date: &str) -> Result<(), String> {
    if kind != "album" && kind != "folder" {
        return Err("Nieznany rodzaj".into());
    }
    if key.is_empty() || key.chars().count() > 1000 {
        return Err("Nieprawidłowy klucz".into());
    }
    let (description, place, date) = (clean_prop(description, 2000), clean_prop(place, 200), date.trim().to_string());
    if !date.is_empty() && (parse_ts(&date).is_none() || date.len() != 10) {
        return Err("Data musi mieć postać RRRR-MM-DD".into());
    }
    if description.is_empty() && place.is_empty() && date.is_empty() {
        conn.execute("DELETE FROM props WHERE kind = ?1 AND key = ?2", params![kind, key]).map_err(|e| e.to_string())?;
    } else {
        conn.execute("INSERT OR REPLACE INTO props (kind, key, description, place, date) VALUES (?1, ?2, ?3, ?4, ?5)", params![kind, key, description, place, date]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_props(state: State<'_, AppState>, kind: String, key: String, description: String, place: String, date: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    set_props_core(&conn, &kind, &key, &description, &place, &date)
}

#[derive(Serialize)]
struct SmartAlbum {
    id: i64,
    name: String,
    filters: String,
}

#[tauri::command]
fn list_smart(state: State<'_, AppState>) -> Result<Vec<SmartAlbum>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, filters FROM smart_albums ORDER BY name COLLATE NOCASE").map_err(|e| e.to_string())?;
    let v = stmt.query_map([], |r| Ok(SmartAlbum { id: r.get(0)?, name: r.get(1)?, filters: r.get(2)? })).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    Ok(v)
}

/// Zapisuje album inteligentny (ta sama nazwa zastępuje filtry). Filtry muszą być obiektem JSON do 4000 znaków.
fn save_smart_core(conn: &Connection, name: &str, filters: &str) -> Result<(), String> {
    let name: String = name.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(60).collect();
    if name.is_empty() {
        return Err("Podaj nazwę albumu".into());
    }
    if filters.len() > 4000 || !serde_json::from_str::<serde_json::Value>(filters).map(|v| v.is_object()).unwrap_or(false) {
        return Err("Nieprawidłowe filtry".into());
    }
    conn.execute(
        "INSERT INTO smart_albums (name, filters) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET filters = ?2",
        params![name, filters],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_smart(state: State<'_, AppState>, name: String, filters: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    save_smart_core(&conn, &name, &filters)
}

#[tauri::command]
fn delete_smart(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM smart_albums WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Dane EXIF zdjęcia do pokazania w panelu informacji: (nazwa po polsku, wartość). Tylko odczyt, wartości są przycinane.
/// Wybrane pola EXIF (nazwa po polsku, wartość), wartości przycięte do 200 znaków.
fn exif_pairs(exif: &exif::Exif) -> Vec<(String, String)> {
    let wanted: [(exif::Tag, &str); 17] = [
        (exif::Tag::Make, "Producent aparatu"), (exif::Tag::Model, "Model aparatu"), (exif::Tag::LensModel, "Obiektyw"),
        (exif::Tag::DateTimeOriginal, "Data wykonania"), (exif::Tag::ExposureTime, "Czas naświetlania"), (exif::Tag::FNumber, "Przysłona"),
        (exif::Tag::PhotographicSensitivity, "ISO"), (exif::Tag::FocalLength, "Ogniskowa"), (exif::Tag::FocalLengthIn35mmFilm, "Ogniskowa (odpowiednik 35 mm)"),
        (exif::Tag::ExposureBiasValue, "Korekcja ekspozycji"), (exif::Tag::MeteringMode, "Pomiar światła"), (exif::Tag::ExposureProgram, "Program ekspozycji"),
        (exif::Tag::Flash, "Lampa błyskowa"), (exif::Tag::WhiteBalance, "Balans bieli"), (exif::Tag::Software, "Oprogramowanie"),
        (exif::Tag::Orientation, "Orientacja"), (exif::Tag::Artist, "Autor"),
    ];
    wanted
        .iter()
        .filter_map(|(tag, label)| {
            let f = exif.get_field(*tag, exif::In::PRIMARY)?;
            let v = f.display_value().with_unit(exif).to_string().trim_matches('"').trim().to_string();
            (!v.is_empty()).then(|| (label.to_string(), v.chars().take(200).collect()))
        })
        .collect()
}

/// Tekst do szukania po danych aparatu: model, obiektyw, ISO, przysłona, czas, ogniskowa (bez daty i orientacji).
fn exif_summary(exif: &exif::Exif) -> String {
    let s: Vec<String> = exif_pairs(exif)
        .into_iter()
        .filter(|(k, _)| k != "Data wykonania" && k != "Orientacja" && k != "Oprogramowanie" && k != "Autor")
        .map(|(k, v)| if k == "ISO" { format!("ISO {v}") } else { v })
        .collect();
    s.join(" ").chars().take(400).collect()
}

fn exif_details(path: &Path) -> Vec<(String, String)> {
    let Ok(file) = File::open(path) else { return vec![] };
    let Ok(exif) = exif::Reader::new().read_from_container(&mut BufReader::new(file)) else { return vec![] };
    exif_pairs(&exif)
}

#[tauri::command]
fn photo_exif(state: State<'_, AppState>, id: i64) -> Result<Vec<(String, String)>, String> {
    let (path, _, _) = photo_path(&state, id)?;
    Ok(exif_details(Path::new(&path)))
}

/// Liczba dni od 1970-01-01 dla daty (odwrotność `civil_from_days`).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// „RRRR-MM-DD GG:MM:SS” (także z „:” w dacie) na sekundy od 1970 (bez stref czasowych, jak w EXIF).
fn parse_ts(s: &str) -> Option<i64> {
    let n: Vec<i64> = s.split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).map(|x| x.parse().ok()).collect::<Option<_>>()?;
    if n.len() < 3 || !(1..=12).contains(&n[1]) || !(1..=31).contains(&n[2]) || !(1900..=2200).contains(&n[0]) {
        return None;
    }
    let (h, mi, se) = (n.get(3).copied().unwrap_or(0), n.get(4).copied().unwrap_or(0), n.get(5).copied().unwrap_or(0));
    if h > 23 || mi > 59 || se > 59 {
        return None;
    }
    Some(days_from_civil(n[0], n[1], n[2]) * 86400 + h * 3600 + mi * 60 + se)
}

fn fmt_ts(secs: i64) -> String {
    let (y, m, d) = civil_from_days(secs.div_euclid(86400));
    let r = secs.rem_euclid(86400);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", r / 3600, r % 3600 / 60, r % 60)
}

/// Zmienia datę zdjęć w bibliotece: `Set` ustawia dokładną datę, `Shift` przesuwa o minuty (np. zły zegar aparatu).
/// Zmiana jest w bibliotece FIBO (pliki zdjęć bez zmian) i przetrwa ponowne skanowanie.
enum DateChange {
    Set(i64),
    Shift(i64),
}

fn change_dates_core(conn: &Connection, ids: &[i64], change: DateChange) -> Result<usize, String> {
    let mut n = 0;
    for &id in ids {
        let (taken, modified): (Option<String>, i64) = conn
            .query_row("SELECT taken, modified FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        let new = match change {
            DateChange::Set(t) => t,
            DateChange::Shift(m) => taken.as_deref().and_then(parse_ts).unwrap_or(modified).checked_add(m.checked_mul(60).ok_or("Zbyt duże przesunięcie")?).ok_or("Zbyt duże przesunięcie")?,
        };
        if !(parse_ts("1900-01-01").unwrap_or(0)..=parse_ts("2200-12-31").unwrap_or(i64::MAX)).contains(&new) {
            return Err("Data poza dozwolonym zakresem (1900-2200)".into());
        }
        n += conn.execute("UPDATE photos SET taken = ?2, taken_manual = 1 WHERE id = ?1", params![id, fmt_ts(new)]).map_err(|e| e.to_string())?;
    }
    Ok(n)
}

#[tauri::command]
fn set_date(state: State<'_, AppState>, ids: Vec<i64>, date: String) -> Result<usize, String> {
    let t = parse_ts(&date).ok_or("Nieprawidłowa data")?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    change_dates_core(&conn, &ids, DateChange::Set(t))
}

#[tauri::command]
fn shift_dates(state: State<'_, AppState>, ids: Vec<i64>, minutes: i64) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    change_dates_core(&conn, &ids, DateChange::Shift(minutes))
}

const MAX_CAPTION: usize = 2000;

/// Zapisuje opis zdjęcia (pusty tekst usuwa opis). Opis jest przeszukiwalny i zostaje w bibliotece FIBO.
#[tauri::command]
fn set_caption(state: State<'_, AppState>, id: i64, caption: String) -> Result<(), String> {
    let text: String = caption.chars().filter(|c| !c.is_control() || *c == '\n').take(MAX_CAPTION).collect();
    let text = text.trim();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let value: Option<&str> = if text.is_empty() { None } else { Some(text) };
    conn.execute("UPDATE photos SET caption = ?2 WHERE id = ?1", params![id, value]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Ustawia lokalizację zdjęć ręcznie (None = brak lokalizacji). Zapisuje tylko w bibliotece FIBO, plików zdjęć nie zmienia.
fn set_location_core(conn: &Connection, ids: &[i64], loc: Option<(f64, f64)>) -> Result<usize, String> {
    if let Some((la, lo)) = loc {
        if !(la.is_finite() && lo.is_finite() && (-90.0..=90.0).contains(&la) && (-180.0..=180.0).contains(&lo)) {
            return Err("Nieprawidłowe współrzędne".into());
        }
    }
    let mut n = 0;
    for &id in ids {
        n += conn
            .execute("UPDATE photos SET lat = ?2, lon = ?3, geo_manual = 1, place = NULL, country = NULL WHERE id = ?1", params![id, loc.map(|l| l.0), loc.map(|l| l.1)])
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

#[tauri::command]
fn set_location(state: State<'_, AppState>, ids: Vec<i64>, lat: Option<f64>, lon: Option<f64>) -> Result<usize, String> {
    let loc = match (lat, lon) {
        (Some(a), Some(b)) => Some((a, b)),
        (None, None) => None,
        _ => return Err("Podaj obie współrzędne".into()),
    };
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    set_location_core(&conn, &ids, loc)
}

/// Eksport kopii zdjęć do folderu: opcjonalnie pomniejszonych (dłuższy bok `max_side`, 0 = bez zmiany rozmiaru), jako JPEG.
/// Kopie nie zawierają metadanych EXIF (w tym lokalizacji GPS), więc nadają się do wysłania znajomym. Oryginały nie są ruszane,
/// a istniejące pliki nie są nadpisywane.
fn export_photos_blocking(state: &AppState, ids: &[i64], dest: &Path, max_side: u32, quality: u8, wm: Option<&watermark::Watermark>) -> Result<MoveReport, String> {
    export_photos_as(state, ids, dest, max_side, quality, wm, "jpg")
}

/// Rozszerzenie pliku i kodowanie dla formatu eksportu: „jpg” (z jakością), „png” albo „webp” (oba bez strat, z zachowaniem przezroczystości).
fn export_format(format: &str) -> Result<&'static str, String> {
    match format {
        "jpg" | "jpeg" => Ok("jpg"),
        "png" => Ok("png"),
        "webp" => Ok("webp"),
        other => Err(format!("Nieznany format eksportu: {other}")),
    }
}

fn encode_export(img: &image::DynamicImage, ext: &str, quality: u8, target: &Path) -> Result<(), String> {
    let result = (|| -> Result<(), String> {
        let file = File::create(target).map_err(|e| e.to_string())?;
        let mut w = std::io::BufWriter::new(file);
        match ext {
            "png" => img.write_to(&mut w, image::ImageFormat::Png).map_err(|e| e.to_string())?,
            "webp" => img.write_to(&mut w, image::ImageFormat::WebP).map_err(|e| e.to_string())?,
            _ => image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, quality).encode_image(&img.to_rgb8()).map_err(|e| e.to_string())?,
        }
        std::io::Write::flush(&mut w).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(target);
    }
    result
}

fn export_photos_as(state: &AppState, ids: &[i64], dest: &Path, max_side: u32, quality: u8, wm: Option<&watermark::Watermark>, format: &str) -> Result<MoveReport, String> {
    let _job = jobs::Guard::new("export");
    let ext = export_format(format)?;
    if !dest.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    if max_side > 20000 {
        return Err("Zbyt duży rozmiar".into());
    }
    let quality = quality.clamp(1, 100);
    // Logo znaku wodnego sprawdzamy i wczytujemy raz, przed kopiowaniem czegokolwiek.
    let logo = wm.map(watermark::load_logo).transpose()?;
    let mut rep = MoveReport::default();
    for (k, &id) in ids.iter().enumerate() {
        jobs::tick("export", k, ids.len());
        let (path, _, _) = photo_path(state, id)?;
        let src = PathBuf::from(&path);
        let result = (|| -> Result<(), String> {
            let (mut img, orientation) = formats::open(&src)?;
            let orientation = orientation as u32;
            if max_side > 0 && img.width().max(img.height()) > max_side {
                img = img.resize(max_side, max_side, FilterType::Lanczos3);
            }
            img = match orientation {
                2 => img.fliph(),
                3 => img.rotate180(),
                4 => img.flipv(),
                6 => img.rotate90(),
                8 => img.rotate270(),
                _ => img,
            };
            if let (Some(l), Some(w)) = (&logo, wm) {
                img = watermark::apply(img, l, w);
            }
            let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "zdjecie".into());
            let target = unique_target(dest, &format!("{stem}.{ext}"));
            encode_export(&img, ext, quality, &target)
        })();
        match result {
            Ok(()) => rep.done += 1,
            Err(e) => rep.errors.push(format!("{path}: {e}")),
        }
    }
    Ok(rep)
}

#[tauri::command]
async fn export_photos(app: tauri::AppHandle, ids: Vec<i64>, dest: String, max_side: u32, quality: u8, watermark: Option<watermark::Watermark>, format: Option<String>) -> Result<MoveReport, String> {
    tauri::async_runtime::spawn_blocking(move || export_photos_as(&app.state::<AppState>(), &ids, Path::new(&dest), max_side, quality, watermark.as_ref(), format.as_deref().unwrap_or("jpg")))
        .await
        .map_err(|e| e.to_string())?
}

// ---- Duplikaty ------------------------------------------------------------

/// Suma kontrolna FNV-1a (64 bity) całej zawartości pliku.
fn file_hash(path: &Path) -> Option<u64> {
    use std::io::Read;
    let mut f = File::open(path).ok()?;
    let mut buf = vec![0u8; 1 << 16];
    let mut h: u64 = 0xcbf29ce484222325;
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        for &b in &buf[..n] {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    Some(h)
}

/// Hash różnicowy (dHash): 64 bity opisujące, czy jasność rośnie w prawo na siatce 9×8.
/// Zmniejszenie, kompresja i drobne korekty prawie go nie zmieniają.
fn perceptual_hash(thumb: &Path) -> Option<u64> {
    let g = image::open(thumb).ok()?.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut h = 0u64;
    for y in 0..8u32 {
        for x in 0..8u32 {
            if g.get_pixel(x, y)[0] > g.get_pixel(x + 1, y)[0] {
                h |= 1 << (y * 8 + x);
            }
        }
    }
    Some(h)
}

#[derive(Serialize)]
struct DupGroup {
    kind: &'static str,
    ids: Vec<i64>,
}

struct Rec {
    id: i64,
    path: String,
    size: i64,
    modified: i64,
    fh: Option<i64>,
    dh: Option<i64>,
}

fn find(parent: &mut Vec<usize>, mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

fn union(parent: &mut Vec<usize>, a: usize, b: usize) {
    let (ra, rb) = (find(parent, a), find(parent, b));
    if ra != rb {
        parent[ra] = rb;
    }
}

fn find_duplicates_blocking(app: &tauri::AppHandle, max_distance: Option<u32>) -> Result<Vec<DupGroup>, String> {
    let _job = jobs::Guard::new("dups");
    let state = app.state::<AppState>();
    let mut recs: Vec<Rec> = Vec::new();
    let mut stale: Vec<bool> = Vec::new();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, path, size, modified, fhash, dhash, hashed_mod FROM photos WHERE hidden = 0 AND video = 0")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    Rec { id: r.get(0)?, path: r.get(1)?, size: r.get(2)?, modified: r.get(3)?, fh: r.get(4)?, dh: r.get(5)? },
                    r.get::<_, Option<i64>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.filter_map(Result::ok) {
            let (mut rec, hm) = row;
            // Plik zmienił się od ostatniego liczenia: stare skróty są nieważne.
            let changed = hm != Some(rec.modified);
            if changed {
                rec.fh = None;
                rec.dh = None;
            }
            stale.push(changed);
            recs.push(rec);
        }
    }

    // Co trzeba policzyć: suma kontrolna zawsze, hash percepcyjny tylko przy szukaniu podobnych.
    let jobs: Vec<usize> = (0..recs.len()).filter(|&i| recs[i].fh.is_none() || (max_distance.is_some() && recs[i].dh.is_none())).collect();
    let total = jobs.len();
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).min(8);
    let want_d = max_distance.is_some();
    let mut done = 0;
    for batch in jobs.chunks(64) {
        let results: Vec<(usize, Option<u64>, Option<u64>)> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..threads)
                .map(|t| {
                    let (recs, thumbs) = (&recs, &state.thumbs);
                    s.spawn(move || {
                        let mut out = Vec::new();
                        for (k, &i) in batch.iter().enumerate() {
                            if k % threads != t {
                                continue;
                            }
                            let r = &recs[i];
                            let fh = r.fh.map(|v| v as u64).or_else(|| file_hash(Path::new(&r.path)));
                            let dh = if want_d {
                                r.dh.map(|v| v as u64).or_else(|| {
                                    let thumb = thumbs.join(format!("{}_{}.jpg", r.id, r.modified));
                                    if !thumb.exists() {
                                        make_thumb(Path::new(&r.path), &thumb).ok()?;
                                    }
                                    perceptual_hash(&thumb)
                                })
                            } else {
                                r.dh.map(|v| v as u64)
                            };
                            out.push((i, fh, dh));
                        }
                        out
                    })
                })
                .collect();
            handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
        });
        {
            let mut conn = state.db.lock().map_err(|e| e.to_string())?;
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            for (i, fh, dh) in &results {
                recs[*i].fh = fh.map(|v| v as i64);
                recs[*i].dh = dh.map(|v| v as i64);
                tx.execute(
                    "UPDATE photos SET fhash = ?2, dhash = ?3, hashed_mod = ?4 WHERE id = ?1",
                    params![recs[*i].id, recs[*i].fh, recs[*i].dh, recs[*i].modified],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
        done += batch.len();
        let _ = app.emit("dup-progress", (done, total));
        jobs::tick("dups", done, total);
    }
    jobs::stage("dups", total, total, "Porównuję zdjęcia…");
    let _ = stale; // informacja pomocnicza, wynik zapisany w bazie przez hashed_mod

    let mut parent: Vec<usize> = (0..recs.len()).collect();

    // Identyczne: ten sam rozmiar i ta sama suma kontrolna.
    let mut by_hash: std::collections::HashMap<(i64, i64), usize> = std::collections::HashMap::new();
    for i in 0..recs.len() {
        if let Some(fh) = recs[i].fh {
            match by_hash.get(&(recs[i].size, fh)) {
                Some(&first) => union(&mut parent, first, i),
                None => { by_hash.insert((recs[i].size, fh), i); }
            }
        }
    }

    // Podobne: odległość Hamminga między hashami. Hash prawie jednolity (czarne, białe kadry) jest niewiarygodny.
    if let Some(max) = max_distance {
        let hashed: Vec<(usize, u64)> = recs
            .iter()
            .enumerate()
            .filter_map(|(i, r)| r.dh.map(|h| (i, h as u64)))
            .filter(|(_, h)| (8..=56).contains(&h.count_ones()))
            .collect();
        for a in 0..hashed.len() {
            for b in (a + 1)..hashed.len() {
                if (hashed[a].1 ^ hashed[b].1).count_ones() <= max {
                    union(&mut parent, hashed[a].0, hashed[b].0);
                }
            }
        }
    }

    let mut groups: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
    for i in 0..recs.len() {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(i);
    }
    let mut out: Vec<DupGroup> = groups
        .into_values()
        .filter(|g| g.len() > 1)
        .map(|g| {
            let first = &recs[g[0]];
            let exact = g.iter().all(|&i| recs[i].fh.is_some() && recs[i].fh == first.fh && recs[i].size == first.size);
            DupGroup { kind: if exact { "exact" } else { "similar" }, ids: g.iter().map(|&i| recs[i].id).collect() }
        })
        .collect();
    out.sort_by(|a, b| b.ids.len().cmp(&a.ids.len()).then(a.ids[0].cmp(&b.ids[0])));
    Ok(out)
}

/// Szuka duplikatów. `max_distance` None = tylko identyczne pliki; Some(n) = także podobne (0-64, sensowne 4-10).
#[tauri::command]
async fn find_duplicates(app: tauri::AppHandle, max_distance: Option<u32>) -> Result<Vec<DupGroup>, String> {
    tauri::async_runtime::spawn_blocking(move || find_duplicates_blocking(&app, max_distance))
        .await
        .map_err(|e| e.to_string())?
}

/// Od tej liczby zdjęć usunięcie z dysku wymaga wpisania słowa potwierdzenia (sprawdzane w backendzie, nie tylko w oknie).
const TRASH_CONFIRM_FROM: usize = 20;
const TRASH_CONFIRM_WORD: &str = "USUŃ";

/// Ukrywa zdjęcia w bibliotece. Pliki na dysku zostają nietknięte, a tagi i oceny są zachowane.
#[tauri::command]
fn hide_photos(state: State<'_, AppState>, ids: Vec<i64>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut n = 0;
    for id in ids {
        n += conn.execute("UPDATE photos SET hidden = 1 WHERE id = ?1 AND hidden = 0", [id]).map_err(|e| e.to_string())?;
    }
    Ok(n)
}

#[tauri::command]
fn hidden_count(state: State<'_, AppState>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.query_row("SELECT COUNT(*) FROM photos WHERE hidden = 1", [], |r| r.get(0)).map_err(|e| e.to_string())
}

/// Przywraca do biblioteki wszystkie ukryte zdjęcia, których pliki nadal istnieją. Zapominane są tylko te, których pliku nie ma w istniejącym folderze;
/// zdjęcia z odłączonego dysku albo niedostępnej sieci zostają ukryte, z tagami, albumami i ocenami.
#[tauri::command]
async fn restore_hidden(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let rows: Vec<(i64, String)> = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn.prepare("SELECT id, path FROM photos WHERE hidden = 1").map_err(|e| e.to_string())?;
            let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            v
        };
        // Pliki sprawdzamy bez blokady bazy.
        let (mut back, mut forget) = (Vec::new(), Vec::new());
        for (id, path) in rows {
            let p = Path::new(&path);
            if p.is_file() {
                back.push(id);
            } else if matches!(fs::metadata(p), Err(e) if e.kind() == std::io::ErrorKind::NotFound) && p.parent().map(|d| d.is_dir()).unwrap_or(false) {
                forget.push(id);
            }
        }
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for id in &back {
            tx.execute("UPDATE photos SET hidden = 0 WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        }
        for id in &forget {
            forget_photo(&tx, *id).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        sweep_thumbs(&state.thumbs, &forget.iter().copied().collect());
        Ok(back.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Przenosi pliki do Kosza Windows (można je stamtąd przywrócić) i usuwa je z biblioteki.
/// Zabezpieczenia: tylko zdjęcia znane bibliotece, tylko zwykłe pliki zdjęć (nie foldery ani dowiązania),
/// a od 20 zdjęć trzeba przekazać słowo potwierdzenia. Nigdy nie usuwamy całych folderów.
#[tauri::command]
fn trash_photos(state: State<'_, AppState>, ids: Vec<i64>, confirm: Option<String>) -> Result<usize, String> {
    trash_photos_core(&state, ids, confirm, &|p| trash::delete(p).map_err(|e| e.to_string()))
}

/// Logika usuwania z wymiennym „usuwaczem” (w programie Kosz Windows, w testach zwykłe usunięcie z katalogu tymczasowego).
fn trash_photos_core(state: &AppState, ids: Vec<i64>, confirm: Option<String>, del: &dyn Fn(&str) -> Result<(), String>) -> Result<usize, String> {
    let mut ids = ids;
    ids.sort_unstable();
    ids.dedup();
    if ids.len() >= TRASH_CONFIRM_FROM && confirm.as_deref().map(str::trim) != Some(TRASH_CONFIRM_WORD) {
        return Err(format!("Usunięcie {} zdjęć wymaga wpisania słowa {TRASH_CONFIRM_WORD}", ids.len()));
    }
    // Najpierw sprawdzamy wszystkie ścieżki, żeby błąd nie zostawił połowy operacji.
    let mut targets = Vec::new();
    for id in &ids {
        let (path, _, _) = photo_path(&state, *id)?;
        let p = Path::new(&path);
        locks::ensure_unlocked_state(state, p)?;
        match std::fs::symlink_metadata(p) {
            Ok(m) if m.is_file() && is_photo(p) => targets.push((*id, path, true)),
            Ok(_) => return Err(format!("{path}: to nie jest zwykły plik zdjęcia, nie usuwam")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => targets.push((*id, path, false)),
            Err(e) => return Err(format!("{path}: {e}")),
        }
    }
    let mut n = 0;
    let mut forgotten: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for (id, path, exists) in targets {
        if exists {
            del(&path).map_err(|e| format!("{path}: {e}"))?;
        }
        // Własny plik XMP zdjęcia też trafia do Kosza (cudzych nie ruszamy).
        let xmp = xmp_path(Path::new(&path));
        if read_xmp_limited(&xmp).map(|b| String::from_utf8_lossy(&b).contains(XMP_MARKER)).unwrap_or(false) {
            let _ = del(&xmp.to_string_lossy());
        }
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        forget_photo(&conn, id).map_err(|e| e.to_string())?;
        forgotten.insert(id);
        n += 1;
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags)", []).map_err(|e| e.to_string())?;
    drop(conn);
    sweep_thumbs(&state.thumbs, &forgotten);
    Ok(n)
}

/// Tag zawsze małymi literami, bez zbędnych spacji i przecinków, do 40 znaków.
fn norm_tag(s: &str) -> Option<String> {
    let joined = s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let t: String = joined.chars().filter(|c| *c != ',' && *c != '\u{1f}').take(40).collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// Dodaje tag do zdjęć; zwraca nazwę po normalizacji.
#[tauri::command]
fn add_tag(state: State<'_, AppState>, ids: Vec<i64>, tag: String) -> Result<String, String> {
    let name = norm_tag(&tag).ok_or("Tag nie może być pusty")?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [&name]).map_err(|e| e.to_string())?;
    let tag_id: i64 = tx.query_row("SELECT id FROM tags WHERE name = ?1", [&name], |r| r.get(0)).map_err(|e| e.to_string())?;
    // INSERT OR IGNORE: tag, który zdjęcie już ma, nie zostanie zdublowany.
    for &id in &ids {
        tx.execute("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?1, ?2)", params![id, tag_id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    sync_ids(&state, &ids);
    Ok(name)
}

/// Zdejmuje tag ze zdjęć; tag, którego nie używa żadne zdjęcie, znika z listy.
#[tauri::command]
fn remove_tag(state: State<'_, AppState>, ids: Vec<i64>, tag: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for &id in &ids {
        tx.execute(
            "DELETE FROM photo_tags WHERE photo_id = ?1 AND tag_id = (SELECT id FROM tags WHERE name = ?2)",
            params![id, tag],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags)", []).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    sync_ids(&state, &ids);
    Ok(())
}

/// Usuwa tag ze wszystkich zdjęć naraz.
#[tauri::command]
fn delete_tag(state: State<'_, AppState>, tag: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    // Zdjęcia, których plik XMP trzeba będzie odświeżyć po usunięciu tagu.
    let ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT photo_id FROM photo_tags WHERE tag_id = (SELECT id FROM tags WHERE name = ?1)")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&tag], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        rows
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM photo_tags WHERE tag_id = (SELECT id FROM tags WHERE name = ?1)", [&tag]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tags WHERE name = ?1", [&tag]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    sync_ids(&state, &ids);
    Ok(())
}

#[tauri::command]
fn set_rating(state: State<'_, AppState>, id: i64, rating: i64) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE photos SET rating = ?2 WHERE id = ?1", params![id, rating.clamp(0, 5)])
            .map_err(|e| e.to_string())?;
    }
    sync_ids(&state, &[id]);
    Ok(())
}

/// Ustawia flagę selekcji (1 wybrane, -1 odrzucone, 0 brak) wielu zdjęciom naraz.
#[tauri::command]
fn set_flag(state: State<'_, AppState>, ids: Vec<i64>, flag: i64) -> Result<(), String> {
    mark_photos(&state, &ids, "flag", flag.clamp(-1, 1))
}

/// Ustawia etykietę kolorową (1 do 4, 0 brak) wielu zdjęciom naraz.
#[tauri::command]
fn set_label(state: State<'_, AppState>, ids: Vec<i64>, label: i64) -> Result<(), String> {
    mark_photos(&state, &ids, "label", label.clamp(0, LABELS.len() as i64))
}

fn mark_photos(state: &AppState, ids: &[i64], column: &str, value: i64) -> Result<(), String> {
    debug_assert!(column == "flag" || column == "label");
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for id in ids {
            // Stałe zapytania (bez składania SQL z tekstu), osobno dla każdej kolumny.
            let sql = if column == "flag" { "UPDATE photos SET flag = ?2 WHERE id = ?1" } else { "UPDATE photos SET label = ?2 WHERE id = ?1" };
            tx.execute(sql, params![id, value]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    sync_ids(state, ids);
    Ok(())
}

#[tauri::command]
fn set_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE photos SET favorite = ?2 WHERE id = ?1", params![id, favorite as i64])
            .map_err(|e| e.to_string())?;
    }
    sync_ids(&state, &[id]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_formats_are_validated_and_encoded() {
        assert_eq!(export_format("jpg"), Ok("jpg"));
        assert_eq!(export_format("png"), Ok("png"));
        assert_eq!(export_format("webp"), Ok("webp"));
        assert!(export_format("exe").is_err());
        let dir = std::env::temp_dir().join("mz-export-format-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(20, 10, image::Rgba([10, 200, 30, 128])));
        for ext in ["png", "webp", "jpg"] {
            let t = dir.join(format!("a.{ext}"));
            encode_export(&img, ext, 90, &t).unwrap();
            let back = image::open(&t).unwrap();
            assert_eq!((back.width(), back.height()), (20, 10), "{ext}");
            if ext != "jpg" {
                assert!(back.color().has_alpha(), "{ext} zachowuje przezroczystość");
            }
        }
        // Nieudany zapis nie zostawia uciętego pliku.
        assert!(encode_export(&img, "png", 90, &dir.join("brak").join("x.png")).is_err());
    }

    #[test]
    fn iptc_fields_roundtrip_through_xmp_and_do_not_change_plain_files() {
        let plain = build_xmp_marks(3, false, &["morze".to_string()], None, None, 0, 0);
        assert_eq!(plain, build_xmp_iptc(3, false, &["morze".to_string()], None, None, 0, 0, &Iptc::default()), "bez pól IPTC plik jest taki jak dawniej");
        let ip = Iptc { title: Some("Zachód <słońca> & morze".into()), city: Some("Sopot".into()), country: Some("Polska".into()) };
        let xml = build_xmp_iptc(3, false, &[], Some("Jan"), None, 0, 0, &ip);
        assert!(xml.contains("xmlns:photoshop") && xml.contains("photoshop:City=\"Sopot\""));
        let dir = std::env::temp_dir().join("mz-iptc-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("a.jpg");
        fs::write(&photo, b"x").unwrap();
        fs::write(xmp_path(&photo), &xml).unwrap();
        let sc = read_sidecar(&photo).unwrap();
        assert_eq!(sc.iptc, ip);
        assert_eq!(sc.author.as_deref(), Some("Jan"));
        assert_eq!(read_sidecar(&{ fs::write(xmp_path(&photo), &plain).unwrap(); photo.clone() }).unwrap().iptc, Iptc::default());
    }

    #[test]
    fn flag_and_label_roundtrip_through_xmp_and_old_files_stay_identical() {
        let plain = build_xmp_full(3, false, &["morze".to_string()], None, None);
        assert_eq!(plain, build_xmp_marks(3, false, &["morze".to_string()], None, None, 0, 0), "bez flagi i etykiety plik jest taki jak dawniej");
        assert!(!plain.contains("pick") && !plain.contains("Label"));
        let marked = build_xmp_marks(2, true, &[], None, None, -1, 3);
        assert!(marked.contains("xmpDM:pick=\"-1\"") && marked.contains("xmp:Label=\"Green\""));
        let dir = std::env::temp_dir().join("mz-flag-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("a.jpg");
        fs::write(&photo, b"x").unwrap();
        fs::write(xmp_path(&photo), &marked).unwrap();
        let sc = read_sidecar(&photo).unwrap();
        assert_eq!((sc.flag, sc.label, sc.rating, sc.favorite), (-1, 3, 2, true));
        // Etykiety z innych programów (inna wielkość liter) są rozpoznawane, nieznane (np. Purple) są pomijane.
        assert_eq!(label_number("red"), 1);
        assert_eq!(label_number(" Blue "), 4);
        assert_eq!(label_number("Purple"), 0);
    }

    #[test]
    fn dropped_folders_and_files_are_added_and_foreign_files_ignored() {
        let dir = std::env::temp_dir().join("mz-drop-test");
        let state = test_state(&dir);
        let (folder, loose) = (dir.join("album"), dir.join("luzem"));
        fs::create_dir_all(&folder).unwrap();
        fs::create_dir_all(&loose).unwrap();
        for p in [folder.join("a.jpg"), folder.join("b.jpg"), loose.join("c.jpg")] {
            image::RgbImage::from_pixel(8, 8, image::Rgb([9, 9, 9])).save(&p).unwrap();
        }
        fs::write(loose.join("notatki.txt"), b"x").unwrap();
        let paths = vec![folder.to_string_lossy().to_string(), loose.join("c.jpg").to_string_lossy().to_string(), loose.join("notatki.txt").to_string_lossy().to_string(), dir.join("nie-ma").to_string_lossy().to_string()];
        let rep = add_dropped_blocking(&state, &paths, &|_| {}, &|_, _| {}).unwrap();
        assert_eq!((rep.folders, rep.files, rep.added), (1, 1, 3), "folder z 2 zdjęciami i jeden plik; txt i brakująca ścieżka pominięte");
        let conn = state.db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap();
        let roots: i64 = conn.query_row("SELECT COUNT(*) FROM roots", [], |r| r.get(0)).unwrap();
        assert_eq!((n, roots), (3, 1), "folder staje się obserwowany, pojedynczy plik nie");
    }

    #[test]
    fn organizing_moves_by_date_checks_first_and_undo_restores_everything() {
        let dir = std::env::temp_dir().join("mz-organize-test");
        let _ = fs::remove_dir_all(&dir);
        let lib = dir.join("Chaos");
        let dest = dir.join("Porzadek");
        fs::create_dir_all(lib.join(ORIGINALS_DIR)).unwrap();
        fs::create_dir_all(&dest).unwrap();
        let st = AppState { db: Mutex::new(open_db(&dir.join("t.db")).unwrap()), thumbs: dir.join("thumbs"), sidecar: AtomicBool::new(true) };
        let names = ["a.jpg", "b.jpg", "c.jpg"];
        for n in names {
            image::RgbImage::new(8, 8).save(lib.join(n)).unwrap();
        }
        // Towarzysze zdjęcia a.jpg: XMP, edycja nieniszcząca i kopia oryginału.
        fs::write(xmp_path(&lib.join("a.jpg")), b"<x/>").unwrap();
        fs::write(edits::sidecar_path(&lib.join("a.jpg")), b"{\"fibo_edit\":1,\"recipe\":{}}").unwrap();
        fs::write(lib.join(ORIGINALS_DIR).join("a.jpg"), b"oryginal").unwrap();
        scan_blocking(&st, lib.to_str().unwrap(), &|_| {}).unwrap();
        let id = |n: &str| -> i64 { st.db.lock().unwrap().query_row("SELECT id FROM photos WHERE name = ?1", [n], |r| r.get(0)).unwrap() };
        {
            let c = st.db.lock().unwrap();
            c.execute("UPDATE photos SET taken = '2023-07-14 10:00:00' WHERE name = 'a.jpg'", []).unwrap();
            c.execute("UPDATE photos SET taken = '2022-01-02 10:00:00' WHERE name = 'b.jpg'", []).unwrap();
            c.execute("UPDATE photos SET taken = NULL, modified = 1700000000 WHERE name = 'c.jpg'", []).unwrap();
        }
        let ids: Vec<i64> = names.iter().map(|n| id(n)).collect();
        // Podgląd niczego nie rusza.
        let plan = { let c = st.db.lock().unwrap(); organize::plan_core(&c, &ids, &dest, organize::Pattern::YearMonth).unwrap() };
        assert_eq!(plan.moves.len(), 3);
        assert_eq!(plan.file_dates, 1, "c.jpg nie ma daty wykonania");
        let mut rels: Vec<String> = plan.moves.iter().map(|m| m.rel.clone()).collect();
        rels.sort();
        assert_eq!(rels, vec!["2022/01", "2023/07", "2023/11"]);
        assert!(lib.join("a.jpg").exists() && !dest.join("2023").exists(), "plan nie zmienia dysku");
        // Zablokowany folder blokuje całość i jest wyjaśniony.
        st.db.lock().unwrap().execute("INSERT INTO locked_folders (path) VALUES (?1)", [lib.to_string_lossy().to_string()]).unwrap();
        let locked = { let c = st.db.lock().unwrap(); organize::plan_core(&c, &ids, &dest, organize::Pattern::Year).unwrap() };
        assert!(locked.moves.is_empty() && locked.skipped.len() == 3 && locked.skipped[0].1.contains("zablokowany"));
        st.db.lock().unwrap().execute("DELETE FROM locked_folders", []).unwrap();
        // Przeniesienie.
        let rep = organize::apply_core(&st, &plan, &dest).unwrap();
        assert_eq!((rep.done, rep.errors.len()), (3, 0), "{:?}", rep.errors);
        let a = dest.join("2023").join("07").join("a.jpg");
        assert!(a.exists() && !lib.join("a.jpg").exists());
        assert!(xmp_path(&a).exists() && edits::sidecar_path(&a).exists(), "XMP i edycja jadą ze zdjęciem");
        assert!(dest.join("2023").join("07").join(ORIGINALS_DIR).join("a.jpg").exists(), "kopia oryginału też");
        let path_of = |n: &str| -> String { st.db.lock().unwrap().query_row("SELECT path FROM photos WHERE name = ?1", [n], |r| r.get(0)).unwrap() };
        assert_eq!(path_of("a.jpg"), a.to_string_lossy());
        // Drugi przebieg nie ma już nic do zrobienia.
        let again = { let c = st.db.lock().unwrap(); organize::plan_core(&c, &ids, &dest, organize::Pattern::YearMonth).unwrap() };
        assert_eq!((again.moves.len(), again.in_place), (0, 3));
        // Cofnięcie przywraca wszystko, łącznie z towarzyszami, i sprząta puste foldery.
        let last = organize::last_batch(&st.db.lock().unwrap()).unwrap();
        assert_eq!((last.batch, last.count), (rep.batch, 3));
        let undo = organize::undo_core(&st, last.batch).unwrap();
        assert_eq!((undo.done, undo.errors.len()), (3, 0), "{:?}", undo.errors);
        assert!(lib.join("a.jpg").exists() && xmp_path(&lib.join("a.jpg")).exists() && edits::sidecar_path(&lib.join("a.jpg")).exists());
        assert!(lib.join(ORIGINALS_DIR).join("a.jpg").exists());
        assert!(!dest.join("2023").exists(), "puste foldery po porządkowaniu znikają");
        assert_eq!(path_of("a.jpg"), lib.join("a.jpg").to_string_lossy());
        assert!(organize::last_batch(&st.db.lock().unwrap()).is_none());
    }

    #[test]
    fn organizing_never_overwrites_and_undo_refuses_when_things_changed() {
        let dir = std::env::temp_dir().join("mz-organize-test2");
        let _ = fs::remove_dir_all(&dir);
        let (lib, dest) = (dir.join("L"), dir.join("D"));
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(dest.join("2023")).unwrap();
        fs::write(dest.join("2023").join("a.jpg"), b"cudzy plik o tej samej nazwie").unwrap();
        let st = AppState { db: Mutex::new(open_db(&dir.join("t.db")).unwrap()), thumbs: dir.join("thumbs"), sidecar: AtomicBool::new(false) };
        image::RgbImage::new(8, 8).save(lib.join("a.jpg")).unwrap();
        scan_blocking(&st, lib.to_str().unwrap(), &|_| {}).unwrap();
        let id: i64 = st.db.lock().unwrap().query_row("SELECT id FROM photos", [], |r| r.get(0)).unwrap();
        st.db.lock().unwrap().execute("UPDATE photos SET taken = '2023-05-05 10:00:00'", []).unwrap();
        let plan = { let c = st.db.lock().unwrap(); organize::plan_core(&c, &[id], &dest, organize::Pattern::Year).unwrap() };
        let rep = organize::apply_core(&st, &plan, &dest).unwrap();
        assert_eq!(rep.done, 1);
        assert_eq!(fs::read(dest.join("2023").join("a.jpg")).unwrap(), b"cudzy plik o tej samej nazwie", "cudzego pliku nie nadpisano");
        assert!(dest.join("2023").join("a_1.jpg").exists());
        // Dawne miejsce zajęte w międzyczasie: cofnięcie niczego nie nadpisuje.
        fs::write(lib.join("a.jpg"), b"nowy").unwrap();
        let undo = organize::undo_core(&st, rep.batch).unwrap();
        assert_eq!((undo.done, undo.errors.len()), (0, 1));
        assert!(undo.errors[0].contains("zajęte"));
        assert_eq!(fs::read(lib.join("a.jpg")).unwrap(), b"nowy");
        assert!(dest.join("2023").join("a_1.jpg").exists());
    }

    #[test]
    fn original_backup_is_complete_and_edits_are_atomic() {
        let dir = std::env::temp_dir().join("mz-atomic-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("a.jpg");
        fs::write(&photo, b"oryginal").unwrap();
        let backup = dir.join(ORIGINALS_DIR).join("a.jpg");
        ensure_original_backup(&photo, &backup).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), b"oryginal");
        // Edycja nie rusza kopii oryginału.
        write_atomic(&photo, b"po edycji").unwrap();
        ensure_original_backup(&photo, &backup).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), b"oryginal");
        assert_eq!(fs::read(&photo).unwrap(), b"po edycji");
        // Pusty plik kopii (ślad po dawnym błędzie) jest robiony od nowa z aktualnego zdjęcia.
        fs::write(&backup, b"").unwrap();
        ensure_original_backup(&photo, &backup).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), b"po edycji");
        // Po zapisie nie zostają pliki tymczasowe.
        assert!(fs::read_dir(&dir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".fibo-tmp")));
        assert!(write_atomic(&dir.join("brak-folderu").join("x.jpg"), b"x").is_err());
    }

    #[test]
    fn sweep_removes_only_thumbnails_of_forgotten_photos() {
        let dir = std::env::temp_dir().join("mz-sweep-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for n in ["5_100.jpg", "5_200.jpg", "50_100.jpg", "6_1.jpg"] {
            fs::write(dir.join(n), b"x").unwrap();
        }
        sweep_thumbs(&dir, &[5i64, 6].into_iter().collect());
        let mut left: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        left.sort();
        assert_eq!(left, vec!["50_100.jpg".to_string()], "numer 50 nie jest numerem 5");
    }

    #[test]
    fn duplicate_hashes() {
        use image::{Rgb, RgbImage};
        let dir = std::env::temp_dir().join("mz-dup-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // Zdjęcie A: gradient z kilkoma jasnymi i ciemnymi figurami.
        let mut a = RgbImage::new(800, 600);
        for (x, y, p) in a.enumerate_pixels_mut() {
            let v = ((x as f32 / 800.0) * 180.0 + (y as f32 / 600.0) * 40.0) as u8;
            *p = Rgb([v, 255 - v, 90]);
        }
        for y in 100..260 { for x in 120..360 { a.put_pixel(x, y, Rgb([250, 250, 250])); } }
        for y in 320..520 { for x in 420..700 { a.put_pixel(x, y, Rgb([10, 10, 10])); } }
        let pa = dir.join("a.png");
        a.save(&pa).unwrap();
        // Kopia bajt w bajt, wersja zmniejszona i zupełnie inne zdjęcie.
        let pcopy = dir.join("a_copy.png");
        fs::copy(&pa, &pcopy).unwrap();
        let small = image::imageops::resize(&a, 320, 240, FilterType::Triangle);
        let psmall = dir.join("a_small.png");
        small.save(&psmall).unwrap();
        let mut c = RgbImage::new(800, 600);
        for (x, y, p) in c.enumerate_pixels_mut() {
            let v = (((x / 40) + (y / 40)) % 2 * 200) as u8;
            *p = Rgb([v, v, 255 - v]);
        }
        for y in 0..300 { for x in 400..800 { c.put_pixel(x, y, Rgb([30, 200, 30])); } }
        let pc = dir.join("c.png");
        c.save(&pc).unwrap();

        assert_eq!(file_hash(&pa), file_hash(&pcopy), "kopia musi mieć tę samą sumę");
        assert_ne!(file_hash(&pa), file_hash(&psmall));
        let (ha, hs, hc) = (perceptual_hash(&pa).unwrap(), perceptual_hash(&psmall).unwrap(), perceptual_hash(&pc).unwrap());
        let near = (ha ^ hs).count_ones();
        let far = (ha ^ hc).count_ones();
        println!("odległość A-zmniejszone: {near}, A-inne: {far}");
        assert!(near <= 5, "zmniejszona wersja powinna być bardzo podobna");
        assert!(far > 10, "inne zdjęcie powinno być wyraźnie różne");
    }

    fn jpeg_with_metadata(path: &Path, xmp: &str, keywords: &[&str]) {
        let img = image::RgbImage::from_fn(64, 48, |x, y| image::Rgb([(x * 4) as u8, (y * 5) as u8, 90]));
        img.save(path).unwrap();
        let mut bytes = fs::read(path).unwrap();
        let segment = |marker: u8, payload: &[u8]| {
            let mut s = vec![0xFF, marker];
            s.extend(((payload.len() + 2) as u16).to_be_bytes());
            s.extend(payload);
            s
        };
        let mut app1 = b"http://ns.adobe.com/xap/1.0/\0".to_vec();
        app1.extend(xmp.as_bytes());
        let mut iptc = Vec::new();
        for kw in keywords {
            iptc.extend([0x1C, 2, 25]);
            iptc.extend((kw.len() as u16).to_be_bytes());
            iptc.extend(kw.as_bytes());
        }
        let mut app13 = b"Photoshop 3.0\0".to_vec();
        app13.extend(b"8BIM");
        app13.extend([0x04, 0x04, 0x00, 0x00]); // id 0x0404 i pusta nazwa (bajt długości + dopełnienie)
        app13.extend((iptc.len() as u32).to_be_bytes());
        app13.extend(&iptc);
        if iptc.len() % 2 == 1 {
            app13.push(0);
        }
        let mut out = bytes[..2].to_vec();
        out.extend(segment(0xE1, &app1));
        out.extend(segment(0xED, &app13));
        out.extend(&bytes[2..]);
        bytes = out;
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn metadata_embedded_and_sidecar() {
        let dir = std::env::temp_dir().join("mz-meta-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("thumbs")).unwrap();

        // Zdjęcie z innego programu: ocena i tagi w XMP oraz słowa kluczowe w IPTC.
        let p = dir.join("a.jpg");
        jpeg_with_metadata(&p, &build_xmp(4, false, &["wakacje".into(), "góry".into()]), &["rodzina", "wakacje"]);
        let found = read_embedded(&p, None).expect("metadane w pliku");
        assert_eq!(found.rating, 4);
        for t in ["wakacje", "góry", "rodzina"] {
            assert!(found.tags.contains(&t.to_string()), "brak tagu {t}: {:?}", found.tags);
        }
        assert_eq!(found.tags.len(), 3, "wakacje z XMP i IPTC nie może się zdublować");

        // Nowe zdjęcie trafia do biblioteki razem z tym, co już miało.
        let state = AppState { db: Mutex::new(open_db(&dir.join("t.db")).unwrap()), thumbs: dir.join("thumbs"), sidecar: AtomicBool::new(true) };
        flush(&state, &mut vec![build_row(&p).unwrap()]).unwrap();
        let (id, rating): (i64, i64) = state.db.lock().unwrap().query_row("SELECT id, rating FROM photos", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(rating, 4);
        let n_tags: i64 = state.db.lock().unwrap().query_row("SELECT COUNT(*) FROM photo_tags WHERE photo_id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(n_tags, 3);

        // Zapis pliku XMP i odczyt z powrotem.
        assert_eq!(write_sidecar(&state, id).unwrap(), SidecarOutcome::Written);
        assert_eq!(write_sidecar(&state, id).unwrap(), SidecarOutcome::Unchanged, "bez zmian nie przepisujemy pliku");
        let sc = read_sidecar(&p).unwrap();
        assert_eq!((sc.rating, sc.tags.len()), (4, 3));

        // Cudzy plik XMP nie jest nadpisywany.
        let p2 = dir.join("b.jpg");
        image::RgbImage::new(8, 8).save(&p2).unwrap();
        fs::write(xmp_path(&p2), "<x:xmpmeta>cudzy</x:xmpmeta>").unwrap();
        flush(&state, &mut vec![build_row(&p2).unwrap()]).unwrap();
        let id2: i64 = state.db.lock().unwrap().query_row("SELECT id FROM photos WHERE name = 'b.jpg'", [], |r| r.get(0)).unwrap();
        state.db.lock().unwrap().execute("UPDATE photos SET rating = 3 WHERE id = ?1", [id2]).unwrap();
        assert_eq!(write_sidecar(&state, id2).unwrap(), SidecarOutcome::Skipped);
        assert_eq!(fs::read_to_string(xmp_path(&p2)).unwrap(), "<x:xmpmeta>cudzy</x:xmpmeta>");

        // Brak metadanych: nasz plik XMP znika.
        {
            let conn = state.db.lock().unwrap();
            conn.execute("UPDATE photos SET rating = 0 WHERE id = ?1", [id]).unwrap();
            conn.execute("DELETE FROM photo_tags WHERE photo_id = ?1", [id]).unwrap();
        }
        assert_eq!(write_sidecar(&state, id).unwrap(), SidecarOutcome::Removed);
        assert!(!xmp_path(&p).exists());

        // Import uzupełnia, ale nie nadpisuje: zdjęcie z oceną 5 zachowuje 5.
        state.db.lock().unwrap().execute("UPDATE photos SET rating = 5 WHERE id = ?1", [id]).unwrap();
        let sc = read_metadata(&p, None).unwrap();
        apply_sidecar(&state.db.lock().unwrap(), id, &sc).unwrap();
        let rating: i64 = state.db.lock().unwrap().query_row("SELECT rating FROM photos WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(rating, 5);
    }

    fn test_state(dir: &Path) -> AppState {
        let _ = fs::remove_dir_all(dir);
        fs::create_dir_all(dir.join("thumbs")).unwrap();
        AppState { db: Mutex::new(open_db(&dir.join("t.db")).unwrap()), thumbs: dir.join("thumbs"), sidecar: AtomicBool::new(true) }
    }

    fn photo_id(state: &AppState, name: &str) -> i64 {
        state.db.lock().unwrap().query_row("SELECT id FROM photos WHERE name = ?1", [name], |r| r.get(0)).unwrap()
    }

    #[test]
    fn export_resizes_strips_metadata_and_never_overwrites() {
        let dir = std::env::temp_dir().join("mz-export-test");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        let out = dir.join("out");
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&out).unwrap();
        image::RgbImage::new(100, 50).save(lib.join("a.jpg")).unwrap();
        assert_eq!(scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap(), 1);
        let id = photo_id(&state, "a.jpg");
        let rep = export_photos_blocking(&state, &[id], &out, 40, 80, None).unwrap();
        assert_eq!((rep.done, rep.errors.len()), (1, 0));
        assert_eq!(image::image_dimensions(out.join("a.jpg")).unwrap(), (40, 20));
        // Drugi eksport nie nadpisuje pierwszego; 0 = bez zmiany rozmiaru.
        export_photos_blocking(&state, &[id], &out, 0, 90, None).unwrap();
        assert_eq!(image::image_dimensions(out.join("a_1.jpg")).unwrap(), (100, 50));
        assert!(!read_exif(&out.join("a.jpg")).keywords.iter().any(|_| true));
        assert!(export_photos_blocking(&state, &[id], &dir.join("brak"), 40, 80, None).is_err());
        assert!(export_photos_blocking(&state, &[id], &out, 99999, 80, None).is_err());
        // Znak wodny: logo trafia do prawego dolnego rogu kopii, a zły plik logo przerywa eksport przed kopiowaniem.
        image::RgbaImage::from_pixel(10, 10, image::Rgba([255, 0, 0, 255])).save(dir.join("logo.png")).unwrap();
        let wm = watermark::Watermark { path: dir.join("logo.png").to_string_lossy().to_string(), position: "br".into(), size_pct: 25, opacity: 100 };
        export_photos_blocking(&state, &[id], &out, 0, 95, Some(&wm)).unwrap();
        let marked = image::open(out.join("a_2.jpg")).unwrap().to_rgb8();
        let px = marked.get_pixel(90, 45);
        assert!(px[0] > 200 && px[1] < 80, "logo w prawym dolnym rogu: {px:?}");
        let before = fs::read_dir(&out).unwrap().count();
        let bad = watermark::Watermark { path: dir.join("brak.png").to_string_lossy().to_string(), ..wm };
        assert!(export_photos_blocking(&state, &[id], &out, 0, 95, Some(&bad)).is_err());
        assert_eq!(fs::read_dir(&out).unwrap().count(), before, "nic nie jest kopiowane przy błędnym logo");
        assert!(lib.join("a.jpg").exists());
    }

    #[test]
    fn manual_location_survives_rescan_and_is_validated() {
        let dir = std::env::temp_dir().join("mz-geo-test");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        fs::create_dir_all(&lib).unwrap();
        image::RgbImage::new(10, 10).save(lib.join("g.jpg")).unwrap();
        scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap();
        let id = photo_id(&state, "g.jpg");
        let get = || -> (Option<f64>, Option<f64>) { state.db.lock().unwrap().query_row("SELECT lat, lon FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap() };
        assert_eq!(get(), (None, None));
        assert_eq!(set_location_core(&state.db.lock().unwrap(), &[id], Some((52.2, 21.0))).unwrap(), 1);
        assert_eq!(get(), (Some(52.2), Some(21.0)));
        // Odświeżenie danych z plików (plik nie ma GPS) nie kasuje ręcznej lokalizacji.
        let row = build_row(&lib.join("g.jpg")).unwrap();
        flush(&state, &mut vec![row]).unwrap();
        assert_eq!(get(), (Some(52.2), Some(21.0)));
        for bad in [(91.0, 0.0), (0.0, 181.0), (f64::NAN, 1.0)] {
            assert!(set_location_core(&state.db.lock().unwrap(), &[id], Some(bad)).is_err());
        }
        set_location_core(&state.db.lock().unwrap(), &[id], None).unwrap();
        assert_eq!(get(), (None, None));
    }

    #[test]
    fn batch_rename_uses_template_and_reports_conflicts() {
        assert_eq!(batch_stem("Wakacje", Some("2024-07-01"), 7, 3), "2024-07-01_Wakacje_007");
        assert_eq!(batch_stem("  ", None, 12, 3), "012");
        let dir = std::env::temp_dir().join("mz-batchrename-test");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        fs::create_dir_all(&lib).unwrap();
        for n in ["a.jpg", "b.jpg", "c.jpg"] {
            image::RgbImage::new(8, 8).save(lib.join(n)).unwrap();
        }
        scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap();
        let ids: Vec<i64> = ["a.jpg", "b.jpg", "c.jpg"].iter().map(|n| photo_id(&state, n)).collect();
        // Istniejący plik o docelowej nazwie nie jest nadpisany: to jedno zdjęcie dostaje błąd, reszta jest zmieniona.
        image::RgbImage::new(8, 8).save(lib.join("Ola_002.jpg")).unwrap();
        let rep = rename_batch_core(&state, &ids, "Ola", false, 1).unwrap();
        assert_eq!((rep.done, rep.errors.len()), (2, 1), "{rep:?}");
        assert!(lib.join("Ola_001.jpg").exists() && lib.join("Ola_003.jpg").exists() && lib.join("b.jpg").exists());
        // Niebezpieczny prefiks jest odrzucony przez walidację nazw.
        let rep = rename_batch_core(&state, &ids[..1], "../x", false, 1).unwrap();
        assert_eq!(rep.done, 0);
    }

    #[test]
    fn import_sorts_by_date_skips_known_and_never_touches_source() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19723), (2024, 1, 1));
        let dir = std::env::temp_dir().join("mz-import-test");
        let _ = fs::remove_dir_all(&dir);
        let (src, dest) = (dir.join("karta"), dir.join("biblioteka"));
        fs::create_dir_all(src.join("DCIM")).unwrap();
        fs::create_dir_all(&dest).unwrap();
        image::RgbImage::new(8, 8).save(src.join("DCIM").join("a.jpg")).unwrap();
        image::RgbImage::new(9, 9).save(src.join("b.jpg")).unwrap();
        fs::write(src.join("notatki.txt"), "nie zdjecie").unwrap();
        let rep = import_blocking(&src, &dest, &|_| {}).unwrap();
        assert_eq!((rep.copied, rep.skipped, rep.errors.len()), (2, 0, 0), "{rep:?}");
        // Zdjęcia bez EXIF trafiają do folderu z datą pliku, a nie do pustej nazwy.
        let days: Vec<_> = WalkDir::new(&dest).min_depth(2).max_depth(2).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_dir()).collect();
        assert_eq!(days.len(), 1);
        assert!(days[0].file_name().to_string_lossy().len() == 10);
        // Ponowny import nic nie kopiuje; źródło zostaje nietknięte.
        let rep = import_blocking(&src, &dest, &|_| {}).unwrap();
        assert_eq!((rep.copied, rep.skipped), (0, 2));
        assert!(src.join("DCIM").join("a.jpg").exists() && src.join("b.jpg").exists() && src.join("notatki.txt").exists());
        // Folder docelowy w źródłowym i ten sam folder są odrzucane.
        assert!(import_blocking(&src, &src, &|_| {}).is_err());
        assert!(import_blocking(&src, &src.join("DCIM"), &|_| {}).is_err());
        assert!(import_blocking(&dir.join("brak"), &dest, &|_| {}).is_err());
    }

    #[test]
    fn exif_details_handles_missing_and_plain_files() {
        let dir = std::env::temp_dir().join("mz-exifd-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        image::RgbImage::new(8, 8).save(dir.join("p.jpg")).unwrap();
        assert!(exif_details(&dir.join("p.jpg")).is_empty());
        assert!(exif_details(&dir.join("brak.jpg")).is_empty());
        fs::write(dir.join("zly.jpg"), b"to nie jest jpeg").unwrap();
        assert!(exif_details(&dir.join("zly.jpg")).is_empty());
    }

    #[test]
    fn album_and_folder_properties_are_validated() {
        let dir = std::env::temp_dir().join("mz-props-test");
        let state = test_state(&dir);
        let c = state.db.lock().unwrap();
        set_props_core(&c, "album", "3", "Wakacje nad morzem", "Hel", "2024-07-01").unwrap();
        set_props_core(&c, "folder", "C:\\Zdjecia\\2024", "opis", "", "").unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM props", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        assert!(set_props_core(&c, "album", "3", "x", "", "01.07.2024").is_err());
        assert!(set_props_core(&c, "album", "3", "x", "", "2024-13-40").is_err());
        assert!(set_props_core(&c, "zly", "3", "x", "", "").is_err());
        assert!(set_props_core(&c, "album", "", "x", "", "").is_err());
        // Wszystkie pola puste usuwają wpis.
        set_props_core(&c, "album", "3", "", "", "").unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM props", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn read_audio_accepts_only_small_audio_files() {
        let dir = std::env::temp_dir().join("mz-audio-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.mp3"), b"id3").unwrap();
        fs::write(dir.join("a.exe"), b"MZ").unwrap();
        fs::create_dir_all(dir.join("folder.mp3")).unwrap();
        assert!(read_audio(dir.join("a.mp3").to_string_lossy().to_string()).is_ok());
        assert!(read_audio(dir.join("a.exe").to_string_lossy().to_string()).is_err());
        assert!(read_audio(dir.join("folder.mp3").to_string_lossy().to_string()).is_err());
        assert!(read_audio(dir.join("brak.mp3").to_string_lossy().to_string()).is_err());
    }

    #[test]
    fn smart_albums_store_validated_filters() {
        let dir = std::env::temp_dir().join("mz-smart-test");
        let state = test_state(&dir);
        let c = state.db.lock().unwrap();
        save_smart_core(&c, "  5 gwiazdek 2023  ", r#"{"minStars":5,"dateFrom":"2023-01-01"}"#).unwrap();
        save_smart_core(&c, "5 GWIAZDEK 2023", r#"{"minStars":4}"#).unwrap(); // ta sama nazwa (bez względu na wielkość liter) zastępuje filtry
        let n: i64 = c.query_row("SELECT COUNT(*) FROM smart_albums", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let f: String = c.query_row("SELECT filters FROM smart_albums", [], |r| r.get(0)).unwrap();
        assert!(f.contains("\"minStars\":4"));
        assert!(save_smart_core(&c, "", "{}").is_err());
        assert!(save_smart_core(&c, "x", "[1,2]").is_err());
        assert!(save_smart_core(&c, "x", "to nie json").is_err());
        assert!(save_smart_core(&c, "x", &format!("{{\"a\":\"{}\"}}", "z".repeat(5000))).is_err());
    }

    #[test]
    fn manual_dates_and_captions() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2024, 1, 1), 19723);
        assert_eq!(parse_ts("2024:07:01 12:30:15").map(fmt_ts).as_deref(), Some("2024-07-01 12:30:15"));
        assert_eq!(parse_ts("2024-02-30x"), parse_ts("2024-02-30"));
        assert!(parse_ts("2024-13-01").is_none() && parse_ts("zle").is_none() && parse_ts("2024-01-01 25:00:00").is_none());
        let dir = std::env::temp_dir().join("mz-date-test");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        fs::create_dir_all(&lib).unwrap();
        image::RgbImage::new(8, 8).save(lib.join("d.jpg")).unwrap();
        scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap();
        let id = photo_id(&state, "d.jpg");
        let get = || -> Option<String> { state.db.lock().unwrap().query_row("SELECT taken FROM photos WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
        let conn = state.db.lock().unwrap();
        change_dates_core(&conn, &[id], DateChange::Set(parse_ts("2023-12-31 23:30:00").unwrap())).unwrap();
        drop(conn);
        assert_eq!(get().as_deref(), Some("2023-12-31 23:30:00"));
        // Przesunięcie o 90 minut przechodzi przez północ i rok.
        change_dates_core(&state.db.lock().unwrap(), &[id], DateChange::Shift(90)).unwrap();
        assert_eq!(get().as_deref(), Some("2024-01-01 01:00:00"));
        change_dates_core(&state.db.lock().unwrap(), &[id], DateChange::Shift(-60 * 24)).unwrap();
        assert_eq!(get().as_deref(), Some("2023-12-31 01:00:00"));
        // Ponowne skanowanie zmienionego pliku nie kasuje ręcznej daty.
        let row = build_row(&lib.join("d.jpg")).unwrap();
        flush(&state, &mut vec![row]).unwrap();
        assert_eq!(get().as_deref(), Some("2023-12-31 01:00:00"));
        assert!(change_dates_core(&state.db.lock().unwrap(), &[id], DateChange::Shift(i64::MAX / 30)).is_err());
        assert!(change_dates_core(&state.db.lock().unwrap(), &[id], DateChange::Set(parse_ts("1800-01-01").unwrap_or(-9_000_000_000))).is_err());
        // Opis: przycinanie, brak znaków sterujących.
        let conn = state.db.lock().unwrap();
        conn.execute("UPDATE photos SET caption = ?2 WHERE id = ?1", params![id, "Ala"]).unwrap();
        let c: Option<String> = conn.query_row("SELECT caption FROM photos WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(c.as_deref(), Some("Ala"));
    }

    #[test]
    fn locked_folders_block_destructive_changes_but_allow_copies() {
        let dir = std::env::temp_dir().join("mz-lock-test");
        let state = test_state(&dir);
        let lib = dir.join("archiwum");
        let other = dir.join("inne");
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&other).unwrap();
        image::RgbImage::new(8, 8).save(lib.join("a.jpg")).unwrap();
        scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap();
        let id = photo_id(&state, "a.jpg");
        state.db.lock().unwrap().execute("INSERT INTO locked_folders (path) VALUES (?1)", [lib.to_string_lossy()]).unwrap();
        let fake = |p: &str| fs::remove_file(p).map_err(|e| e.to_string());
        assert!(trash_photos_core(&state, vec![id], None, &fake).is_err());
        assert!(rename_photo_core(&state, id, "nowa").is_err());
        let rep = move_photos_blocking(&state, &[id], &other, false).unwrap();
        assert_eq!((rep.done, rep.errors.len()), (0, 1));
        assert!(lib.join("a.jpg").exists());
        // Kopiowanie i eksport są dozwolone.
        let rep = move_photos_blocking(&state, &[id], &other, true).unwrap();
        assert_eq!(rep.done, 1);
        assert!(export_photos_blocking(&state, &[id], &other, 0, 80, None).is_ok());
        // Po odblokowaniu zmiany znowu działają.
        state.db.lock().unwrap().execute("DELETE FROM locked_folders", []).unwrap();
        assert_eq!(rename_photo_core(&state, id, "nowa").unwrap(), "nowa.jpg");
    }

    #[test]
    fn hiding_and_safe_deletion() {
        let dir = std::env::temp_dir().join("mz-delete-test");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        fs::create_dir_all(&lib).unwrap();
        for i in 0..25 {
            image::RgbImage::new(8, 8).save(lib.join(format!("z{i}.jpg"))).unwrap();
        }
        fs::write(lib.join("notatki.txt"), "nie zdjecie").unwrap();
        assert_eq!(scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap(), 25);
        let ids: Vec<i64> = (0..25).map(|i| photo_id(&state, &format!("z{i}.jpg"))).collect();
        let count = |sql: &str| -> i64 { state.db.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap() };
        let fake_trash = |p: &str| fs::remove_file(p).map_err(|e| e.to_string());

        // Ukrycie nie rusza plików, a skan nie dodaje ukrytych zdjęć z powrotem.
        {
            let conn = state.db.lock().unwrap();
            conn.execute("UPDATE photos SET hidden = 1 WHERE id = ?1", [ids[0]]).unwrap();
        }
        assert!(lib.join("z0.jpg").exists());
        assert_eq!(scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap(), 0);
        assert_eq!(count("SELECT COUNT(*) FROM photos WHERE hidden = 0"), 24);

        // Od 20 zdjęć potrzebne jest słowo potwierdzenia; bez niego nic nie jest usuwane.
        assert!(trash_photos_core(&state, ids[1..].to_vec(), None, &fake_trash).is_err());
        assert!(trash_photos_core(&state, ids[1..].to_vec(), Some("tak".into()), &fake_trash).is_err());
        assert!(lib.join("z1.jpg").exists());
        assert_eq!(trash_photos_core(&state, ids[1..].to_vec(), Some(TRASH_CONFIRM_WORD.into()), &fake_trash).unwrap(), 24);
        assert!(!lib.join("z1.jpg").exists() && lib.join("z0.jpg").exists() && lib.join("notatki.txt").exists());

        // Nie usuwamy niczego, co nie jest zwykłym plikiem zdjęcia, nawet jeśli ktoś wpisał to do bazy.
        state.db.lock().unwrap().execute(
            "INSERT INTO photos (path, folder, name, size, modified) VALUES (?1, ?2, 'notatki.txt', 1, 1)",
            params![lib.join("notatki.txt").to_string_lossy(), lib.to_string_lossy()],
        ).unwrap();
        let tid = photo_id(&state, "notatki.txt");
        assert!(trash_photos_core(&state, vec![tid], None, &fake_trash).is_err());
        state.db.lock().unwrap().execute(
            "INSERT INTO photos (path, folder, name, size, modified) VALUES (?1, ?2, 'folder.jpg', 1, 1)",
            params![lib.to_string_lossy(), lib.to_string_lossy()],
        ).unwrap();
        let did = photo_id(&state, "folder.jpg");
        assert!(trash_photos_core(&state, vec![did], None, &fake_trash).is_err());
        assert!(lib.exists() && lib.join("notatki.txt").exists());
    }

    #[test]
    fn rename_move_copy_and_rescan() {
        let dir = std::env::temp_dir().join("mz-files-test");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        let other = dir.join("inne");
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&other).unwrap();
        let x = lib.join("x.jpg");
        image::RgbImage::new(8, 8).save(&x).unwrap();
        fs::write(xmp_path(&x), build_xmp(3, true, &["morze".into()])).unwrap();

        // Skan dodaje zdjęcie razem z tym, co ma w pliku XMP, i zapamiętuje folder jako obserwowany.
        add_root(&state, lib.to_str().unwrap()).unwrap();
        assert_eq!(scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap(), 1);
        let id = photo_id(&state, "x.jpg");
        let (rating, fav): (i64, i64) = state.db.lock().unwrap().query_row("SELECT rating, favorite FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((rating, fav), (3, 1));
        // Ponowny skan niczego nie zmienia (plik niezmieniony, więc pominięty).
        assert_eq!(scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap(), 0);

        // Zmiana nazwy: złe nazwy odrzucone, dobra zmienia plik, XMP i wpis w bazie.
        for bad in ["", "a/b", "co:n", "CON", "kropka.", "gwiazdka*"] {
            assert!(rename_photo_core(&state, id, bad).is_err(), "powinno odrzucić {bad:?}");
        }
        assert_eq!(rename_photo_core(&state, id, "morze 2024").unwrap(), "morze 2024.jpg");
        assert!(lib.join("morze 2024.jpg").exists() && !x.exists());
        assert!(xmp_path(&lib.join("morze 2024.jpg")).exists() && !xmp_path(&x).exists(), "XMP idzie za zdjęciem");
        image::RgbImage::new(8, 8).save(lib.join("zajete.jpg")).unwrap();
        // Skan dodaje ten plik do biblioteki (później zniknie z dysku i rescan ma go usunąć).
        assert_eq!(scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap(), 1);
        assert!(rename_photo_core(&state, id, "zajete").is_err(), "nie nadpisujemy istniejącego pliku");

        // Przenoszenie: nazwa zajęta w celu dostaje _1, nic nie jest nadpisane.
        image::RgbImage::new(8, 8).save(other.join("morze 2024.jpg")).unwrap();
        let rep = move_photos_blocking(&state, &[id], &other, false).unwrap();
        assert_eq!((rep.done, rep.errors.len()), (1, 0));
        assert!(other.join("morze 2024_1.jpg").exists() && !lib.join("morze 2024.jpg").exists());
        assert!(xmp_path(&other.join("morze 2024_1.jpg")).exists());
        let folder: String = state.db.lock().unwrap().query_row("SELECT folder FROM photos WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(folder, other.to_string_lossy());

        // Kopiowanie tworzy nowe zdjęcie w bibliotece z tymi samymi tagami (z kopii pliku XMP).
        let rep = move_photos_blocking(&state, &[id], &lib, true).unwrap();
        assert_eq!(rep.done, 1);
        let n: i64 = state.db.lock().unwrap().query_row("SELECT COUNT(*) FROM photos WHERE name = 'morze 2024_1.jpg' OR name = 'morze 2024.jpg'", [], |r| r.get(0)).unwrap();
        assert!(n >= 1);
        assert!(move_photos_blocking(&state, &[id], &dir.join("nie ma"), false).is_err());

        // Rescan: nowe pliki w obserwowanym folderze są dodawane, a usunięte znikają z biblioteki.
        image::RgbImage::new(9, 9).save(lib.join("nowe.jpg")).unwrap();
        fs::remove_file(lib.join("zajete.jpg")).unwrap();
        let rep = rescan_blocking(&state).unwrap();
        assert!(rep.added >= 1, "{rep:?}");
        assert!(rep.removed >= 1, "{rep:?}");
        let names: Vec<String> = {
            let conn = state.db.lock().unwrap();
            let mut s = conn.prepare("SELECT name FROM photos").unwrap();
            s.query_map([], |r| r.get(0)).unwrap().filter_map(Result::ok).collect()
        };
        assert!(names.contains(&"nowe.jpg".to_string()) && !names.contains(&"zajete.jpg".to_string()));

        // Odłączony dysk: folder nie istnieje, więc zdjęcia z niego nie znikają z biblioteki.
        fs::remove_dir_all(&other).unwrap();
        let before: i64 = state.db.lock().unwrap().query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap();
        let _ = rescan_blocking(&state).unwrap();
        let after: i64 = state.db.lock().unwrap().query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).unwrap();
        assert_eq!(before, after, "brak folderu nie może kasować zdjęć z biblioteki");
    }

    #[test]
    fn albums_roots_and_names() {
        let dir = std::env::temp_dir().join("mz-albums-test");
        let state = test_state(&dir);
        {
            let conn = state.db.lock().unwrap();
            // Foldery nadrzędne przejmują podfoldery.
            add_root_conn(&conn, "C:\\Zdjecia\\2024").unwrap();
            add_root_conn(&conn, "C:\\Zdjecia").unwrap();
            add_root_conn(&conn, "C:\\Zdjecia\\2023").unwrap();
            let roots: Vec<String> = conn.prepare("SELECT path FROM roots").unwrap().query_map([], |r| r.get(0)).unwrap().filter_map(Result::ok).collect();
            assert_eq!(roots, vec!["C:\\Zdjecia".to_string()]);
        }
        assert_eq!(clean_album_name("  Wakacje   2024 ").unwrap(), "Wakacje 2024");
        assert!(clean_album_name("   ").is_err());
        assert!(clean_album_name(&"a".repeat(61)).is_err());
        assert!(valid_stem("zdjęcie 1").is_ok() && valid_stem("lpt1").is_err() && valid_stem("com3.txt").is_err());

        let conn = state.db.lock().unwrap();
        conn.execute("INSERT INTO albums (name) VALUES ('Wakacje')", []).unwrap();
        let dup = conn.execute("INSERT INTO albums (name) VALUES ('wakacje')", []).unwrap_err();
        assert_eq!(album_error(dup), "Album o takiej nazwie już istnieje", "nazwa albumu jest unikalna bez względu na wielkość liter");
    }

    // ---- Testy bezpieczeństwa i odporności ---------------------------------------

    /// Prosty generator pseudolosowy (xorshift), żeby testy były powtarzalne.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn bytes(&mut self, n: usize) -> Vec<u8> {
            (0..n).map(|_| self.next() as u8).collect()
        }
    }

    fn valid_jpeg_with_metadata(dir: &Path) -> Vec<u8> {
        let p = dir.join("seed.jpg");
        jpeg_with_metadata(&p, &build_xmp(3, true, &["a".into(), "b".into()]), &["x", "y"]);
        fs::read(&p).unwrap()
    }

    #[test]
    fn parsers_survive_random_and_corrupted_input() {
        let dir = std::env::temp_dir().join("mz-fuzz-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let seed = valid_jpeg_with_metadata(&dir);
        let mut rng = Rng(0x9E3779B97F4A7C15);
        let mut runs = 0;

        // 1. Czysto losowe bajty o różnych długościach.
        for n in (0..64).chain([100, 255, 256, 1000, 4096]) {
            for _ in 0..40 {
                let data = rng.bytes(n);
                let _ = jpeg_segments(&data);
                let _ = iptc_keywords(&data);
                let text = String::from_utf8_lossy(&data);
                let _ = parse_xmp_tags(&text);
                let _ = parse_xmp_rating(&text);
                runs += 1;
            }
        }
        // 2. Każde ucięcie prawidłowego JPEG-a w dowolnym miejscu.
        for cut in 0..seed.len().min(1500) {
            let _ = jpeg_segments(&seed[..cut]);
            runs += 1;
        }
        // 3. Prawidłowy plik z losowo zmienionymi bajtami (także w nagłówkach segmentów).
        for _ in 0..1500 {
            let mut d = seed.clone();
            for _ in 0..(1 + rng.next() % 6) {
                let i = (rng.next() as usize) % d.len().min(700);
                d[i] = rng.next() as u8;
            }
            for (marker, payload) in jpeg_segments(&d) {
                if marker == 0xED {
                    let _ = iptc_keywords(payload);
                }
                if marker == 0xE1 {
                    if let Some(x) = payload.strip_prefix(b"http://ns.adobe.com/xap/1.0/\0") {
                        let t = String::from_utf8_lossy(x);
                        let _ = parse_xmp_tags(&t);
                    }
                }
            }
            runs += 1;
        }
        // 4. Zniekształcony XML: niezamknięte znaczniki, ogromna liczba wpisów, śmieci wewnątrz.
        for xml in [
            "<dc:subject><rdf:li>",
            "<dc:subject><rdf:li></rdf:li>",
            "<dc:subject>",
            "</dc:subject><dc:subject><rdf:li",
            "<dc:subject><rdf:li>&amp;&lt;&#x41;&bogus;</rdf:li></dc:subject>",
            "xmp:Rating=\"99999999999999999999\"",
            "xmp:Rating=\"-7\"",
            "<xmp:Rating>abc</xmp:Rating>",
            "xmp:Rating=\"",
            "<xmp:Rating>",
        ] {
            let _ = parse_xmp_tags(xml);
            let r = parse_xmp_rating(xml);
            assert!((0..=5).contains(&r), "ocena poza zakresem: {r} dla {xml:?}");
            runs += 1;
        }
        assert!(runs > 4000, "test musi wykonać wiele przebiegów: {runs}");
    }

    #[test]
    fn iptc_with_lying_lengths_does_not_overrun() {
        // Zbiór IPTC deklaruje 4 GB, a ma kilka bajtów: parser ma przerwać, nie panikować ani alokować.
        let mut seg = b"Photoshop 3.0\0".to_vec();
        seg.extend(b"8BIM");
        seg.extend([0x04, 0x04, 0x00, 0x00]);
        seg.extend(0xFFFF_FFF0u32.to_be_bytes());
        seg.extend([0x1C, 2, 25, 0, 3, b'a', b'b', b'c']);
        assert!(iptc_keywords(&seg).is_empty());
        // Słowo kluczowe deklaruje długość większą niż dane.
        let mut seg2 = b"Photoshop 3.0\0".to_vec();
        seg2.extend(b"8BIM");
        seg2.extend([0x04, 0x04, 0x00, 0x00]);
        seg2.extend(8u32.to_be_bytes());
        seg2.extend([0x1C, 2, 25, 0xFF, 0xFF, b'x', b'y', b'z']);
        assert!(iptc_keywords(&seg2).is_empty());
    }

    #[test]
    fn hostile_tags_survive_xmp_roundtrip_as_plain_text() {
        let nasty = [
            "<script>alert(1)</script>", "a&b", "\"cudzysłów\"", "'apostrof'", "]]>", "&amp;lt;", "<!-- komentarz -->",
            "</rdf:li><rdf:li>wstrzyknięty", "</dc:subject><x:evil/>", "zażółć gęślą jaźń", "😀 emoji", "tab\there",
            "'; DROP TABLE photos; --", "\" OR 1=1 --", "%s%s%s%n", "..\\..\\Windows\\System32", "NUL", &"a".repeat(500),
        ];
        let tags: Vec<String> = nasty.iter().filter_map(|t| norm_tag(t)).collect();
        assert!(tags.len() >= nasty.len() - 1);
        let xml = build_xmp(2, false, &tags);
        // Dane nie mogą wyjść poza elementy rdf:li: żaden surowy znacznik ani komentarz od użytkownika.
        assert!(!xml.contains("<script"), "tag stał się znacznikiem XML");
        assert!(!xml.contains("<x:evil"), "wstrzyknięty znacznik XML");
        assert!(!xml.contains("<!-- komentarz"), "wstrzyknięty komentarz XML");
        assert_eq!(xml.matches("<rdf:li>").count(), tags.len(), "liczba wpisów musi się zgadzać");
        let dir = std::env::temp_dir().join("mz-hostile-tags");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("p.jpg");
        image::RgbImage::new(4, 4).save(&photo).unwrap();
        fs::write(xmp_path(&photo), &xml).unwrap();
        let back = read_sidecar(&photo).unwrap();
        assert_eq!(back.tags, tags, "tagi muszą wrócić bez zmian");
        assert_eq!(back.rating, 2);
    }

    #[test]
    fn sidecar_limits_for_huge_files_and_many_tags() {
        let dir = std::env::temp_dir().join("mz-limits-test");
        let state = test_state(&dir);
        let photo = dir.join("p.jpg");
        image::RgbImage::new(4, 4).save(&photo).unwrap();

        // 5000 tagów w pliku: bierzemy najwyżej MAX_TAGS_PER_FILE.
        let many: String = (0..5000).map(|i| format!("<rdf:li>tag{i}</rdf:li>")).collect();
        fs::write(xmp_path(&photo), format!("<x:xmpmeta><dc:subject><rdf:Bag>{many}</rdf:Bag></dc:subject></x:xmpmeta>")).unwrap();
        assert_eq!(read_sidecar(&photo).unwrap().tags.len(), MAX_TAGS_PER_FILE);

        // Plik XMP większy niż limit: ignorowany przy odczycie i nigdy nie nadpisywany.
        let huge = vec![b'x'; (MAX_XMP_BYTES as usize) + 10];
        fs::write(xmp_path(&photo), &huge).unwrap();
        assert!(read_sidecar(&photo).is_none());
        flush(&state, &mut vec![build_row(&photo).unwrap()]).unwrap();
        let id = photo_id(&state, "p.jpg");
        state.db.lock().unwrap().execute("UPDATE photos SET rating = 4 WHERE id = ?1", [id]).unwrap();
        assert_eq!(write_sidecar(&state, id).unwrap(), SidecarOutcome::Skipped);
        assert_eq!(fs::metadata(xmp_path(&photo)).unwrap().len(), huge.len() as u64, "duży plik XMP został nadpisany");
    }

    #[test]
    fn sql_like_text_is_stored_as_data_not_executed() {
        let dir = std::env::temp_dir().join("mz-sql-test");
        let state = test_state(&dir);
        let photo = dir.join("p.jpg");
        image::RgbImage::new(4, 4).save(&photo).unwrap();
        flush(&state, &mut vec![build_row(&photo).unwrap()]).unwrap();
        let id = photo_id(&state, "p.jpg");
        let evil = ["'; drop table photos; --", "\" or 1=1 --", "x'); delete from tags; --", "robert'); drop table albums;--"];
        {
            let conn = state.db.lock().unwrap();
            let sc = Sidecar { rating: 0, favorite: false, tags: evil.iter().filter_map(|t| norm_tag(t)).collect(), author: None, copyright: None, iptc: Iptc::default(), flag: 0, label: 0 };
            apply_sidecar(&conn, id, &sc).unwrap();
            for e in evil {
                let name = clean_album_name(e).unwrap();
                conn.execute("INSERT INTO albums (name) VALUES (?1)", [&name]).unwrap();
            }
        }
        let conn = state.db.lock().unwrap();
        for table in ["photos", "tags", "albums", "photo_tags", "settings", "roots"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert!(table == "settings" || table == "roots" || n >= 1, "tabela {table} została uszkodzona (wierszy: {n})");
        }
        let stored: i64 = conn.query_row("SELECT COUNT(*) FROM tags WHERE name LIKE '%drop table%'", [], |r| r.get(0)).unwrap();
        assert!(stored >= 2, "złośliwy tekst powinien być zapisany jako zwykły tag");
    }

    #[test]
    fn file_name_validation_blocks_traversal_and_spoofing() {
        let bad = [
            "", " ", "..", ".", "...", "../x", "..\\x", "a/b", "a\\b", "C:\\x", "c:x", "x:", "con", "CON", "Con.txt", "nul", "PRN", "aux.jpg",
            "com1", "COM9.dat", "lpt1", "LPT9", "com0", "LPT0", "COM¹", "lpt².txt", "conin$", "CONOUT$", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "kropka.", "x\u{0}y", "x\ny", "x\ty",
            "foto\u{202E}gpj", "a\u{200B}b", "a\u{FEFF}b", "\u{2066}x", &"d".repeat(151),
        ];
        for name in bad {
            assert!(valid_stem(name).is_err(), "powinno odrzucić {name:?}");
        }
        let good = ["zdjęcie 1", "IMG_0001", "morze 2024 (kopia)", "a.b.c", "Ünïcödé", "日本語", "x-y_z", &"d".repeat(150), "lpt10", "console", "com12", "coma"];
        for name in good {
            assert!(valid_stem(name).is_ok(), "powinno przyjąć {name:?}");
        }
    }

    #[test]
    fn move_and_rename_cannot_escape_or_overwrite() {
        let dir = std::env::temp_dir().join("mz-escape-test");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        let out = dir.join("out");
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&out).unwrap();
        let a = lib.join("a.jpg");
        image::RgbImage::new(4, 4).save(&a).unwrap();
        fs::write(out.join("a.jpg"), b"CUDZY-PLIK").unwrap();
        scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap();
        let id = photo_id(&state, "a.jpg");

        // Próby wyjścia z folderu przez nazwę.
        for evil in ["..\\poza", "../poza", "..", "\\\\serwer\\udział\\x", "C:\\Windows\\x"] {
            assert!(rename_photo_core(&state, id, evil).is_err(), "rename przyjął {evil:?}");
        }
        assert!(!dir.join("poza.jpg").exists() && !dir.join("poza").exists());

        // Przenoszenie do folderu z plikiem o tej samej nazwie: cudzy plik zostaje, nasz dostaje _1.
        let rep = move_photos_blocking(&state, &[id], &out, false).unwrap();
        assert_eq!(rep.done, 1);
        assert_eq!(fs::read(out.join("a.jpg")).unwrap(), b"CUDZY-PLIK", "cudzy plik został nadpisany");
        assert!(out.join("a_1.jpg").exists());

        // Cel, który jest plikiem albo nie istnieje: błąd, nic nie ginie.
        assert!(move_photos_blocking(&state, &[id], &out.join("a.jpg"), false).is_err());
        assert!(move_photos_blocking(&state, &[id], &dir.join("nie-ma-takiego"), true).is_err());
        assert!(out.join("a_1.jpg").exists());
    }

    #[test]
    fn broken_and_bomb_images_never_crash_scan_or_thumbnails() {
        let dir = std::env::temp_dir().join("mz-bad-images");
        let state = test_state(&dir);
        let lib = dir.join("lib");
        fs::create_dir_all(&lib).unwrap();
        // Pliki udające zdjęcia: puste, śmieci, ucięty JPEG, nagłówek PNG deklarujący ogromne wymiary (bomba dekompresyjna).
        fs::write(lib.join("pusty.jpg"), b"").unwrap();
        fs::write(lib.join("smieci.jpg"), Rng(7).bytes(5000)).unwrap();
        fs::write(lib.join("ucięty.png"), &[0x89, b'P', b'N', b'G', 13, 10, 26, 10]).unwrap();
        let mut bomb = vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        bomb.extend(100_000u32.to_be_bytes()); // szerokość
        bomb.extend(100_000u32.to_be_bytes()); // wysokość
        bomb.extend([8, 2, 0, 0, 0, 0, 0, 0, 0]);
        fs::write(lib.join("bomba.png"), &bomb).unwrap();
        let good = lib.join("dobry.jpg");
        image::RgbImage::new(16, 16).save(&good).unwrap();

        // Skan nie może paść, a dobre zdjęcie musi się dodać mimo zepsutych sąsiadów.
        scan_blocking(&state, lib.to_str().unwrap(), &|_| {}).unwrap();
        let names: Vec<String> = {
            let c = state.db.lock().unwrap();
            let mut s = c.prepare("SELECT name FROM photos").unwrap();
            s.query_map([], |r| r.get(0)).unwrap().filter_map(Result::ok).collect()
        };
        assert!(names.contains(&"dobry.jpg".to_string()));

        // Miniatury zepsutych plików kończą się błędem, a nie paniką ani wyczerpaniem pamięci.
        for bad in ["pusty.jpg", "smieci.jpg", "ucięty.png", "bomba.png"] {
            let r = make_thumb(&lib.join(bad), &dir.join("t.jpg"));
            assert!(r.is_err(), "{bad}: miniatura nie powinna się udać");
            assert!(perceptual_hash(&lib.join(bad)).is_none(), "{bad}: hash percepcyjny nie powinien powstać");
        }
        assert!(make_thumb(&good, &dir.join("ok.jpg")).is_ok());
    }

    #[test]
    fn parallel_metadata_changes_keep_database_and_sidecar_consistent() {
        use std::sync::Arc;
        let dir = std::env::temp_dir().join("mz-parallel-test");
        let state = Arc::new(test_state(&dir));
        let photo = dir.join("p.jpg");
        image::RgbImage::new(4, 4).save(&photo).unwrap();
        flush(&state, &mut vec![build_row(&photo).unwrap()]).unwrap();
        let id = photo_id(&state, "p.jpg");

        let handles: Vec<_> = (0..8)
            .map(|t| {
                let s = Arc::clone(&state);
                std::thread::spawn(move || {
                    for i in 0..40 {
                        {
                            let conn = s.db.lock().unwrap();
                            conn.execute("UPDATE photos SET rating = ?2 WHERE id = ?1", params![id, (t + i) % 6]).unwrap();
                            conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [format!("t{t}")]).unwrap();
                            conn.execute("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) SELECT ?1, id FROM tags WHERE name = ?2", params![id, format!("t{t}")]).unwrap();
                        }
                        write_sidecar(&s, id).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().expect("wątek zakończył się paniką");
        }
        write_sidecar(&state, id).unwrap();
        let sc = read_sidecar(&photo).expect("plik XMP musi być poprawny po wyścigu zapisów");
        let (rating, tags): (i64, i64) = {
            let c = state.db.lock().unwrap();
            (
                c.query_row("SELECT rating FROM photos WHERE id = ?1", [id], |r| r.get(0)).unwrap(),
                c.query_row("SELECT COUNT(*) FROM photo_tags WHERE photo_id = ?1", [id], |r| r.get(0)).unwrap(),
            )
        };
        assert_eq!((sc.rating, sc.tags.len() as i64), (rating, tags), "plik XMP i baza się rozjechały");
    }

    #[test]
    fn scan_and_thumbnail() {
        // Test na prawdziwym folderze ze zdjęciami: pomijany, gdy nie podano FOTO_DIR (np. w CI).
        let Ok(dir) = std::env::var("FOTO_DIR") else { return };
        let tmp = std::env::temp_dir().join("mz-test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("thumbs")).unwrap();
        let state = AppState { db: Mutex::new(open_db(&tmp.join("t.db")).unwrap()), thumbs: tmp.join("thumbs"), sidecar: AtomicBool::new(true) };
        let n = scan_blocking(&state, &dir, &|_| {}).unwrap();
        println!("zeskanowano {n}");
        let first: String = state.db.lock().unwrap().query_row("SELECT path FROM photos LIMIT 1", [], |r| r.get(0)).unwrap();
        make_thumb(Path::new(&first), &tmp.join("a.jpg")).unwrap();
        assert!(n > 0);
    }
    #[test]
    fn credits_roundtrip_through_xmp_and_are_escaped() {
        let xml = build_xmp_full(3, false, &["morze".to_string()], Some("Jan <Kowalski> & Syn"), Some("© 2026 Jan Kowalski"));
        assert!(xml.contains("<dc:creator>") && xml.contains("<dc:rights>"));
        assert!(!xml.contains("<Kowalski>"), "znaki specjalne są zamienione");
        assert_eq!(parse_xmp_first_li(&xml, "dc:creator").as_deref(), Some("Jan <Kowalski> & Syn"));
        assert_eq!(parse_xmp_first_li(&xml, "dc:rights").as_deref(), Some("© 2026 Jan Kowalski"));
        assert_eq!(parse_xmp_tags(&xml), vec!["morze".to_string()]);
        // Bez autora i praw plik wygląda jak dawniej.
        let plain = build_xmp(3, false, &["morze".to_string()]);
        assert!(!plain.contains("dc:creator") && !plain.contains("dc:rights"));
        assert_eq!(parse_xmp_first_li(&plain, "dc:creator"), None);
    }

}

fn main() {
    tauri::Builder::default()
        // Odtwarzanie filmów: bajty pliku tylko dla filmów z biblioteki i tylko po numerze (zob. video.rs).
        .register_uri_scheme_protocol("fibo-video", |ctx, request| video::protocol(ctx.app_handle(), request))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let thumbs = dir.join("thumbs");
            fs::create_dir_all(&thumbs)?;
            let db = open_db(&dir.join("library.db"))?;
            let _ = backfill_roots(&db);
            // Zapis metadanych do plików XMP jest domyślnie włączony.
            let sidecar = db
                .query_row("SELECT value FROM settings WHERE key = 'sidecar'", [], |r| r.get::<_, String>(0))
                .map(|v| v != "0")
                .unwrap_or(true);
            // Ustawienie GIF/PNG: domyślnie dodajemy wszystko (jak dotąd); w menu można je wyłączyć.
            let skip = db
                .query_row("SELECT value FROM settings WHERE key = 'skip-gif-png'", [], |r| r.get::<_, String>(0))
                .map(|v| v == "1")
                .unwrap_or(false);
            formats::set_skip_gif_png(skip);
            people::set_thumbs_dir(&thumbs);
            jobs::init(app.handle().clone());
            app.manage(AppState { db: Mutex::new(db), thumbs, sidecar: AtomicBool::new(sidecar) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_roots, remove_root, rescan_roots, list_albums, create_album, rename_album, set_album_hidden, put_thumbnail, set_credits, color::index_colors, get_skip_gif_png, set_skip_gif_png, detect_cards, rotate::rotate_photos, list_album_order, set_album_order, open_photo_external, delete_album, add_to_album, remove_from_album, rename_photo, move_photos, get_sidecar_enabled, set_sidecar_enabled, export_sidecars, import_sidecars, scan_folder, refresh_library, find_duplicates, trash_photos, export_photos, set_location, rename_batch, import_photos, gallery::export_gallery, gallery::export_gpx, gallery::export_gif, pdf::export_pdf, check::check_files, list_smart, save_smart, delete_smart, gallery::rename_folder, locks::list_locked, locks::set_folder_locked, set_date, shift_dates, set_caption, photo_exif, list_props, set_props, people::photo_people, people::add_manual_face, people::reassign_person_faces, backup::backup_library, photos_backup::backup_photos, backup::restore_library, hide_photos, hidden_count, restore_hidden, people::faces_status, people::set_faces_enabled, people::faces_start, people::faces_stop, people::faces_regroup, people::faces_reanalyze, people::faces_delete_all, people::list_people, people::person_photos, people::person_faces, people::set_person_cover, people::rename_person, people::merge_people, people::merge_suggestions, people::person_face_cards, people::photo_face_stats, calendar::save_calendar_pdf, people::confirm_faces, people::move_faces, people::reject_person_in_photos, people::move_person_faces, people::reject_faces, people::delete_person, people::restore_rejected_faces, people::ignore_person, list_photos, thumbnail, thumbnail_data, people::face_crop, places::fill_places, ocr::ocr_status, ocr::ocr_start, ocr::ocr_stop, ocr::ocr_search, clip::clip_suggest_tags, quality::quality_scan, add_dropped, watcher::watch_roots, set_iptc, cache::thumb_cache_info, cache::thumb_cache_clear, watermark::save_watermark_text, organize::organize_plan, organize::organize_apply, organize::organize_last, organize::organize_undo, edits::get_edit, edits::save_edit_recipe, edits::put_edit_thumbnail, edits::delete_edit, edits::list_edit_history, edits::get_edit_version, set_rating, set_flag, set_label, rawdev::develop_raw, clip::clip_status, clip::clip_start, clip::clip_stop, clip::clip_search, set_favorite, add_tag, remove_tag, delete_tag, save_edit, save_collage, read_image, read_audio, has_original, restore_original])
        .run(tauri::generate_context!())
        .expect("błąd uruchomienia aplikacji");

}
