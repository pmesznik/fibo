//! Szukanie tekstu na zdjęciach (paragony, tablice, dokumenty, napisy), w całości na tym komputerze.
//!
//! Dwa małe modele PaddleOCR (PP-OCRv5, licencja Apache-2.0) uruchamiane silnikiem `tract`, dołączone do instalatora:
//! detektor tekstu (znajduje linie napisów) i rozpoznawacz alfabetu łacińskiego (zna polskie znaki). Rozpoznany tekst trafia do biblioteki
//! i jest przeszukiwany lokalnie, bez uwzględniania wielkości liter i polskich znaków. Moduł nie ma kodu sieciowego.

use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, OnceLock,
    },
};

use image::{imageops::FilterType, DynamicImage, RgbImage};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use tract_onnx::prelude::*;

use crate::clip::fold;
use crate::{formats, jobs, AppState};

const DET_SHA256: &str = "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d";
const REC_SHA256: &str = "7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498";
const DICT: &str = include_str!("../data/ocr_dict.txt");

/// Bok kwadratowego wejścia detektora (dłuższy bok zdjęcia jest zmniejszany do tego rozmiaru, mniejsze zdjęcia zostają bez zmiany).
const DET_SIDE: usize = 960;
/// Wysokość i dopuszczalne szerokości wejścia rozpoznawacza (linia tekstu jest skalowana do wysokości 48 px, a szerokość dobijana do najbliższej wartości).
const REC_H: usize = 48;
const REC_WIDTHS: [usize; 4] = [160, 320, 640, 1280];
const DET_THRESH: f32 = 0.3;
const BOX_THRESH: f32 = 0.6;
const UNCLIP: f32 = 1.5;
const MIN_REC_CONF: f32 = 0.5;
const MAX_BOXES: usize = 120;
/// Większe zdjęcia są przed analizą zmniejszane (oszczędza pamięć).
const MAX_INPUT_SIDE: u32 = 3000;

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ocr_text (photo_id INTEGER PRIMARY KEY, modified INTEGER NOT NULL, text TEXT NOT NULL, fold TEXT NOT NULL);")
}

type Plan = Arc<TypedRunnableModel>;

fn load_plan(bytes: &[u8], shape: &[usize]) -> TractResult<Plan> {
    let mut model = tract_onnx::onnx().model_for_read(&mut std::io::Cursor::new(bytes))?;
    // Model zapisuje rozmiary warstw pośrednich dla jednego rozmiaru wejścia; czyścimy je, żeby można było użyć innego.
    let outlets: Vec<OutletId> = model.nodes().iter().flat_map(|n| (0..n.outputs.len()).map(move |o| OutletId::new(n.id, o))).collect();
    for o in outlets {
        model.set_outlet_fact(o, InferenceFact::default())?;
    }
    model.with_input_fact(0, f32::fact(shape).into())?.into_optimized()?.into_runnable()
}

fn dictionary() -> &'static Vec<String> {
    static D: OnceLock<Vec<String>> = OnceLock::new();
    D.get_or_init(|| DICT.lines().map(|l| l.to_string()).collect())
}

pub struct Engine {
    det: Plan,
    recs: Vec<(usize, Plan)>,
}

/// Prostokąt tekstu w pikselach zdjęcia.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextBox {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

