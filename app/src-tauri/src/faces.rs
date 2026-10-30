//! Rozpoznawanie twarzy w całości na komputerze użytkownika.
//!
//! Ten moduł celowo nie ma nic wspólnego z siecią: liczy detekcję (YuNet) i wektory twarzy (SFace)
//! silnikiem `tract` (czysty Rust), na modelach dołączonych do instalatora. Testy bezpieczeństwa pilnują,
//! żeby tu nie pojawiły się żadne odwołania do sieci ani pobieranie plików.

use image::{imageops::FilterType, RgbImage};
use tract_onnx::prelude::*;

type Plan = std::sync::Arc<TypedRunnableModel>;

/// Dłuższy bok wejścia detektora (zdjęcie jest skalowane z zachowaniem proporcji). Większe wejście znajduje mniejsze twarze,
/// ale kosztuje więcej czasu; YuNet jest siecią w pełni splotową, więc może pracować na dowolnym rozmiarze podzielnym przez 32.
pub const DEFAULT_BASE: usize = 1280;
const STRIDES: [usize; 3] = [8, 16, 32];
const NMS_IOU: f32 = 0.3;
/// Rozmiar twarzy po wyrównaniu, wymagany przez SFace.
const ALIGN: usize = 112;
/// Wzorcowe położenie oczu, nosa i kącików ust po wyrównaniu (układ ArcFace dla 112x112).
const REF_POINTS: [(f32, f32); 5] = [(38.2946, 51.6963), (73.5318, 51.5014), (56.0252, 71.7366), (41.5493, 92.3655), (70.7299, 92.2041)];
pub const EMB_LEN: usize = 128;

pub struct Detection {
    /// Prostokąt twarzy w pikselach zdjęcia.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub score: f32,
    /// Prawe oko, lewe oko, nos, prawy i lewy kącik ust (w pikselach zdjęcia).
    pub lm: [(f32, f32); 5],
}

/// Detektor na ustalonym kształcie wejścia (h x w).
struct DetPlan {
    plan: Plan,
    h: usize,
    w: usize,
}

pub struct Engine {
    /// Dwa kształty (poziomy 4:3 i pionowy 3:4), żeby nie liczyć pustych pasów kwadratowego wejścia.
    dets: [DetPlan; 2],
    embedder: Plan,
}

fn load(bytes: &[u8], shape: &[usize]) -> TractResult<Plan> {
    let mut model = tract_onnx::onnx().model_for_read(&mut std::io::Cursor::new(bytes))?;
    // Model zapisuje rozmiary warstw pośrednich dla jednego rozmiaru wejścia; czyścimy je, żeby można było użyć innego (np. prostokątnego).
    let outlets: Vec<OutletId> = model.nodes().iter().flat_map(|n| (0..n.outputs.len()).map(move |o| OutletId::new(n.id, o))).collect();
    for o in outlets {
        model.set_outlet_fact(o, InferenceFact::default())?;
    }
    model.with_input_fact(0, f32::fact(shape).into())?.into_optimized()?.into_runnable()
}

impl Engine {
    pub fn new(yunet: &[u8], face_model: &[u8]) -> Result<Engine, String> {
        Engine::with_base(yunet, face_model, DEFAULT_BASE)
    }

    /// `base` to dłuższy bok wejścia detektora (np. 640 szybciej, 1280 dokładniej dla małych twarzy).
    pub fn with_base(yunet: &[u8], face_model: &[u8], base: usize) -> Result<Engine, String> {
        let long = base.div_ceil(32) * 32;
        let short = (base * 3 / 4).div_ceil(32) * 32;
        let mk = |h: usize, w: usize| -> Result<DetPlan, String> {
            Ok(DetPlan { plan: load(yunet, &[1, 3, h, w]).map_err(|e| format!("model detekcji: {e}"))?, h, w })
        };
        let embedder = load(face_model, &[1, 3, ALIGN, ALIGN]).map_err(|e| format!("model rozpoznawania: {e}"))?;
        Ok(Engine { dets: [mk(short, long)?, mk(long, short)?], embedder })
    }

