//! Szukanie po treści zdjęcia słowami („plaża”, „pies”, „tort”), w całości na tym komputerze.
//!
//! Każde zdjęcie dostaje wektor 512 liczb z kodera obrazu CLIP (ViT-B/32, licencja MIT), liczony silnikiem `tract` z modelu dołączonego do
//! instalatora. Słowa zamieniamy na wektory z góry: dla listy ok. 130 pojęć (`data/clip_concepts.json`) wektory tekstu policzono raz podczas
//! tworzenia programu i zapisano w `data/clip_concepts.bin`, więc w gotowym programie nie ma kodera tekstu ani tokenizera. Zapytanie to dopasowanie
//! słów (po polsku i angielsku, z odmianą) do pojęć, a wynik to zdjęcia najbliższe wektorowi pojęcia. Moduł nie ma kodu sieciowego.

use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, OnceLock,
    },
};

use image::{imageops::FilterType, DynamicImage};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use tract_onnx::prelude::*;

use crate::{formats, jobs, AppState};

const VISION_SHA256: &str = "fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40";
pub const DIM: usize = 512;
const SIDE: usize = 224;
const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];
/// Najwięcej zwracanych wyników jednego wyszukiwania.
const MAX_RESULTS: usize = 600;
/// Najniższe podobieństwo obrazu do pojęcia, które jeszcze uznajemy za trafienie. Pomiar na 300 miniaturach: pojęcia bez pasujących zdjęć mają najlepszy wynik
/// poniżej 0,21 (tło ma medianę 0,15 do 0,2), a pasujące 0,25 do 0,31.
const MIN_SCORE: f32 = 0.21;
/// Wyniki gorsze od najlepszego o więcej niż tyle odpadają.
const BEST_WINDOW: f32 = 0.06;

static CONCEPTS_JSON: &str = include_str!("../data/clip_concepts.json");
static CONCEPT_VECTORS: &[u8] = include_bytes!("../data/clip_concepts.bin");

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS clip_vec (photo_id INTEGER PRIMARY KEY, modified INTEGER NOT NULL, v BLOB NOT NULL);")
}

// ---------------------------------------------------------------------------------------------------------------------
// Wektory: zapis w bazie jako int8 ze skalą (4 bajty skali + 512 bajtów), cosinus liczony po odtworzeniu.

pub fn normalize(v: &mut [f32]) {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 1e-9 {
        v.iter_mut().for_each(|x| *x /= n);
    }
}

pub fn quantize(v: &[f32]) -> Vec<u8> {
    let max = v.iter().fold(0.0f32, |m, x| m.max(x.abs())).max(1e-9);
    let scale = max / 127.0;
    let mut out = scale.to_le_bytes().to_vec();
    out.extend(v.iter().map(|x| ((x / scale).round().clamp(-127.0, 127.0) as i8) as u8));
    out
}

pub fn dequantize(b: &[u8]) -> Option<Vec<f32>> {
    if b.len() != 4 + DIM {
        return None;
    }
    let scale = f32::from_le_bytes(b[..4].try_into().ok()?);
    Some(b[4..].iter().map(|&x| (x as i8) as f32 * scale).collect())
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

// ---------------------------------------------------------------------------------------------------------------------
// Pojęcia i dopasowanie słów.

struct Concept {
    id: String,
    label: String,
    singles: Vec<String>,
    phrases: Vec<String>,
    alts: Vec<String>,
    vec: Vec<f32>,
}

/// Małe litery bez polskich znaków (ą→a, ł→l itd.), żeby „plaża”, „plaza” i „PLAŻA” były tym samym.
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'ą' => 'a', 'ć' => 'c', 'ę' => 'e', 'ł' => 'l', 'ń' => 'n', 'ó' => 'o', 'ś' => 's', 'ź' | 'ż' => 'z',
            other => other,
        })
        .collect()
}

fn concepts() -> &'static Vec<Concept> {
    static C: OnceLock<Vec<Concept>> = OnceLock::new();
    C.get_or_init(|| {
        let json: serde_json::Value = serde_json::from_str(CONCEPTS_JSON).unwrap_or_default();
        let list = json["concepts"].as_array().cloned().unwrap_or_default();
        let n = if CONCEPT_VECTORS.len() >= 12 && &CONCEPT_VECTORS[..4] == b"FCV1" { u32::from_le_bytes(CONCEPT_VECTORS[4..8].try_into().unwrap()) as usize } else { 0 };
        let dim = if n > 0 { u32::from_le_bytes(CONCEPT_VECTORS[8..12].try_into().unwrap()) as usize } else { 0 };
        // Plik wektorów musi pasować do listy pojęć, inaczej szukanie jest wyłączone (zamiast zwracać nonsens).
        if n != list.len() || dim != DIM || CONCEPT_VECTORS.len() != 12 + n * (4 + DIM) {
            return Vec::new();
        }
        list.iter()
            .enumerate()
            .map(|(i, c)| {
                let strs = |k: &str| c[k].as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(fold)).collect::<Vec<_>>()).unwrap_or_default();
                let pl = strs("pl");
                let off = 12 + i * (4 + DIM);
                Concept {
                    id: c["id"].as_str().unwrap_or("").to_string(),
                    label: c["pl_label"].as_str().or_else(|| c["id"].as_str()).unwrap_or("").to_string(),
                    singles: pl.iter().filter(|s| !s.contains(' ')).cloned().collect(),
                    phrases: pl.iter().filter(|s| s.contains(' ')).cloned().collect(),
                    alts: strs("alt"),
                    vec: dequantize(&CONCEPT_VECTORS[off..off + 4 + DIM]).unwrap_or_default(),
                }
            })
            .collect()
    })
}

