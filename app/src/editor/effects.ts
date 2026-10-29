// Silnik edycji zdjęć: geometria + korekty + efekty, wszystko na canvasie.
// Własne implementacje inspirowane zestawem funkcji Picasy 3.

export type Adjust = {
  brightness: number; contrast: number; saturation: number; temp: number
  fill: number; highlights: number; shadows: number; sharpen: number; gamma: number
}
export const ZERO_ADJUST: Adjust = {
  brightness: 0, contrast: 0, saturation: 0, temp: 0, fill: 0, highlights: 0, shadows: 0, sharpen: 0, gamma: 0,
}

export type Geometry = {
  rot: number; flipH: boolean; flipV: boolean; angle: number
  aspect: number | null; zoom: number; panX: number; panY: number
}
export const ZERO_GEO: Geometry = { rot: 0, flipH: false, flipV: false, angle: 0, aspect: null, zoom: 1, panX: 0, panY: 0 }

export type EffectInst = { id: string; amount: number }
export type RedEye = { x: number; y: number; r: number }
/** Napis na zdjęciu: środek w ułamkach szerokości i wysokości kadru, wysokość tekstu jako ułamek wysokości kadru. */
export type TextItem = { text: string; x: number; y: number; size: number; color: string; bold: boolean }
export const MAX_TEXTS = 20
export const MAX_TEXT_LEN = 200
/** Mnożniki kanałów R, G, B z zakraplacza „neutralny kolor” (balans bieli). */
export type Neutral = { r: number; g: number; b: number }
/** Retusz plamy (kurzu, skazy): środek i promień jako ułamki wymiarów zdjęcia (promień względem krótszego boku). */
export type Spot = { x: number; y: number; r: number }
export const MAX_SPOTS = 200
export type EditState = { geo: Geometry; adj: Adjust; fx: EffectInst[]; redeye: RedEye[]; texts: TextItem[]; neutral: Neutral | null; spots: Spot[] }
export const EMPTY_EDIT: EditState = { geo: ZERO_GEO, adj: ZERO_ADJUST, fx: [], redeye: [], texts: [], neutral: null, spots: [] }

/** Zamalowuje plamę kolorem z jej otoczenia: mediana z pierścienia wokół plamy (osobno dla każdego kanału), z miękkim brzegiem. */
export function healSpot(img: { d: Uint8ClampedArray | Uint8Array; w: number; h: number }, s: Spot) {
  const { d, w, h } = img
  const rad = Math.max(1.5, s.r * Math.min(w, h))
  const cx = s.x * w, cy = s.y * h
  const samples: number[][] = [[], [], []]
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2
    const rr = rad * (1.5 + (k % 3) * 0.25)
    const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rr)
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const i = (y * w + x) * 4
    for (let c = 0; c < 3; c++) samples[c].push(d[i + c])
  }
  if (samples[0].length < 6) return
  const med = samples.map((v) => { v.sort((p, q) => p - q); return v[v.length >> 1] })
  const x0 = Math.max(0, Math.floor(cx - rad * 1.3)), x1 = Math.min(w - 1, Math.ceil(cx + rad * 1.3))
  const y0 = Math.max(0, Math.floor(cy - rad * 1.3)), y1 = Math.min(h - 1, Math.ceil(cy + rad * 1.3))
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dist = Math.hypot(x - cx, y - cy)
    const k = dist <= rad ? 1 : Math.max(0, 1 - (dist - rad) / (rad * 0.3))
    if (k <= 0) continue
    const i = (y * w + x) * 4
    for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + (med[c] - d[i + c]) * k
  }
}

