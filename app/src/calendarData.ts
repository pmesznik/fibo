/**
 * Dane kalendarza: nazwy, siatka miesiąca, polskie święta (z ruchomymi, liczonymi od Wielkanocy), ważne daty użytkownika
 * oraz inteligentny dobór zdjęć. Czysta logika bez przeglądarki i bez Tauri, więc da się ją testować w Node.
 */
import type { Photo } from './api'

export const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']
export const MONTHS_SHORT = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']
const DAYS_MON = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd']

export type WeekStart = 'mon' | 'sun'

export const dayNames = (start: WeekStart): string[] => (start === 'mon' ? DAYS_MON : [DAYS_MON[6], ...DAYS_MON.slice(0, 6)])
/** Czy kolumna `col` (0 do 6) w siatce to niedziela (kolumna święta) albo sobota. */
export const isSundayCol = (col: number, start: WeekStart) => (start === 'mon' ? col === 6 : col === 0)
export const isSaturdayCol = (col: number, start: WeekStart) => (start === 'mon' ? col === 5 : col === 6)

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Siatka miesiąca: tygodnie po 7 komórek, puste miejsca to null. `month` liczone od 1. */
export function monthGrid(year: number, month: number, start: WeekStart): (number | null)[][] {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0 = niedziela
  const offset = start === 'mon' ? (dow + 6) % 7 : dow
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

/** Niedziela Wielkanocna (kalendarz gregoriański, algorytm Meeusa, Jonesa i Butchera): [miesiąc od 1, dzień]. */
export function easter(year: number): [number, number] {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  return [month, ((h + l - 7 * m + 114) % 31) + 1]
}

export type Holiday = { month: number; day: number; name: string }

const plus = (year: number, month: number, day: number, n: number): [number, number] => {
  const d = new Date(Date.UTC(year, month - 1, day + n))
  return [d.getUTCMonth() + 1, d.getUTCDate()]
}

/** Polskie dni ustawowo wolne od pracy: stałe i ruchome (Wielkanoc, Zesłanie Ducha Świętego, Boże Ciało); Wigilia od 2025 roku. */
export function polishHolidays(year: number): Holiday[] {
  const [em, ed] = easter(year)
  const [pm, pd] = plus(year, em, ed, 49)
  const [rm, rd] = plus(year, em, ed, 1)
  const [bm, bd] = plus(year, em, ed, 60)
  const list: Holiday[] = [
    { month: 1, day: 1, name: 'Nowy Rok' }, { month: 1, day: 6, name: 'Trzech Króli' },
    { month: em, day: ed, name: 'Wielkanoc' }, { month: rm, day: rd, name: 'Poniedziałek Wielkanocny' },
    { month: 5, day: 1, name: 'Święto Pracy' }, { month: 5, day: 3, name: 'Święto Konstytucji 3 Maja' },
    { month: pm, day: pd, name: 'Zielone Świątki' }, { month: bm, day: bd, name: 'Boże Ciało' },
    { month: 8, day: 15, name: 'Wniebowzięcie NMP' }, { month: 11, day: 1, name: 'Wszystkich Świętych' },
    { month: 11, day: 11, name: 'Święto Niepodległości' }, { month: 12, day: 25, name: 'Boże Narodzenie' }, { month: 12, day: 26, name: 'Drugi dzień Świąt' },
  ]
  if (year >= 2025) list.push({ month: 12, day: 24, name: 'Wigilia' })
  return list.sort((x, y) => x.month - y.month || x.day - y.day)
}

export type CalEvent = { month: number; day: number; label: string }

/** Ważne daty użytkownika: jedna na linię, np. „24.05 Urodziny Mamy” (powtarzają się co roku). Błędne linie są pomijane. */
export function parseEvents(text: string): CalEvent[] {
  const out: CalEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{1,2})[./-](\d{1,2})(?:[./-]\d{2,4})?\.?\s+(.+?)\s*$/)
    if (!m) continue
    const day = +m[1], month = +m[2]
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(2024, month)) continue
    out.push({ month, day, label: m[3].slice(0, 60) })
    if (out.length >= 300) break
  }
  return out
}

/** Dzień (liczba) -> nazwy świąt i ważnych dat tego dnia w danym miesiącu. */
export function dayNotes(month: number, holidays: Holiday[], events: CalEvent[]): Map<number, { holiday: string[]; event: string[] }> {
  const map = new Map<number, { holiday: string[]; event: string[] }>()
  const at = (d: number) => map.get(d) ?? map.set(d, { holiday: [], event: [] }).get(d)!
  holidays.filter((h) => h.month === month).forEach((h) => at(h.day).holiday.push(h.name))
  events.filter((e) => e.month === month).forEach((e) => at(e.day).event.push(e.label))
  return map
}