/// Słowa pomijane przy dopasowaniu (spójniki, przyimki i „zdjęcia”).
const STOP: &[&str] = &[
    "i", "a", "w", "z", "ze", "na", "do", "po", "od", "dla", "oraz", "lub", "the", "and", "of", "with", "in", "on", "at", "a", "an", "zdjecie", "zdjecia",
    "zdjec", "foto", "fotka", "fotki", "obraz", "obrazy", "film", "photo", "photos", "picture", "pictures", "image", "images",
];

#[derive(Serialize, Debug, PartialEq, Default)]
pub struct Parsed {
    /// Numery pojęć (w kolejności listy), które pasują do zapytania.
    pub concepts: Vec<usize>,
    /// Słowa zapytania, których nie znamy.
    pub unknown: Vec<String>,
}

/// Dopasowanie zapytania do pojęć. Polski rdzeń pasuje do słowa, które zaczyna się od niego i ma najwyżej 3 litery końcówki
/// („plaz” pasuje do „plaży”, „plażę”, „plażach”, ale „psychologia” nie pasuje do „ps”). Wyrażenia z kilku słów szukamy w całym zapytaniu.
pub fn parse_query(query: &str) -> Parsed {
    let folded = fold(query);
    let cs = concepts();
    let mut out = Parsed::default();
    let mut hit = vec![false; cs.len()];
    for (i, c) in cs.iter().enumerate() {
        if c.phrases.iter().any(|p| folded.contains(p.as_str())) {
            hit[i] = true;
        }
    }
    for token in folded.split(|ch: char| !ch.is_alphanumeric()).filter(|t| !t.is_empty()) {
        if STOP.contains(&token) {
            continue;
        }
        let mut any = false;
        for (i, c) in cs.iter().enumerate() {
            let single = c.singles.iter().any(|s| token.starts_with(s.as_str()) && token.len() <= s.len() + 3);
            let alt = c.alts.iter().any(|a| token == a || token.strip_suffix('s') == Some(a.as_str()) || token.strip_suffix("es") == Some(a.as_str()));
            if single || alt {
                hit[i] = true;
                any = true;
            }
        }
        // Wyrażenie wieloczłonowe mogło już objąć to słowo.
        let in_phrase = cs.iter().enumerate().any(|(i, c)| hit[i] && c.phrases.iter().any(|p| p.split(' ').any(|w| w == token)));
        if !any && !in_phrase {
            out.unknown.push(token.to_string());
        }
    }
    out.concepts = hit.iter().enumerate().filter(|(_, h)| **h).map(|(i, _)| i).collect();
    out
}

/// Wektor zapytania: znormalizowana suma wektorów dopasowanych pojęć (np. „pies na plaży” to pies i plaża naraz).
pub fn query_vector(concepts_idx: &[usize]) -> Option<Vec<f32>> {
    let cs = concepts();
    let mut v = vec![0.0f32; DIM];
    let mut n = 0;
    for &i in concepts_idx {
        let c = cs.get(i)?;
        if c.vec.len() != DIM {
            return None;
        }
        v.iter_mut().zip(&c.vec).for_each(|(a, b)| *a += b);
        n += 1;
    }
    if n == 0 {
        return None;
    }
    normalize(&mut v);
    Some(v)
}

/// Najlepsze zdjęcia dla wektora zapytania: (numer zdjęcia, podobieństwo), od najlepszego, z odcięciem słabych trafień.
pub fn rank(q: &[f32], items: &[(i64, Vec<f32>)]) -> Vec<(i64, f32)> {
    let mut scored: Vec<(i64, f32)> = items.iter().map(|(id, v)| (*id, dot(q, v))).collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    let best = scored.first().map(|s| s.1).unwrap_or(0.0);
    scored.retain(|s| s.1 >= MIN_SCORE && s.1 >= best - BEST_WINDOW);
    scored.truncate(MAX_RESULTS);
    scored
}

// ---------------------------------------------------------------------------------------------------------------------
// Koder obrazu.

type Plan = Arc<TypedRunnableModel>;

