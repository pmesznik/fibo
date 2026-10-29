//! Formaty zdjęć: które pliki FIBO rozpoznaje i jak je odczytuje.
//!
//! Wszystko jest dekodowane lokalnie, w czystym Rust (bez bibliotek C i bez `unsafe`) albo przez okno aplikacji (WebView2):
//! - JPEG, PNG, WebP, GIF, BMP, ICO, AVIF dekoduje okno aplikacji, więc podgląd dostaje oryginalne bajty pliku,
//! - TIFF, TGA, PNM, DDS, HDR, QOI i OpenEXR dekoduje biblioteka `image`,
//! - HEIC/HEIF (zdjęcia z iPhone'a) dekoduje `heic-decoder`,
//! - JPEG XL dekoduje `jxl-oxide`, a pliki Photoshopa (PSD) `psd`,
//! - pliki RAW aparatów (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 i wiele innych) obsługuje `rawler`: miniatury z osadzonego podglądu,
//!   pełny podgląd z pełnego obrazu albo wywołanej matrycy,
//! - SVG rysuje okno aplikacji.

use std::{fs, io::BufReader, path::Path};

use image::{DynamicImage, ImageReader, RgbImage, RgbaImage};

/// Formaty, które okno aplikacji dekoduje samo: podgląd dostaje oryginalne bajty.
const WEB: &[&str] = &["jpg", "jpeg", "jpe", "jfif", "png", "apng", "webp", "gif", "bmp", "ico", "avif"];
/// Formaty dekodowane biblioteką `image` (okno aplikacji ich nie obsługuje, więc podgląd dostaje przekonwertowany obraz).
const IMAGE_CRATE: &[&str] = &["tif", "tiff", "tga", "pbm", "pgm", "ppm", "pnm", "pam", "dds", "hdr", "qoi", "exr"];
const HEIC: &[&str] = &["heic", "heif", "hif"];
const JXL: &[&str] = &["jxl"];
const PSD: &[&str] = &["psd"];
/// Wektorowy SVG: rysuje go okno aplikacji (program nie ma własnego renderera).
const SVG: &[&str] = &["svg"];
/// Pliki RAW aparatów cyfrowych.
pub const RAW: &[&str] = &[
    "3fr", "ari", "arw", "bay", "cap", "cr2", "cr3", "crw", "dcr", "dcs", "dng", "erf", "fff", "gpr", "iiq", "k25", "kdc", "mdc", "mef", "mos", "mrw",
    "nef", "nrw", "orf", "pef", "ptx", "raf", "raw", "rw2", "rwl", "sr2", "srf", "srw", "x3f",
];
/// Formaty, których program nie umie zdekodować (miniaturę robi okno aplikacji).
const UI_ONLY: &[&str] = &["avif", "svg"];

pub fn ext_of(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default()
}

fn any(list: &[&str], e: &str) -> bool {
    list.contains(&e)
}

/// Czy FIBO rozpoznaje ten plik jako zdjęcie (na podstawie rozszerzenia).
pub fn is_supported(path: &Path) -> bool {
    let e = ext_of(path);
    any(WEB, &e) || any(IMAGE_CRATE, &e) || any(HEIC, &e) || any(JXL, &e) || any(PSD, &e) || any(SVG, &e) || any(RAW, &e)
}

pub fn is_raw(path: &Path) -> bool {
    any(RAW, &ext_of(path))
}

/// Czy podgląd dostaje oryginalne bajty pliku (okno aplikacji potrafi je zdekodować).
pub fn passes_through(path: &Path) -> bool {
    let e = ext_of(path);
    any(WEB, &e) || any(SVG, &e)
}

/// Czy miniaturę musi zrobić okno aplikacji, bo program nie ma dekodera (AVIF, SVG).
pub fn ui_only(path: &Path) -> bool {
    any(UI_ONLY, &ext_of(path))
}

/// Czy plik można zapisać z powrotem w tym samym formacie po edycji (JPEG, PNG, WebP). Inne formaty edytujemy tylko jako kopię.
pub fn rewritable_ext(path: &Path) -> Option<&'static str> {
    match ext_of(path).as_str() {
        "jpg" | "jpeg" | "jpe" | "jfif" => Some("jpg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        _ => None,
    }
}

/// Zdjęcie w pełnej rozdzielczości i znacznik orientacji EXIF (1-8), który jeszcze trzeba zastosować (1 = obraz już stoi prosto).
pub fn open(path: &Path) -> Result<(DynamicImage, u16), String> {
    decode(path, false)
}

