//! Panoramy: zszywanie 2 do 9 zdjęć zrobionych obok siebie (z nakładaniem się kadrów). Program szuka przesunięcia każdej pary sąsiednich
//! zdjęć (korelacja jasności, od zgrubnego do dokładnego), wyrównuje ich jasność i łączy je płynnym przejściem w miejscu nakładania.
//! Wszystko lokalnie, bez dodatkowych bibliotek i bez sieci. Wynik to nowy plik JPEG obok pierwszego zdjęcia, oryginały zostają.
//! Ograniczenie: korygowane jest tylko przesunięcie (poziome i pionowe), a nie obrót ani perspektywa. Najlepiej wychodzą zdjęcia
//! robione ze statywu albo obracając się wokół własnej osi, bez dużych elementów blisko aparatu.

use image::{imageops::FilterType, RgbImage};
use serde::Serialize;

use crate::AppState;

pub const MIN_PHOTOS: usize = 2;
pub const MAX_PHOTOS: usize = 9;
/// Najmniejsza i największa część kadru, która ma się nakładać na sąsiedni kadr.
const MIN_OVERLAP: f32 = 0.12;
const MAX_OVERLAP: f32 = 0.85;
/// Najniższa zgodność, przy której uznajemy, że dwa zdjęcia mają wspólny fragment.
const MIN_SCORE: f32 = 0.55;

struct Gray {
    w: usize,
    h: usize,
    d: Vec<f32>,
}

fn gray_at(img: &RgbImage, width: u32) -> Gray {
    let width = width.min(img.width()).max(8);
    let height = ((img.height() as f32 * width as f32 / img.width() as f32).round() as u32).max(8);
    let s = if width == img.width() { img.clone() } else { image::imageops::resize(img, width, height, FilterType::Triangle) };
    let d = s.pixels().map(|p| 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32).collect();
    Gray { w: s.width() as usize, h: s.height() as usize, d }
}

/// Zgodność (korelacja z odjętą średnią, od -1 do 1) obrazu `b` położonego z przesunięciem (dx, dy) względem `a`; -1, gdy wspólny fragment jest za mały albo płaski.
fn ncc(a: &Gray, b: &Gray, dx: i32, dy: i32, step: usize) -> f32 {
    let (w, h) = (a.w as i32, a.h as i32);
    let (x0, x1) = (dx.max(0), (dx + b.w as i32).min(w));
    let (y0, y1) = (dy.max(0), (dy + b.h as i32).min(h));
    if x1 - x0 < 8 || y1 - y0 < 8 {
        return -1.0;
    }
    let (mut sa, mut sb, mut saa, mut sbb, mut sab, mut n) = (0f64, 0f64, 0f64, 0f64, 0f64, 0f64);
    let mut y = y0;
    while y < y1 {
        let mut x = x0;
        while x < x1 {
            let va = a.d[y as usize * a.w + x as usize] as f64;
            let vb = b.d[(y - dy) as usize * b.w + (x - dx) as usize] as f64;
            sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n += 1.0;
            x += step as i32;
        }
        y += step as i32;
    }
    if n < 40.0 {
        return -1.0;
    }
    let (va, vb) = (n * saa - sa * sa, n * sbb - sb * sb);
    if va < 1e-6 * n * n || vb < 1e-6 * n * n {
        return -1.0;
    }
    ((n * sab - sa * sb) / (va * vb).sqrt()) as f32
}

/// Najlepsze przesunięcie (dx, dy) w podanych zakresach i jego zgodność.
fn search(a: &Gray, b: &Gray, dxs: std::ops::RangeInclusive<i32>, dys: std::ops::RangeInclusive<i32>, step: usize) -> (i32, i32, f32) {
    let (mut best, mut at) = (-2f32, (0, 0));
    for dy in dys.clone() {
        for dx in dxs.clone() {
            let c = ncc(a, b, dx, dy, step);
            if c > best {
                best = c;
                at = (dx, dy);
            }
        }
    }
    (at.0, at.1, best)
}

