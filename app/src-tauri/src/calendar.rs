//! Zapis kalendarza do PDF. Strony kalendarza rysuje interfejs (zdjęcie, siatka dni, święta) i przekazuje jako JPEG,
//! a tu każda trafia na osobną stronę PDF (A4 lub A3, pionowo lub poziomo) na całą stronę, bez marginesów.
//! PDF jest budowany ręcznie, bez bibliotek zewnętrznych i bez dostępu do sieci.

use std::io::Cursor;
use std::path::Path;

use tauri::State;

use crate::{unique_target, AppState};

const MAX_PAGES: usize = 14;
/// Fotoksiążka może mieć więcej stron niż kalendarz.
const MAX_BOOK_PAGES: usize = 80;
const MAX_PAGE_BYTES: usize = 40 * 1024 * 1024;

struct PageImg {
    jpeg: Vec<u8>,
    w: u32,
    h: u32,
}

/// Rozmiar strony w punktach PDF (1 pt = 1/72 cala).
fn page_points(size: &str, landscape: bool) -> Result<(f32, f32), String> {
    let (w, h) = match size {
        "a4" => (595.0, 842.0),
        "a3" => (842.0, 1191.0),
        "a5" => (420.0, 595.0),
        "square" => (595.0, 595.0),
        _ => return Err("Nieznany rozmiar papieru".into()),
    };
    Ok(if landscape { (h, w) } else { (w, h) })
}

fn build_calendar_pdf(pages: &[PageImg], page_w: f32, page_h: f32) -> Vec<u8> {
    // Obiekty numerowane od 1: 1 katalog, 2 lista stron, potem dla każdej strony: obraz, treść, strona.
    let mut objs: Vec<Vec<u8>> = vec![Vec::new(), Vec::new()];
    let mut page_ids = Vec::new();
    for im in pages {
        let mut o = format!(
            "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
            im.w,
            im.h,
            im.jpeg.len()
        )
        .into_bytes();
        o.extend_from_slice(&im.jpeg);
        o.extend_from_slice(b"\nendstream");
        objs.push(o);
        let image_id = objs.len();
        let content = format!("q {page_w:.2} 0 0 {page_h:.2} 0 0 cm /Im0 Do Q\n");
        objs.push(format!("<< /Length {} >>\nstream\n{content}endstream", content.len()).into_bytes());
        let content_id = objs.len();
        objs.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w:.2} {page_h:.2}] /Contents {content_id} 0 R /Resources << /XObject << /Im0 {image_id} 0 R >> >> >>"
            )
            .into_bytes(),
        );
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

/// Ciało żądania: liczba stron (u32), potem dla każdej strony długość (u32) i bajty JPEG; liczby w porządku little-endian.
fn parse_pages(body: &[u8], max_pages: usize) -> Result<Vec<PageImg>, String> {
    let take4 = |at: usize| -> Result<u32, String> {
        body.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).ok_or_else(|| "Uszkodzone dane kalendarza".to_string())
    };
    let count = take4(0)? as usize;
    if count == 0 || count > max_pages {
        return Err(format!("Dokument może mieć od 1 do {max_pages} stron"));
    }
    let mut at = 4;
    let mut pages = Vec::new();
    for _ in 0..count {
        let len = take4(at)? as usize;
        at += 4;
        if len < 4 || len > MAX_PAGE_BYTES {
            return Err("Strona kalendarza ma niepoprawny rozmiar".into());
        }
        let jpeg = body.get(at..at + len).ok_or("Uszkodzone dane kalendarza")?.to_vec();
        at += len;
        if jpeg[..3] != [0xFF, 0xD8, 0xFF] {
            return Err("Strona kalendarza musi być obrazem JPEG".into());
        }
        let (w, h) = image::ImageReader::new(Cursor::new(&jpeg)).with_guessed_format().map_err(|e| e.to_string())?.into_dimensions().map_err(|e| e.to_string())?;
        pages.push(PageImg { jpeg, w, h });
    }
    Ok(pages)
}

pub fn save_calendar_core(body: &[u8], dest: &Path, name: &str, size: &str, landscape: bool) -> Result<std::path::PathBuf, String> {
    save_pages_core(body, dest, name, size, landscape, MAX_PAGES, "Kalendarz")
}