/// To samo, ale dla plików RAW bierze osadzony podgląd (szybko), a nie wywołaną matrycę. Do miniatur i analizy.
pub fn open_preview(path: &Path) -> Result<(DynamicImage, u16), String> {
    decode(path, true)
}

/// Obraz ustawiony prosto (orientacja już zastosowana).
pub fn open_upright(path: &Path) -> Result<DynamicImage, String> {
    open(path).map(|(img, o)| orient(img, o))
}

pub fn orient(img: DynamicImage, orientation: u16) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn decode(path: &Path, preview: bool) -> Result<(DynamicImage, u16), String> {
    let e = ext_of(path);
    if any(RAW, &e) {
        return raw(path, preview);
    }
    if any(HEIC, &e) {
        return heic(path).map(|i| (i, 1));
    }
    if any(JXL, &e) {
        return jxl(path).map(|i| (i, crate::read_exif(path).orientation as u16));
    }
    if any(PSD, &e) {
        return psd(path).map(|i| (i, 1));
    }
    if any(UI_ONLY, &e) {
        return Err(format!("Format {} wyświetla okno programu, a program nie ma dla niego własnego dekodera", e.to_uppercase()));
    }
    let img = ImageReader::open(path).map_err(|er| er.to_string())?.with_guessed_format().map_err(|er| er.to_string())?.decode().map_err(|er| er.to_string())?;
    Ok((img, crate::read_exif(path).orientation as u16))
}

fn heic(path: &Path) -> Result<DynamicImage, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let decoded = heic_decoder::decode(&bytes).map_err(|e| format!("HEIC: {e}"))?;
    // Obrót i odbicie z kontenera (irot, imir) są już zastosowane przez dekoder.
    if decoded.alpha.is_some() {
        let rgba = decoded.to_rgba8().map_err(|e| format!("HEIC: {e}"))?;
        return RgbaImage::from_raw(rgba.width as u32, rgba.height as u32, rgba.data).map(DynamicImage::ImageRgba8).ok_or_else(|| "HEIC: zły rozmiar obrazu".to_string());
    }
    let rgb = decoded.to_rgb8().map_err(|e| format!("HEIC: {e}"))?;
    RgbImage::from_raw(rgb.width as u32, rgb.height as u32, rgb.data).map(DynamicImage::ImageRgb8).ok_or_else(|| "HEIC: zły rozmiar obrazu".to_string())
}

fn jxl(path: &Path) -> Result<DynamicImage, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let decoder = jxl_oxide::integration::JxlDecoder::new(BufReader::new(file)).map_err(|e| format!("JPEG XL: {e}"))?;
    let img = DynamicImage::from_decoder(decoder).map_err(|e| format!("JPEG XL: {e}"))?;
    // Zdjęcia HDR i zmiennoprzecinkowe sprowadzamy do zwykłych 8 bitów na kanał.
    Ok(match img {
        DynamicImage::ImageRgba8(_) | DynamicImage::ImageRgb8(_) | DynamicImage::ImageLuma8(_) => img,
        other if other.color().has_alpha() => DynamicImage::ImageRgba8(other.to_rgba8()),
        other => DynamicImage::ImageRgb8(other.to_rgb8()),
    })
}

fn psd(path: &Path) -> Result<DynamicImage, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    // Obraz scalony (wszystkie warstwy), tak jak w podglądzie Photoshopa.
    let doc = psd::Psd::from_bytes(&bytes).map_err(|e| format!("PSD: {e}"))?;
    RgbaImage::from_raw(doc.width(), doc.height(), doc.rgba()).map(DynamicImage::ImageRgba8).ok_or_else(|| "PSD: zły rozmiar obrazu".to_string())
}

fn raw(path: &Path, preview: bool) -> Result<(DynamicImage, u16), String> {
    // Dekoder RAW czyta bardzo różne, często nietypowe pliki, więc błąd w nim nie może zatrzymać programu.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(DynamicImage, u16), String> {
        let params = rawler::decoders::RawDecodeParams::default();
        let img = if preview { rawler::analyze::extract_preview_pixels(path, &params) } else { rawler::analyze::extract_full_pixels(path, &params) }
            .map_err(|e| format!("RAW: {e}"))?;
        Ok((img, raw_meta(path).and_then(|m| m.orientation).unwrap_or(1)))
    }));
    result.map_err(|_| "RAW: nie udało się odczytać tego pliku".to_string())?
}

/// Podstawowe dane z pliku RAW: data wykonania, model aparatu i orientacja.
pub struct RawMeta {
    pub taken: Option<String>,
    pub camera: Option<String>,
    pub orientation: Option<u16>,
}

