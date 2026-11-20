/**
 * Drzewo kopii: z grup duplikatów wyznacza, które foldery (razem z podfolderami) są kopiami innych, który z pary jest oryginałem
 * i które zdjęcia można bezpiecznie przenieść do Kosza. Czysta logika bez Tauri, testowana w Node; niczego nie zmienia.
 *
 * Pomysły zaczerpnięte z innych programów:
 *  - foldery chronione (dupeGuru „reference”, Czkawka „reference folders”, digiKam „reference album”): z nich nigdy nic nie zaznaczamy;
 *  - zwijanie par do najwyższego wspólnego poziomu (Duplicate Cleaner, zakładka „Duplicate folders”): gdy D:\Kopia\2019 jest kopią
 *    C:\Zdjęcia\2019 razem ze wszystkimi podfolderami, pokazujemy jedną parę zamiast setek par podfolderów;
 *  - zasady wyboru zdjęcia, które zostaje (Duplicate Cleaner „Selection Assistant”): chroniony folder, strona oryginału, nazwa bez
 *    „kopia”, większa rozdzielczość, większy plik, data z aparatu.
 */

export type GroupLite = { kind: 'exact' | 'similar'; ids: number[] }
export type PhotoInfo = { id: number; path: string; size: number; width?: number | null; height?: number | null; taken?: string | null }

/** Para folderów: `copy` w całości (lub w części) powtarza zdjęcia z `original`. */
export type CopyRelation = {
  copy: string
  original: string
  /**
   * identical: te same zdjęcia po obu stronach; subset: wszystkie zdjęcia kopii są też w oryginale, który ma ich więcej;
   * scattered: każde zdjęcie z kopii ma odpowiednik gdzieś indziej, ale w różnych folderach (np. „Pobrane”); `original` to folder,
   * w którym jest ich najwięcej, a `elsewhere` mówi, w ilu folderach w sumie.
   */
  kind: 'identical' | 'subset' | 'scattered'
  elsewhere: number
  /** Porównano całe drzewa z podfolderami (true) albo tylko zdjęcia leżące bezpośrednio w folderach (false). */
  withSub: boolean
  /** Ile różnych zdjęć jest wspólnych. */
  shared: number
  copyCount: number
  originalCount: number
  /** Wspólne zdjęcia to identyczne pliki (a nie tylko podobne). */
  exact: boolean
  /** Ile bajtów zwolni przeniesienie kopii do Kosza. */
  bytes: number
  /** Dlaczego ta strona to oryginał. */
  reasons: string[]
  /** Kierunek jest pewny (jest powód), a nie wybrany na ślepo. */
  sure: boolean
  /** Folder kopii jest chroniony: z tej pary nic nie usuniemy. */
  blocked: boolean
}

export type TreeNode = {
  path: string
  /** Napis w drzewie (zwinięty łańcuch pojedynczych folderów, np. „Users\Ola\Pictures”). */
  label: string
  depth: number
  /** Zdjęcia w tym drzewie, które mają kopię gdzie indziej. */
  dups: number
  total: number
  protected: boolean
  role: 'original' | 'copy' | 'both' | null
  children: number
}

export const MIN_SHARED = 2
/** Grupa rozrzucona po więcej niż tylu folderach nie tworzy par (to raczej ikony lub tapety niż kopie folderów). */
const MAX_DIRS_PER_GROUP = 40

const sepRe = /[\\/]/
export const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\')
/** Czy `path` leży w folderze `dir` (lub jest nim). Bez rozróżniania wielkości liter i rodzaju ukośnika, jak w Windows. */
export const isInside = (path: string, dir: string) => { const p = norm(path), d = norm(dir); return p === d || p.startsWith(d + '\\') }
/** Foldery nadrzędne ścieżki folderu, od niej samej w górę („C:\A\B”, „C:\A”, „C:”). */
export function ancestors(dir: string): string[] {
  const out: string[] = []
  let cur = dir.replace(/[\\/]+$/, '')
  while (cur) {
    out.push(cur)
    const i = Math.max(cur.lastIndexOf('\\'), cur.lastIndexOf('/'))
    if (i <= 0) break
    cur = cur.slice(0, i)
  }
  return out
}

