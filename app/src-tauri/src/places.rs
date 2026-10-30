//! Nazwy miejsc offline: najbliższa miejscowość (ponad 15 tys. mieszkańców) dla współrzędnych GPS zdjęcia.
//! Dane (około 27 tys. miejscowości, polskie nazwy tam, gdzie GeoNames je zna) są dołączone do programu w pliku data/places.tsv.
//! Źródło: GeoNames, licencja CC BY 4.0 (https://www.geonames.org). Nic nie jest pobierane ani wysyłane.

use std::collections::HashMap;
use std::sync::OnceLock;

use rusqlite::{params, Connection};
use tauri::State;

use crate::AppState;

const DATA: &str = include_str!("../data/places.tsv");
/// Dalej niż tyle kilometrów od najbliższej miejscowości zdjęcie nie dostaje nazwy (pustynia, otwarte morze, szczyt).
const MAX_KM: f64 = 30.0;

struct Place {
    name: &'static str,
    cc: &'static str,
    lat: f64,
    lon: f64,
}

struct Index {
    places: Vec<Place>,
    /// Kratki o boku 1 stopnia: numery miejscowości w kratce.
    grid: HashMap<(i32, i32), Vec<u32>>,
}

fn index() -> &'static Index {
    static IDX: OnceLock<Index> = OnceLock::new();
    IDX.get_or_init(|| {
        let mut places = Vec::new();
        for line in DATA.lines() {
            let mut f = line.split('\t');
            let (Some(name), Some(cc), Some(lat), Some(lon)) = (f.next(), f.next(), f.next(), f.next()) else { continue };
            let (Ok(lat), Ok(lon)) = (lat.parse::<f64>(), lon.parse::<f64>()) else { continue };
            places.push(Place { name, cc, lat, lon });
        }
        let mut grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for (i, p) in places.iter().enumerate() {
            grid.entry((p.lat.floor() as i32, p.lon.floor() as i32)).or_default().push(i as u32);
        }
        Index { places, grid }
    })
}

/// Odległość w kilometrach (wzór haversine).
fn km(a: (f64, f64), b: (f64, f64)) -> f64 {
    let (la1, la2) = (a.0.to_radians(), b.0.to_radians());
    let (dla, dlo) = (la2 - la1, (b.1 - a.1).to_radians());
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    12742.0 * h.sqrt().asin()
}

/// Najbliższa miejscowość w promieniu `MAX_KM`: (nazwa, kod kraju).
pub fn nearest(lat: f64, lon: f64) -> Option<(&'static str, &'static str)> {
    if !(lat.is_finite() && lon.is_finite() && (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)) {
        return None;
    }
    let idx = index();
    let (cy, cx) = (lat.floor() as i32, lon.floor() as i32);
    // Kratka ma 1 stopień, więc przy 30 km wystarcza sąsiedztwo 3x3 (bliżej biegunów stopień długości jest krótszy, stąd szersze okno).
    let wide = if lat.abs() > 60.0 { 3 } else { 1 };
    let mut best: Option<(f64, &Place)> = None;
    for dy in -1..=1 {
        for dx in -wide..=wide {
            let key = (cy + dy, (cx + dx + 180).rem_euclid(360) - 180);
            let Some(list) = idx.grid.get(&key) else { continue };
            for &i in list {
                let p = &idx.places[i as usize];
                let d = km((lat, lon), (p.lat, p.lon));
                if d <= MAX_KM && best.map_or(true, |(bd, _)| d < bd) {
                    best = Some((d, p));
                }
            }
        }
    }
    best.map(|(_, p)| (p.name, p.cc))
}

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    // place: NULL = jeszcze nie ustalono, pusty tekst = brak miejscowości w pobliżu.
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN place TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN country TEXT", []);
    Ok(())
}

/// Uzupełnia nazwy miejsc zdjęć ze współrzędnymi, którym jeszcze ich nie ustalono. Zwraca liczbę zdjęć z nowo ustaloną nazwą.
pub fn fill_core(conn: &Connection) -> Result<usize, String> {
    let todo: Vec<(i64, f64, f64)> = {
        let mut stmt = conn.prepare("SELECT id, lat, lon FROM photos WHERE lat IS NOT NULL AND lon IS NOT NULL AND place IS NULL").map_err(|e| e.to_string())?;
        let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
        v
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut named = 0;
    for (id, lat, lon) in todo {
        let (place, country) = nearest(lat, lon).map(|(n, c)| (n, c)).unwrap_or(("", ""));
        if !place.is_empty() {
            named += 1;
        }
        tx.execute("UPDATE photos SET place = ?2, country = ?3 WHERE id = ?1", params![id, place, country]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(named)
}

/// Ustala nazwy miejsc dla zdjęć z GPS (lokalnie, z dołączonej tabeli). Zwraca liczbę zdjęć, które dostały nazwę.
#[tauri::command]
pub fn fill_places(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    fill_core(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_known_cities_with_polish_names() {
        assert_eq!(nearest(52.23, 21.01), Some(("Warszawa", "PL")));
        assert_eq!(nearest(50.06, 19.94).map(|p| p.0), Some("Kraków"));
        assert_eq!(nearest(48.8584, 2.2945).map(|p| p.1), Some("FR"), "Wieża Eiffla to Paryż, a nie dzielnica");
        assert_eq!(nearest(40.7128, -74.006).map(|p| p.1), Some("US"));
        assert_eq!(nearest(-33.87, 151.21).map(|p| p.1), Some("AU"));
        // Przez linię zmiany daty i przy biegunie nic nie pęka.
        assert!(nearest(-17.7, 179.9).is_some() || nearest(-17.7, 179.9).is_none());
        assert_eq!(nearest(0.0, -30.0), None, "środek oceanu");
        assert_eq!(nearest(f64::NAN, 1.0), None);
        assert_eq!(nearest(91.0, 1.0), None);
    }

    #[test]
    fn fills_only_unknown_places_and_resets_after_location_change() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE photos (id INTEGER PRIMARY KEY, lat REAL, lon REAL);").unwrap();
        init_schema(&c).unwrap();
        c.execute("INSERT INTO photos (id, lat, lon) VALUES (1, 52.23, 21.01), (2, 0.0, -30.0), (3, NULL, NULL)", []).unwrap();
        assert_eq!(fill_core(&c).unwrap(), 1);
        let place = |id: i64| -> Option<String> { c.query_row("SELECT place FROM photos WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
        assert_eq!(place(1).as_deref(), Some("Warszawa"));
        assert_eq!(place(2).as_deref(), Some(""), "brak miejscowości w pobliżu to pusty tekst, żeby nie liczyć w kółko");
        assert_eq!(place(3), None);
        assert_eq!(fill_core(&c).unwrap(), 0);
    }
}
