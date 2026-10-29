//! Osoby na zdjęciach: indeksowanie twarzy w tle, grupowanie w osoby i polecenia dla interfejsu.
//!
//! Zasady prywatności:
//! - wszystko dzieje się na tym komputerze, moduł nie używa sieci (pilnują tego testy bezpieczeństwa),
//! - funkcja jest domyślnie wyłączona i włącza ją użytkownik,
//! - wektory twarzy są w bazie zaszyfrowane kluczem konta Windows (DPAPI),
//! - imiona osób zostają tylko w bazie FIBO, nie trafiają do plików zdjęć ani XMP,
//! - jedno polecenie usuwa wszystkie dane twarzy (baza, wycinki twarzy, ustawienie).

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

use image::{imageops::FilterType, DynamicImage, RgbImage};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, State};

use crate::cluster::{self, Clusters, Decision};
use crate::faces::{align, cosine, normalize, quality as face_quality, Detection, Engine, EMB_LEN};
use crate::secure::{open_embedding, seal_embedding};
use crate::AppState;

const SETTING: &str = "faces-enabled";
const YUNET_SHA256: &str = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const SFACE_SHA256: &str = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79";
/// Najmniejsza twarz (w pikselach), jaką bierzemy pod uwagę: mniejsze dają niewiarygodne wektory.
pub(crate) const MIN_FACE_PX: f32 = 32.0;
/// Próg pewności detektora. Niższy niż dawny 0.8, bo test na prawdziwych zdjęciach pokazał dużo prawdziwych twarzy między 0.6 a 0.8;
/// słabsze twarze nie zakładają osób (zob. cluster.rs), więc nie zaśmiecają grup.
pub(crate) const MIN_SCORE: f32 = 0.7;
/// Większe zdjęcia są przed analizą zmniejszane (oszczędza pamięć i czas).
const MAX_SIDE: u32 = 2400;
/// Wersja potoku analizy: po zmianie algorytmu zdjęcia są analizowane ponownie (imiona i ręczne poprawki zostają).
const PIPELINE_VERSION: &str = "2";
/// Powyżej tej liczby twarzy do pogrupowania używamy szybszego grupowania przyrostowego zamiast hierarchicznego O(n²).
const MAX_HIERARCHICAL: usize = 15000;
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
    // Migracje: jakość twarzy (0-1) i znacznik ręcznej poprawki użytkownika (takiej twarzy automatyczne grupowanie nie rusza).
    let _ = conn.execute("ALTER TABLE faces ADD COLUMN quality REAL", []);
    let _ = conn.execute("ALTER TABLE faces ADD COLUMN manual INTEGER NOT NULL DEFAULT 0", []);
    // Migracja: twarz wybrana przez użytkownika jako okładka osoby (błąd „duplicate column” oznacza, że kolumna już jest).
    let _ = conn.execute("ALTER TABLE people ADD COLUMN cover_face INTEGER", []);
    // Migracja: twarz odrzucona przez użytkownika („to nie ta osoba” albo usunięta osoba): grupowanie nie przypisuje jej już do nikogo.
    let _ = conn.execute("ALTER TABLE faces ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0", []);
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

/// Usuwa twarze zdjęcia i ich wycinki (bez sprzątania osób), np. przed ponowną analizą.
fn clear_faces_of_photo(conn: &Connection, thumbs: &Path, photo_id: i64) {
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM faces WHERE photo_id = ?1")
        .and_then(|mut s| s.query_map([photo_id], |r| r.get(0)).map(|r| r.filter_map(Result::ok).collect()))
        .unwrap_or_default();
    for id in ids {
        let _ = fs::remove_file(crops_dir(thumbs).join(format!("{id}.jpg")));
    }
    let _ = conn.execute("DELETE FROM faces WHERE photo_id = ?1", [photo_id]);
    let _ = conn.execute("DELETE FROM face_scan WHERE photo_id = ?1", [photo_id]);
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

/// Dekoduje JPEG od razu w zmniejszeniu (dekoder pomija część pracy przy skali 1/2, 1/4, 1/8), dopóki dłuższy bok nie spadnie poniżej `MAX_SIDE`.
/// To kilka razy szybsze niż pełne dekodowanie zdjęcia 12 Mpx. Zwraca None dla formatów, których ten dekoder nie obsługuje.
fn decode_jpeg_scaled(path: &Path) -> Option<RgbImage> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if ext != "jpg" && ext != "jpeg" {
        return None;
    }
    let file = fs::File::open(path).ok()?;
    let mut dec = jpeg_decoder::Decoder::new(std::io::BufReader::new(file));
    dec.read_info().ok()?;
    let info = dec.info()?;
    let want = MAX_SIDE as u16;
    // Prosimy o skalę, przy której dłuższy bok zostaje co najmniej równy MAX_SIDE.
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
        jpeg_decoder::PixelFormat::RGB24 => RgbImage::from_raw(w, h, pixels),
        jpeg_decoder::PixelFormat::L8 => {
            let mut rgb = Vec::with_capacity(pixels.len() * 3);
            for g in pixels {
                rgb.extend_from_slice(&[g, g, g]);
            }
            RgbImage::from_raw(w, h, rgb)
        }
        _ => None,
    }
}

/// Obraz do analizy: zmniejszony i obrócony zgodnie ze znacznikiem EXIF (twarze muszą stać prosto).
pub(crate) fn load_oriented(path: &Path) -> Result<RgbImage, String> {
    let orientation = crate::read_exif(path).orientation;
    let img: DynamicImage = match decode_jpeg_scaled(path) {
        Some(rgb) => DynamicImage::ImageRgb8(rgb),
        None => image::open(path).map_err(|e| e.to_string())?,
    };
    let mut img = img;
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

/// Kwadratowy wycinek twarzy z marginesem, do pokazania w oknie Osoby.
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

/// Nowa twarz znaleziona na zdjęciu (jeszcze bez osoby).
struct NewFace {
    det: Detection,
    emb: Vec<f32>,
    quality: f32,
    crop: RgbImage,
    iw: f32,
    ih: f32,
}

/// Analiza jednego zdjęcia: wykrycie twarzy, wyrównanie, wektor z uśrednieniem po odbiciu lustrzanym i ocena jakości.
/// Zwraca None, gdy zdjęcia nie da się odczytać.
fn analyze_photo(engine: &Engine, path: &Path) -> Option<Vec<NewFace>> {
    let img = load_oriented(path).ok()?;
    let dets = engine.detect(&img, MIN_SCORE).unwrap_or_default();
    let mut out = Vec::new();
    for d in dets.into_iter().filter(|d| d.w >= MIN_FACE_PX && d.h >= MIN_FACE_PX) {
        let aligned = align(&img, &d.lm);
        let Ok(emb) = engine.embed_tta(&aligned) else { continue };
        let quality = face_quality(&d, &aligned);
        out.push(NewFace { crop: crop_face(&img, &d), iw: img.width() as f32, ih: img.height() as f32, det: d, emb, quality });
    }
    Some(out)
}

/// Zapisuje twarze jednego zdjęcia (wektor zaszyfrowany, jakość, wycinek) bez osoby: osoby przydziela potem grupowanie.
fn store_faces(conn: &Connection, thumbs: &Path, photo_id: i64, modified: i64, found: Vec<NewFace>) -> Result<usize, String> {
    // Poprzednie twarze tego zdjęcia (po zmianie pliku lub ponownej analizie) znikają razem z wycinkami.
    clear_faces_of_photo(conn, thumbs, photo_id);
    let mut n = 0;
    for f in found {
        let sealed = seal_embedding(&f.emb)?;
        conn.execute(
            "INSERT INTO faces (photo_id, person_id, x, y, w, h, score, quality, manual, emb) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
            params![photo_id, f.det.x / f.iw, f.det.y / f.ih, f.det.w / f.iw, f.det.h / f.ih, f.det.score, f.quality, sealed],
        )
        .map_err(|e| e.to_string())?;
        let face_id = conn.last_insert_rowid();
        let _ = f.crop.save_with_format(crops_dir(thumbs).join(format!("{face_id}.jpg")), image::ImageFormat::Jpeg);
        n += 1;
    }
    conn.execute("INSERT OR REPLACE INTO face_scan (photo_id, scanned_mod) VALUES (?1, ?2)", params![photo_id, modified]).map_err(|e| e.to_string())?;
    Ok(n)
}

/// Dzień (liczba dni od 1970) z tekstu daty „RRRR-MM-DD…” albo „RRRR:MM:DD…”.
fn day_of(s: &str) -> Option<i32> {
    let b = s.as_bytes();
    if b.len() < 10 || !(b[4] == b'-' || b[4] == b':') {
        return None;
    }
    let (y, m, d): (i64, i64, i64) = (s.get(0..4)?.parse().ok()?, s.get(5..7)?.parse().ok()?, s.get(8..10)?.parse().ok()?);
    if !(1900..=2200).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(crate::days_from_civil(y, m, d) as i32)
}

/// Dzień zrobienia każdego zdjęcia (data z EXIF albo data pliku). Przy braku danych pusta mapa: grupowanie działa wtedy bez czasu.
fn photo_days(conn: &Connection) -> HashMap<i64, i32> {
    let Ok(mut stmt) = conn.prepare("SELECT id, COALESCE(taken, datetime(modified, 'unixepoch')) FROM photos") else { return HashMap::new() };
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)));
    match rows {
        Ok(rows) => rows.filter_map(Result::ok).filter_map(|(id, t)| t.and_then(|t| day_of(&t)).map(|d| (id, d))).collect(),
        Err(_) => HashMap::new(),
    }
}

