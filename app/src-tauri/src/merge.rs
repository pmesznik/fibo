//! Łączenie zdjęć: HDR (fuzja ekspozycji) i stos ostrości. Oba działają metodą fuzji piramid Laplace'a z wagami z każdego ujęcia
//! (kontrast, nasycenie i prawidłowa ekspozycja dla HDR, lokalna ostrość dla stosu ostrości), po wyrównaniu ujęć o przesunięcie.
//! Wszystko lokalnie, bez dodatkowych bibliotek i bez sieci. Wynik zapisuje się jako nowy plik JPEG obok pierwszego zdjęcia, oryginały zostają.
//! Wyrównanie obejmuje tylko przesunięcie (najlepiej ze statywu albo z bardzo stabilnych rąk); obrót i zmiana skali nie są korygowane.

use image::{imageops::FilterType, RgbImage};
use serde::Serialize;
use tauri::State;

use crate::AppState;

/// Najdłuższy bok obrazu roboczego: ogranicza pamięć (pracujemy na liczbach zmiennoprzecinkowych) i czas.
pub const WORK_SIDE: u32 = 2800;
pub const MIN_PHOTOS: usize = 2;
pub const MAX_PHOTOS: usize = 9;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Mode {
    Hdr,
    Focus,
}

/// Obraz zmiennoprzecinkowy (kanały przeplecione, wartości 0 do 1).
#[derive(Clone)]
struct F {
    w: usize,
    h: usize,
    c: usize,
    d: Vec<f32>,
}

impl F {
    fn new(w: usize, h: usize, c: usize) -> F {
        F { w, h, c, d: vec![0.0; w * h * c] }
    }
}

fn to_f(img: &RgbImage) -> F {
    let (w, h) = (img.width() as usize, img.height() as usize);
    F { w, h, c: 3, d: img.as_raw().iter().map(|&v| v as f32 / 255.0).collect() }
}

fn gray(f: &F) -> F {
    let mut g = F::new(f.w, f.h, 1);
    for p in 0..f.w * f.h {
        g.d[p] = 0.299 * f.d[p * 3] + 0.587 * f.d[p * 3 + 1] + 0.114 * f.d[p * 3 + 2];
    }
    g
}

/// Rozmycie 5-punktowe (1 4 6 4 1)/16, osobno w poziomie i w pionie, z odbiciem na brzegach.
fn blur5(f: &F) -> F {
    const K: [f32; 5] = [1.0 / 16.0, 4.0 / 16.0, 6.0 / 16.0, 4.0 / 16.0, 1.0 / 16.0];
    let (w, h, c) = (f.w, f.h, f.c);
    let mut tmp = F::new(w, h, c);
    for y in 0..h {
        for x in 0..w {
            for ch in 0..c {
                let mut s = 0.0;
                for (k, kv) in K.iter().enumerate() {
                    let xx = (x as i32 + k as i32 - 2).clamp(0, w as i32 - 1) as usize;
                    s += kv * f.d[(y * w + xx) * c + ch];
                }
                tmp.d[(y * w + x) * c + ch] = s;
            }
        }
    }
    let mut out = F::new(w, h, c);
    for y in 0..h {
        for x in 0..w {
            for ch in 0..c {
                let mut s = 0.0;
                for (k, kv) in K.iter().enumerate() {
                    let yy = (y as i32 + k as i32 - 2).clamp(0, h as i32 - 1) as usize;
                    s += kv * tmp.d[(yy * w + x) * c + ch];
                }
                out.d[(y * w + x) * c + ch] = s;
            }
        }
    }
    out
}

fn down(f: &F) -> F {
    let b = blur5(f);
    let (nw, nh) = (f.w.div_ceil(2), f.h.div_ceil(2));
    let mut o = F::new(nw, nh, f.c);
    for y in 0..nh {
        for x in 0..nw {
            for ch in 0..f.c {
                o.d[(y * nw + x) * f.c + ch] = b.d[((y * 2).min(f.h - 1) * f.w + (x * 2).min(f.w - 1)) * f.c + ch];
            }
        }
    }
    o
}

