// Zaawansowane korekty tonalne: krzywe, kolor według zakresów barw (HSL), usuwanie mgły, klarowność i histogram.
// Czysta logika na tablicach pikseli RGBA, bez DOM i bez Tauri, więc da się ją testować w Node.

export type Img = { d: Uint8ClampedArray; w: number; h: number }

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

// ---- Krzywe ---------------------------------------------------------------

/** Punkt krzywej: [wejście, wyjście], oba 0 do 255. */
export type CurvePt = [number, number]
export type Curves = { rgb: CurvePt[]; r: CurvePt[]; g: CurvePt[]; b: CurvePt[] }
export const MAX_CURVE_POINTS = 12
export const EMPTY_CURVES: Curves = { rgb: [], r: [], g: [], b: [] }

/** Czy krzywa nic nie zmienia (brak punktów albo wszystkie leżą na przekątnej). */
export const curveIsIdentity = (pts: CurvePt[] | undefined) => !pts || pts.every(([x, y]) => x === y)
export const curvesAreIdentity = (c: Curves | undefined) => !c || (curveIsIdentity(c.rgb) && curveIsIdentity(c.r) && curveIsIdentity(c.g) && curveIsIdentity(c.b))

/** Poprawia punkty z zewnątrz (np. ze starego pliku edycji): liczby w zakresie, bez powtórzeń wejścia, najwyżej `MAX_CURVE_POINTS`, od lewej do prawej. */
export function cleanPoints(pts: unknown): CurvePt[] {
  if (!Array.isArray(pts)) return []
  const out = new Map<number, number>()
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2) continue
    const [x, y] = [Math.round(Number(p[0])), Math.round(Number(p[1]))]
    if (Number.isFinite(x) && Number.isFinite(y)) out.set(Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y)))
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_CURVE_POINTS) as CurvePt[]
}

/**
 * Tablica 256 wartości dla krzywej przechodzącej przez punkty: gładka (sześcienna interpolacja monotoniczna, bez przeregulowań) i monotoniczna,
 * więc zwiększenie kontrastu nie tworzy odwróconych tonów. Końce (0,0) i (255,255) są dodawane, gdy ich nie ma.
 */
export function curveLut(points: CurvePt[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const pts = cleanPoints(points)
  if (pts.length === 0) { for (let i = 0; i < 256; i++) lut[i] = i; return lut }
  if (pts[0][0] > 0) pts.unshift([0, pts[0][0] === 0 ? pts[0][1] : 0])
  if (pts[pts.length - 1][0] < 255) pts.push([255, 255])
  const n = pts.length
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const dx: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); m.push((ys[i + 1] - ys[i]) / dx[i]) }
  const t: number[] = new Array(n)
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let seg = 0
  for (let x = 0; x < 256; x++) {
    while (seg < n - 2 && x > xs[seg + 1]) seg++
    const h = dx[seg], u = (x - xs[seg]) / h
    const u2 = u * u, u3 = u2 * u
    const y = (2 * u3 - 3 * u2 + 1) * ys[seg] + (u3 - 2 * u2 + u) * h * t[seg] + (-2 * u3 + 3 * u2) * ys[seg + 1] + (u3 - u2) * h * t[seg + 1]
    lut[x] = clamp(Math.round(y))
  }
  return lut
}

/** Krzywe: najpierw krzywa osobnego kanału, potem wspólna (RGB). */
export function applyCurves({ d }: Img, c: Curves) {
  if (curvesAreIdentity(c)) return
  const all = curveLut(c.rgb), lr = curveLut(c.r), lg = curveLut(c.g), lb = curveLut(c.b)
  for (let i = 0; i < d.length; i += 4) { d[i] = all[lr[d[i]]]; d[i + 1] = all[lg[d[i + 1]]]; d[i + 2] = all[lb[d[i + 2]]] }
}

// ---- Kolor według zakresów barw (HSL) ----------------------------------------

/** Osiem zakresów barw: czerwień, pomarańcz, żółć, zieleń, błękit (cyjan), niebieski, fiolet, magenta. */
export const HSL_BANDS = ['Czerwień', 'Pomarańcz', 'Żółć', 'Zieleń', 'Błękit', 'Niebieski', 'Fiolet', 'Magenta'] as const
const BAND_HUES = [0, 30, 60, 120, 180, 240, 280, 320]
export type Hsl = { hue: number[]; sat: number[]; lum: number[] }
export const EMPTY_HSL: Hsl = { hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) }
export const hslIsIdentity = (h: Hsl | undefined) => !h || [h.hue, h.sat, h.lum].every((a) => a.every((v) => !v))

/** Poprawia dane z zewnątrz: trzy tablice po osiem liczb z zakresu od -100 do 100. */
export function cleanHsl(h: unknown): Hsl {
  const arr = (v: unknown) => Array.from({ length: 8 }, (_, i) => { const n = Array.isArray(v) ? Number(v[i]) : 0; return Number.isFinite(n) ? Math.max(-100, Math.min(100, Math.round(n))) : 0 })
  const o = (h ?? {}) as Record<string, unknown>
  return { hue: arr(o.hue), sat: arr(o.sat), lum: arr(o.lum) }
}