/// Twarz osoby „zakotwiczonej”: takiej, której grupowanie nie może rozbić ani zmienić (osoba z imieniem, pominięta albo z ręcznie poprawioną twarzą).
struct AnchorFace {
    person: i64,
    face: i64,
    photo: i64,
    emb: Vec<f32>,
    quality: f32,
}

fn load_anchor_faces(conn: &Connection) -> Result<Vec<AnchorFace>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT f.person_id, f.id, f.photo_id, f.emb, COALESCE(f.quality, 0.6) FROM faces f JOIN people p ON p.id = f.person_id
             WHERE p.name IS NOT NULL OR p.ignored = 1 OR p.id IN (SELECT person_id FROM faces WHERE manual = 1 AND person_id IS NOT NULL)",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, i64, i64, Vec<u8>, f32)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, f64>(4)? as f32)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows.into_iter().filter_map(|(person, face, photo, blob, quality)| open_embedding(&blob).ok().map(|emb| AnchorFace { person, face, photo, emb, quality })).collect())
}

/// Grupuje wszystkie twarze w osoby od nowa (wynik nie zależy od kolejności zdjęć):
/// 1. osoby zakotwiczone (z imieniem, pominięte, z ręczną poprawką) zostają, a nowe twarze mogą do nich dołączyć, jeśli pasują wyraźnie,
/// 2. pozostałe twarze grupuje hierarchicznie (dwie twarze z jednego zdjęcia nigdy nie trafiają do jednej osoby),
/// 3. twarze zbyt słabe, żeby zdecydować, zostają bez grupy.
/// `snapshot` to twarze osób zakotwiczonych sprzed analizy (potrzebne, gdy ponowna analiza usunęła ich wiersze), a `reanalyzed` to zdjęcia
/// przeanalizowane w tym przebiegu (stare twarze z tych zdjęć nie blokują nowych).
fn regroup(conn: &Connection, snapshot: Option<Vec<AnchorFace>>, reanalyzed: &HashSet<i64>) -> Result<usize, String> {
    let anchor_faces = match snapshot {
        Some(v) => v,
        None => load_anchor_faces(conn)?,
    };
    let anchor_people: HashSet<i64> = anchor_faces.iter().map(|a| a.person).collect();
    let days = photo_days(conn);
    let mut anchors = Clusters::new();
    for a in &anchor_faces {
        // Stara twarz ze zdjęcia, które właśnie przeanalizowano, nie może blokować nowej twarzy tej samej osoby z tego zdjęcia.
        let photo = if reanalyzed.contains(&a.photo) { -a.face - 1 } else { a.photo };
        anchors.add_at(a.person, &a.emb, a.quality, photo, days.get(&a.photo).copied());
    }

    struct Loose { id: i64, photo: i64, old: Option<i64>, emb: Vec<f32>, quality: f32, when: Option<i32> }
    let mut loose: Vec<Loose> = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, photo_id, person_id, emb, COALESCE(quality, 0.6) FROM faces WHERE rejected = 0").map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64, Option<i64>, Vec<u8>, f64)> =
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        for (id, photo, old, blob, q) in rows {
            if old.map(|p| anchor_people.contains(&p)).unwrap_or(false) {
                continue; // twarze osób zakotwiczonych zostają, gdzie są
            }
            if let Ok(emb) = open_embedding(&blob) {
                loose.push(Loose { id, photo, old, emb, quality: q as f32, when: days.get(&photo).copied() });
            }
        }
    }
    // Najlepsze twarze pierwsze: to one najpewniej dołączają do osób zakotwiczonych.
    loose.sort_by(|a, b| b.quality.total_cmp(&a.quality));

    let mut assign: HashMap<i64, Option<i64>> = HashMap::new(); // twarz -> osoba (istniejąca zakotwiczona) albo None
    // Dołączanie do osób zakotwiczonych w kilku przebiegach: twarz, która nie pasowała do wzorców osoby, może pasować do ujęć, które osoba
    // „nauczyła się” chwilę później (np. dziecko rok starsze). Dzięki temu osoba idzie za zmieniającą się twarzą rok po roku.
    let mut pool: Vec<usize> = (0..loose.len()).collect();
    if anchors.people_count() > 0 {
        for _ in 0..6 {
            let mut rest: Vec<usize> = Vec::new();
            let mut joined = 0;
            for &i in &pool {
                let f = &loose[i];
                if let Decision::Join { id, learn } = anchors.decide_at(&f.emb, f.quality, f.photo, f.when) {
                    anchors.apply_at(id, &f.emb, f.quality, learn, f.photo, f.when);
                    assign.insert(f.id, Some(id));
                    joined += 1;
                } else {
                    rest.push(i);
                }
            }
            pool = rest;
            if joined == 0 {
                break;
            }
        }
    }

    // Pozostałe twarze: grupowanie hierarchiczne (albo przyrostowe przy bardzo dużej liczbie twarzy).
    let embs: Vec<&[f32]> = pool.iter().map(|&i| loose[i].emb.as_slice()).collect();
    let qual: Vec<f32> = pool.iter().map(|&i| loose[i].quality).collect();
    let photos: Vec<i64> = pool.iter().map(|&i| loose[i].photo).collect();
    let groups: Vec<Option<usize>> = if pool.len() <= MAX_HIERARCHICAL {
        cluster::cluster_all(&embs, &qual, &photos, cluster::LINKAGE)
    } else {
        let mut cl = Clusters::new();
        let mut next = 0i64;
        let mut out = Vec::with_capacity(pool.len());
        for k in 0..pool.len() {
            let when = loose[pool[k]].when;
            out.push(match cl.decide_at(embs[k], qual[k], photos[k], when) {
                Decision::Join { id, learn } => { cl.apply_at(id, embs[k], qual[k], learn, photos[k], when); Some(id as usize) }
                Decision::New => { next += 1; cl.apply_at(next, embs[k], qual[k], true, photos[k], when); Some(next as usize) }
                Decision::Unassigned => None,
            });
        }
        out
    };

    // Numery grup -> numery osób: używamy ponownie dawnej osoby, jeśli większość twarzy grupy już do niej należała.
    let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
    for (k, g) in groups.iter().enumerate() {
        if let Some(g) = g {
            members.entry(*g).or_default().push(pool[k]);
        }
    }
    let mut order: Vec<usize> = members.keys().copied().collect();
    order.sort_by_key(|g| std::cmp::Reverse(members[g].len()));
    let mut taken: HashSet<i64> = HashSet::new();
    let mut person_of_group: HashMap<usize, i64> = HashMap::new();
    for g in &order {
        let mut votes: HashMap<i64, usize> = HashMap::new();
        for &i in &members[g] {
            if let Some(o) = loose[i].old {
                *votes.entry(o).or_default() += 1;
            }
        }
        let best = votes.into_iter().filter(|(o, _)| !taken.contains(o) && !anchor_people.contains(o)).max_by_key(|(_, c)| *c);
        if let Some((o, c)) = best {
            if c * 2 >= members[g].len() {
                taken.insert(o);
                person_of_group.insert(*g, o);
            }
        }
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for g in &order {
        if !person_of_group.contains_key(g) {
            tx.execute("INSERT INTO people (name) VALUES (NULL)", []).map_err(|e| e.to_string())?;
            person_of_group.insert(*g, tx.last_insert_rowid());
        }
    }
    let mut final_person: HashMap<i64, Option<i64>> = assign;
    for (k, g) in groups.iter().enumerate() {
        final_person.insert(loose[pool[k]].id, g.map(|g| person_of_group[&g]));
    }
    for f in &loose {
        let new = final_person.get(&f.id).copied().flatten();
        if new != f.old {
            tx.execute("UPDATE faces SET person_id = ?2 WHERE id = ?1", params![f.id, new]).map_err(|e| e.to_string())?;
        }
    }
    // Osoby bez twarzy znikają, o ile nie mają imienia i nie zostały pominięte przez użytkownika.
    tx.execute("DELETE FROM people WHERE name IS NULL AND ignored = 0 AND id NOT IN (SELECT person_id FROM faces WHERE person_id IS NOT NULL)", []).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(order.len())
}

