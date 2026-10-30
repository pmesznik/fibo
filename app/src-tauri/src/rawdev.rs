//! Wywoływanie plików RAW: zamiana surowych danych z matrycy na zdjęcie z własną ekspozycją, balansem bieli i miękkim odzyskiwaniem świateł.
//! Dekoder i demozaikowanie to biblioteka `rawler` (czysty Rust); ten moduł dokłada tylko krzywą tonalną i zapis. Wszystko lokalnie.
//!
//! Dlaczego to coś więcej niż edycja zdjęcia z aparatu: JPEG z aparatu ma już obcięte światła i ustalony balans bieli, a surowe dane
//! mają zapas (zwykle 2 do 4 stopni EV w światłach), więc obniżenie ekspozycji odsłania detale w niebie i jasnych ubraniach.

use std::path::Path;

use image::{DynamicImage, RgbImage};
use rawler::imgop::develop::{Intermediate, ProcessingStep, RawDevelop};
use serde::Deserialize;
use tauri::{Manager, State};

use crate::{formats, jobs, AppState};

/// Ustawienia wywołania. Wszystkie zero oznaczają „tak jak ustawił aparat”.
#[derive(Deserialize, Debug, Clone, Copy, Default, PartialEq)]
pub struct DevParams {
    /// Ekspozycja w stopniach EV (od -4 do 4).
    pub exposure: f32,
    /// Temperatura barwowa: dodatnie ociepla (więcej czerwieni), ujemne ochładza (od -100 do 100).
    pub temp: f32,
    /// Odcień: dodatnie dodaje magentę, ujemne zieleń (od -100 do 100).
    pub tint: f32,
    /// Odzyskiwanie świateł: 0 to twarde obcięcie, 100 to mocny miękki łuk w jasnych tonach.
    pub highlights: f32,
}

impl DevParams {
    pub fn clamped(self) -> DevParams {
        let c = |v: f32, lo: f32, hi: f32| if v.is_finite() { v.clamp(lo, hi) } else { 0.0 };
        DevParams { exposure: c(self.exposure, -4.0, 4.0), temp: c(self.temp, -100.0, 100.0), tint: c(self.tint, -100.0, 100.0), highlights: c(self.highlights, 0.0, 100.0) }
    }
}

/// Mnożniki balansu bieli (R, G, B) dla suwaków: temperatura zmienia stosunek czerwieni do błękitu, odcień zieleń.
pub fn wb_factors(temp: f32, tint: f32) -> [f32; 3] {
    let t = 2f32.powf(temp / 100.0 * 0.6);
    let g = 2f32.powf(-tint / 100.0 * 0.4);
    [t, g, 1.0 / t]
}

/// Krzywa tonalna jednej wartości liniowej: ekspozycja, potem miękkie „ramię” od progu w górę, które nie pozwala przekroczyć 1.
/// `highlights` = 0 daje zwykłe obcięcie, a im więcej, tym niższy próg i łagodniejsze przejście (wartości powyżej 1 też się mieszczą).
pub fn tone(v: f32, exposure: f32, highlights: f32) -> f32 {
    let v = (v * 2f32.powf(exposure)).max(0.0);
    let knee = 1.0 - 0.65 * (highlights / 100.0).clamp(0.0, 1.0);
    if v <= knee {
        return v;
    }
    if highlights <= 0.0 {
        return v.min(1.0);
    }
    let span = 1.0 - knee;
    knee + span * (1.0 - (-(v - knee) / span).exp())
}

fn srgb_gamma(v: f32) -> f32 {
    if v <= 0.003_130_8 { 12.92 * v } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

/// Wywołuje plik RAW. Wynik ma już obrót zgodny z orientacją zapisaną w pliku.
pub fn develop_file(path: &Path, p: DevParams) -> Result<DynamicImage, String> {
    let p = p.clamped();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<RgbImage, String> {
        let source = rawler::rawsource::RawSource::new(path).map_err(|e| format!("RAW: {e}"))?;
        let decoder = rawler::get_decoder(&source).map_err(|e| format!("RAW: {e}"))?;
        let mut raw = decoder.raw_image(&source, &rawler::decoders::RawDecodeParams::default(), false).map_err(|e| format!("RAW: {e}"))?;
        // Balans bieli aparatu (RGBE) mnożymy przez suwaki. Brak danych o balansie to wartości 1 (jak w programie rawler).
        if raw.wb_coeffs[0].is_nan() {
            raw.wb_coeffs = [1.0, 1.0, 1.0, 1.0];
        }
        let f = wb_factors(p.temp, p.tint);
        raw.wb_coeffs[0] *= f[0];
        raw.wb_coeffs[1] *= f[1];
        raw.wb_coeffs[2] *= f[2];
        if raw.wb_coeffs[3].is_finite() && raw.wb_coeffs[3] > 0.0 {
            raw.wb_coeffs[3] *= f[1];
        }
        // Bez ostatniego kroku (gamma sRGB): krzywą tonalną liczymy na danych liniowych.
        let dev = RawDevelop::new_with(&[
            ProcessingStep::Rescale,
            ProcessingStep::Demosaic,
            ProcessingStep::FujiRotate,
            ProcessingStep::CropActiveArea,
            ProcessingStep::WhiteBalance,
            ProcessingStep::Calibrate,
            ProcessingStep::CropDefault,
        ]);
        let Intermediate::ThreeColor(px) = dev.develop_intermediate(&raw).map_err(|e| format!("RAW: {e}"))? else {
            return Err("RAW: ten format (jednokolorowa matryca) nie jest obsługiwany".into());
        };
        let mut out = Vec::with_capacity(px.width * px.height * 3);
        for c in &px.data {
            for v in c {
                out.push((srgb_gamma(tone(*v, p.exposure, p.highlights).min(1.0)) * 255.0 + 0.5) as u8);
            }
        }
        RgbImage::from_raw(px.width as u32, px.height as u32, out).ok_or_else(|| "RAW: zły rozmiar obrazu".to_string())
    }));
    let img = result.map_err(|_| "RAW: nie udało się wywołać tego pliku".to_string())??;
    let orientation = formats::raw_meta(path).and_then(|m| m.orientation).unwrap_or(1);
    Ok(formats::orient(DynamicImage::ImageRgb8(img), orientation))
}

