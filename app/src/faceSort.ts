/** Kolejność twarzy jednej osoby: według pewności programu (tak jak przychodzą) albo według daty zrobienia zdjęcia. */

export type FaceSort = 'best' | 'old' | 'new'

export const FACE_SORTS: [FaceSort, string][] = [['best', 'Najpewniejsze'], ['old', 'Od najstarszych'], ['new', 'Od najnowszych']]

type Dated = { taken: string | null; modified: number }

/** Klucz daty do porównań: data z aparatu ujednolicona do RRRR-MM-DD GG:MM:SS, a bez niej data pliku. Zdjęcia bez żadnej daty mają pusty klucz. */
export function dateKey(c: Dated): string {
  const t = c.taken?.trim()
  if (t && /^\d{4}[:-]\d{2}[:-]\d{2}/.test(t)) return t.slice(0, 10).replace(/:/g, '-') + t.slice(10)
  if (c.modified > 0) {
    const d = new Date(c.modified * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  return ''
}

/** Rok zdjęcia do podpisu pod twarzą albo null, gdy nieznany. */
export function faceYear(c: Dated): string | null {
  const k = dateKey(c)
  return k ? k.slice(0, 4) : null
}

/** Posortowana kopia (bez zmiany wejścia). „best” zostawia kolejność z programu; zdjęcia bez daty idą na koniec w obu kierunkach. */
export function sortFaces<T extends Dated>(list: T[], order: FaceSort): T[] {
  if (order === 'best') return list.slice()
  const keyed = list.map((c, i) => ({ c, i, k: dateKey(c) }))
  keyed.sort((a, b) => {
    if (!a.k || !b.k) return (a.k ? 0 : 1) - (b.k ? 0 : 1) || a.i - b.i
    const cmp = a.k < b.k ? -1 : a.k > b.k ? 1 : 0
    return (order === 'old' ? cmp : -cmp) || a.i - b.i
  })
  return keyed.map((x) => x.c)
}