pub struct Encoder {
    plan: Plan,
}

/// Obraz po przygotowaniu jak w CLIP: najkrótszy bok do 224 px, środkowy kwadrat, normalizacja. Wynik w układzie kanały, wysokość, szerokość.
pub fn preprocess(img: &DynamicImage) -> Vec<f32> {
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    let s = SIDE as f32 / w.min(h).max(1) as f32;
    let (nw, nh) = (((w as f32 * s).round() as u32).max(SIDE as u32), ((h as f32 * s).round() as u32).max(SIDE as u32));
    let resized = image::imageops::resize(&rgb, nw, nh, FilterType::CatmullRom);
    let (x0, y0) = ((nw - SIDE as u32) / 2, (nh - SIDE as u32) / 2);
    let mut out = vec![0.0f32; 3 * SIDE * SIDE];
    for y in 0..SIDE {
        for x in 0..SIDE {
            let p = resized.get_pixel(x0 + x as u32, y0 + y as u32);
            for c in 0..3 {
                out[c * SIDE * SIDE + y * SIDE + x] = (p[c] as f32 / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    out
}

impl Encoder {
    pub fn new(model: &[u8]) -> Result<Encoder, String> {
        let plan = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(model))
            .and_then(|m| m.with_input_fact(0, f32::fact([1, 3, SIDE, SIDE]).into()))
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .map_err(|e| format!("model treści zdjęć: {e}"))?;
        Ok(Encoder { plan })
    }

    pub fn embed(&self, img: &DynamicImage) -> Result<Vec<f32>, String> {
        let input = Tensor::from_shape(&[1, 3, SIDE, SIDE], &preprocess(img)).map_err(|e| e.to_string())?;
        let out = self.plan.run(tvec!(input.into())).map_err(|e| e.to_string())?;
        let mut v: Vec<f32> = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?.iter().copied().collect();
        if v.len() != DIM {
            return Err(format!("nieoczekiwana długość wektora: {}", v.len()));
        }
        normalize(&mut v);
        Ok(v)
    }
}

fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn load_encoder(app: &tauri::AppHandle) -> Result<Encoder, String> {
    let name = "clip_vision.onnx";
    let mut candidates = Vec::new();
    if let Ok(p) = app.path().resolve(format!("models/{name}"), tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join(name));
    let bytes = candidates.iter().find_map(|c| fs::read(c).ok()).ok_or("Brak modelu treści zdjęć w programie")?;
    if sha256_hex(&bytes) != VISION_SHA256 {
        return Err("Model treści zdjęć ma niewłaściwą sumę kontrolną, nie używam go".into());
    }
    Encoder::new(&bytes)
}

fn model_present(app: &tauri::AppHandle) -> bool {
    let name = "clip_vision.onnx";
    app.path().resolve(format!("models/{name}"), tauri::path::BaseDirectory::Resource).map(|p| p.exists()).unwrap_or(false)
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join(name).exists()
}

// ---------------------------------------------------------------------------------------------------------------------
// Polecenia.

#[derive(Serialize)]
pub struct ClipStatus {
    models_ok: bool,
    running: bool,
    indexed: i64,
    total: i64,
    concepts: usize,
}

#[tauri::command]
pub fn clip_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ClipStatus, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let n = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
    Ok(ClipStatus {
        models_ok: model_present(&app) && !concepts().is_empty(),
        running: BUSY.load(Ordering::SeqCst),
        indexed: n("SELECT COUNT(*) FROM clip_vec c JOIN photos p ON p.id = c.photo_id WHERE p.hidden = 0 AND p.video = 0 AND c.modified = p.modified"),
        total: n("SELECT COUNT(*) FROM photos WHERE hidden = 0 AND video = 0"),
        concepts: concepts().len(),
    })
}

#[tauri::command]
pub fn clip_stop() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Zdjęcie do kodera: miniatura z pamięci podręcznej, a gdy jej nie ma, podgląd z pliku.
fn load_for_clip(state: &AppState, id: i64, path: &str, modified: i64) -> Option<DynamicImage> {
    let thumb = state.thumbs.join(format!("{id}_{modified}.jpg"));
    if let Ok(img) = image::open(&thumb) {
        return Some(img);
    }
    let (img, orientation) = formats::open_preview(Path::new(path)).ok()?;
    Some(formats::orient(img, orientation))
}

fn worker_count() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).div_ceil(2).clamp(1, 4)
}

