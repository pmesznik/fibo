import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Photo } from './api'

/**
 * Ile wierszy siatki obsługuje jeden obserwator. Dawniej każdy wiersz miał własny: przy 100 tysiącach zdjęć to ok. 20 tysięcy komponentów
 * i obserwatorów tworzonych przy każdym powrocie do biblioteki, stąd przycięcia przy przełączaniu widoków.
 */
const ROWS_PER_BLOCK = 24

/** Blok wierszy montowany dopiero w pobliżu ekranu; poza nim zostaje pusty o tej samej wysokości, więc tysiące zdjęć nie obciążają okna. */
function LazyBlock({ height, children }: { height: number; children: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} style={{ height, contain: 'layout' }}>{near ? children() : null}</div>
}

/** Dzieli wiersze na bloki i liczy wysokość każdego bloku (wiersze plus odstępy między nimi). */
function blocks<T>(rows: T[], heightOf: (row: T) => number, gap: number): { rows: T[]; height: number; first: number }[] {
  const out: { rows: T[]; height: number; first: number }[] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_BLOCK) {
    const part = rows.slice(i, i + ROWS_PER_BLOCK)
    out.push({ rows: part, first: i, height: part.reduce((s, r) => s + heightOf(r), 0) + gap * (part.length - 1) })
  }
  return out
}

/** Siatka wierszy o równej wysokości: każde zdjęcie zachowuje swoje proporcje. */
export function Justified({ photos, rowHeight, gap = 12, children }: {
  photos: Photo[]
  rowHeight: number
  gap?: number
  children: (photo: Photo, w: number, h: number) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    setWidth(Math.floor(el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const parts = useMemo(() => {
    if (!width) return []
    const out: { items: { p: Photo; r: number }[]; h: number }[] = []
    let cur: { p: Photo; r: number }[] = []
    let sum = 0
    for (const p of photos) {
      // Zdjęcia bez znanych wymiarów traktujemy jak 4:3; skrajne proporcje ograniczamy.
      const r = Math.min(3, Math.max(0.4, p.width && p.height ? p.width / p.height : 4 / 3))
      cur.push({ p, r }); sum += r
      if (sum * rowHeight + gap * (cur.length - 1) >= width) {
        out.push({ items: cur, h: (width - gap * (cur.length - 1)) / sum })
        cur = []; sum = 0
      }
    }
    // Ostatni wiersz zostaje w docelowej wysokości, żeby jedno zdjęcie nie rozciągało się na całą szerokość.
    if (cur.length) out.push({ items: cur, h: Math.min(rowHeight, (width - gap * (cur.length - 1)) / sum) })
    return blocks(out, (r) => r.h, gap)
  }, [photos, width, rowHeight, gap])

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {parts.map((b) => (
        <LazyBlock key={b.first} height={b.height}>
          {() => (
            <div style={{ display: 'flex', flexDirection: 'column', gap }}>
              {b.rows.map((row, i) => (
                <div key={b.first + i} style={{ display: 'flex', gap, height: row.h }}>
                  {row.items.map(({ p, r }) => (
                    <div key={p.id} style={{ width: r * row.h, height: row.h, flex: 'none' }}>{children(p, r * row.h, row.h)}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </LazyBlock>
      ))}
    </div>
  )
}

/** Siatka kafelków 4:3 o równej szerokości. Montuje tylko bloki wierszy w pobliżu ekranu (jak `Justified`), więc 10 tysięcy zdjęć w jednej sekcji nie tworzy 10 tysięcy elementów. */
export function VirtualGrid({ photos, size, gap = 12, children }: {
  photos: Photo[]
  /** Najmniejsza szerokość kafelka; faktyczna jest nieco większa, żeby wiersz wypełnił szerokość. */
  size: number
  gap?: number
  children: (photo: Photo) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    setWidth(Math.floor(el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const cols = Math.max(1, Math.floor((width + gap) / (size + gap)))
  const cellW = width ? (width - gap * (cols - 1)) / cols : 0
  const cellH = cellW * 0.75
  const parts = useMemo(() => {
    const out: Photo[][] = []
    for (let i = 0; i < photos.length; i += cols) out.push(photos.slice(i, i + cols))
    return blocks(out, () => cellH, gap)
  }, [photos, cols, cellH, gap])

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {width > 0 && parts.map((b) => (
        <LazyBlock key={b.first} height={b.height}>
          {() => (
            <div style={{ display: 'flex', flexDirection: 'column', gap }}>
              {b.rows.map((row, i) => (
                <div key={b.first + i} style={{ display: 'flex', gap, height: cellH }}>
                  {row.map((p) => (
                    <div key={p.id} style={{ width: cellW, height: cellH, flex: 'none', display: 'grid' }}>{children(p)}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </LazyBlock>
      ))}
    </div>
  )
}
