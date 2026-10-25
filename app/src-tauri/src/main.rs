#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, File},
    io::BufReader,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use image::imageops::FilterType;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

const EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"];
const THUMB_SIZE: u32 = 360;

struct AppState {
    db: Mutex<Connection>,
    thumbs: PathBuf,
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
}

fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
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
        CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag_id);",
    )?;
    // Migracja: współrzędne GPS dla mapy. Błąd "duplicate column" oznacza, że kolumny już są.
    for col in ["lat", "lon"] {
        let _ = conn.execute(&format!("ALTER TABLE photos ADD COLUMN {col} REAL"), []);
    }
    // Migracja: skróty do wyszukiwania duplikatów (suma kontrolna pliku, hash percepcyjny, wersja pliku, dla której je policzono).
    for col in ["fhash", "dhash", "hashed_mod"] {
        let _ = conn.execute(&format!("ALTER TABLE photos ADD COLUMN {col} INTEGER"), []);
    }
    Ok(conn)
}

struct ExifInfo {
    taken: Option<String>,
    camera: Option<String>,
    orientation: u32,
    lat: Option<f64>,
    lon: Option<f64>,
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
    let mut info = ExifInfo { taken: None, camera: None, orientation: 1, lat: None, lon: None };
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
    info
}

fn is_photo(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

struct Row {
    path: String,
    folder: String,
    name: String,
    size: i64,
    modified: i64,
    exif: ExifInfo,
    dims: (Option<i64>, Option<i64>),
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
    let exif = read_exif(path);
    let (mut w, mut h) = image::image_dimensions(path).map(|(w, h)| (Some(w as i64), Some(h as i64))).unwrap_or((None, None));
    // Orientacje 5-8 obracają zdjęcie o 90°, więc proporcje z nagłówka trzeba zamienić.
    if (5..=8).contains(&exif.orientation) {
        std::mem::swap(&mut w, &mut h);
    }
    Some(Row {
        path: path.to_string_lossy().to_string(),
        folder: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        size: meta.len() as i64,
        modified,
        exif,
        dims: (w, h),
    })
}

fn flush(state: &AppState, rows: &mut Vec<Row>) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for r in rows.drain(..) {
        // Ocena i ulubione zostają, gdy zdjęcie jest skanowane ponownie.
        tx.execute(
            "INSERT INTO photos (path, folder, name, size, modified, taken, width, height, camera, lat, lon)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(path) DO UPDATE SET size=?4, modified=?5, taken=?6, width=?7, height=?8, camera=?9,
                 lat=COALESCE(?10, lat), lon=COALESCE(?11, lon)",
            params![r.path, r.folder, r.name, r.size, r.modified, r.exif.taken, r.dims.0, r.dims.1, r.exif.camera, r.exif.lat, r.exif.lon],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Skanuje partiami po 50 zdjęć; blokada bazy jest trzymana tylko podczas zapisu partii.
fn scan_blocking(state: &AppState, root: &str, progress: &dyn Fn(usize)) -> Result<usize, String> {
    let mut batch = Vec::new();
    let mut count = 0;
    let walker = WalkDir::new(root).into_iter().filter_entry(|e| e.file_name() != ORIGINALS_DIR);
    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_photo(path) {
            continue;
        }
        let Some(row) = build_row(path) else { continue };
        batch.push(row);
        count += 1;
        if batch.len() >= 50 {
            flush(state, &mut batch)?;
            progress(count);
        }
    }
    flush(state, &mut batch)?;
    progress(count);
    Ok(count)
}

#[tauri::command]
async fn scan_folder(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    // Skanowanie jest blokujące, więc nie powinno zajmować wątku interfejsu.
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        scan_blocking(&app.state::<AppState>(), &path, &move |n| {
            let _ = emitter.emit("scan-progress", n);
        })
    })
        .await
        .map_err(|e| e.to_string())?
}