/// Przesunięcie (dx, dy) zdjęcia `b` względem `a` w pikselach pełnego obrazu oraz zgodność. Szukanie w trzech krokach: zgrubne, średnie, dokładne.
pub fn pair_offset(a: &RgbImage, b: &RgbImage) -> (i32, i32, f32) {
    let (ca, cb) = (gray_at(a, 160), gray_at(b, 160));
    let w = ca.w as i32;
    let (lo, hi) = ((w as f32 * (1.0 - MAX_OVERLAP)) as i32, (w as f32 * (1.0 - MIN_OVERLAP)) as i32);
    let dyr = (ca.h as f32 * 0.10) as i32;
    // B po prawej (dx > 0) albo po lewej (dx < 0) od A.
    let r = search(&ca, &cb, lo..=hi, -dyr..=dyr, 1);
    let l = search(&ca, &cb, -hi..=-lo, -dyr..=dyr, 1);
    let (dx0, dy0, s0) = if r.2 >= l.2 { r } else { l };
    if s0 < 0.2 {
        return (dx0 * (a.width() as i32 / 160).max(1), dy0 * (a.width() as i32 / 160).max(1), s0);
    }
    // Średni poziom: 3 razy dokładniej.
    let (ma, mb) = (gray_at(a, 480), gray_at(b, 480));
    let k1 = ma.w as f32 / ca.w as f32;
    let (cx, cy) = ((dx0 as f32 * k1).round() as i32, (dy0 as f32 * k1).round() as i32);
    let rad = k1.ceil() as i32 + 1;
    let (dx1, dy1, s1) = search(&ma, &mb, cx - rad..=cx + rad, cy - rad..=cy + rad, 1);
    // Dokładny poziom: pełny obraz (do ok. 1400 px szerokości dla szybkości, potem przeliczenie).
    let fw = a.width().min(1400);
    let (fa, fb) = (gray_at(a, fw), gray_at(b, fw));
    let k2 = fa.w as f32 / ma.w as f32;
    let (cx2, cy2) = ((dx1 as f32 * k2).round() as i32, (dy1 as f32 * k2).round() as i32);
    let rad2 = k2.ceil() as i32 + 1;
    let (dx2, dy2, s2) = search(&fa, &fb, cx2 - rad2..=cx2 + rad2, cy2 - rad2..=cy2 + rad2, 2);
    let back = a.width() as f32 / fa.w as f32;
    ((dx2 as f32 * back).round() as i32, (dy2 as f32 * back).round() as i32, s2.max(s1.min(s2)))
}

#[derive(Debug, PartialEq)]
pub struct Layout {
    /// Położenie lewego górnego rogu każdego zdjęcia w panoramie (po przycięciu pionowym).
    pub pos: Vec<(i32, i32)>,
    pub width: u32,
    pub height: u32,
}

/// Układ panoramy z przesunięć kolejnych par: wszystkie zdjęcia mają wymiary (w, h); wynik jest przycięty pionowo do wspólnego pasa,
/// żeby nie było pustych brzegów. Błąd, gdy wspólny pas jest zbyt wąski (zdjęcia za bardzo „jeżdżą” w pionie).
pub fn layout(offsets: &[(i32, i32)], w: u32, h: u32) -> Result<Layout, String> {
    let mut abs = vec![(0i32, 0i32)];
    for &(dx, dy) in offsets {
        let &(px, py) = abs.last().unwrap();
        abs.push((px + dx, py + dy));
    }
    let (minx, maxx) = (abs.iter().map(|p| p.0).min().unwrap(), abs.iter().map(|p| p.0).max().unwrap());
    let top = abs.iter().map(|p| p.1).max().unwrap();
    let bottom = abs.iter().map(|p| p.1 + h as i32).min().unwrap();
    if bottom - top < (h as i32) / 2 {
        return Err("Zdjęcia za bardzo różnią się wysokością kadru, więc nie da się ich równo zszyć".into());
    }
    let pos = abs.iter().map(|&(x, y)| (x - minx, y - top)).collect::<Vec<_>>();
    Ok(Layout { pos, width: (maxx - minx) as u32 + w, height: (bottom - top) as u32 })
}