// ---------------------------------------------------------------------------------------------------------------------
// Inteligentny dobór zdjęć. Wszystko lokalnie: ocena i ulubione, rozdzielczość, ostrość z miniatury, twarze (liczba i jakość z analizy twarzy),
// pora roku (zdjęcia z danego miesiąca pasują do tego miesiąca), różnorodność (bez powtórek z jednego dnia, folderu i koloru obok siebie).

export type FaceStat = { faces: number; quality: number }
export type Orientation = 'portrait' | 'landscape'

const takenParts = (p: Photo): { y: number; m: number; day: string } | null => {
  const t = p.taken
  const m = t?.match(/^(\d{4})[-:](\d{2})[-:](\d{2})/)
  return m ? { y: +m[1], m: +m[2], day: `${m[1]}${m[2]}${m[3]}` } : null
}
const folderOf = (p: Photo) => p.path.replace(/[\\/][^\\/]*$/, '')

/** Ocena zdjęcia bez ostrości (0 do ok. 10): im wyżej, tym lepiej nadaje się do kalendarza. */
export function metaScore(p: Photo, month: number | null, year: number, orientation: Orientation, faces?: FaceStat): number {
  const mp = Math.min(12, ((p.width ?? 0) * (p.height ?? 0)) / 1e6) / 12
  const landscape = (p.width ?? 4) >= (p.height ?? 3)
  let s = (p.rating || 0) * 1.2 + (p.favorite ? 3 : 0) + (p.tags.length ? 0.4 : 0) + (p.caption ? 0.4 : 0) + mp * 1.5
  // Strona pionowa ma szeroką ramkę na zdjęcie, a pozioma prawie kwadratową.
  s += orientation === 'portrait' ? (landscape ? 1 : 0) : landscape ? 0 : 0.5
  if (faces && faces.faces > 0) s += faces.quality * 1.2 + (faces.faces <= 4 ? 1 : 0.3)
  const t = takenParts(p)
  if (t && month !== null) {
    if (t.m === month) s += 2.5
    if (t.y === year - 1) s += 0.6
    else if (t.y === year) s += 0.3
  }
  return s
}

export async function autoPick(
  photos: Photo[],
  year: number,
  orientation: Orientation,
  faces: Map<number, FaceStat>,
  sharpness: (id: number) => Promise<number>,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<number, number>> {
  const usable = photos.filter((p) => p.id >= 0)
  const picks: Record<number, number> = {}
  const usedIds = new Set<number>()
  const usedDays = new Set<string>()
  const sharpCache = new Map<number, number>()
  const sharp = async (id: number) => {
    if (!sharpCache.has(id)) sharpCache.set(id, await sharpness(id).catch(() => 0))
    return sharpCache.get(id)!
  }
  let prev: Photo | null = null

  const choose = async (month: number | null, seasonalOnly = false): Promise<Photo | null> => {
    const ranked = usable
      .filter((p) => !usedIds.has(p.id) && (!seasonalOnly || takenParts(p)?.m === month))
      .map((p) => ({ p, s: metaScore(p, month, year, orientation, faces.get(p.id)) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
    if (!ranked.length) return null
    const sh = await Promise.all(ranked.map((r) => sharp(r.p.id)))
    const top = Math.max(1e-9, ...sh)
    let best: { p: Photo; s: number } | null = null
    ranked.forEach((r, i) => {
      let s = r.s + 3 * (sh[i] / top)
      const t = takenParts(r.p)
      if (t && usedDays.has(t.day)) s -= 2
      if (prev && folderOf(prev) === folderOf(r.p)) s -= 0.8
      if (prev && prev.color != null && prev.color === r.p.color) s -= 0.6
      if (!best || s > best.s) best = { p: r.p, s }
    })
    return best ? (best as { p: Photo; s: number }).p : null
  }

  // Najpierw zdjęcia z pasującego miesiąca (od miesięcy z najmniejszym wyborem, żeby nikt nie zabrał jedynego zdjęcia innemu),
  // potem uzupełnienie pozostałych miesięcy najlepszymi z reszty.
  const take = (month: number, p: Photo) => {
    picks[month] = p.id
    usedIds.add(p.id)
    const t = takenParts(p)
    if (t) usedDays.add(t.day)
    prev = p
  }
  const available = (m: number) => usable.filter((p) => takenParts(p)?.m === m).length
  const order = Array.from({ length: 12 }, (_, i) => i + 1).sort((x, y) => available(x) - available(y) || x - y)
  let done = 0
  for (const m of order) {
    if (available(m) === 0) continue
    const p = await choose(m, true)
    if (p) take(m, p)
    onProgress?.(++done, 13)
  }
  for (let m = 1; m <= 12; m++) {
    if (picks[m] !== undefined) continue
    const p = await choose(m)
    if (p) take(m, p)
    onProgress?.(++done, 13)
  }
  const cover = await choose(null)
  if (cover) picks[0] = cover.id
  onProgress?.(13, 13)
  return picks
}
