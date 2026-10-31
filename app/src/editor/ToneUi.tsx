import { useEffect, useRef, useState } from 'react'
import { MAX_CURVE_POINTS, HSL_BANDS, cleanPoints, curveIsIdentity, curveLut, histogram, type CurvePt, type Curves, type Hsl, EMPTY_CURVES, EMPTY_HSL, type Histogram } from './tone'

/** Histogram na żywo: jasność (szarym) i kanały R, G, B (kolorami), liczony z obrazu na ekranie. */
export function HistogramView({ source, version }: { source: HTMLCanvasElement | null; version: unknown }) {
  const [h, setH] = useState<Histogram | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!source || source.width < 2) return
      try {
        const ctx = source.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        const w = Math.min(source.width, 256), hh = Math.min(source.height, 256)
        const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = hh
        tmp.getContext('2d')!.drawImage(source, 0, 0, w, hh)
        setH(histogram({ d: tmp.getContext('2d')!.getImageData(0, 0, w, hh).data }))
      } catch { /* obraz niedostępny */ }
    }, 180)
    return () => window.clearTimeout(t)
  }, [source, version])
  if (!h) return null
  // Skala: bez skrajnych przedziałów (0 i 255), które często są ogromne i spłaszczają resztę.
  const max = Math.max(1, ...h.l.slice(1, 255), ...h.r.slice(1, 255), ...h.g.slice(1, 255), ...h.b.slice(1, 255))
  const path = (a: number[]) => `M0,100 ${a.map((v, i) => `L${i},${100 - Math.min(100, (v / max) * 96)}`).join(' ')} L255,100 Z`
  return (
    <svg viewBox="0 0 255 100" role="img" aria-label="Histogram jasności i kolorów" style={{ width: '100%', height: 84, background: 'var(--tonal)', borderRadius: 8, display: 'block', margin: '4px 0 8px' }} preserveAspectRatio="none">
      <path d={path(h.b)} fill="rgba(60,120,255,.45)" />
      <path d={path(h.g)} fill="rgba(60,200,100,.45)" />
      <path d={path(h.r)} fill="rgba(240,70,70,.45)" />
      <path d={path(h.l)} fill="none" stroke="currentColor" strokeWidth="1" opacity=".7" />
    </svg>
  )
}

const CHANNELS: { id: keyof Curves; label: string; color: string }[] = [
  { id: 'rgb', label: 'Jasność', color: '#cccccc' }, { id: 'r', label: 'Czerwony', color: '#ef5350' }, { id: 'g', label: 'Zielony', color: '#43a047' }, { id: 'b', label: 'Niebieski', color: '#42a5f5' },
]

