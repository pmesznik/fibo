/**
 * Film ze zdjęć: pokaz slajdów z płynnym przejściem i opcjonalną muzyką, nagrywany w oknie programu (kodowanie robi przeglądarka okna, lokalnie).
 * Nagranie trwa tyle, ile sam film. Część czysta (oś czasu, dobór formatu) jest testowana w Node, a nagrywanie sprawdza się w oknie przeglądarki.
 */

export type FilmOptions = {
  /** Liczba zdjęć. */
  count: number
  /** Sekundy na zdjęcie (razem z przejściem). */
  secPerPhoto: number
  /** Czas płynnego przejścia na końcu zdjęcia (0 = twarde cięcie). */
  fadeSec: number
  /** Powolne przybliżenie podczas wyświetlania zdjęcia. */
  zoom: boolean
  width: number
  height: number
  fps: number
}

export type FrameState = { index: number; next: number | null; mix: number; zoomA: number; zoomB: number; done: boolean }

export const MAX_FILM_PHOTOS = 300
export const FILM_SIZES: [string, number, number][] = [['HD 720p', 1280, 720], ['Full HD 1080p', 1920, 1080]]

/** Całkowita długość filmu w sekundach. */
export const filmDuration = (o: Pick<FilmOptions, 'count' | 'secPerPhoto'>) => o.count * o.secPerPhoto

/** Co pokazać w chwili `t` (sekundy od początku): numer zdjęcia, ewentualne następne i stopień przejścia (0 do 1), oraz przybliżenie każdego z nich. */
export function frameAt(o: FilmOptions, t: number): FrameState {
  const total = filmDuration(o)
  if (t >= total || o.count === 0) return { index: Math.max(0, o.count - 1), next: null, mix: 0, zoomA: 1.06, zoomB: 1, done: true }
  const index = Math.min(o.count - 1, Math.floor(t / o.secPerPhoto))
  const local = t - index * o.secPerPhoto
  const z = (p: number) => (o.zoom ? 1 + 0.06 * Math.min(1, Math.max(0, p)) : 1)
  const fadeStart = o.secPerPhoto - o.fadeSec
  const hasNext = index < o.count - 1 && o.fadeSec > 0 && local >= fadeStart
  const mix = hasNext ? Math.min(1, (local - fadeStart) / o.fadeSec) : 0
  return { index, next: hasNext ? index + 1 : null, mix: mix * mix * (3 - 2 * mix), zoomA: z(local / o.secPerPhoto), zoomB: z(hasNext ? (local - fadeStart) / o.secPerPhoto : 0), done: false }
}

/** Format nagrania obsługiwany przez okno programu: najpierw MP4 (H.264), potem WebM. */
export function pickFilmMime(isSupported: (m: string) => boolean): { mime: string; ext: 'mp4' | 'webm' } | null {
  for (const m of ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4']) if (isSupported(m)) return { mime: m, ext: 'mp4' }
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (isSupported(m)) return { mime: m, ext: 'webm' }
  return null
}

/** Bezpieczna nazwa pliku filmu z daty. */
export function filmFileName(d: Date, ext: 'mp4' | 'webm'): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `film_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${ext}`
}

/** Rysuje zdjęcie w kadrze filmu: całe zdjęcie na czarnym tle (bez przycinania), z przybliżeniem `zoom`. */
export function drawPhoto(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, W: number, H: number, zoom: number, alpha: number) {
  const s = Math.min(W / img.width, H / img.height) * zoom
  const w = img.width * s, h = img.height * s
  ctx.globalAlpha = alpha
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
  ctx.globalAlpha = 1
}

export type FilmResult = { blob: Blob; ext: 'mp4' | 'webm'; seconds: number }

/**
 * Nagrywa film. `load(i)` zwraca zdjęcie numer i; `audio` to opcjonalne bajty pliku z muzyką. `onProgress(sekundy, razem)` pokazuje postęp,
 * a `signal` pozwala przerwać (wtedy zgłaszany jest błąd „Przerwano”).
 */
export async function recordFilm(o: FilmOptions, load: (i: number) => Promise<ImageBitmap>, audio: ArrayBuffer | null, onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<FilmResult> {
  const fmt = pickFilmMime((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m))
  if (!fmt) throw new Error('Okno programu nie umie nagrywać filmów na tym komputerze')
  const canvas = document.createElement('canvas')
  canvas.width = o.width; canvas.height = o.height
  const ctx = canvas.getContext('2d', { alpha: false })!
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  let actx: AudioContext | null = null
  if (audio) {
    actx = new AudioContext()
    const buf = await actx.decodeAudioData(audio.slice(0))
    const dest = actx.createMediaStreamDestination()
    const src = actx.createBufferSource()
    src.buffer = buf; src.loop = true
    const gain = actx.createGain()
    const total = filmDuration(o)
    gain.gain.setValueAtTime(1, actx.currentTime)
    gain.gain.setValueAtTime(1, actx.currentTime + Math.max(0, total - 1.5))
    gain.gain.linearRampToValueAtTime(0, actx.currentTime + total)
    src.connect(gain).connect(dest)
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    src.start()
  }
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: o.width >= 1900 ? 8_000_000 : 4_500_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>((res) => { rec.onstop = () => res() })
  const cache = new Map<number, ImageBitmap>()
  const need = async (i: number) => { if (!cache.has(i)) cache.set(i, await load(i)); return cache.get(i)! }
  const release = (keep: number[]) => { for (const [k, b] of cache) if (!keep.includes(k)) { b.close(); cache.delete(k) } }
  const total = filmDuration(o)
  try {
    rec.start(1000)
    const t0 = performance.now()
    let last = -1
    for (;;) {
      if (signal.aborted) throw new Error('Przerwano')
      const t = (performance.now() - t0) / 1000
      const f = frameAt(o, t)
      if (f.done) break
      const a = await need(f.index)
      const b = f.next !== null ? await need(f.next) : null
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, o.width, o.height)
      drawPhoto(ctx, a, o.width, o.height, f.zoomA, 1)
      if (b) drawPhoto(ctx, b, o.width, o.height, f.zoomB, f.mix)
      track.requestFrame?.()
      release([f.index, f.next ?? -1])
      if (f.index !== last) { last = f.index; onProgress(t, total) }
      await new Promise((r) => setTimeout(r, 1000 / o.fps))
    }
    onProgress(total, total)
  } finally {
    if (rec.state !== 'inactive') rec.stop()
    await stopped
    stream.getTracks().forEach((t) => t.stop())
    cache.forEach((b) => b.close())
    void actx?.close()
  }
  return { blob: new Blob(chunks, { type: fmt.mime }), ext: fmt.ext, seconds: total }
}
