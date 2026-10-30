/**
 * Wspomnienia „tego dnia”: zdjęcia zrobione w ten sam dzień roku w poprzednich latach. Czysta logika bez Tauri, żeby dało się ją testować w Node.
 */
import type { Photo } from './api'

export type Memory = { year: number; ids: number[] }

/** Rok, miesiąc i dzień z daty zdjęcia (EXIF „RRRR:MM:DD…” albo „RRRR-MM-DD…”). */
export function dateParts(taken: string | null | undefined): { y: number; m: number; d: number } | null {
  const m = taken?.match(/^(\d{4})[-:](\d{2})[-:](\d{2})/)
  if (!m) return null
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  return y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { y, m: mo, d } : null
}

/** Klucz „RRRR-MM-DD” dla dnia w czasie lokalnym (do zapamiętania, że wspomnienia z dzisiaj już odrzucono). */
export const dayKey = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/**
 * Zdjęcia z dnia `now` w poprzednich latach, pogrupowane według roku (od najnowszego). Zdjęcia przykładowe (numer ujemny) i bez daty są pomijane.
 * 29 lutego w roku bez tego dnia wypada 28 lutego, żeby wspomnienia z lat przestępnych się nie gubiły.
 */
export function memoriesFor(photos: Photo[], now: Date): Memory[] {
  const month = now.getMonth() + 1
  const day = now.getDate()
  const year = now.getFullYear()
  const byYear = new Map<number, number[]>()
  for (const p of photos) {
    if (p.id < 0) continue
    const t = dateParts(p.taken)
    if (!t || t.y >= year) continue
    const leapFix = month === 2 && day === 28 && t.m === 2 && t.d === 29 && !isLeap(year)
    if (t.m === month && (t.d === day || leapFix)) {
      const list = byYear.get(t.y) ?? []
      list.push(p.id)
      byYear.set(t.y, list)
    }
  }
  return [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([y, ids]) => ({ year: y, ids }))
}

function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']

/** „30 października” (dopełniacz, jak w zdaniu „Zdjęcia z 30 października”). */
export const dayLabel = (now: Date) => `${now.getDate()} ${MONTHS_GEN[now.getMonth()]}`

/** Ile lat temu: „1 rok temu”, „3 lata temu”, „12 lat temu”. */
export function yearsAgo(now: Date, year: number): string {
  const n = now.getFullYear() - year
  const unit = n === 1 ? 'rok' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'lata' : 'lat'
  return `${n} ${unit} temu`
}
