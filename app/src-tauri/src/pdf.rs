//! Eksport zdjęć do PDF (strony A4 z siatką zdjęć: jedno na stronie, 2x2, arkusz kontaktowy 3x4 itd.), do druku lub wysłania.
//! PDF jest budowany ręcznie (zdjęcia jako JPEG osadzone bez zmian), bez bibliotek zewnętrznych i bez dostępu do sieci.

use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use tauri::State;

use crate::{photo_path, unique_target, AppState};

const PAGE_W: f32 = 595.0;
const PAGE_H: f32 = 842.0;
const MARGIN: f32 = 28.0;
const GAP: f32 = 10.0;

struct Img {
    jpeg: Vec<u8>,
    w: u32,
    h: u32,
}

/// Składa dokument PDF z gotowych obrazów JPEG rozłożonych w siatce `cols` x `rows` na stronach A4.
pub fn build_pdf(images: &[Img], cols: u32, rows: u32) -> Vec<u8> {
    let per_page = (cols * rows) as usize;
    let cell_w = (PAGE_W - 2.0 * MARGIN - (cols - 1) as f32 * GAP) / cols as f32;
    let cell_h = (PAGE_H - 2.0 * MARGIN - (rows - 1) as f32 * GAP) / rows as f32;
    // Obiekty numerowane od 1: 1 katalog, 2 lista stron, potem obrazy, potem pary (treść strony, strona).
    let mut objs: Vec<Vec<u8>> = vec![Vec::new(), Vec::new()];
    let mut image_ids = Vec::new();
    for im in images {
        let mut o = format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            im.w, im.h, im.jpeg.len()
        )
        .into_bytes();
        o.extend_from_slice(&im.jpeg);
        o.extend_from_slice(b"\nendstream");
        objs.push(o);
        image_ids.push(objs.len());
    }
    let mut page_ids = Vec::new();
    for chunk in images.chunks(per_page).enumerate() {
        let (pi, group) = chunk;
        let mut content = String::new();
        let mut xobjs = String::new();
        for (k, im) in group.iter().enumerate() {
            let idx = pi * per_page + k;
            let (c, r) = ((k as u32 % cols) as f32, (k as u32 / cols) as f32);
            let scale = (cell_w / im.w as f32).min(cell_h / im.h as f32);
            let (w, h) = (im.w as f32 * scale, im.h as f32 * scale);
            let x = MARGIN + c * (cell_w + GAP) + (cell_w - w) / 2.0;
            let y = PAGE_H - MARGIN - (r + 1.0) * cell_h - r * GAP + (cell_h - h) / 2.0;
            content.push_str(&format!("q {w:.2} 0 0 {h:.2} {x:.2} {y:.2} cm /Im{k} Do Q\n"));
            xobjs.push_str(&format!("/Im{k} {} 0 R ", image_ids[idx]));
        }
        objs.push(format!("<< /Length {} >>\nstream\n{content}endstream", content.len()).into_bytes());
        let content_id = objs.len();
        objs.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Contents {content_id} 0 R /Resources << /XObject << {xobjs}>> >> >>").into_bytes());
        page_ids.push(objs.len());
    }
    objs[0] = b"<< /Type /Catalog /Pages 2 0 R >>".to_vec();
    let kids: String = page_ids.iter().map(|i| format!("{i} 0 R ")).collect();
    objs[1] = format!("<< /Type /Pages /Kids [{kids}] /Count {} >>", page_ids.len()).into_bytes();

    let mut out = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
}

fn stamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (y, m, d) = crate::civil_from_days(secs / 86400);
    let r = secs % 86400;
    format!("{y:04}-{m:02}-{d:02}_{:02}{:02}{:02}", r / 3600, r % 3600 / 60, r % 60)
}

/// Tworzy PDF ze zdjęć (w podanej kolejności): `cols` x `rows` zdjęć na stronie A4. Zdjęcia są zmniejszane do `max_side` i zapisywane
/// jako JPEG bez EXIF. Oryginały nie są ruszane, istniejące pliki nie są nadpisywane. Zwraca ścieżkę pliku i liczbę stron.
pub fn pdf_core(state: &AppState, ids: &[i64], dest: &Path, cols: u32, rows: u32, max_side: u32, quality: u8) -> Result<(PathBuf, usize), String> {
    if !dest.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    if !(1..=6).contains(&cols) || !(1..=8).contains(&rows) {
        return Err("Układ strony poza zakresem".into());
    }
    if ids.is_empty() || ids.len() > 600 {
        return Err("Do PDF potrzeba od 1 do 600 zdjęć".into());
    }
    if !(300..=4000).contains(&max_side) {
        return Err("Rozmiar zdjęć poza zakresem 300-4000 px".into());
    }
    let mut images = Vec::new();
    for &id in ids {
        let (path, _, _) = photo_path(state, id)?;
        let src = PathBuf::from(&path);
        let (mut img, orientation) = crate::formats::open(&src).map_err(|e| format!("{path}: {e}"))?;
        if img.width().max(img.height()) > max_side {
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
        let rgb = img.to_rgb8();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, quality.clamp(1, 100)).encode_image(&rgb).map_err(|e| e.to_string())?;
        images.push(Img { jpeg, w: rgb.width(), h: rgb.height() });
    }
    let pages = images.len().div_ceil((cols * rows) as usize);
    let bytes = build_pdf(&images, cols, rows);
    let target = unique_target(dest, &format!("fibo-zdjecia_{}.pdf", stamp()));
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    Ok((target, pages))
}

