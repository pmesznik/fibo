//! Grupowanie twarzy w osoby. Czysta logika (bez bazy i bez sieci), dzięki czemu da się ją dokładnie testować.
//!
//! Zasady (nastawione na precyzję: lepiej zostawić twarz bez grupy niż wrzucić ją do złej osoby, a pomyłki naprawia się łączeniem):
//! - dwie twarze z tego samego zdjęcia to nigdy ta sama osoba, więc grupa nie może zawierać dwóch twarzy z jednego zdjęcia
//!   (to mocne ograniczenie, które rozdziela np. rodzeństwo fotografowane razem),
//! - twarz dołącza do osoby, gdy jej podobieństwo do osoby (średnia z podobieństwa do środka grupy i do kilku najlepszych wzorców)
//!   przekracza próg i wyraźnie wygrywa z drugą najbliższą osobą,
//! - nową osobę może założyć tylko twarz dobrej jakości; słaba twarz jest przypisywana tylko do pewnej osoby albo zostaje bez grupy,
//! - do środka grupy i wzorców trafiają wyłącznie twarze dobrej jakości, więc rozmyte lub profilowe ujęcia nie „rozmywają” osoby.

use std::collections::{HashMap, HashSet};

use crate::faces::{cosine, normalize, EMB_LEN};

/// Najmniejsze podobieństwo, od którego twarz może dołączyć do osoby (próg tożsamości modelu to ok. 0.36).
pub const JOIN: f32 = 0.45;
/// O ile najlepsza osoba musi wygrać z drugą, żeby przypisanie było pewne.
pub const MARGIN: f32 = 0.04;
/// Najmniejsza jakość twarzy, która może założyć nową osobę.
pub const SEED_QUALITY: f32 = 0.55;
/// Najmniejsza jakość twarzy, która zasila środek grupy i wzorce.
pub const LEARN_QUALITY: f32 = 0.45;
/// Średnie podobieństwo twarzy dwóch grup, od którego są łączone w grupowaniu hierarchicznym.
pub const LINKAGE: f32 = 0.35;
/// Podobieństwo środków dwóch grup, od którego są łączone automatycznie po zakończeniu analizy.
pub const AUTO_MERGE: f32 = 0.62;
/// O ile próg dołączenia spada na każde podwojenie liczby twarzy osoby (2 twarze: -0.02, 4: -0.04, 8 i więcej: -0.06).
/// Osoba z wieloma twarzami ma dokładny środek i wzorce z różnych ujęć (światło, kąt, wiek), więc nowa twarz, która do niej pasuje,
/// jest dużo pewniejsza niż przy osobie znanej z jednego zdjęcia. Dolna granica 0.39 leży tuż nad progiem tożsamości modelu (0.36).
const JOIN_STEP: f32 = 0.02;
const JOIN_MAX_BONUS: f32 = 0.06;
/// Okno czasu (w dniach), w którym wzorce osoby uznajemy za „z tego samego okresu”: dziecko po półtora roku wygląda już inaczej,
/// ale twarz sprzed kilku miesięcy jest nadal dobrym punktem odniesienia.
pub const TIME_WINDOW: i32 = 548;
/// Wzorce rozkładamy na półrocza, żeby pamiętać wygląd osoby z różnych lat, a nie tylko z najlepszych zdjęć jednego okresu.
const BUCKET_DAYS: i32 = 183;
const EXEMPLARS: usize = 24;
const TOP: usize = 3;

#[derive(Clone)]
pub struct Person {
    sum: Vec<f32>,
    n: usize,
    /// Najlepsze jakościowo wzorce (wektor, jakość).
    exemplars: Vec<(Vec<f32>, f32, Option<i32>)>,
    /// Zdjęcia, na których osoba już jest (jedna osoba nie może być dwa razy na tym samym zdjęciu).
    photos: HashSet<i64>,
}

impl Person {
    fn new() -> Person {
        Person { sum: vec![0.0; EMB_LEN], n: 0, exemplars: Vec::new(), photos: HashSet::new() }
    }

    pub fn centroid(&self) -> Vec<f32> {
        let mut c = self.sum.clone();
        normalize(&mut c);
        c
    }

    pub fn size(&self) -> usize {
        self.n
    }

    /// Próg podobieństwa, od którego nowa twarz może dołączyć do tej osoby: im więcej twarzy już zna, tym niższy (zob. `JOIN_STEP`).
    pub fn join_threshold(&self) -> f32 {
        JOIN - (JOIN_STEP * (self.n.max(1) as f32).log2()).min(JOIN_MAX_BONUS)
    }