/** Mnożniki, które zamieniają próbkowany punkt na neutralny (szary): średnia z małego otoczenia kliknięcia. */
export function neutralFromSample(canvas: HTMLCanvasElement, fx: number, fy: number): Neutral | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const x = Math.min(canvas.width - 1, Math.max(0, Math.round(fx * canvas.width)))
  const y = Math.min(canvas.height - 1, Math.max(0, Math.round(fy * canvas.height)))
  const r = 3
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r)
  const w = Math.min(canvas.width - x0, 2 * r + 1), h = Math.min(canvas.height - y0, 2 * r + 1)
  const d = ctx.getImageData(x0, y0, w, h).data
  let R = 0, G = 0, B = 0
  const n = d.length / 4
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2] }
  R /= n; G /= n; B /= n
  const gray = (R + G + B) / 3
  if (gray < 12) return null // zbyt ciemny punkt nie niesie informacji o kolorze
  const g = (c: number) => Math.min(2, Math.max(0.5, gray / Math.max(c, 1)))
  return { r: g(R), g: g(G), b: g(B) }
}

export const isEdited = (s: EditState) =>
  JSON.stringify(s) !== JSON.stringify(EMPTY_EDIT)

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/** Rozmycie pudełkowe (RGB), dwa przebiegi. */
function boxBlur(src: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius))
  const tmp = new Uint8ClampedArray(src.length)
  const out = new Uint8ClampedArray(src.length)
  const win = 2 * r + 1
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let x = -r; x <= r; x++) acc += src[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c]
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = acc / win
        const add = Math.min(w - 1, x + r + 1)
        const sub = Math.max(0, x - r)
        acc += src[(y * w + add) * 4 + c] - src[(y * w + sub) * 4 + c]
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c]
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = acc / win
        const add = Math.min(h - 1, y + r + 1)
        const sub = Math.max(0, y - r)
        acc += tmp[(add * w + x) * 4 + c] - tmp[(sub * w + x) * 4 + c]
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  return out
}

type Img = { d: Uint8ClampedArray; w: number; h: number }

function percentile(hist: number[], total: number, p: number) {
  let acc = 0
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * p) return i }
  return 255
}

// ---- Korekty -------------------------------------------------------------

export function applyAdjust({ d, w, h }: Img, a: Adjust) {
  const sharpenSrc = a.sharpen > 0 ? new Uint8ClampedArray(d) : null
  const gammaExp = a.gamma === 0 ? 1 : Math.pow(2, -a.gamma / 50)
  const contrast = 1 + a.contrast / 100
  const sat = 1 + a.saturation / 100
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2]
    const l = lum(r, g, b) / 255
    // Doświetlenie cieni, przyciemnienie świateł, cienie.
    if (a.fill) { const k = a.fill / 100 * Math.pow(1 - l, 2) * 110; r += k; g += k; b += k }
    if (a.shadows) { const k = a.shadows / 100 * Math.pow(1 - l, 3) * 90; r += k; g += k; b += k }
    if (a.highlights) { const k = a.highlights / 100 * Math.pow(l, 3) * 90; r -= k; g -= k; b -= k }
    if (a.temp) { const k = a.temp / 100 * 40; r += k; b -= k }
    if (a.brightness) { const k = a.brightness * 1.5; r += k; g += k; b += k }
    if (a.contrast) { r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128 }
    if (gammaExp !== 1) {
      r = 255 * Math.pow(clamp(r) / 255, gammaExp); g = 255 * Math.pow(clamp(g) / 255, gammaExp); b = 255 * Math.pow(clamp(b) / 255, gammaExp)
    }
    if (a.saturation) { const y = lum(r, g, b); r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b)
  }
  if (sharpenSrc) {
    const blur = boxBlur(sharpenSrc, w, h, 1 + Math.round(Math.max(w, h) / 900))
    const k = a.sharpen / 100 * 1.8
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + (d[i + c] - blur[i + c]) * k)
    }
  }
}

// ---- Efekty --------------------------------------------------------------

type Effect = { id: string; label: string; fn: (img: Img, t: number) => void; slider?: boolean }

function gradientMap(img: Img, stops: [number, number, number][], t: number) {
  const { d } = img
  for (let i = 0; i < d.length; i += 4) {
    const l = lum(d[i], d[i + 1], d[i + 2]) / 255 * (stops.length - 1)
    const k = Math.min(stops.length - 2, Math.floor(l)), f = l - k
    for (let c = 0; c < 3; c++) d[i + c] = lerp(d[i + c], lerp(stops[k][c], stops[k + 1][c], f), t)
  }
}