#[derive(Serialize, Clone, Default)]
pub struct Progress {
    done: usize,
    total: usize,
    faces: usize,
    finished: bool,
    /// Trwa grupowanie twarzy w osoby (po analizie zdjęć).
    grouping: bool,
    error: Option<String>,
}

/// Liczba wątków analizy: zostawiamy rdzenie dla reszty programu, ale nie więcej niż 8 (pamięć).
fn worker_count() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).saturating_sub(2).clamp(1, 8)
}

/// Analizuje zdjęcia, które jeszcze nie były analizowane (lub zmieniły się od ostatniego razu), równolegle na kilku wątkach,
/// a na końcu grupuje wszystkie twarze w osoby. Można przerwać w każdej chwili: już policzone zdjęcia zostają, następne uruchomienie kontynuuje.
fn index_blocking(app: &tauri::AppHandle) -> Result<Progress, String> {
    let state = app.state::<AppState>();
    let engine = load_engine(app)?;
    let (todo, snapshot): (Vec<(i64, String, i64)>, Vec<AnchorFace>) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        // Po zmianie wersji potoku wszystkie zdjęcia są analizowane ponownie; imiona i ręczne poprawki zostają dzięki zapisanym osobom zakotwiczonym.
        let version: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = 'faces-version'", [], |r| r.get(0)).ok();
        if version.as_deref() != Some(PIPELINE_VERSION) {
            conn.execute("UPDATE face_scan SET scanned_mod = -1", []).map_err(|e| e.to_string())?;
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('faces-version', ?1)", [PIPELINE_VERSION]).map_err(|e| e.to_string())?;
        }
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.path, p.modified FROM photos p LEFT JOIN face_scan f ON f.photo_id = p.id
                 WHERE p.hidden = 0 AND (f.photo_id IS NULL OR f.scanned_mod != p.modified) ORDER BY p.id",
            )
            .map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        drop(stmt);
        (v, load_anchor_faces(&conn)?)
    };
    fs::create_dir_all(crops_dir(&state.thumbs)).map_err(|e| e.to_string())?;
    let total = todo.len();
    let mut prog = Progress { total, ..Default::default() };
    let mut reanalyzed: HashSet<i64> = HashSet::new();
    let next = AtomicUsize::new(0);
    let (tx, rx) = std::sync::mpsc::channel::<(usize, Option<Vec<NewFace>>)>();
    std::thread::scope(|scope| {
        for _ in 0..worker_count().min(total.max(1)) {
            let (tx, engine, todo, next) = (tx.clone(), &engine, &todo, &next);
            scope.spawn(move || loop {
                if CANCEL.load(Ordering::SeqCst) {
                    break;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= todo.len() {
                    break;
                }
                // Błąd odczytu jednego zdjęcia nie zatrzymuje reszty.
                let found = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| analyze_photo(engine, Path::new(&todo[i].1)))).unwrap_or(None);
                if tx.send((i, found)).is_err() {
                    break;
                }
            });
        }
        drop(tx);
        for (i, found) in rx.iter() {
            let (id, _, modified) = &todo[i];
            let Ok(conn) = state.db.lock() else { continue };
            let still_there: bool = conn.query_row("SELECT 1 FROM photos WHERE id = ?1 AND hidden = 0", [id], |_| Ok(())).is_ok();
            if still_there {
                // Zdjęć, których nie da się odczytać, nie analizujemy w kółko: zapisujemy je jako sprawdzone.
                if let Ok(n) = store_faces(&conn, &state.thumbs, *id, *modified, found.unwrap_or_default()) {
                    prog.faces += n;
                }
                reanalyzed.insert(*id);
            }
            drop(conn);
            prog.done += 1;
            if prog.done % 5 == 0 || prog.done == total {
                let _ = app.emit("faces-progress", prog.clone());
            }
        }
    });
    // Grupowanie: także po przerwaniu analizy, żeby osoby odpowiadały temu, co już policzono.
    prog.grouping = true;
    let _ = app.emit("faces-progress", prog.clone());
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        regroup(&conn, Some(snapshot), &reanalyzed)?;
    }
    prog.grouping = false;
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
    /// Twarze bez przypisanej osoby (zbyt niepewne, żeby je pogrupować).
    unassigned: i64,
    /// Twarze odrzucone przez użytkownika (nie trafiają do żadnej osoby).
    rejected: i64,
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
        unassigned: n("SELECT COUNT(*) FROM faces WHERE person_id IS NULL AND rejected = 0"),
        rejected: n("SELECT COUNT(*) FROM faces WHERE rejected = 1"),
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