/** Szybki test „czy folder leży w którymś z folderów `dirs`” (zbiór i przejście w górę zamiast porównywania z każdym). */
export function insideAny(dirs: string[]): (dir: string) => boolean {
  const set = new Set(dirs.map(norm))
  const cache = new Map<string, boolean>()
  return (dir: string) => {
    let v = cache.get(dir)
    if (v === undefined) { v = set.size > 0 && ancestors(norm(dir)).some((a) => set.has(a)); cache.set(dir, v) }
    return v
  }
}

const HINT = /(^|[\s_.\-([])(kopia|kopie|kopii|copy|copies|backup|back-up|bak|duplikat|duplikaty|duplicate|duplicates|old|stare|stary|archiwum|archive|tmp|temp|pobrane|downloads|whatsapp|messenger)(?=$|[\s_.\-)\]\d])/i
const FILE_HINT = /(\s?\(\d+\)|[\s_-]kopia(\s?\(\d+\))?|[\s_-]copy(\s?\(\d+\))?)\.[a-z0-9]+$|^(kopia|copy of)[\s_-]/i
/** Słowo w nazwie folderu (lub folderów nadrzędnych do `stop`), które wskazuje na kopię, np. „Kopia”, „Backup”, „Pobrane”. */
export function copyHint(dir: string, stop = ''): string | null {
  const parts = dir.split(sepRe)
  const from = stop ? stop.split(sepRe).length : 0
  for (let i = parts.length - 1; i >= Math.max(1, from - 1); i--) {
    const m = parts[i].match(HINT)
    if (m) return parts[i]
    if (/\(\d+\)\s*$/.test(parts[i])) return parts[i]
  }
  return null
}
export const fileCopyHint = (path: string) => FILE_HINT.test(path.replace(/^.*[\\/]/, ''))

type Prepared = {
  byId: Map<number, PhotoInfo>
  groupOf: Map<number, number>
  exactGroup: Set<number>
  /** Grupy w drzewie folderu (z podfolderami) i w samym folderze. */
  subG: Map<string, Set<number>>
  dirG: Map<string, Set<number>>
  /** Zdjęcia bez kopii (w drzewie i w samym folderze). */
  subUnique: Map<string, number>
  dirUnique: Map<string, number>
  subCount: Map<string, number>
  dirCount: Map<string, number>
}

function prepare(groups: GroupLite[], photos: PhotoInfo[]): Prepared {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const groupOf = new Map<number, number>()
  const exactGroup = new Set<number>()
  groups.forEach((g, i) => {
    const m = g.ids.filter((id) => byId.has(id))
    if (m.length < 2) return
    for (const id of m) groupOf.set(id, i)
    if (g.kind === 'exact') exactGroup.add(i)
  })
  const subG = new Map<string, Set<number>>(), dirG = new Map<string, Set<number>>()
  const subUnique = new Map<string, number>(), dirUnique = new Map<string, number>()
  const subCount = new Map<string, number>(), dirCount = new Map<string, number>()
  const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const p of photos) {
    const d = dirOf(p.path)
    const g = groupOf.get(p.id)
    add(dirCount, d)
    if (g === undefined) add(dirUnique, d)
    else { if (!dirG.has(d)) dirG.set(d, new Set()); dirG.get(d)!.add(g) }
    for (const a of ancestors(d)) {
      add(subCount, a)
      if (g === undefined) add(subUnique, a)
      else { if (!subG.has(a)) subG.set(a, new Set()); subG.get(a)!.add(g) }
    }
  }
  return { byId, groupOf, exactGroup, subG, dirG, subUnique, dirUnique, subCount, dirCount }
}

/** Czy wszystkie zdjęcia z X mają kopię w Y (X ⊆ Y), według zbiorów grup i liczby zdjęć bez kopii. */
function within(gx: Set<number> | undefined, ux: number, gy: Set<number> | undefined): boolean {
  if (ux > 0 || !gx || !gy || gx.size === 0) return false
  for (const g of gx) if (!gy.has(g)) return false
  return true
}
function sharedOf(a: Set<number> | undefined, b: Set<number> | undefined): number[] {
  if (!a || !b) return []
  const [s, l] = a.size < b.size ? [a, b] : [b, a]
  const out: number[] = []
  for (const g of s) if (l.has(g)) out.push(g)
  return out
}
const related = (a: string, b: string) => isInside(a, b) || isInside(b, a)