function perPixel(img: Img, t: number, f: (r: number, g: number, b: number) => [number, number, number]) {
  const { d } = img
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = f(d[i], d[i + 1], d[i + 2])
    d[i] = clamp(lerp(d[i], r, t)); d[i + 1] = clamp(lerp(d[i + 1], g, t)); d[i + 2] = clamp(lerp(d[i + 2], b, t))
  }
}

function radial(img: Img, f: (dist: number, i: number) => void) {
  const { w, h } = img
  const cx = w / 2, cy = h / 2, maxd = Math.hypot(cx, cy)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f(Math.hypot(x - cx, y - cy) / maxd, (y * w + x) * 4)
}

function edges(img: Img): Float32Array {
  const { d, w, h } = img
  const out = new Float32Array(w * h)
  const L = (x: number, y: number) => { const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4; return lum(d[i], d[i + 1], d[i + 2]) }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = -L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1) + L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1)
    const gy = -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1) + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1)
    out[y * w + x] = Math.min(255, Math.hypot(gx, gy))
  }
  return out
}

const bigRadius = (img: Img) => Math.max(4, Math.round(Math.max(img.w, img.h) / 40))

/** Odcień (0-360) piksela RGB; dla szarości zwraca -1. */
export function hueOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (d < 8) return -1
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** Czerń i biel jak z filmu z kolorowym filtrem: kanał filtra jest rozjaśniony, a kolory przeciwne przyciemnione. */
const filteredBw = (w: [number, number, number]): Effect['fn'] => (img, t) =>
  perPixel(img, t, (r, g, b) => { const y = r * w[0] + g * w[1] + b * w[2]; return [y, y, y] })

/** Zostawia jeden kolor (z płynnym przejściem), resztę zamienia na czerń i biel. `t` wzmacnia efekt. */
const keepColor = (target: number): Effect['fn'] => (img, t) =>
  perPixel(img, t, (r, g, b) => {
    const h = hueOf(r, g, b)
    const y = lum(r, g, b)
    if (h < 0) return [y, y, y]
    const dist = Math.min(Math.abs(h - target), 360 - Math.abs(h - target))
    const keep = Math.max(0, Math.min(1, (55 - dist) / 25))
    return [lerp(y, r, keep), lerp(y, g, keep), lerp(y, b, keep)]
  })

