//! Import osób z Picasy 3: imiona przypisane do twarzy w plikach `.picasa.ini` leżących obok zdjęć.
//!
//! Zasady:
//! - pliki Picasy są tylko czytane (nigdy zmieniane), a moduł nie używa sieci,
//! - czytane są wyłącznie foldery, które są już w bibliotece FIBO,
//! - ramka z Picasy (`rect64`) jest dopasowywana do twarzy, którą FIBO sam wykrył na tym zdjęciu; twarzy, której FIBO nie wykrył, nie tworzymy,
//! - przeniesione imiona to ręczne ustawienia (twarz potwierdzona), ale nie nadpisują niczego, co użytkownik ustawił już w FIBO.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::AppState;

/// Ramka twarzy: lewy, górny, prawy i dolny brzeg jako ułamek szerokości i wysokości zdjęcia (0 do 1).
pub type Rect = (f32, f32, f32, f32);

/// Id osoby, którą Picasa zapisuje dla twarzy bez imienia.
const NOBODY: &str = "ffffffffffffffff";

/// `rect64(6faa46de7ee26258)`: cztery 16-bitowe liczby (lewy, górny, prawy, dolny), każda to ułamek z 65536.
pub fn rect64(hex: &str) -> Option<Rect> {
    if hex.len() != 16 {
        return None;
    }
    let v = u64::from_str_radix(hex, 16).ok()?;
    let f = |shift: u32| ((v >> shift) & 0xFFFF) as f32 / 65536.0;
    let r = (f(48), f(32), f(16), f(0));
    (r.2 > r.0 && r.3 > r.1).then_some(r)
}

/// Imię do porównań: małe litery, bez nadmiarowych spacji. „Oli Mama” i „Oli mama” to jedna osoba.
pub fn fold(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

#[derive(Default, Debug, PartialEq)]
pub struct IniFile {
    /// Sekcja `[Contacts2]`: id osoby w tym pliku i jej imię.
    pub contacts: HashMap<String, String>,
    /// Zdjęcie (nazwa pliku), ramki jego twarzy i id osób.
    pub photos: Vec<(String, Vec<(Rect, String)>)>,
}

/// Czyta jeden plik `.picasa.ini`. Nieznane sekcje i linie są pomijane.
pub fn parse_ini(text: &str) -> IniFile {
    let mut out = IniFile::default();
    let mut section = String::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if let Some(s) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = s.to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        if section.eq_ignore_ascii_case("Contacts2") {
            let name = value.split(';').next().unwrap_or("").trim();
            if !name.is_empty() {
                out.contacts.insert(key.trim().to_lowercase(), name.to_string());
            }
        } else if key.trim() == "faces" && !section.is_empty() {
            let mut faces = Vec::new();
            let mut pending: Option<Rect> = None;
            for token in value.split([',', ';']) {
                let token = token.trim();
                if let Some(h) = token.strip_prefix("rect64(").and_then(|t| t.strip_suffix(')')) {
                    pending = rect64(h);
                } else if let Some(r) = pending.take() {
                    faces.push((r, token.to_lowercase()));
                }
            }
            if !faces.is_empty() {
                out.photos.push((section.clone(), faces));
            }
        }
    }
    out
}

