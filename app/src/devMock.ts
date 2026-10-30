/**
 * Atrapa Tauri do oglądania i sprawdzania wyglądu programu w zwykłej przeglądarce (tylko `npm run dev`, adres z `?mock`).
 * Podstawia przykładowe zdjęcia, osoby i twarze rysowane na płótnie oraz pozwala wywołać okna postępu:
 *   window.__mockEmit('job-progress', { kind: 'dups', done: 40, total: 120, finished: false, label: null })
 * W wersji produkcyjnej ten plik nie jest dołączany (import jest pod warunkiem import.meta.env.DEV).
 */

type Handler = { id: number; event: string; cb: (e: unknown) => void }

const callbacks = new Map<number, (e: unknown) => void>()
const handlers: Handler[] = []
let nextId = 1

const FOLDERS = ['Wakacje 2024', 'Urodziny Alunii', 'Święta 2025', 'Wycieczka w góry', 'Codzienne']
const NAMES = ['Mama', 'Tata', 'Alunia', 'Babcia Irena', 'Dziadek Stefan', null as string | null]

const hue = (n: number) => (n * 47) % 360

async function canvasJpeg(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Promise<ArrayBuffer> {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  draw(ctx)
  const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.85))
  return blob.arrayBuffer()
}

function scene(ctx: CanvasRenderingContext2D, w: number, h: number, id: number) {
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, `hsl(${hue(id)} 65% 62%)`)
  g.addColorStop(1, `hsl(${hue(id) + 50} 60% 38%)`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = `hsla(${hue(id) + 120} 70% 80% / .55)`
  ctx.beginPath(); ctx.arc(w * 0.72, h * 0.3, h * 0.18, 0, 7); ctx.fill()
  ctx.fillStyle = `hsla(${hue(id) + 200} 50% 25% / .6)`
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w * 0.35, h * 0.55); ctx.lineTo(w * 0.7, h); ctx.fill()
}