export const EFFECTS: Effect[] = [
  // Jedno kliknięcie
  { id: 'lucky', label: 'Szczęśliwy traf', fn(img, t) { autoLevels(img, true, t); applyAdjust(img, { ...ZERO_ADJUST, fill: 12 * t, saturation: 14 * t, sharpen: 25 * t }) } },
  { id: 'autocontrast', label: 'Auto kontrast', fn(img, t) { autoLevels(img, false, t) } },
  { id: 'autocolor', label: 'Auto kolor', fn(img, t) { autoLevels(img, true, t) } },
  { id: 'bw', label: 'Czarno-białe', fn: (img, t) => perPixel(img, t, (r, g, b) => { const y = lum(r, g, b); return [y, y, y] }) },
  { id: 'bwred', label: 'Czerń i biel: filtr czerwony', fn: filteredBw([0.75, 0.2, 0.05]) },
  { id: 'bwyellow', label: 'Czerń i biel: filtr żółty', fn: filteredBw([0.45, 0.45, 0.1]) },
  { id: 'bwgreen', label: 'Czerń i biel: filtr zielony', fn: filteredBw([0.15, 0.75, 0.1]) },
  { id: 'keepred', label: 'Tylko czerwony', fn: keepColor(0) },
  { id: 'keepyellow', label: 'Tylko żółty', fn: keepColor(55) },
  { id: 'keepgreen', label: 'Tylko zielony', fn: keepColor(120) },
  { id: 'keepblue', label: 'Tylko niebieski', fn: keepColor(220) },
  { id: 'sepia', label: 'Sepia', fn: (img, t) => perPixel(img, t, (r, g, b) => [r * .393 + g * .769 + b * .189, r * .349 + g * .686 + b * .168, r * .272 + g * .534 + b * .131]) },
  { id: 'warm', label: 'Ocieplenie', fn: (img, t) => applyAdjust(img, { ...ZERO_ADJUST, temp: 35 * t, saturation: 22 * t, contrast: 10 * t, fill: 10 * t }) },
  { id: 'boost', label: 'Podbicie', fn: (img, t) => applyAdjust(img, { ...ZERO_ADJUST, saturation: 35 * t, contrast: 20 * t }) },
  { id: 'invert', label: 'Negatyw', fn: (img, t) => perPixel(img, t, (r, g, b) => [255 - r, 255 - g, 255 - b]) },
  // Z suwakiem
  { id: 'grain', label: 'Ziarno filmowe', slider: true, fn({ d }, t) { const k = t * 70; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * k; d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n) } } },
  { id: 'soften', label: 'Zmiękczenie', slider: true, fn(img, t) { const b = boxBlur(img.d, img.w, img.h, bigRadius(img) / 3); for (let i = 0; i < img.d.length; i += 4) for (let c = 0; c < 3; c++) img.d[i + c] = lerp(img.d[i + c], b[i + c], t * .7) } },
  { id: 'glow', label: 'Poświata', slider: true, fn(img, t) { const b = boxBlur(img.d, img.w, img.h, bigRadius(img) / 2); const { d } = img; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp(255 - (255 - d[i + c]) * (255 - b[i + c] * t) / 255) } },
  { id: 'orton', label: 'Orton', slider: true, fn(img, t) { const b = boxBlur(img.d, img.w, img.h, bigRadius(img) / 2); const { d } = img; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp(lerp(d[i + c], Math.min(255, b[i + c] * 1.25 + 12), t * .55)) } },
  { id: 'softfocus', label: 'Miękki fokus', slider: true, fn(img, t) { const b = boxBlur(img.d, img.w, img.h, bigRadius(img) / 1.5); radial(img, (dist, i) => { const k = Math.min(1, Math.max(0, (dist - .25) / .5)) * t; for (let c = 0; c < 3; c++) img.d[i + c] = lerp(img.d[i + c], b[i + c], k) }) } },
  { id: 'focalbw', label: 'Czerń i biel z ogniskiem', slider: true, fn(img, t) { radial(img, (dist, i) => { const k = Math.min(1, Math.max(0, (dist - .2) / .5)) * t; const y = lum(img.d[i], img.d[i + 1], img.d[i + 2]); for (let c = 0; c < 3; c++) img.d[i + c] = lerp(img.d[i + c], y, k) }) } },
  // Redukcja szumu: wygładza tylko miejsca o drobnych różnicach (szum), a krawędzie zostają ostre.
  { id: 'denoise', label: 'Redukcja szumu', slider: true, fn(img, t) {
    const b = boxBlur(img.d, img.w, img.h, 1 + Math.round(t * 2)); const { d } = img; const tol = 18 + 50 * t
    for (let i = 0; i < d.length; i += 4) {
      const diff = Math.abs(lum(d[i], d[i + 1], d[i + 2]) - lum(b[i], b[i + 1], b[i + 2]))
      const k = Math.min(1, Math.max(0, 1 - diff / tol)) * Math.min(1, t * 1.2)
      for (let c = 0; c < 3; c++) d[i + c] = lerp(d[i + c], b[i + c], k)
    }
  } },
  // Przechylenie i przesunięcie (tilt-shift): ostry pas w środku kadru, rozmycie ku górze i dołowi oraz żywsze kolory (efekt miniatury).
  { id: 'tiltshift', label: 'Przechylenie i przesunięcie', slider: true, fn(img, t) {
    const { d, w, h } = img; const b = boxBlur(d, w, h, Math.max(2, bigRadius(img) / 2))
    for (let y = 0; y < h; y++) {
      const k = Math.min(1, Math.max(0, (Math.abs(y / h - 0.5) - 0.12) / 0.28)) * t
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        for (let c = 0; c < 3; c++) d[i + c] = lerp(d[i + c], b[i + c], k)
        const m = (d[i] + d[i + 1] + d[i + 2]) / 3
        for (let c = 0; c < 3; c++) d[i + c] = clamp(m + (d[i + c] - m) * (1 + 0.3 * t))
      }
    }
  } },
  // Rozmycie poza środkiem (maska radialna): środek zostaje ostry, brzegi są mocno rozmyte.
  { id: 'radialblur', label: 'Rozmycie poza środkiem', slider: true, fn(img, t) { const b = boxBlur(img.d, img.w, img.h, Math.max(2, bigRadius(img) * 0.9)); radial(img, (dist, i) => { const k = Math.min(1, Math.max(0, (dist - .18) / .45)) * t; for (let c = 0; c < 3; c++) img.d[i + c] = lerp(img.d[i + c], b[i + c], k) }) } },
  { id: 'vignette', label: 'Winieta', slider: true, fn(img, t) { radial(img, (dist, i) => { const k = 1 - Math.pow(Math.max(0, dist - .25) / .75, 1.6) * t * 1.1; for (let c = 0; c < 3; c++) img.d[i + c] = clamp(img.d[i + c] * Math.max(0, k)) }) } },
  { id: 'gradtint', label: 'Gradientowy odcień', slider: true, fn(img, t) { const { d, w, h } = img; for (let y = 0; y < h; y++) { const k = Math.max(0, 1 - y / (h * .6)) * t * .6; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = lerp(d[i], 255, k * .8); d[i + 1] = lerp(d[i + 1], 140, k); d[i + 2] = lerp(d[i + 2], 40, k) } } } },
  { id: 'duotone', label: 'Dwutonowy', slider: true, fn: (img, t) => gradientMap(img, [[20, 20, 90], [255, 220, 120]], t) },
  { id: 'heatmap', label: 'Mapa cieplna', slider: true, fn: (img, t) => gradientMap(img, [[0, 0, 120], [0, 180, 255], [0, 220, 80], [255, 230, 0], [255, 40, 0]], t) },
  { id: 'night', label: 'Noktowizor', slider: true, fn: (img, t) => gradientMap(img, [[0, 10, 0], [20, 120, 20], [160, 255, 140]], t) },
  { id: 'infrared', label: 'Film podczerwony', slider: true, fn: (img, t) => perPixel(img, t, (r, g, b) => { const y = lum(g * 1.2, r, b * .6); return [y * 1.05 + 20, y * .95 + 10, y * .9 + 25] }) },
  { id: 'matte', label: 'Mat', slider: true, fn: (img, t) => perPixel(img, t, (r, g, b) => [r * .78 + 40, g * .78 + 38, b * .78 + 42]) },
  { id: 'cross', label: 'Cross process', slider: true, fn: (img, t) => perPixel(img, t, (r, g, b) => { const s = (v: number, k: number) => 255 / (1 + Math.exp(-k * (v / 255 - .5))); return [s(r, 7), s(g, 5), 40 + b * .65] }) },
  { id: 'lomo', label: 'Lomo', slider: true, fn(img, t) { applyAdjust(img, { ...ZERO_ADJUST, saturation: 40 * t, contrast: 28 * t }); EFFECTS.find((e) => e.id === 'vignette')!.fn(img, t * .9) } },
  { id: 'sixties', label: 'Lata 60.', slider: true, fn: (img, t) => perPixel(img, t, (r, g, b) => [r * .85 + 45, g * .8 + 30, b * .65 + 40]) },
  { id: 'polaroid', label: 'Polaroid', slider: true, fn(img, t) { perPixel(img, t, (r, g, b) => [r * .9 + 28, g * .9 + 20, b * .8 + 30]); EFFECTS.find((e) => e.id === 'vignette')!.fn(img, t * .4) } },
  { id: 'hdr', label: 'HDR', slider: true, fn(img, t) { const b = boxBlur(img.d, img.w, img.h, bigRadius(img)); const { d } = img; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + (d[i + c] - b[i + c]) * t * 1.6); applyAdjust(img, { ...ZERO_ADJUST, saturation: 18 * t }) } },
  { id: 'posterize', label: 'Posteryzacja', slider: true, fn({ d }, t) { const n = Math.max(2, Math.round(8 - t * 6)); const s = 255 / (n - 1); for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] / s) * s } },
  { id: 'pixelate', label: 'Pikselizacja', slider: true, fn({ d, w, h }, t) { const s = Math.max(2, Math.round(2 + t * Math.max(w, h) / 25)); for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) { let r = 0, g = 0, b = 0, n = 0; for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++ } r /= n; g /= n; b /= n; for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b } } } },
  { id: 'sketch', label: 'Szkic ołówkiem', slider: true, fn(img, t) { const { d } = img; const inv = new Uint8ClampedArray(d); for (let i = 0; i < inv.length; i += 4) { const y = 255 - lum(d[i], d[i + 1], d[i + 2]); inv[i] = inv[i + 1] = inv[i + 2] = y } const b = boxBlur(inv, img.w, img.h, bigRadius(img) / 4); for (let i = 0; i < d.length; i += 4) { const y = lum(d[i], d[i + 1], d[i + 2]); const v = clamp(Math.min(255, y * 255 / Math.max(1, 255 - b[i]))); for (let c = 0; c < 3; c++) d[i + c] = lerp(d[i + c], v, t) } } },
  { id: 'comic', label: 'Komiks', slider: true, fn(img, t) { const e = edges(img); const { d } = img; for (let i = 0, p = 0; i < d.length; i += 4, p++) { const k = e[p] > 90 ? 0 : 1; for (let c = 0; c < 3; c++) { const q = Math.round(d[i + c] / 64) * 64; d[i + c] = lerp(d[i + c], q * k, t) } } } },
  { id: 'neon', label: 'Neon', slider: true, fn(img, t) { const e = edges(img); const { d } = img; for (let i = 0, p = 0; i < d.length; i += 4, p++) { const v = Math.min(255, e[p] * 2); const r = v, g = v * .3 + 20, b = v * 1.1 + 40; d[i] = lerp(d[i], r, t); d[i + 1] = lerp(d[i + 1], g, t); d[i + 2] = lerp(d[i + 2], b, t) } } },
  { id: 'frame', label: 'Ramka', slider: true, fn({ d, w, h }, t) { const m = Math.round(Math.min(w, h) * (0.01 + t * 0.06)); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < m || y < m || x >= w - m || y >= h - m) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 250 } } },
]

