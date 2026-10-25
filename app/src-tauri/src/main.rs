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
        CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag_id);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
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
    /// Słowa kluczowe i ocena zapisane w EXIF (np. „Tagi” i „Oceny” z Eksploratora Windows).
    keywords: Vec<String>,
    rating: i64,
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
    let mut info = ExifInfo { taken: None, camera: None, orientation: 1, lat: None, lon: None, keywords: Vec::new(), rating: 0 };
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
    /// Metadane z pliku XMP obok zdjęcia; wczytywane tylko dla zdjęć, których jeszcze nie ma w bibliotece.
    sidecar: Option<Sidecar>,
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
    // Metadane już zapisane w zdjęciu lub w pliku XMP (np. z innego programu).
    let meta = read_metadata(path, Some(&exif));
    Some(Row {
        path: path.to_string_lossy().to_string(),
        folder: path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        size: meta.len() as i64,
        modified,
        exif,
        dims: (w, h),
        sidecar: meta,
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
            "INSERT INTO photos (path, folder, name, size, modified, taken, width, height, camera, lat, lon)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(path) DO UPDATE SET size=?4, modified=?5, taken=?6, width=?7, height=?8, camera=?9,
                 lat=COALESCE(?10, lat), lon=COALESCE(?11, lon)",
            params![r.path, r.folder, r.name, r.size, r.modified, r.exif.taken, r.dims.0, r.dims.1, r.exif.camera, r.exif.lat, r.exif.lon],
        )
        .map_err(|e| e.to_string())?;
        // Nowe zdjęcie z plikiem XMP: przywracamy jego tagi, ocenę i ulubione (np. po odtworzeniu biblioteki).
        if !existed {
            if let Some(sc) = &r.sidecar {
                let id: i64 = tx.query_row("SELECT id FROM photos WHERE path = ?1", [&r.path], |x| x.get(0)).map_err(|e| e.to_string())?;
                apply_sidecar(&tx, id, sc).map_err(|e| e.to_string())?;
            }
        }
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

// ---- Metadane w plikach XMP obok zdjęć -----------------------------------
// Tagi, oceny i ulubione trafiają do pliku `<zdjęcie>.xmp` (standard XMP: dc:subject, xmp:Rating).
// Oryginalne zdjęcia nie są zmieniane. Pliki XMP innych programów (rozpoznajemy je po braku znacznika FIBO)
// zostają nietknięte.

const XMP_MARKER: &str = "x:xmptk=\"FIBO\"";

struct Sidecar {
    rating: i64,
    favorite: bool,
    tags: Vec<String>,
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
    let items: String = tags.iter().map(|t| format!("     <rdf:li>{}</rdf:li>\n", xml_escape(t))).collect();
    let subject = if tags.is_empty() {
        String::new()
    } else {
        format!("   <dc:subject>\n    <rdf:Bag>\n{items}    </rdf:Bag>\n   </dc:subject>\n")
    };
    let fav = if favorite { "True" } else { "False" };
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n\
<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" {XMP_MARKER}>\n\
 <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n\
  <rdf:Description rdf:about=\"\"\n\
    xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n\
    xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n\
    xmlns:fibo=\"https://pmesznik.github.io/fibo/ns/1.0/\"\n\
    xmp:Rating=\"{rating}\"\n\
    fibo:Favorite=\"{fav}\">\n\
{subject}  </rdf:Description>\n\
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
fn parse_xmp_tags(text: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    if let Some(start) = text.find("<dc:subject>") {
        let rest = &text[start..];
        let mut seg = &rest[..rest.find("</dc:subject>").unwrap_or(rest.len())];
        while let Some(i) = seg.find("<rdf:li") {
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

fn read_sidecar(photo: &Path) -> Option<Sidecar> {
    let bytes = fs::read(xmp_path(photo)).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(Sidecar {
        rating: parse_xmp_rating(&text),
        favorite: text.to_ascii_lowercase().contains("fibo:favorite=\"true\""),
        tags: parse_xmp_tags(&text),
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
    (rating > 0 || !tags.is_empty()).then_some(Sidecar { rating, favorite: false, tags })
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
    let (path, rating, favorite, tags) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let (path, rating, fav): (String, i64, i64) = conn
            .query_row("SELECT path, rating, favorite FROM photos WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.photo_id = ?1 ORDER BY t.name")
            .map_err(|e| e.to_string())?;
        let tags: Vec<String> = stmt.query_map([id], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        (path, rating, fav != 0, tags)
    };
    let xmp = xmp_path(Path::new(&path));
    let existing = fs::read(&xmp).ok().map(|b| String::from_utf8_lossy(&b).into_owned());
    if existing.as_deref().map(|t| !t.contains(XMP_MARKER)).unwrap_or(false) {
        return Ok(SidecarOutcome::Skipped);
    }
    if rating == 0 && !favorite && tags.is_empty() {
        return match existing {
            Some(_) => fs::remove_file(&xmp).map(|_| SidecarOutcome::Removed).map_err(|e| e.to_string()),
            None => Ok(SidecarOutcome::Unchanged),
        };
    }
    let xml = build_xmp(rating, favorite, &tags);
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
        let mut rep = SidecarReport::default();
        for (n, (id, _)) in all_photo_ids(&state)?.into_iter().enumerate() {
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
        // Własny plik XMP zdjęcia też trafia do Kosza (cudzych nie ruszamy).
        let xmp = xmp_path(Path::new(&path));
        if fs::read(&xmp).map(|b| String::from_utf8_lossy(&b).contains(XMP_MARKER)).unwrap_or(false) {
            let _ = trash::delete(&xmp);
        }
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
            // Zapis metadanych do plików XMP jest domyślnie włączony.
            let sidecar = db
                .query_row("SELECT value FROM settings WHERE key = 'sidecar'", [], |r| r.get::<_, String>(0))
                .map(|v| v != "0")
                .unwrap_or(true);
            app.manage(AppState { db: Mutex::new(db), thumbs, sidecar: AtomicBool::new(sidecar) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_sidecar_enabled, set_sidecar_enabled, export_sidecars, import_sidecars, scan_folder, refresh_library, find_duplicates, trash_photos, list_photos, thumbnail, set_rating, set_favorite, add_tag, remove_tag, delete_tag, save_edit, save_collage, read_image, has_original, restore_original])
        .run(tauri::generate_context!())
        .expect("błąd uruchomienia aplikacji");
}
