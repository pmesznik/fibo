import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Photo } from './api'

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
        <div key={i} style={{ display: 'flex', gap, height: row.h }}>
          {row.items.map(({ p, r }) => (
            <div key={p.id} style={{ width: r * row.h, height: row.h, flex: 'none' }}>{children(p, r * row.h, row.h)}</div>
          ))}
        </div>
      ))}
    </div>
  )
}