impl Engine {
    pub fn new(det: &[u8], rec: &[u8]) -> Result<Engine, String> {
        let det = load_plan(det, &[1, 3, DET_SIDE, DET_SIDE]).map_err(|e| format!("model wykrywania tekstu: {e}"))?;
        let recs = REC_WIDTHS
            .iter()
            .map(|&w| load_plan(rec, &[1, 3, REC_H, w]).map(|p| (w, p)).map_err(|e| format!("model rozpoznawania tekstu: {e}")))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Engine { det, recs })
    }

    /// Znajduje linie tekstu: prostokąty w pikselach `img`, w kolejności czytania.
    pub fn detect(&self, img: &RgbImage) -> Result<Vec<TextBox>, String> {
        let (iw, ih) = img.dimensions();
        if iw < 16 || ih < 16 {
            return Ok(vec![]);
        }
        let scale = (DET_SIDE as f32 / iw.max(ih) as f32).min(1.0);
        let (nw, nh) = (((iw as f32 * scale).round() as usize).clamp(1, DET_SIDE), ((ih as f32 * scale).round() as usize).clamp(1, DET_SIDE));
        let small = if scale < 1.0 { image::imageops::resize(img, nw as u32, nh as u32, FilterType::Triangle) } else { img.clone() };
        // Normalizacja jak w PaddleOCR (kolejność kanałów BGR, średnia i odchylenie ImageNet); tło poza zdjęciem to wartość średnia (0 po normalizacji).
        let (mean, std) = ([0.485f32, 0.456, 0.406], [0.229f32, 0.224, 0.225]);
        let mut input = tract_ndarray::Array4::<f32>::zeros((1, 3, DET_SIDE, DET_SIDE));
        for (x, y, p) in small.enumerate_pixels() {
            for c in 0..3 {
                input[[0, c, y as usize, x as usize]] = (p.0[2 - c] as f32 / 255.0 - mean[c]) / std[c];
            }
        }
        let out = self.det.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
        let prob = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
        let flat: Vec<f32> = prob.iter().copied().collect();
        if flat.len() != DET_SIDE * DET_SIDE {
            return Err(format!("nieoczekiwany rozmiar mapy tekstu: {}", flat.len()));
        }
        let boxes = boxes_from_map(&flat, DET_SIDE, nw, nh);
        let inv = 1.0 / scale;
        let mut out: Vec<TextBox> = boxes
            .into_iter()
            .map(|b| TextBox { x0: (b.x0 * inv).max(0.0), y0: (b.y0 * inv).max(0.0), x1: (b.x1 * inv).min(iw as f32), y1: (b.y1 * inv).min(ih as f32) })
            .filter(|b| b.x1 - b.x0 >= 6.0 && b.y1 - b.y0 >= 6.0)
            .collect();
        out.truncate(MAX_BOXES);
        Ok(reading_order(out))
    }

    /// Rozpoznaje jedną linię tekstu: (tekst, średnia pewność).
    pub fn recognize(&self, img: &RgbImage, b: &TextBox) -> Result<(String, f32), String> {
        let (x0, y0) = (b.x0.floor().max(0.0) as u32, b.y0.floor().max(0.0) as u32);
        let (w, h) = (((b.x1 - b.x0).ceil() as u32).min(img.width().saturating_sub(x0)).max(1), ((b.y1 - b.y0).ceil() as u32).min(img.height().saturating_sub(y0)).max(1));
        let crop = image::imageops::crop_imm(img, x0, y0, w, h).to_image();
        let ratio = w as f32 / h as f32;
        let want = ((REC_H as f32 * ratio).ceil() as usize).max(8);
        let widest = *REC_WIDTHS.last().unwrap();
        let (bucket, plan) = self.recs.iter().find(|(bw, _)| *bw >= want).unwrap_or_else(|| self.recs.last().unwrap());
        let tw = want.min(*bucket).min(widest);
        let resized = image::imageops::resize(&crop, tw as u32, REC_H as u32, FilterType::Triangle);
        let mut input = tract_ndarray::Array4::<f32>::zeros((1, 3, REC_H, *bucket));
        for (x, y, p) in resized.enumerate_pixels() {
            for c in 0..3 {
                input[[0, c, y as usize, x as usize]] = (p.0[2 - c] as f32 / 255.0 - 0.5) / 0.5;
            }
        }
        let out = plan.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
        let view = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
        let shape = view.shape().to_vec();
        let (t, c) = (shape[shape.len() - 2], shape[shape.len() - 1]);
        let flat: Vec<f32> = view.iter().copied().collect();
        // Cięcie po szerokości: ogon dopełnienia nie niesie tekstu, więc dekodujemy tylko kroki odpowiadające szerokości linii.
        let steps = ((t as f32) * (tw as f32 / *bucket as f32)).ceil() as usize;
        Ok(ctc_decode(&flat, steps.clamp(1, t), c, dictionary()))
    }

    /// Cały tekst zdjęcia: linie w kolejności czytania, oddzielone znakiem nowego wiersza.
    pub fn read(&self, img: &RgbImage) -> Result<String, String> {
        let mut lines: Vec<(TextBox, String)> = Vec::new();
        for b in self.detect(img)? {
            let (text, conf) = self.recognize(img, &b)?;
            if conf >= MIN_REC_CONF && text.chars().any(|c| c.is_alphanumeric()) {
                lines.push((b, text));
            }
        }
        Ok(join_lines(&lines))
    }
}

