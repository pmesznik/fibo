//! Kopia zapasowa samych zdjęć na dysk zewnętrzny: kopiuje nowe i zmienione pliki, nigdy niczego nie usuwa.
//! Układ folderów w miejscu docelowym odpowiada obserwowanym folderom (nazwa folderu, a w niej podfoldery).

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::AppState;

#[derive(Serialize, Default, Debug)]
pub struct BackupReport {
    pub copied: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

fn mtime_secs(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Litera dysku (albo nazwa udziału sieciowego) ścieżki, bez dwukropka; None dla ścieżek względnych.
fn drive_of(p: &Path) -> Option<String> {
    match p.components().next() {
        Some(Component::Prefix(pre)) => Some(pre.as_os_str().to_string_lossy().replace([':', '\\', '?', '/'], "")),
        _ => None,
    }
}

/// Ścieżka względna zdjęcia w kopii: „nazwa obserwowanego folderu/podfoldery/plik”. Gdy dwa obserwowane foldery mają tę samą nazwę
/// (np. D:\Zdjecia i E:\Zdjecia), do nazwy dochodzi litera dysku, żeby ich pliki się nie nadpisywały. Zdjęcie spoza obserwowanych folderów
/// ląduje w „Inne/litera dysku/…”, więc nic nie wychodzi poza folder docelowy.
fn relative_target(photo: &Path, roots: &[PathBuf]) -> PathBuf {
    let best = roots.iter().filter(|r| photo.starts_with(r)).max_by_key(|r| r.components().count());
    let name_of = |r: &PathBuf| r.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "Zdjecia".into());
    let (mut head, rest) = match best {
        Some(r) => {
            let mut name = name_of(r);
            if roots.iter().any(|o| o != r && name_of(o) == name) {
                if let Some(d) = drive_of(r) {
                    name = format!("{name} ({d})");
                }
            }
            (PathBuf::from(name), photo.strip_prefix(r).unwrap_or(photo).to_path_buf())
        }
        None => {
            let mut h = PathBuf::from("Inne");
            if let Some(d) = drive_of(photo) {
                h.push(d);
            }
            (h, photo.to_path_buf())
        }
    };
    for c in rest.components() {
        if let Component::Normal(s) = c {
            head.push(s);
        }
    }
    head
}

/// Kopiuje podane pliki do `dest`. `progress(zrobione, razem)` wywoływane po każdym pliku.
pub fn backup_photos_core(photos: &[PathBuf], roots: &[PathBuf], dest: &Path, mut progress: impl FnMut(usize, usize)) -> Result<BackupReport, String> {
    if !dest.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    let dest_canon = dest.canonicalize().map_err(|e| e.to_string())?;
    // Kopia do wnętrza obserwowanego folderu zaśmiecałaby bibliotekę i kopiowała samą siebie.
    for r in roots {
        if let Ok(rc) = r.canonicalize() {
            if dest_canon.starts_with(&rc) {
                return Err("Folder docelowy leży wewnątrz folderu ze zdjęciami. Wskaż inny dysk lub folder".into());
            }
        }
    }
    let mut rep = BackupReport::default();
    let total = photos.len();
    for (i, src) in photos.iter().enumerate() {
        let target = dest.join(relative_target(src, roots));
        let result = (|| -> Result<bool, String> {
            let sm = std::fs::metadata(src).map_err(|e| e.to_string())?;
            if let Ok(tm) = std::fs::metadata(&target) {
                if tm.len() == sm.len() && mtime_secs(&tm) >= mtime_secs(&sm) {
                    return Ok(false);
                }
            }
            if let Some(dir) = target.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            // Najpierw plik tymczasowy, żeby przerwana kopia nie zostawiła uciętego zdjęcia pod docelową nazwą.
            let tmp = target.with_extension("fibo-tmp");
            std::fs::copy(src, &tmp).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &target).map_err(|e| {
                let _ = std::fs::remove_file(&tmp);
                e.to_string()
            })?;
            Ok(true)
        })();
        match result {
            Ok(true) => rep.copied += 1,
            Ok(false) => rep.skipped += 1,
            Err(e) => rep.errors.push(format!("{}: {e}", src.display())),
        }
        progress(i + 1, total);
    }
    Ok(rep)
}

