import { useEffect, useMemo, useRef, useState } from 'react'
import { pl } from './pl'
import { X, Shuffle, Save } from './FiboIcons'
import { decodeBitmap } from './imageDecode'
import { readImage, saveCollage, type Photo } from './api'
import { Chip } from './ui'

type Layout = 'grid' | 'mosaic' | 'pile' | 'contact' | 'exposure'
type Cell = { x: number; y: number; w: number; h: number; rot?: number }
type Loaded = { bmp: ImageBitmap; name: string }

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'grid', label: 'Siatka' },
  { id: 'mosaic', label: 'Mozaika' },
  { id: 'pile', label: 'Stos zdjęć' },
  { id: 'contact', label: 'Kontaktówka' },
  { id: 'exposure', label: 'Wielokrotna ekspozycja' },
]
/** Rozdzielczość tego ekranu w pikselach (dla tapety): nie więcej niż 3840 px szerokości. */
const SCREEN: [number, number] = (() => {
  const k = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const w = Math.min(3840, Math.round((typeof screen !== 'undefined' ? screen.width : 1920) * k)), h = Math.round(w * (typeof screen !== 'undefined' && screen.width ? screen.height / screen.width : 9 / 16))
  return [Math.max(800, w), Math.max(450, h)]
})()
/** `px` to dokładny rozmiar zapisu (tapeta), a bez niego zapis ma 2800 px szerokości. */
export const FORMATS: { label: string; ratio: number; px?: [number, number] }[] = [
  { label: 'Tapeta (ten ekran)', ratio: SCREEN[0] / SCREEN[1], px: SCREEN },
  { label: '16:9', ratio: 16 / 9 }, { label: '4:3', ratio: 4 / 3 }, { label: '3:2', ratio: 3 / 2 },
  { label: '1:1', ratio: 1 }, { label: '3:4', ratio: 3 / 4 }, { label: '9:16', ratio: 9 / 16 },
]
export const BACKGROUNDS = [
  { label: 'Biały', v: '#ffffff', text: '#1c2430' }, { label: 'Czarny', v: '#0b0d10', text: '#e8ecf1' },
  { label: 'Grafit', v: '#2a303a', text: '#e8ecf1' }, { label: 'Papier', v: '#f1e8d8', text: '#3a3023' },
  { label: 'Szary', v: '#808080', text: '#10141a' },
  /** Tło ze zdjęcia: pierwsze zdjęcie, powiększone, mocno rozmyte i przyciemnione. */
  { label: 'Ze zdjęcia', v: '#0b0d10', text: '#e8ecf1', photo: true },
] as { label: string; v: string; text: string; photo?: boolean }[]
const MAX_PHOTOS = 30
const PREVIEW_W = 900
const EXPORT_W = 2800

/** Generator liczb pseudolosowych z ziarnem, żeby stos zdjęć był powtarzalny przy tym samym ziarnie. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Wiersze o równej wysokości dla zdjęć o danych proporcjach, mieszczące się w szerokości `W`. */
function justify(ratios: number[], W: number, h: number, gap: number) {
  const rows: { idx: number[]; h: number }[] = []
  let cur: number[] = [], sum = 0
  ratios.forEach((r, i) => {
    cur.push(i); sum += r
    if (sum * h + gap * (cur.length - 1) >= W) {
      rows.push({ idx: cur, h: (W - gap * (cur.length - 1)) / sum }); cur = []; sum = 0
    }
  })
  if (cur.length) rows.push({ idx: cur, h: Math.min(h, (W - gap * (cur.length - 1)) / sum) })
  return rows
}