export const EFFECT_BY_ID = new Map(EFFECTS.map((e) => [e.id, e]))

function autoLevels(img: Img, perChannel: boolean, t: number) {
  const { d } = img
  const total = d.length / 4
  const hist = [0, 1, 2].map(() => new Array(256).fill(0) as number[])
  const lh = new Array(256).fill(0) as number[]
  for (let i = 0; i < d.length; i += 4) {
    hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++
    lh[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++
  }
  const bounds = perChannel
    ? hist.map((hs) => [percentile(hs, total, .005), percentile(hs, total, .995)])
    : [0, 1, 2].map(() => [percentile(lh, total, .005), percentile(lh, total, .995)])
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const [lo, hi] = bounds[c]
      const v = hi > lo ? ((d[i + c] - lo) * 255) / (hi - lo) : d[i + c]
      d[i + c] = clamp(lerp(d[i + c], v, t))
    }
  }
}

function redEyeFix(img: Img, e: RedEye) {
  const { d, w, h } = img
  const cx = e.x * w, cy = e.y * h, r = Math.max(4, e.r * Math.max(w, h))
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x++) {
      const dist = Math.hypot(x - cx, y - cy) / r
      if (dist > 1) continue
      const i = (y * w + x) * 4
      const red = d[i] / (d[i + 1] + d[i + 2] + 1)
      if (red > 0.9 && d[i] > 60) {
        const k = (1 - dist * dist) * Math.min(1, (red - .9) * 2)
        const dark = (d[i + 1] + d[i + 2]) / 2 * .6
        d[i] = lerp(d[i], dark, k); d[i + 1] = lerp(d[i + 1], dark, k * .5); d[i + 2] = lerp(d[i + 2], dark, k * .5)
      }
    }
  }
}

