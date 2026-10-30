/**
 * Widok kalendarza biblioteki: zdjęcia pogrupowane według dnia wykonania (data z EXIF, a gdy jej nie ma, data pliku).
 * Czysta logika bez przeglądarki i bez Tauri, więc da się ją testować w Node.
 */
import type { Photo } from './api'

const pad = (n: number) => String(n).padStart(2, '0')

/** Dzień zdjęcia jako „RRRR-MM-DD”. */
export function dayKey(p: Pick<Photo, 'taken' | 'modified'>): string {
  const m = p.taken && /^(\d{4})[-:](\d{2})[-:](\d{2})/.exec(p.taken)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(p.modified * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export type DayIndex = Map<string, Photo[]>

/** Zdjęcia według dni; w każdym dniu od najwcześniejszego, żeby miniatura dnia była pierwszym zdjęciem dnia. */
export function indexByDay(photos: Photo[]): DayIndex {
  const map: DayIndex = new Map()
  for (const p of photos) {
    if (p.id < 0) continue
    const k = dayKey(p)
    const l = map.get(k)
    if (l) l.push(p); else map.set(k, [p])
  }
  const t = (p: Photo) => p.taken ?? ''
  for (const l of map.values()) l.sort((a, b) => t(a).localeCompare(t(b)) || a.modified - b.modified || a.id - b.id)
  return map
}

/** Liczba zdjęć w każdym miesiącu danego roku (tablica 12 liczb, styczeń pierwszy). */
export function monthCounts(index: DayIndex, year: number): number[] {
  const out = Array<number>(12).fill(0)
  const prefix = `${year}-`
  for (const [k, l] of index) if (k.startsWith(prefix)) out[+k.slice(5, 7) - 1] += l.length
  return out
}

/** Lata, w których są zdjęcia, od najnowszego. */
export function yearsWithPhotos(index: DayIndex): number[] {
  const ys = new Set<number>()
  for (const k of index.keys()) ys.add(+k.slice(0, 4))
  return [...ys].sort((a, b) => b - a)
}

/** Klucz dnia dla roku, miesiąca (od 1) i dnia. */
export const keyOf = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`

/** Miesiąc najnowszego zdjęcia: od niego zaczyna się widok. */
export function latestMonth(index: DayIndex, now = new Date()): { year: number; month: number } {
  let best = ''
  for (const k of index.keys()) if (k > best) best = k
  return best ? { year: +best.slice(0, 4), month: +best.slice(5, 7) } : { year: now.getFullYear(), month: now.getMonth() + 1 }
}