/// Powiększenie do podanego rozmiaru (interpolacja dwuliniowa).
fn up(f: &F, w: usize, h: usize) -> F {
    let mut o = F::new(w, h, f.c);
    for y in 0..h {
        let fy = ((y as f32 + 0.5) * f.h as f32 / h as f32 - 0.5).clamp(0.0, f.h as f32 - 1.0);
        let (y0, ty) = (fy.floor() as usize, fy - fy.floor());
        let y1 = (y0 + 1).min(f.h - 1);
        for x in 0..w {
            let fx = ((x as f32 + 0.5) * f.w as f32 / w as f32 - 0.5).clamp(0.0, f.w as f32 - 1.0);
            let (x0, tx) = (fx.floor() as usize, fx - fx.floor());
            let x1 = (x0 + 1).min(f.w - 1);
            for ch in 0..f.c {
                let p = |xx: usize, yy: usize| f.d[(yy * f.w + xx) * f.c + ch];
                o.d[(y * w + x) * f.c + ch] = (p(x0, y0) * (1.0 - tx) + p(x1, y0) * tx) * (1.0 - ty) + (p(x0, y1) * (1.0 - tx) + p(x1, y1) * tx) * ty;
            }
        }
    }
    o
}

fn levels_for(w: usize, h: usize) -> usize {
    let mut l = 1;
    let mut m = w.min(h);
    while m > 24 && l < 7 {
        m /= 2;
        l += 1;
    }
    l
}

fn gauss_pyr(f: &F, levels: usize) -> Vec<F> {
    let mut p = vec![f.clone()];
    for _ in 1..levels {
        let n = down(p.last().unwrap());
        p.push(n);
    }
    p
}

/// Piramida Laplace'a: różnice między kolejnymi poziomami, ostatni poziom to obraz resztkowy.
fn lap_pyr(f: &F, levels: usize) -> Vec<F> {
    let g = gauss_pyr(f, levels);
    let mut out = Vec::with_capacity(levels);
    for l in 0..levels - 1 {
        let u = up(&g[l + 1], g[l].w, g[l].h);
        let mut d = g[l].clone();
        for (a, b) in d.d.iter_mut().zip(&u.d) {
            *a -= b;
        }
        out.push(d);
    }
    out.push(g[levels - 1].clone());
    out
}

fn collapse(p: &[F]) -> F {
    let mut cur = p[p.len() - 1].clone();
    for l in (0..p.len() - 1).rev() {
        let u = up(&cur, p[l].w, p[l].h);
        cur = F { w: p[l].w, h: p[l].h, c: p[l].c, d: u.d.iter().zip(&p[l].d).map(|(a, b)| a + b).collect() };
    }
    cur
}

/// Wartość bezwzględna laplasjanu jasności (miara lokalnego kontrastu i ostrości).
fn contrast(g: &F) -> Vec<f32> {
    let (w, h) = (g.w, g.h);
    let mut o = vec![0.0f32; w * h];
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let c = g.d[y * w + x];
            o[y * w + x] = (g.d[y * w + x - 1] + g.d[y * w + x + 1] + g.d[(y - 1) * w + x] + g.d[(y + 1) * w + x] - 4.0 * c).abs();
        }
    }
    o
}

/// Waga każdego piksela ujęcia: dla HDR kontrast, nasycenie i prawidłowa ekspozycja; dla stosu ostrości wygładzona lokalna ostrość.
fn weights(f: &F, mode: Mode) -> Vec<f32> {
    let g = gray(f);
    let c = contrast(&g);
    match mode {
        Mode::Hdr => (0..f.w * f.h)
            .map(|p| {
                let (r, gg, b) = (f.d[p * 3], f.d[p * 3 + 1], f.d[p * 3 + 2]);
                let mean = (r + gg + b) / 3.0;
                let sat = (((r - mean).powi(2) + (gg - mean).powi(2) + (b - mean).powi(2)) / 3.0).sqrt();
                let well = |v: f32| (-((v - 0.5).powi(2)) / (2.0 * 0.2 * 0.2)).exp();
                (c[p] + 0.02) * (sat + 0.05) * well(r) * well(gg) * well(b) + 1e-12
            })
            .collect(),
        Mode::Focus => {
            // Ostrość lokalna wygładzona (żeby wybór nie migotał między ujęciami), podniesiona do potęgi (wyraźny zwycięzca).
            let mut cf = F::new(f.w, f.h, 1);
            cf.d = c;
            let s = blur5(&blur5(&cf));
            s.d.iter().map(|v| v.powi(3) + 1e-12).collect()
        }
    }
}