/// Grupuje twarze w osoby od nowa, bez ponownej analizy zdjęć (szybko). Imiona i ręczne poprawki zostają.
#[tauri::command]
pub fn faces_regroup(app: tauri::AppHandle) -> Result<bool, String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app.emit("faces-progress", Progress { grouping: true, ..Default::default() });
        let state = app.state::<AppState>();
        let result = state.db.lock().map_err(|e| e.to_string()).and_then(|conn| regroup(&conn, None, &HashSet::new()));
        BUSY.store(false, Ordering::SeqCst);
        let fin = match result {
            Ok(_) => Progress { finished: true, ..Default::default() },
            Err(e) => Progress { finished: true, error: Some(e), ..Default::default() },
        };
        let _ = app.emit("faces-progress", fin);
    });
    Ok(true)
}

/// Analizuje wszystkie zdjęcia od nowa (dokładniej, np. po aktualizacji programu). Imiona i ręczne poprawki zostają.
#[tauri::command]
pub fn faces_reanalyze(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    if BUSY.load(Ordering::SeqCst) {
        return Ok(false);
    }
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE face_scan SET scanned_mod = -1", []).map_err(|e| e.to_string())?;
    }
    faces_start(app, state)
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
        .prepare("SELECT f.id FROM faces f JOIN photos p ON p.id = f.photo_id AND p.hidden = 0 WHERE f.person_id = ?1 ORDER BY f.score * f.w DESC LIMIT 400")
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
    let n = conn.execute("UPDATE faces SET person_id = ?3, manual = 1 WHERE photo_id = ?1 AND person_id = ?2", params![photo_id, from, target]).map_err(|e| e.to_string())?;
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
/// Imię po połączeniu: `name`, jeśli je podano (np. wybór użytkownika, gdy obie osoby miały różne imiona); w przeciwnym razie imię `into`,
/// a gdy go nie ma, imię `from`.
#[tauri::command]
pub fn merge_people(state: State<'_, AppState>, from: i64, into: i64, name: Option<String>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    merge_core(&conn, from, into, name.as_deref())
}

pub fn merge_core(conn: &Connection, from: i64, into: i64, name: Option<&str>) -> Result<(), String> {
    if from == into {
        return Ok(());
    }
    for id in [from, into] {
        if conn.query_row("SELECT 1 FROM people WHERE id = ?1", [id], |_| Ok(())).is_err() {
            return Err("Nie ma takiej osoby".into());
        }
    }
    conn.execute("UPDATE faces SET person_id = ?1, manual = 1 WHERE person_id = ?2", params![into, from]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE people SET name = COALESCE(name, (SELECT name FROM people WHERE id = ?2)) WHERE id = ?1", params![into, from]).map_err(|e| e.to_string())?;
    // Osoba pominięta, połączona z widoczną, ma być widoczna.
    conn.execute("UPDATE people SET ignored = MIN(ignored, COALESCE((SELECT ignored FROM people WHERE id = ?2), 0)) WHERE id = ?1", params![into, from]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM people WHERE id = ?1", [from]).map_err(|e| e.to_string())?;
    if let Some(n) = name {
        let n: String = n.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(80).collect();
        if !n.is_empty() {
            conn.execute("UPDATE people SET name = ?1 WHERE id = ?2", params![n, into]).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ---- Podpowiedzi łączenia osób

/// Podobieństwo środków grup, od którego znana osoba jest podpowiadana nieznanej (próg tożsamości SFace dla pojedynczych par to ok. 0.36).
const SUGGEST_MIN: f32 = 0.42;

/// Osoba do porównań: środek jej twarzy (wektor jednostkowy) i zdjęcia, na których występuje.
pub(crate) struct Cent {
    pub id: i64,
    pub named: bool,
    pub ignored: bool,
    pub c: Vec<f32>,
    pub photos: HashSet<i64>,
}

#[derive(Serialize, Debug)]
pub struct MergeSuggestion {
    id: i64,
    other: i64,
    /// Podobieństwo środków twarzy obu osób (0-1).
    score: f32,
    /// Obie osoby występują razem na jednym zdjęciu, więc to raczej dwie różne osoby.
    conflict: bool,
}

/// `target` = Some(id): wszystkie inne osoby od najbardziej podobnej (do ręcznego wyboru w oknie łączenia).
/// `target` = None: dla każdej osoby bez imienia najlepiej pasująca znana osoba, o ile podobieństwo jest wyraźne i osoby nie występują razem na zdjęciu.
pub(crate) fn suggest_core(cents: &[Cent], target: Option<i64>) -> Vec<MergeSuggestion> {
    let pair = |a: &Cent, b: &Cent| MergeSuggestion { id: a.id, other: b.id, score: cosine(&a.c, &b.c), conflict: !a.photos.is_disjoint(&b.photos) };
    let mut out: Vec<MergeSuggestion> = Vec::new();
    match target {
        Some(t) => {
            if let Some(a) = cents.iter().find(|c| c.id == t) {
                out.extend(cents.iter().filter(|b| b.id != t).map(|b| pair(a, b)));
            }
            out.sort_by(|x, y| y.score.total_cmp(&x.score));
            out.truncate(60);
        }
        None => {
            for a in cents.iter().filter(|c| !c.named && !c.ignored) {
                let best = cents
                    .iter()
                    .filter(|b| b.named && !b.ignored && b.id != a.id)
                    .map(|b| pair(a, b))
                    .filter(|s| !s.conflict && s.score >= SUGGEST_MIN)
                    .max_by(|x, y| x.score.total_cmp(&y.score));
                out.extend(best);
            }
            out.sort_by(|x, y| y.score.total_cmp(&x.score));
        }
    }
    out
}

/// Środki osób liczone z najlepszych (najostrzejszych) twarzy każdej osoby, najwyżej 24 na osobę.
fn load_cents(conn: &Connection) -> Result<Vec<Cent>, String> {
    let mut by: HashMap<i64, Cent> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT p.id, p.name IS NOT NULL, p.ignored FROM people p WHERE EXISTS (SELECT 1 FROM faces f JOIN photos ph ON ph.id = f.photo_id AND ph.hidden = 0 WHERE f.person_id = p.id)")
            .map_err(|e| e.to_string())?;
        for r in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)? != 0, r.get::<_, i64>(2)? != 0))).map_err(|e| e.to_string())?.filter_map(Result::ok) {
            by.insert(r.0, Cent { id: r.0, named: r.1, ignored: r.2, c: vec![0.0; EMB_LEN], photos: HashSet::new() });
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT f.person_id, f.photo_id FROM faces f JOIN photos ph ON ph.id = f.photo_id AND ph.hidden = 0 WHERE f.person_id IS NOT NULL")
            .map_err(|e| e.to_string())?;
        for (pid, photo) in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok) {
            if let Some(c) = by.get_mut(&pid) {
                c.photos.insert(photo);
            }
        }
    }
    {
        let mut stmt = conn
            .prepare(
                "SELECT person_id, emb, q FROM (
                    SELECT f.person_id AS person_id, f.emb AS emb, COALESCE(f.quality, 0.6) AS q,
                           ROW_NUMBER() OVER (PARTITION BY f.person_id ORDER BY COALESCE(f.quality, 0.6) DESC) AS rn
                    FROM faces f JOIN photos ph ON ph.id = f.photo_id AND ph.hidden = 0 WHERE f.person_id IS NOT NULL
                 ) WHERE rn <= 24",
            )
            .map_err(|e| e.to_string())?;
        for (pid, blob, q) in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?, r.get::<_, f64>(2)? as f32))).map_err(|e| e.to_string())?.filter_map(Result::ok) {
            if let (Some(c), Ok(emb)) = (by.get_mut(&pid), open_embedding(&blob)) {
                if emb.len() == EMB_LEN {
                    for (a, b) in c.c.iter_mut().zip(&emb) {
                        *a += b * q;
                    }
                }
            }
        }
    }
    let mut v: Vec<Cent> = by.into_values().collect();
    for c in &mut v {
        normalize(&mut c.c);
    }
    Ok(v)
}