/// Zapis stron (JPEG na całą stronę) jako PDF; wspólny dla kalendarza i fotoksiążki.
pub fn save_pages_core(body: &[u8], dest: &Path, name: &str, size: &str, landscape: bool, max_pages: usize, default_stem: &str) -> Result<std::path::PathBuf, String> {
    if !dest.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    let (w, h) = page_points(size, landscape)?;
    let pages = parse_pages(body, max_pages)?;
    let stem: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').take(60).collect();
    let stem = if stem.is_empty() { default_stem.to_string() } else { stem };
    let target = unique_target(dest, &format!("{stem}.pdf"));
    std::fs::write(&target, build_calendar_pdf(&pages, w, h)).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Zapisuje kalendarz jako PDF w wybranym folderze. Nagłówki: dest, name (tylko ASCII), size (a4 lub a3), landscape (0 lub 1).
#[tauri::command]
pub fn save_calendar_pdf(_state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych kalendarza".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    // Folder przychodzi zakodowany (nagłówki HTTP są ASCII), więc dekodujemy znaki specjalne.
    let dest = percent_decode(&header("dest"));
    save_calendar_core(bytes, Path::new(&dest), &header("name"), &header("size"), header("landscape") == "1").map(|p| p.to_string_lossy().to_string())
}

/// Zapisuje fotoksiążkę jako PDF w wybranym folderze (do 80 stron; A4, A5 albo kwadrat). Nagłówki jak przy kalendarzu.
#[tauri::command]
pub fn save_book_pdf(_state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych fotoksiążki".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let dest = percent_decode(&header("dest"));
    save_pages_core(bytes, Path::new(&dest), &header("name"), &header("size"), header("landscape") == "1", MAX_BOOK_PAGES, "Fotoksiazka").map(|p| p.to_string_lossy().to_string())
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if let Some(Ok(v)) = s.get(i + 1..i + 3).map(|h| u8::from_str_radix(h, 16)) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let mut v = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut v, 80).encode_image(&image::RgbImage::new(w, h)).unwrap();
        v
    }

    fn body(pages: &[Vec<u8>]) -> Vec<u8> {
        let mut b = (pages.len() as u32).to_le_bytes().to_vec();
        for p in pages {
            b.extend((p.len() as u32).to_le_bytes());
            b.extend(p);
        }
        b
    }

    #[test]
    fn calendar_pdf_has_one_full_page_image_per_page_and_valid_xref() {
        let dir = std::env::temp_dir().join("mz-calendar-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let b = body(&[jpeg(60, 80), jpeg(60, 80), jpeg(60, 80)]);
        let path = save_calendar_core(&b, &dir, "Kalendarz_2027", "a4", false).unwrap();
        assert_eq!(path.file_name().unwrap(), "Kalendarz_2027.pdf");
        let pdf = std::fs::read(&path).unwrap();
        assert!(pdf.starts_with(b"%PDF-1.4") && pdf.ends_with(b"%%EOF\n"));
        let text = String::from_utf8_lossy(&pdf).to_string();
        assert_eq!(text.matches("/Type /Page ").count(), 3);
        assert!(text.contains("/Count 3") && text.contains("/MediaBox [0 0 595.00 842.00]"));
        let sx: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        assert_eq!(&pdf[sx..sx + 4], b"xref");
        let tail = String::from_utf8_lossy(&pdf[sx..]).to_string();
        for (i, line) in tail.lines().skip(3).take(2 + 3 * 3).enumerate() {
            let off: usize = line[..10].parse().unwrap();
            assert!(pdf[off..].starts_with(format!("{} 0 obj", i + 1).as_bytes()), "obiekt {} pod złym offsetem", i + 1);
        }
        // Drugi zapis nie nadpisuje pierwszego.
        let second = save_calendar_core(&b, &dir, "Kalendarz_2027", "a3", true).unwrap();
        assert_ne!(second, path);
        assert!(String::from_utf8_lossy(&std::fs::read(&second).unwrap()).contains("/MediaBox [0 0 1191.00 842.00]"), "A3 poziomo");
    }

    #[test]
    fn book_pdf_allows_many_pages_and_square_and_a5() {
        let dir = std::env::temp_dir().join("mz-book-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let b = body(&vec![jpeg(30, 30); 20]);
        assert!(save_calendar_core(&b, &dir, "x", "a4", false).is_err(), "kalendarz ma limit 14 stron");
        let p = save_pages_core(&b, &dir, "Moja ksiazka!", "square", false, MAX_BOOK_PAGES, "Fotoksiazka").unwrap();
        assert_eq!(p.file_name().unwrap(), "Mojaksiazka.pdf");
        let t = String::from_utf8_lossy(&std::fs::read(&p).unwrap()).to_string();
        assert!(t.contains("/Count 20") && t.contains("/MediaBox [0 0 595.00 595.00]"));
        let a5 = save_pages_core(&b, &dir, "", "a5", false, MAX_BOOK_PAGES, "Fotoksiazka").unwrap();
        assert_eq!(a5.file_name().unwrap(), "Fotoksiazka.pdf");
        assert!(String::from_utf8_lossy(&std::fs::read(&a5).unwrap()).contains("/MediaBox [0 0 420.00 595.00]"));
        assert!(save_pages_core(&body(&vec![jpeg(8, 8); 81]), &dir, "x", "a4", false, MAX_BOOK_PAGES, "F").is_err(), "limit 80 stron");
    }

    #[test]
    fn calendar_input_is_validated() {
        let dir = std::env::temp_dir().join("mz-calendar-test2");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(save_calendar_core(&[], &dir, "x", "a4", false).is_err(), "pusto");
        assert!(save_calendar_core(&body(&[b"to nie jpeg".to_vec()]), &dir, "x", "a4", false).is_err(), "nie JPEG");
        assert!(save_calendar_core(&body(&vec![jpeg(8, 8); 15]), &dir, "x", "a4", false).is_err(), "za dużo stron");
        assert!(save_calendar_core(&body(&[jpeg(8, 8)]), &dir, "x", "a5", false).is_err(), "nieznany rozmiar");
        assert!(save_calendar_core(&body(&[jpeg(8, 8)]), &dir.join("brak"), "x", "a4", false).is_err(), "brak folderu");
        let mut cut = body(&[jpeg(8, 8)]);
        cut.truncate(cut.len() - 5);
        assert!(save_calendar_core(&cut, &dir, "x", "a4", false).is_err(), "ucięte dane");
        // Nazwa jest oczyszczona z ukośników i kropek, więc plik nie wyjdzie poza folder.
        let p = save_calendar_core(&body(&[jpeg(8, 8)]), &dir, "../../zly", "a4", false).unwrap();
        assert_eq!(p.parent().unwrap(), dir.as_path());
        assert_eq!(percent_decode("C%3A%5CZdj%C4%99cia"), "C:\\Zdjęcia");
    }
}