function face(ctx: CanvasRenderingContext2D, s: number, id: number) {
  const bg = ctx.createLinearGradient(0, 0, s, s)
  bg.addColorStop(0, `hsl(${hue(id)} 30% 75%)`); bg.addColorStop(1, `hsl(${hue(id) + 30} 25% 55%)`)
  ctx.fillStyle = bg; ctx.fillRect(0, 0, s, s)
  ctx.fillStyle = `hsl(${20 + (id % 4) * 6} 55% ${68 - (id % 3) * 6}%)`
  ctx.beginPath(); ctx.ellipse(s / 2, s * 0.52, s * 0.3, s * 0.38, 0, 0, 7); ctx.fill()
  ctx.fillStyle = `hsl(${(id * 29) % 60 + 15} 40% ${25 + (id % 4) * 12}%)`
  ctx.beginPath(); ctx.ellipse(s / 2, s * 0.28, s * 0.32, s * 0.2, 0, Math.PI, 0); ctx.fill()
  ctx.fillStyle = '#2b2b33'
  ctx.beginPath(); ctx.arc(s * 0.4, s * 0.48, s * 0.03, 0, 7); ctx.arc(s * 0.6, s * 0.48, s * 0.03, 0, 7); ctx.fill()
  ctx.strokeStyle = '#a23b3b'; ctx.lineWidth = s * 0.02
  ctx.beginPath(); ctx.arc(s / 2, s * 0.6, s * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
}

const PHOTO_N = 96
const photos = Array.from({ length: PHOTO_N }, (_, i) => {
  const id = i + 1
  const y = 2019 + (i % 8)
  const m = 1 + ((i * 5) % 12)
  const landscape = i % 5 !== 0
  return {
    id,
    path: `C:\\Zdjecia\\${FOLDERS[i % FOLDERS.length]}\\IMG_${String(2000 + id)}.jpg`,
    name: `IMG_${2000 + id}.jpg`,
    size: 2_400_000 + i * 31_000,
    modified: Math.floor(new Date(y, m - 1, 1 + (i % 27)).getTime() / 1000),
    // Kilka zdjęć z dzisiejszego dnia roku w poprzednich latach, żeby karta „Tego dnia” była widoczna w podglądzie.
    taken: i < 7 ? `${new Date().getFullYear() - 1 - (i % 3)}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')} 1${i % 10}:20:00` : `${y}-${String(m).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')} 1${i % 10}:20:00`,
    width: landscape ? 4000 : 3000,
    height: landscape ? 3000 : 4000,
    camera: i % 3 ? 'Canon EOS R6' : 'iPhone 15',
    rating: i % 6,
    favorite: i % 7 === 0,
    tags: i % 4 === 0 ? ['rodzina', 'lato'] : i % 9 === 0 ? ['góry'] : [],
    lat: i % 6 === 0 ? 50.3 + i * 0.01 : null,
    lon: i % 6 === 0 ? 18.9 + i * 0.01 : null,
    albums: i % 3 === 0 ? [1] : i % 8 === 0 ? [2] : [],
    caption: i % 11 === 0 ? 'Fajny dzień' : null,
    exif: null,
    author: null,
    copyright: null,
    color: i % 12,
  }
})
// Przykładowe wydarzenia: dwanaście zdjęć z jednego dnia i trzynaście z trzech dni z rzędu (podróż).
for (let k = 0; k < 12; k++) { const p = photos[30 + k]; p.taken = `2025-08-10 ${String(10 + Math.floor(k / 3)).padStart(2, '0')}:${String((k % 3) * 20).padStart(2, '0')}:00` }
for (let k = 0; k < 13; k++) { const p = photos[50 + k] as unknown as { taken: string; lat: number; lon: number }; p.taken = `2024-07-${12 + Math.floor(k / 5)} ${String(8 + (k % 5) * 3).padStart(2, '0')}:00:00`; p.lat = 50.06 + k * 0.001; p.lon = 19.94 }

// Przykładowe filmy (bez odtwarzania: w podglądzie przeglądarkowym nie ma protokołu programu).
for (const i of [20, 21]) { const p = photos[i] as unknown as { video: boolean; duration: number; name: string; path: string }; p.video = true; p.duration = i === 20 ? 42 : 3725; p.name = `MOV_${i}.mp4`; p.path = `C:\\Zdjecia\\${FOLDERS[0]}\\MOV_${i}.mp4` }

// Przykładowe stosy do podglądu: para RAW + JPEG i seria trzech zdjęć (te same: folder, aparat i czas z sekundą różnicy).
for (const [i, name, taken] of [[10, "IMG_5000.ARW", "2026-01-05 09:00:00"], [11, "IMG_5000.jpg", "2026-01-05 09:00:00"], [12, "IMG_5101.jpg", "2026-01-05 09:10:00"], [13, "IMG_5102.jpg", "2026-01-05 09:10:01"], [14, "IMG_5103.jpg", "2026-01-05 09:10:02"]] as [number, string, string][]) {
  const p = photos[i]
  p.path = `C:\\Zdjecia\\${FOLDERS[0]}\\${name}`; p.name = name; p.taken = taken; p.camera = "Canon EOS R6"
}

const faceCards = (personId: number) =>
  Array.from({ length: 26 }, (_, k) => ({ face: personId * 100 + k, photo: ((personId * 7 + k * 3) % PHOTO_N) + 1, unsure: k < 5 && personId % 2 === 1 }))

function respond(cmd: string, args: Record<string, unknown> = {}): unknown | Promise<unknown> {
  switch (cmd) {
    case 'list_photos': return photos
    case 'thumbnail_data': {
      const id = Number(args.id)
      const p = photos[id - 1]
      const w = 360, h = p && p.width < p.height ? 480 : 270
      return canvasJpeg(w, h, (c) => scene(c, w, h, id))
    }
    case 'read_image': {
      const id = Number(args.id)
      return canvasJpeg(1600, 1067, (c) => scene(c, 1600, 1067, id))
    }
    case 'face_crop': return canvasJpeg(128, 128, (c) => face(c, 128, Number(args.id)))
    case 'list_albums': return [{ id: 1, name: 'Wakacje', count: 32, hidden: false }, { id: 2, name: 'Rodzina', count: 12, hidden: false }, { id: 3, name: 'Prywatny', count: 5, hidden: true }]
    case 'list_roots': return ['C:\\Zdjecia']
    case 'faces_status': return { enabled: true, models_ok: true, running: false, photos: PHOTO_N, scanned: PHOTO_N, faces: 140, people: 6, unassigned: 3, rejected: 2 }
    case 'list_people':
      return NAMES.map((name, i) => ({ id: i + 1, name, count: 40 - i * 5, photos: 30 - i * 4, cover: (i + 1) * 100, ignored: false, unsure: i % 2 === 0 ? i + 2 : 0 }))
    case 'person_photos': return photos.slice(0, 20).map((p) => p.id)
    case 'person_face_cards': return faceCards(Number(args.id))
    case 'person_faces': return faceCards(Number(args.id)).map((f) => f.face).slice(0, 12)
    case 'merge_suggestions': return args.id === null ? [{ id: 6, other: 1, score: 0.78, conflict: false }] : [2, 3, 4, 5, 6].map((o, k) => ({ id: Number(args.id), other: o, score: 0.7 - k * 0.1, conflict: o === 4 }))
    case 'photo_people': return [{ id: 1, name: 'Mama', face: 100 }, { id: 3, name: 'Alunia', face: 300 }]
    case 'photo_exif': return [['Aparat', 'Canon EOS R6'], ['Czas naświetlania', '1/250 s'], ['Przysłona', 'f/2.8'], ['ISO', '200'], ['Ogniskowa', '50 mm']]
    case 'has_original': return false
    case 'find_duplicates': return [{ kind: 'exact', ids: [1, 13] }, { kind: 'similar', ids: [4, 5, 22] }, { kind: 'exact', ids: [30, 31] }]
    case 'photo_face_stats': return photos.filter((p) => p.id % 3 === 0).map((p) => [p.id, 1 + (p.id % 3), 0.8])
    case 'save_calendar_pdf': return 'C:\\Zdjecia\\Kalendarz_2027.pdf'
    case 'get_sidecar_enabled': return true
    case 'get_skip_gif_png': return false
    case 'hidden_count': return 0
    case 'detect_cards': return []
    case 'check_for_update':
    case 'plugin:updater|check': return null
    case 'plugin:event|listen': {
      const e = args as { event: string; handler: number }
      const cb = callbacks.get(e.handler)
      const id = nextId++
      if (cb) handlers.push({ id, event: e.event, cb })
      return id
    }
    case 'plugin:event|unlisten': return null
    default:
      return cmd.startsWith('list_') || cmd.startsWith('plugin:') ? [] : null
  }
}

const w = window as unknown as Record<string, unknown>
w.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args?: Record<string, unknown>) => respond(cmd, args),
  transformCallback: (cb: (e: unknown) => void) => { const id = nextId++; callbacks.set(id, cb); return id },
  unregisterCallback: (id: number) => callbacks.delete(id),
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
}
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
w.__mockEmit = (event: string, payload: unknown) => handlers.filter((h) => h.event === event).forEach((h) => h.cb({ event, id: h.id, payload }))
