//! Eksport galerii HTML (strona offline do przeglądania zdjęć w przeglądarce) i zmiana nazwy folderu ze zdjęciami.

use std::{
    fs::{self, File},
    path::{Path, PathBuf},
};

use image::imageops::FilterType;
use rusqlite::{params, Connection};
use tauri::State;

use crate::{photo_path, read_exif, unique_target, valid_stem, xml_escape, AppState, MoveReport};

const THUMB: u32 = 360;

/// Tworzy w `dest` nowy folder z galerią: `index.html` (bez żadnych zewnętrznych zasobów i skryptów z internetu),
/// pomniejszone zdjęcia i miniatury. Zdjęcia są kopiowane jako JPEG bez EXIF (bez lokalizacji), oryginały nie są ruszane.
pub fn gallery_core(state: &AppState, ids: &[i64], dest: &Path, title: &str, max_side: u32, quality: u8) -> Result<(PathBuf, MoveReport), String> {
    if !dest.is_dir() {
        return Err("Folder docelowy nie istnieje".into());
    }
    if ids.is_empty() {
        return Err("Zaznacz zdjęcia do galerii".into());
    }
    if !(200..=8000).contains(&max_side) {
        return Err("Rozmiar zdjęć poza zakresem 200-8000 px".into());
    }
    let title = title.trim();
    let folder_name = valid_stem(if title.is_empty() { "Galeria" } else { title })?;
    let root = unique_target(dest, &folder_name);
    fs::create_dir_all(root.join("zdjecia")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("miniatury")).map_err(|e| e.to_string())?;
    let quality = quality.clamp(1, 100);
    let mut rep = MoveReport::default();
    let mut items = String::new();
    for (n, &id) in ids.iter().enumerate() {
        let (path, taken, _) = photo_path(state, id)?;
        let src = PathBuf::from(&path);
        let name = src.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let caption: Option<String> = state
            .db
            .lock()
            .map_err(|e| e.to_string())?
            .query_row("SELECT caption FROM photos WHERE id = ?1", [id], |r| r.get(0))
            .unwrap_or(None);
        let file = format!("{:04}.jpg", n + 1);
        let result = (|| -> Result<(), String> {
            let orientation = read_exif(&src).orientation;
            let mut img = image::open(&src).map_err(|e| e.to_string())?;
            img = match orientation {
                2 => img.fliph(),
                3 => img.rotate180(),
                4 => img.flipv(),
                6 => img.rotate90(),
                8 => img.rotate270(),
                _ => img,
            };
            let big = if img.width().max(img.height()) > max_side { img.resize(max_side, max_side, FilterType::Lanczos3) } else { img.clone() };
            let small = img.resize(THUMB, THUMB, FilterType::Triangle);
            for (im, sub, q) in [(&big, "zdjecia", quality), (&small, "miniatury", 80)] {
                let f = File::create(root.join(sub).join(&file)).map_err(|e| e.to_string())?;
                image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(f), q)
                    .encode_image(&im.to_rgb8())
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                rep.done += 1;
                let cap = caption.unwrap_or_default();
                let date = taken.unwrap_or_default();
                items.push_str(&format!(
                    "<a class=\"t\" href=\"zdjecia/{file}\" data-cap=\"{}\" data-date=\"{}\"><img src=\"miniatury/{file}\" alt=\"{}\" loading=\"lazy\"></a>\n",
                    xml_escape(&cap),
                    xml_escape(date.get(..10).unwrap_or("")),
                    xml_escape(&name)
                ));
            }
            Err(e) => rep.errors.push(format!("{path}: {e}")),
        }
    }
    let page = format!(
        "<!doctype html>\n<html lang=\"pl\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>{t}</title>\n\
<style>\n:root{{color-scheme:light dark;--bg:#f4f5f9;--fg:#1a1c24}}@media(prefers-color-scheme:dark){{:root{{--bg:#14151b;--fg:#eceef4}}}}\n\
body{{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif}}header{{padding:20px 16px 4px}}h1{{margin:0;font-size:24px}}p{{margin:4px 0 0;opacity:.7}}\n\
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;padding:16px}}.t{{display:block;aspect-ratio:1;overflow:hidden;border-radius:10px;background:#0002}}\n\
.t img{{width:100%;height:100%;object-fit:cover;display:block}}#lb{{position:fixed;inset:0;background:#000d;display:none;align-items:center;justify-content:center;flex-direction:column;z-index:9}}\n\
#lb.on{{display:flex}}#lb img{{max-width:96vw;max-height:84vh;object-fit:contain}}#lb p{{color:#fff;margin:10px 16px;text-align:center}}\n\
#lb button{{position:absolute;top:12px;right:12px;font-size:20px;background:#fff2;color:#fff;border:0;border-radius:50%;width:44px;height:44px;cursor:pointer}}\n</style>\n</head>\n<body>\n\
<header><h1>{t}</h1><p>{n} zdjęć</p></header>\n<main class=\"g\">\n{items}</main>\n\
<div id=\"lb\" role=\"dialog\" aria-label=\"Podgląd zdjęcia\"><button type=\"button\" aria-label=\"Zamknij\">×</button><img alt=\"\"><p></p></div>\n\
<script>\n(function(){{var lb=document.getElementById('lb'),im=lb.querySelector('img'),cp=lb.querySelector('p'),a=[].slice.call(document.querySelectorAll('.t')),i=0;\n\
function show(k){{i=(k+a.length)%a.length;im.src=a[i].getAttribute('href');cp.textContent=[a[i].dataset.date,a[i].dataset.cap].filter(Boolean).join(' · ');lb.classList.add('on')}}\n\
a.forEach(function(el,k){{el.addEventListener('click',function(e){{e.preventDefault();show(k)}})}});\n\
lb.addEventListener('click',function(e){{if(e.target===lb||e.target.tagName==='BUTTON')lb.classList.remove('on')}});\n\
document.addEventListener('keydown',function(e){{if(!lb.classList.contains('on'))return;if(e.key==='Escape')lb.classList.remove('on');if(e.key==='ArrowRight')show(i+1);if(e.key==='ArrowLeft')show(i-1)}});}})();\n</script>\n</body>\n</html>\n",
        t = xml_escape(&folder_name),
        n = rep.done,
        items = items
    );
    fs::write(root.join("index.html"), page).map_err(|e| e.to_string())?;
    Ok((root, rep))
}