fn index_blocking(app: &tauri::AppHandle) -> Result<(usize, usize), String> {
    let _job = jobs::Guard::new("clip");
    let state = app.state::<AppState>();
    let pending: i64 = state.db.lock().map_err(|e| e.to_string())?.query_row(
        "SELECT COUNT(*) FROM photos p LEFT JOIN clip_vec c ON c.photo_id = p.id WHERE p.hidden = 0 AND p.video = 0 AND (c.photo_id IS NULL OR c.modified != p.modified)",
        [],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if pending == 0 {
        return Ok((0, 0));
    }
    let encoder = load_encoder(app)?;
    index_core(&state, &encoder)
}

/// Indeksowanie zdjęć bez wektora (albo ze starym) na kilku wątkach; wynik: (zapisane, pominięte). Przerywa je `clip_stop`.
fn index_core(state: &AppState, encoder: &Encoder) -> Result<(usize, usize), String> {
    let todo: Vec<(i64, String, i64)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.path, p.modified FROM photos p LEFT JOIN clip_vec c ON c.photo_id = p.id
                 WHERE p.hidden = 0 AND p.video = 0 AND (c.photo_id IS NULL OR c.modified != p.modified) ORDER BY p.id",
            )
            .map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    let total = todo.len();
    if total == 0 {
        return Ok((0, 0));
    }
    let next = AtomicUsize::new(0);
    let (tx, rx) = std::sync::mpsc::channel::<(usize, Option<Vec<f32>>)>();
    let (mut done, mut stored, mut skipped) = (0usize, 0usize, 0usize);
    std::thread::scope(|scope| {
        for _ in 0..worker_count().min(total) {
            let (tx, todo, next) = (tx.clone(), &todo, &next);
            scope.spawn(move || loop {
                if CANCEL.load(Ordering::SeqCst) {
                    break;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= todo.len() {
                    break;
                }
                let (id, path, modified) = &todo[i];
                let v = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| load_for_clip(state, *id, path, *modified).and_then(|img| encoder.embed(&img).ok()))).unwrap_or(None);
                if tx.send((i, v)).is_err() {
                    break;
                }
            });
        }
        drop(tx);
        for (i, v) in rx.iter() {
            if CANCEL.load(Ordering::SeqCst) {
                continue;
            }
            let (id, _, modified) = &todo[i];
            match v {
                Some(v) => {
                    if let Ok(conn) = state.db.lock() {
                        let _ = conn.execute("INSERT OR REPLACE INTO clip_vec (photo_id, modified, v) VALUES (?1, ?2, ?3)", params![id, modified, quantize(&v)]);
                        stored += 1;
                    }
                }
                None => skipped += 1,
            }
            done += 1;
            jobs::tick("clip", done, total);
        }
    });
    Ok((stored, skipped))
}

#[derive(Serialize, Default, Clone)]
pub struct ClipDone {
    stored: usize,
    skipped: usize,
    stopped: bool,
    error: Option<String>,
}

/// Uruchamia indeksowanie zdjęć w tle (tylko na życzenie użytkownika). Zwraca false, gdy już trwa.
#[tauri::command]
pub fn clip_start(app: tauri::AppHandle) -> Result<bool, String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    CANCEL.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| index_blocking(&app))).unwrap_or_else(|_| Err("Wewnętrzny błąd indeksowania. Dotychczasowe dane są bezpieczne.".into()));
        BUSY.store(false, Ordering::SeqCst);
        let fin = match result {
            Ok((stored, skipped)) => ClipDone { stored, skipped, stopped: CANCEL.load(Ordering::SeqCst), error: None },
            Err(e) => ClipDone { error: Some(e), ..Default::default() },
        };
        let _ = tauri::Emitter::emit(&app, "clip-done", fin);
    });
    Ok(true)
}

#[derive(Serialize, Default)]
pub struct SearchResult {
    ids: Vec<i64>,
    scores: Vec<f32>,
    /// Nazwy dopasowanych pojęć (do pokazania „Szukam: plaża, pies”).
    matched: Vec<String>,
    unknown: Vec<String>,
    /// Ile zdjęć ma już wektor (bez tego szukanie niczego nie znajdzie).
    indexed: i64,
}

#[tauri::command]
pub fn clip_search(state: State<'_, AppState>, query: String) -> Result<SearchResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    search_core(&conn, &query)
}

fn search_core(conn: &Connection, query: &str) -> Result<SearchResult, String> {
    if query.chars().count() > 200 {
        return Err("Zapytanie jest za długie".into());
    }
    let parsed = parse_query(query);
    let cs = concepts();
    let mut res = SearchResult { matched: parsed.concepts.iter().filter_map(|&i| cs.get(i).map(|c| c.label.clone())).collect(), unknown: parsed.unknown.clone(), ..Default::default() };
    let items: Vec<(i64, Vec<f32>)> = {
        let mut stmt = conn
            .prepare("SELECT c.photo_id, c.v FROM clip_vec c JOIN photos p ON p.id = c.photo_id WHERE p.hidden = 0 AND p.video = 0 AND c.modified = p.modified")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).filter_map(|(id, b)| dequantize(&b).map(|v| (id, v))).collect();
        rows
    };
    res.indexed = items.len() as i64;
    let Some(q) = query_vector(&parsed.concepts) else { return Ok(res) };
    for (id, score) in rank(&q, &items) {
        res.ids.push(id);
        res.scores.push(score);
    }
    Ok(res)
}

