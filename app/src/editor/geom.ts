// Geometria edytora bez DOM: poprawka perspektywy, grot strzałki i automatyczne prostowanie horyzontu.
// Czysta logika na tablicach pikseli RGBA, więc da się ją testować w Node.

export type Img = { d: Uint8ClampedArray; w: number; h: number }

/** Siła zniekształcenia przy suwaku na 100: o tyle (jako ułamek) zwęża się górna lub dolna, lewa lub prawa krawędź. */
const PERS = 0.35

/**
 * Poprawka perspektywy: `v` prostuje zbiegające się pionowe linie (budynki „przewracające się do tyłu”), `h` poziome (zdjęcie robione z boku).
 * Obie wartości od -100 do 100. Zwraca nowy obraz tego samego rozmiaru; krawędzie są przybliżone tak, żeby nie było czarnych rogów.
 */
export function warpPerspective(src: Img, v: number, h: number): Img {
  if (!v && !h) return src
  const { d, w, h: ht } = src
  const out = new Uint8ClampedArray(d.length)
  const av = (v / 100) * PERS, ah = (h / 100) * PERS
  const zv = 1 + Math.abs(av), zh = 1 + Math.abs(ah)
  for (let y = 0; y < ht; y++) {
    const ny = (y + 0.5) / ht * 2 - 1
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w * 2 - 1
      // Cel (nx, ny) pobiera próbkę ze źródła: skala w poziomie zależy od wysokości (v), a w pionie od położenia poziomego (h).
      const sx = (nx * (1 + av * ny)) / zv
      const sy = (ny * (1 + ah * nx)) / zh
      const fx = (sx + 1) / 2 * w - 0.5, fy = (sy + 1) / 2 * ht - 0.5
      const x0 = Math.floor(fx), y0 = Math.floor(fy)
      const tx = fx - x0, ty = fy - y0
      const o = (y * w + x) * 4
      for (let c = 0; c < 4; c++) {
        const p = (xx: number, yy: number) => d[(Math.min(ht - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))) * 4 + c]
        out[o + c] = (p(x0, y0) * (1 - tx) + p(x0 + 1, y0) * tx) * (1 - ty) + (p(x0, y0 + 1) * (1 - tx) + p(x0 + 1, y0 + 1) * tx) * ty
      }
    }
  }
  return { d: out, w, h: ht }
}

/** Dwa punkty grota strzałki przy końcu odcinka `from` do `to` (długość grota `len`, rozwarcie 28 stopni). */
export function arrowHead(from: [number, number], to: [number, number], len: number): [[number, number], [number, number]] {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0])
  const spread = (28 * Math.PI) / 180
  return [
    [to[0] - len * Math.cos(ang - spread), to[1] - len * Math.sin(ang - spread)],
    [to[0] - len * Math.cos(ang + spread), to[1] - len * Math.sin(ang + spread)],
  ]
}

/**
 * Automatyczne prostowanie horyzontu: z obrazu (zmniejszanego do ok. 400 px) zbieramy punkty poziomych krawędzi i dla każdego kąta z zakresu
 * `limit` liczymy, jak bardzo układają się w jedną prostą (suma kwadratów liczby punktów na każdej linii równoległej). Najlepiej ułożony kąt
 * to nachylenie horyzontu. Zwraca kąt obrotu naprawczego w stopniach (linia opadająca w prawo daje wartość ujemną) albo null, gdy nie ma wyraźnej linii.
 */
export function detectHorizonAngle(src: Img, limit = 15): number | null {
  const { d, w, h } = src
  const step = Math.max(1, Math.floor(Math.max(w, h) / 400))
  const sw = Math.floor(w / step), sh = Math.floor(h / step)
  if (sw < 24 || sh < 24) return null
  const g = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0
    for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) { const i = ((y * step + dy) * w + x * step + dx) * 4; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] }
    g[y * sw + x] = s / (step * step)
  }
  const pts: number[] = []
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
    const gy = Math.abs(g[(y + 1) * sw + x] - g[(y - 1) * sw + x]) / 2
    const gx = Math.abs(g[y * sw + x + 1] - g[y * sw + x - 1]) / 2
    // Krawędź poziomych struktur: silna zmiana w pionie i znacznie słabsza w poziomie.
    if (gy > 14 && gy > gx * 1.2) pts.push(x, y)
  }
  if (pts.length < 40) return null
  // Najwyżej 20 tysięcy punktów, równomiernie wybranych.
  const n = pts.length / 2, take = Math.min(n, 20000), every = n / take
  const size = 2 * (sw + sh) + 4
  const bins = new Int32Array(size)
  const scores: number[] = []
  for (let a = -limit; a <= limit + 1e-9; a += 0.25) {
    const rad = (a * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad)
    bins.fill(0)
    for (let k = 0; k < take; k++) {
      const p = Math.floor(k * every) * 2
      bins[Math.round(pts[p + 1] * cs - pts[p] * sn) + sw + sh]++
    }
    let sc = 0
    for (let i = 0; i < size; i++) sc += bins[i] * bins[i]
    scores.push(sc)
  }
  let best = 0
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  // Szczyt musi wyraźnie wystawać ponad przeciętny wynik i nie leżeć na brzegu zakresu.
  if (scores[best] < mean * 1.25 || best === 0 || best === scores.length - 1) return null
  const tilt = -limit + best * 0.25
  return Math.abs(tilt) < 0.3 ? null : Math.round(-tilt * 10) / 10
}