/// Średnia jasność kanałów w części wspólnej dwóch zdjęć (co 4. piksel).
fn overlap_means(a: &RgbImage, pa: (i32, i32), b: &RgbImage, pb: (i32, i32)) -> Option<([f64; 3], [f64; 3])> {
    let (x0, x1) = (pa.0.max(pb.0), (pa.0 + a.width() as i32).min(pb.0 + b.width() as i32));
    let (y0, y1) = (pa.1.max(pb.1), (pa.1 + a.height() as i32).min(pb.1 + b.height() as i32));
    if x1 - x0 < 8 || y1 - y0 < 8 {
        return None;
    }
    let (mut ma, mut mb, mut n) = ([0f64; 3], [0f64; 3], 0f64);
    let mut y = y0;
    while y < y1 {
        let mut x = x0;
        while x < x1 {
            let (pixa, pixb) = (a.get_pixel((x - pa.0) as u32, (y - pa.1) as u32), b.get_pixel((x - pb.0) as u32, (y - pb.1) as u32));
            for c in 0..3 { ma[c] += pixa[c] as f64; mb[c] += pixb[c] as f64; }
            n += 1.0;
            x += 4;
        }
        y += 4;
    }
    Some(([ma[0] / n, ma[1] / n, ma[2] / n], [mb[0] / n, mb[1] / n, mb[2] / n]))
}

/// Mnożniki jasności (na kanał) wyrównujące ekspozycję sąsiednich zdjęć; średnia mnożników to 1, a skrajne wartości są ograniczone.
fn gains(imgs: &[RgbImage], pos: &[(i32, i32)]) -> Vec<[f32; 3]> {
    let mut g = vec![[1f64; 3]];
    for i in 1..imgs.len() {
        let mut next = g[i - 1];
        if let Some((ma, mb)) = overlap_means(&imgs[i - 1], pos[i - 1], &imgs[i], pos[i]) {
            for c in 0..3 {
                if mb[c] > 1.0 { next[c] = (g[i - 1][c] * ma[c] / mb[c]).clamp(0.6, 1.6); }
            }
        }
        g.push(next);
    }
    let mean: [f64; 3] = [0, 1, 2].map(|c| g.iter().map(|v| v[c]).sum::<f64>() / g.len() as f64);
    g.iter().map(|v| [0, 1, 2].map(|c| (v[c] / mean[c]) as f32)).collect()
}

/// Skleja zdjęcia według układu: w miejscu nakładania wagi maleją ku brzegom każdego zdjęcia, więc przejście jest płynne.
pub fn compose(imgs: &[RgbImage], lay: &Layout) -> RgbImage {
    let g = gains(imgs, &lay.pos);
    let mut out = RgbImage::new(lay.width, lay.height);
    for y in 0..lay.height as i32 {
        for x in 0..lay.width as i32 {
            let (mut acc, mut wsum) = ([0f32; 3], 0f32);
            for (i, im) in imgs.iter().enumerate() {
                let (lx, ly) = (x - lay.pos[i].0, y - lay.pos[i].1);
                if lx < 0 || ly < 0 || lx >= im.width() as i32 || ly >= im.height() as i32 {
                    continue;
                }
                let wt = (lx + 1).min(im.width() as i32 - lx).min((ly + 1).min(im.height() as i32 - ly)) as f32;
                let p = im.get_pixel(lx as u32, ly as u32);
                for c in 0..3 { acc[c] += wt * p[c] as f32 * g[i][c]; }
                wsum += wt;
            }
            if wsum > 0.0 {
                out.put_pixel(x as u32, y as u32, image::Rgb([0, 1, 2].map(|c| (acc[c] / wsum).round().clamp(0.0, 255.0) as u8)));
            }
        }
    }
    out
}

/// Zszywa zdjęcia w kolejności podanej (sąsiednie mają się nakładać). Zwraca panoramę i przesunięcia kolejnych par.
pub fn stitch(imgs: &[RgbImage]) -> Result<(RgbImage, Vec<(i32, i32)>), String> {
    if imgs.len() < MIN_PHOTOS {
        return Err(format!("Wybierz od {MIN_PHOTOS} do {MAX_PHOTOS} zdjęć"));
    }
    let mut offsets = Vec::new();
    for (i, pair) in imgs.windows(2).enumerate() {
        let (dx, dy, score) = pair_offset(&pair[0], &pair[1]);
        if score < MIN_SCORE {
            return Err(format!("Zdjęcia {} i {} nie mają wspólnego fragmentu, który program potrafi dopasować. Kadry powinny nakładać się na siebie w co najmniej jednej dziesiątej szerokości", i + 1, i + 2));
        }
        offsets.push((dx, dy));
    }
    let lay = layout(&offsets, imgs[0].width(), imgs[0].height())?;
    Ok((compose(imgs, &lay), offsets))
}

