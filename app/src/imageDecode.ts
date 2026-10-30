/** Dekodowanie obrazu z bajtów w oknie aplikacji. SVG nie przechodzi przez createImageBitmap, więc rysujemy go przez <img>. */
export async function decodeBitmap(buf: ArrayBuffer, name: string, orientation = true): Promise<ImageBitmap> {
  if (/\.svg$/i.test(name)) return decodeSvg(buf)
  return createImageBitmap(new Blob([buf]), orientation ? { imageOrientation: 'from-image' } : undefined)
}

async function decodeSvg(buf: ArrayBuffer): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('Nie da się narysować pliku SVG')); img.src = url })
    // SVG bez własnego rozmiaru dostaje 1024 px szerokości, a zbyt duży jest ograniczony do 4096 px.
    let w = img.naturalWidth || 1024
    let h = img.naturalHeight || Math.round(w * 0.75)
    const k = Math.min(1, 4096 / Math.max(w, h))
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k))
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d')?.drawImage(img, 0, 0, w, h)
    return await createImageBitmap(c)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Miniatura JPEG (dłuższy bok `side` px) zrobiona w oknie aplikacji, dla formatów bez dekodera w programie (AVIF, SVG). */
export async function makeThumbBlob(buf: ArrayBuffer, name: string, side = 360): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await decodeBitmap(buf, name)
  const width = bmp.width, height = bmp.height
  const k = Math.min(1, side / Math.max(width, height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(width * k)); c.height = Math.max(1, Math.round(height * k))
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Brak obsługi canvas')
  ctx.fillStyle = '#fff' // przezroczystość (SVG, AVIF) na jasnym tle
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Nie udało się zapisać miniatury'))), 'image/jpeg', 0.85))
  return { blob, width, height }
}

// Miniatury filmów robimy po dwie naraz: każdy odtwarzacz zajmuje pamięć i dekoder.
let videoSlots = 0
const videoQueue: (() => void)[] = []
const takeSlot = () => new Promise<void>((ok) => { if (videoSlots < 2) { videoSlots++; ok() } else videoQueue.push(() => { videoSlots++; ok() }) })
const freeSlot = () => { videoSlots--; videoQueue.shift()?.() }

/** Miniatura JPEG z klatki filmu (około 10 procent długości, nie więcej niż sekunda), zrobiona przez odtwarzacz okna aplikacji. */
export async function makeVideoThumbBlob(url: string, side = 360): Promise<{ blob: Blob; width: number; height: number }> {
  await takeSlot()
  const v = document.createElement('video')
  try {
    v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.playsInline = true
    const ready = (ev: 'loadeddata' | 'seeked') => new Promise<void>((ok, fail) => {
      const t = window.setTimeout(() => fail(new Error('Film nie odpowiada')), 12000)
      v.addEventListener(ev, () => { window.clearTimeout(t); ok() }, { once: true })
      v.addEventListener('error', () => { window.clearTimeout(t); fail(new Error('Okno aplikacji nie umie odtworzyć tego filmu (nieobsługiwany kodek)')) }, { once: true })
    })
    const loaded = ready('loadeddata')
    v.src = url
    await loaded
    const target = Math.min(1, (v.duration || 0) * 0.1)
    if (target > 0.05) { const seeked = ready('seeked'); v.currentTime = target; await seeked }
    const w = v.videoWidth, h = v.videoHeight
    if (!w || !h) throw new Error('Film nie ma obrazu')
    const k = Math.min(1, side / Math.max(w, h))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Brak obsługi canvas')
    ctx.drawImage(v, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Nie udało się zapisać miniatury'))), 'image/jpeg', 0.85))
    return { blob, width: w, height: h }
  } finally {
    v.removeAttribute('src'); v.load()
    freeSlot()
  }
}
