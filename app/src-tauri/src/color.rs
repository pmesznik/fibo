//! Kolor dominujący zdjęcia (do szukania „czerwone”, „niebieskie”, „jasne” itp.).
//! Liczony lokalnie z miniatury (360 px), więc jest szybki; wynik to numer jednego z 12 kolorów zapisany w bibliotece.

use image::{imageops::FilterType, RgbImage};
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::AppState;

/// Nazwy kolorów w kolejności numerów (0 do 11); interfejs ma te same.
pub const NAMES: [&str; 12] = ["czerwony", "pomarańczowy", "żółty", "zielony", "turkusowy", "niebieski", "fioletowy", "różowy", "brązowy", "biały", "szary", "czarny"];

fn hsv(p: [u8; 3]) -> (f32, f32, f32) {
    let (r, g, b) = (p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0);
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let d = mx - mn;
    let h = if d < 1e-6 {
        0.0
    } else if mx == r {
        60.0 * (((g - b) / d).rem_euclid(6.0))
    } else if mx == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    (h, if mx < 1e-6 { 0.0 } else { d / mx }, mx)
}

/// Numer koloru dominującego. Zdjęcie jest zmniejszane do 32 px; każdy piksel trafia do koloru barwnego (czerwony..różowy, brązowy)
/// albo do bieli, szarości lub czerni. Gdy barwnych pikseli jest co najmniej 15%, wygrywa najliczniejszy kolor barwny
/// (liczy się nasycenie, więc blada okolica nie przebija żywego obiektu), a w przeciwnym razie najliczniejszy z kolorów neutralnych.
pub fn dominant(img: &RgbImage) -> i64 {
    let small = image::imageops::resize(img, 32, 32, FilterType::Triangle);
    let mut chroma = [0f32; 12];
    let mut neutral = [0u32; 12];
    let (mut chroma_px, mut total) = (0u32, 0u32);
    for p in small.pixels() {
        total += 1;
        let (h, s, v) = hsv(p.0);
        if v < 0.18 {
            neutral[11] += 1;
        } else if s < 0.14 {
            neutral[if v > 0.82 { 9 } else { 10 }] += 1;
        } else {
            let bucket = if (10.0..45.0).contains(&h) && v < 0.6 && s > 0.25 {
                8
            } else {
                match h {
                    h if !(15.0..345.0).contains(&h) => 0,
                    h if h < 40.0 => 1,
                    h if h < 70.0 => 2,
                    h if h < 165.0 => 3,
                    h if h < 200.0 => 4,
                    h if h < 255.0 => 5,
                    h if h < 300.0 => 6,
                    _ => 7,
                }
            };
            chroma[bucket] += s + 0.3;
            chroma_px += 1;
        }
    }
    if total > 0 && chroma_px as f32 / total as f32 >= 0.15 {
        (0..9).max_by(|a, b| chroma[*a].total_cmp(&chroma[*b])).unwrap_or(0) as i64
    } else {
        (9..12).max_by_key(|i| neutral[*i]).unwrap_or(10) as i64
    }
}

/// Kolor z pliku miniatury JPEG.
pub fn dominant_of_file(path: &std::path::Path) -> Option<i64> {
    Some(dominant(&image::open(path).ok()?.to_rgb8()))
}

#[derive(Serialize, Default)]
pub struct ColorReport {
    pub done: usize,
}

/// Uzupełnia kolor dominujący zdjęć, które mają już miniaturę, a jeszcze nie mają koloru (nowe miniatury liczą go od razu przy tworzeniu).
#[tauri::command]
pub async fn index_colors(app: tauri::AppHandle) -> Result<ColorReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let todo: Vec<(i64, i64)> = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn.prepare("SELECT id, modified FROM photos WHERE color IS NULL AND hidden = 0").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            rows
        };
        let mut done = 0;
        for (i, (id, modified)) in todo.iter().enumerate() {
            let thumb = state.thumbs.join(format!("{id}_{modified}.jpg"));
            if let Some(c) = dominant_of_file(&thumb) {
                if let Ok(conn) = state.db.lock() {
                    let _ = conn.execute("UPDATE photos SET color = ?2 WHERE id = ?1", rusqlite::params![id, c]);
                }
                done += 1;
            }
            if i % 200 == 199 {
                let _ = app.emit("colors-progress", (i + 1, todo.len()));
            }
        }
        Ok(ColorReport { done })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(c: [u8; 3]) -> RgbImage {
        RgbImage::from_pixel(64, 48, image::Rgb(c))
    }

    #[test]
    fn solid_colors_are_named_correctly() {
        let cases: [([u8; 3], &str); 12] = [
            ([230, 20, 20], "czerwony"), ([240, 140, 20], "pomarańczowy"), ([240, 220, 20], "żółty"), ([30, 180, 40], "zielony"),
            ([20, 200, 210], "turkusowy"), ([30, 70, 220], "niebieski"), ([130, 30, 200], "fioletowy"), ([240, 100, 170], "różowy"),
            ([120, 70, 30], "brązowy"), ([250, 250, 250], "biały"), ([128, 128, 128], "szary"), ([10, 10, 10], "czarny"),
        ];
        for (c, name) in cases {
            assert_eq!(NAMES[dominant(&solid(c)) as usize], name, "{c:?}");
        }
    }

    #[test]
    fn a_vivid_object_wins_over_a_pale_background() {
        // 80% prawie biały, 20% czerwony: człowiek powie „czerwone zdjęcie”, a nie „białe”.
        let mut img = solid([245, 245, 245]);
        for y in 0..48 {
            for x in 0..13 {
                img.put_pixel(x, y, image::Rgb([220, 20, 20]));
            }
        }
        assert_eq!(NAMES[dominant(&img) as usize], "czerwony");
        // Same szarości bez koloru zostają neutralne.
        assert_eq!(NAMES[dominant(&solid([200, 200, 205])) as usize], "szary");
    }
}
