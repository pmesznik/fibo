//! Znak wodny z własnego logo (PNG z przezroczystością, JPEG lub WebP) nakładany na eksportowane kopie zdjęć.
//! Oryginały nie są zmieniane. Logo jest czytane lokalnie, nic nie jest wysyłane w sieć.

use std::path::Path;

use image::{imageops::FilterType, DynamicImage, RgbaImage};
use serde::Deserialize;
use tauri::State;

use crate::AppState;

const MAX_LOGO_BYTES: u64 = 20 * 1024 * 1024;
const MARGIN: f32 = 0.025;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Watermark {
    /// Plik logo.
    pub path: String,
    /// Położenie: tl, tc, tr, ml, mc, mr, bl, bc, br (góra, środek, dół razy lewo, środek, prawo).
    pub position: String,
    /// Szerokość logo jako procent szerokości zdjęcia (3-60).
    pub size_pct: u8,
    /// Krycie logo w procentach (5-100).
    pub opacity: u8,
}

/// Zapisuje obraz znaku wodnego z tekstu (PNG narysowany w oknie programu) w folderze danych i zwraca jego ścieżkę, którą podaje się potem jak logo.
#[tauri::command]
pub fn save_watermark_text(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych obrazu".into()) };
    check_text_png(bytes)?;
    let dst = state.thumbs.join("watermark-text.png");
    crate::write_atomic(&dst, bytes)?;
    Ok(dst.to_string_lossy().to_string())
}

/// Obraz znaku z tekstu musi być prawdziwym PNG do 2 MB i rozsądnych wymiarów.
fn check_text_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 2 * 1024 * 1024 || bytes.len() < 8 || bytes[..4] != [0x89, b'P', b'N', b'G'] {
        return Err("znak wodny z tekstu musi być plikiem PNG do 2 MB".into());
    }
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png).map_err(|e| format!("zły obraz znaku: {e}"))?;
    if img.width() < 4 || img.height() < 4 || img.width() > 8000 || img.height() > 2000 {
        return Err("zły rozmiar obrazu znaku wodnego".into());
    }
    Ok(())
}

/// Wczytuje logo po sprawdzeniu pliku (zwykły plik, znane rozszerzenie, rozsądny rozmiar) i parametrów.
pub fn load_logo(wm: &Watermark) -> Result<RgbaImage, String> {
    if !(3..=60).contains(&wm.size_pct) || !(5..=100).contains(&wm.opacity) {
        return Err("Rozmiar znaku wodnego musi być w zakresie 3-60%, a krycie 5-100%".into());
    }
    if !["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"].contains(&wm.position.as_str()) {
        return Err("Nieznane położenie znaku wodnego".into());
    }
    let p = Path::new(&wm.path);
    let ok = p.extension().and_then(|e| e.to_str()).map(|e| ["png", "jpg", "jpeg", "webp"].contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false);
    if !ok {
        return Err("Logo musi być plikiem PNG, JPEG lub WebP".into());
    }
    let meta = std::fs::symlink_metadata(p).map_err(|e| format!("Logo: {e}"))?;
    if !meta.is_file() || meta.len() > MAX_LOGO_BYTES {
        return Err("Logo musi być zwykłym plikiem do 20 MB".into());
    }
    Ok(image::open(p).map_err(|e| format!("Logo: {e}"))?.to_rgba8())
}