    fn learn(&mut self, emb: &[f32], q: f32, when: Option<i32>) {
        self.sum.iter_mut().zip(emb).for_each(|(a, b)| *a += b * q);
        self.n += 1;
        self.exemplars.push((emb.to_vec(), q, when));
        if self.exemplars.len() > EXEMPLARS {
            let victim = self.eviction_candidate();
            self.exemplars.swap_remove(victim);
        }
    }

    /// Który wzorzec wyrzucić, gdy jest ich za dużo: najsłabszy z najbardziej zatłoczonego półrocza, żeby zostały wzorce z różnych lat.
    /// Wzorce bez daty traktujemy jak jedno wspólne półrocze.
    fn eviction_candidate(&self) -> usize {
        let bucket = |e: &(Vec<f32>, f32, Option<i32>)| e.2.map(|d| d.div_euclid(BUCKET_DAYS));
        let mut count: HashMap<Option<i32>, usize> = HashMap::new();
        for e in &self.exemplars {
            *count.entry(bucket(e)).or_default() += 1;
        }
        self.exemplars
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| count[&bucket(a)].cmp(&count[&bucket(b)]).then(b.1.total_cmp(&a.1)))
            .map(|(i, _)| i)
            .unwrap_or(0)
    }

    /// Podobieństwo twarzy do osoby: średnia z podobieństwa do środka i średniej z najlepszych wzorców.
    pub fn score(&self, emb: &[f32]) -> f32 {
        self.score_at(emb, None)
    }

    /// To samo, a gdy znamy dzień zdjęcia (`when`), twarz porównujemy też z wzorcami z okolicznych miesięcy: człowiek zmienia się z latami
    /// (dziecko szczególnie), więc dla zdjęcia z danego okresu najlepszym punktem odniesienia są ujęcia z tego samego okresu, a nie średnia z całego życia.
    /// Wynik to większa z dwóch ocen. Wzorzec z jednego tylko ujęcia w oknie jest uwzględniany z niewielką karą, bo to słabsza podstawa.
    pub fn score_at(&self, emb: &[f32], when: Option<i32>) -> f32 {
        if self.n == 0 {
            return -1.0;
        }
        let top_avg = |sims: &mut Vec<f32>| {
            sims.sort_by(|a, b| b.total_cmp(a));
            let k = sims.len().min(TOP).max(1);
            sims.iter().take(k).sum::<f32>() / k as f32
        };
        let c = cosine(&self.centroid(), emb);
        let mut sims: Vec<f32> = self.exemplars.iter().map(|(e, _, _)| cosine(e, emb)).collect();
        let global = 0.4 * c + 0.6 * top_avg(&mut sims);
        let Some(w) = when else { return global };
        let mut near: Vec<f32> = self.exemplars.iter().filter(|(_, _, d)| d.map(|d| (d - w).abs() <= TIME_WINDOW).unwrap_or(false)).map(|(e, _, _)| cosine(e, emb)).collect();
        if near.is_empty() {
            return global;
        }
        let penalty = if near.len() == 1 { 0.03 } else { 0.0 };
        global.max(top_avg(&mut near) - penalty)
    }
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    /// Dołącz do osoby; `learn` mówi, czy twarz ma zasilić środek i wzorce osoby.
    Join { id: i64, learn: bool },
    /// Załóż nową osobę.
    New,
    /// Zostaw bez grupy (za mało pewna).
    Unassigned,
}

#[derive(Default)]
pub struct Clusters {
    people: HashMap<i64, Person>,
}

impl Clusters {
    pub fn new() -> Clusters {
        Clusters::default()
    }

    /// Dodaje twarz do osoby bez podejmowania decyzji (wczytywanie istniejących grup). `photo` to zdjęcie, z którego pochodzi twarz.
    pub fn add(&mut self, id: i64, emb: &[f32], q: f32, photo: i64) {
        self.add_at(id, emb, q, photo, None)
    }

    /// To samo z dniem zrobienia zdjęcia (liczba dni od 1970), dzięki któremu osoba pamięta swój wygląd w czasie.
    pub fn add_at(&mut self, id: i64, emb: &[f32], q: f32, photo: i64, when: Option<i32>) {
        let p = self.people.entry(id).or_insert_with(Person::new);
        p.photos.insert(photo);
        if q >= LEARN_QUALITY || p.n == 0 {
            p.learn(emb, q.max(0.05), when);
        }
    }