function layoutCells(layout: Layout, items: Loaded[], W: number, H: number, gap: number, seed: number): Cell[] {
  const n = items.length
  const ratios = items.map((it) => it.bmp.width / it.bmp.height)
  const pad = gap
  const innerW = W - pad * 2, innerH = H - pad * 2

  if (layout === 'grid' || layout === 'contact') {
    const cols = Math.max(1, Math.round(Math.sqrt((n * innerW) / innerH)))
    const rows = Math.ceil(n / cols)
    const cw = (innerW - gap * (cols - 1)) / cols
    const caption = layout === 'contact' ? Math.min(30, cw * 0.14) : 0
    const ch = (innerH - gap * (rows - 1)) / rows
    return items.map((_, i) => ({
      x: pad + (i % cols) * (cw + gap), y: pad + Math.floor(i / cols) * (ch + gap),
      w: cw, h: ch - caption,
    }))
  }

  if (layout === 'mosaic') {
    // Dobieramy wysokość wiersza tak, by całość wypełniła płótno.
    let lo = 20, hi = innerH, best = innerH / 2
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      const rows = justify(ratios, innerW, mid, gap)
      const total = rows.reduce((a, r) => a + r.h, 0) + gap * (rows.length - 1)
      if (total > innerH) hi = mid; else { best = mid; lo = mid }
    }
    const rows = justify(ratios, innerW, best, gap)
    const total = rows.reduce((a, r) => a + r.h, 0) + gap * (rows.length - 1)
    const cells: Cell[] = new Array(n)
    let y = pad + Math.max(0, (innerH - total) / 2)
    for (const row of rows) {
      const rowW = row.idx.reduce((a, i) => a + ratios[i] * row.h, 0) + gap * (row.idx.length - 1)
      let x = pad + (innerW - rowW) / 2
      for (const i of row.idx) { cells[i] = { x, y, w: ratios[i] * row.h, h: row.h }; x += ratios[i] * row.h + gap }
      y += row.h + gap
    }
    return cells
  }

  // Stos zdjęć: rozrzucone, lekko obrócone, w białych ramkach.
  const rand = rng(seed)
  const base = Math.sqrt((innerW * innerH) / Math.max(n, 3)) * 1.45
  return items.map((_, i) => {
    const r = ratios[i]
    const w = r >= 1 ? base : base * r, h = r >= 1 ? base / r : base
    return {
      x: pad + w / 2 + rand() * Math.max(0, innerW - w) , y: pad + h / 2 + rand() * Math.max(0, innerH - h),
      w, h, rot: (rand() - 0.5) * 0.5,
    }
  })
}

function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, c: Cell, radius: number) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(c.x, c.y, c.w, c.h, radius)
  ctx.clip()
  const s = Math.max(c.w / img.width, c.h / img.height)
  const sw = c.w / s, sh = c.h / s
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, c.x, c.y, c.w, c.h)
  ctx.restore()
}

