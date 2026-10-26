// Dzień i noc na globusie: pozycja Słońca z daty oraz warstwa nocy z płynnym zmierzchem.
// Wszystko liczone lokalnie, bez internetu. Wzory: uproszczony algorytm Almanachu Astronomicznego (dokładność ok. 0,01°).

const RAD = Math.PI / 180

export type Sun = { dec: number; lon: number } // deklinacja w radianach, długość podsłoneczna w stopniach

/** Punkt podsłoneczny (miejsce, nad którym Słońce stoi w zenicie) dla danej chwili. */
export function sunPosition(date: Date): Sun {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0 // dni od J2000
  const L = (((280.46 + 0.9856474 * n) % 360) + 360) % 360
  const g = ((((357.528 + 0.9856003 * n) % 360) + 360) % 360) * RAD
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const eps = (23.439 - 0.0000004 * n) * RAD
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const gmstHours = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24
  let lon = ra / RAD - gmstHours * 15
  lon = ((((lon + 180) % 360) + 360) % 360) - 180
  return { dec, lon }
}

/** Wysokość Słońca nad horyzontem w stopniach (ujemna: Słońce pod horyzontem) w danym miejscu i czasie. */
export function sunAltitudeDeg(latDeg: number, lonDeg: number, date: Date): number {
  const { dec, lon } = sunPosition(date)
  const lat = latDeg * RAD
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos((lonDeg - lon) * RAD)
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD
}

/** Rozmiar płótna nocy; obraz jest w rzucie Mercatora (tak jak kafelki mapy), więc pasuje do globusa i do płaskiej mapy. */
export const NIGHT_SIZE = 720
/** Zasięg szerokości geograficznej rzutu Web Mercator. */
export const MERCATOR_LAT = 85.0511287798

// Tablice liczone raz: sinus i cosinus długości (kolumny) oraz szerokości w rzucie Mercatora (wiersze).
let colCos: Float32Array | null = null
let colSin: Float32Array | null = null
let rowSin: Float32Array | null = null
let rowCos: Float32Array | null = null
let pixels: ImageData | null = null

function prepare() {
  if (colCos) return
  const N = NIGHT_SIZE
  colCos = new Float32Array(N); colSin = new Float32Array(N); rowSin = new Float32Array(N); rowCos = new Float32Array(N)
  for (let x = 0; x < N; x++) {
    const lon = ((x + 0.5) / N) * 360 - 180
    colCos[x] = Math.cos(lon * RAD); colSin[x] = Math.sin(lon * RAD)
  }
  for (let y = 0; y < N; y++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / N)))
    rowSin[y] = Math.sin(lat); rowCos[y] = Math.cos(lat)
  }
}

// Granice zmierzchu jako sinus wysokości Słońca: pełny dzień od +5°, pełna noc od -18° (koniec zmierzchu astronomicznego).
const SIN_DAY = Math.sin(5 * RAD)
const SIN_NIGHT = Math.sin(-18 * RAD)
const NIGHT_ALPHA = 0.68
const NIGHT = [10, 14, 42]
const GLOW = [255, 120, 60]

/** Maksymalna przezroczystość nocy dla danej wysokości Słońca (sinus), z gładkim przejściem. Eksportowane do testów. */
export function nightAlpha(sinAlt: number): number {
  const t = Math.max(0, Math.min(1, (SIN_DAY - sinAlt) / (SIN_DAY - SIN_NIGHT)))
  return NIGHT_ALPHA * t * t * (3 - 2 * t)
}

/** Rysuje na płótnie noc: ciemność rośnie płynnie od zachodu Słońca do końca zmierzchu, z delikatną ciepłą poświatą na granicy. */
export function drawNight(canvas: HTMLCanvasElement, date: Date) {
  prepare()
  const N = NIGHT_SIZE
  if (canvas.width !== N) canvas.width = N
  if (canvas.height !== N) canvas.height = N
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (!pixels) pixels = ctx.createImageData(N, N)
  const data = pixels.data
  const { dec, lon } = sunPosition(date)
  const sinD = Math.sin(dec), cosD = Math.cos(dec)
  const cs = Math.cos(lon * RAD), ss = Math.sin(lon * RAD)
  const cc = colCos as Float32Array, sc = colSin as Float32Array, rs = rowSin as Float32Array, rc = rowCos as Float32Array

  let i = 0
  for (let y = 0; y < N; y++) {
    const A = rs[y] * sinD
    const B = rc[y] * cosD
    for (let x = 0; x < N; x++, i += 4) {
      const sinAlt = A + B * (cc[x] * cs + sc[x] * ss)
      const an = nightAlpha(sinAlt)
      const ag = sinAlt > -0.35 && sinAlt < 0.35 ? 0.16 * Math.exp(-(sinAlt * sinAlt) / 0.0098) : 0
      const total = an + ag * (1 - an)
      if (total < 0.002) { data[i + 3] = 0; continue }
      const wGlow = (ag * (1 - an)) / total
      data[i] = NIGHT[0] + (GLOW[0] - NIGHT[0]) * wGlow
      data[i + 1] = NIGHT[1] + (GLOW[1] - NIGHT[1]) * wGlow
      data[i + 2] = NIGHT[2] + (GLOW[2] - NIGHT[2]) * wGlow
      data[i + 3] = total * 255
    }
  }
  ctx.putImageData(pixels, 0, 0)
}