    /// Dwie najbliższe osoby (pomijamy te, które już są na tym zdjęciu): najlepsza (id, wynik) oraz wynik drugiej (albo -1).
    fn top_two(&self, emb: &[f32], photo: i64, when: Option<i32>) -> (Option<(i64, f32)>, f32) {
        let mut best: Option<(i64, f32)> = None;
        let mut second = -1.0f32;
        for (id, p) in &self.people {
            if p.photos.contains(&photo) {
                continue;
            }
            let s = p.score_at(emb, when);
            match best {
                Some((_, bs)) if s <= bs => second = second.max(s),
                Some((_, bs)) => { second = second.max(bs); best = Some((*id, s)); }
                None => best = Some((*id, s)),
            }
        }
        (best, second)
    }

    pub fn decide(&self, emb: &[f32], quality: f32, photo: i64) -> Decision {
        self.decide_at(emb, quality, photo, None)
    }

    pub fn decide_at(&self, emb: &[f32], quality: f32, photo: i64, when: Option<i32>) -> Decision {
        let (best, second) = self.top_two(emb, photo, when);
        match best {
            Some((id, s)) if s >= self.people.get(&id).map_or(JOIN, |p| p.join_threshold()) => {
                let clear = s - second >= MARGIN;
                // Pewne przypisanie zasila osobę (jeśli twarz jest dość dobra); niepewne nie zmienia osoby, a niepewna słaba twarz nie dostaje grupy.
                if clear { Decision::Join { id, learn: quality >= LEARN_QUALITY } }
                else if quality >= SEED_QUALITY { Decision::Join { id, learn: false } }
                else { Decision::Unassigned }
            }
            _ if quality >= SEED_QUALITY => Decision::New,
            _ => Decision::Unassigned,
        }
    }

    /// Zapisuje wynik decyzji (po założeniu osoby o numerze `id` albo dołączeniu do istniejącej).
    pub fn apply(&mut self, id: i64, emb: &[f32], quality: f32, learn: bool, photo: i64) {
        self.apply_at(id, emb, quality, learn, photo, None)
    }

    pub fn apply_at(&mut self, id: i64, emb: &[f32], quality: f32, learn: bool, photo: i64, when: Option<i32>) {
        let p = self.people.entry(id).or_insert_with(Person::new);
        p.photos.insert(photo);
        if learn || p.n == 0 {
            p.learn(emb, quality.max(0.05), when);
        }
    }

    pub fn people_count(&self) -> usize {
        self.people.len()
    }

    pub fn person(&self, id: i64) -> Option<&Person> {
        self.people.get(&id)
    }

    pub fn ids(&self) -> Vec<i64> {
        let mut v: Vec<i64> = self.people.keys().copied().collect();
        v.sort_unstable();
        v
    }

    /// Pary osób o bardzo podobnych środkach (do automatycznego połączenia), od najpodobniejszych. Pomijamy pary, które występują na
    /// jednym zdjęciu razem (to na pewno różne osoby).
    pub fn merge_candidates(&self, threshold: f32) -> Vec<(i64, i64, f32)> {
        let ids = self.ids();
        let cents: Vec<Vec<f32>> = ids.iter().map(|i| self.people[i].centroid()).collect();
        let mut out = Vec::new();
        for i in 0..ids.len() {
            for j in i + 1..ids.len() {
                let s = cosine(&cents[i], &cents[j]);
                if s >= threshold && self.people[&ids[i]].photos.is_disjoint(&self.people[&ids[j]].photos) {
                    out.push((ids[i], ids[j], s));
                }
            }
        }
        out.sort_by(|a, b| b.2.total_cmp(&a.2));
        out
    }

    /// Łączy osobę `from` z `into` (wzorce, środek i zdjęcia sumują się).
    pub fn merge(&mut self, from: i64, into: i64) {
        if let Some(f) = self.people.remove(&from) {
            let t = self.people.entry(into).or_insert_with(Person::new);
            t.sum.iter_mut().zip(&f.sum).for_each(|(a, b)| *a += b);
            t.n += f.n;
            t.photos.extend(f.photos);
            t.exemplars.extend(f.exemplars);
            while t.exemplars.len() > EXEMPLARS {
                let victim = t.eviction_candidate();
                t.exemplars.swap_remove(victim);
            }
        }
    }
}

/// Średnie podobieństwo (kosinusowe) między twarzami dwóch grup: dla wektorów jednostkowych to iloczyn sum podzielony przez liczebności.
fn avg_link(sa: &[f32], na: usize, sb: &[f32], nb: usize) -> f32 {
    cosine(sa, sb) / (na * nb) as f32
}

