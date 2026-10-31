//! Ocena jakości zdjęć do przejrzenia: ostrość (nieostre i poruszone), ciemne i prześwietlone. Wszystko liczone lokalnie z miniatury 512 px,
//! bez modeli i bez sieci. Wynik to liczby zapisane w bibliotece; progi wybiera użytkownik w oknie „Przegląd jakości”, a program niczego sam nie ukrywa ani nie usuwa.
//!
//! Ostrość to wariancja laplasjanu w kafelkach 8x8: bierzemy 90. percentyl kafelków, więc zdjęcie z ostrym obiektem i rozmytym tłem (portret)
//! nie jest uznane za nieostre, a zdjęcie rozmazane w całości dostaje niski wynik. Zamknięte oczy nie są wykrywane (potrzebny byłby osobny model).

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use image::{imageops::FilterType, DynamicImage, GrayImage, RgbImage};
use serde::Serialize;
use tauri::Manager;

use crate::AppState;

/// Dłuższy bok obrazu, na którym liczymy.
const SIDE: u32 = 512;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quality {
    /// Ostrość: im wyżej, tym ostrzej (typowo kilka do kilkuset).
    pub sharp: f32,
    /// Średnia jasność 0 do 255.
    pub mean: f32,
    /// Odsetek pikseli prawie białych (prześwietlenie) 0 do 1.
    pub hi: f32,
    /// Odsetek pikseli prawie czarnych 0 do 1.
    pub lo: f32,
}

pub fn init_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    for col in ["q_sharp REAL", "q_mean REAL", "q_hi REAL", "q_lo REAL", "q_mod INTEGER"] {
        let _ = conn.execute(&format!("ALTER TABLE photos ADD COLUMN {col}"), []);
    }
    Ok(())
}

/// Wariancja laplasjanu w kafelkach 8x8 i jej 90. percentyl.
fn sharpness(gray: &GrayImage) -> f32 {
    let (w, h) = gray.dimensions();
    if w < 16 || h < 16 {
        return 0.0;
    }
    let px = |x: u32, y: u32| gray.get_pixel(x, y).0[0] as f32;
    let lap = |x: u32, y: u32| px(x, y - 1) + px(x, y + 1) + px(x - 1, y) + px(x + 1, y) - 4.0 * px(x, y);
    const N: u32 = 8;
    let (tw, th) = (w / N, h / N);
    let mut vars: Vec<f32> = Vec::with_capacity((N * N) as usize);
    for ty in 0..N {
        for tx in 0..N {
            let (x0, y0) = ((tx * tw).max(1), (ty * th).max(1));
            let (x1, y1) = (((tx + 1) * tw).min(w - 1), ((ty + 1) * th).min(h - 1));
            let (mut sum, mut sum2, mut n) = (0f64, 0f64, 0f64);
            for y in y0..y1 {
                for x in x0..x1 {
                    let l = lap(x, y) as f64;
                    sum += l;
                    sum2 += l * l;
                    n += 1.0;
                }
            }
            if n > 0.0 {
                vars.push(((sum2 / n) - (sum / n).powi(2)) as f32);
            }
        }
    }
    vars.sort_by(|a, b| a.total_cmp(b));
    vars.get(vars.len().saturating_sub(1) * 9 / 10).copied().unwrap_or(0.0)
}

pub fn measure(img: &DynamicImage) -> Quality {
    let small: RgbImage = if img.width().max(img.height()) > SIDE { img.resize(SIDE, SIDE, FilterType::Triangle).to_rgb8() } else { img.to_rgb8() };
    let gray = image::imageops::grayscale(&small);
    let n = (gray.width() * gray.height()).max(1) as f32;
    let (mut sum, mut hi, mut lo) = (0f64, 0u32, 0u32);
    for p in gray.pixels() {
        let v = p.0[0];
        sum += v as f64;
        if v >= 250 {
            hi += 1;
        }
        if v <= 5 {
            lo += 1;
        }
    }
    Quality { sharp: sharpness(&gray), mean: (sum / n as f64) as f32, hi: hi as f32 / n, lo: lo as f32 / n }
}

/// Obraz do oceny: miniatura z pamięci podręcznej, a gdy jej nie ma, zdjęcie z dysku (dla RAW szybki podgląd).
fn load(path: &Path, thumb: &Path) -> Option<DynamicImage> {
    if let Ok(img) = image::open(thumb) {
        return Some(img);
    }
    crate::formats::open_preview(path).ok().map(|(img, _)| img)
}

#[derive(Serialize, Default)]
pub struct QualityReport {
    pub done: usize,
    pub failed: usize,
}

