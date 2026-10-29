//! Obrót zdjęć JPEG bez utraty jakości: zmieniamy tylko znacznik orientacji EXIF, a piksele zostają bajt w bajt takie same.
//! Tak obracała zdjęcia Picasa. Przed pierwszą zmianą oryginał trafia do `.originals`, więc zawsze można go przywrócić.

use std::path::Path;

use image::{DynamicImage, RgbImage};
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::AppState;

/// Orientacja EXIF po obrocie zdjęcia o 90° w prawo (`cw`) albo w lewo. Wartość wyliczamy z samych przekształceń obrazu,
/// więc zgadza się z tym, jak program i przeglądarka interpretują znacznik (także dla zdjęć odbitych lustrzanie, wartości 2, 4, 5, 7).
pub fn next_orientation(current: u16, cw: bool) -> u16 {
    // Obraz testowy bez żadnej symetrii: każdy piksel inny, więc każde z ośmiu przekształceń daje inny wynik.
    let mut img = RgbImage::new(3, 2);
    for (i, p) in img.pixels_mut().enumerate() {
        *p = image::Rgb([(i * 40 + 10) as u8, (i * 7) as u8, (255 - i * 30) as u8]);
    }
    let base = DynamicImage::ImageRgb8(img);
    let shown = crate::formats::orient(base.clone(), current);
    let turned = if cw { shown.rotate90() } else { shown.rotate270() };
    (1..=8).find(|&o| crate::formats::orient(base.clone(), o).to_rgb8() == turned.to_rgb8()).unwrap_or(current)
}

fn be(order_be: bool, b: &[u8]) -> u32 {
    if order_be { b.iter().fold(0u32, |a, x| (a << 8) | *x as u32) } else { b.iter().rev().fold(0u32, |a, x| (a << 8) | *x as u32) }
}

fn put16(order_be: bool, v: u16) -> [u8; 2] {
    if order_be { v.to_be_bytes() } else { v.to_le_bytes() }
}

fn put32(order_be: bool, v: u32) -> [u8; 4] {
    if order_be { v.to_be_bytes() } else { v.to_le_bytes() }
}

/// Wstawia albo zmienia znacznik orientacji w danych TIFF z segmentu EXIF. Zwraca nowe dane TIFF.
fn patch_tiff(tiff: &[u8], orientation: u16) -> Result<Vec<u8>, String> {
    if tiff.len() < 8 {
        return Err("uszkodzony nagłówek EXIF".into());
    }
    let order_be = match &tiff[0..2] {
        b"MM" => true,
        b"II" => false,
        _ => return Err("nieznany porządek bajtów EXIF".into()),
    };
    let ifd0 = be(order_be, &tiff[4..8]) as usize;
    if ifd0 + 2 > tiff.len() {
        return Err("uszkodzony EXIF".into());
    }
    let n = be(order_be, &tiff[ifd0..ifd0 + 2]) as usize;
    let entries_end = ifd0 + 2 + n * 12;
    if entries_end + 4 > tiff.len() {
        return Err("uszkodzony EXIF".into());
    }
    let mut out = tiff.to_vec();
    // Znacznik już jest: podmieniamy wartość w miejscu (SHORT mieści się w polu wartości).
    for i in 0..n {
        let e = ifd0 + 2 + i * 12;
        if be(order_be, &tiff[e..e + 2]) == 0x0112 {
            out[e + 2..e + 4].copy_from_slice(&put16(order_be, 3));
            out[e + 4..e + 8].copy_from_slice(&put32(order_be, 1));
            out[e + 8..e + 10].copy_from_slice(&put16(order_be, orientation));
            out[e + 10..e + 12].copy_from_slice(&[0, 0]);
            return Ok(out);
        }
    }
    // Znacznika nie ma: budujemy nowy IFD0 na końcu danych (z jednym wpisem więcej), a w nagłówku zmieniamy tylko wskaźnik na niego.
    // Wartości dłuższe niż 4 bajty zostają pod starymi adresami (adresy liczone są od początku danych TIFF, więc nadal obowiązują).
    if out.len() % 2 == 1 {
        out.push(0);
    }
    let new_ifd = out.len();
    let mut entries: Vec<[u8; 12]> = (0..n).map(|i| tiff[ifd0 + 2 + i * 12..ifd0 + 14 + i * 12].try_into().unwrap()).collect();
    let mut mine = [0u8; 12];
    mine[0..2].copy_from_slice(&put16(order_be, 0x0112));
    mine[2..4].copy_from_slice(&put16(order_be, 3));
    mine[4..8].copy_from_slice(&put32(order_be, 1));
    mine[8..10].copy_from_slice(&put16(order_be, orientation));
    entries.push(mine);
    entries.sort_by_key(|e| be(order_be, &e[0..2]));
    out.extend_from_slice(&put16(order_be, entries.len() as u16));
    for e in &entries {
        out.extend_from_slice(e);
    }
    out.extend_from_slice(&tiff[entries_end..entries_end + 4]); // wskaźnik na kolejny IFD (miniatura) bez zmian
    out[4..8].copy_from_slice(&put32(order_be, new_ifd as u32));
    Ok(out)
}

