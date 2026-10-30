//! Filmy w bibliotece: metadane z plików MP4 i MOV (data nagrania, rozmiar obrazu, czas trwania) oraz własny, bardzo wąski protokół
//! do odtwarzania. Wszystko lokalnie i bez zewnętrznych programów; okno aplikacji (WebView2) samo dekoduje obraz.
//!
//! Protokół `fibo-video` zwraca bajty pliku filmu wyłącznie po numerze zdjęcia z biblioteki (adres to tylko numer), tylko dla wpisów
//! oznaczonych jako film i tylko dla znanych rozszerzeń filmów. Okno nie dostaje więc żadnej drogi do dowolnych plików na dysku.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use tauri::{http, Manager};

use crate::{formats, AppState};

#[derive(Debug, Default, PartialEq)]
pub struct VideoInfo {
    /// Data nagrania „RRRR-MM-DD GG:MM:SS” (czas zapisany w pliku, zwykle UTC).
    pub taken: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Czas trwania w sekundach.
    pub duration: Option<f64>,
}

/// Największy blok `moov`, jaki wczytujemy do pamięci (opis filmu, nie obraz): większy plik nie jest zwykłym filmem.
const MAX_MOOV: u64 = 32 * 1024 * 1024;
/// Sekundy między 1904-01-01 (początek czasu QuickTime) a 1970-01-01.
const MAC_TO_UNIX: i64 = 2_082_844_800;

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn be64(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

/// Dzieci pudełka (rozmiar, typ, zawartość) z fragmentu pamięci.
fn boxes(data: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= data.len() && out.len() < 4096 {
        let size = be32(data, at).unwrap_or(0) as usize;
        let kind: [u8; 4] = data[at + 4..at + 8].try_into().unwrap();
        let (head, total) = match size {
            0 => (8, data.len() - at),
            1 => match be64(data, at + 8) {
                Some(s) => (16, s as usize),
                None => break,
            },
            s => (8, s),
        };
        if total < head || at + total > data.len() {
            break;
        }
        out.push((kind, &data[at + head..at + total]));
        at += total;
    }
    out
}

fn find<'a>(list: &[([u8; 4], &'a [u8])], kind: &[u8; 4]) -> Option<&'a [u8]> {
    list.iter().find(|(k, _)| k == kind).map(|(_, d)| *d)
}

/// Data nagrania z liczby sekund od 1904 roku. Pliki bez daty zapisują 0, a to nie jest prawdziwa data.
fn taken_from_mac(secs: u64) -> Option<String> {
    let unix = secs as i64 - MAC_TO_UNIX;
    if secs == 0 || unix <= 86400 || unix > 4_102_444_800 {
        return None;
    }
    let (y, m, d) = crate::civil_from_days(unix / 86400);
    let r = unix % 86400;
    Some(format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", r / 3600, r % 3600 / 60, r % 60))
}

/// Odczyt opisu filmu (zawartość pudełka `moov`).
fn parse_moov(moov: &[u8]) -> VideoInfo {
    let mut info = VideoInfo::default();
    let top = boxes(moov);
    if let Some(mvhd) = find(&top, b"mvhd") {
        let v1 = mvhd.first() == Some(&1);
        let (created, scale, dur) = if v1 {
            (be64(mvhd, 4), be32(mvhd, 20), be64(mvhd, 24))
        } else {
            (be32(mvhd, 4).map(u64::from), be32(mvhd, 12), be32(mvhd, 16).map(u64::from))
        };
        info.taken = created.and_then(taken_from_mac);
        if let (Some(scale), Some(dur)) = (scale, dur) {
            if scale > 0 && dur != u64::MAX {
                info.duration = Some(dur as f64 / scale as f64);
            }
        }
    }
    // Pierwsza ścieżka z niezerowym rozmiarem obrazu to film (ścieżki dźwięku mają rozmiar 0).
    for (kind, trak) in &top {
        if kind != b"trak" {
            continue;
        }
        let Some(tkhd) = find(&boxes(trak), b"tkhd") else { continue };
        let v1 = tkhd.first() == Some(&1);
        let matrix = if v1 { 52 } else { 40 };
        let (w, h) = (be32(tkhd, matrix + 36), be32(tkhd, matrix + 40));
        let (Some(w), Some(h)) = (w, h) else { continue };
        let (w, h) = (w >> 16, h >> 16);
        if w == 0 || h == 0 {
            continue;
        }
        // Film nagrany telefonem „na stojąco” ma obraz obrócony macierzą o 90 stopni: do siatki liczą się proporcje po obrocie.
        let (a, b) = (be32(tkhd, matrix).unwrap_or(0x10000), be32(tkhd, matrix + 4).unwrap_or(0));
        let rotated = a == 0 && b != 0;
        (info.width, info.height) = if rotated { (Some(h), Some(w)) } else { (Some(w), Some(h)) };
        break;
    }
    info
}

/// Metadane filmu MP4 lub MOV. Zwraca None dla innych kontenerów (WebM i inne): taki film ma wtedy tylko nazwę i datę pliku.
pub fn read_info(path: &Path) -> Option<VideoInfo> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut at = 0u64;
    for _ in 0..64 {
        if at + 8 > len {
            break;
        }
        f.seek(SeekFrom::Start(at)).ok()?;
        let mut head = [0u8; 16];
        let n = f.read(&mut head).ok()?;
        if n < 8 {
            break;
        }
        let size32 = u32::from_be_bytes(head[0..4].try_into().ok()?) as u64;
        let kind: [u8; 4] = head[4..8].try_into().ok()?;
        let (hl, size) = match size32 {
            0 => (8u64, len - at),
            1 if n >= 16 => (16, u64::from_be_bytes(head[8..16].try_into().ok()?)),
            s => (8, s),
        };
        if size < hl || at + size > len {
            break;
        }
        if &kind == b"moov" {
            if size - hl > MAX_MOOV {
                return None;
            }
            f.seek(SeekFrom::Start(at + hl)).ok()?;
            let mut buf = vec![0u8; (size - hl) as usize];
            f.read_exact(&mut buf).ok()?;
            return Some(parse_moov(&buf));
        }
        at += size;
    }
    None
}