/// Podpowiedzi łączenia osób (zob. `suggest_core`). Liczone lokalnie z zaszyfrowanych wektorów twarzy.
#[tauri::command]
pub async fn merge_suggestions(app: tauri::AppHandle, id: Option<i64>) -> Result<Vec<MergeSuggestion>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cents = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            load_cents(&conn)?
        };
        Ok(suggest_core(&cents, id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Przenosi wskazane twarze do innej osoby (`to`) albo do nowej osoby (`to` = None). To poprawka ręczna: grupowanie jej nie cofa.
/// Dwie twarze z jednego zdjęcia nigdy nie mogą należeć do jednej osoby.
pub fn move_faces_core(conn: &Connection, ids: &[i64], to: Option<i64>) -> Result<i64, String> {
    if ids.is_empty() {
        return Err("Nie wskazano twarzy".into());
    }
    let mut photos: HashSet<i64> = HashSet::new();
    for id in ids {
        let photo: i64 = conn.query_row("SELECT photo_id FROM faces WHERE id = ?1", [id], |r| r.get(0)).map_err(|_| "Nie ma takiej twarzy".to_string())?;
        if !photos.insert(photo) {
            return Err("Dwie z wybranych twarzy są z tego samego zdjęcia, więc nie mogą być jedną osobą".into());
        }
    }
    let target = match to {
        Some(t) => {
            if conn.query_row("SELECT 1 FROM people WHERE id = ?1", [t], |_| Ok(())).is_err() {
                return Err("Nie ma takiej osoby".into());
            }
            let mut clash = 0;
            for photo in &photos {
                let n: i64 = conn
                    .query_row("SELECT COUNT(*) FROM faces WHERE photo_id = ?1 AND person_id = ?2 AND id NOT IN (SELECT value FROM json_each(?3))", params![photo, t, serde_json::to_string(ids).unwrap_or_default()], |r| r.get(0))
                    .map_err(|e| e.to_string())?;
                clash += n;
            }
            if clash > 0 {
                return Err(format!("Ta osoba ma już inną twarz na {} z tych zdjęć, więc to raczej nie ona", clash));
            }
            t
        }
        None => {
            conn.execute("INSERT INTO people (name) VALUES (NULL)", []).map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    for id in ids {
        conn.execute("UPDATE faces SET person_id = ?2, manual = 1, rejected = 0 WHERE id = ?1", params![id, target]).map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM people WHERE id NOT IN (SELECT person_id FROM faces WHERE person_id IS NOT NULL)", []).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Odrzuca twarze: nie należą do nikogo i grupowanie nie przypisze ich ponownie (np. zły wykrywacz, przechodzień, pomyłka).
pub fn reject_faces_core(conn: &Connection, ids: &[i64]) -> Result<usize, String> {
    let mut n = 0;
    for id in ids {
        n += conn.execute("UPDATE faces SET person_id = NULL, rejected = 1, manual = 0 WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM people WHERE id NOT IN (SELECT person_id FROM faces WHERE person_id IS NOT NULL)", []).map_err(|e| e.to_string())?;
    Ok(n)
}

/// Usuwa osobę (całą grupę): jej twarze są odrzucane, więc nie wrócą do żadnej osoby. Zdjęcia zostają nietknięte.
pub fn delete_person_core(conn: &Connection, id: i64) -> Result<usize, String> {
    let n = conn.execute("UPDATE faces SET person_id = NULL, rejected = 1, manual = 0 WHERE person_id = ?1", [id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM people WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(n)
}

#[tauri::command]
pub fn move_faces(state: State<'_, AppState>, ids: Vec<i64>, to: Option<i64>) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    move_faces_core(&conn, &ids, to)
}

#[tauri::command]
pub fn reject_faces(state: State<'_, AppState>, ids: Vec<i64>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    reject_faces_core(&conn, &ids)
}

#[tauri::command]
pub fn delete_person(state: State<'_, AppState>, id: i64) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_person_core(&conn, id)
}

/// Cofa odrzucenie wszystkich twarzy (wrócą do grupowania przy najbliższym „Pogrupuj od nowa”).
#[tauri::command]
pub fn restore_rejected_faces(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE faces SET rejected = 0 WHERE rejected = 1", []).map_err(|e| e.to_string())
}

/// Ukrywa osobę na liście Osoby (np. przypadkowy przechodzień). Jej twarze zostają, żeby kolejne zdjęcia nie tworzyły jej od nowa.
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

    /// Pomiar na prawdziwych zdjęciach (uruchamiany ręcznie): FIBO_BENCH_DIR=folder FIBO_BENCH_N=liczba cargo test --release bench_faces -- --ignored --nocapture
    /// Porównuje warianty detekcji (rozmiar wejścia i próg). Wypisuje tylko liczby, nic nie zapisuje.
    /// Miara „podejrzane”: twarz, której wektor po odbiciu lustrzanym jest mało podobny do oryginału (cos < 0.6), to prawdopodobnie fałszywe wykrycie.
    #[test]
    #[ignore]
    fn bench_faces() {
        use crate::faces::{align, Detection, Engine};
        use std::time::Instant;
        let Ok(dir) = std::env::var("FIBO_BENCH_DIR") else { return };
        let n: usize = std::env::var("FIBO_BENCH_N").ok().and_then(|v| v.parse().ok()).unwrap_or(100);
        let mut files: Vec<PathBuf> = walkdir::WalkDir::new(&dir).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file() && crate::is_photo(e.path())).map(|e| e.into_path()).collect();
        files.sort();
        let step = (files.len() / n.max(1)).max(1);
        let files: Vec<PathBuf> = files.into_iter().step_by(step).take(n).collect();
        let mdir = Path::new(env!("CARGO_MANIFEST_DIR")).join("models");
        let (y, sf) = (fs::read(mdir.join("yunet.onnx")).unwrap(), fs::read(mdir.join("sface.onnx")).unwrap());
        // (podpis, rozmiar wejścia, próg)
        let variants: [(&str, usize, f32); 5] = [("640 / 0.8 (dotychczasowy)", 640, 0.8), ("960 / 0.8", 960, 0.8), ("1280 / 0.8", 1280, 0.8), ("1280 / 0.7", 1280, 0.7), ("1280 / 0.6", 1280, 0.6)];
        let engines: Vec<Engine> = variants.iter().map(|v| Engine::with_base(&y, &sf, v.1).unwrap()).collect();
        let iou = |a: &Detection, b: &Detection| -> f32 {
            let (x1, y1) = (a.x.max(b.x), a.y.max(b.y));
            let (x2, y2) = ((a.x + a.w).min(b.x + b.w), (a.y + a.h).min(b.y + b.h));
            let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
            inter / (a.w * a.h + b.w * b.h - inter).max(1.0)
        };
        let mut times: Vec<Vec<f64>> = vec![Vec::new(); variants.len()];
        let mut total = vec![0usize; variants.len()];
        let mut extra = vec![0usize; variants.len()];
        let mut suspect = vec![0usize; variants.len()];
        let mut extra_flip: Vec<Vec<f64>> = vec![Vec::new(); variants.len()];
        let mut t_dec = Vec::new();
        for f in &files {
            let t = Instant::now();
            let Ok(img) = load_oriented(f) else { continue };
            t_dec.push(t.elapsed().as_secs_f64() * 1000.0);
            let mut base: Vec<Detection> = Vec::new();
            for (vi, eng) in engines.iter().enumerate() {
                let t = Instant::now();
                let dets: Vec<Detection> = eng.detect(&img, variants[vi].2).unwrap().into_iter().filter(|d| d.w >= MIN_FACE_PX && d.h >= MIN_FACE_PX).collect();
                times[vi].push(t.elapsed().as_secs_f64() * 1000.0);
                total[vi] += dets.len();
                for d in &dets {
                    let a = align(&img, &d.lm);
                    let c = cosine(&eng.embed_aligned(&a).unwrap(), &eng.embed_aligned(&image::imageops::flip_horizontal(&a)).unwrap());
                    if c < 0.6 { suspect[vi] += 1; }
                    if vi > 0 && !base.iter().any(|b| iou(b, d) > 0.3) {
                        extra[vi] += 1;
                        extra_flip[vi].push(c as f64);
                    }
                }
                if vi == 0 { base = dets; }
            }
        }
        let med = |v: &mut Vec<f64>| { v.sort_by(|a, b| a.total_cmp(b)); if v.is_empty() { 0.0 } else { v[v.len() / 2] } };
        eprintln!("zdjęć: {}, dekodowanie (mediana): {:.0} ms", files.len(), med(&mut t_dec));
        for (vi, v) in variants.iter().enumerate() {
            let mut ef = extra_flip[vi].clone();
            eprintln!("{:<28} twarzy {:>3} | dodatkowych vs dotychczasowy {:>3} (mediana zgodności {:.2}) | podejrzanych {:>2} | detekcja {:>4.0} ms", v.0, total[vi], extra[vi], med(&mut ef), suspect[vi], med(&mut times[vi]));
        }
    }

    /// Pomiar całego nowego potoku na prawdziwych zdjęciach (uruchamiany ręcznie): wątki, szybkość, jakość twarzy, grupowanie nowe kontra dawne.
    /// FIBO_BENCH_DIR=folder FIBO_BENCH_N=liczba cargo test --release bench_pipeline -- --ignored --nocapture
    /// Miara precyzji bez znajomości osób: dwie twarze z jednego zdjęcia nigdy nie są tą samą osobą, więc każda taka para w jednej grupie to błąd.
    #[test]
    #[ignore]
    fn bench_pipeline() {
        use std::time::Instant;
        let Ok(dir) = std::env::var("FIBO_BENCH_DIR") else { return };
        let n: usize = std::env::var("FIBO_BENCH_N").ok().and_then(|v| v.parse().ok()).unwrap_or(200);
        let mut files: Vec<PathBuf> = walkdir::WalkDir::new(&dir).into_iter().filter_map(Result::ok).filter(|e| e.file_type().is_file() && crate::is_photo(e.path())).map(|e| e.into_path()).collect();
        files.sort();
        let step = (files.len() / n.max(1)).max(1);
        let files: Vec<PathBuf> = files.into_iter().step_by(step).take(n).collect();
        let mdir = Path::new(env!("CARGO_MANIFEST_DIR")).join("models");
        let engine = Engine::new(&fs::read(mdir.join("yunet.onnx")).unwrap(), &fs::read(mdir.join("sface.onnx")).unwrap()).unwrap();
        let next = AtomicUsize::new(0);
        let results: std::sync::Mutex<Vec<(usize, Vec<NewFace>)>> = std::sync::Mutex::new(Vec::new());
        let workers = worker_count();
        let t0 = Instant::now();
        std::thread::scope(|sc| {
            for _ in 0..workers {
                sc.spawn(|| loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= files.len() { break; }
                    if let Some(f) = analyze_photo(&engine, &files[i]) { results.lock().unwrap().push((i, f)); }
                });
            }
        });
        let wall = t0.elapsed().as_secs_f64();
        let mut res = results.into_inner().unwrap();
        res.sort_by_key(|r| r.0);
        eprintln!("zdjęć: {}, wątków: {}, czas: {:.1} s, {:.0} ms na zdjęcie (łącznie), {:.1} zdjęć/s", files.len(), workers, wall, wall * 1000.0 / files.len() as f64, files.len() as f64 / wall);
        let mut embs: Vec<Vec<f32>> = Vec::new();
        let mut qual: Vec<f32> = Vec::new();
        let mut photos: Vec<i64> = Vec::new();
        for (i, faces) in &res { for f in faces { embs.push(f.emb.clone()); qual.push(f.quality); photos.push(*i as i64); } }
        let total = embs.len();
        let mut q = qual.clone();
        q.sort_by(|a, b| a.total_cmp(b));
        let pc = |p: f64| if q.is_empty() { 0.0 } else { q[((q.len() - 1) as f64 * p) as usize] };
        eprintln!("twarzy: {total}, jakość p10 {:.2}, p25 {:.2}, mediana {:.2}, p75 {:.2}, p90 {:.2}; zdolnych zakładać osoby (>= {}): {}, zasilających grupy (>= {}): {}", pc(0.1), pc(0.25), pc(0.5), pc(0.75), pc(0.9), cluster::SEED_QUALITY, qual.iter().filter(|x| **x >= cluster::SEED_QUALITY).count(), cluster::LEARN_QUALITY, qual.iter().filter(|x| **x >= cluster::LEARN_QUALITY).count());
        // Dawny algorytm: zachłanny, tylko środek grupy, próg 0.42.
        let mut sums: Vec<Vec<f32>> = Vec::new();
        let mut old: Vec<usize> = Vec::new();
        for e in &embs {
            let best = sums.iter().enumerate().map(|(i, s)| { let mut c = s.clone(); normalize(&mut c); (i, cosine(&c, e)) }).max_by(|a, b| a.1.total_cmp(&b.1));
            let id = match best { Some((i, sc)) if sc >= 0.42 => i, _ => { sums.push(vec![0.0; EMB_LEN]); sums.len() - 1 } };
            sums[id].iter_mut().zip(e).for_each(|(a, b)| *a += b);
            old.push(id);
        }
        let conflicts = |g: &dyn Fn(usize) -> Option<usize>| -> usize {
            let mut seen: HashSet<(i64, usize)> = HashSet::new();
            let mut c = 0;
            for i in 0..total { if let Some(x) = g(i) { if !seen.insert((photos[i], x)) { c += 1; } } }
            c
        };
        let singles = |g: &dyn Fn(usize) -> Option<usize>| -> (usize, usize) {
            let mut sz: HashMap<usize, usize> = HashMap::new();
            for i in 0..total { if let Some(x) = g(i) { *sz.entry(x).or_default() += 1; } }
            (sz.len(), sz.values().filter(|c| **c == 1).count())
        };
        let (go, so) = (singles(&|i| Some(old[i])), conflicts(&|i| Some(old[i])));
        eprintln!("DAWNE grupowanie: grup {}, jednoosobowych {}, BŁĘDÓW (dwie twarze ze zdjęcia w jednej grupie): {}", go.0, go.1, so);
        let refs: Vec<&[f32]> = embs.iter().map(|e| e.as_slice()).collect();
        for t in [0.3f32, 0.35, 0.4] {
            let t1 = Instant::now();
            let new = cluster::cluster_all(&refs, &qual, &photos, t);
            let (gn, sn) = singles(&|i| new[i]);
            eprintln!("NOWE (próg {t:.2}): grup {gn}, jednoosobowych {sn}, bez grupy {}, błędów {}, czas {:.0} ms", new.iter().filter(|g| g.is_none()).count(), conflicts(&|i| new[i]), t1.elapsed().as_secs_f64() * 1000.0);
        }
        // Rozkład podobieństwa do najbliższego sąsiada z innego zdjęcia (dobre twarze): pokazuje, jak daleko od progu leży większość par.
        let good: Vec<usize> = (0..total).filter(|&i| qual[i] >= cluster::LEARN_QUALITY).collect();
        let mut nn: Vec<f64> = good.iter().map(|&i| good.iter().filter(|&&j| photos[j] != photos[i]).map(|&j| cosine(&embs[i], &embs[j])).fold(-1.0f32, f32::max) as f64).collect();
        nn.sort_by(|a, b| a.total_cmp(b));
        if !nn.is_empty() { eprintln!("podobieństwo do najbliższego sąsiada: p10 {:.2}, p25 {:.2}, mediana {:.2}, p75 {:.2}", nn[nn.len() / 10], nn[nn.len() / 4], nn[nn.len() / 2], nn[nn.len() * 3 / 4]); }
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

    fn unit(i: usize) -> Vec<f32> {
        let mut v = vec![0.0f32; EMB_LEN];
        v[i] = 1.0;
        v
    }

    fn near(i: usize, j: usize, k: f32) -> Vec<f32> {
        let mut v = unit(i);
        v[j] = k;
        normalize(&mut v);
        v
    }

    fn new_face(emb: Vec<f32>, quality: f32) -> NewFace {
        NewFace {
            det: Detection { x: 10.0, y: 10.0, w: 50.0, h: 50.0, score: 0.95, lm: [(0.0, 0.0); 5] },
            emb,
            quality,
            crop: RgbImage::from_pixel(CROP_SIZE, CROP_SIZE, image::Rgb([200, 150, 100])),
            iw: 200.0,
            ih: 100.0,
        }
    }

    fn lib_with_photos(n: i64) -> (Connection, PathBuf) {
        let c = db();
        // Każdy test ma własny katalog, bo testy działają równolegle (wspólny katalog dawał przypadkowe porażki).
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let tmp = std::env::temp_dir().join(format!("mz-people-pipeline-test-{}", N.fetch_add(1, Ordering::SeqCst)));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(crops_dir(&tmp)).unwrap();
        for id in 1..=n {
            c.execute("INSERT INTO photos (id) VALUES (?1)", [id]).unwrap();
        }
        (c, tmp)
    }

    #[cfg(windows)]
    #[test]
    fn pipeline_stores_encrypted_faces_groups_them_and_forgets() {
        let (c, tmp) = lib_with_photos(4);
        // Zdjęcia 1 i 2: ta sama osoba (prawie ten sam wektor), zdjęcie 3: inna; zdjęcie 4: słaba twarz podobna do pierwszej osoby.
        store_faces(&c, &tmp, 1, 5, vec![new_face(unit(0), 0.9)]).unwrap();
        store_faces(&c, &tmp, 2, 5, vec![new_face(near(0, 1, 0.1), 0.8)]).unwrap();
        store_faces(&c, &tmp, 3, 5, vec![new_face(unit(5), 0.9)]).unwrap();
        store_faces(&c, &tmp, 4, 5, vec![new_face(near(0, 2, 0.15), 0.3)]).unwrap();
        let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(n("SELECT COUNT(*) FROM faces WHERE person_id IS NULL"), 4, "przed grupowaniem nikt nie ma osoby");
        regroup(&c, None, &HashSet::new()).unwrap();
        assert_eq!(n("SELECT COUNT(*) FROM people"), 2, "dwie osoby");
        assert_eq!(n("SELECT COUNT(*) FROM faces WHERE person_id IS NULL"), 0, "słaba twarz dołączyła do pewnej osoby");
        // Wektor w bazie jest zaszyfrowany: nie zawiera jawnych liczb f32 wektora.
        let blob: Vec<u8> = c.query_row("SELECT emb FROM faces WHERE photo_id = 1", [], |r| r.get(0)).unwrap();
        let plain: Vec<u8> = unit(0).iter().flat_map(|x| x.to_le_bytes()).collect();
        assert_ne!(blob, plain);
        assert_eq!(open_embedding(&blob).unwrap(), unit(0));
        assert_eq!(fs::read_dir(crops_dir(&tmp)).unwrap().count(), 4);
        // Ponowna analiza zdjęcia nie dubluje twarzy.
        store_faces(&c, &tmp, 1, 6, vec![new_face(unit(0), 0.9)]).unwrap();
        assert_eq!(n("SELECT COUNT(*) FROM faces WHERE photo_id = 1"), 1);
        // Usunięcie zdjęcia usuwa twarz, wycinek i osobę bez twarzy.
        forget_faces_of_photo(&c, &tmp, 3);
        assert_eq!(fs::read_dir(crops_dir(&tmp)).unwrap().count(), 3);
        assert_eq!(n("SELECT COUNT(*) FROM faces"), 3);
        assert_eq!(n("SELECT COUNT(*) FROM people"), 1);
    }

    #[cfg(windows)]
    #[test]
    fn regroup_never_puts_two_faces_of_one_photo_in_one_person() {
        let (c, tmp) = lib_with_photos(3);
        // Na zdjęciu 1 dwie twarze o niemal identycznych wektorach (np. odbicie w lustrze): muszą być dwiema osobami.
        store_faces(&c, &tmp, 1, 5, vec![new_face(unit(0), 0.9), new_face(near(0, 1, 0.05), 0.9)]).unwrap();
        store_faces(&c, &tmp, 2, 5, vec![new_face(unit(0), 0.9)]).unwrap();
        regroup(&c, None, &HashSet::new()).unwrap();
        let distinct: i64 = c.query_row("SELECT COUNT(DISTINCT person_id) FROM faces WHERE photo_id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(distinct, 2);
    }

    #[cfg(windows)]
    #[test]
    fn named_people_and_manual_fixes_survive_regrouping_and_reanalysis() {
        let (c, tmp) = lib_with_photos(5);
        store_faces(&c, &tmp, 1, 5, vec![new_face(unit(0), 0.9)]).unwrap();
        store_faces(&c, &tmp, 2, 5, vec![new_face(near(0, 1, 0.1), 0.9)]).unwrap();
        store_faces(&c, &tmp, 3, 5, vec![new_face(unit(7), 0.9)]).unwrap();
        regroup(&c, None, &HashSet::new()).unwrap();
        let pid = |photo: i64| -> i64 { c.query_row("SELECT person_id FROM faces WHERE photo_id = ?1", [photo], |r| r.get(0)).unwrap() };
        let ala = pid(1);
        c.execute("UPDATE people SET name = 'Ala' WHERE id = ?1", [ala]).unwrap();
        // Nowe zdjęcie z podobną twarzą dołącza do Ali (osoba z imieniem jest zakotwiczona).
        store_faces(&c, &tmp, 4, 5, vec![new_face(near(0, 2, 0.12), 0.9)]).unwrap();
        regroup(&c, None, &HashSet::new()).unwrap();
        assert_eq!(pid(4), ala, "nowa twarz dołączyła do osoby z imieniem");
        assert_eq!(pid(1), ala);
        // Ręczna poprawka: twarz ze zdjęcia 3 przeniesiona do Ali zostaje u niej, choć wektor jest zupełnie inny.
        let other = pid(3);
        reassign_core(&c, 3, other, Some(ala)).unwrap();
        regroup(&c, None, &HashSet::new()).unwrap();
        assert_eq!(pid(3), ala, "ręczna poprawka nie jest cofana przez grupowanie");
        // Ponowna analiza: zapisujemy osoby zakotwiczone, usuwamy twarze zdjęć, analizujemy je od nowa i grupujemy ze zrzutem.
        let snapshot = load_anchor_faces(&c).unwrap();
        assert!(snapshot.len() >= 4);
        let mut redone = HashSet::new();
        for (photo, emb) in [(1i64, unit(0)), (2, near(0, 1, 0.1)), (3, unit(7)), (4, near(0, 2, 0.12))] {
            store_faces(&c, &tmp, photo, 9, vec![new_face(emb, 0.9)]).unwrap();
            redone.insert(photo);
        }
        let none: i64 = c.query_row("SELECT COUNT(*) FROM faces WHERE person_id IS NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(none, 4);
        regroup(&c, Some(snapshot), &redone).unwrap();
        let name: String = c.query_row("SELECT name FROM people WHERE id = ?1", [ala], |r| r.get(0)).unwrap();
        assert_eq!(name, "Ala", "imię przetrwało ponowną analizę");
        for photo in [1, 2, 4] {
            assert_eq!(pid(photo), ala, "twarz ze zdjęcia {photo} wróciła do Ali po ponownej analizie");
        }
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

    fn cent(id: i64, named: bool, ignored: bool, dir: usize, photos: &[i64]) -> Cent {
        let mut c = vec![0.05_f32; EMB_LEN];
        c[dir] = 1.0;
        normalize(&mut c);
        Cent { id, named, ignored, c, photos: photos.iter().copied().collect() }
    }

    #[test]
    fn suggestions_prefer_known_people_and_skip_those_seen_together() {
        let cents = vec![
            cent(1, true, false, 0, &[10, 11]),   // Anna (znana)
            cent(2, false, false, 0, &[20, 21]),  // nieznana, wygląda jak Anna
            cent(3, true, false, 5, &[30]),       // Ola (znana), inna twarz
            cent(4, false, false, 0, &[10, 40]),  // nieznana podobna do Anny, ale razem z nią na zdjęciu 10
            cent(5, true, true, 0, &[50]),        // pominięta: nie podpowiadamy
        ];
        let s = suggest_core(&cents, None);
        let for2: Vec<_> = s.iter().filter(|x| x.id == 2).collect();
        assert_eq!(for2.len(), 1);
        assert_eq!(for2[0].other, 1, "nieznanej podpowiadamy znaną osobę, nie pominiętą");
        assert!(for2[0].score > 0.9);
        assert!(s.iter().all(|x| x.id != 4), "osoba widziana razem z Anną to raczej ktoś inny");
        assert!(s.iter().all(|x| x.id != 1 && x.id != 3), "znanym osobom niczego nie podpowiadamy");

        // Lista do ręcznego wyboru: wszyscy inni od najbardziej podobnych, z ostrzeżeniem o wspólnym zdjęciu.
        let l = suggest_core(&cents, Some(4));
        assert_eq!(l.len(), 4);
        assert!(l[0].score >= l[1].score);
        let with_anna = l.iter().find(|x| x.other == 1).unwrap();
        assert!(with_anna.conflict);
        assert!(!l.iter().find(|x| x.other == 2).unwrap().conflict);
    }

    #[test]
    fn merge_keeps_chosen_name_and_validates() {
        let c = db();
        c.execute_batch("INSERT INTO people (id, name, ignored) VALUES (1, 'Anna', 0), (2, 'Ania K.', 0), (3, NULL, 1), (4, 'Ola', 0), (5, NULL, 0);").unwrap();
        merge_core(&c, 2, 1, Some("Ania K.")).unwrap();
        merge_core(&c, 3, 1, None).unwrap();
        let (name, ignored): (String, i64) = c.query_row("SELECT name, ignored FROM people WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((name.as_str(), ignored), ("Ania K.", 0), "wybrane imię wygrywa, pominięta osoba nie ukrywa widocznej");
        // Bez wskazanego imienia zostaje imię osoby docelowej, a gdy go nie ma, imię łączonej.
        merge_core(&c, 4, 5, None).unwrap();
        let n: String = c.query_row("SELECT name FROM people WHERE id = 5", [], |r| r.get(0)).unwrap();
        assert_eq!(n, "Ola");
        assert!(merge_core(&c, 1, 99, None).is_err(), "nieistniejąca osoba");
        assert_eq!(c.query_row::<i64, _, _>("SELECT COUNT(*) FROM people", [], |r| r.get(0)).unwrap(), 2);
    }

    #[test]
    fn faces_can_be_moved_rejected_and_persons_deleted() {
        let c = db();
        c.execute_batch("INSERT INTO photos (id) VALUES (1), (2), (3);
            INSERT INTO people (id, name) VALUES (1, 'Anna'), (2, NULL);
            INSERT INTO faces (id, photo_id, person_id, x, y, w, h, score, emb) VALUES
              (10, 1, 1, 0,0,1,1, 1, x''), (11, 2, 1, 0,0,1,1, 1, x''), (12, 3, 2, 0,0,1,1, 1, x''), (13, 1, 2, 0,0,1,1, 1, x'');").unwrap();
        // Dwie twarze z jednego zdjęcia nie mogą trafić do jednej osoby.
        assert!(move_faces_core(&c, &[10, 13], Some(2)).unwrap_err().contains("tego samego zdjęcia"));
        // Osoba 1 ma już twarz na zdjęciu 1 (10), więc twarz 13 (zdjęcie 1) nie może do niej trafić.
        assert!(move_faces_core(&c, &[13], Some(1)).is_err());
        // Twarz 12 (zdjęcie 3) może: osoba 2 traci ostatnią twarz i znika.
        assert_eq!(move_faces_core(&c, &[12], Some(1)).unwrap(), 1);
        let who: i64 = c.query_row("SELECT person_id FROM faces WHERE id = 12", [], |r| r.get(0)).unwrap();
        assert_eq!(who, 1);
        // Przeniesienie do nowej osoby.
        let new = move_faces_core(&c, &[11], None).unwrap();
        assert_ne!(new, 1);
        // Odrzucenie: twarz nie ma osoby i grupowanie jej nie rusza.
        assert_eq!(reject_faces_core(&c, &[10]).unwrap(), 1);
        regroup(&c, None, &HashSet::new()).unwrap();
        let (p, r): (Option<i64>, i64) = c.query_row("SELECT person_id, rejected FROM faces WHERE id = 10", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((p, r), (None, 1));
        // Usunięcie osoby odrzuca wszystkie jej twarze.
        assert_eq!(delete_person_core(&c, new).unwrap(), 1);
        assert_eq!(c.query_row::<i64, _, _>("SELECT COUNT(*) FROM people WHERE id = ?1", [new], |r| r.get(0)).unwrap(), 0);
        assert!(move_faces_core(&c, &[], None).is_err());
    }

    #[test]
    fn day_parsing_accepts_exif_and_iso_dates() {
        assert_eq!(day_of("2024-07-01 12:00:00"), day_of("2024:07:01 08:15:00"));
        assert!(day_of("2024-07-02").unwrap() == day_of("2024-07-01").unwrap() + 1);
        assert_eq!(day_of("nie data"), None);
        assert_eq!(day_of("2024-13-40"), None);
    }
}