/// Ocenia jakość zdjęć, które jeszcze jej nie mają (albo zmieniły się od ostatniej oceny). Działa w tle, na kilku wątkach.
#[tauri::command]
pub async fn quality_scan(app: tauri::AppHandle) -> Result<QualityReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = crate::jobs::Guard::new("quality");
        let state = app.state::<AppState>();
        let todo: Vec<(i64, String, i64)> = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT id, path, modified FROM photos WHERE hidden = 0 AND video = 0 AND (q_mod IS NULL OR q_mod != modified) ORDER BY id")
                .map_err(|e| e.to_string())?;
            let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            v
        };
        let total = todo.len();
        let next = AtomicUsize::new(0);
        let (tx, rx) = std::sync::mpsc::channel::<(usize, Option<Quality>)>();
        let mut rep = QualityReport::default();
        let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2).clamp(1, 6).min(total.max(1));
        std::thread::scope(|scope| {
            for _ in 0..workers {
                let (tx, todo, next, thumbs) = (tx.clone(), &todo, &next, &state.thumbs);
                scope.spawn(move || loop {
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= todo.len() {
                        break;
                    }
                    let (id, path, modified) = &todo[i];
                    let thumb = thumbs.join(format!("{id}_{modified}.jpg"));
                    let q = std::panic::catch_unwind(|| load(Path::new(path), &thumb).map(|img| measure(&img))).unwrap_or(None);
                    if tx.send((i, q)).is_err() {
                        break;
                    }
                });
            }
            drop(tx);
            let mut seen = 0;
            for (i, q) in rx.iter() {
                seen += 1;
                crate::jobs::tick("quality", seen, total);
                let (id, _, modified) = &todo[i];
                match q {
                    Some(q) => {
                        if let Ok(conn) = state.db.lock() {
                            let _ = conn.execute(
                                "UPDATE photos SET q_sharp = ?2, q_mean = ?3, q_hi = ?4, q_lo = ?5, q_mod = ?6 WHERE id = ?1",
                                rusqlite::params![id, q.sharp, q.mean, q.hi, q.lo, modified],
                            );
                        }
                        rep.done += 1;
                    }
                    None => rep.failed += 1,
                }
            }
        });
        Ok(rep)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    /// Zdjęcie z drobnym szczegółem (szachownica z szumem), wyraźne.
    fn detailed(w: u32, h: u32) -> RgbImage {
        RgbImage::from_fn(w, h, |x, y| {
            let c = if (x / 3 + y / 3) % 2 == 0 { 40u8 } else { 200 };
            Rgb([c, c, c])
        })
    }

    #[test]
    fn blur_lowers_sharpness_and_flat_images_score_near_zero() {
        let sharp = measure(&DynamicImage::ImageRgb8(detailed(400, 300)));
        let blurred = measure(&DynamicImage::ImageRgb8(image::imageops::blur(&detailed(400, 300), 4.0)));
        let flat = measure(&DynamicImage::ImageRgb8(RgbImage::from_pixel(400, 300, Rgb([120, 120, 120]))));
        assert!(sharp.sharp > 20.0 * blurred.sharp.max(0.01), "ostre {} vs rozmyte {}", sharp.sharp, blurred.sharp);
        assert!(flat.sharp < 0.01);
    }

    #[test]
    fn a_sharp_subject_on_a_blurry_background_is_not_called_blurry() {
        // Portret: ostry kawałek w jednym rogu, reszta rozmyta. Percentyl kafelków bierze to, co ostre.
        let mut img = image::imageops::blur(&detailed(400, 300), 6.0);
        let sharp = detailed(400, 300);
        for y in 0..100 {
            for x in 0..140 {
                img.put_pixel(x, y, *sharp.get_pixel(x, y));
            }
        }
        let all_blur = measure(&DynamicImage::ImageRgb8(image::imageops::blur(&detailed(400, 300), 6.0)));
        let portrait = measure(&DynamicImage::ImageRgb8(img));
        assert!(portrait.sharp > 10.0 * all_blur.sharp.max(0.01), "portret {} vs całość rozmyta {}", portrait.sharp, all_blur.sharp);
    }

    #[test]
    fn dark_and_blown_out_images_are_measured() {
        let dark = measure(&DynamicImage::ImageRgb8(RgbImage::from_pixel(100, 100, Rgb([8, 8, 8]))));
        let bright = measure(&DynamicImage::ImageRgb8(RgbImage::from_pixel(100, 100, Rgb([255, 255, 252]))));
        assert!(dark.mean < 15.0 && bright.mean > 240.0);
        assert!(bright.hi > 0.99 && dark.lo < 0.01 && dark.hi == 0.0);
        let night = measure(&DynamicImage::ImageRgb8(RgbImage::from_pixel(100, 100, Rgb([2, 2, 2]))));
        assert!(night.lo > 0.99);
    }
}