    /// Szuka twarzy na zdjęciu. `min_score` to próg pewności (0.0-1.0).
    pub fn detect(&self, img: &RgbImage, min_score: f32) -> Result<Vec<Detection>, String> {
        let (iw, ih) = img.dimensions();
        if iw < 16 || ih < 16 {
            return Ok(vec![]);
        }
        let dp = if ih > iw { &self.dets[1] } else { &self.dets[0] };
        let (dw, dh) = (dp.w, dp.h);
        let scale = (dw as f32 / iw as f32).min(dh as f32 / ih as f32);
        let (nw, nh) = (((iw as f32 * scale).round() as u32).clamp(1, dw as u32), ((ih as f32 * scale).round() as u32).clamp(1, dh as u32));
        let small = if (nw, nh) == (iw, ih) { img.clone() } else { image::imageops::resize(img, nw, nh, FilterType::Triangle) };
        // YuNet oczekuje kolejności BGR i wartości 0-255, tło poza zdjęciem jest czarne.
        let plane = dw * dh;
        let mut data = vec![0f32; 3 * plane];
        for (x, y, p) in small.enumerate_pixels() {
            let i = y as usize * dw + x as usize;
            data[i] = p[2] as f32;
            data[plane + i] = p[1] as f32;
            data[2 * plane + i] = p[0] as f32;
        }
        let input = tract_ndarray::Array4::<f32>::from_shape_vec((1, 3, dh, dw), data).map_err(|e| e.to_string())?;
        let out = dp.plan.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
        if out.len() != 12 {
            return Err(format!("nieoczekiwana liczba wyjść detektora: {}", out.len()));
        }
        let get = |i: usize| -> Result<Vec<f32>, String> {
            Ok(out[i].to_plain_array_view::<f32>().map_err(|e| e.to_string())?.iter().copied().collect())
        };
        let mut found: Vec<Detection> = Vec::new();
        for (k, &s) in STRIDES.iter().enumerate() {
            let (cols, rows) = (dw / s, dh / s);
            let cells = cols * rows;
            let (cls, obj, bbox, kps) = (get(k)?, get(3 + k)?, get(6 + k)?, get(9 + k)?);
            if cls.len() != cells || bbox.len() != cells * 4 || kps.len() != cells * 10 {
                return Err("nieoczekiwany kształt wyjść detektora".into());
            }
            for idx in 0..cells {
                let score = (cls[idx].clamp(0.0, 1.0) * obj[idx].clamp(0.0, 1.0)).sqrt();
                if score < min_score {
                    continue;
                }
                let (r, c) = ((idx / cols) as f32, (idx % cols) as f32);
                let sf = s as f32;
                let cx = (c + bbox[idx * 4]) * sf;
                let cy = (r + bbox[idx * 4 + 1]) * sf;
                let w = bbox[idx * 4 + 2].exp() * sf;
                let h = bbox[idx * 4 + 3].exp() * sf;
                let mut lm = [(0.0, 0.0); 5];
                for (n, p) in lm.iter_mut().enumerate() {
                    *p = (((kps[idx * 10 + 2 * n] + c) * sf) / scale, ((kps[idx * 10 + 2 * n + 1] + r) * sf) / scale);
                }
                found.push(Detection { x: (cx - w / 2.0) / scale, y: (cy - h / 2.0) / scale, w: w / scale, h: h / scale, score, lm });
            }
        }
        Ok(nms(found))
    }

    /// Wektor (128 liczb, długość 1) opisujący twarz: wyrównuje twarz po punktach charakterystycznych i liczy cechy.
    pub fn embed(&self, img: &RgbImage, d: &Detection) -> Result<Vec<f32>, String> {
        self.embed_aligned(&align(img, &d.lm))
    }

    /// Wektor odporny na kierunek twarzy: średnia z wektora twarzy i jej odbicia lustrzanego (znormalizowana).
    /// Poprawia dokładność, bo twarze są prawie symetryczne, a szum modelu się uśrednia.
    pub fn embed_tta(&self, aligned: &RgbImage) -> Result<Vec<f32>, String> {
        let a = self.embed_aligned(aligned)?;
        let b = self.embed_aligned(&image::imageops::flip_horizontal(aligned))?;
        let mut v: Vec<f32> = a.iter().zip(&b).map(|(x, y)| x + y).collect();
        normalize(&mut v);
        Ok(v)
    }

    /// Wektor z już wyrównanej twarzy 112x112 (RGB).
    pub fn embed_aligned(&self, aligned: &RgbImage) -> Result<Vec<f32>, String> {
        let mut input = tract_ndarray::Array4::<f32>::zeros((1, 3, ALIGN, ALIGN));
        for (x, y, p) in aligned.enumerate_pixels() {
            for ch in 0..3 {
                input[[0, ch, y as usize, x as usize]] = p[ch] as f32; // RGB, 0-255
            }
        }
        let out = self.embedder.run(tvec!(Tensor::from(input).into())).map_err(|e| e.to_string())?;
        let mut v: Vec<f32> = out[0].to_plain_array_view::<f32>().map_err(|e| e.to_string())?.iter().copied().collect();
        if v.len() != EMB_LEN {
            return Err(format!("nieoczekiwana długość wektora twarzy: {}", v.len()));
        }
        normalize(&mut v);
        Ok(v)
    }
}