/// Grupowanie hierarchiczne (średnie wiązanie) metodą łańcucha najbliższych sąsiadów: dwie grupy łączą się, dopóki ich średnie
/// podobieństwo jest nie mniejsze niż `threshold`, a żadne zdjęcie nie ma w nich dwóch twarzy. Wynik nie zależy od kolejności zdjęć,
/// w odróżnieniu od zachłannego dopisywania. Złożoność O(n²), więc działa w tle także dla dziesiątek tysięcy twarzy.
/// Zwraca numer grupy dla każdej twarzy.
/// `stop` przerywa liczenie (wynik jest wtedy częściowy i wywołujący go odrzuca).
pub fn agglomerate(embs: &[&[f32]], photos: &[i64], threshold: f32, stop: &dyn Fn() -> bool) -> Vec<usize> {
    let n = embs.len();
    let mut sums: Vec<Vec<f32>> = embs.iter().map(|e| e.to_vec()).collect();
    let mut size = vec![1usize; n];
    let mut sets: Vec<HashSet<i64>> = photos.iter().map(|p| HashSet::from([*p])).collect();
    let mut active = vec![true; n];
    let mut parent: Vec<usize> = (0..n).collect();
    let mut chain: Vec<usize> = Vec::new();
    let mut remaining = n;
    while remaining > 1 {
        if stop() {
            break;
        }
        if chain.is_empty() {
            match active.iter().position(|a| *a) {
                Some(i) => chain.push(i),
                None => break,
            }
        }
        let a = *chain.last().unwrap();
        let prev = if chain.len() >= 2 { Some(chain[chain.len() - 2]) } else { None };
        // Najbliższy sąsiad grupy a spośród grup, z którymi wolno ją połączyć (bez wspólnego zdjęcia).
        let mut best: Option<(usize, f32)> = None;
        if let Some(p) = prev {
            best = Some((p, avg_link(&sums[a], size[a], &sums[p], size[p])));
        }
        for b in 0..n {
            if b == a || !active[b] || Some(b) == prev || !sets[a].is_disjoint(&sets[b]) {
                continue;
            }
            let s = avg_link(&sums[a], size[a], &sums[b], size[b]);
            if best.map(|(_, bs)| s > bs).unwrap_or(true) {
                best = Some((b, s));
            }
        }
        let Some((b, s)) = best else {
            // Nie ma z kim jej połączyć: grupa jest gotowa.
            active[a] = false;
            remaining -= 1;
            chain.pop();
            continue;
        };
        if Some(b) == prev {
            chain.pop();
            chain.pop();
            if s >= threshold {
                let (keep, gone) = (a.min(b), a.max(b));
                let add = sums[gone].clone();
                sums[keep].iter_mut().zip(&add).for_each(|(x, y)| *x += y);
                size[keep] += size[gone];
                let moved: Vec<i64> = sets[gone].drain().collect();
                sets[keep].extend(moved);
                active[gone] = false;
                parent[gone] = keep;
                remaining -= 1;
            } else {
                // Najbliżsi sobie nawzajem, a mimo to za mało podobni: żadna z tych grup nie połączy się z nikim innym.
                active[a] = false;
                active[b] = false;
                remaining -= 2;
            }
        } else {
            chain.push(b);
        }
    }
    let root = |mut i: usize| { while parent[i] != i { i = parent[i]; } i };
    let mut ids: HashMap<usize, usize> = HashMap::new();
    (0..n).map(|i| { let r = root(i); let k = ids.len(); *ids.entry(r).or_insert(k) }).collect()
}