#[derive(Serialize, Debug)]
pub struct PanoReport {
    pub id: i64,
    pub path: String,
    pub width: u32,
    pub height: u32,
}

pub fn pano_blocking(state: &AppState, ids: &[i64]) -> Result<PanoReport, String> {
    if ids.len() < MIN_PHOTOS || ids.len() > MAX_PHOTOS {
        return Err(format!("Wybierz od {MIN_PHOTOS} do {MAX_PHOTOS} zdjęć"));
    }
    let _job = crate::jobs::Guard::new("merge");
    let (mut paths, mut taken, mut camera) = (Vec::new(), None, None);
    for (k, id) in ids.iter().enumerate() {
        let (p, t, c) = crate::photo_path(state, *id)?;
        if k == 0 {
            taken = t;
            camera = c;
        }
        paths.push(p);
    }
    crate::jobs::tick("merge", 0, 3);
    let mut imgs = Vec::new();
    for p in &paths {
        imgs.push(crate::merge::load_upright(p)?);
    }
    let (w, h) = (imgs[0].width(), imgs[0].height());
    for im in imgs.iter_mut() {
        if im.width() != w || im.height() != h {
            let ratio_ok = ((im.width() as f32 / im.height() as f32) / (w as f32 / h as f32) - 1.0).abs() < 0.03;
            if !ratio_ok {
                return Err("Zdjęcia mają różne proporcje, więc nie da się ich zszyć".into());
            }
            *im = image::imageops::resize(im, w, h, FilterType::Triangle);
        }
    }
    crate::jobs::tick("merge", 1, 3);
    let (pano, _) = stitch(&imgs)?;
    crate::jobs::tick("merge", 2, 3);
    let first = std::path::Path::new(&paths[0]);
    let stem = first.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "zdjecie".into());
    let dest = crate::unique_target(first.parent().unwrap_or(std::path::Path::new(".")), &format!("{stem}_panorama.jpg"));
    let (width, height) = (pano.width(), pano.height());
    crate::encode_export(&image::DynamicImage::ImageRgb8(pano), "jpg", 92, &dest)?;
    let id = crate::reindex(state, &dest, taken, camera)?;
    Ok(PanoReport { id, path: dest.to_string_lossy().to_string(), width, height })
}