/// Ocena jakości twarzy 0.0-1.0 (do decyzji, czy twarz może zakładać osobę i zasilać grupę):
/// pewność detektora, rozmiar, ustawienie głowy (en face kontra profil) i ostrość wyrównanej twarzy.
pub fn quality(d: &Detection, aligned: &RgbImage) -> f32 {
    let clamp01 = |v: f32| v.clamp(0.0, 1.0);
    let s_score = clamp01((d.score - 0.6) / 0.35);
    let s_size = clamp01((d.w.min(d.h) - 40.0) / 80.0);
    // Profil: nos daleko od środka między oczami (w jednostkach odległości między oczami).
    let (re, le, nose) = (d.lm[0], d.lm[1], d.lm[2]);
    let eye_dist = ((le.0 - re.0).powi(2) + (le.1 - re.1).powi(2)).sqrt().max(1.0);
    let yaw = ((nose.0 - (re.0 + le.0) / 2.0).abs() / eye_dist).min(2.0);
    let s_pose = clamp01(1.0 - yaw / 0.55);
    let s_sharp = clamp01(sharpness(aligned) / 120.0);
    0.2 * s_score + 0.3 * s_size + 0.3 * s_pose + 0.2 * s_sharp
}

/// Ostrość obrazu jako wariancja laplasjanu jasności (im większa, tym ostrzejszy obraz).
pub fn sharpness(img: &RgbImage) -> f32 {
    let (w, h) = img.dimensions();
    if w < 3 || h < 3 {
        return 0.0;
    }
    let l = |x: u32, y: u32| { let p = img.get_pixel(x, y); 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32 };
    let (mut sum, mut sum2, mut n) = (0.0f64, 0.0f64, 0.0f64);
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let v = (4.0 * l(x, y) - l(x - 1, y) - l(x + 1, y) - l(x, y - 1) - l(x, y + 1)) as f64;
            sum += v;
            sum2 += v * v;
            n += 1.0;
        }
    }
    ((sum2 / n) - (sum / n).powi(2)) as f32
}