/// Składanie linii: pola z tej samej wysokości (kolejne słowa jednego wiersza) łączymy spacją, a wiersze nowym wierszem.
fn join_lines(lines: &[(TextBox, String)]) -> String {
    let mut out = String::new();
    let mut prev: Option<&TextBox> = None;
    for (b, t) in lines {
        if let Some(p) = prev {
            let overlap = (p.y1.min(b.y1) - p.y0.max(b.y0)).max(0.0) / (b.y1 - b.y0).min(p.y1 - p.y0).max(1.0);
            out.push(if overlap > 0.5 { ' ' } else { '\n' });
        }
        out.push_str(t);
        prev = Some(b);
    }
    out
}

/// Zamiana mapy prawdopodobieństwa na prostokąty: składowe spójne pikseli powyżej progu, odfiltrowane po średniej pewności i rozszerzone (unclip),
/// bo detektor zaznacza tylko skurczone jądro tekstu. `valid_w` i `valid_h` to obszar mapy zajęty przez zdjęcie (reszta to tło).
pub fn boxes_from_map(map: &[f32], side: usize, valid_w: usize, valid_h: usize) -> Vec<TextBox> {
    let mut seen = vec![false; side * side];
    let mut out = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for sy in 0..valid_h {
        for sx in 0..valid_w {
            let s = sy * side + sx;
            if seen[s] || map[s] <= DET_THRESH {
                continue;
            }
            let (mut x0, mut y0, mut x1, mut y1) = (sx, sy, sx, sy);
            let (mut sum, mut n) = (0f64, 0u32);
            stack.clear();
            stack.push(s);
            seen[s] = true;
            while let Some(i) = stack.pop() {
                let (x, y) = (i % side, i / side);
                x0 = x0.min(x);
                x1 = x1.max(x);
                y0 = y0.min(y);
                y1 = y1.max(y);
                sum += map[i] as f64;
                n += 1;
                for (dx, dy) in [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx < 0 || ny < 0 || nx as usize >= valid_w || ny as usize >= valid_h {
                        continue;
                    }
                    let j = ny as usize * side + nx as usize;
                    if !seen[j] && map[j] > DET_THRESH {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
            if n < 12 || (sum / n as f64) < BOX_THRESH as f64 {
                continue;
            }
            let (w, h) = ((x1 - x0 + 1) as f32, (y1 - y0 + 1) as f32);
            let d = w * h * UNCLIP / (2.0 * (w + h));
            out.push(TextBox { x0: x0 as f32 - d, y0: y0 as f32 - d, x1: x1 as f32 + 1.0 + d, y1: y1 as f32 + 1.0 + d });
        }
    }
    out
}

/// Kolejność czytania: wiersze od góry do dołu (pola nakrywające się w pionie w ponad połowie tworzą jeden wiersz), w wierszu od lewej do prawej.
pub fn reading_order(mut boxes: Vec<TextBox>) -> Vec<TextBox> {
    boxes.sort_by(|a, b| a.y0.total_cmp(&b.y0));
    let mut rows: Vec<Vec<TextBox>> = Vec::new();
    for b in boxes {
        let hit = rows.iter_mut().find(|r| {
            let (ry0, ry1) = (r.iter().map(|x| x.y0).fold(f32::MAX, f32::min), r.iter().map(|x| x.y1).fold(f32::MIN, f32::max));
            (ry1.min(b.y1) - ry0.max(b.y0)).max(0.0) / (b.y1 - b.y0).min(ry1 - ry0).max(1.0) > 0.5
        });
        match hit {
            Some(r) => r.push(b),
            None => rows.push(vec![b]),
        }
    }
    rows.sort_by(|a, b| a.iter().map(|x| x.y0).fold(f32::MAX, f32::min).total_cmp(&b.iter().map(|x| x.y0).fold(f32::MAX, f32::min)));
    rows.into_iter()
        .flat_map(|mut r| {
            r.sort_by(|a, b| a.x0.total_cmp(&b.x0));
            r
        })
        .collect()
}

/// Dekodowanie CTC (zachłanne): kolejne najlepsze klasy bez powtórzeń i bez pustego znaku (klasa 0). Klasy 1..=N to znaki słownika, a klasa po nich to spacja.
/// Zwraca tekst i średnie prawdopodobieństwo wybranych znaków (gdy wyjście to logity, a nie prawdopodobieństwa, pewność wynosi 1).
pub fn ctc_decode(flat: &[f32], steps: usize, classes: usize, dict: &[String]) -> (String, f32) {
    let mut text = String::new();
    let (mut last, mut conf_sum, mut conf_n) = (0usize, 0f32, 0u32);
    for t in 0..steps {
        let row = &flat[t * classes..(t + 1) * classes];
        let (best, p) = row.iter().enumerate().fold((0usize, f32::MIN), |a, (i, v)| if *v > a.1 { (i, *v) } else { a });
        if best != 0 && best != last {
            match dict.get(best - 1) {
                Some(c) => text.push_str(c),
                None => text.push(' '),
            }
            if (0.0..=1.0).contains(&p) {
                conf_sum += p;
                conf_n += 1;
            }
        }
        last = best;
    }
    let conf = if conf_n > 0 { conf_sum / conf_n as f32 } else { 1.0 };
    (text.trim().to_string(), conf)
}

fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn read_model(app: &tauri::AppHandle, name: &str) -> Option<Vec<u8>> {
    let mut candidates = Vec::new();
    if let Ok(p) = app.path().resolve(format!("models/{name}"), tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join(name));
    candidates.iter().find_map(|c| fs::read(c).ok())
}

fn load_engine(app: &tauri::AppHandle) -> Result<Engine, String> {
    let det = read_model(app, "ocr_det.onnx").ok_or("Brak modelu wykrywania tekstu w programie")?;
    let rec = read_model(app, "ocr_rec.onnx").ok_or("Brak modelu rozpoznawania tekstu w programie")?;
    if sha256_hex(&det) != DET_SHA256 || sha256_hex(&rec) != REC_SHA256 {
        return Err("Modele rozpoznawania tekstu mają niewłaściwą sumę kontrolną, nie używam ich".into());
    }
    Engine::new(&det, &rec)
}

fn models_present(app: &tauri::AppHandle) -> bool {
    ["ocr_det.onnx", "ocr_rec.onnx"].iter().all(|n| {
        app.path().resolve(format!("models/{n}"), tauri::path::BaseDirectory::Resource).map(|p| p.exists()).unwrap_or(false) || Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join(n).exists()
    })
}

/// Zdjęcie do rozpoznawania: oryginał (miniatura ma za małą rozdzielczość na drobny tekst), zmniejszony do rozsądnego rozmiaru.
fn load_for_ocr(path: &str) -> Option<RgbImage> {
    let (img, orientation) = formats::open_preview(Path::new(path)).ok()?;
    let img: DynamicImage = formats::orient(img, orientation);
    let (w, h) = (img.width(), img.height());
    let img = if w.max(h) > MAX_INPUT_SIDE { img.resize(MAX_INPUT_SIDE, MAX_INPUT_SIDE, FilterType::Triangle) } else { img };
    Some(img.to_rgb8())
}

// ---------------------------------------------------------------------------------------------------------------------
// Polecenia.

#[derive(Serialize)]
pub struct OcrStatus {
    models_ok: bool,
    running: bool,
    indexed: i64,
    total: i64,
}

#[tauri::command]
pub fn ocr_status(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<OcrStatus, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM photos WHERE hidden = 0 AND video = 0", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let indexed: i64 = conn
        .query_row("SELECT COUNT(*) FROM ocr_text o JOIN photos p ON p.id = o.photo_id WHERE p.hidden = 0 AND p.video = 0 AND o.modified = p.modified", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(OcrStatus { models_ok: models_present(&app), running: BUSY.load(Ordering::SeqCst), indexed, total })
}

#[tauri::command]
pub fn ocr_stop() {
    CANCEL.store(true, Ordering::SeqCst);
}

fn worker_count() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).div_ceil(3).clamp(1, 3)
}

fn index_blocking(app: &tauri::AppHandle) -> Result<(usize, usize), String> {
    let _job = jobs::Guard::new("ocr");
    let state = app.state::<AppState>();
    let todo: Vec<(i64, String, i64)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.path, p.modified FROM photos p LEFT JOIN ocr_text o ON o.photo_id = p.id
                 WHERE p.hidden = 0 AND p.video = 0 AND (o.photo_id IS NULL OR o.modified != p.modified) ORDER BY p.id",
            )
            .map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    if todo.is_empty() {
        return Ok((0, 0));
    }
    let engine = load_engine(app)?;
    let total = todo.len();
    let next = AtomicUsize::new(0);
    let (tx, rx) = std::sync::mpsc::channel::<(usize, Option<String>)>();
    let (mut done, mut stored, mut skipped) = (0usize, 0usize, 0usize);
    std::thread::scope(|scope| {
        for _ in 0..worker_count().min(total) {
            let (tx, todo, next, engine) = (tx.clone(), &todo, &next, &engine);
            scope.spawn(move || loop {
                if CANCEL.load(Ordering::SeqCst) {
                    break;
                }
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= todo.len() {
                    break;
                }
                let text = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| load_for_ocr(&todo[i].1).and_then(|img| engine.read(&img).ok()))).unwrap_or(None);
                if tx.send((i, text)).is_err() {
                    break;
                }
            });
        }
        drop(tx);
        for (i, text) in rx.iter() {
            if CANCEL.load(Ordering::SeqCst) {
                continue;
            }
            let (id, _, modified) = &todo[i];
            match text {
                Some(t) => {
                    if let Ok(conn) = state.db.lock() {
                        let _ = conn.execute("INSERT OR REPLACE INTO ocr_text (photo_id, modified, text, fold) VALUES (?1, ?2, ?3, ?4)", params![id, modified, t, fold(&t)]);
                        stored += 1;
                    }
                }
                None => skipped += 1,
            }
            done += 1;
            jobs::tick("ocr", done, total);
        }
    });
    Ok((stored, skipped))
}