fn content_type(path: &Path) -> &'static str {
    match formats::ext_of(path).as_str() {
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        _ => "video/mp4",
    }
}

/// Największy fragment zwracany jednym żądaniem; odtwarzacz dopytuje o kolejne, więc film nie trafia do pamięci w całości.
const CHUNK: u64 = 8 * 1024 * 1024;

/// Zakres bajtów z nagłówka „bytes=od-do” (także „bytes=od-” i „bytes=-ostatnie”).
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    if len == 0 || spec.contains(',') {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return None;
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { len - 1 } else { b.parse::<u64>().ok()?.min(len - 1) };
        (start, end)
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end.min(start + CHUNK - 1)))
}

fn respond(status: u16, body: Vec<u8>, extra: &[(&str, String)]) -> http::Response<Vec<u8>> {
    let mut b = http::Response::builder().status(status).header("Access-Control-Allow-Origin", "*").header("Cache-Control", "no-store");
    for (k, v) in extra {
        b = b.header(*k, v.as_str());
    }
    b.body(body).unwrap_or_else(|_| http::Response::new(Vec::new()))
}

/// Obsługa adresu `fibo-video://localhost/<numer>` (w Windows `http://fibo-video.localhost/<numer>`).
pub fn protocol(app: &tauri::AppHandle, request: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let Ok(id) = request.uri().path().trim_matches('/').parse::<i64>() else { return respond(404, Vec::new(), &[]) };
    let state = app.state::<AppState>();
    let path: Option<String> = state
        .db
        .lock()
        .ok()
        .and_then(|c| c.query_row("SELECT path FROM photos WHERE id = ?1 AND video = 1 AND hidden = 0", [id], |r| r.get(0)).ok());
    let Some(path) = path else { return respond(404, Vec::new(), &[]) };
    let p = Path::new(&path);
    if !formats::is_video(p) {
        return respond(403, Vec::new(), &[]);
    }
    let Ok(mut f) = File::open(p) else { return respond(404, Vec::new(), &[]) };
    let Ok(len) = f.metadata().map(|m| m.len()) else { return respond(404, Vec::new(), &[]) };
    let range = request.headers().get("range").and_then(|v| v.to_str().ok()).map(|h| parse_range(h, len));
    let (start, end) = match range {
        Some(Some(r)) => r,
        Some(None) => return respond(416, Vec::new(), &[("Content-Range", format!("bytes */{len}"))]),
        // Bez nagłówka Range zaczynamy od początku, ale i tak oddajemy tylko pierwszy fragment.
        None => parse_range("bytes=0-", len).unwrap_or((0, 0)),
    };
    if len == 0 {
        return respond(200, Vec::new(), &[("Content-Type", content_type(p).to_string()), ("Content-Length", "0".to_string())]);
    }
    let mut buf = vec![0u8; (end - start + 1) as usize];
    if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut buf).is_err() {
        return respond(500, Vec::new(), &[]);
    }
    respond(
        206,
        buf,
        &[
            ("Content-Type", content_type(p).to_string()),
            ("Content-Range", format!("bytes {start}-{end}/{len}")),
            ("Content-Length", (end - start + 1).to_string()),
            ("Accept-Ranges", "bytes".to_string()),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(kind);
        v.extend_from_slice(body);
        v
    }

    fn mvhd(created: u32, scale: u32, dur: u32) -> Vec<u8> {
        let mut b = vec![0, 0, 0, 0];
        for x in [created, created, scale, dur] {
            b.extend_from_slice(&x.to_be_bytes());
        }
        b.extend_from_slice(&[0u8; 80]);
        bx(b"mvhd", &b)
    }

    fn tkhd(w: u32, h: u32, rotated: bool) -> Vec<u8> {
        let mut b = vec![0u8; 84];
        // Macierz zaczyna się od bajtu 40: a, b, u, c, d, v, x, y, w.
        let m: [u32; 9] = if rotated { [0, 0x10000, 0, 0xFFFF0000, 0, 0, 0, 0, 0x40000000] } else { [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000] };
        for (i, x) in m.iter().enumerate() {
            b[40 + i * 4..44 + i * 4].copy_from_slice(&x.to_be_bytes());
        }
        b[76..80].copy_from_slice(&(w << 16).to_be_bytes());
        b[80..84].copy_from_slice(&(h << 16).to_be_bytes());
        bx(b"tkhd", &b)
    }

    fn movie(rotated: bool) -> Vec<u8> {
        // 2024-05-01 10:00:00 UTC to 1714557600 s od 1970, a od 1904 o 2082844800 więcej.
        let created = (1_714_557_600u64 + MAC_TO_UNIX as u64) as u32;
        let audio = bx(b"trak", &tkhd(0, 0, false));
        let video = bx(b"trak", &tkhd(1920, 1080, rotated));
        let moov = bx(b"moov", &[mvhd(created, 1000, 12_500), audio, video].concat());
        [bx(b"ftyp", b"isom\0\0\0\0isom"), bx(b"mdat", &[0u8; 100]), moov].concat()
    }

    #[test]
    fn reads_date_size_and_duration_even_when_moov_is_at_the_end() {
        let dir = std::env::temp_dir().join("mz-video-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.mp4");
        std::fs::write(&f, movie(false)).unwrap();
        let info = read_info(&f).unwrap();
        assert_eq!(info.taken.as_deref(), Some("2024-05-01 10:00:00"));
        assert_eq!((info.width, info.height), (Some(1920), Some(1080)));
        assert_eq!(info.duration, Some(12.5));
    }

    #[test]
    fn rotated_video_swaps_dimensions_and_garbage_gives_none() {
        let dir = std::env::temp_dir().join("mz-video-test2");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("r.mov");
        std::fs::write(&f, movie(true)).unwrap();
        let info = read_info(&f).unwrap();
        assert_eq!((info.width, info.height), (Some(1080), Some(1920)), "film pionowy");
        std::fs::write(dir.join("x.mp4"), b"to nie jest film, tylko tekst o filmie").unwrap();
        assert!(read_info(&dir.join("x.mp4")).is_none());
        assert!(read_info(&dir.join("brak.mp4")).is_none());
        std::fs::write(dir.join("short.mp4"), b"abc").unwrap();
        assert!(read_info(&dir.join("short.mp4")).is_none());
        // Pudełko, które twierdzi, że jest większe niż plik, nie powoduje paniki ani wczytywania w nieskończoność.
        let mut lie = vec![0xFF, 0xFF, 0xFF, 0xF0];
        lie.extend_from_slice(b"moov");
        lie.extend_from_slice(&[0u8; 20]);
        std::fs::write(dir.join("lie.mp4"), lie).unwrap();
        assert!(read_info(&dir.join("lie.mp4")).is_none());
    }

    #[test]
    fn zero_creation_time_is_not_a_date() {
        assert_eq!(taken_from_mac(0), None);
        assert_eq!(taken_from_mac(5), None);
        assert!(taken_from_mac((1_714_557_600u64 + MAC_TO_UNIX as u64) as u64).is_some());
    }

    #[test]
    fn range_header_parsing_is_strict_and_capped() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)), "koniec poza plikiem jest przycinany");
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-2", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-9", 1000), None);
        assert_eq!(parse_range("bajty=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
        assert_eq!(parse_range("bytes=0-", 100_000_000), Some((0, CHUNK - 1)), "jeden fragment, nie cały film");
    }
}
