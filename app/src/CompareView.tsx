import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Check, Maximize2 } from './FiboIcons'
import { decodeBitmap } from './imageDecode'
import { readImage, setFlag, setLabel, type Photo } from './api'
import { LABELS, flagOf, labelOf, nextMark } from './marks'
import { useEscape } from './ui'

/** Dłuższy bok obrazu w oknie porównania: wystarcza do oceny ostrości przy dużym powiększeniu, a cztery zdjęcia naraz nie zajmują gigabajtów. */
const MAX_SIDE = 3200
const MAX_ZOOM = 16

type View = { cx: number; cy: number; z: number }

/** Skala „dopasuj do okna” dla obrazu w polu o wymiarach w x h. */
const fitScale = (bw: number, bh: number, w: number, h: number) => Math.min(w / bw, h / bh)

/** Jedno pole: obraz rysowany na płótnie według wspólnego widoku (środek w współrzędnych 0 do 1 i powiększenie względem „dopasuj”). */
function Pane({ photo, bmp, view, active, index, onView, onActivate, onFlag }: {
  photo: Photo
  bmp: ImageBitmap | null
  view: View
  active: boolean
  index: number
  onView: (v: View) => void
  onActivate: () => void
  onFlag: (f: 1 | -1 | 0) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = canvas.current
    if (!c || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, c.width, c.height)
    if (!bmp) return
    const s = fitScale(bmp.width, bmp.height, size.w, size.h) * view.z
    const dw = bmp.width * s, dh = bmp.height * s
    g.imageSmoothingEnabled = view.z < 2.5
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, (size.w / 2 - view.cx * dw) * dpr, (size.h / 2 - view.cy * dh) * dpr, dw * dpr, dh * dpr)
  }, [bmp, view, size])

  const onWheel = (e: React.WheelEvent) => {
    if (!bmp || !size.w) return
    const v = viewRef.current
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - rect.left - size.w / 2, my = e.clientY - rect.top - size.h / 2
    const z = Math.min(MAX_ZOOM, Math.max(1, v.z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
    const base = fitScale(bmp.width, bmp.height, size.w, size.h)
    // Punkt pod kursorem zostaje pod kursorem.
    const px = v.cx + mx / (bmp.width * base * v.z), py = v.cy + my / (bmp.height * base * v.z)
    onView(z === 1 ? { cx: 0.5, cy: 0.5, z: 1 } : { cx: clamp01(px - mx / (bmp.width * base * z)), cy: clamp01(py - my / (bmp.height * base * z)), z })
  }
  const onDown = (e: React.PointerEvent) => {
    onActivate()
    if (!bmp || viewRef.current.z <= 1) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, cx: viewRef.current.cx, cy: viewRef.current.cy }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !bmp) return
    const base = fitScale(bmp.width, bmp.height, size.w, size.h) * viewRef.current.z
    onView({ ...viewRef.current, cx: clamp01(d.cx - (e.clientX - d.x) / (bmp.width * base)), cy: clamp01(d.cy - (e.clientY - d.y) / (bmp.height * base)) })
  }
  const onUp = () => { drag.current = null }
  const onDouble = () => {
    if (!bmp || !size.w) return
    const v = viewRef.current
    // Podwójne kliknięcie: przybliżenie do 100% (jeden piksel zdjęcia na jeden piksel ekranu), a ponowne wraca do „dopasuj”.
    const z100 = Math.min(MAX_ZOOM, Math.max(1, 1 / fitScale(bmp.width, bmp.height, size.w, size.h)))
    onView(v.z > 1.01 ? { cx: 0.5, cy: 0.5, z: 1 } : { ...v, z: z100 })
  }

  const flag = flagOf(photo), label = labelOf(photo)
  return (
    <div className="relative min-h-0 min-w-0 overflow-hidden" style={{ borderRadius: 'var(--r-md)', background: '#0b0b10', outline: active ? '3px solid var(--accent)' : '1px solid var(--glass-line)', outlineOffset: active ? -3 : -1 }}>
      <div ref={box} className="absolute inset-0" style={{ cursor: view.z > 1 ? 'grab' : 'zoom-in', touchAction: 'none' }}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}>
        <canvas ref={canvas} role="img" aria-label={`Zdjęcie ${index + 1}: ${photo.name}`} style={{ width: '100%', height: '100%', display: 'block' }} />
        {!bmp && <div className="empty" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>Wczytywanie…</div>}
      </div>
      <div className="glass" style={{ position: 'absolute', left: 8, top: 8, maxWidth: 'calc(100% - 16px)', padding: '4px 10px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <b style={{ color: 'var(--accent)' }}>{index + 1}</b>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{photo.name}</span>
        {label !== 0 && <span aria-label={`Etykieta ${LABELS[label - 1].name}`} style={{ width: 12, height: 12, borderRadius: '50%', background: LABELS[label - 1].css, flex: 'none' }} />}
        {flag === 1 && <span aria-label="Wybrane" style={{ color: '#30a46c', display: 'inline-flex' }}><Check size={15} strokeWidth={3} /></span>}
        {flag === -1 && <span aria-label="Odrzucone" style={{ color: '#e5484d', display: 'inline-flex' }}><X size={15} strokeWidth={3} /></span>}
      </div>
      <div className="glass" style={{ position: 'absolute', left: 8, bottom: 8, padding: 4, borderRadius: 99, display: 'flex', gap: 4 }}>
        <button className={`chip${flag === 1 ? ' on' : ''}`} style={{ minHeight: 30 }} aria-pressed={flag === 1} title="Wybierz (P)" onClick={() => { onActivate(); onFlag(1) }}><Check size={14} /> Wybierz</button>
        <button className={`chip${flag === -1 ? ' on' : ''}`} style={{ minHeight: 30 }} aria-pressed={flag === -1} title="Odrzuć (X)" onClick={() => { onActivate(); onFlag(-1) }}><X size={14} /> Odrzuć</button>
      </div>
      <div className="glass" style={{ position: 'absolute', right: 8, bottom: 8, padding: '4px 10px', borderRadius: 99, fontSize: 12.5, color: 'var(--muted)' }}>
        {photo.width && photo.height ? `${photo.width}×${photo.height}` : ''}{photo.camera ? ` · ${photo.camera}` : ''}
      </div>
    </div>
  )
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Porównanie 2 do 4 zdjęć obok siebie. Powiększenie i przesuwanie są wspólne: ten sam fragment (w proporcjach zdjęcia) widać w każdym polu,
 * więc łatwo ocenić, które z serii jest ostrzejsze. Klawisze: 1 do 4 wybierają pole, P wybierz, X odrzuć, U zdejmij flagę, 6 do 9 etykiety,
 * + i - powiększenie, 0 dopasowanie, Esc zamyka.
 */
export function CompareView({ photos, onClose, onPatch, say }: {
  photos: Photo[]
  onClose: () => void
  onPatch: (id: number, change: Partial<Photo>) => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const [bitmaps, setBitmaps] = useState<(ImageBitmap | null)[]>(() => photos.map(() => null))
  const [view, setView] = useState<View>({ cx: 0.5, cy: 0.5, z: 1 })
  const [active, setActive] = useState(0)
  const idsKey = photos.map((p) => p.id).join(',')
  const loaded = useRef<ImageBitmap[]>([])

  useEffect(() => {
    let dead = false
    setBitmaps(photos.map(() => null))
    photos.forEach((p, i) => {
      readImage(p.id)
        .then((buf) => decodeBitmap(buf, p.name))
        .then(async (full) => {
          const s = Math.min(1, MAX_SIDE / Math.max(full.width, full.height))
          const bmp = s < 1 ? await createImageBitmap(full, { resizeWidth: Math.round(full.width * s), resizeHeight: Math.round(full.height * s), resizeQuality: 'high' }) : full
          if (bmp !== full) full.close()
          if (dead) { bmp.close(); return }
          loaded.current.push(bmp)
          setBitmaps((list) => list.map((b, k) => (k === i ? bmp : b)))
        })
        .catch((e) => { if (!dead) say(`Nie udało się wczytać ${p.name}: ${e}`, 'err') })
    })
    return () => { dead = true; loaded.current.forEach((b) => b.close()); loaded.current = [] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const zoomBy = useCallback((f: number) => setView((v) => { const z = Math.min(MAX_ZOOM, Math.max(1, v.z * f)); return z === 1 ? { cx: 0.5, cy: 0.5, z: 1 } : { ...v, z } }), [])

  const mark = (index: number, kind: 'flag' | 'label', wanted: number) => {
    const p = photos[index]
    if (!p) return
    const next = nextMark([kind === 'flag' ? flagOf(p) : labelOf(p)], wanted)
    if (kind === 'flag') { onPatch(p.id, { flag: next }); setFlag([p.id], next).catch((e) => say(`Nie udało się zapisać flagi: ${e}`, 'err')) }
    else { onPatch(p.id, { label: next }); setLabel([p.id], next).catch((e) => say(`Nie udało się zapisać etykiety: ${e}`, 'err')) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key
      if (/^[1-4]$/.test(k) && +k <= photos.length) setActive(+k - 1)
      else if (k === '0') setView({ cx: 0.5, cy: 0.5, z: 1 })
      else if (k === '+' || k === '=') zoomBy(1.4)
      else if (k === '-' || k === '_') zoomBy(1 / 1.4)
      else if (k.toLowerCase() === 'p') mark(active, 'flag', 1)
      else if (k.toLowerCase() === 'x') mark(active, 'flag', -1)
      else if (k.toLowerCase() === 'u') mark(active, 'flag', 0)
      else if (/^[6-9]$/.test(k)) mark(active, 'label', +k - 5)
      else if (k === 'ArrowRight') setActive((a) => Math.min(photos.length - 1, a + 1))
      else if (k === 'ArrowLeft') setActive((a) => Math.max(0, a - 1))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, photos, zoomBy])

  const n = photos.length
  return (
    <div className="fixed inset-0 z-[1500] flex flex-col" style={{ background: 'var(--bg)' }} role="dialog" aria-modal="true" aria-label="Porównanie zdjęć">
      <div style={{ padding: 'calc(76px + var(--sat)) 12px 12px 12px', flex: 1, minHeight: 0, display: 'grid', gap: 10, gridTemplateColumns: n === 3 ? 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' : n === 4 ? 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' : 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gridAutoRows: 'minmax(0, 1fr)' }}>
        {photos.map((p, i) => (
          <Pane key={p.id} photo={p} bmp={bitmaps[i] ?? null} view={view} active={active === i} index={i}
            onView={setView} onActivate={() => setActive(i)} onFlag={(f) => mark(i, 'flag', f)} />
        ))}
      </div>

      <button className="glass" aria-label="Zamknij porównanie" title="Zamknij (Esc)" onClick={onClose}
        style={{ position: 'absolute', left: 12, top: 'calc(12px + var(--sat))', width: 'var(--bar-h)', height: 'var(--bar-h)', padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>
        <X size={22} />
      </button>
      <div className="glass" style={{ position: 'absolute', left: 'calc(24px + var(--bar-h))', top: 'calc(12px + var(--sat))', height: 'var(--bar-h)', padding: '0 14px', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 10, maxWidth: 'calc(100vw - 100px)', overflowX: 'auto' }}>
        <b>Porównanie</b>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{Math.round(view.z * 100)}%</span>
        <button className="chip" onClick={() => setView({ cx: 0.5, cy: 0.5, z: 1 })} title="Dopasuj do okna (0)"><Maximize2 size={14} /> Dopasuj</button>
        <button className="chip" onClick={() => zoomBy(1.4)} aria-label="Powiększ" title="Powiększ (+)">+</button>
        <button className="chip" onClick={() => zoomBy(1 / 1.4)} aria-label="Pomniejsz" title="Pomniejsz (-)">−</button>
        <span title="Klawisze: 1 do 4 wybierają pole, P wybierz, X odrzuć, U zdejmij flagę, 6 do 9 etykiety, + i - powiększenie, 0 dopasowanie" style={{ color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'nowrap' }}>Kółko i przeciąganie działają we wszystkich polach</span>
      </div>
    </div>
  )
}