/** Wagi zakresów dla barwy w stopniach: najbliższe dwa zakresy dzielą wpływ liniowo, więc przejścia są płynne. */
export function bandWeights(hue: number): number[] {
  const w = Array(8).fill(0)
  const hh = ((hue % 360) + 360) % 360
  for (let i = 0; i < 8; i++) {
    const a = BAND_HUES[i], b = i === 7 ? 360 : BAND_HUES[i + 1]
    if (hh >= a && hh < b) { const t = (hh - a) / (b - a); w[i] += 1 - t; w[(i + 1) % 8] += t; break }
  }
  return w
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (d < 1e-6) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60; if (h < 0) h += 360
  return [h, s, l]
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** Barwa, nasycenie i jasność osobno dla każdego zakresu barw (od -100 do 100). Szarości (brak nasycenia) zostają bez zmian. */
export function applyHsl({ d }: Img, hsl: Hsl) {
  if (hslIsIdentity(hsl)) return
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2])
    if (s < 0.02) continue
    const w = bandWeights(h)
    let dh = 0, ds = 0, dl = 0
    for (let k = 0; k < 8; k++) if (w[k]) { dh += w[k] * hsl.hue[k]; ds += w[k] * hsl.sat[k]; dl += w[k] * hsl.lum[k] }
    // Mało nasycone kolory reagują słabiej (szara okolica nie dostaje przebarwień).
    const fade = Math.min(1, s * 4)
    const [r, g, b] = hslToRgb(h + dh * 0.3 * fade, Math.min(1, Math.max(0, s * (1 + (ds / 100) * fade))), Math.min(1, Math.max(0, l + (dl / 100) * 0.25 * fade * (1 - Math.abs(2 * l - 1) * 0.5))))
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b)
  }
}

// ---- Usuwanie mgły i klarowność ------------------------------------------------

/** Minimum w oknie (promień r) osobno w poziomie i w pionie na jednym kanale. */
function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, src[y * w + k]); tmp[y * w + x] = m
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 255; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, tmp[k * w + x]); out[y * w + x] = m
  }
  return out
}

function boxBlurF(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const rr = Math.max(1, Math.round(r)), win = 2 * rr + 1
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -rr; x <= rr; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) { tmp[y * w + x] = acc / win; acc += src[y * w + Math.min(w - 1, x + rr + 1)] - src[y * w + Math.max(0, x - rr)] }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -rr; y <= rr; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / win; acc += tmp[Math.min(h - 1, y + rr + 1) * w + x] - tmp[Math.max(0, y - rr) * w + x] }
  }
  return out
}

/**
 * Usuwanie mgły (kanał ciemny): z minimum kanałów w oknie szacujemy, ile światła nieba „dokleiła” mgła, i odejmujemy ją.
 * `amount` od -100 (dodaj mgłę) do 100 (usuń); 0 nic nie zmienia.
 */
export function applyDehaze({ d, w, h }: Img, amount: number) {
  if (!amount) return
  const n = w * h
  const mn = new Float32Array(n)
  for (let p = 0; p < n; p++) mn[p] = Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2])
  const dark = minFilter(mn, w, h, Math.max(2, Math.round(Math.max(w, h) / 250)))
  // Światło otoczenia: średnia z najjaśniejszych 0,1% pikseli kanału ciemnego.
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => dark[b] - dark[a]).slice(0, Math.max(1, Math.floor(n / 1000)))
  const A = [0, 1, 2].map((c) => Math.max(120, idx.reduce((s, p) => s + d[p * 4 + c], 0) / idx.length))
  const tRaw = new Float32Array(n)
  const k = Math.min(0.95, Math.abs(amount) / 100 * 0.95)
  for (let p = 0; p < n; p++) tRaw[p] = 1 - k * (dark[p] / Math.max(...A))
  const t = boxBlurF(tRaw, w, h, Math.max(2, Math.round(Math.max(w, h) / 400)))
  for (let p = 0; p < n; p++) {
    const tp = Math.max(0.25, t[p])
    for (let c = 0; c < 3; c++) {
      const v = d[p * 4 + c]
      d[p * 4 + c] = clamp(amount > 0 ? (v - A[c]) / tp + A[c] : v * (1 - k * 0.5) + A[c] * k * 0.5)
    }
  }
}

/** Klarowność: kontrast lokalny w średnich tonach (odjęcie mocno rozmytej jasności), bez wzmacniania cieni i świateł. `amount` od -100 do 100. */
export function applyClarity({ d, w, h }: Img, amount: number) {
  if (!amount) return
  const n = w * h
  const L = new Float32Array(n)
  for (let p = 0; p < n; p++) L[p] = 0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]
  const blur = boxBlurF(boxBlurF(L, w, h, Math.max(3, Math.round(Math.max(w, h) / 60))), w, h, Math.max(3, Math.round(Math.max(w, h) / 60)))
  const k = (amount / 100) * 1.6
  for (let p = 0; p < n; p++) {
    const mid = 1 - Math.pow(Math.abs(L[p] / 127.5 - 1), 2)
    const add = (L[p] - blur[p]) * k * mid
    d[p * 4] = clamp(d[p * 4] + add); d[p * 4 + 1] = clamp(d[p * 4 + 1] + add); d[p * 4 + 2] = clamp(d[p * 4 + 2] + add)
  }
}

// ---- Histogram -----------------------------------------------------------------

export type Histogram = { r: number[]; g: number[]; b: number[]; l: number[] }

/** Histogram obrazu (co `step`-ty piksel dla szybkości): 256 przedziałów dla R, G, B i jasności. */
export function histogram({ d }: Pick<Img, 'd'>, step = 1): Histogram {
  const r = Array(256).fill(0), g = Array(256).fill(0), b = Array(256).fill(0), l = Array(256).fill(0)
  for (let i = 0; i < d.length; i += 4 * Math.max(1, step)) {
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++
    l[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++
  }
  return { r, g, b, l }
}