/// Pełne grupowanie wszystkich twarzy: hierarchiczne grupowanie twarzy dobrej jakości, a potem dołączenie słabszych do najbliższej pewnej
/// osoby (słabe twarze nie zakładają osób). Zwraca numer grupy albo None (twarz bez grupy).
pub fn cluster_all(embs: &[&[f32]], quality: &[f32], photos: &[i64], threshold: f32, stop: &dyn Fn() -> bool) -> Vec<Option<usize>> {
    let core: Vec<usize> = (0..embs.len()).filter(|&i| quality[i] >= LEARN_QUALITY).collect();
    let core_embs: Vec<&[f32]> = core.iter().map(|&i| embs[i]).collect();
    let core_photos: Vec<i64> = core.iter().map(|&i| photos[i]).collect();
    let groups = agglomerate(&core_embs, &core_photos, threshold, stop);
    let mut out: Vec<Option<usize>> = vec![None; embs.len()];
    let mut cl = Clusters::new();
    for (k, &i) in core.iter().enumerate() {
        out[i] = Some(groups[k]);
        cl.add(groups[k] as i64, embs[i], quality[i], photos[i]);
    }
    for i in 0..embs.len() {
        if stop() {
            break;
        }
        if out[i].is_none() {
            if let Decision::Join { id, .. } = cl.decide(embs[i], 0.0, photos[i]) {
                out[i] = Some(id as usize);
                cl.apply(id, embs[i], 0.0, false, photos[i]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Prosty generator liczb losowych (xorshift), żeby test był powtarzalny.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 40) as f32 / (1u64 << 24) as f32
        }
        fn gauss(&mut self) -> f32 {
            let (a, b) = (self.next().max(1e-7), self.next());
            (-2.0 * a.ln()).sqrt() * (std::f32::consts::TAU * b).cos()
        }
        fn unit(&mut self) -> Vec<f32> {
            let mut v: Vec<f32> = (0..EMB_LEN).map(|_| self.gauss()).collect();
            normalize(&mut v);
            v
        }
    }

    struct Sample {
        identity: usize,
        emb: Vec<f32>,
        quality: f32,
        photo: i64,
    }

    /// Dane syntetyczne przypominające prawdziwe: „rodziny” (osoby mają wspólną składową), próbki o różnej jakości (słabe mają więcej
    /// szumu), część ujęć „skręcona” w stronę podobnej osoby z rodziny oraz zdjęcia grupowe (kilka różnych osób na jednym zdjęciu).
    fn dataset(identities: usize, per_identity: usize, family: usize, seed: u64) -> Vec<Sample> {
        let mut rng = Rng(seed);
        let shared: Vec<Vec<f32>> = (0..identities.div_ceil(family)).map(|_| rng.unit()).collect();
        let centers: Vec<Vec<f32>> = (0..identities)
            .map(|i| {
                let own = rng.unit();
                let mut c: Vec<f32> = own.iter().zip(&shared[i / family]).map(|(a, b)| 0.8 * a + 0.6 * b).collect();
                normalize(&mut c);
                c
            })
            .collect();
        let mut raw = Vec::new();
        for (i, c) in centers.iter().enumerate() {
            for _ in 0..per_identity {
                let q = 0.25 + 0.75 * rng.next();
                let sigma = 0.55 + (1.0 - q) * 1.1;
                let mut base = c.clone();
                if rng.next() < 0.35 && family > 1 {
                    let first = (i / family) * family;
                    let mate = first + (rng.next() * family as f32) as usize % family;
                    if mate != i && mate < centers.len() {
                        let w = 0.25 + 0.5 * rng.next();
                        base = c.iter().zip(&centers[mate]).map(|(x, y)| x * (1.0 - w) + y * w).collect();
                    }
                }
                let mut v: Vec<f32> = base.iter().map(|x| x + sigma * rng.gauss() / (EMB_LEN as f32).sqrt()).collect();
                normalize(&mut v);
                raw.push((i, v, q));
            }
        }
        for k in (1..raw.len()).rev() {
            let j = (rng.next() * (k + 1) as f32) as usize % (k + 1);
            raw.swap(k, j);
        }
        // Układamy twarze na zdjęciach: do 3 różnych osób na zdjęciu.
        let mut out = Vec::new();
        let (mut photo, mut in_photo): (i64, Vec<usize>) = (0, Vec::new());
        for (id, v, q) in raw {
            if in_photo.len() >= 3 || in_photo.contains(&id) || rng.next() < 0.4 {
                photo += 1;
                in_photo.clear();
            }
            in_photo.push(id);
            out.push(Sample { identity: id, emb: v, quality: q, photo });
        }
        out
    }

    /// Precyzja i kompletność parami oraz liczba grup i twarzy bez grupy.
    fn pair_scores(data: &[Sample], group: &[Option<usize>]) -> (f64, f64, usize, usize) {
        let (mut tp, mut fp, mut fnn) = (0u64, 0u64, 0u64);
        for i in 0..data.len() {
            for j in i + 1..data.len() {
                let same_truth = data[i].identity == data[j].identity;
                let same_group = matches!((group[i], group[j]), (Some(a), Some(b)) if a == b);
                match (same_truth, same_group) {
                    (true, true) => tp += 1,
                    (false, true) => fp += 1,
                    (true, false) => fnn += 1,
                    _ => {}
                }
            }
        }
        let groups: HashSet<usize> = group.iter().flatten().copied().collect();
        (tp as f64 / (tp + fp).max(1) as f64, tp as f64 / (tp + fnn).max(1) as f64, groups.len(), group.iter().filter(|g| g.is_none()).count())
    }

    /// Dotychczasowy algorytm: zachłannie, tylko środek grupy, próg 0.42, każda twarz może założyć osobę, bez wiedzy o zdjęciach.
    fn old_greedy(data: &[Sample]) -> Vec<Option<usize>> {
        let mut sums: Vec<Vec<f32>> = Vec::new();
        let mut out = Vec::new();
        for s in data {
            let best = sums.iter().enumerate().map(|(i, sum)| { let mut c = sum.clone(); normalize(&mut c); (i, cosine(&c, &s.emb)) }).max_by(|a, b| a.1.total_cmp(&b.1));
            let id = match best {
                Some((i, sc)) if sc >= 0.42 => i,
                _ => { sums.push(vec![0.0; EMB_LEN]); sums.len() - 1 }
            };
            sums[id].iter_mut().zip(&s.emb).for_each(|(a, b)| *a += b);
            out.push(Some(id));
        }
        out
    }

    /// Nowy algorytm przyrostowy (z ograniczeniem „jedno zdjęcie”, jakością i marginesem).
    fn incremental(data: &[Sample]) -> Vec<Option<usize>> {
        let mut cl = Clusters::new();
        let mut next = 0i64;
        let mut out = Vec::new();
        for s in data {
            let id = match cl.decide(&s.emb, s.quality, s.photo) {
                Decision::Join { id, learn } => { cl.apply(id, &s.emb, s.quality, learn, s.photo); Some(id) }
                Decision::New => { next += 1; cl.apply(next, &s.emb, s.quality, true, s.photo); Some(next) }
                Decision::Unassigned => None,
            };
            out.push(id.map(|i| i as usize));
        }
        out
    }

    fn offline(data: &[Sample], t: f32) -> Vec<Option<usize>> {
        let embs: Vec<&[f32]> = data.iter().map(|d| d.emb.as_slice()).collect();
        let q: Vec<f32> = data.iter().map(|d| d.quality).collect();
        let p: Vec<i64> = data.iter().map(|d| d.photo).collect();
        cluster_all(&embs, &q, &p, t, &|| false)
    }

    #[test]
    fn sweep_offline_threshold() {
        for t in [0.25f32, 0.3, 0.35, 0.4, 0.45] {
            let (mut p, mut r, mut g, mut u) = (0.0, 0.0, 0usize, 0usize);
            let runs = 6;
            for seed in 0..runs {
                let data = dataset(24, 14, 4, 1000 + seed * 7919);
                let (pp, rr, gg, uu) = pair_scores(&data, &offline(&data, t));
                p += pp; r += rr; g += gg; u += uu;
            }
            let n = runs as f64;
            eprintln!("hierarchiczny t={t:.2}: P {:.3} R {:.3} grup {:.0} bez grupy {:.0}", p / n, r / n, g as f64 / n, u as f64 / n);
        }
    }

    #[test]
    fn new_clustering_beats_the_old_greedy_one_on_realistic_data() {
        let (mut old, mut inc, mut off) = ((0.0, 0.0), (0.0, 0.0), (0.0, 0.0));
        let runs = 6;
        for seed in 0..runs {
            let data = dataset(24, 14, 4, 1000 + seed * 7919);
            let (po, ro, _, _) = pair_scores(&data, &old_greedy(&data));
            let (pi, ri, _, ui) = pair_scores(&data, &incremental(&data));
            let (pf, rf, gf, uf) = pair_scores(&data, &offline(&data, LINKAGE));
            eprintln!("seed {seed}: stary P {po:.3} R {ro:.3} | przyrostowy P {pi:.3} R {ri:.3} (bez grupy {ui}) | hierarchiczny P {pf:.3} R {rf:.3} (grup {gf}, bez grupy {uf})");
            old.0 += po; old.1 += ro; inc.0 += pi; inc.1 += ri; off.0 += pf; off.1 += rf;
        }
        let r = runs as f64;
        eprintln!("ŚREDNIO: stary P {:.3} R {:.3} | przyrostowy P {:.3} R {:.3} | hierarchiczny P {:.3} R {:.3}", old.0 / r, old.1 / r, inc.0 / r, inc.1 / r, off.0 / r, off.1 / r);
        let f = |p: f64, rc: f64| 2.0 * p * rc / (p + rc);
        assert!(off.0 / r > old.0 / r, "precyzja grupowania hierarchicznego ma być wyższa niż dotychczasowego");
        assert!(f(off.0 / r, off.1 / r) > f(old.0 / r, old.1 / r), "miara F1 hierarchicznego ma być wyższa niż dotychczasowego");
        // Wariant przyrostowy (bez końcowego grupowania) jest tylko do porównania: program po każdej analizie grupuje wszystkie twarze od nowa.
        assert!(inc.0 / r > old.0 / r - 0.02, "przyrostowy nie może mieć gorszej precyzji niż dotychczasowy");
    }

    #[test]
    fn same_photo_faces_never_end_up_in_one_group() {
        let data = dataset(20, 12, 4, 77);
        let groups = offline(&data, LINKAGE);
        let mut seen: HashSet<(i64, usize)> = HashSet::new();
        for (s, g) in data.iter().zip(&groups) {
            if let Some(g) = g {
                assert!(seen.insert((s.photo, *g)), "dwie twarze ze zdjęcia {} w jednej grupie {}", s.photo, g);
            }
        }
        let inc = incremental(&data);
        let mut seen: HashSet<(i64, usize)> = HashSet::new();
        for (s, g) in data.iter().zip(&inc) {
            if let Some(g) = g {
                assert!(seen.insert((s.photo, *g)), "przyrostowy: dwie twarze ze zdjęcia {} w grupie {}", s.photo, g);
            }
        }
    }

    #[test]
    fn weak_faces_cannot_create_people_and_ambiguous_faces_do_not_change_a_person() {
        let mut rng = Rng(5);
        let (a, b) = (rng.unit(), rng.unit());
        let mut cl = Clusters::new();
        cl.add(1, &a, 0.9, 100);
        cl.add(2, &b, 0.9, 101);
        let stranger = rng.unit();
        assert_eq!(cl.decide(&stranger, 0.3, 1), Decision::Unassigned, "słaba obca twarz nie zakłada osoby");
        assert_eq!(cl.decide(&stranger, 0.9, 1), Decision::New, "dobra obca twarz zakłada osobę");
        assert!(matches!(cl.decide(&a, 0.9, 2), Decision::Join { id: 1, learn: true }));
        // Osoba już obecna na tym zdjęciu nie może dostać drugiej twarzy z tego zdjęcia.
        assert_ne!(cl.decide(&a, 0.9, 100), Decision::Join { id: 1, learn: true });
        let mut mid: Vec<f32> = a.iter().zip(&b).map(|(x, y)| x + y).collect();
        normalize(&mut mid);
        if let Decision::Join { learn, .. } = cl.decide(&mid, 0.9, 3) {
            assert!(!learn, "niepewne przypisanie nie może zasilać osoby");
        }
        assert_eq!(cl.decide(&mid, 0.3, 3), Decision::Unassigned);
    }

    #[test]
    fn merge_candidates_find_split_people_but_not_people_seen_together() {
        let mut rng = Rng(11);
        let a = rng.unit();
        let mut a2 = a.clone();
        a2[0] += 0.05;
        normalize(&mut a2);
        let other = rng.unit();
        let mut cl = Clusters::new();
        cl.add(1, &a, 0.9, 1);
        cl.add(2, &a2, 0.9, 2);
        cl.add(3, &other, 0.9, 3);
        let c = cl.merge_candidates(AUTO_MERGE);
        assert_eq!(c.len(), 1);
        assert_eq!((c[0].0, c[0].1), (1, 2));
        // Gdyby te dwie osoby były razem na jednym zdjęciu, to na pewno nie jest ta sama osoba.
        let mut cl2 = Clusters::new();
        cl2.add(1, &a, 0.9, 1);
        cl2.add(2, &a2, 0.9, 1);
        assert!(cl2.merge_candidates(AUTO_MERGE).is_empty());
        cl.merge(2, 1);
        assert_eq!(cl.people_count(), 2);
        assert_eq!(cl.person(1).unwrap().size(), 2);
    }

    #[test]
    fn agglomerate_handles_tiny_and_degenerate_inputs() {
        assert!(agglomerate(&[], &[], 0.3, &|| false).is_empty());
        let mut rng = Rng(3);
        let v = rng.unit();
        assert_eq!(agglomerate(&[&v], &[1], 0.3, &|| false), vec![0]);
        // Identyczne wektory z różnych zdjęć łączą się, z tego samego zdjęcia nie.
        assert_eq!(agglomerate(&[&v, &v], &[1, 2], 0.3, &|| false), vec![0, 0]);
        assert_eq!(agglomerate(&[&v, &v], &[1, 1], 0.3, &|| false), vec![0, 1]);
    }

    #[test]
    fn a_person_with_many_faces_accepts_new_faces_more_readily() {
        let mut rng = Rng(7);
        let base = rng.unit();
        // Twarz o zadanym podobieństwie do `base` (reszta to losowy szum prostopadły).
        let at = |rng: &mut Rng, sim: f32| -> Vec<f32> {
            let noise = rng.unit();
            let dot = cosine(&noise, &base);
            let ortho: Vec<f32> = noise.iter().zip(&base).map(|(n, b)| n - dot * b).collect();
            let mut o = ortho;
            normalize(&mut o);
            let mut v: Vec<f32> = base.iter().zip(&o).map(|(b, o)| sim * b + (1.0 - sim * sim).sqrt() * o).collect();
            normalize(&mut v);
            v
        };
        let probe = at(&mut rng, 0.41);

        // Osoba znana z jednej twarzy: próg 0.45, więc 0.41 to za mało.
        let mut one = Clusters::new();
        one.add(1, &base, 0.9, 100);
        assert!((one.person(1).unwrap().join_threshold() - JOIN).abs() < 1e-6);
        assert_eq!(one.decide(&probe, 0.9, 200), Decision::New);

        // Ta sama osoba znana z wielu ujęć: próg spada i ta sama twarz do niej dołącza.
        let mut many = Clusters::new();
        for k in 0..10 {
            let f = at(&mut rng, 0.93);
            many.add(1, &f, 0.9, 100 + k);
        }
        let t = many.person(1).unwrap().join_threshold();
        assert!(t < JOIN && t >= JOIN - JOIN_MAX_BONUS - 1e-6, "próg {t}");
        assert!(matches!(many.decide(&at(&mut rng, 0.9), 0.9, 300), Decision::Join { id: 1, .. }));
        assert!(many.person(1).unwrap().join_threshold() > 0.36, "nigdy poniżej progu tożsamości");
    }

    /// Dziecko zmienia się co roku: każdy rok jest podobny do sąsiednich (cos ~0.6), ale rok 1 i rok 6 niewiele mają wspólnego.
    /// Zdjęcie z roku 4 nie pasuje do średniej z lat 1-3, ale pasuje do wzorców z lat 3, więc osoba „idzie za dzieckiem” przez lata.
    #[test]
    fn a_child_is_followed_through_the_years_by_nearby_photos() {
        let mut rng = Rng(11);
        // Wektor „wieku”: kolejne lata to losowy spacer o stałej długości kroku, więc sąsiednie lata są podobne, a odległe nie.
        let mut face = rng.unit();
        let mut years: Vec<Vec<f32>> = Vec::new();
        for _ in 0..8 {
            years.push(face.clone());
            let step = rng.unit();
            face = face.iter().zip(&step).map(|(a, b)| 0.82 * a + 0.57 * b).collect();
            normalize(&mut face);
        }
        let day = |y: usize| 365 * y as i32;
        let mut cl = Clusters::new();
        for y in 0..3 {
            cl.add_at(1, &years[y], 0.9, 100 + y as i64, Some(day(y)));
        }
        // Rok 4 (indeks 3): bez dat człowiek jest „za daleko” od średniej z lat 0-2, z datami pasuje do roku 2.
        let probe = &years[3];
        let global = cl.person(1).unwrap().score(probe);
        let timed = cl.person(1).unwrap().score_at(probe, Some(day(3)));
        assert!(timed > global, "ocena z uwzględnieniem czasu ({timed}) jest wyższa niż globalna ({global})");
        // Rok 8 (indeks 7), gdy znamy tylko lata 0-2, nadal nie pasuje (za duża przerwa w czasie).
        assert!(cl.person(1).unwrap().score_at(&years[7], Some(day(7))) < JOIN);
    }

    #[test]
    fn exemplars_keep_a_spread_of_years() {
        let mut rng = Rng(5);
        let mut p = Person::new();
        // 40 zdjęć z jednego roku o wysokiej jakości i jedno z odległego roku o niskiej: stare ujęcie nie może zniknąć.
        p.learn(&rng.unit(), 0.3, Some(0));
        for k in 0..40 {
            p.learn(&rng.unit(), 0.9, Some(5000 + k));
        }
        assert!(p.exemplars.len() <= EXEMPLARS);
        assert!(p.exemplars.iter().any(|e| e.2 == Some(0)), "wzorzec z innego okresu zostaje mimo niskiej jakości");
    }
}
