/**
 * Fotoksiążka: podział zdjęć na strony i układ zdjęć na stronie. Czysta logika bez DOM i bez Tauri, więc da się ją testować w Node.
 * Rysowanie stron na kanwie i zapis do PDF robi okno Fotoksiążki.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type BookStyle = 'one' | 'two' | 'four' | 'mixed'

export const MAX_BOOK_PHOTOS = 120
export const MAX_BOOK_PAGES = 80

/** Ile zdjęć jest na kolejnych stronach: razem dokładnie `n`. „Mieszany” powtarza wzór 1, 3, 2, 4, 2 (kończy się resztą, ile zostało). */
export function paginate(n: number, style: BookStyle): number[] {
  const pattern = style === 'one' ? [1] : style === 'two' ? [2] : style === 'four' ? [4] : [1, 3, 2, 4, 2]
  const out: number[] = []
  let left = n, k = 0
  while (left > 0) {
    const c = Math.min(pattern[k % pattern.length], left)
    out.push(c)
    left -= c
    k++
  }
  return out
}

/** Pola na zdjęcia dla `count` zdjęć (1 do 4) na stronie W na H z marginesem i odstępem (w tych samych jednostkach). */
export function cellsFor(count: number, W: number, H: number, margin: number, gap: number): Rect[] {
  const x0 = margin, y0 = margin, w = W - 2 * margin, h = H - 2 * margin
  const landscape = W >= H
  const half = (len: number) => (len - gap) / 2
  switch (count) {
    case 1:
      return [{ x: x0, y: y0, w, h }]
    case 2:
      return landscape
        ? [{ x: x0, y: y0, w: half(w), h }, { x: x0 + half(w) + gap, y: y0, w: half(w), h }]
        : [{ x: x0, y: y0, w, h: half(h) }, { x: x0, y: y0 + half(h) + gap, w, h: half(h) }]
    case 3: {
      // Jedno duże zdjęcie (górne albo lewe, 60%) i dwa mniejsze obok lub pod nim.
      if (landscape) {
        const bw = (w - gap) * 0.6, sw = w - gap - bw
        return [{ x: x0, y: y0, w: bw, h }, { x: x0 + bw + gap, y: y0, w: sw, h: half(h) }, { x: x0 + bw + gap, y: y0 + half(h) + gap, w: sw, h: half(h) }]
      }
      const bh = (h - gap) * 0.6, sh = h - gap - bh
      return [{ x: x0, y: y0, w, h: bh }, { x: x0, y: y0 + bh + gap, w: half(w), h: sh }, { x: x0 + half(w) + gap, y: y0 + bh + gap, w: half(w), h: sh }]
    }
    case 4:
      return [0, 1, 2, 3].map((i) => ({ x: x0 + (i % 2) * (half(w) + gap), y: y0 + Math.floor(i / 2) * (half(h) + gap), w: half(w), h: half(h) }))
    default:
      return []
  }
}

/**
 * Jak wpisać zdjęcie w pole: `cover` wypełnia pole przycinając zdjęcie (zwraca wycinek źródła), `contain` pokazuje całe zdjęcie
 * (zwraca prostokąt docelowy wewnątrz pola). Wynik: src (wycinek zdjęcia) i dst (prostokąt na stronie).
 */
export function fitPhoto(iw: number, ih: number, cell: Rect, mode: 'cover' | 'contain'): { src: Rect; dst: Rect } {
  if (mode === 'cover') {
    const s = Math.max(cell.w / iw, cell.h / ih)
    const sw = cell.w / s, sh = cell.h / s
    return { src: { x: (iw - sw) / 2, y: (ih - sh) / 2, w: sw, h: sh }, dst: cell }
  }
  const s = Math.min(cell.w / iw, cell.h / ih)
  const dw = iw * s, dh = ih * s
  return { src: { x: 0, y: 0, w: iw, h: ih }, dst: { x: cell.x + (cell.w - dw) / 2, y: cell.y + (cell.h - dh) / 2, w: dw, h: dh } }
}

/** Rozmiary stron w punktach PDF (pionowo): A4, A5 i kwadrat 21 x 21 cm. */
export const BOOK_PAPERS: { id: 'a4' | 'a5' | 'square'; label: string; w: number; h: number }[] = [
  { id: 'a4', label: 'A4', w: 595, h: 842 },
  { id: 'a5', label: 'A5', w: 420, h: 595 },
  { id: 'square', label: 'Kwadrat 21 cm', w: 595, h: 595 },
]

/** Liczba stron całej książki: strona tytułowa (opcjonalnie) plus strony ze zdjęciami. */
export const bookPages = (n: number, style: BookStyle, title: boolean) => paginate(n, style).length + (title ? 1 : 0)