#[derive(serde::Serialize)]
pub struct GalleryReport {
    folder: String,
    done: usize,
    errors: Vec<String>,
}

#[tauri::command]
pub async fn export_gallery(app: tauri::AppHandle, ids: Vec<i64>, dest: String, title: String, max_side: u32, quality: u8) -> Result<GalleryReport, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let (root, rep) = gallery_core(&app.state::<AppState>(), &ids, Path::new(&dest), &title, max_side, quality)?;
        Ok(GalleryReport { folder: root.to_string_lossy().to_string(), done: rep.done, errors: rep.errors })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Zmienia nazwę folderu na dysku i poprawia ścieżki zdjęć oraz obserwowanych folderów w bibliotece.
/// Dotyczy tylko folderu, który zawiera zdjęcia z biblioteki; nowa nazwa przechodzi walidację nazw, a istniejący folder nie jest nadpisany.
pub fn rename_folder_core(conn: &Connection, old: &Path, new_name: &str) -> Result<PathBuf, String> {
    let new_name = valid_stem(new_name)?;
    let old_s = old.to_string_lossy().to_string();
    let known: i64 = conn
        .query_row("SELECT COUNT(*) FROM photos WHERE folder = ?1 OR substr(folder, 1, length(?1) + 1) = ?1 || ?2", params![old_s, std::path::MAIN_SEPARATOR.to_string()], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if known == 0 {
        return Err("Ten folder nie zawiera zdjęć z biblioteki".into());
    }
    if !old.is_dir() {
        return Err("Folder nie istnieje na dysku".into());
    }
    let parent = old.parent().ok_or("Nie można zmienić nazwy folderu głównego dysku")?;
    let target = parent.join(&new_name);
    if target.exists() {
        return Err("Folder o takiej nazwie już istnieje".into());
    }
    fs::rename(old, &target).map_err(|e| e.to_string())?;
    let new_s = target.to_string_lossy().to_string();
    let sep = std::path::MAIN_SEPARATOR.to_string();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (table, cols) in [("photos", &["path", "folder"][..]), ("roots", &["path"][..])] {
        for col in cols {
            tx.execute(
                &format!("UPDATE {table} SET {col} = ?2 || substr({col}, length(?1) + 1) WHERE {col} = ?1 OR substr({col}, 1, length(?1) + 1) = ?1 || ?3"),
                params![old_s, new_s, sep],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(target)
}

#[tauri::command]
pub fn rename_folder(state: State<'_, AppState>, old: String, new_name: String) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    rename_folder_core(&conn, Path::new(&old), &new_name).map(|p| p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(name: &str) -> (AppState, PathBuf) {
        let dir = std::env::temp_dir().join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("thumbs")).unwrap();
        let st = AppState {
            db: std::sync::Mutex::new(crate::open_db(&dir.join("t.db")).unwrap()),
            thumbs: dir.join("thumbs"),
            sidecar: std::sync::atomic::AtomicBool::new(true),
        };
        (st, dir)
    }

    #[test]
    fn gallery_is_self_contained_and_escapes_text() {
        let (st, dir) = state("mz-gallery-test");
        let lib = dir.join("lib");
        let out = dir.join("out");
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&out).unwrap();
        image::RgbImage::new(400, 200).save(lib.join("a.jpg")).unwrap();
        crate::scan_blocking(&st, lib.to_str().unwrap(), &|_| {}).unwrap();
        let id: i64 = st.db.lock().unwrap().query_row("SELECT id FROM photos", [], |r| r.get(0)).unwrap();
        st.db.lock().unwrap().execute("UPDATE photos SET caption = ?2 WHERE id = ?1", params![id, "<script>alert(1)</script> \"x\""]).unwrap();
        let (root, rep) = gallery_core(&st, &[id], &out, "Wakacje 2024", 300, 80).unwrap();
        assert_eq!((rep.done, rep.errors.len()), (1, 0));
        let html = fs::read_to_string(root.join("index.html")).unwrap();
        assert!(html.contains("Wakacje 2024") && html.contains("zdjecia/0001.jpg"));
        assert!(!html.contains("<script>alert"), "podpis musi być zescapowany");
        assert!(!html.contains("http://") && !html.contains("https://"), "galeria nie może ładować nic z internetu");
        assert_eq!(image::image_dimensions(root.join("zdjecia/0001.jpg")).unwrap(), (300, 150));
        assert!(image::image_dimensions(root.join("miniatury/0001.jpg")).unwrap().0 <= THUMB);
        // Druga galeria o tej samej nazwie nie nadpisuje pierwszej; błędne dane są odrzucane.
        let (root2, _) = gallery_core(&st, &[id], &out, "Wakacje 2024", 300, 80).unwrap();
        assert_ne!(root, root2);
        assert!(gallery_core(&st, &[], &out, "x", 300, 80).is_err());
        assert!(gallery_core(&st, &[id], &out, "x", 10, 80).is_err());
        assert!(gallery_core(&st, &[id], &out, "a/b", 300, 80).is_err());
        assert!(lib.join("a.jpg").exists());
    }

    #[test]
    fn renaming_a_folder_updates_library_paths() {
        let (st, dir) = state("mz-renamefolder-test");
        let lib = dir.join("Zdjecia");
        fs::create_dir_all(lib.join("sub")).unwrap();
        image::RgbImage::new(8, 8).save(lib.join("a.jpg")).unwrap();
        image::RgbImage::new(8, 8).save(lib.join("sub").join("b.jpg")).unwrap();
        crate::add_root(&st, lib.to_str().unwrap()).unwrap();
        crate::scan_blocking(&st, lib.to_str().unwrap(), &|_| {}).unwrap();
        let conn = st.db.lock().unwrap();
        // Złe nazwy i foldery spoza biblioteki są odrzucane.
        assert!(rename_folder_core(&conn, &lib, "a/b").is_err());
        assert!(rename_folder_core(&conn, &lib, "CON").is_err());
        assert!(rename_folder_core(&conn, &dir.join("brak"), "Nowy").is_err());
        let new = rename_folder_core(&conn, &lib, "Wakacje").unwrap();
        assert!(new.join("a.jpg").exists() && new.join("sub").join("b.jpg").exists() && !lib.exists());
        let paths: Vec<String> = conn.prepare("SELECT path FROM photos ORDER BY path").unwrap().query_map([], |r| r.get(0)).unwrap().filter_map(Result::ok).collect();
        assert!(paths.iter().all(|p| p.starts_with(&new.to_string_lossy().to_string())), "{paths:?}");
        let folders: Vec<String> = conn.prepare("SELECT DISTINCT folder FROM photos ORDER BY folder").unwrap().query_map([], |r| r.get(0)).unwrap().filter_map(Result::ok).collect();
        assert_eq!(folders.len(), 2);
        let root: String = conn.query_row("SELECT path FROM roots", [], |r| r.get(0)).unwrap();
        assert_eq!(root, new.to_string_lossy());
        // Istniejącego folderu nie nadpisujemy.
        fs::create_dir_all(dir.join("Inny")).unwrap();
        assert!(rename_folder_core(&conn, &new, "Inny").is_err());
    }
}