/** Edytor krzywych: kliknij na krzywej, żeby dodać punkt, przeciągnij, żeby go przesunąć, dwuklik albo klawisz Delete usuwa punkt, strzałki przesuwają o 2. */
export function CurveEditor({ value, onChange, onStart }: { value: Curves | undefined; onChange: (c: Curves | undefined) => void; onStart: () => void }) {
  const [ch, setCh] = useState<keyof Curves>('rgb')
  const curves = value ?? EMPTY_CURVES
  const pts = curves[ch]
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const color = CHANNELS.find((c) => c.id === ch)!.color

  const commit = (next: CurvePt[]) => {
    const c: Curves = { ...EMPTY_CURVES, ...curves, [ch]: next }
    onChange(CHANNELS.every((k) => curveIsIdentity(c[k.id])) ? undefined : c)
  }
  const at = (e: { clientX: number; clientY: number }): CurvePt => {
    const r = svg.current!.getBoundingClientRect()
    return [Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))), Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255)))]
  }
  const down = (e: React.PointerEvent) => {
    if (pts.length >= MAX_CURVE_POINTS) return
    onStart()
    const p = at(e)
    const next = cleanPoints([...pts, p])
    commit(next)
    drag.current = next.findIndex((q) => q[0] === p[0])
    svg.current?.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    if (drag.current === null) return
    const p = at(e), i = drag.current
    const lo = i > 0 ? pts[i - 1][0] + 1 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - 1 : 255
    commit(pts.map((q, k) => (k === i ? [Math.min(hi, Math.max(lo, p[0])), p[1]] : q)) as CurvePt[])
  }
  const up = () => { drag.current = null }
  const grab = (e: React.PointerEvent, i: number) => { e.stopPropagation(); onStart(); drag.current = i; svg.current?.setPointerCapture(e.pointerId) }
  const remove = (i: number) => { onStart(); commit(pts.filter((_, k) => k !== i)) }
  const key = (e: React.KeyboardEvent, i: number) => {
    const step = e.shiftKey ? 8 : 2
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); return }
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
    if (!dx && !dy) return
    e.preventDefault(); onStart()
    const lo = i > 0 ? pts[i - 1][0] + 1 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - 1 : 255
    commit(pts.map((q, k) => (k === i ? [Math.min(hi, Math.max(lo, q[0] + dx)), Math.min(255, Math.max(0, q[1] + dy))] : q)) as CurvePt[])
  }
  const lut = curveLut(pts)
  const line = Array.from({ length: 64 }, (_, k) => { const x = Math.round((k / 63) * 255); return `${k ? 'L' : 'M'}${x},${255 - lut[x]}` }).join(' ')

  return (
    <div>
      <div className="chips" role="group" aria-label="Kanał krzywej" style={{ marginBottom: 6 }}>
        {CHANNELS.map((c) => <button key={c.id} className={`chip${ch === c.id ? ' on' : ''}`} aria-pressed={ch === c.id} onClick={() => setCh(c.id)}>{c.label}{!curveIsIdentity(curves[c.id]) && ' •'}</button>)}
      </div>
      <svg ref={svg} viewBox="0 0 255 255" role="group" aria-label={`Krzywa: ${CHANNELS.find((c) => c.id === ch)!.label}. Kliknij, aby dodać punkt.`}
        style={{ width: '100%', maxWidth: 260, aspectRatio: '1', background: 'var(--tonal)', borderRadius: 8, touchAction: 'none', cursor: 'crosshair', display: 'block' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {[64, 128, 192].map((v) => <g key={v} stroke="currentColor" opacity=".12"><line x1={v} y1="0" x2={v} y2="255" /><line x1="0" y1={v} x2="255" y2={v} /></g>)}
        <line x1="0" y1="255" x2="255" y2="0" stroke="currentColor" opacity=".25" strokeDasharray="4 4" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" />
        {pts.map((p, i) => (
          <circle key={`${p[0]}-${i}`} cx={p[0]} cy={255 - p[1]} r="7" fill={color} stroke="#000" strokeOpacity=".5" tabIndex={0} role="button"
            aria-label={`Punkt krzywej ${i + 1}: wejście ${p[0]}, wyjście ${p[1]}. Strzałki przesuwają, Delete usuwa.`}
            onPointerDown={(e) => grab(e, i)} onDoubleClick={() => remove(i)} onKeyDown={(e) => key(e, i)} style={{ cursor: 'grab' }} />
        ))}
      </svg>
      <div className="chips" style={{ marginTop: 6 }}>
        <button className="chip" disabled={curveIsIdentity(pts)} onClick={() => { onStart(); commit([]) }}>Zeruj tę krzywą</button>
        <button className="chip" disabled={!value} onClick={() => { onStart(); onChange(undefined) }}>Zeruj wszystkie</button>
        <button className="chip" onClick={() => { onStart(); commit([[64, 52], [192, 204]]) }}>Kontrast S</button>
      </div>
    </div>
  )
}

/** Kolor według zakresów barw: wybór zakresu i trzy suwaki (barwa, nasycenie, jasność). */
export function HslPanel({ value, onChange, onStart, Slider }: {
  value: Hsl | undefined
  onChange: (h: Hsl | undefined) => void
  onStart: () => void
  Slider: (p: { label: string; value: number; min: number; max: number; onStart: () => void; onChange: (v: number) => void }) => React.ReactElement
}) {
  const [band, setBand] = useState(0)
  const hsl = value ?? EMPTY_HSL
  const set = (key: 'hue' | 'sat' | 'lum', v: number) => {
    const next: Hsl = { hue: [...hsl.hue], sat: [...hsl.sat], lum: [...hsl.lum] }
    next[key][band] = v
    onChange([next.hue, next.sat, next.lum].every((a) => a.every((x) => !x)) ? undefined : next)
  }
  const dot = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#7e57c2', '#d81b60']
  return (
    <div>
      <div className="chips" role="group" aria-label="Zakres barw" style={{ marginBottom: 6 }}>
        {HSL_BANDS.map((n, i) => (
          <button key={n} className={`chip${band === i ? ' on' : ''}`} aria-pressed={band === i} onClick={() => setBand(i)}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: dot[i], display: 'inline-block' }} /> {n}{(hsl.hue[i] || hsl.sat[i] || hsl.lum[i]) ? ' •' : ''}
          </button>
        ))}
      </div>
      <Slider label="Barwa" value={hsl.hue[band]} min={-100} max={100} onStart={onStart} onChange={(v) => set('hue', v)} />
      <Slider label="Nasycenie" value={hsl.sat[band]} min={-100} max={100} onStart={onStart} onChange={(v) => set('sat', v)} />
      <Slider label="Jasność" value={hsl.lum[band]} min={-100} max={100} onStart={onStart} onChange={(v) => set('lum', v)} />
      <button className="chip" style={{ marginTop: 6 }} disabled={!value} onClick={() => { onStart(); onChange(undefined) }}>Zeruj kolor HSL</button>
    </div>
  )
}