/** Relacja dwóch folderów: który jest w którym. `sub`: porównanie drzew z podfolderami. */
type Rel = { kind: 'identical' | 'subset'; inner: string; outer: string; shared: number[] } | null
const relCache = new WeakMap<Prepared, Map<string, Rel>>()
/** Jak `relateRaw`, z pamięcią: wiele par podfolderów podnosi się do tej samej pary folderów nadrzędnych. */
function relate(P: Prepared, a: string, b: string, sub: boolean): Rel {
  let m = relCache.get(P)
  if (!m) { m = new Map(); relCache.set(P, m) }
  const k = `${a}\u0000${b}\u0000${sub ? 1 : 0}`
  let v = m.get(k)
  if (v === undefined) { v = relateRaw(P, a, b, sub); m.set(k, v) }
  return v
}
function relateRaw(P: Prepared, a: string, b: string, sub: boolean): Rel {
  const G = sub ? P.subG : P.dirG, U = sub ? P.subUnique : P.dirUnique
  const ga = G.get(a), gb = G.get(b)
  const shared = sharedOf(ga, gb)
  if (shared.length < MIN_SHARED) return null
  const aIn = within(ga, U.get(a) ?? 0, gb), bIn = within(gb, U.get(b) ?? 0, ga)
  if (aIn && bIn) return { kind: 'identical', inner: a, outer: b, shared }
  if (aIn) return { kind: 'subset', inner: a, outer: b, shared }
  if (bIn) return { kind: 'subset', inner: b, outer: a, shared }
  return null
}

/**
 * Pary „kopia i oryginał”. Startuje od par folderów ze wspólnymi zdjęciami i podnosi każdą parę do folderów nadrzędnych, dopóki
 * całe drzewo jednej strony nadal powtarza się w drugiej. `protectedDirs`: foldery chronione (oryginały), z nich nic nie usuwamy.
 * `swapped`: pary, w których użytkownik zamienił kierunek (klucz `a|b` po posortowaniu).
 */