pub fn raw_meta(path: &Path) -> Option<RawMeta> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let source = rawler::rawsource::RawSource::new(path).ok()?;
        let decoder = rawler::get_decoder(&source).ok()?;
        let m = decoder.raw_metadata(&source, &rawler::decoders::RawDecodeParams::default()).ok()?;
        let taken = m.exif.date_time_original.clone().or_else(|| m.exif.create_date.clone()).and_then(|d| normalize_date(&d));
        let camera = [m.make.trim(), m.model.trim()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>();
        Some(RawMeta { taken, camera: if camera.is_empty() { None } else { Some(camera.join(" ")) }, orientation: m.exif.orientation })
    }))
    .ok()
    .flatten()
}

/// „2024:07:01 12:00:00” albo „2024-07-01T12:00:00” na „2024-07-01 12:00:00” (tak jak daty z EXIF w bibliotece).
fn normalize_date(s: &str) -> Option<String> {
    let s = s.trim();
    if s.len() < 10 {
        return None;
    }
    let (d, t) = (s.get(0..10)?, s.get(10..).unwrap_or("").trim_start_matches(['T', ' ']));
    let d = d.replace(':', "-");
    if d.chars().filter(|c| *c == '-').count() != 2 || d.starts_with("0000") {
        return None;
    }
    Some(if t.is_empty() { d } else { format!("{d} {}", t.chars().take(8).collect::<String>()) })
}