/// Ustawia orientację EXIF w pliku JPEG (bajty obrazu bez zmian). Błąd, gdy to nie jest JPEG albo EXIF jest uszkodzony.
pub fn set_orientation(jpeg: &[u8], orientation: u16) -> Result<Vec<u8>, String> {
    if !(1..=8).contains(&orientation) {
        return Err("zła orientacja".into());
    }
    if jpeg.len() < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return Err("to nie jest plik JPEG".into());
    }
    let mut pos = 2usize;
    let mut insert_at = 2usize; // po SOI i po ewentualnym APP0 (JFIF)
    while pos + 4 <= jpeg.len() && jpeg[pos] == 0xFF {
        let marker = jpeg[pos + 1];
        if marker == 0xDA || marker == 0xD9 {
            break;
        }
        let len = u16::from_be_bytes([jpeg[pos + 2], jpeg[pos + 3]]) as usize;
        if len < 2 || pos + 2 + len > jpeg.len() {
            return Err("uszkodzony nagłówek JPEG".into());
        }
        let seg = &jpeg[pos + 4..pos + 2 + len];
        if marker == 0xE1 && seg.starts_with(b"Exif\0\0") {
            let tiff = patch_tiff(&seg[6..], orientation)?;
            let new_len = 2 + 6 + tiff.len();
            if new_len > 0xFFFF {
                return Err("segment EXIF za duży".into());
            }
            let mut out = Vec::with_capacity(jpeg.len() + 64);
            out.extend_from_slice(&jpeg[..pos]);
            out.extend_from_slice(&[0xFF, 0xE1]);
            out.extend_from_slice(&(new_len as u16).to_be_bytes());
            out.extend_from_slice(b"Exif\0\0");
            out.extend_from_slice(&tiff);
            out.extend_from_slice(&jpeg[pos + 2 + len..]);
            return Ok(out);
        }
        if marker == 0xE0 && pos == 2 {
            insert_at = pos + 2 + len;
        }
        pos += 2 + len;
    }
    // Brak EXIF: nowy minimalny segment z jednym znacznikiem.
    let mut tiff = Vec::new();
    tiff.extend_from_slice(b"MM\0*");
    tiff.extend_from_slice(&8u32.to_be_bytes());
    tiff.extend_from_slice(&1u16.to_be_bytes());
    tiff.extend_from_slice(&0x0112u16.to_be_bytes());
    tiff.extend_from_slice(&3u16.to_be_bytes());
    tiff.extend_from_slice(&1u32.to_be_bytes());
    tiff.extend_from_slice(&orientation.to_be_bytes());
    tiff.extend_from_slice(&[0, 0]);
    tiff.extend_from_slice(&0u32.to_be_bytes());
    let mut out = Vec::with_capacity(jpeg.len() + 40);
    out.extend_from_slice(&jpeg[..insert_at]);
    out.extend_from_slice(&[0xFF, 0xE1]);
    out.extend_from_slice(&((2 + 6 + tiff.len()) as u16).to_be_bytes());
    out.extend_from_slice(b"Exif\0\0");
    out.extend_from_slice(&tiff);
    out.extend_from_slice(&jpeg[insert_at..]);
    Ok(out)
}

#[derive(Serialize, Default, Debug)]
pub struct RotateReport {
    pub done: usize,
    /// Zdjęcia w formatach, których nie da się obrócić bez utraty jakości (obracasz je w edytorze, zapis jako kopia).
    pub skipped: usize,
    pub errors: Vec<String>,
}