export function copyRelations(groups: GroupLite[], photos: PhotoInfo[], protectedDirs: string[] = [], swapped: Set<string> = new Set()): CopyRelation[] {
  const P = prepare(groups, photos)
  const isProt = insideAny(protectedDirs)
  const byDir = new Map<string, PhotoInfo[]>()
  for (const p of photos) { const k = dirOf(p.path); if (!byDir.has(k)) byDir.set(k, []); byDir.get(k)!.push(p) }
  /** Zdjęcia w folderze (z podfolderami, gdy `sub`). */
  const photosIn = (dir: string, sub: boolean) => sub ? [...byDir.entries()].filter(([k]) => isInside(k, dir)).flatMap(([, l]) => l) : byDir.get(dir) ?? []
  // Pary folderów (bezpośrednio) ze wspólnymi grupami.
  const where = new Map<number, Set<string>>()
  for (const [d, gs] of P.dirG) for (const g of gs) { if (!where.has(g)) where.set(g, new Set()); where.get(g)!.add(d) }
  const pairs = new Set<string>()
  for (const dirs of where.values()) {
    if (dirs.size < 2 || dirs.size > MAX_DIRS_PER_GROUP) continue
    const l = [...dirs].sort()
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (!related(l[i], l[j])) pairs.add(`${l[i]}\u0000${l[j]}`)
  }
  const found = new Map<string, { kind: 'identical' | 'subset'; inner: string; outer: string; shared: number[]; sub: boolean }>()
  const seenTop = new Set<string>()
  for (const key of pairs) {
    const [a, b] = key.split('\u0000')
    let best = relate(P, a, b, true)
    let cur = best ? { a, b } : null
    // Podnosimy parę o poziom wyżej, dopóki całe drzewo jednej strony powtarza się w drzewie drugiej.
    while (cur) {
      const pa = ancestors(cur.a)[1], pb = ancestors(cur.b)[1]
      // Nie podnosimy do całego dysku („D: to kopia C:”), bo to myli; wystarczy najwyższy folder.
      if (!pa || !pb || !sepRe.test(pa) || !sepRe.test(pb) || pa === pb || related(pa, pb)) break
      const up = relate(P, pa, pb, true)
      if (!up) break
      best = up; cur = { a: pa, b: pb }
    }
    let sub = true
    if (!best) { best = relate(P, a, b, false); sub = false }
    if (!best) continue
    const id = [best.inner, best.outer].sort().join('|') + (sub ? '' : '#')
    if (seenTop.has(id)) continue
    seenTop.add(id)
    found.set(id, { ...best, sub })
  }
  // Para zawarta w innej, już znalezionej parze z podfolderami (obie strony wewnątrz), jest zbędna.
  const tops = [...found.values()]
  const covered = (r: typeof tops[number]) => tops.some((t) => t !== r && t.sub && (t.inner !== r.inner || t.outer !== r.outer) &&
    ((isInside(r.inner, t.inner) && isInside(r.outer, t.outer)) || (isInside(r.inner, t.outer) && isInside(r.outer, t.inner))))

  const out: CopyRelation[] = []
  for (const r of tops) {
    if (covered(r)) continue
    const C = r.sub ? P.subCount : P.dirCount
    // Kierunek: domyślnie kopią jest strona zawarta w drugiej.
    let copy = r.inner, original = r.outer
    const reasons: string[] = []
    let sure = r.kind === 'subset'
    if (r.kind === 'subset') reasons.push('drugi folder ma wszystkie te zdjęcia i jeszcze inne')
    if (r.kind === 'identical') {
      const hi = copyHint(r.inner), ho = copyHint(r.outer)
      if (hi && !ho) { copy = r.inner; original = r.outer; reasons.push(`nazwa „${hi}” wskazuje na kopię`); sure = true }
      else if (ho && !hi) { copy = r.outer; original = r.inner; reasons.push(`nazwa „${ho}” wskazuje na kopię`); sure = true }
      else {
        // Nazwy plików typu „IMG_1 (1).jpg” albo „... - Kopia.jpg” też zdradzają kopię.
        const hits = (d: string) => photosIn(d, r.sub).filter((p) => fileCopyHint(p.path)).length
        const fi = hits(r.inner), fo = hits(r.outer)
        if (fi !== fo) { if (fo > fi) { copy = r.outer; original = r.inner } reasons.push('nazwy plików wskazują na kopie (np. „(1)” lub „Kopia”)'); sure = true }
        else { [copy, original] = [r.inner, r.outer].sort((x, y) => x.length - y.length || x.localeCompare(y)).reverse() as [string, string]; reasons.push('nie wiadomo, który jest oryginałem: sprawdź i w razie potrzeby zamień') }
      }
    }
    // Folder chroniony to zawsze oryginał.
    const pc = isProt(copy), po = isProt(original)
    if (pc && !po) { [copy, original] = [original, copy]; reasons.unshift('folder jest chroniony (oryginał)'); sure = true }
    else if (po) reasons.unshift('folder jest chroniony (oryginał)')
    const key = [copy, original].sort().join('|')
    if (swapped.has(key)) { [copy, original] = [original, copy]; reasons.unshift('kierunek wybrany przez Ciebie'); sure = true }
    const sharedSet = new Set(r.shared)
    let bytes = 0
    for (const p of photosIn(copy, r.sub)) if (sharedSet.has(P.groupOf.get(p.id) ?? -1)) bytes += p.size
    out.push({
      copy, original, kind: r.kind, elsewhere: 1, withSub: r.sub, shared: r.shared.length,
      copyCount: C.get(copy) ?? 0, originalCount: C.get(original) ?? 0,
      exact: r.shared.every((g) => P.exactGroup.has(g)), bytes, reasons, sure, blocked: isProt(copy),
    })
  }

  // Foldery rozproszonych kopii: każde zdjęcie (z podfolderami) ma odpowiednik poza folderem, choć nie w jednym miejscu.
  // Typowo „Pobrane”, „WhatsApp”, eksporty z innych programów. Bierzemy najwyższy taki folder (ale nie cały dysk).
  const coveredOutside = new Map<string, boolean>()
  const fullyElsewhere = (x: string): boolean => {
    let v = coveredOutside.get(x)
    if (v !== undefined) return v
    const gs = P.subG.get(x)
    v = !!gs && gs.size >= MIN_SHARED && (P.subUnique.get(x) ?? 0) === 0 && sepRe.test(x)
    if (v) for (const g of gs!) if (![...(where.get(g) ?? [])].some((dd) => !isInside(dd, x))) { v = false; break }
    coveredOutside.set(x, v)
    return v
  }
  const inKnownCopy = (x: string) => out.some((r) => r.withSub ? isInside(x, r.copy) : norm(r.copy) === norm(x))
  // Folder bez własnych zdjęć z jednym podfolderem zawężamy do tego podfolderu („C:\Users” → „C:\Users\Ola\Downloads”).
  const childDirs = new Map<string, string[]>()
  for (const k of P.subCount.keys()) { const up = ancestors(k)[1]; if (up) { if (!childDirs.has(up)) childDirs.set(up, []); childDirs.get(up)!.push(k) } }
  const narrow = (x: string): string => { const ch = childDirs.get(x) ?? []; return !(P.dirCount.get(x) ?? 0) && ch.length === 1 ? narrow(ch[0]) : x }
  const scatteredTops = new Set<string>()
  for (const x0 of P.subG.keys()) {
    if (!fullyElsewhere(x0)) continue
    const up = ancestors(x0)[1]
    if (up && fullyElsewhere(up)) continue
    const x = narrow(x0)
    if (scatteredTops.has(x)) continue
    scatteredTops.add(x)
    if (inKnownCopy(x) || out.some((r) => isInside(r.copy, x))) continue
    // Oryginał z już znalezionej pary też ma kopie gdzie indziej (właśnie w kopii), ale nie jest kopią.
    if (out.some((r) => r.kind !== 'scattered' && (r.withSub ? isInside(x, r.original) || isInside(r.original, x) : norm(r.original) === norm(x)))) continue
    const gs = P.subG.get(x)!
    const outside = new Map<string, number>()
    let outCount = 0
    for (const g of gs) for (const dd of where.get(g) ?? []) if (!isInside(dd, x)) { outside.set(dd, (outside.get(dd) ?? 0) + 1); outCount++ }
    const top = [...outside.entries()].sort((a, b) => b[1] - a[1])[0]
    let bytes = 0
    for (const p of photosIn(x, true)) bytes += p.size
    const hint = copyHint(x)
    out.push({
      copy: x, original: top?.[0] ?? '', kind: 'scattered', elsewhere: outside.size, withSub: true, shared: gs.size,
      copyCount: P.subCount.get(x) ?? 0, originalCount: outCount,
      exact: [...gs].every((g) => P.exactGroup.has(g)), bytes,
      reasons: [`każde zdjęcie z tego folderu ma kopię w innych folderach (${outside.size})`, ...(hint ? [`nazwa „${hint}” wskazuje na kopię`] : [])],
      sure: true, blocked: isProt(x),
    })
  }
  const tier = (r: CopyRelation) => (r.blocked ? 3 : r.kind === 'identical' ? 0 : r.kind === 'subset' ? 1 : 2)
  out.sort((x, y) => tier(x) - tier(y) || y.bytes - x.bytes || x.copy.localeCompare(y.copy))
  return out
}