#[tauri::command]
pub async fn backup_photos(app: tauri::AppHandle, dest: String) -> Result<BackupReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = crate::jobs::Guard::new("backup");
        let state = app.state::<AppState>();
        let (photos, roots): (Vec<PathBuf>, Vec<PathBuf>) = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut s = conn.prepare("SELECT path FROM photos WHERE hidden = 0 ORDER BY path").map_err(|e| e.to_string())?;
            let photos = s.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).map(PathBuf::from).collect();
            let mut s = conn.prepare("SELECT path FROM roots").map_err(|e| e.to_string())?;
            let roots = s.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).map(PathBuf::from).collect();
            (photos, roots)
        };
        let mut last = 0usize;
        backup_photos_core(&photos, &roots, Path::new(&dest), |done, total| {
            crate::jobs::tick("backup", done, total);
            // Zdarzenia co 10 plików, żeby nie zalewać interfejsu przy tysiącach małych zdjęć.
            if done == total || done >= last + 10 {
                last = done;
                let _ = app.emit("photo-backup-progress", (done, total));
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_named_roots_and_outside_photos_do_not_collide() {
        let roots = vec![PathBuf::from(r"D:\Zdjecia"), PathBuf::from(r"E:\Zdjecia"), PathBuf::from(r"D:\Inne")];
        let a = relative_target(Path::new(r"D:\Zdjecia\2020\a.jpg"), &roots);
        let b = relative_target(Path::new(r"E:\Zdjecia\2020\a.jpg"), &roots);
        assert_ne!(a, b, "ta sama nazwa folderu na dwóch dyskach");
        assert!(a.to_string_lossy().contains("Zdjecia (D)") && b.to_string_lossy().contains("Zdjecia (E)"));
        // Folder o unikalnej nazwie zostaje bez zmian.
        assert_eq!(relative_target(Path::new(r"D:\Inne\x\a.jpg"), &roots), PathBuf::from("Inne").join("x").join("a.jpg"));
        // Zdjęcia spoza obserwowanych folderów z dwóch dysków też się nie zlewają.
        let c = relative_target(Path::new(r"D:\Luzem\a.jpg"), &[]);
        let d = relative_target(Path::new(r"E:\Luzem\a.jpg"), &[]);
        assert_ne!(c, d);
        assert!(c.starts_with("Inne") && !c.to_string_lossy().contains(':'));
    }

    #[test]
    fn copies_new_and_changed_files_and_never_deletes() {
        let base = std::env::temp_dir().join("mz-photo-backup-test");
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("Zdjecia");
        let dest = base.join("Dysk");
        std::fs::create_dir_all(root.join("Wakacje")).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        let a = root.join("Wakacje").join("a.jpg");
        std::fs::write(&a, b"aaaa").unwrap();
        let roots = vec![root.clone()];

        let r = backup_photos_core(&[a.clone()], &roots, &dest, |_, _| {}).unwrap();
        assert_eq!((r.copied, r.skipped, r.errors.len()), (1, 0, 0));
        assert_eq!(std::fs::read(dest.join("Zdjecia").join("Wakacje").join("a.jpg")).unwrap(), b"aaaa");

        let r = backup_photos_core(&[a.clone()], &roots, &dest, |_, _| {}).unwrap();
        assert_eq!((r.copied, r.skipped), (0, 1), "niezmieniony plik jest pomijany");

        std::fs::write(&a, b"bbbbbb").unwrap();
        let r = backup_photos_core(&[a.clone()], &roots, &dest, |_, _| {}).unwrap();
        assert_eq!(r.copied, 1, "zmieniony plik jest kopiowany ponownie");

        // Zdjęcie usunięte ze źródła zostaje w kopii.
        std::fs::remove_file(&a).unwrap();
        let r = backup_photos_core(&[], &roots, &dest, |_, _| {}).unwrap();
        assert_eq!(r.copied, 0);
        assert!(dest.join("Zdjecia").join("Wakacje").join("a.jpg").exists());

        // Folder docelowy wewnątrz folderu ze zdjęciami jest odrzucany.
        assert!(backup_photos_core(&[], &roots, &root.join("Wakacje"), |_, _| {}).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn photos_outside_roots_stay_inside_destination() {
        let p = relative_target(Path::new(r"C:\Inne\..\x\a.jpg"), &[]);
        assert!(p.starts_with("Inne"));
        assert!(!p.to_string_lossy().contains(".."));
    }
}