#[tauri::command]
pub async fn export_pdf(app: tauri::AppHandle, ids: Vec<i64>, dest: String, cols: u32, rows: u32, max_side: u32, quality: u8) -> Result<(String, usize), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        pdf_core(&app.state::<AppState>(), &ids, Path::new(&dest), cols, rows, max_side, quality).map(|(p, n)| (p.to_string_lossy().to_string(), n))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[allow(dead_code)]
fn _state_marker(_: State<'_, AppState>) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(w: u32, h: u32) -> Img {
        let mut v = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut v, 80).encode_image(&image::RgbImage::new(w, h)).unwrap();
        Img { jpeg: v, w, h }
    }

    #[test]
    fn pdf_has_valid_structure_pages_and_xref() {
        let imgs: Vec<Img> = (0..5).map(|i| jpeg(40 + i * 10, 30)).collect();
        let pdf = build_pdf(&imgs, 2, 2);
        assert!(pdf.starts_with(b"%PDF-1.4") && pdf.ends_with(b"%%EOF\n"));
        let text = String::from_utf8_lossy(&pdf);
        // 5 zdjęć po 4 na stronę = 2 strony.
        assert_eq!(text.matches("/Type /Page ").count(), 2);
        assert!(text.contains("/Count 2"));
        // startxref wskazuje na tabelę xref, a każdy wpis tabeli na początek obiektu.
        let sx: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        assert_eq!(&pdf[sx..sx + 4], b"xref");
        // Tabela xref jest czystym ASCII na końcu pliku; indeksów nie liczymy na tekście z zamianą bajtów (lossy), tylko na bajtach.
        let tail = String::from_utf8_lossy(&pdf[sx..]).to_string();
        let table: Vec<&str> = tail.lines().skip(3).take(5).collect();
        for (i, line) in table.iter().enumerate() {
            let off: usize = line[..10].parse().unwrap();
            assert!(pdf[off..].starts_with(format!("{} 0 obj", i + 1).as_bytes()), "obiekt {} pod złym offsetem", i + 1);
        }
        assert_eq!(text.matches("/Filter /DCTDecode").count(), 5);
    }

    #[test]
    fn pdf_export_validates_input_and_writes_a_file() {
        let dir = std::env::temp_dir().join("mz-pdf-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("thumbs")).unwrap();
        let lib = dir.join("lib");
        let out = dir.join("out");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        let st = AppState {
            db: std::sync::Mutex::new(crate::open_db(&dir.join("t.db")).unwrap()),
            thumbs: dir.join("thumbs"),
            sidecar: std::sync::atomic::AtomicBool::new(true),
        };
        for n in ["a.jpg", "b.jpg", "c.jpg"] {
            image::RgbImage::new(120, 80).save(lib.join(n)).unwrap();
        }
        crate::scan_blocking(&st, lib.to_str().unwrap(), &|_| {}).unwrap();
        let ids: Vec<i64> = (0..3).map(|i| st.db.lock().unwrap().query_row("SELECT id FROM photos ORDER BY id LIMIT 1 OFFSET ?1", [i], |r| r.get(0)).unwrap()).collect();
        let (file, pages) = pdf_core(&st, &ids, &out, 1, 2, 800, 80).unwrap();
        assert_eq!(pages, 2);
        assert!(std::fs::read(&file).unwrap().starts_with(b"%PDF-"));
        assert!(pdf_core(&st, &[], &out, 1, 1, 800, 80).is_err());
        assert!(pdf_core(&st, &ids, &out, 0, 1, 800, 80).is_err());
        assert!(pdf_core(&st, &ids, &out, 2, 2, 100, 80).is_err());
        assert!(pdf_core(&st, &ids, &dir.join("brak"), 2, 2, 800, 80).is_err());
    }
}
