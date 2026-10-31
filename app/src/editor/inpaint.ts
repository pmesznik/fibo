// Usuwanie obiektów: wypełnianie zamalowanego obszaru fragmentami z otoczenia (metoda przykładowa, od brzegu do środka).
// Czysta logika na tablicach pikseli RGBA, bez DOM, więc da się ją testować w Node.

export type Img = { d: Uint8ClampedArray; w: number; h: number }
/** Kropla pędzla: środek i promień jako ułamki wymiarów zdjęcia (promień względem krótszego boku). */
export type Dab = { x: number; y: number; r: number }

export const MAX_DABS = 400
/** Najdłuższy bok obszaru roboczego; większy jest zmniejszany na czas wypełniania (wynik wraca w pełnej rozdzielczości). */
const WORK_SIDE = 900
const HALF = 3 // fragment porównania 7x7
const RANDOM_CANDIDATES = 110

/** Prosty generator liczb pseudolosowych (powtarzalny wynik dla tych samych danych). */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

/** Maska z kropli pędzla (1 = do usunięcia) na obrazie o danym rozmiarze. */
export function maskFromDabs(dabs: Dab[], w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h)
  const side = Math.min(w, h)
  for (const d of dabs.slice(0, MAX_DABS)) {
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.r)) continue
    const r = Math.max(1, Math.min(0.5, Math.max(0.002, d.r)) * side)
    const cx = d.x * w, cy = d.y * h
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1
  }
  return m
}

/** Wypełnia piksele maski w miejscu (obraz roboczy). Zwraca liczbę wypełnionych pikseli. */
export function inpaintCore(img: Img, mask: Uint8Array, seed = 7): number {
  const { d, w, h } = img
  // Poszerzenie maski o 1 piksel usuwa obwódkę z brzegu obiektu.
  const m = new Uint8Array(mask)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) m[ny * w + nx] = 1
  }
  const original = new Uint8Array(w * h) // 1 = piksel znany od początku (źródło próbek)
  const known = new Uint8Array(w * h)
  const knownList: number[] = []
  for (let i = 0; i < w * h; i++) if (!m[i]) { original[i] = 1; known[i] = 1; knownList.push(i) }
  if (knownList.length === 0) return 0
  const rnd = rng(seed)
  const src = new Int32Array(w * h).fill(-1) // skąd skopiowano piksel (do propagacji)
  let remaining = 0
  for (let i = 0; i < w * h; i++) if (m[i]) remaining++
  const total = remaining

  const cost = (px: number, py: number, qx: number, qy: number): number => {
    let sum = 0, n = 0
    for (let dy = -HALF; dy <= HALF; dy++) for (let dx = -HALF; dx <= HALF; dx++) {
      const tx = px + dx, ty = py + dy, sx = qx + dx, sy = qy + dy
      if (tx < 0 || ty < 0 || tx >= w || ty >= h || sx < 0 || sy < 0 || sx >= w || sy >= h) continue
      const ti = ty * w + tx, si = sy * w + sx
      if (!known[ti] || !original[si]) continue
      const a = ti * 4, b = si * 4
      const dr = d[a] - d[b], dg = d[a + 1] - d[b + 1], db = d[a + 2] - d[b + 2]
      sum += dr * dr + dg * dg + db * db
      n++
    }
    return n < 6 ? Infinity : sum / n
  }

  while (remaining > 0) {
    // Warstwa brzegowa: piksele do wypełnienia sąsiadujące ze znanym pikselem.
    const layer: number[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (known[i]) continue
      if ((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w])) layer.push(i)
    }
    if (layer.length === 0) break
    // Najpierw te, które mają najwięcej znanych sąsiadów (stabilniejsze dopasowanie).
    const score = (i: number) => { let c = 0; const x = i % w, y = (i / w) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && known[ny * w + nx]) c++ } return c }
    const sc = new Map<number, number>()
    for (const i of layer) sc.set(i, score(i))
    layer.sort((a, b) => (sc.get(b) as number) - (sc.get(a) as number))
    for (const i of layer) {
      const px = i % w, py = (i / w) | 0
      let best = Infinity, bq = -1
      const tryCand = (q: number) => {
        if (q < 0 || !original[q]) return
        const c = cost(px, py, q % w, (q / w) | 0)
        if (c < best) { best = c; bq = q }
      }
      // Propagacja: sąsiad już wypełniony wskazuje, skąd brać następny piksel.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = px + dx, ny = py + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const s = src[ny * w + nx]
        if (s >= 0) { const qx = (s % w) - dx, qy = ((s / w) | 0) - dy; if (qx >= 0 && qy >= 0 && qx < w && qy < h) tryCand(qy * w + qx) }
      }
      for (let k = 0; k < RANDOM_CANDIDATES; k++) tryCand(knownList[Math.floor(rnd() * knownList.length)])
      if (bq < 0) bq = knownList[Math.floor(rnd() * knownList.length)]
      d[i * 4] = d[bq * 4]; d[i * 4 + 1] = d[bq * 4 + 1]; d[i * 4 + 2] = d[bq * 4 + 2]
      src[i] = bq
      known[i] = 1
      remaining--
    }
  }
  return total
}