#[tauri::command]
pub async fn stitch_panorama(app: tauri::AppHandle, ids: Vec<i64>) -> Result<PanoReport, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        pano_blocking(&state, &ids)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    /// Szeroka scena z fakturą bez powtórzeń (pseudolosowe plamy), z której wycinamy kadry.
    fn scene(w: u32, h: u32) -> RgbImage {
        let hash = |x: u32, y: u32| -> f32 {
            let mut v = x.wrapping_mul(374761393).wrapping_add(y.wrapping_mul(668265263));
            v = (v ^ (v >> 13)).wrapping_mul(1274126177);
            ((v ^ (v >> 16)) & 0xff) as f32 / 255.0
        };
        // Gładka faktura: średnia z bloków 6x6 i łagodny gradient.
        RgbImage::from_fn(w, h, |x, y| {
            let (bx, by) = (x / 6, y / 6);
            let v = 0.25 + 0.5 * hash(bx, by) + 0.2 * (x as f32 / w as f32);
            let g = hash(bx + 7, by + 3);
            Rgb([(v * 255.0).clamp(0.0, 255.0) as u8, ((v * 0.9 + 0.1 * g) * 255.0).clamp(0.0, 255.0) as u8, ((v * 0.8 + 0.2 * g) * 255.0).clamp(0.0, 255.0) as u8])
        })
    }
    fn crop(s: &RgbImage, x: u32, y: u32, w: u32, h: u32) -> RgbImage {
        image::imageops::crop_imm(s, x, y, w, h).to_image()
    }

    #[test]
    fn pair_offset_finds_the_overlap_shift_including_vertical_drift() {
        let s = scene(900, 400);
        let (a, b) = (crop(&s, 0, 10, 480, 300), crop(&s, 300, 16, 480, 300));
        let (dx, dy, score) = pair_offset(&a, &b);
        assert!((dx - 300).abs() <= 3, "dx = {dx}");
        assert!((dy - 6).abs() <= 3, "dy = {dy}");
        assert!(score > 0.8, "score = {score}");
    }

    #[test]
    fn pair_offset_works_when_the_second_photo_is_on_the_left() {
        let s = scene(900, 400);
        let (a, b) = (crop(&s, 300, 10, 480, 300), crop(&s, 0, 10, 480, 300));
        let (dx, _, score) = pair_offset(&a, &b);
        assert!((dx + 300).abs() <= 3, "dx = {dx}");
        assert!(score > 0.8);
    }

    #[test]
    fn layout_trims_to_the_common_vertical_band() {
        let l = layout(&[(300, 6), (290, -10)], 480, 300).unwrap();
        assert_eq!(l.pos[0], (0, -6), "pierwszy kadr zaczyna się wyżej niż wspólny pas");
        assert_eq!(l.width, 300 + 290 + 480);
        assert_eq!(l.height, 290, "wspólny pas: od najniższej górnej krawędzi do najwyższej dolnej");
        assert!(layout(&[(300, 250)], 480, 300).is_err(), "kadry prawie się nie pokrywają w pionie");
    }

    #[test]
    fn stitching_three_shots_rebuilds_the_scene() {
        let s = scene(1200, 400);
        let shots = vec![crop(&s, 0, 20, 500, 300), crop(&s, 320, 24, 500, 300), crop(&s, 640, 17, 500, 300)];
        let (pano, offsets) = stitch(&shots).unwrap();
        assert_eq!(offsets.len(), 2);
        assert!((pano.width() as i32 - 1140).abs() <= 8, "szerokość {}", pano.width());
        assert!(pano.height() >= 290 && pano.height() <= 300, "wysokość {}", pano.height());
        // Środek panoramy zgadza się ze sceną (po uwzględnieniu przycięcia pionowego).
        let top = 24u32; // najwyższa górna krawędź kadrów
        let (mut sum, mut n) = (0f64, 0f64);
        for y in (10..pano.height() - 10).step_by(7) {
            for x in (20..pano.width() - 20).step_by(7) {
                let (p, q) = (pano.get_pixel(x, y), s.get_pixel(x, y + top));
                sum += (p[0] as f64 - q[0] as f64).abs();
                n += 1.0;
            }
        }
        assert!(sum / n < 6.0, "średnia różnica {}", sum / n);
    }

    #[test]
    fn exposure_difference_between_shots_is_evened_out() {
        let s = scene(900, 400);
        let a = crop(&s, 0, 10, 480, 300);
        let mut b = crop(&s, 300, 10, 480, 300);
        for p in b.pixels_mut() { for c in 0..3 { p[c] = (p[c] as f32 * 0.75) as u8; } }
        let (pano, _) = stitch(&[a, b]).unwrap();
        let mean = |x0: u32, x1: u32| { let (mut sum, mut n) = (0f64, 0f64); for y in (0..pano.height()).step_by(5) { for x in (x0..x1).step_by(5) { sum += pano.get_pixel(x, y)[0] as f64; n += 1.0; } } sum / n };
        // Pasy tuż przed i tuż za miejscem nakładania (tylko pierwsze albo tylko drugie zdjęcie), z niewielkim naturalnym gradientem sceny.
        let (left, right) = (mean(240, 290), mean(490, 540));
        assert!((left / right - 1.0).abs() < 0.10, "lewa {left}, prawa {right}");
    }

    #[test]
    fn unrelated_photos_are_rejected_with_a_clear_message() {
        let a = scene(480, 300);
        let b = RgbImage::from_fn(480, 300, |x, y| Rgb([((x * 7 + y * 13) % 251) as u8, ((x * 3 + y * 5) % 241) as u8, ((x * 11 + y) % 239) as u8]));
        let e = stitch(&[a, b]).unwrap_err();
        assert!(e.contains("nie mają wspólnego fragmentu"), "{e}");
    }
}
