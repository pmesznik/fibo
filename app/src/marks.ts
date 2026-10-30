/**
 * Flagi selekcji (wybierz / odrzuć) i etykiety kolorowe zdjęć. Czysta logika bez Tauri, żeby dało się ją testować w Node.
 */
import type { Photo } from './api'

export type Flag = 1 | -1 | 0

/** Etykiety kolorowe (te same nazwy i kolejność co w XMP: Red, Yellow, Green, Blue); klawisze 6 do 9. */
export const LABELS: { name: string; css: string; key: string }[] = [
  { name: 'czerwona', css: '#e5484d', key: '6' },
  { name: 'żółta', css: '#f5b400', key: '7' },
  { name: 'zielona', css: '#30a46c', key: '8' },
  { name: 'niebieska', css: '#3e8bff', key: '9' },
]

export const flagOf = (p: Pick<Photo, 'flag'>): number => p.flag ?? 0
export const labelOf = (p: Pick<Photo, 'label'>): number => p.label ?? 0

/**
 * Nowa wartość po naciśnięciu klawisza: gdy wszystkie zdjęcia mają już tę wartość, klawisz ją zdejmuje (jak przełącznik),
 * w przeciwnym razie ustawia ją wszystkim. Wartość 0 zawsze czyści.
 */
export function nextMark(current: number[], wanted: number): number {
  if (wanted === 0) return 0
  return current.length > 0 && current.every((v) => v === wanted) ? 0 : wanted
}

/** Czy zdjęcie przechodzi filtr flagi: '' wszystkie, 'pick' tylko wybrane, 'reject' tylko odrzucone, 'keep' wszystkie poza odrzuconymi. */
export function passesFlag(p: Pick<Photo, 'flag'>, filter: '' | 'pick' | 'reject' | 'keep'): boolean {
  const f = flagOf(p)
  return filter === '' || (filter === 'pick' ? f === 1 : filter === 'reject' ? f === -1 : f !== -1)
}
