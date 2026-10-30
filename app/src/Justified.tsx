import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Photo } from './api'

/** Wiersz montowany dopiero w pobliżu ekranu; poza nim zostaje pusty o tej samej wysokości, więc tysiące zdjęć nie obciążają przeglądarki. */
function LazyRow({ height, gap, children }: { height: number; gap: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} style={{ display: 'flex', gap, height }}>{near ? children : null}</div>
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

  const rows = useMemo(() => {
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
    return out
  }, [photos, width, rowHeight, gap])

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {rows.map((row, i) => (
        <LazyRow key={i} height={row.h} gap={gap}>
          {row.items.map(({ p, r }) => (
            <div key={p.id} style={{ width: r * row.h, height: row.h, flex: 'none' }}>{children(p, r * row.h, row.h)}</div>
          ))}
        </LazyRow>
      ))}
    </div>
  )
}

/** Siatka kafelków 4:3 o równej szerokości. Montuje tylko wiersze w pobliżu ekranu (jak `Justified`), więc 10 tysięcy zdjęć w jednej sekcji nie tworzy 10 tysięcy elementów. */
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
  const rows = useMemo(() => {
    const out: Photo[][] = []
    for (let i = 0; i < photos.length; i += cols) out.push(photos.slice(i, i + cols))
    return out
  }, [photos, cols])

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {width > 0 && rows.map((row, i) => (
        <LazyRow key={i} height={cellH} gap={gap}>
          {row.map((p) => (
            <div key={p.id} style={{ width: cellW, height: cellH, flex: 'none', display: 'grid' }}>{children(p)}</div>
          ))}
        </LazyRow>
      ))}
    </div>
  )
}