/// Wywołuje zdjęcie RAW z biblioteki i zwraca JPEG (wysokiej jakości) jako źródło dla edytora.
#[tauri::command]
pub async fn develop_raw(app: tauri::AppHandle, id: i64, params: DevParams) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<'_, AppState> = app.state();
        let path: String = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            conn.query_row("SELECT path FROM photos WHERE id = ?1", [id], |r| r.get(0)).map_err(|e| e.to_string())?
        };
        let p = Path::new(&path);
        if !formats::is_raw(p) {
            return Err("To nie jest plik RAW".to_string());
        }
        let _job = jobs::Guard::new("raw");
        jobs::stage("raw", 0, 1, "Wywołuję zdjęcie RAW…");
        let img = develop_file(p, params)?;
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95).encode_image(&img.to_rgb8()).map_err(|e| e.to_string())?;
        Ok(tauri::ipc::Response::new(jpeg))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposure_doubles_light_per_stop_and_never_exceeds_one() {
        assert!((tone(0.2, 1.0, 0.0) - 0.4).abs() < 1e-6);
        assert!((tone(0.2, -1.0, 0.0) - 0.1).abs() < 1e-6);
        assert_eq!(tone(0.9, 1.0, 0.0), 1.0, "bez odzyskiwania światła są obcięte");
        for h in [0.0, 30.0, 100.0] {
            for v in [0.0, 0.5, 1.0, 2.0, 8.0] {
                let t = tone(v, 0.0, h);
                assert!((0.0..=1.0).contains(&t), "v={v} h={h}: {t}");
            }
        }
        assert_eq!(tone(-0.3, 0.0, 50.0), 0.0, "ujemne wartości z szumu nie dają ujemnego wyniku");
    }

    #[test]
    fn highlight_recovery_is_monotonic_and_keeps_tonal_separation() {
        // Bez miękkiego łuku wszystko powyżej 1 jest jednakowe; z łukiem jasne tony zachowują różnice.
        assert_eq!(tone(1.5, 0.0, 0.0), tone(3.0, 0.0, 0.0));
        let (a, b) = (tone(1.5, 0.0, 80.0), tone(3.0, 0.0, 80.0));
        assert!(b > a && b <= 1.0, "{a} < {b}");
        let mut prev = -1.0;
        for i in 0..=100 {
            let t = tone(i as f32 * 0.04, 0.0, 70.0);
            assert!(t >= prev - 1e-6, "krzywa rośnie");
            prev = t;
        }
        // Ciemne tony poniżej progu zostają bez zmian.
        assert_eq!(tone(0.2, 0.0, 100.0), 0.2);
    }

    #[test]
    fn white_balance_factors_are_neutral_at_zero_and_move_red_against_blue() {
        let n = wb_factors(0.0, 0.0);
        assert!(n.iter().all(|x| (x - 1.0).abs() < 1e-6));
        let warm = wb_factors(60.0, 0.0);
        assert!(warm[0] > 1.0 && warm[2] < 1.0 && (warm[0] * warm[2] - 1.0).abs() < 1e-5, "{warm:?}");
        let cool = wb_factors(-60.0, 0.0);
        assert!(cool[0] < 1.0 && cool[2] > 1.0);
        let magenta = wb_factors(0.0, 50.0);
        assert!(magenta[1] < 1.0, "dodatni odcień zmniejsza zieleń: {magenta:?}");
    }

    #[test]
    fn parameters_are_clamped_and_non_numbers_become_neutral() {
        let p = DevParams { exposure: 99.0, temp: f32::NAN, tint: -500.0, highlights: 200.0 }.clamped();
        assert_eq!(p, DevParams { exposure: 4.0, temp: 0.0, tint: -100.0, highlights: 100.0 });
        assert_eq!(DevParams::default().clamped(), DevParams::default());
    }

    /// Prawdziwy plik RAW (uruchamiany ręcznie: FIBO_TEST_RAW=plik): ekspozycja zmienia jasność, a rozmiar obrazu jest sensowny.
    #[test]
    #[ignore]
    fn real_raw_file_develops_and_responds_to_exposure() {
        let Ok(path) = std::env::var("FIBO_TEST_RAW") else { return };
        let mean = |img: &DynamicImage| { let r = img.to_rgb8(); r.as_raw().iter().map(|v| *v as u64).sum::<u64>() as f64 / r.as_raw().len() as f64 };
        let base = develop_file(Path::new(&path), DevParams::default()).unwrap();
        assert!(base.width() > 500 && base.height() > 500);
        let dark = develop_file(Path::new(&path), DevParams { exposure: -1.5, ..Default::default() }).unwrap();
        let warm = develop_file(Path::new(&path), DevParams { temp: 60.0, ..Default::default() }).unwrap();
        assert!(mean(&dark) < mean(&base), "niższa ekspozycja jest ciemniejsza");
        let (b, w) = (base.to_rgb8(), warm.to_rgb8());
        let rb = |i: &RgbImage| { let (mut r, mut bl) = (0u64, 0u64); for p in i.pixels() { r += p[0] as u64; bl += p[2] as u64; } r as f64 / bl.max(1) as f64 };
        assert!(rb(&w) > rb(&b), "cieplejszy balans ma więcej czerwieni względem błękitu");
    }
}