/**
 * Usuwa obiekty zaznaczone kroplami pędzla: pracuje na wycinku wokół maski (z zapasem), a gdy ten jest duży, na jego zmniejszonej kopii.
 * Zwraca liczbę zmienionych pikseli.
 */
export function removeObjects(img: Img, dabs: Dab[]): number {
  const { d, w, h } = img
  const mask = maskFromDabs(dabs, w, h)
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return 0
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const pad = Math.max(24, Math.round(Math.max(bw, bh) * 1.2))
  const rx0 = Math.max(0, x0 - pad), ry0 = Math.max(0, y0 - pad), rx1 = Math.min(w - 1, x1 + pad), ry1 = Math.min(h - 1, y1 + pad)
  const rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1
  const k = Math.min(1, WORK_SIDE / Math.max(rw, rh))
  const ww = Math.max(1, Math.round(rw * k)), wh = Math.max(1, Math.round(rh * k))
  // Obraz roboczy i jego maska (piksel maski, gdy choć jeden piksel źródłowy jest w masce).
  const work: Img = { d: new Uint8ClampedArray(ww * wh * 4), w: ww, h: wh }
  const wmask = new Uint8Array(ww * wh)
  const acc = new Float32Array(ww * wh * 4), cnt = new Float32Array(ww * wh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const wx = Math.min(ww - 1, Math.floor(x * ww / rw)), wy = Math.min(wh - 1, Math.floor(y * wh / rh))
    const wi = wy * ww + wx, si = ((ry0 + y) * w + rx0 + x) * 4
    for (let c = 0; c < 4; c++) acc[wi * 4 + c] += d[si + c]
    cnt[wi]++
    if (mask[(ry0 + y) * w + rx0 + x]) wmask[wi] = 1
  }
  for (let i = 0; i < ww * wh; i++) for (let c = 0; c < 4; c++) work.d[i * 4 + c] = cnt[i] ? acc[i * 4 + c] / cnt[i] : 0
  inpaintCore(work, wmask)
  // Z powrotem: tylko piksele z maski (i ich bezpośrednie otoczenie po poszerzeniu) dostają nowy kolor, z wygładzeniem przy zmniejszeniu.
  let changed = 0
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    if (!mask[(ry0 + y) * w + rx0 + x]) continue
    const fx = (x + 0.5) * ww / rw - 0.5, fy = (y + 0.5) * wh / rh - 0.5
    const xa = Math.max(0, Math.min(ww - 1, Math.floor(fx))), ya = Math.max(0, Math.min(wh - 1, Math.floor(fy)))
    const xb = Math.min(ww - 1, xa + 1), yb = Math.min(wh - 1, ya + 1)
    const tx = Math.min(1, Math.max(0, fx - xa)), ty = Math.min(1, Math.max(0, fy - ya))
    const o = ((ry0 + y) * w + rx0 + x) * 4
    for (let c = 0; c < 3; c++) {
      const p = (xx: number, yy: number) => work.d[(yy * ww + xx) * 4 + c]
      d[o + c] = (p(xa, ya) * (1 - tx) + p(xb, ya) * tx) * (1 - ty) + (p(xa, yb) * (1 - tx) + p(xb, yb) * tx) * ty
    }
    changed++
  }
  return changed
}

// Pamięć ostatniego wyniku: podczas ruszania suwakami obraz jest rysowany od nowa, a wypełnianie jest najdroższym krokiem, więc zapamiętujemy je
// dla tych samych kropli i tego samego wycinka obrazu (klucz: krople, rozmiar i próbka pikseli).
let cache: { key: string; idx: Int32Array; rgb: Uint8Array } | null = null

function cacheKey(img: Img, dabs: Dab[]): string {
  const { d, w, h } = img
  let sum = 0
  for (let k = 0; k < 97; k++) { const i = (Math.floor((k * 7919) % (w * h))) * 4; sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 5) >>> 0 }
  return `${w}x${h}:${sum}:${JSON.stringify(dabs)}`
}

/** To samo co `removeObjects`, z użyciem pamięci ostatniego wyniku. */
export function removeObjectsCached(img: Img, dabs: Dab[]): number {
  if (!dabs.length) return 0
  const key = cacheKey(img, dabs)
  if (cache && cache.key === key) {
    for (let k = 0; k < cache.idx.length; k++) { const i = cache.idx[k] * 4; img.d[i] = cache.rgb[k * 3]; img.d[i + 1] = cache.rgb[k * 3 + 1]; img.d[i + 2] = cache.rgb[k * 3 + 2] }
    return cache.idx.length
  }
  const before = new Uint8ClampedArray(img.d)
  const n = removeObjects(img, dabs)
  const idx: number[] = [], rgb: number[] = []
  for (let p = 0; p < img.w * img.h; p++) {
    const i = p * 4
    if (img.d[i] !== before[i] || img.d[i + 1] !== before[i + 1] || img.d[i + 2] !== before[i + 2]) { idx.push(p); rgb.push(img.d[i], img.d[i + 1], img.d[i + 2]) }
  }
  cache = { key, idx: Int32Array.from(idx), rgb: Uint8Array.from(rgb) }
  return n
}