/// Rozmiar obrazu bez dekodowania pikseli, jeśli da się go tanio odczytać.
pub fn dimensions(path: &Path) -> Option<(u32, u32)> {
    let e = ext_of(path);
    if any(HEIC, &e) {
        let info = heic_decoder::probe(&fs::read(path).ok()?).ok()?;
        return Some((info.width as u32, info.height as u32));
    }
    if any(PSD, &e) {
        use std::io::Read;
        let mut h = [0u8; 26];
        fs::File::open(path).ok()?.read_exact(&mut h).ok()?;
        if &h[0..4] != b"8BPS" {
            return None;
        }
        return Some((u32::from_be_bytes(h[18..22].try_into().ok()?), u32::from_be_bytes(h[14..18].try_into().ok()?)));
    }
    if any(RAW, &e) || any(JXL, &e) || any(UI_ONLY, &e) {
        return None;
    }
    image::image_dimensions(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("mz-formats-{name}"));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn registry_recognizes_many_formats_and_ignores_others() {
        for n in ["a.JPG", "a.heic", "a.CR2", "a.nef", "a.dng", "a.jxl", "a.psd", "a.avif", "a.svg", "a.tiff", "a.tga", "a.exr", "a.qoi", "a.ico", "a.gif", "a.webp", "a.arw", "a.raf", "a.orf", "a.rw2"] {
            assert!(is_supported(Path::new(n)), "{n}");
        }
        for n in ["a.txt", "a.mp4", "a.pdf", "a", "a.docx", "a.mov"] {
            assert!(!is_supported(Path::new(n)), "{n}");
        }
        assert!(is_raw(Path::new("x.CR3")) && !is_raw(Path::new("x.jpg")));
        assert!(passes_through(Path::new("x.png")) && passes_through(Path::new("x.svg")) && !passes_through(Path::new("x.tif")) && !passes_through(Path::new("x.heic")));
        assert!(ui_only(Path::new("x.avif")) && !ui_only(Path::new("x.jpg")));
        assert_eq!(rewritable_ext(Path::new("x.JPEG")), Some("jpg"));
        assert_eq!(rewritable_ext(Path::new("x.tif")), None);
        assert_eq!(rewritable_ext(Path::new("x.cr2")), None);
    }

    #[test]
    fn image_crate_formats_round_trip() {
        let d = dir("roundtrip");
        let mut src = RgbImage::new(6, 4);
        for (i, p) in src.pixels_mut().enumerate() {
            *p = image::Rgb([(i * 10) as u8, 200, 50]);
        }
        let img = DynamicImage::ImageRgb8(src);
        for name in ["a.tif", "a.tga", "a.qoi", "a.ppm", "a.ico", "a.bmp", "a.png", "a.hdr", "a.exr"] {
            let p = d.join(name);
            // ICO ma limit rozmiaru boku 256, a HDR/EXR zapisują liczby zmiennoprzecinkowe: wystarczy sprawdzić odczyt rozmiaru.
            let saved = if name.ends_with("hdr") || name.ends_with("exr") { DynamicImage::ImageRgb32F(img.to_rgb32f()).save(&p) } else if name.ends_with("ico") { DynamicImage::ImageRgba8(img.to_rgba8()).save(&p) } else { img.save(&p) };
            assert!(saved.is_ok(), "zapis {name}: {:?}", saved.err());
            let (got, o) = open(&p).unwrap_or_else(|e| panic!("odczyt {name}: {e}"));
            assert_eq!((got.width(), got.height(), o), (6, 4, 1), "{name}");
            assert_eq!(dimensions(&p), Some((6, 4)), "{name}");
        }
    }

    #[test]
    fn photoshop_files_are_read_as_flat_image() {
        // Najmniejszy poprawny PSD: nagłówek, puste sekcje i obraz bez kompresji w trzech płaszczyznach (R, G, B).
        let (w, h) = (3u32, 2u32);
        let mut f: Vec<u8> = Vec::new();
        f.extend(b"8BPS");
        f.extend(1u16.to_be_bytes());
        f.extend([0u8; 6]);
        f.extend(3u16.to_be_bytes());
        f.extend(h.to_be_bytes());
        f.extend(w.to_be_bytes());
        f.extend(8u16.to_be_bytes());
        f.extend(3u16.to_be_bytes()); // RGB
        f.extend(0u32.to_be_bytes()); // dane kolorów
        f.extend(0u32.to_be_bytes()); // zasoby
        f.extend(0u32.to_be_bytes()); // warstwy
        f.extend(0u16.to_be_bytes()); // bez kompresji
        f.extend(vec![255u8; 6]); // R
        f.extend(vec![0u8; 6]); // G
        f.extend(vec![0u8; 6]); // B
        let d = dir("psd");
        let p = d.join("a.psd");
        fs::write(&p, &f).unwrap();
        assert_eq!(dimensions(&p), Some((3, 2)));
        let (img, o) = open(&p).unwrap();
        assert_eq!((img.width(), img.height(), o), (3, 2, 1));
        assert_eq!(img.to_rgb8().get_pixel(1, 1).0, [255, 0, 0], "czerwony obraz");
    }

    #[test]
    fn broken_files_give_errors_not_panics() {
        let d = dir("broken");
        for name in ["a.cr2", "a.heic", "a.jxl", "a.psd", "a.nef", "a.dng", "a.tif", "a.exr"] {
            let p = d.join(name);
            fs::write(&p, b"to na pewno nie jest zdjecie").unwrap();
            assert!(open(&p).is_err(), "{name}");
            assert!(open_preview(&p).is_err(), "{name}");
        }
        assert!(open(&d.join("brak.heic")).is_err());
        assert!(open(&d.join("a.avif")).is_err() || !d.join("a.avif").exists());
    }

    #[test]
    fn dates_from_raw_files_are_normalized() {
        assert_eq!(normalize_date("2024:07:01 12:30:45").as_deref(), Some("2024-07-01 12:30:45"));
        assert_eq!(normalize_date("2024-07-01T08:00:00+02:00").as_deref(), Some("2024-07-01 08:00:00"));
        assert_eq!(normalize_date("0000:00:00 00:00:00"), None);
        assert_eq!(normalize_date("xx"), None);
    }

    #[test]
    fn orientation_is_applied_like_in_exif() {
        let img = DynamicImage::ImageRgb8(RgbImage::new(4, 2));
        assert_eq!(orient(img.clone(), 6).width(), 2);
        assert_eq!(orient(img.clone(), 8).width(), 2);
        assert_eq!(orient(img.clone(), 5).width(), 2);
        assert_eq!(orient(img.clone(), 3).width(), 4);
        assert_eq!(orient(img, 1).width(), 4);
    }

    /// Odczyt prawdziwych plików (uruchamiany ręcznie): FIBO_SAMPLES="plik1;plik2" cargo test real_files -- --ignored --nocapture
    /// Wypisuje rozmiar, czas i znacznik orientacji. Niczego nie zapisuje.
    #[test]
    #[ignore]
    fn real_files() {
        let Ok(list) = std::env::var("FIBO_SAMPLES") else { return };
        for f in list.split(';').filter(|f| !f.is_empty()) {
            let p = Path::new(f);
            let t = std::time::Instant::now();
            let dims = dimensions(p);
            match open_preview(p) {
                Ok((img, o)) => println!("{f}: {}x{} (nagłówek: {dims:?}), orientacja {o}, {:?}", img.width(), img.height(), t.elapsed()),
                Err(e) => println!("{f}: BŁĄD {e} ({dims:?})"),
            }
        }
    }
}