#[derive(Serialize, Default, Clone)]
pub struct OcrDone {
    stored: usize,
    skipped: usize,
    stopped: bool,
    error: Option<String>,
}

/// Uruchamia rozpoznawanie tekstu w tle (tylko na życzenie użytkownika). Zwraca false, gdy już trwa.
#[tauri::command]
pub fn ocr_start(app: tauri::AppHandle) -> Result<bool, String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    CANCEL.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| index_blocking(&app))).unwrap_or_else(|_| Err("Wewnętrzny błąd rozpoznawania tekstu. Dotychczasowe dane są bezpieczne.".into()));
        BUSY.store(false, Ordering::SeqCst);
        let fin = match result {
            Ok((stored, skipped)) => OcrDone { stored, skipped, stopped: CANCEL.load(Ordering::SeqCst), error: None },
            Err(e) => OcrDone { error: Some(e), ..Default::default() },
        };
        let _ = tauri::Emitter::emit(&app, "ocr-done", fin);
    });
    Ok(true)
}

#[derive(Serialize, Default)]
pub struct OcrHits {
    ids: Vec<i64>,
    /// Fragment tekstu z trafieniem (po jednym na zdjęcie, w tej samej kolejności co `ids`).
    snippets: Vec<String>,
    indexed: i64,
}

