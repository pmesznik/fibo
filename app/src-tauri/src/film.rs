//! Zapis filmu ze zdjęć. Film powstaje w oknie programu (kodowanie robi przeglądarka okna, lokalnie), a ten moduł tylko sprawdza i zapisuje gotowy plik
//! w wybranym folderze. Plik musi być prawdziwym MP4 albo WebM do 1 GB, nazwa jest ograniczona do bezpiecznych znaków, a istniejący plik nie jest nadpisywany.

use std::path::Path;

/// Największy dopuszczony film (bajty).
pub const MAX_FILM_BYTES: usize = 1 << 30;

/// Dekoduje zapis procentowy (`%C5%81` itd.) do tekstu UTF-8; błędny zapis daje None.
pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Sprawdza nazwę i zawartość filmu; zwraca rozszerzenie (mp4 albo webm).
pub fn check_film(name: &str, bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.len() < 32 || bytes.len() > MAX_FILM_BYTES {
        return Err("Film jest pusty albo większy niż 1 GB".into());
    }
    let ok_name = name.len() <= 80 && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    let (stem, ext) = name.rsplit_once('.').ok_or("Zła nazwa pliku filmu")?;
    if !ok_name || stem.is_empty() || stem.contains('.') {
        return Err("Zła nazwa pliku filmu".into());
    }
    match ext {
        "mp4" if &bytes[4..8] == b"ftyp" => Ok("mp4"),
        "webm" if bytes[..4] == [0x1A, 0x45, 0xDF, 0xA3] => Ok("webm"),
        _ => Err("To nie jest plik MP4 ani WebM".into()),
    }
}

/// Zapisuje film w folderze (nagłówki `dest` i `name`, zapis procentowy) i zwraca pełną ścieżkę zapisanego pliku.
#[tauri::command]
pub fn save_film(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("brak danych filmu".into()) };
    let hdr = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).and_then(percent_decode);
    let (dest, name) = (hdr("dest").ok_or("brak folderu")?, hdr("name").ok_or("brak nazwy")?);
    check_film(&name, bytes)?;
    let dir = Path::new(&dest);
    if !dir.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    let target = crate::unique_target(dir, &name);
    crate::write_atomic(&target, bytes)?;
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mp4() -> Vec<u8> { let mut v = vec![0, 0, 0, 24]; v.extend_from_slice(b"ftypisom"); v.extend(vec![0u8; 40]); v }
    fn webm() -> Vec<u8> { let mut v = vec![0x1A, 0x45, 0xDF, 0xA3]; v.extend(vec![0u8; 60]); v }

    #[test]
    fn percent_decoding_handles_unicode_and_bad_input() {
        assert_eq!(percent_decode("C%3A%5CZdj%C4%99cia").as_deref(), Some(r"C:\Zdjęcia"));
        assert_eq!(percent_decode("abc").as_deref(), Some("abc"));
        assert_eq!(percent_decode("%zz"), None);
        assert_eq!(percent_decode("%C5"), None);
        assert_eq!(percent_decode("%"), None);
    }

    #[test]
    fn only_real_films_with_safe_names_are_accepted() {
        assert_eq!(check_film("film_2026.mp4", &mp4()), Ok("mp4"));
        assert_eq!(check_film("film.webm", &webm()), Ok("webm"));
        assert!(check_film("film.mp4", &webm()).is_err(), "rozszerzenie nie zgadza się z zawartością");
        assert!(check_film("film.exe", &mp4()).is_err());
        assert!(check_film(r"..\film.mp4", &mp4()).is_err());
        assert!(check_film("a/b.mp4", &mp4()).is_err());
        assert!(check_film("film.tar.mp4", &mp4()).is_err());
        assert!(check_film(".mp4", &mp4()).is_err());
        assert!(check_film("film.mp4", &[0u8; 10]).is_err());
        assert!(check_film("zażółć.mp4", &mp4()).is_err(), "tylko ASCII");
    }
}
