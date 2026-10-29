//! Zadania w tle widoczne w oknie postępu: każda dłuższa operacja zgłasza tu swój postęp, a interfejs rysuje dla niej okno
//! (pasek, prędkość, czas do końca). Kilka operacji naraz (np. twarze i duplikaty) daje kilka okien.
//!
//! Zdarzenie `job-progress` niesie: rodzaj zadania, ile zrobiono, ile razem (0 = nieznane), czy zadanie się skończyło i opcjonalny opis etapu.

use std::sync::OnceLock;

use serde::Serialize;
use tauri::Emitter;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Zapamiętuje uchwyt aplikacji (wywoływane raz przy starcie). W testach go nie ma i zgłaszanie postępu nic nie robi.
pub fn init(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

#[derive(Serialize, Clone)]
struct JobEvent<'a> {
    kind: &'a str,
    done: usize,
    total: usize,
    finished: bool,
    label: Option<&'a str>,
}

fn send(kind: &str, done: usize, total: usize, finished: bool, label: Option<&str>) {
    if let Some(app) = APP.get() {
        let _ = app.emit("job-progress", JobEvent { kind, done, total, finished, label });
    }
}

/// Postęp zadania: wysyła zdarzenie nie częściej niż co około 1% (przy małych liczbach co krok), żeby nie zalewać interfejsu.
pub fn tick(kind: &str, done: usize, total: usize) {
    let step = if total == 0 { 25 } else { (total / 100).max(1) };
    if done == 0 || done == total || done % step == 0 {
        send(kind, done, total, false, None);
    }
}

/// Opis etapu zadania (np. „Porównuję zdjęcia…”), gdy postęp jest nieznany.
pub fn stage(kind: &str, done: usize, total: usize, label: &str) {
    send(kind, done, total, false, Some(label));
}

/// Pilnuje, żeby zadanie zawsze się „zamknęło” w interfejsie: także po błędzie albo wcześniejszym `return`.
pub struct Guard(&'static str);

impl Guard {
    pub fn new(kind: &'static str) -> Guard {
        send(kind, 0, 0, false, None);
        Guard(kind)
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        send(self.0, 0, 0, true, None);
    }
}