export const relationKey = (r: { copy: string; original: string }) => [r.copy, r.original].sort().join('|')

const pixels = (p: PhotoInfo) => (p.width ?? 0) * (p.height ?? 0)

export type KeeperCtx = { prot: (p: PhotoInfo) => boolean; copySide: (p: PhotoInfo) => boolean; hinted: (p: PhotoInfo) => boolean }
/** Przygotowane testy dla `chooseKeeper` (z pamięcią podręczną), żeby przy dziesiątkach tysięcy grup nie liczyć ich od nowa. */
export function keeperCtx(protectedDirs: string[] = [], relations: CopyRelation[] = []): KeeperCtx {
  const live = relations.filter((r) => !r.blocked)
  const inProt = insideAny(protectedDirs), inSubCopy = insideAny(live.filter((r) => r.withSub).map((r) => r.copy))
  const direct = new Set(live.filter((r) => !r.withSub).map((r) => norm(r.copy)))
  const hintCache = new Map<string, boolean>()
  return {
    prot: (p) => inProt(dirOf(p.path)),
    copySide: (p) => { const d = dirOf(p.path); return inSubCopy(d) || direct.has(norm(d)) },
    hinted: (p) => { const d = dirOf(p.path); let h = hintCache.get(d); if (h === undefined) { h = !!copyHint(d); hintCache.set(d, h) } return h || fileCopyHint(p.path) },
  }
}

