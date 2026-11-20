//! Bezpieczne usuwanie duplikatów. Okno duplikatów wysyła pary „usuń to zdjęcie, bo zostaje tamto”, a tutaj, tuż przed usunięciem,
//! sprawdzamy każdą parę od nowa na dysku: kopia, która ma zostać, musi istnieć, nie może być na liście do usunięcia, nie może być tym samym
//! plikiem (np. ta sama ścieżka zapisana inną wielkością liter), a przy identycznych duplikatach oba pliki muszą być zgodne bajt po bajcie.
//! Para, która nie przejdzie sprawdzenia, jest pomijana i opisana w raporcie. Samo usuwanie (Kosz Windows, zablokowane foldery, słowo
//! potwierdzenia, plik XMP) robi `trash_photos_core`. Każde usunięcie trafia do dziennika z ścieżką kopii, która została.

use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

/// Nazwa dziennika usuniętych duplikatów (obok bazy biblioteki).
pub const LOG_NAME: &str = "usuniete-duplikaty.log";

#[derive(Deserialize, Clone, Debug)]
pub struct DupDelete {
    /// Zdjęcie do przeniesienia do Kosza.
    pub id: i64,
    /// Zdjęcie, które zostaje (jego kopia).
    pub keep: i64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DupSkip {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize, Default, Debug)]
pub struct DupTrashReport {
    pub trashed: usize,
    pub skipped: Vec<DupSkip>,
    /// Gdzie zapisano dziennik (puste, gdy nie zapisano).
    pub log: String,
}

fn read_full(f: &mut File, buf: &mut [u8]) -> io::Result<usize> {
    let mut t = 0;
    while t < buf.len() {
        let n = f.read(&mut buf[t..])?;
        if n == 0 {
            break;
        }
        t += n;
    }
    Ok(t)
}

/// Czy dwa pliki mają identyczną zawartość (najpierw rozmiar, potem bajt po bajcie).
pub fn same_bytes(a: &Path, b: &Path) -> io::Result<bool> {
    if fs::metadata(a)?.len() != fs::metadata(b)?.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (File::open(a)?, File::open(b)?);
    let (mut ba, mut bb) = (vec![0u8; 1 << 16], vec![0u8; 1 << 16]);
    loop {
        let (n, m) = (read_full(&mut fa, &mut ba)?, read_full(&mut fb, &mut bb)?);
        if n != m || ba[..n] != bb[..m] {
            return Ok(false);
        }
        if n == 0 {
            return Ok(true);
        }
    }
}

/// Data i godzina (UTC) do dziennika, bez dodatkowych bibliotek.
fn stamp() -> String {
    let s = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    // Algorytm „civil from days” (H. Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Sprawdza pary i przenosi do Kosza tylko te, które przeszły sprawdzenie. `allow_similar`: zgoda na usunięcie zdjęć tylko podobnych
/// (nie identycznych), np. zmniejszonych kopii; wtedy kopia, która zostaje, nadal musi istnieć.
pub fn trash_duplicates_core(
    state: &AppState,
    items: &[DupDelete],
    allow_similar: bool,
    confirm: Option<String>,
    del: &dyn Fn(&str) -> Result<(), String>,
    log: Option<&Path>,
) -> Result<DupTrashReport, String> {
    let doomed: HashSet<i64> = items.iter().map(|i| i.id).collect();
    let mut seen = HashSet::new();
    let mut ok = Vec::new();
    let mut lines = Vec::new();
    let mut report = DupTrashReport::default();
    for it in items {
        if !seen.insert(it.id) {
            continue;
        }
        let (path, _, _) = crate::photo_path(state, it.id)?;
        let mut skip = |r: String| report.skipped.push(DupSkip { path: path.clone(), reason: r });
        if it.keep == it.id || doomed.contains(&it.keep) {
            skip("kopia, która miała zostać, też była na liście do usunięcia".into());
            continue;
        }
        let Ok((keep_path, _, _)) = crate::photo_path(state, it.keep) else {
            skip("zdjęcia, które miało zostać, nie ma już w bibliotece".into());
            continue;
        };
        let (a, b) = (Path::new(&path), Path::new(&keep_path));
        if !b.is_file() {
            skip(format!("plik, który miał zostać, nie istnieje: {keep_path}"));
            continue;
        }
        if !a.exists() {
            // Pliku już nie ma na dysku: zdjęcie zniknie tylko z biblioteki.
            ok.push(it.id);
            lines.push(format!("{}\tbrak pliku, usunięto z biblioteki\t{path}\tzostaje: {keep_path}", stamp()));
            continue;
        }
        if let (Ok(x), Ok(y)) = (fs::canonicalize(a), fs::canonicalize(b)) {
            if x == y {
                skip("to ten sam plik na dysku, nie ma drugiej kopii".into());
                continue;
            }
        }
        match same_bytes(a, b) {
            Ok(true) => {}
            Ok(false) if allow_similar => {}
            Ok(false) => {
                skip("pliki nie są identyczne (zawartość się różni)".into());
                continue;
            }
            Err(e) => {
                skip(format!("nie udało się porównać plików: {e}"));
                continue;
            }
        }
        ok.push(it.id);
        lines.push(format!("{}\tdo Kosza\t{path}\tzostaje: {keep_path}", stamp()));
    }
    if ok.is_empty() {
        return Ok(report);
    }
    // Dziennik zapisujemy przed usuwaniem, żeby został ślad nawet przy błędzie w połowie.
    if let Some(log) = log {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log) {
            let _ = f.write_all((lines.join("\n") + "\n").as_bytes());
            report.log = log.to_string_lossy().to_string();
        }
    }
    report.trashed = crate::trash_photos_core(state, ok, confirm, del)?;
    Ok(report)
}

/// Przenosi duplikaty do Kosza Windows po ponownym sprawdzeniu każdej pary (patrz opis modułu).
#[tauri::command]
pub fn trash_duplicates(state: State<'_, AppState>, items: Vec<DupDelete>, allow_similar: bool, confirm: Option<String>) -> Result<DupTrashReport, String> {
    let log = state.thumbs.parent().map(|d| d.join(LOG_NAME));
    trash_duplicates_core(&state, &items, allow_similar, confirm, &|p| trash::delete(p).map_err(|e| e.to_string()), log.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_files_byte_by_byte() {
        let dir = std::env::temp_dir().join("mz-dups-bytes");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let big: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let mut other = big.clone();
        other[150_000] ^= 1;
        fs::write(dir.join("a"), &big).unwrap();
        fs::write(dir.join("b"), &big).unwrap();
        fs::write(dir.join("c"), &other).unwrap();
        fs::write(dir.join("d"), &big[..199_999]).unwrap();
        assert!(same_bytes(&dir.join("a"), &dir.join("b")).unwrap());
        assert!(!same_bytes(&dir.join("a"), &dir.join("c")).unwrap(), "jeden inny bajt daleko od początku");
        assert!(!same_bytes(&dir.join("a"), &dir.join("d")).unwrap(), "inny rozmiar");
        assert!(stamp().ends_with("UTC") && stamp().len() == 23);
    }
}