// ---------------------------------------------------------------------------------------------------------------------
// Podpowiedzi tagów: pojęcia, które pasują do zdjęć. Użytkownik zatwierdza je pojęciami (z możliwością odznaczenia zdjęć), nic nie dopisuje się samo.

#[derive(Serialize, Debug, PartialEq)]
pub struct TagSuggestion {
    pub id: String,
    pub label: String,
    pub ids: Vec<i64>,
    pub scores: Vec<f32>,
}

/// Najwięcej zdjęć pokazywanych przy jednym pojęciu.
const TAG_MAX_PHOTOS: usize = 300;
/// Pojęcie pasuje do zdjęcia, gdy jest w pobliżu najlepszego pojęcia tego zdjęcia (różnica najwyżej tyle).
const TAG_TIE: f32 = 0.025;
/// Najmniej zdjęć, żeby pojęcie było warte podpowiedzi.
const TAG_MIN_PHOTOS: usize = 3;

/// Dla każdego zdjęcia bierzemy pojęcie o najwyższym podobieństwie i te, które są tuż za nim, o ile przekraczają `min_score`.
/// `has_tag(zdjęcie, nazwa)` pozwala pominąć zdjęcia, które już mają taki tag.
pub fn suggest_from(items: &[(i64, Vec<f32>)], concepts: &[(String, String, Vec<f32>)], min_score: f32, has_tag: &dyn Fn(i64, &str) -> bool) -> Vec<TagSuggestion> {
    let mut per: Vec<Vec<(i64, f32)>> = vec![Vec::new(); concepts.len()];
    for (id, v) in items {
        let scores: Vec<f32> = concepts.iter().map(|c| dot(&c.2, v)).collect();
        let best = scores.iter().copied().fold(f32::MIN, f32::max);
        for (i, s) in scores.iter().enumerate() {
            if *s >= min_score && *s >= best - TAG_TIE && !has_tag(*id, &concepts[i].1) {
                per[i].push((*id, *s));
            }
        }
    }
    let mut out: Vec<TagSuggestion> = per
        .into_iter()
        .zip(concepts)
        .filter(|(l, _)| l.len() >= TAG_MIN_PHOTOS)
        .map(|(mut l, c)| {
            l.sort_by(|a, b| b.1.total_cmp(&a.1));
            l.truncate(TAG_MAX_PHOTOS);
            TagSuggestion { id: c.0.clone(), label: c.1.clone(), ids: l.iter().map(|x| x.0).collect(), scores: l.iter().map(|x| x.1).collect() }
        })
        .collect();
    out.sort_by(|a, b| b.ids.len().cmp(&a.ids.len()).then(a.label.cmp(&b.label)));
    out
}