fn rotate_one(state: &AppState, id: i64, cw: bool) -> Result<bool, String> {
    let (path, taken, camera) = crate::photo_path(state, id)?;
    let p = Path::new(&path);
    if crate::formats::rewritable_ext(p) != Some("jpg") {
        return Ok(false);
    }
    crate::locks::ensure_unlocked_state(state, p)?;
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    let current = crate::read_exif(p).orientation as u16;
    let current = if (1..=8).contains(&current) { current } else { 1 };
    let patched = set_orientation(&bytes, next_orientation(current, cw))?;
    // Kopia oryginału (tylko za pierwszym razem), a potem zapis przez plik tymczasowy, żeby przerwanie nie uszkodziło zdjęcia.
    let dir = p.parent().ok_or("brak folderu")?;
    let name = p.file_name().ok_or("brak nazwy")?;
    let backup = dir.join(crate::ORIGINALS_DIR).join(name);
    if !backup.exists() {
        std::fs::create_dir_all(dir.join(crate::ORIGINALS_DIR)).map_err(|e| e.to_string())?;
        std::fs::copy(p, &backup).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("fibo-tmp");
    std::fs::write(&tmp, patched).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    crate::reindex(state, p, taken, camera)?;
    Ok(true)
}

/// Obraca wybrane zdjęcia o 90° bez utraty jakości.
#[tauri::command]
pub async fn rotate_photos(app: tauri::AppHandle, ids: Vec<i64>, clockwise: bool) -> Result<RotateReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = crate::jobs::Guard::new("rotate");
        let state = app.state::<AppState>();
        let mut rep = RotateReport::default();
        for (i, id) in ids.iter().enumerate() {
            crate::jobs::tick("rotate", i, ids.len());
            match rotate_one(&state, *id, clockwise) {
                Ok(true) => rep.done += 1,
                Ok(false) => rep.skipped += 1,
                Err(e) => rep.errors.push(e),
            }
            if i % 10 == 9 {
                let _ = app.emit("rotate-progress", (i + 1, ids.len()));
            }
        }
        Ok(rep)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let mut img = RgbImage::new(w, h);
        for (i, p) in img.pixels_mut().enumerate() {
            *p = image::Rgb([(i * 13 % 256) as u8, (i * 7 % 256) as u8, (i * 3 % 256) as u8]);
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90).encode_image(&img).unwrap();
        out.into_inner()
    }

    fn orientation_of(bytes: &[u8]) -> u32 {
        let d = std::env::temp_dir().join("mz-rotate-test");
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join(format!("t{}.jpg", bytes.len() + bytes.iter().take(64).map(|b| *b as usize).sum::<usize>()));
        std::fs::write(&p, bytes).unwrap();
        crate::read_exif(&p).orientation
    }

    #[test]
    fn rotation_table_matches_image_transforms() {
        // Pełny obrót w prawo wraca do punktu wyjścia, a w lewo jest odwrotnością obrotu w prawo.
        for o in 1..=8u16 {
            let mut x = o;
            for _ in 0..4 {
                x = next_orientation(x, true);
            }
            assert_eq!(x, o, "4 obroty w prawo z {o}");
            assert_eq!(next_orientation(next_orientation(o, true), false), o, "prawo i lewo z {o}");
        }
        assert_eq!(next_orientation(1, true), 6);
        assert_eq!(next_orientation(1, false), 8);
        assert_eq!(next_orientation(6, true), 3);
        assert_eq!(next_orientation(3, true), 8);
    }

    #[test]
    fn orientation_is_added_to_a_jpeg_without_exif_and_pixels_stay_identical() {
        let src = jpeg(40, 24);
        let out = set_orientation(&src, 6).unwrap();
        assert_eq!(orientation_of(&out), 6);
        // Piksele są bajt w bajt te same: po wycięciu segmentu EXIF reszta pliku jest identyczna.
        let before = image::load_from_memory(&src).unwrap().to_rgb8();
        let after = image::load_from_memory(&out).unwrap().to_rgb8();
        assert_eq!(before, after);
        // Kolejna zmiana poprawia istniejący znacznik w miejscu.
        let again = set_orientation(&out, 3).unwrap();
        assert_eq!(orientation_of(&again), 3);
        assert_eq!(again.len(), out.len());
    }

    #[test]
    fn orientation_is_added_to_existing_exif_without_that_tag() {
        // Segment EXIF z jednym innym znacznikiem (ImageDescription "abc").
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"II*\0");
        tiff.extend_from_slice(&8u32.to_le_bytes());
        tiff.extend_from_slice(&1u16.to_le_bytes());
        tiff.extend_from_slice(&0x010Eu16.to_le_bytes());
        tiff.extend_from_slice(&2u16.to_le_bytes());
        tiff.extend_from_slice(&4u32.to_le_bytes());
        tiff.extend_from_slice(b"abc\0");
        tiff.extend_from_slice(&0u32.to_le_bytes());
        let src = jpeg(16, 16);
        let mut with_exif = vec![0xFF, 0xD8, 0xFF, 0xE1];
        with_exif.extend_from_slice(&((2 + 6 + tiff.len()) as u16).to_be_bytes());
        with_exif.extend_from_slice(b"Exif\0\0");
        with_exif.extend_from_slice(&tiff);
        with_exif.extend_from_slice(&src[2..]);
        assert_eq!(orientation_of(&with_exif), 1);
        let out = set_orientation(&with_exif, 8).unwrap();
        assert_eq!(orientation_of(&out), 8);
        assert!(out.windows(3).any(|w| w == b"abc"), "dotychczasowy opis zostaje");
        assert_eq!(image::load_from_memory(&out).unwrap().to_rgb8(), image::load_from_memory(&src).unwrap().to_rgb8());
    }

    #[test]
    fn broken_input_is_rejected() {
        assert!(set_orientation(b"to nie jpeg", 6).is_err());
        assert!(set_orientation(&jpeg(8, 8), 9).is_err());
        // Segment deklaruje 32 bajty, a plik ma ich kilka.
        assert!(set_orientation(&[0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x20, 0x00], 6).is_err());
    }
}