pub fn normalize(v: &mut [f32]) {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 1e-9 {
        v.iter_mut().for_each(|x| *x /= n);
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn iou(a: &Detection, b: &Detection) -> f32 {
    let (x1, y1) = (a.x.max(b.x), a.y.max(b.y));
    let (x2, y2) = ((a.x + a.w).min(b.x + b.w), (a.y + a.h).min(b.y + b.h));
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let union = a.w * a.h + b.w * b.h - inter;
    if union <= 0.0 { 0.0 } else { inter / union }
}

/// Usuwa nakładające się wykrycia tej samej twarzy, zostawiając najpewniejsze; najwyżej 50 twarzy na zdjęcie.
fn nms(mut v: Vec<Detection>) -> Vec<Detection> {
    v.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut keep: Vec<Detection> = Vec::new();
    for d in v {
        if keep.len() >= 50 {
            break;
        }
        if keep.iter().all(|k| iou(k, &d) < NMS_IOU) {
            keep.push(d);
        }
    }
    keep
}

/// Przekształcenie podobieństwa (obrót, skala, przesunięcie) dopasowujące punkty twarzy do wzorca, metodą najmniejszych kwadratów.
fn similarity(src: &[(f32, f32); 5]) -> (f32, f32, f32, f32) {
    let n = 5.0;
    let (msx, msy) = (src.iter().map(|p| p.0).sum::<f32>() / n, src.iter().map(|p| p.1).sum::<f32>() / n);
    let (mdx, mdy) = (REF_POINTS.iter().map(|p| p.0).sum::<f32>() / n, REF_POINTS.iter().map(|p| p.1).sum::<f32>() / n);
    let (mut a, mut b, mut d) = (0.0f32, 0.0f32, 0.0f32);
    for (s, t) in src.iter().zip(REF_POINTS.iter()) {
        let (xs, ys, xd, yd) = (s.0 - msx, s.1 - msy, t.0 - mdx, t.1 - mdy);
        a += xs * xd + ys * yd;
        b += xs * yd - ys * xd;
        d += xs * xs + ys * ys;
    }
    let d = d.max(1e-6);
    let (r, i) = (a / d, b / d);
    (r, i, mdx - (r * msx - i * msy), mdy - (i * msx + r * msy))
}

/// Wycina twarz 112x112 wyrównaną do wzorca (oczy w poziomie, stała skala).
pub fn align(img: &RgbImage, lm: &[(f32, f32); 5]) -> RgbImage {
    let (r, i, tx, ty) = similarity(lm);
    let det = (r * r + i * i).max(1e-9);
    let (w, h) = img.dimensions();
    let mut out = RgbImage::new(ALIGN as u32, ALIGN as u32);
    for v in 0..ALIGN {
        for u in 0..ALIGN {
            // Odwrotność przekształcenia: współrzędne w oryginale dla piksela wyniku.
            let (dx, dy) = (u as f32 - tx, v as f32 - ty);
            let sx = (r * dx + i * dy) / det;
            let sy = (-i * dx + r * dy) / det;
            out.put_pixel(u as u32, v as u32, bilinear(img, sx, sy, w, h));
        }
    }
    out
}

fn bilinear(img: &RgbImage, x: f32, y: f32, w: u32, h: u32) -> image::Rgb<u8> {
    let (x, y) = (x.clamp(0.0, w as f32 - 1.0), y.clamp(0.0, h as f32 - 1.0));
    let (x0, y0) = (x.floor() as u32, y.floor() as u32);
    let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    let mut px = [0u8; 3];
    for (c, o) in px.iter_mut().enumerate() {
        let top = img.get_pixel(x0, y0)[c] as f32 * (1.0 - fx) + img.get_pixel(x1, y0)[c] as f32 * fx;
        let bot = img.get_pixel(x0, y1)[c] as f32 * (1.0 - fx) + img.get_pixel(x1, y1)[c] as f32 * fx;
        *o = (top * (1.0 - fy) + bot * fy).round() as u8;
    }
    image::Rgb(px)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models() -> Option<(Vec<u8>, Vec<u8>)> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("models");
        Some((std::fs::read(dir.join("yunet.onnx")).ok()?, std::fs::read(dir.join("sface.onnx")).ok()?))
    }

    #[test]
    fn similarity_maps_reference_to_itself() {
        let (r, i, tx, ty) = similarity(&REF_POINTS);
        assert!((r - 1.0).abs() < 1e-4 && i.abs() < 1e-4 && tx.abs() < 1e-3 && ty.abs() < 1e-3);
    }

    #[test]
    fn nms_drops_overlaps() {
        let d = |x: f32, s: f32| Detection { x, y: 0.0, w: 10.0, h: 10.0, score: s, lm: [(0.0, 0.0); 5] };
        let k = nms(vec![d(0.0, 0.9), d(1.0, 0.8), d(50.0, 0.7)]);
        assert_eq!(k.len(), 2);
        assert!((k[0].score - 0.9).abs() < 1e-6);
    }

    #[test]
    fn models_load_and_run() {
        let Some((y, s)) = models() else { eprintln!("brak modeli (uruchom: node scripts/fetch-models.mjs)"); return };
        let e = Engine::new(&y, &s).unwrap();
        // Jednolite tło nie ma twarzy.
        let blank = RgbImage::from_pixel(300, 200, image::Rgb([120, 130, 140]));
        assert!(e.detect(&blank, 0.8).unwrap().is_empty());
        let face = Detection { x: 0.0, y: 0.0, w: 100.0, h: 100.0, score: 1.0, lm: [(30.0, 40.0), (70.0, 40.0), (50.0, 60.0), (35.0, 80.0), (65.0, 80.0)] };
        let v = e.embed(&RgbImage::from_pixel(100, 100, image::Rgb([128, 128, 128])), &face).unwrap();
        assert_eq!(v.len(), EMB_LEN);
        assert!((cosine(&v, &v) - 1.0).abs() < 1e-3);
    }

    /// Prawdziwe zdjęcie z twarzą (test uruchamiany, gdy jest plik FIBO_TEST_FACE): wykrycie i stabilność wektora po zmianie rozmiaru.
    #[test]
    fn detects_and_matches_real_face() {
        let (Some((y, s)), Ok(path)) = (models(), std::env::var("FIBO_TEST_FACE")) else { return };
        let e = Engine::new(&y, &s).unwrap();
        let img = image::open(path).unwrap().to_rgb8();
        let dets = e.detect(&img, 0.8).unwrap();
        assert_eq!(dets.len(), 1, "powinna być jedna twarz");
        let a = e.embed(&img, &dets[0]).unwrap();
        let (w, h) = img.dimensions();
        let small = image::imageops::resize(&img, w * 2 / 3, h * 2 / 3, FilterType::Triangle);
        let ds = e.detect(&small, 0.8).unwrap();
        assert_eq!(ds.len(), 1);
        let b = e.embed(&small, &ds[0]).unwrap();
        let c = cosine(&a, &b);
        assert!(c > 0.8, "ta sama twarz w innym rozmiarze: cos = {c}");
    }
}

#[cfg(test)]
mod shape_probe {
    #[test]
    #[ignore]
    fn probe_shapes() {
        let y = std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("models/yunet.onnx")).unwrap();
        for shape in [[1usize, 3, 640, 640], [1, 3, 480, 640], [1, 3, 640, 480], [1, 3, 960, 1280], [1, 3, 736, 960]] {
            let r = super::load(&y, &shape);
            eprintln!("{shape:?}: {}", match r { Ok(_) => "ok".to_string(), Err(e) => format!("{e:#}").chars().take(600).collect::<String>() });
        }
    }
}