/// Zdjęcia, na których jest podany tekst. Każde słowo zapytania musi wystąpić (bez względu na wielkość liter i polskie znaki, także jako fragment słowa).
pub fn search_core(conn: &Connection, query: &str) -> Result<OcrHits, String> {
    if query.chars().count() > 200 {
        return Err("Zapytanie jest za długie".into());
    }
    let words: Vec<String> = fold(query).split_whitespace().map(str::to_string).take(8).collect();
    let mut hits = OcrHits::default();
    let mut stmt = conn
        .prepare("SELECT o.photo_id, o.text, o.fold FROM ocr_text o JOIN photos p ON p.id = o.photo_id WHERE p.hidden = 0 AND p.video = 0 AND o.modified = p.modified ORDER BY p.id")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        hits.indexed += 1;
        if words.is_empty() || !words.iter().all(|w| row.2.contains(w.as_str())) {
            continue;
        }
        hits.ids.push(row.0);
        hits.snippets.push(snippet(&row.1, &row.2, &words[0]));
    }
    if words.is_empty() {
        hits.ids.clear();
        hits.snippets.clear();
    }
    Ok(hits)
}

/// Fragment wokół pierwszego trafienia (kilkadziesiąt znaków). Tekst i jego wersja bez polskich znaków mają tę samą liczbę znaków, więc pozycje się zgadzają.
fn snippet(text: &str, folded: &str, word: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let fchars: Vec<char> = folded.chars().collect();
    let w: Vec<char> = word.chars().collect();
    let pos = if chars.len() == fchars.len() { fchars.windows(w.len().max(1)).position(|win| win == w.as_slice()) } else { None }.unwrap_or(0);
    let start = pos.saturating_sub(24);
    let end = (pos + w.len() + 40).min(chars.len());
    let s: String = chars[start..end].iter().map(|c| if *c == '\n' { ' ' } else { *c }).collect();
    format!("{}{}{}", if start > 0 { "…" } else { "" }, s.trim(), if end < chars.len() { "…" } else { "" })
}

