import { useEffect, useMemo, useRef, useState } from 'react'

export type RailSection = { key: string; title: string; year: string; count: number }

/**
 * Oś czasu przy prawej krawędzi: pionowy suwak, na którym wysokość odcinka odpowiada liczbie zdjęć z danego okresu (gęste lata mają więcej miejsca).
 * Przeciągnięcie, kliknięcie lub strzałki skaczą do okresu, a uchwyt podąża za przewijaniem. Nie zajmuje miejsca w układzie i blaknie, gdy nie jest używana.
 */
export function TimelineRail({ sections, active, onJump }: { sections: RailSection[]; active: number; onJump: (index: number) => void }) {
  const rail = useRef<HTMLDivElement>(null)
  const lastJump = useRef(-1)
  const [drag, setDrag] = useState(false)
  const [hover, setHover] = useState(false)
  const [recent, setRecent] = useState(false)

  const total = Math.max(1, sections.reduce((s, x) => s + x.count, 0))
  // Początek każdego okresu jako ułamek wysokości osi (od najnowszego u góry).
  const starts = useMemo(() => {
    let c = 0
    return sections.map((s) => { const at = c / total; c += s.count; return at })
  }, [sections, total])
  const mid = (i: number) => (starts[i] + (starts[i + 1] ?? 1)) / 2

  // Znaczniki lat: pierwszy okres każdego roku, ale nie gęściej niż co ok. 4% wysokości, żeby napisy na siebie nie nachodziły.
  const ticks = useMemo(() => {
    const out: { i: number; year: string; at: number }[] = []
    sections.forEach((s, i) => {
      if (i > 0 && s.year === sections[i - 1].year) return
      if (out.length && starts[i] - out[out.length - 1].at < 0.04) return
      out.push({ i, year: s.year, at: starts[i] })
    })
    return out
  }, [sections, starts])

  // Uchwyt jest wyraźny chwilę po przewinięciu strony albo gdy użytkownik z niego korzysta.
  useEffect(() => {
    setRecent(true)
    const t = window.setTimeout(() => setRecent(false), 1400)
    return () => window.clearTimeout(t)
  }, [active])

  const indexAt = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || r.height <= 0) return active
    const f = Math.min(0.9999, Math.max(0, (clientY - r.top) / r.height))
    let i = 0
    for (let k = 0; k < starts.length; k++) if (starts[k] <= f) i = k
    return i
  }
  const jump = (i: number) => {
    if (i === lastJump.current) return
    lastJump.current = i
    onJump(i)
  }

  const visible = drag || hover || recent
  const label = sections[Math.min(active, sections.length - 1)]?.title ?? ''

  return (
    <div
      ref={rail}
      className={`tl-rail${visible ? ' tl-on' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Oś czasu: przeciągnij, aby przejść do innego okresu"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, sections.length - 1)}
      aria-valuenow={Math.min(active, sections.length - 1)}
      aria-valuetext={label}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); lastJump.current = -1; jump(indexAt(e.clientY)) }}
      onPointerMove={(e) => { if (drag) jump(indexAt(e.clientY)) }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDrag(false) }}
      onPointerCancel={() => setDrag(false)}
      onKeyDown={(e) => {
        const last = sections.length - 1
        const to = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? active - 1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? active + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
        if (to === null) return
        e.preventDefault(); lastJump.current = -1; jump(Math.min(last, Math.max(0, to)))
      }}
    >
      <div className="tl-track" aria-hidden />
      {ticks.map((t) => (
        <span key={t.i} className="tl-tick" aria-hidden style={{ top: `${t.at * 100}%` }}>{t.year}</span>
      ))}
      <div className="tl-handle" aria-hidden style={{ top: `${mid(Math.min(active, sections.length - 1)) * 100}%` }}>
        <span className="tl-bubble">{label}</span>
      </div>
    </div>
  )
}