/// Fuzja ujęć o tym samym rozmiarze. `stop` pozwala przerwać (np. po zamknięciu okna).
pub fn fuse(images: &[RgbImage], mode: Mode, stop: &dyn Fn() -> bool) -> Result<RgbImage, String> {
    if images.len() < MIN_PHOTOS {
        return Err("Potrzebne są co najmniej dwa zdjęcia".into());
    }
    let (w, h) = (images[0].width() as usize, images[0].height() as usize);
    if images.iter().any(|i| i.width() as usize != w || i.height() as usize != h) {
        return Err("Zdjęcia muszą mieć ten sam rozmiar".into());
    }
    let levels = levels_for(w, h);
    // Przebieg 1: wagi każdego ujęcia i ich suma.
    let mut ws: Vec<Vec<f32>> = Vec::with_capacity(images.len());
    let mut sum = vec![0.0f32; w * h];
    for im in images {
        if stop() {
            return Err("Przerwano".into());
        }
        let wk = weights(&to_f(im), mode);
        for (s, v) in sum.iter_mut().zip(&wk) {
            *s += v;
        }
        ws.push(wk);
    }
    for wk in ws.iter_mut() {
        for (v, s) in wk.iter_mut().zip(&sum) {
            *v /= s;
        }
    }
    // Przebieg 2: piramida wyniku to suma piramid Laplace'a ujęć ważona piramidami Gaussa wag.
    let mut result: Option<Vec<F>> = None;
    for (im, wk) in images.iter().zip(ws) {
        if stop() {
            return Err("Przerwano".into());
        }
        let lap = lap_pyr(&to_f(im), levels);
        let wp = gauss_pyr(&F { w, h, c: 1, d: wk }, levels);
        let acc = result.get_or_insert_with(|| lap.iter().map(|l| F::new(l.w, l.h, l.c)).collect());
        for l in 0..levels {
            for p in 0..lap[l].w * lap[l].h {
                let wv = wp[l].d[p];
                for ch in 0..3 {
                    acc[l].d[p * 3 + ch] += lap[l].d[p * 3 + ch] * wv;
                }
            }
        }
    }
    let out = collapse(&result.unwrap());
    let mut img = RgbImage::new(w as u32, h as u32);
    for (px, v) in img.as_mut().iter_mut().zip(&out.d) {
        *px = (v * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    Ok(img)
}

// ---------------------------------------------------------------------------------------------------------------------
// Wyrównanie: przesunięcie względem pierwszego zdjęcia.

/// Mapa bitowa mediany (MTB): piksel jaśniejszy od mediany to 1, a piksele zbyt bliskie medianie są pomijane. Nie zależy od ekspozycji,
/// więc nadaje się do wyrównywania ujęć o różnej jasności (HDR).
struct Mtb {
    bits: Vec<bool>,
    valid: Vec<bool>,
    w: usize,
    h: usize,
}

fn mtb(img: &RgbImage) -> Mtb {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let g: Vec<f32> = img.pixels().map(|p| (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0).collect();
    let mut sorted = g.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let med = sorted[sorted.len() / 2];
    Mtb { bits: g.iter().map(|v| *v > med).collect(), valid: g.iter().map(|v| (*v - med).abs() > 0.02).collect(), w, h }
}

/// Odsetek niezgodnych pikseli MTB po przesunięciu `b` o (dx, dy) względem `a`, na środkowej części obrazu, z krokiem `step`.
fn shift_cost(a: &Mtb, b: &Mtb, dx: i32, dy: i32, step: usize) -> f32 {
    let (w, h) = (a.w, a.h);
    let (mx, my) = (w / 8, h / 8);
    let (mut bad, mut n) = (0u32, 0u32);
    let mut y = my;
    while y < h - my {
        let mut x = mx;
        while x < w - mx {
            let (sx, sy) = (x as i32 + dx, y as i32 + dy);
            if sx >= 0 && sy >= 0 && (sx as usize) < w && (sy as usize) < h {
                let (i, j) = (y * w + x, sy as usize * w + sx as usize);
                if a.valid[i] && b.valid[j] {
                    n += 1;
                    if a.bits[i] != b.bits[j] {
                        bad += 1;
                    }
                }
            }
            x += step;
        }
        y += step;
    }
    if n < 20 { f32::MAX } else { bad as f32 / n as f32 }
}

/// Przesunięcie (dx, dy), o jakie trzeba wziąć próbkę z `img`, żeby pasowała do `reference`. Szukanie grube na zmniejszonym obrazie, potem poprawka na pełnym.
pub fn estimate_shift(reference: &RgbImage, img: &RgbImage) -> (i32, i32) {
    let scale = (reference.width().max(reference.height()) / 360).max(1);
    let small = |i: &RgbImage| image::imageops::resize(i, (i.width() / scale).max(16), (i.height() / scale).max(16), FilterType::Triangle);
    let (a, b) = (mtb(&small(reference)), mtb(&small(img)));
    let r = 14i32;
    let (mut best, mut bd) = (f32::MAX, (0i32, 0i32));
    for dy in -r..=r {
        for dx in -r..=r {
            let c = shift_cost(&a, &b, dx, dy, 1);
            if c < best - 1e-9 || (c <= best + 1e-9 && dx.abs() + dy.abs() < bd.0.abs() + bd.1.abs()) {
                best = c;
                bd = (dx, dy);
            }
        }
    }
    let (mut fx, mut fy) = (bd.0 * scale as i32, bd.1 * scale as i32);
    if scale > 1 {
        let (a, b) = (mtb(reference), mtb(img));
        let (mut best, mut bd) = (f32::MAX, (0i32, 0i32));
        for dy in -(scale as i32)..=(scale as i32) {
            for dx in -(scale as i32)..=(scale as i32) {
                let c = shift_cost(&a, &b, fx + dx, fy + dy, 3);
                if c < best {
                    best = c;
                    bd = (dx, dy);
                }
            }
        }
        fx += bd.0;
        fy += bd.1;
    }
    (fx, fy)
}

/// Obraz przesunięty tak, żeby próbka z (x + dx, y + dy) trafiła na (x, y); brzegi są powielane.
pub fn shifted(img: &RgbImage, dx: i32, dy: i32) -> RgbImage {
    if dx == 0 && dy == 0 {
        return img.clone();
    }
    let (w, h) = (img.width() as i32, img.height() as i32);
    RgbImage::from_fn(w as u32, h as u32, |x, y| *img.get_pixel((x as i32 + dx).clamp(0, w - 1) as u32, (y as i32 + dy).clamp(0, h - 1) as u32))
}

/// Wyrównuje wszystkie ujęcia do pierwszego. Zwraca ujęcia i przesunięcia (do pokazania użytkownikowi).
pub fn align(images: Vec<RgbImage>) -> (Vec<RgbImage>, Vec<(i32, i32)>) {
    let reference = images[0].clone();
    let mut shifts = vec![(0, 0)];
    let mut out = vec![reference.clone()];
    for im in images.into_iter().skip(1) {
        let (dx, dy) = estimate_shift(&reference, &im);
        out.push(shifted(&im, dx, dy));
        shifts.push((dx, dy));
    }
    (out, shifts)
}

// ---------------------------------------------------------------------------------------------------------------------
// Polecenie.

#[derive(Serialize, Debug)]
pub struct MergeReport {
    /// Numer nowego zdjęcia w bibliotece.
    pub id: i64,
    pub path: String,
    /// Przesunięcia (dx, dy) wyrównania kolejnych ujęć (do ostrzeżenia, gdy są duże).
    pub shifts: Vec<(i32, i32)>,
}

fn load_upright(path: &str) -> Result<RgbImage, String> {
    let img = crate::formats::open_upright(std::path::Path::new(path))?;
    let img = if img.width().max(img.height()) > WORK_SIDE { img.resize(WORK_SIDE, WORK_SIDE, FilterType::Triangle) } else { img };
    Ok(img.to_rgb8())
}

/// Łączy wybrane zdjęcia (HDR albo stos ostrości) w nowy plik JPEG obok pierwszego zdjęcia i dodaje go do biblioteki.
pub fn merge_blocking(state: &AppState, ids: &[i64], mode: Mode) -> Result<MergeReport, String> {
    if ids.len() < MIN_PHOTOS || ids.len() > MAX_PHOTOS {
        return Err(format!("Wybierz od {MIN_PHOTOS} do {MAX_PHOTOS} zdjęć"));
    }
    let _job = crate::jobs::Guard::new("merge");
    let mut paths = Vec::new();
    let (mut taken, mut camera) = (None, None);
    for (k, id) in ids.iter().enumerate() {
        let (p, t, c) = crate::photo_path(state, *id)?;
        if k == 0 {
            taken = t;
            camera = c;
        }
        paths.push(p);
    }
    crate::jobs::tick("merge", 0, 4);
    let mut imgs = Vec::new();
    for p in &paths {
        imgs.push(load_upright(p)?);
    }
    let (w, h) = (imgs[0].width(), imgs[0].height());
    for im in imgs.iter_mut() {
        if im.width() != w || im.height() != h {
            let ratio_ok = ((im.width() as f32 / im.height() as f32) / (w as f32 / h as f32) - 1.0).abs() < 0.03;
            if !ratio_ok {
                return Err("Zdjęcia mają różne proporcje, więc nie da się ich połączyć".into());
            }
            *im = image::imageops::resize(im, w, h, FilterType::Triangle);
        }
    }
    crate::jobs::tick("merge", 1, 4);
    let (imgs, shifts) = align(imgs);
    crate::jobs::tick("merge", 2, 4);
    let fused = fuse(&imgs, mode, &|| false)?;
    crate::jobs::tick("merge", 3, 4);
    let first = std::path::Path::new(&paths[0]);
    let stem = first.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "zdjecie".into());
    let suffix = if mode == Mode::Hdr { "HDR" } else { "stos" };
    let dest = crate::unique_target(first.parent().unwrap_or(std::path::Path::new(".")), &format!("{stem}_{suffix}.jpg"));
    crate::encode_export(&image::DynamicImage::ImageRgb8(fused), "jpg", 92, &dest)?;
    let id = crate::reindex(state, &dest, taken, camera)?;
    Ok(MergeReport { id, path: dest.to_string_lossy().to_string(), shifts })
}

#[tauri::command]
pub async fn merge_photos(app: tauri::AppHandle, ids: Vec<i64>, mode: String) -> Result<MergeReport, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let mode = match mode.as_str() {
            "hdr" => Mode::Hdr,
            "focus" => Mode::Focus,
            _ => return Err("Nieznany tryb łączenia".to_string()),
        };
        let state = app.state::<AppState>();
        merge_blocking(&state, &ids, mode)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[allow(dead_code)]
fn _unused(_: State<'_, AppState>) {}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    /// Scena z fakturą w lewej (ciemnej) i prawej (jasnej) połowie.
    fn scene(x: u32, y: u32, w: u32) -> [f32; 3] {
        let tex = (((x / 3 + y / 3) % 2) as f32) * 0.5 + 0.25;
        let base = if x < w / 2 { 0.08 } else { 0.9 };
        [base * tex * 1.8, base * tex * 1.8, base * tex * 1.8]
    }
    fn expose(w: u32, h: u32, gain: f32) -> RgbImage {
        RgbImage::from_fn(w, h, |x, y| { let s = scene(x, y, w); Rgb([(s[0] * gain).clamp(0.0, 1.0).powf(0.8).mul_add(255.0, 0.0) as u8, (s[1] * gain).clamp(0.0, 1.0).powf(0.8).mul_add(255.0, 0.0) as u8, (s[2] * gain).clamp(0.0, 1.0).powf(0.8).mul_add(255.0, 0.0) as u8]) })
    }
    fn detail(img: &RgbImage, x0: u32, x1: u32) -> f32 {
        let (mut s, mut n) = (0f32, 0f32);
        for y in 2..img.height() - 2 { for x in x0.max(2)..x1.min(img.width() - 2) { s += (img.get_pixel(x, y)[0] as f32 - img.get_pixel(x + 1, y)[0] as f32).abs(); n += 1.0; } }
        s / n
    }

    #[test]
    fn hdr_fusion_keeps_detail_in_both_dark_and_bright_areas() {
        let (w, h) = (96, 64);
        let dark = expose(w, h, 0.45);   // jasna połowa dobrze naświetlona, ciemna bardzo ciemna
        let bright = expose(w, h, 3.2);  // ciemna połowa dobra, jasna prześwietlona
        let fused = fuse(&[dark.clone(), bright.clone()], Mode::Hdr, &|| false).unwrap();
        assert_eq!((fused.width(), fused.height()), (w, h));
        let (fl, fr) = (detail(&fused, 0, 46), detail(&fused, 50, 94));
        let (dl, dr) = (detail(&dark, 0, 46), detail(&dark, 50, 94));
        let (bl, br) = (detail(&bright, 0, 46), detail(&bright, 50, 94));
        assert!(fl > dl * 1.5, "ciemna połowa: fuzja {fl} vs ciemne ujęcie {dl}");
        assert!(fr > br * 1.5, "jasna połowa: fuzja {fr} vs prześwietlone ujęcie {br}");
        assert!(fl > bl * 0.5 && fr > dr * 0.5, "fuzja nie gubi szczegółów najlepszego ujęcia: {fl}/{bl}, {fr}/{dr}");
    }

    #[test]
    fn focus_stack_takes_the_sharp_half_from_each_shot() {
        let (w, h) = (96, 64);
        let sharp = RgbImage::from_fn(w, h, |x, y| { let v = if (x / 2 + y / 2) % 2 == 0 { 40 } else { 215 }; Rgb([v, v, v]) });
        let blurred = image::imageops::blur(&sharp, 3.0);
        let left_sharp = RgbImage::from_fn(w, h, |x, y| if x < w / 2 { *sharp.get_pixel(x, y) } else { *blurred.get_pixel(x, y) });
        let right_sharp = RgbImage::from_fn(w, h, |x, y| if x < w / 2 { *blurred.get_pixel(x, y) } else { *sharp.get_pixel(x, y) });
        let fused = fuse(&[left_sharp.clone(), right_sharp.clone()], Mode::Focus, &|| false).unwrap();
        let (fl, fr) = (detail(&fused, 4, 40), detail(&fused, 56, 92));
        let reference = detail(&sharp, 4, 40);
        assert!(fl > reference * 0.6 && fr > reference * 0.6, "oba kawałki ostre: {fl} i {fr} vs {reference}");
        assert!(fl > detail(&right_sharp, 4, 40) * 3.0 && fr > detail(&left_sharp, 56, 92) * 3.0);
    }

    #[test]
    fn alignment_finds_the_shift_and_shifting_restores_the_scene() {
        let base = RgbImage::from_fn(200, 150, |x, y| { let v = (((x * 7 + y * 13) % 97) as f32 * 2.0 + (((x / 9 + y / 11) % 2) as f32) * 40.0) as u8; Rgb([v, v / 2 + 20, 255 - v]) });
        let moved = shifted(&base, -7, 5); // zdjęcie przesunięte względem bazy
        let (dx, dy) = estimate_shift(&base, &moved);
        assert_eq!((dx, dy), (7, -5), "przesunięcie odwrotne do zastosowanego");
        let back = shifted(&moved, dx, dy);
        let (mut diff, mut n) = (0u64, 0u64);
        for y in 20..130 { for x in 20..180 { diff += (back.get_pixel(x, y)[0] as i32 - base.get_pixel(x, y)[0] as i32).unsigned_abs() as u64; n += 1; } }
        assert!(diff as f64 / (n as f64) < 1.0, "wyrównane zdjęcie pasuje do bazy");
        let (imgs, shifts) = align(vec![base.clone(), moved]);
        assert_eq!(imgs.len(), 2);
        assert_eq!(shifts, vec![(0, 0), (7, -5)]);
    }

    #[test]
    fn invalid_input_is_rejected() {
        let a = RgbImage::new(40, 30);
        assert!(fuse(&[a.clone()], Mode::Hdr, &|| false).is_err());
        assert!(fuse(&[a.clone(), RgbImage::new(41, 30)], Mode::Hdr, &|| false).is_err());
        assert!(fuse(&[a.clone(), a], Mode::Hdr, &|| true).is_err(), "przerwanie");
    }
}