#[tauri::command]
pub fn ocr_search(state: State<'_, AppState>, query: String) -> Result<OcrHits, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    search_core(&conn, &query)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dict3() -> Vec<String> {
        ["a", "b", "ł"].iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn dictionary_has_polish_letters_and_the_expected_size() {
        let d = dictionary();
        assert_eq!(d.len(), 836);
        for c in "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ".chars() {
            assert!(d.iter().any(|x| x == &c.to_string()), "brak {c}");
        }
    }

    #[test]
    fn ctc_collapses_repeats_and_blanks() {
        // 3 znaki + puste + spacja (klasa po słowniku): klasy 0 puste, 1 a, 2 b, 3 ł, 4 spacja.
        let one = |i: usize| -> Vec<f32> { let mut v = vec![0.0; 5]; v[i] = 0.9; v };
        let seq = [1, 1, 0, 1, 2, 2, 4, 3, 0, 3];
        let flat: Vec<f32> = seq.iter().flat_map(|&i| one(i)).collect();
        let (text, conf) = ctc_decode(&flat, seq.len(), 5, &dict3());
        assert_eq!(text, "aab łł");
        assert!((conf - 0.9).abs() < 1e-5);
    }

    #[test]
    fn components_become_expanded_boxes_and_weak_ones_are_dropped() {
        let side = 64;
        let mut map = vec![0.0f32; side * side];
        for y in 10..18 {
            for x in 8..40 {
                map[y * side + x] = 0.9; // linia tekstu
            }
        }
        for y in 40..48 {
            for x in 8..40 {
                map[y * side + x] = 0.4; // słabe trafienie poniżej BOX_THRESH
            }
        }
        map[60 * side + 60] = 0.95; // pojedynczy piksel to szum
        let boxes = boxes_from_map(&map, side, side, side);
        assert_eq!(boxes.len(), 1);
        let b = boxes[0];
        assert!(b.x0 < 8.0 && b.x1 > 40.0 && b.y0 < 10.0 && b.y1 > 18.0, "pole jest rozszerzone wokół jądra: {b:?}");
    }

    #[test]
    fn reading_order_groups_rows_and_sorts_left_to_right() {
        let bx = |x0: f32, y0: f32, x1: f32, y1: f32| TextBox { x0, y0, x1, y1 };
        let ordered = reading_order(vec![bx(100.0, 52.0, 160.0, 72.0), bx(10.0, 100.0, 90.0, 120.0), bx(10.0, 50.0, 80.0, 70.0), bx(10.0, 0.0, 90.0, 20.0)]);
        assert_eq!(ordered.iter().map(|b| (b.x0 as i32, b.y0 as i32)).collect::<Vec<_>>(), vec![(10, 0), (10, 50), (100, 52), (10, 100)]);
        let lines: Vec<(TextBox, String)> = ordered.iter().zip(["jeden", "dwa", "trzy", "cztery"]).map(|(b, t)| (*b, t.to_string())).collect();
        assert_eq!(join_lines(&lines), "jeden\ndwa trzy\ncztery");
    }

    #[test]
    fn search_ignores_case_and_polish_letters_needs_all_words_and_shows_a_snippet() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE photos (id INTEGER PRIMARY KEY, hidden INTEGER DEFAULT 0, video INTEGER DEFAULT 0, modified INTEGER DEFAULT 5);").unwrap();
        init_schema(&c).unwrap();
        c.execute_batch("INSERT INTO photos (id) VALUES (1), (2), (3);").unwrap();
        for (id, text) in [(1, "Sklep Łódź\nParagon 12,50 zł"), (2, "Zażółć gęślą jaźń"), (3, "inne rzeczy")] {
            c.execute("INSERT INTO ocr_text (photo_id, modified, text, fold) VALUES (?1, 5, ?2, ?3)", params![id, text, fold(text)]).unwrap();
        }
        let r = search_core(&c, "LODZ paragon").unwrap();
        assert_eq!(r.ids, vec![1]);
        assert!(r.snippets[0].contains("Łódź"));
        assert_eq!(search_core(&c, "zazolc").unwrap().ids, vec![2]);
        assert_eq!(search_core(&c, "lodz banan").unwrap().ids, Vec::<i64>::new(), "każde słowo musi wystąpić");
        assert_eq!(search_core(&c, "  ").unwrap().ids.len(), 0);
        assert_eq!(search_core(&c, "rzecz").unwrap().indexed, 3);
        // Nieaktualny tekst (zdjęcie zmienione po rozpoznaniu) jest pomijany.
        c.execute("UPDATE photos SET modified = 6 WHERE id = 1", []).unwrap();
        assert!(search_core(&c, "paragon").unwrap().ids.is_empty());
    }

    /// Z prawdziwymi modelami: obraz z polskim tekstem musi zostać przeczytany. Bez pobranych modeli (lokalnie) test jest pomijany, a w CI modele są pobierane.
    #[test]
    fn real_models_read_a_polish_sample() {
        let models = Path::new(env!("CARGO_MANIFEST_DIR")).join("models");
        if !models.join("ocr_det.onnx").exists() || !models.join("ocr_rec.onnx").exists() {
            eprintln!("brak modeli OCR, pomijam");
            return;
        }
        let (det, rec) = (fs::read(models.join("ocr_det.onnx")).unwrap(), fs::read(models.join("ocr_rec.onnx")).unwrap());
        assert_eq!(sha256_hex(&det), DET_SHA256);
        assert_eq!(sha256_hex(&rec), REC_SHA256);
        let engine = Engine::new(&det, &rec).unwrap();
        let img = image::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("data").join("ocr_sample.png")).unwrap().to_rgb8();
        let t0 = std::time::Instant::now();
        let text = engine.read(&img).unwrap();
        eprintln!("OCR {:?}:\n{text}", t0.elapsed());
        let f = fold(&text);
        for want in ["paragon", "fiskalny", "zazolc", "gesla", "jazn", "12,50", "sklep", "lodz", "sloneczna", "2026-10-31", "dziekujemy"] {
            assert!(f.contains(want), "brak „{want}” w: {text}");
        }
    }
}