/// Ogólna lista osób Picasy (`contacts.xml`): id i imię. Służy tylko jako uzupełnienie, gdy plik `.picasa.ini` nie opisuje osoby.
pub fn parse_contacts_xml(text: &str) -> HashMap<String, String> {
    fn attr(line: &str, name: &str) -> Option<String> {
        let start = line.find(&format!("{name}=\""))? + name.len() + 2;
        let end = line[start..].find('"')? + start;
        Some(line[start..end].replace("&quot;", "\"").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&"))
    }
    text.lines()
        .filter(|l| l.contains("<contact "))
        .filter_map(|l| Some((attr(l, "id")?.to_lowercase(), attr(l, "name")?)))
        .filter(|(_, n)| !n.trim().is_empty())
        .collect()
}

/// Jak dobrze ramka z Picasy pasuje do twarzy FIBO (0 = wcale). Ramki są rysowane inaczej, więc liczy się odległość środków i podobna wielkość,
/// a nie pokrycie: sprawdzone na prawdziwej bibliotece (mediana 0,87 wobec 0,39 przy pokryciu).
pub fn score(picasa: Rect, fibo: Rect) -> f32 {
    let pw = (picasa.2 - picasa.0).max(1e-6);
    let fw = (fibo.2 - fibo.0).max(1e-6);
    let d = (((picasa.0 + picasa.2) / 2.0 - (fibo.0 + fibo.2) / 2.0).powi(2) + ((picasa.1 + picasa.3) / 2.0 - (fibo.1 + fibo.3) / 2.0).powi(2)).sqrt();
    let ratio = pw.min(fw) / pw.max(fw);
    if d < 0.6 * pw && ratio > 0.4 { 1.0 - d / pw } else { 0.0 }
}

/// Przypisuje ramki z Picasy do twarzy FIBO jeden do jednego, najlepsze pary pierwsze. Zwraca dla każdej ramki numer twarzy z listy albo None.
pub fn assign(picasa: &[Rect], fibo: &[Rect]) -> Vec<Option<usize>> {
    let mut pairs: Vec<(f32, usize, usize)> = Vec::new();
    for (i, p) in picasa.iter().enumerate() {
        for (j, f) in fibo.iter().enumerate() {
            let s = score(*p, *f);
            if s > 0.0 {
                pairs.push((s, i, j));
            }
        }
    }
    pairs.sort_by(|a, b| b.0.total_cmp(&a.0));
    let (mut used_p, mut used_f) = (HashSet::new(), HashSet::new());
    let mut out = vec![None; picasa.len()];
    for (_, i, j) in pairs {
        if used_p.contains(&i) || used_f.contains(&j) {
            continue;
        }
        used_p.insert(i);
        used_f.insert(j);
        out[i] = Some(j);
    }
    out
}

/// Twarz z Picasy dopasowana do twarzy FIBO.
#[derive(Debug, Clone)]
pub struct Matched {
    pub face: i64,
    pub photo: i64,
    /// Imię z Picasy po `fold`.
    pub key: String,
}

#[derive(Default)]
struct Collected {
    folders: usize,
    files: usize,
    /// Nazwane twarze w Picasie (z rozpoznanym imieniem).
    named: usize,
    /// Zdjęcia z Picasy, których nie ma w bibliotece FIBO.
    no_photo: usize,
    /// Twarze z id osoby, której imienia nie da się ustalić.
    unresolved: usize,
    /// Twarze, których FIBO nie wykrył na zdjęciu.
    no_face: usize,
    matched: Vec<Matched>,
    /// Ile nazwanych twarzy ma dane imię (po `fold`), także tych bez dopasowania.
    per_key: HashMap<String, usize>,
    /// Zapisy imienia w Picasie: pisownia i liczba użyć.
    spellings: HashMap<String, HashMap<String, usize>>,
}

fn path_key(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

fn contacts_xml() -> HashMap<String, String> {
    let Ok(base) = std::env::var("LOCALAPPDATA") else { return HashMap::new() };
    let path = Path::new(&base).join("Google").join("Picasa2").join("contacts").join("contacts.xml");
    fs::read(path).map(|b| parse_contacts_xml(&String::from_utf8_lossy(&b))).unwrap_or_default()
}

/// Zbiera dane z `.picasa.ini` w folderach biblioteki i dopasowuje je do twarzy z bazy. Baza jest zablokowana tylko na czas odczytu.
fn collect(app: &tauri::AppHandle) -> Result<Collected, String> {
    let state = app.state::<AppState>();
    let (folders, photos, faces) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let folders: Vec<String> = conn.prepare("SELECT DISTINCT folder FROM photos").map_err(|e| e.to_string())?.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        let photos: HashMap<String, i64> = conn.prepare("SELECT path, id FROM photos").map_err(|e| e.to_string())?.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).map(|(p, id)| (path_key(&p), id)).collect();
        let mut faces: HashMap<i64, Vec<(i64, Rect)>> = HashMap::new();
        let mut st = conn.prepare("SELECT id, photo_id, x, y, w, h FROM faces WHERE rejected = 0").map_err(|e| e.to_string())?;
        for r in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, f32>(2)?, r.get::<_, f32>(3)?, r.get::<_, f32>(4)?, r.get::<_, f32>(5)?))).map_err(|e| e.to_string())?.filter_map(Result::ok) {
            faces.entry(r.1).or_default().push((r.0, (r.2, r.3, r.2 + r.4, r.3 + r.5)));
        }
        (folders, photos, faces)
    };
    let global = contacts_xml();
    let mut out = Collected { folders: folders.len(), ..Default::default() };
    for folder in &folders {
        if folder.to_lowercase().replace('/', "\\").split('\\').any(|c| c == ".picasaoriginals") {
            continue;
        }
        let dir = Path::new(folder);
        let Some(bytes) = [".picasa.ini", "Picasa.ini"].iter().find_map(|n| fs::read(dir.join(n)).ok()) else { continue };
        out.files += 1;
        let ini = parse_ini(&String::from_utf8_lossy(&bytes));
        for (file, list) in &ini.photos {
            let named: Vec<(Rect, String)> = list
                .iter()
                .filter(|(_, id)| id != NOBODY)
                .filter_map(|(r, id)| match ini.contacts.get(id).or_else(|| global.get(id)) {
                    Some(n) => Some((*r, n.clone())),
                    None => {
                        out.unresolved += 1;
                        None
                    }
                })
                .collect();
            if named.is_empty() {
                continue;
            }
            for (_, n) in &named {
                out.named += 1;
                *out.per_key.entry(fold(n)).or_default() += 1;
                *out.spellings.entry(fold(n)).or_default().entry(n.clone()).or_default() += 1;
            }
            let Some(&photo) = photos.get(&path_key(&format!("{}\\{}", folder.trim_end_matches(['\\', '/']), file))) else {
                out.no_photo += named.len();
                continue;
            };
            let candidates = faces.get(&photo).map(|v| v.as_slice()).unwrap_or(&[]);
            let rects: Vec<Rect> = named.iter().map(|(r, _)| *r).collect();
            let fibo: Vec<Rect> = candidates.iter().map(|c| c.1).collect();
            for ((_, name), hit) in named.iter().zip(assign(&rects, &fibo)) {
                match hit {
                    Some(j) => out.matched.push(Matched { face: candidates[j].0, photo, key: fold(name) }),
                    None => out.no_face += 1,
                }
            }
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct PicasaName {
    /// Klucz imienia (małe litery): do niego odnosi się `NameMap::key`.
    pub key: String,
    /// Najczęstsza pisownia: proponowane imię osoby w FIBO.
    pub name: String,
    /// Pozostałe pisownie połączone w tę pozycję (różnice wielkości liter).
    pub variants: Vec<String>,
    /// Nazwane twarze w Picasie.
    pub faces: usize,
    /// Z nich dopasowane do twarzy wykrytych przez FIBO.
    pub matched: usize,
    /// Osoba o tym imieniu już jest w FIBO (jej numer).
    pub existing: Option<i64>,
}

#[derive(Serialize)]
pub struct PicasaScan {
    pub folders: usize,
    pub files: usize,
    pub named: usize,
    pub no_photo: usize,
    pub no_face: usize,
    pub unresolved: usize,
    pub names: Vec<PicasaName>,
}

/// Przegląda Picasę bez zmieniania czegokolwiek: które imiona są, ile twarzy da się przenieść.
#[tauri::command]
pub async fn picasa_scan(app: tauri::AppHandle) -> Result<PicasaScan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let c = collect(&app)?;
        let existing: HashMap<String, i64> = {
            let state = app.state::<AppState>();
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let list: Vec<(i64, String)> = conn.prepare("SELECT id, name FROM people WHERE name IS NOT NULL ORDER BY id").map_err(|e| e.to_string())?.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
            let mut m = HashMap::new();
            for (id, n) in list {
                m.entry(fold(&n)).or_insert(id);
            }
            m
        };
        let mut matched_per: HashMap<&str, usize> = HashMap::new();
        for m in &c.matched {
            *matched_per.entry(m.key.as_str()).or_default() += 1;
        }
        let mut names: Vec<PicasaName> = c
            .per_key
            .iter()
            .map(|(key, faces)| {
                let mut sp: Vec<(&String, &usize)> = c.spellings[key].iter().collect();
                sp.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
                PicasaName {
                    key: key.clone(),
                    name: sp[0].0.clone(),
                    variants: sp.iter().skip(1).map(|s| s.0.clone()).collect(),
                    faces: *faces,
                    matched: matched_per.get(key.as_str()).copied().unwrap_or(0),
                    existing: existing.get(key).copied(),
                }
            })
            .collect();
        names.sort_by(|a, b| b.faces.cmp(&a.faces).then(a.name.cmp(&b.name)));
        Ok(PicasaScan { folders: c.folders, files: c.files, named: c.named, no_photo: c.no_photo, no_face: c.no_face, unresolved: c.unresolved, names })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct NameMap {
    pub key: String,
    /// Imię osoby w FIBO; puste oznacza „nie przenoś”.
    pub to: String,
}

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct PicasaReport {
    /// Twarze przypisane do osób.
    pub imported: usize,
    /// Pominięte, bo w FIBO ustawiłeś już tę twarz ręcznie.
    pub kept: usize,
    /// Pominięte, bo ta osoba ma już inną twarz na tym zdjęciu.
    pub conflicts: usize,
    pub people_created: usize,
}

/// Zapisuje przypisania. Twarzy ustawionej ręcznie w FIBO nie ruszamy. Dwie twarze z jednego zdjęcia nigdy nie trafiają do jednej osoby.
fn apply_core(conn: &Connection, items: &[Matched], map: &HashMap<String, String>) -> Result<PicasaReport, String> {
    let mut report = PicasaReport::default();
    let mut people: HashMap<String, i64> = HashMap::new();
    for (id, n) in conn.prepare("SELECT id, name FROM people WHERE name IS NOT NULL ORDER BY id").map_err(|e| e.to_string())?.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?.filter_map(Result::ok) {
        people.entry(fold(&n)).or_insert(id);
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for m in items {
        let Some(to) = map.get(&m.key).map(|t| t.trim()).filter(|t| !t.is_empty()) else { continue };
        let (person, manual): (Option<i64>, i64) = tx.query_row("SELECT person_id, manual FROM faces WHERE id = ?1 AND rejected = 0", [m.face], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|_| "Nie ma takiej twarzy".to_string())?;
        if manual == 1 && person.is_some() {
            report.kept += 1;
            continue;
        }
        let target = match people.get(&fold(to)) {
            Some(id) => *id,
            None => {
                tx.execute("INSERT INTO people (name) VALUES (?1)", [to]).map_err(|e| e.to_string())?;
                let id = tx.last_insert_rowid();
                people.insert(fold(to), id);
                report.people_created += 1;
                id
            }
        };
        let clash: i64 = tx.query_row("SELECT COUNT(*) FROM faces WHERE photo_id = ?1 AND person_id = ?2 AND id <> ?3", params![m.photo, target, m.face], |r| r.get(0)).map_err(|e| e.to_string())?;
        if clash > 0 {
            report.conflicts += 1;
            continue;
        }
        tx.execute("UPDATE faces SET person_id = ?2, manual = 1, rejected = 0, conf = NULL, auto = 0 WHERE id = ?1", params![m.face, target]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM face_not WHERE face_id = ?1 AND person_id = ?2", params![m.face, target]).map_err(|e| e.to_string())?;
        report.imported += 1;
    }
    tx.execute("DELETE FROM people WHERE name IS NULL AND ignored = 0 AND id NOT IN (SELECT person_id FROM faces WHERE person_id IS NOT NULL)", []).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(report)
}

/// Przenosi imiona z Picasy do FIBO według wyboru użytkownika (`map`: imię z Picasy i imię osoby w FIBO).
#[tauri::command]
pub async fn picasa_import(app: tauri::AppHandle, map: Vec<NameMap>) -> Result<PicasaReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let c = collect(&app)?;
        let map: HashMap<String, String> = map.into_iter().map(|m| (m.key, m.to)).collect();
        let state = app.state::<AppState>();
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let report = apply_core(&conn, &c.matched, &map)?;
        crate::people::mark_dirty();
        Ok(report)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const INI: &str = "[Picasa]\nname=Album\n[Contacts2]\n647d187a8a4d9b11=Ja;;\n6096ae30b66fbb56=Alunia;;\n[a b.jpg]\nfaces=rect64(6faa46de7ee26258),647d187a8a4d9b11;rect64(1000200030004000),ffffffffffffffff\nbackuphash=1\n[c.jpg]\nfaces=rect64(1000200030004000),6096ae30b66fbb56\n";

    #[test]
    fn decodes_rect64_as_four_sixteen_bit_fractions() {
        let r = rect64("6faa46de7ee26258").unwrap();
        assert!((r.0 - 0x6faa as f32 / 65536.0).abs() < 1e-6 && (r.3 - 0x6258 as f32 / 65536.0).abs() < 1e-6);
        assert!(r.2 > r.0 && r.3 > r.1);
        assert_eq!(rect64("zz"), None);
        assert_eq!(rect64("0000000000000000"), None, "pusta ramka nie jest twarzą");
    }

    #[test]
    fn reads_contacts_and_faces_from_an_ini_file() {
        let ini = parse_ini(INI);
        assert_eq!(ini.contacts.get("647d187a8a4d9b11").map(String::as_str), Some("Ja"));
        assert_eq!(ini.photos.len(), 2);
        assert_eq!(ini.photos[0].0, "a b.jpg");
        assert_eq!(ini.photos[0].1.len(), 2, "dwie twarze w jednej linii, także ta bez imienia");
        assert_eq!(ini.photos[0].1[1].1, "ffffffffffffffff");
        assert_eq!(parse_ini("\u{feff}[x.jpg]\nfaces=rect64(1000200030004000),aa\n").photos.len(), 1, "znacznik BOM nie przeszkadza");
    }

    #[test]
    fn reads_global_contact_names_with_entities() {
        let xml = "<contacts>\n <contact id=\"6096AE30B66FBB56\" name=\"Tom &amp; Jerry\" local_contact=\"1\"/>\n</contacts>";
        assert_eq!(parse_contacts_xml(xml).get("6096ae30b66fbb56").map(String::as_str), Some("Tom & Jerry"));
    }

    #[test]
    fn folds_case_and_spaces_only() {
        assert_eq!(fold("Oli  Mama"), fold("oli mama"));
        assert_ne!(fold("Martyna"), fold("Martyna Knebel"));
        assert_eq!(fold("ŁUKASZ"), fold("łukasz"));
    }

    #[test]
    fn matching_pairs_boxes_one_to_one_by_centre_and_size() {
        let picasa = [(0.10, 0.10, 0.20, 0.25), (0.60, 0.10, 0.70, 0.25)];
        // FIBO ma ramki trochę inne (węższe), w odwrotnej kolejności, i jedną obcą.
        let fibo = [(0.61, 0.12, 0.69, 0.24), (0.11, 0.12, 0.19, 0.24), (0.40, 0.60, 0.50, 0.75)];
        assert_eq!(assign(&picasa, &fibo), vec![Some(1), Some(0)]);
        assert_eq!(assign(&[(0.1, 0.1, 0.2, 0.2)], &[(0.7, 0.7, 0.8, 0.8)]), vec![None], "daleka ramka nie pasuje");
        assert_eq!(assign(&[(0.1, 0.1, 0.2, 0.2), (0.1, 0.1, 0.2, 0.2)], &[(0.1, 0.1, 0.2, 0.2)]).iter().flatten().count(), 1, "jedna twarz FIBO nie dostaje dwóch imion");
        assert_eq!(assign(&[(0.1, 0.1, 0.2, 0.2)], &[(0.1, 0.1, 0.9, 0.9)]), vec![None], "zupełnie inna wielkość nie pasuje");
    }

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE photos (id INTEGER PRIMARY KEY, hidden INTEGER NOT NULL DEFAULT 0);").unwrap();
        crate::people::init_schema(&c).unwrap();
        c
    }

    fn face(c: &Connection, photo: i64, person: Option<i64>, manual: i64) -> i64 {
        c.execute("INSERT INTO faces (photo_id, person_id, x, y, w, h, score, emb, manual) VALUES (?1, ?2, 0.1, 0.1, 0.1, 0.1, 0.9, x'00', ?3)", params![photo, person, manual]).unwrap();
        c.last_insert_rowid()
    }

    fn m(face: i64, photo: i64, name: &str) -> Matched {
        Matched { face, photo, key: fold(name) }
    }

    #[test]
    fn import_assigns_confirmed_faces_reuses_people_by_name_and_respects_manual_work() {
        let c = db();
        c.execute("INSERT INTO people (name) VALUES ('Alunia')", []).unwrap();
        let alunia = c.last_insert_rowid();
        let (f1, f2, f3, f4, f5) = (face(&c, 1, None, 0), face(&c, 2, None, 0), face(&c, 3, Some(alunia), 1), face(&c, 4, None, 0), face(&c, 4, None, 0));
        let items = [m(f1, 1, "alunia"), m(f2, 2, "Ja"), m(f3, 3, "Ja"), m(f4, 4, "Ja"), m(f5, 4, "Ja")];
        let map: HashMap<String, String> = [("alunia", "Alunia"), ("ja", "Ja")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let r = apply_core(&c, &items, &map).unwrap();
        assert_eq!(r, PicasaReport { imported: 3, kept: 1, conflicts: 1, people_created: 1 });
        let (p, manual, auto): (i64, i64, i64) = c.query_row("SELECT person_id, manual, auto FROM faces WHERE id = ?1", [f1], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((p, manual, auto), (alunia, 1, 0), "twarz trafia do istniejącej osoby o tym imieniu (wielkość liter bez znaczenia) jako potwierdzona");
        let person_of = |f: i64| -> Option<i64> { c.query_row("SELECT person_id FROM faces WHERE id = ?1", [f], |r| r.get(0)).unwrap() };
        assert_eq!(person_of(f3), Some(alunia), "ręczne ustawienie w FIBO zostaje");
        assert!(person_of(f2).is_some() && person_of(f2) != Some(alunia));
        assert_eq!(person_of(f4).is_some() as i32 + person_of(f5).is_some() as i32, 1, "na jednym zdjęciu osoba ma jedną twarz");
    }

    #[test]
    fn import_skips_names_the_user_cleared_and_removes_nothing_named() {
        let c = db();
        let f = face(&c, 1, None, 0);
        let map: HashMap<String, String> = [("ja".to_string(), "  ".to_string())].into_iter().collect();
        assert_eq!(apply_core(&c, &[m(f, 1, "Ja")], &map).unwrap(), PicasaReport::default());
        let p: Option<i64> = c.query_row("SELECT person_id FROM faces WHERE id = ?1", [f], |r| r.get(0)).unwrap();
        assert_eq!(p, None);
    }
}