/**
 * Które zdjęcie z grupy zostaje: chroniony folder, potem strona oryginału z par, potem ścieżka bez słów typu „kopia”, potem większa
 * rozdzielczość, większy plik, data z aparatu i najstarszy wpis w bibliotece.
 */
export function chooseKeeper(list: PhotoInfo[], protectedDirs: string[] = [], relations: CopyRelation[] = [], ctx: KeeperCtx = keeperCtx(protectedDirs, relations)): PhotoInfo {
  const { prot, copySide: onCopySide, hinted } = ctx
  return [...list].sort((a, b) =>
    Number(prot(b)) - Number(prot(a)) || Number(onCopySide(a)) - Number(onCopySide(b)) || Number(hinted(a)) - Number(hinted(b)) ||
    pixels(b) - pixels(a) || b.size - a.size || Number(!!b.taken) - Number(!!a.taken) || a.id - b.id)[0]
}

/**
 * Domyślne zaznaczenie do Kosza: w każdej grupie zostaje jedno zdjęcie (`chooseKeeper`), reszta jest zaznaczona razem ze wskazaniem,
 * która kopia zostaje. Nigdy nie zaznaczamy zdjęć z chronionych folderów. Zdjęcia tylko podobne zaznaczamy wyłącznie wtedy, gdy
 * zostaje wersja o co najmniej takiej samej rozdzielczości i rozmiarze pliku (usuwamy mniejsze kopie, nigdy lepsze).
 */
export function planMarks(groups: GroupLite[], photos: PhotoInfo[], protectedDirs: string[] = [], relations: CopyRelation[] = []): Map<number, number> {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const marks = new Map<number, number>()
  const ctx = keeperCtx(protectedDirs, relations)
  for (const g of groups) {
    const list = g.ids.map((i) => byId.get(i)).filter((p): p is PhotoInfo => !!p)
    if (list.length < 2) continue
    const keep = chooseKeeper(list, protectedDirs, relations, ctx)
    for (const p of list) {
      if (p.id === keep.id || ctx.prot(p)) continue
      if (g.kind !== 'exact' && (pixels(p) > pixels(keep) || p.size > keep.size)) continue
      marks.set(p.id, keep.id)
    }
  }
  return marks
}

/**
 * Zaznacza do Kosza kopie z folderu `copy` (z podfolderami, gdy `withSub`), które mają odpowiednik poza nim; jako „zostaje” wskazuje
 * najlepszą kopię spoza tego folderu. Zdjęcia, które istnieją tylko w `copy`, nie są zaznaczane.
 */
export function marksForCopy(copy: string, withSub: boolean, groups: GroupLite[], photos: PhotoInfo[], protectedDirs: string[] = []): Map<number, number> {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const inside = (p: PhotoInfo) => withSub ? isInside(dirOf(p.path), copy) : dirOf(p.path) === copy
  const marks = new Map<number, number>()
  const ctx = keeperCtx(protectedDirs)
  for (const g of groups) {
    const list = g.ids.map((i) => byId.get(i)).filter((p): p is PhotoInfo => !!p)
    const mine = list.filter(inside), rest = list.filter((p) => !inside(p))
    if (!mine.length || !rest.length) continue
    const keep = chooseKeeper(rest, protectedDirs, [], ctx)
    for (const p of mine) {
      if (ctx.prot(p)) continue
      if (g.kind !== 'exact' && (pixels(p) > pixels(keep) || p.size > keep.size)) continue
      marks.set(p.id, keep.id)
    }
  }
  return marks
}

/**
 * Dokłada zaznaczenia `add` do `base` tak, żeby nigdy nie zniknęła ostatnia kopia: pomija zaznaczenie, którego „zostaje” jest już
 * zaznaczone do Kosza, i takie, które zaznaczałoby zdjęcie wskazane wcześniej jako „zostaje”. Zwraca nową mapę i liczbę pominiętych.
 */