// ---- Geometria i render --------------------------------------------------

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap

function srcSize(s: Source) {
  return s instanceof HTMLImageElement ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height }
}

export function renderGeometry(src: Source, geo: Geometry, maxSide: number): HTMLCanvasElement {
  const { w: sw, h: sh } = srcSize(src)
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const swapped = geo.rot % 2 === 1
  const W = Math.round((swapped ? sh : sw) * scale), H = Math.round((swapped ? sw : sh) * scale)

  const a = document.createElement('canvas')
  a.width = W; a.height = H
  const g = a.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.translate(W / 2, H / 2)
  g.rotate((geo.rot * Math.PI) / 2 + (geo.angle * Math.PI) / 180)
  g.scale(geo.flipH ? -1 : 1, geo.flipV ? -1 : 1)
  const ang = Math.abs(geo.angle * Math.PI) / 180
  const fit = geo.angle ? Math.cos(ang) + Math.sin(ang) * Math.max(W / H, H / W) : 1
  g.scale(fit, fit)
  const dw = sw * scale, dh = sh * scale
  g.drawImage(src, -dw / 2, -dh / 2, dw, dh)

  // Kadrowanie: największy prostokąt w zadanych proporcjach, zbliżenie i przesunięcie.
  const ar = geo.aspect ?? W / H
  let cw = W, ch = W / ar
  if (ch > H) { ch = H; cw = H * ar }
  cw /= geo.zoom; ch /= geo.zoom
  const cx = (W - cw) / 2 + geo.panX * (W - cw) / 2
  const cy = (H - ch) / 2 + geo.panY * (H - ch) / 2
  if (geo.zoom === 1 && geo.aspect === null) return a
  const b = document.createElement('canvas')
  b.width = Math.max(1, Math.round(cw)); b.height = Math.max(1, Math.round(ch))
  b.getContext('2d')!.drawImage(a, cx, cy, cw, ch, 0, 0, b.width, b.height)
  return b
}