export function render(canvas: HTMLCanvasElement, items: Loaded[], opt: {
  layout: Layout; W: number; H: number; gap: number; radius: number; bg: typeof BACKGROUNDS[number]; seed: number
}) {
  canvas.width = Math.round(opt.W); canvas.height = Math.round(opt.H)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = opt.bg.v
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (!items.length) return
  const k = opt.W / PREVIEW_W // wartości w "pikselach podglądu" skalujemy do rozmiaru eksportu
  const gap = opt.gap * k, radius = opt.radius * k
  if (opt.bg.photo) {
    // Rozmyte, przyciemnione pierwsze zdjęcie jako tło.
    ctx.save()
    ctx.filter = `blur(${Math.round(36 * k)}px)`
    drawCover(ctx, items[0].bmp, { x: -60 * k, y: -60 * k, w: canvas.width + 120 * k, h: canvas.height + 120 * k }, 0)
    ctx.restore()
    ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  if (opt.layout === 'exposure') {
    // Efekt filmowej wielokrotnej ekspozycji: zdjęcia nakładają się na siebie, rozjaśniając się nawzajem (tryb „ekran”).
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'screen'
    const a = Math.min(1, 1.5 / Math.sqrt(items.length))
    items.forEach((it) => { ctx.globalAlpha = a; drawCover(ctx, it.bmp, { x: 0, y: 0, w: canvas.width, h: canvas.height }, 0) })
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    return
  }
  const cells = layoutCells(opt.layout, items, opt.W, opt.H, gap, opt.seed)

  if (opt.layout === 'pile') {
    items.forEach((it, i) => {
      const c = cells[i], frame = 10 * k
      ctx.save()
      ctx.translate(c.x, c.y); ctx.rotate(c.rot ?? 0)
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18 * k; ctx.shadowOffsetY = 4 * k
      ctx.fillStyle = '#fff'
      ctx.fillRect(-c.w / 2 - frame, -c.h / 2 - frame, c.w + frame * 2, c.h + frame * 2)
      ctx.shadowColor = 'transparent'
      drawCover(ctx, it.bmp, { x: -c.w / 2, y: -c.h / 2, w: c.w, h: c.h }, 0)
      ctx.restore()
    })
    return
  }
  items.forEach((it, i) => {
    drawCover(ctx, it.bmp, cells[i], radius)
    if (opt.layout === 'contact') {
      const c = cells[i]
      ctx.fillStyle = opt.bg.text
      ctx.font = `${Math.max(10, Math.min(26 * k, c.w * 0.08))}px system-ui, sans-serif`
      ctx.textBaseline = 'top'
      const label = it.name.length > 28 ? it.name.slice(0, 26) + '…' : it.name
      ctx.fillText(label, c.x, c.y + c.h + 4 * k, c.w)
    }
  })
}

export function Collage({ photos, onClose, onSaved, say }: {
  photos: Photo[]
  onClose: () => void
  onSaved: (newId: number) => void
  say: (text: string, kind?: 'ok' | 'err') => void
}) {
  const used = useMemo(() => photos.slice(0, MAX_PHOTOS), [photos])
  const [items, setItems] = useState<Loaded[]>([])
  const [loading, setLoading] = useState(true)
  const [layout, setLayout] = useState<Layout>('mosaic')
  const [format, setFormat] = useState(0)
  const [gap, setGap] = useState(10)
  const [radius, setRadius] = useState(8)
  const [bgIdx, setBgIdx] = useState(0)
  const [seed, setSeed] = useState(7)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Wczytanie zdjęć w pomniejszeniu (kolaż z 30 pełnych zdjęć zająłby gigabajty pamięci).
  useEffect(() => {
    let dead = false
    setLoading(true)
    ;(async () => {
      const out: Loaded[] = []
      for (const p of used) {
        try {
          const full = await decodeBitmap(await readImage(p.id), p.name)
          const s = Math.min(1, 2200 / Math.max(full.width, full.height))
          const bmp = s < 1 ? await createImageBitmap(full, { resizeWidth: Math.round(full.width * s), resizeHeight: Math.round(full.height * s), resizeQuality: 'high' }) : full
          if (bmp !== full) full.close()
          out.push({ bmp, name: p.name })
        } catch { /* pomijamy uszkodzone pliki */ }
        if (dead) { out.forEach((i) => i.bmp.close()); return }
      }
      setItems(out); setLoading(false)
    })()
    return () => { dead = true }
  }, [used])
  // Wczytane pomniejszone zdjęcia zwalniamy, gdy kolaż się zamyka albo lista się zmienia.
  useEffect(() => () => { items.forEach((i) => i.bmp.close()) }, [items])

  const ratio = FORMATS[format].ratio
  const bg = BACKGROUNDS[bgIdx]

  useEffect(() => {
    if (!canvasRef.current || loading) return
    render(canvasRef.current, items, { layout, W: PREVIEW_W, H: PREVIEW_W / ratio, gap, radius, bg, seed })
  }, [items, loading, layout, ratio, gap, radius, bg, seed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    setSaving(true)
    try {
      const c = document.createElement('canvas')
      const px = FORMATS[format].px
      render(c, items, { layout, W: px ? px[0] : EXPORT_W, H: px ? px[1] : EXPORT_W / ratio, gap, radius, bg, seed })
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) throw new Error('nie udało się zakodować obrazu')
      const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0')
      const name = `kolaz_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
      const id = await saveCollage(used[0].id, await blob.arrayBuffer(), name)
      say(FORMATS[format].px ? 'Tapeta zapisana w folderze pierwszego zdjęcia. Żeby ustawić ją na pulpicie, kliknij plik prawym przyciskiem w Eksploratorze i wybierz „Ustaw jako tło pulpitu”' : 'Kolaż zapisany w folderze pierwszego zdjęcia', 'ok')
      onSaved(id)
      onClose()
    } catch (e) {
      say(`Błąd zapisu kolażu: ${e}`, 'err')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1500] flex" style={{ background: 'var(--bg)' }} role="dialog" aria-modal="true" aria-label="Kolaż">
      <div className="flex min-w-0 flex-1 items-center justify-center" style={{ padding: 'calc(76px + var(--sat)) 16px 24px 16px', background: 'color-mix(in srgb, var(--bg) 60%, #000)' }}>
        {loading && <div className="empty">Wczytywanie zdjęć…</div>}
        <canvas ref={canvasRef} aria-label="Podgląd kolażu" className={loading ? 'hidden' : ''}
          style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 'var(--r-md)', boxShadow: '0 10px 40px rgba(0,0,0,.4)' }} />
      </div>

      <button className="glass" aria-label="Zamknij kolaż" title="Zamknij (Esc)" onClick={onClose}
        style={{ position: 'absolute', left: 12, top: 'calc(12px + var(--sat))', width: 'var(--bar-h)', height: 'var(--bar-h)', padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}><X size={20} /></button>
      <div className="glass" style={{ position: 'absolute', left: 'calc(24px + var(--bar-h))', top: 'calc(12px + var(--sat))', height: 'var(--bar-h)', padding: '0 18px', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <b>Kolaż</b><span style={{ color: 'var(--muted)', fontSize: 13 }}>{items.length} {pl(items.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}{photos.length > MAX_PHOTOS ? ` (maks. ${MAX_PHOTOS})` : ''}</span>
      </div>

      <aside className="glass flex flex-col" style={{ margin: 12, width: 'min(92vw,360px)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginTop: 'calc(70px + var(--sat))' }}>
        <div className="sheet-body" style={{ paddingTop: 12 }}>
          <h2 className="sec-h" style={{ margin: '0 2px' }}>Ustawienia kolażu</h2>
          <section className="sec">
            <label style={{ marginTop: 0 }}>Układ</label>
            <div className="chips">{LAYOUTS.map((l) => <Chip key={l.id} on={layout === l.id} onClick={() => setLayout(l.id)}>{l.label}</Chip>)}</div>
            {layout === 'pile' && <button className="wide" onClick={() => setSeed((s) => s + 1)}><Shuffle size={16} /> Przemieszaj</button>}
          </section>
          <section className="sec">
            <label style={{ marginTop: 0 }}>Proporcje płótna</label>
            <div className="chips">{FORMATS.map((f, i) => <Chip key={f.label} on={format === i} onClick={() => setFormat(i)}>{f.label}</Chip>)}</div>
            <label>Tło</label>
            <div className="chips">{BACKGROUNDS.map((b, i) => <Chip key={b.label} on={bgIdx === i} onClick={() => setBgIdx(i)}><i style={{ width: 12, height: 12, borderRadius: 4, background: b.v, border: '1px solid var(--line)' }} />{b.label}</Chip>)}</div>
          </section>
          <section className="sec">
            <label htmlFor="gap" style={{ marginTop: 0 }}>Odstęp: {gap} px</label>
            <input id="gap" type="range" min={0} max={40} value={gap} onChange={(e) => setGap(+e.target.value)} />
            {layout !== 'pile' && layout !== 'exposure' && (<>
              <label htmlFor="rad">Zaokrąglenie rogów: {radius} px</label>
              <input id="rad" type="range" min={0} max={40} value={radius} onChange={(e) => setRadius(+e.target.value)} />
            </>)}
          </section>
        </div>
        <div className="sheet-foot">
          <button className="primary" disabled={loading || saving || !items.length} onClick={save}>
            <span className="inline-flex items-center gap-2"><Save size={17} /> {saving ? 'Zapisywanie…' : 'Zapisz kolaż'}</span>
          </button>
          <p style={{ margin: '8px 2px 0', fontSize: 12.5, color: 'var(--muted)' }}>Powstaje nowy plik JPG obok pierwszego zdjęcia. Oryginały zostają bez zmian.</p>
        </div>
      </aside>
    </div>
  )
}