/// Nakłada logo na zdjęcie: szerokość logo to `size_pct` szerokości zdjęcia (nigdy większe niż zdjęcie), z marginesem od brzegów.
pub fn apply(base: DynamicImage, logo: &RgbaImage, wm: &Watermark) -> DynamicImage {
    let mut canvas = base.to_rgba8();
    let (bw, bh) = canvas.dimensions();
    let target_w = ((bw as f32 * wm.size_pct as f32 / 100.0).round() as u32).clamp(1, bw);
    let target_h = ((logo.height() as f32 * target_w as f32 / logo.width().max(1) as f32).round() as u32).clamp(1, bh);
    let mut small = image::imageops::resize(logo, target_w, target_h, FilterType::Lanczos3);
    let k = wm.opacity as f32 / 100.0;
    for px in small.pixels_mut() {
        px.0[3] = (px.0[3] as f32 * k).round() as u8;
    }
    let (mx, my) = ((bw as f32 * MARGIN) as i64, (bh as f32 * MARGIN) as i64);
    let (tw, th) = (target_w as i64, target_h as i64);
    let (bw, bh) = (bw as i64, bh as i64);
    let x = match wm.position.as_bytes()[1] {
        b'l' => mx,
        b'r' => bw - tw - mx,
        _ => (bw - tw) / 2,
    };
    let y = match wm.position.as_bytes()[0] {
        b't' => my,
        b'b' => bh - th - my,
        _ => (bh - th) / 2,
    };
    image::imageops::overlay(&mut canvas, &small, x.max(0), y.max(0));
    DynamicImage::ImageRgba8(canvas)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn wm(pos: &str, size: u8, op: u8) -> Watermark {
        Watermark { path: String::new(), position: pos.into(), size_pct: size, opacity: op }
    }

    #[test]
    fn logo_lands_in_requested_corner_with_opacity() {
        let base = DynamicImage::ImageRgba8(RgbaImage::from_pixel(100, 100, Rgba([255, 255, 255, 255])));
        let logo = RgbaImage::from_pixel(10, 10, Rgba([255, 0, 0, 255]));
        let out = apply(base.clone(), &logo, &wm("br", 20, 100)).to_rgba8();
        assert_eq!(out.get_pixel(10, 10).0, [255, 255, 255, 255], "lewy górny róg bez zmian");
        let br = out.get_pixel(88, 88).0;
        assert!(br[0] > 240 && br[1] < 20, "prawy dolny róg czerwony: {br:?}");
        let tl = apply(base.clone(), &logo, &wm("tl", 20, 100)).to_rgba8();
        assert!(tl.get_pixel(8, 8).0[1] < 20 && tl.get_pixel(90, 90).0[1] > 240);
        // Krycie 50%: kolor pośredni między czerwonym a białym.
        let half = apply(base, &logo, &wm("mc", 20, 50)).to_rgba8().get_pixel(50, 50).0;
        assert!(half[1] > 90 && half[1] < 170, "{half:?}");
    }

    #[test]
    fn text_watermark_png_is_validated() {
        let mut ok = Vec::new();
        RgbaImage::from_pixel(40, 10, Rgba([255, 255, 255, 255])).write_to(&mut std::io::Cursor::new(&mut ok), image::ImageFormat::Png).unwrap();
        assert!(check_text_png(&ok).is_ok());
        assert!(check_text_png(b"MZ not an image at all").is_err());
        assert!(check_text_png(&ok[..20]).is_err(), "obcięty PNG");
        let mut big = Vec::new();
        RgbaImage::from_pixel(9000, 10, Rgba([0, 0, 0, 255])).write_to(&mut std::io::Cursor::new(&mut big), image::ImageFormat::Png).unwrap();
        assert!(check_text_png(&big).is_err(), "za szeroki");
    }

    #[test]
    fn parameters_and_files_are_validated() {
        let dir = std::env::temp_dir().join("mz-wm-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        RgbaImage::from_pixel(4, 4, Rgba([0, 0, 0, 255])).save(dir.join("logo.png")).unwrap();
        std::fs::write(dir.join("zly.exe"), b"MZ").unwrap();
        let mut w = wm("br", 20, 80);
        w.path = dir.join("logo.png").to_string_lossy().to_string();
        assert!(load_logo(&w).is_ok());
        assert!(load_logo(&Watermark { size_pct: 2, ..w.clone() }).is_err());
        assert!(load_logo(&Watermark { size_pct: 61, ..w.clone() }).is_err());
        assert!(load_logo(&Watermark { opacity: 1, ..w.clone() }).is_err());
        assert!(load_logo(&Watermark { position: "xx".into(), ..w.clone() }).is_err());
        assert!(load_logo(&Watermark { path: dir.join("zly.exe").to_string_lossy().to_string(), ..w.clone() }).is_err());
        assert!(load_logo(&Watermark { path: dir.join("brak.png").to_string_lossy().to_string(), ..w.clone() }).is_err());
    }
}