export function mergeMarks(base: Map<number, number>, add: Map<number, number>): { marks: Map<number, number>; skipped: number } {
  const marks = new Map(base)
  const kept = new Set(base.values())
  let skipped = 0
  for (const [del, keep] of add) {
    if (marks.has(del)) continue
    if (marks.has(keep) || kept.has(del) || del === keep) { skipped++; continue }
    marks.set(del, keep)
    kept.add(keep)
  }
  return { marks, skipped }
}

/**
 * Ręczne zaznaczenie jednego zdjęcia z grupy. Zwraca null, gdy byłaby to ostatnia kopia albo zdjęcie leży w chronionym folderze.
 * Zdjęcia, które wskazywały je jako „zostaje”, dostają nową kopię do zachowania.
 */
export function markOne(base: Map<number, number>, group: PhotoInfo[], id: number, protectedDirs: string[] = []): Map<number, number> | null {
  const ctx = keeperCtx(protectedDirs)
  const me = group.find((p) => p.id === id)
  if (!me || ctx.prot(me)) return null
  const rest = group.filter((p) => p.id !== id && !base.has(p.id))
  if (!rest.length) return null
  const keep = chooseKeeper(rest, protectedDirs, [], ctx)
  const m = new Map(base)
  m.set(id, keep.id)
  for (const [d, k] of m) if (k === id) m.set(d, keep.id)
  return m
}

/** Zdejmuje zaznaczenie zdjęcia, a gdy ktoś inny wskazywał je jako „zostaje”, nic się nie psuje: ono przecież zostaje. */
export function unmark(base: Map<number, number>, id: number): Map<number, number> {
  const m = new Map(base)
  m.delete(id)
  return m
}

/**
 * Drzewo folderów, w których są duplikaty, spłaszczone do listy z wcięciami. Łańcuchy pojedynczych folderów bez własnych zdjęć
 * są zwijane w jeden wiersz. `open`: rozwinięte foldery (pozostałe pokazują tylko siebie).
 */
export function dupTree(groups: GroupLite[], photos: PhotoInfo[], relations: CopyRelation[], protectedDirs: string[] = [], open: Set<string> = new Set()): TreeNode[] {
  const P = prepare(groups, photos)
  const inProt = insideAny(protectedDirs)
  const dupCount = new Map<string, number>()
  for (const p of photos) if (P.groupOf.has(p.id)) for (const a of ancestors(dirOf(p.path))) dupCount.set(a, (dupCount.get(a) ?? 0) + 1)
  const kids = new Map<string, string[]>()
  const roots: string[] = []
  for (const d of dupCount.keys()) {
    const up = ancestors(d)[1]
    if (up && dupCount.has(up)) { if (!kids.has(up)) kids.set(up, []); kids.get(up)!.push(d) } else roots.push(d)
  }
  for (const l of kids.values()) l.sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }))
  roots.sort()
  const roleOf = (d: string): TreeNode['role'] => {
    const c = relations.some((r) => norm(r.copy) === norm(d)), o = relations.some((r) => norm(r.original) === norm(d))
    return c && o ? 'both' : c ? 'copy' : o ? 'original' : null
  }
  const out: TreeNode[] = []
  const walk = (d: string, depth: number, prefix: string) => {
    const ch = kids.get(d) ?? []
    // Zwijamy folder bez własnych zdjęć z jednym podfolderem i bez roli w parach.
    if (ch.length === 1 && !(P.dirCount.get(d) ?? 0) && !roleOf(d) && !protectedDirs.some((x) => norm(x) === norm(d))) {
      walk(ch[0], depth, prefix + (d.split(sepRe).pop() ?? d) + '\\')
      return
    }
    out.push({
      path: d, label: prefix + (d.split(sepRe).pop() || d), depth, dups: dupCount.get(d) ?? 0, total: P.subCount.get(d) ?? 0,
      protected: inProt(d), role: roleOf(d), children: ch.length,
    })
    if (open.has(d)) for (const c of ch) walk(c, depth + 1, '')
  }
  for (const r of roots) walk(r, 0, '')
  return out
}