export function applyColor(canvas: HTMLCanvasElement, st: EditState) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const img: Img = { d: data.data, w: canvas.width, h: canvas.height }
  for (const sp of st.spots.slice(0, MAX_SPOTS)) healSpot(img, sp)
  for (const e of st.redeye) redEyeFix(img, e)
  if (st.neutral) {
    const { r, g, b } = st.neutral
    for (let i = 0; i < img.d.length; i += 4) { img.d[i] = clamp(img.d[i] * r); img.d[i + 1] = clamp(img.d[i + 1] * g); img.d[i + 2] = clamp(img.d[i + 2] * b) }
  }
  if (JSON.stringify(st.adj) !== JSON.stringify(ZERO_ADJUST)) applyAdjust(img, st.adj)
  for (const fx of st.fx) EFFECT_BY_ID.get(fx.id)?.fn(img, fx.amount / 100)
  ctx.putImageData(data, 0, 0)
}

/** Rysuje napisy na gotowym kadrze (po korektach i efektach); obrys w kontrastowym kolorze poprawia czytelność. */
export function drawTexts(canvas: HTMLCanvasElement, texts: TextItem[]) {
  if (!texts.length) return
  const ctx = canvas.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  for (const t of texts.slice(0, MAX_TEXTS)) {
    const text = t.text.slice(0, MAX_TEXT_LEN)
    if (!text.trim()) continue
    const px = Math.max(4, t.size * canvas.height)
    ctx.font = `${t.bold ? 700 : 500} ${px}px system-ui, "Segoe UI", sans-serif`
    const m = /^#([0-9a-f]{6})$/i.exec(t.color)
    const rgb = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [255, 255, 255]
    const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 140
    const x = t.x * canvas.width, y = t.y * canvas.height
    ctx.lineWidth = px * 0.12
    ctx.strokeStyle = light ? 'rgba(0,0,0,.65)' : 'rgba(255,255,255,.75)'
    ctx.strokeText(text, x, y)
    ctx.fillStyle = m ? t.color : '#ffffff'
    ctx.fillText(text, x, y)
  }
}

export function renderEdit(src: Source, st: EditState, maxSide: number): HTMLCanvasElement {
  const c = renderGeometry(src, st.geo, maxSide)
  applyColor(c, st)
  drawTexts(c, st.texts)
  return c
}