/// Ponownie czyta metadane wszystkich zdjęć z dysku (GPS, wymiary po obrocie). Pliki, które zniknęły, zostają bez zmian.
#[tauri::command]
async fn refresh_library(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let paths: Vec<String> = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn.prepare("SELECT path FROM photos").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            rows
        };
        let mut batch = Vec::new();
        let mut count = 0;
        for p in paths {
            if let Some(row) = build_row(Path::new(&p)) {
                batch.push(row);
                count += 1;
            }
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
                     WHERE pt.photo_id = photos.id), lat, lon
             FROM photos ORDER BY COALESCE(taken, datetime(modified,'unixepoch')) DESC",
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
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn make_thumb(src: &Path, dst: &Path) -> Result<(), String> {
    let orientation = read_exif(src).orientation;
    let img = image::open(src).map_err(|e| e.to_string())?;
    let mut thumb = img.resize(THUMB_SIZE, THUMB_SIZE, FilterType::Triangle);
    thumb = match orientation {
        2 => thumb.fliph(),
        3 => thumb.rotate180(),
        4 => thumb.flipv(),
        6 => thumb.rotate90(),
        8 => thumb.rotate270(),
        _ => thumb,
    };
    thumb.to_rgb8().save_with_format(dst, image::ImageFormat::Jpeg).map_err(|e| e.to_string())
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
        let dst2 = dst.clone();
        tauri::async_runtime::spawn_blocking(move || make_thumb(Path::new(&src), &dst2))
            .await
            .map_err(|e| e.to_string())??;
    }
    Ok(dst.to_string_lossy().to_string())
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

    let target = if header("mode") == "copy" {
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let mut n = 0;
        loop {
            let name = if n == 0 { format!("{stem}_edit.{ext}") } else { format!("{stem}_edit{n}.{ext}") };
            let candidate = dir.join(name);
            if !candidate.exists() { break candidate; }
            n += 1;
        }
    } else {
        let backup_dir = dir.join(ORIGINALS_DIR);
        let backup = backup_dir.join(path.file_name().ok_or("brak nazwy")?);
        if !backup.exists() {
            fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
            fs::copy(&path, &backup).map_err(|e| e.to_string())?;
        }
        path.clone()
    };
    fs::write(&target, bytes).map_err(|e| e.to_string())?;
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
#[tauri::command]
fn read_image(state: State<'_, AppState>, id: i64) -> Result<tauri::ipc::Response, String> {
    let (path, _, _) = photo_path(&state, id)?;
    Ok(tauri::ipc::Response::new(fs::read(path).map_err(|e| e.to_string())?))
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
    let backup = p.parent().zip(p.file_name()).map(|(d, n)| d.join(ORIGINALS_DIR).join(n)).ok_or("brak ścieżki")?;
    if !backup.exists() {
        return Err("Brak kopii oryginału".into());
    }
    fs::copy(&backup, p).map_err(|e| e.to_string())?;
    reindex(&state, p, taken, camera)
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
    let state = app.state::<AppState>();
    let mut recs: Vec<Rec> = Vec::new();
    let mut stale: Vec<bool> = Vec::new();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, path, size, modified, fhash, dhash, hashed_mod FROM photos")
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
    }
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

/// Przenosi pliki do Kosza Windows (można je stamtąd przywrócić) i usuwa je z biblioteki.
#[tauri::command]
fn trash_photos(state: State<'_, AppState>, ids: Vec<i64>) -> Result<usize, String> {
    let mut n = 0;
    for id in ids {
        let (path, _, _) = photo_path(&state, id)?;
        trash::delete(&path).map_err(|e| format!("{path}: {e}"))?;
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM photo_tags WHERE photo_id = ?1", [id]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM photos WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        n += 1;
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags)", []).map_err(|e| e.to_string())?;
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
    for id in ids {
        tx.execute("INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?1, ?2)", params![id, tag_id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(name)
}

/// Zdejmuje tag ze zdjęć; tag, którego nie używa żadne zdjęcie, znika z listy.
#[tauri::command]
fn remove_tag(state: State<'_, AppState>, ids: Vec<i64>, tag: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in ids {
        tx.execute(
            "DELETE FROM photo_tags WHERE photo_id = ?1 AND tag_id = (SELECT id FROM tags WHERE name = ?2)",
            params![id, tag],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM photo_tags)", []).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Usuwa tag ze wszystkich zdjęć naraz.
#[tauri::command]
fn delete_tag(state: State<'_, AppState>, tag: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM photo_tags WHERE tag_id = (SELECT id FROM tags WHERE name = ?1)", [&tag]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tags WHERE name = ?1", [&tag]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_rating(state: State<'_, AppState>, id: i64, rating: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE photos SET rating = ?2 WHERE id = ?1", params![id, rating.clamp(0, 5)])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE photos SET favorite = ?2 WHERE id = ?1", params![id, favorite as i64])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn scan_and_thumbnail() {
        let dir = std::env::var("FOTO_DIR").expect("FOTO_DIR");
        let tmp = std::env::temp_dir().join("mz-test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("thumbs")).unwrap();
        let state = AppState { db: Mutex::new(open_db(&tmp.join("t.db")).unwrap()), thumbs: tmp.join("thumbs") };
        let n = scan_blocking(&state, &dir, &|_| {}).unwrap();
        println!("zeskanowano {n}");
        let first: String = state.db.lock().unwrap().query_row("SELECT path FROM photos LIMIT 1", [], |r| r.get(0)).unwrap();
        make_thumb(Path::new(&first), &tmp.join("a.jpg")).unwrap();
        assert!(n > 0);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let thumbs = dir.join("thumbs");
            fs::create_dir_all(&thumbs)?;
            let db = open_db(&dir.join("library.db"))?;
            app.manage(AppState { db: Mutex::new(db), thumbs });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![scan_folder, refresh_library, find_duplicates, trash_photos, list_photos, thumbnail, set_rating, set_favorite, add_tag, remove_tag, delete_tag, save_edit, save_collage, read_image, has_original, restore_original])
        .run(tauri::generate_context!())
        .expect("błąd uruchomienia aplikacji");
}