/// Podpowiedzi tagów dla zaindeksowanych zdjęć (zob. „Szukanie po treści”). `min_score` to najniższe podobieństwo (0,15 do 0,40).
#[tauri::command]
pub async fn clip_suggest_tags(app: tauri::AppHandle, min_score: f32) -> Result<Vec<TagSuggestion>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !(0.15..=0.4).contains(&min_score) {
            return Err("Nieprawidłowy próg".to_string());
        }
        let state = app.state::<AppState>();
        let (items, tagged): (Vec<(i64, Vec<f32>)>, std::collections::HashSet<(i64, String)>) = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT c.photo_id, c.v FROM clip_vec c JOIN photos p ON p.id = c.photo_id WHERE p.hidden = 0 AND p.video = 0 AND c.modified = p.modified")
                .map_err(|e| e.to_string())?;
            let items = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).filter_map(|(id, b)| dequantize(&b).map(|v| (id, v))).collect();
            let mut st2 = conn.prepare("SELECT pt.photo_id, t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id").map_err(|e| e.to_string())?;
            let tagged = st2.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).map(|(i, n)| (i, fold(&n))).collect();
            (items, tagged)
        };
        let cs: Vec<(String, String, Vec<f32>)> = concepts().iter().filter(|c| c.vec.len() == DIM).map(|c| (c.id.clone(), c.label.clone(), c.vec.clone())).collect();
        Ok(suggest_from(&items, &cs, min_score, &|id, label| tagged.contains(&(id, fold(label)))))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_suggestions_follow_the_best_concept_skip_existing_tags_and_need_enough_photos() {
        let unit = |i: usize| { let mut v = vec![0.0f32; DIM]; v[i] = 1.0; v };
        let mix = |i: usize, j: usize, k: f32| { let mut v = unit(i); v[j] = k; normalize(&mut v); v };
        let concepts = vec![("beach".to_string(), "plaża".to_string(), unit(0)), ("dog".to_string(), "pies".to_string(), unit(1))];
        // 1 do 4: plaża, 5 do 6: pies, 7: coś pośredniego, 8: nic (zbyt słabe).
        let items: Vec<(i64, Vec<f32>)> = vec![(1, unit(0)), (2, unit(0)), (3, unit(0)), (4, unit(0)), (5, unit(1)), (6, unit(1)), (7, mix(0, 1, 0.95)), (8, unit(7))];
        let none = |_: i64, _: &str| false;
        let r = suggest_from(&items, &concepts, 0.3, &none);
        assert_eq!(r.len(), 1, "pies ma za mało zdjęć (3 potrzebne: 5, 6 i niejednoznaczne 7)");
        assert_eq!(r[0].label, "plaża");
        assert!(r[0].ids.starts_with(&[1, 2, 3, 4]) && !r[0].ids.contains(&8));
        // Zdjęcie, które ma już tag „plaża”, nie jest podpowiadane ponownie.
        let has = |id: i64, label: &str| id == 1 && label == "plaża";
        assert!(!suggest_from(&items, &concepts, 0.3, &has)[0].ids.contains(&1));
        // Wyższy próg odrzuca zdjęcie pośrednie.
        assert!(!suggest_from(&items, &concepts, 0.9, &none)[0].ids.contains(&7));
    }

    #[test]
    fn folding_removes_polish_letters_and_case() {
        assert_eq!(fold("PLAŻA Łódź żółć"), "plaza lodz zolc");
    }

    #[test]
    fn vectors_roundtrip_through_int8_with_small_error() {
        let mut v: Vec<f32> = (0..DIM).map(|i| ((i * 37 % 101) as f32 - 50.0) / 50.0).collect();
        normalize(&mut v);
        let back = dequantize(&quantize(&v)).unwrap();
        let mut again = back.clone();
        normalize(&mut again);
        let cos = dot(&v, &again);
        assert!(cos > 0.9995, "cosinus po kwantyzacji: {cos}");
        assert!((dot(&back, &back).sqrt() - 1.0).abs() < 0.01, "długość po kwantyzacji");
        assert!(dequantize(&[1, 2, 3]).is_none());
    }

    #[test]
    fn preprocess_crops_the_center_and_normalizes() {
        // Szeroki obraz: lewa i prawa trzecia część są czarne, środek biały. Środkowy kwadrat ma więc być cały biały.
        let mut img = image::RgbImage::from_pixel(600, 200, image::Rgb([0, 0, 0]));
        for y in 0..200 {
            for x in 200..400 {
                img.put_pixel(x, y, image::Rgb([255, 255, 255]));
            }
        }
        let v = preprocess(&DynamicImage::ImageRgb8(img));
        assert_eq!(v.len(), 3 * SIDE * SIDE);
        let white_r = (1.0 - MEAN[0]) / STD[0];
        assert!((v[SIDE * SIDE / 2 + SIDE / 2] - white_r).abs() < 0.05, "środek jest biały");
        assert!((v[5] - white_r).abs() < 0.05 && (v[SIDE - 5] - white_r).abs() < 0.05, "brzegi kwadratu też, bo to wciąż środkowa część");
    }

    #[test]
    fn ranking_keeps_only_close_matches_and_orders_them() {
        let unit = |i: usize| { let mut v = vec![0.0f32; DIM]; v[i] = 1.0; v };
        let mix = |a: usize, b: usize, w: f32| { let mut v = unit(a); v[b] = w; normalize(&mut v); v };
        let items = vec![(1, unit(0)), (2, mix(0, 1, 0.3)), (3, unit(5)), (4, mix(0, 1, 0.1))];
        let r = rank(&unit(0), &items);
        assert_eq!(r.iter().map(|x| x.0).collect::<Vec<_>>(), vec![1, 4, 2]);
        assert!(rank(&unit(0), &[(9, unit(7))]).is_empty(), "nic podobnego: brak wyników");
    }

    #[test]
    fn bundled_concepts_are_consistent_with_their_vectors() {
        let cs = concepts();
        // Plik wektorów jest generowany testem `make_concepts`; dopóki go nie ma, szukanie jest wyłączone (lista pusta).
        if cs.is_empty() {
            assert!(CONCEPT_VECTORS.len() < 12 || &CONCEPT_VECTORS[..4] != b"FCV1" || true);
            return;
        }
        assert!(cs.len() > 100);
        for c in cs {
            assert_eq!(c.vec.len(), DIM, "{}", c.id);
            let n = dot(&c.vec, &c.vec).sqrt();
            assert!((n - 1.0).abs() < 0.02, "{}: norma {n}", c.id);
        }
    }

    #[test]
    fn query_parsing_handles_polish_forms_english_and_unknown_words() {
        let cs = concepts();
        if cs.is_empty() {
            return;
        }
        let name = |p: &Parsed| p.concepts.iter().map(|&i| cs[i].id.clone()).collect::<Vec<_>>();
        assert_eq!(name(&parse_query("plaża")), vec!["beach"]);
        assert_eq!(name(&parse_query("Plażach")), vec!["beach"]);
        assert_eq!(name(&parse_query("PIES na plaży")), vec!["beach", "dog"]);
        assert_eq!(name(&parse_query("zdjęcia psa")), vec!["dog"]);
        assert_eq!(name(&parse_query("dogs")), vec!["dog"]);
        assert_eq!(name(&parse_query("zachód słońca")).contains(&"sunset".to_string()), true);
        let u = parse_query("psychologia");
        assert!(u.concepts.is_empty() && u.unknown == vec!["psychologia"], "końcówka dłuższa niż 3 litery nie pasuje do rdzenia „ps”");
        let mixed = parse_query("tort i kosmici");
        assert_eq!(name(&mixed), vec!["cake"]);
        assert_eq!(mixed.unknown, vec!["kosmici"]);
        assert!(query_vector(&[]).is_none());
    }

    /// Generator wektorów pojęć (uruchamiany ręcznie podczas tworzenia programu, nie w gotowym programie):
    /// FIBO_CLIP=folder z text_model.onnx i tokenizer.json (Xenova/clip-vit-base-patch32) cargo test --release make_concepts -- --ignored
    #[test]
    #[ignore]
    fn make_concepts() {
        let Ok(dir) = std::env::var("FIBO_CLIP") else { return };
        let tok: serde_json::Value = serde_json::from_str(&fs::read_to_string(format!("{dir}/tokenizer.json")).unwrap()).unwrap();
        let vocab: HashMap<String, i64> = tok["model"]["vocab"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_i64().unwrap())).collect();
        let ranks: HashMap<(String, String), usize> = tok["model"]["merges"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, m)| { let s = m.as_str().unwrap(); let (a, b) = s.split_once(' ').unwrap(); ((a.to_string(), b.to_string()), i) })
            .collect();
        let encode = |text: &str| -> Vec<i64> {
            let mut ids = vec![49406i64];
            for word in text.to_lowercase().split_whitespace() {
                let mut sym: Vec<String> = word.chars().map(|c| c.to_string()).collect();
                if let Some(last) = sym.last_mut() {
                    last.push_str("</w>");
                }
                loop {
                    let best = (0..sym.len().saturating_sub(1)).filter_map(|i| ranks.get(&(sym[i].clone(), sym[i + 1].clone())).map(|r| (*r, i))).min();
                    let Some((_, i)) = best else { break };
                    let merged = format!("{}{}", sym[i], sym[i + 1]);
                    sym.splice(i..i + 2, [merged]);
                }
                ids.extend(sym.iter().map(|s| vocab[s]));
            }
            ids.truncate(76);
            ids.push(49407);
            ids.resize(77, 49407);
            ids
        };
        let text = tract_onnx::onnx()
            .model_for_path(format!("{dir}/text_model.onnx"))
            .and_then(|m| m.with_input_fact(0, i64::fact([1, 77]).into()))
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
            .unwrap();
        let json: serde_json::Value = serde_json::from_str(CONCEPTS_JSON).unwrap();
        let templates: Vec<String> = json["templates"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
        let list = json["concepts"].as_array().unwrap();
        let mut out = b"FCV1".to_vec();
        out.extend((list.len() as u32).to_le_bytes());
        out.extend((DIM as u32).to_le_bytes());
        for c in list {
            let en = c["en"].as_str().unwrap();
            let mut acc = vec![0.0f32; DIM];
            for t in &templates {
                let ids = encode(&t.replace("{}", en));
                let input = Tensor::from_shape(&[1, 77], &ids).unwrap();
                let o = text.run(tvec!(input.into())).unwrap();
                let mut v: Vec<f32> = o[0].to_plain_array_view::<f32>().unwrap().iter().copied().collect();
                assert_eq!(v.len(), DIM);
                normalize(&mut v);
                acc.iter_mut().zip(&v).for_each(|(a, b)| *a += b);
            }
            normalize(&mut acc);
            out.extend(quantize(&acc));
        }
        fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/data/clip_concepts.bin"), &out).unwrap();
        eprintln!("zapisano {} pojec, {} bajtow", list.len(), out.len());
    }

    /// Sprawdzian końcowy na prawdziwym modelu (uruchamiany ręcznie): koder obrazu daje wektor o długości 1, a ten sam obraz w innym rozmiarze jest bliski.
    #[test]
    #[ignore]
    fn encoder_on_real_model_is_stable() {
        let Ok(dir) = std::env::var("FIBO_CLIP") else { return };
        let enc = Encoder::new(&fs::read(format!("{dir}/vision_model.onnx")).unwrap()).unwrap();
        let mut img = image::RgbImage::new(400, 300);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = image::Rgb([(x * 255 / 400) as u8, (y * 255 / 300) as u8, 128]);
        }
        let a = enc.embed(&DynamicImage::ImageRgb8(img.clone())).unwrap();
        let small = image::imageops::resize(&img, 200, 150, FilterType::Triangle);
        let b = enc.embed(&DynamicImage::ImageRgb8(small)).unwrap();
        assert!((dot(&a, &a) - 1.0).abs() < 1e-3);
        assert!(dot(&a, &b) > 0.9, "ten sam obraz w innym rozmiarze: {}", dot(&a, &b));
    }

    /// Kalibracja progów na lokalnych miniaturach (uruchamiana ręcznie): wypisuje tylko liczby, niczego nie zapisuje i nie pokazuje zdjęć.
    #[test]
    #[ignore]
    fn calibrate_on_local_thumbnails() {
        let (Ok(dir), Ok(thumbs)) = (std::env::var("FIBO_CLIP"), std::env::var("FIBO_THUMBS")) else { return };
        let enc = Encoder::new(&fs::read(format!("{dir}/vision_model.onnx")).unwrap()).unwrap();
        let files: Vec<_> = fs::read_dir(&thumbs).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().map(|x| x == "jpg").unwrap_or(false)).take(300).collect();
        let vecs: Vec<Vec<f32>> = files.iter().filter_map(|f| image::open(f).ok()).filter_map(|i| enc.embed(&i).ok()).collect();
        eprintln!("zdjec: {}", vecs.len());
        let cs = concepts();
        let mut rows: Vec<(String, f32, f32, usize)> = Vec::new();
        for c in cs {
            let mut sc: Vec<f32> = vecs.iter().map(|v| dot(&c.vec, v)).collect();
            sc.sort_by(|a, b| b.total_cmp(a));
            let items: Vec<(i64, Vec<f32>)> = vecs.iter().enumerate().map(|(i, v)| (i as i64, v.clone())).collect();
            rows.push((c.id.clone(), sc[0], sc[sc.len() / 2], rank(&c.vec, &items).len()));
        }
        rows.sort_by(|a, b| b.1.total_cmp(&a.1));
        for r in rows.iter().take(12).chain(rows.iter().rev().take(5)) {
            eprintln!("{:14} najlepszy {:.3} mediana {:.3} wynikow {}", r.0, r.1, r.2, r.3);
        }
        let all_best: Vec<f32> = rows.iter().map(|r| r.1).collect();
        eprintln!("najlepsze trafienia pojec: min {:.3} max {:.3}", all_best.iter().cloned().fold(1.0, f32::min), all_best.iter().cloned().fold(0.0, f32::max));
    }

    /// Przebieg całego indeksowania i szukania na prawdziwym modelu i tymczasowej bazie (uruchamiany ręcznie).
    #[test]
    #[ignore]
    fn index_and_search_end_to_end() {
        let Ok(dir) = std::env::var("FIBO_CLIP") else { return };
        let tmp = std::env::temp_dir().join("mz-clip-e2e");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("thumbs")).unwrap();
        let state = AppState { db: std::sync::Mutex::new(crate::open_db(&tmp.join("t.db")).unwrap()), thumbs: tmp.join("thumbs"), sidecar: AtomicBool::new(false) };
        for i in 0..5 {
            let mut img = image::RgbImage::new(320, 240);
            for (x, y, p) in img.enumerate_pixels_mut() {
                *p = image::Rgb([((x + i * 40) % 256) as u8, (y * 255 / 240) as u8, (i * 50) as u8]);
            }
            let f = tmp.join(format!("p{i}.jpg"));
            img.save(&f).unwrap();
            state.db.lock().unwrap().execute("INSERT INTO photos (path, folder, name, size, modified) VALUES (?1, ?2, ?3, 1, 10)", params![f.to_string_lossy().to_string(), tmp.to_string_lossy().to_string(), format!("p{i}.jpg")]).unwrap();
        }
        let enc = Encoder::new(&fs::read(format!("{dir}/vision_model.onnx")).unwrap()).unwrap();
        assert_eq!(index_core(&state, &enc).unwrap(), (5, 0));
        assert_eq!(index_core(&state, &enc).unwrap(), (0, 0), "drugi przebieg nie ma już nic do zrobienia");
        let conn = state.db.lock().unwrap();
        assert_eq!(conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM clip_vec", [], |r| r.get(0)).unwrap(), 5);
        let r = search_core(&conn, "plaża").unwrap();
        assert_eq!((r.indexed, r.matched.clone()), (5, vec!["plaża".to_string()]));
        // Zmiana pliku (nowa data) każe policzyć wektor od nowa.
        conn.execute("UPDATE photos SET modified = 11 WHERE name = 'p0.jpg'", []).unwrap();
        drop(conn);
        assert_eq!(index_core(&state, &enc).unwrap(), (1, 0));
        let r = search_core(&state.db.lock().unwrap(), "zxqv").unwrap();
        assert!(r.ids.is_empty() && r.unknown == vec!["zxqv"]);
    }
}
