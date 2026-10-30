import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from './FiboIcons'
import { MONTHS, MONTHS_SHORT, dayNames, isSundayCol, monthGrid } from './calendarData'
import { indexByDay, keyOf, latestMonth, monthCounts, yearsWithPhotos } from './dayIndex'
import { pl } from './pl'
import { Thumb } from './Thumb'
import { useEscape } from './ui'
import type { Photo } from './api'

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']

/**
 * Widok kalendarza biblioteki: miesiąc w siatce, w każdym dniu miniatura pierwszego zdjęcia i liczba zdjęć.
 * Kliknięcie dnia pokazuje zdjęcia z tego dnia. Wszystko liczy się lokalnie z dat zdjęć.
 */
export function LibraryCalendar({ photos, onOpenDay, onClose }: {
  photos: Photo[]
  onOpenDay: (ids: number[], title: string) => void
  onClose: () => void
}) {
  useEscape(onClose)
  const index = useMemo(() => indexByDay(photos), [photos])
  const years = useMemo(() => yearsWithPhotos(index), [index])
  const [cur, setCur] = useState(() => latestMonth(index))
  const counts = useMemo(() => monthCounts(index, cur.year), [index, cur.year])
  const grid = useMemo(() => monthGrid(cur.year, cur.month, 'mon'), [cur])
  const names = dayNames('mon')
  const total = counts.reduce((a, b) => a + b, 0)
  const step = (d: number) => setCur((c) => {
    const m = c.month - 1 + d
    return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 }
  })

  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[94vh] w-[min(96vw,860px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Widok kalendarza zdjęć" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><CalendarDays size={18} /> Zdjęcia w kalendarzu</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <div className="flex items-center gap-2" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
            <button className="ico" aria-label="Poprzedni miesiąc" onClick={() => step(-1)}><ChevronLeft size={22} /></button>
            <b style={{ fontSize: 18, minWidth: 170, textAlign: 'center' }} aria-live="polite">{MONTHS[cur.month - 1]} {cur.year}</b>
            <button className="ico" aria-label="Następny miesiąc" onClick={() => step(1)}><ChevronRight size={22} /></button>
            {years.length > 0 && (
              <select aria-label="Rok" value={years.includes(cur.year) ? cur.year : ''} onChange={(e) => setCur({ year: +e.target.value, month: cur.month })} style={{ marginLeft: 'auto', width: 'auto' }}>
                {!years.includes(cur.year) && <option value="">{cur.year}</option>}
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
          <div className="chips" role="group" aria-label="Miesiące roku" style={{ marginBottom: 10 }}>
            {MONTHS_SHORT.map((m, i) => (
              <button key={m} className={`chip${cur.month === i + 1 ? ' on' : ''}`} aria-pressed={cur.month === i + 1} disabled={counts[i] === 0 && cur.month !== i + 1} onClick={() => setCur({ year: cur.year, month: i + 1 })}
                aria-label={`${MONTHS[i]}: ${counts[i]} ${pl(counts[i], 'zdjęcie', 'zdjęcia', 'zdjęć')}`}>{m} <small style={{ color: 'var(--muted)' }}>{counts[i] || ''}</small></button>
            ))}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>
            {total > 0 ? `${total} ${pl(total, 'zdjęcie', 'zdjęcia', 'zdjęć')} w ${cur.year} roku, w tym miesiącu ${counts[cur.month - 1]}` : `W ${cur.year} roku nie ma zdjęć`}
          </div>
          <div role="grid" aria-label={`${MONTHS[cur.month - 1]} ${cur.year}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
            {names.map((n, c) => <div key={n} role="columnheader" style={{ textAlign: 'center', fontSize: 12, color: isSundayCol(c, 'mon') ? 'var(--err)' : 'var(--muted)' }}>{n}</div>)}
            {grid.flat().map((d, i) => {
              if (d === null) return <div key={`e${i}`} role="gridcell" aria-hidden="true" />
              const list = index.get(keyOf(cur.year, cur.month, d))
              const sunday = isSundayCol(i % 7, 'mon')
              if (!list) {
                return <div key={d} role="gridcell" style={{ aspectRatio: '1', borderRadius: 8, background: 'var(--tonal)', opacity: 0.55, padding: 4, fontSize: 12, color: sunday ? 'var(--err)' : 'var(--muted)' }}>{d}</div>
              }
              return (
                <button key={d} role="gridcell" className="bare relative overflow-hidden" style={{ aspectRatio: '1', borderRadius: 8, boxShadow: 'var(--elev-1)' }}
                  aria-label={`${d} ${MONTHS_GEN[cur.month - 1]}: ${list.length} ${pl(list.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`} title={`Pokaż zdjęcia z dnia ${d} ${MONTHS_GEN[cur.month - 1]}`}
                  onClick={() => { onOpenDay(list.map((p) => p.id), `${d} ${MONTHS_GEN[cur.month - 1]} ${cur.year}`); onClose() }}>
                  <Thumb photo={list[0]} />
                  <span className="absolute left-1 top-1 rounded px-1" style={{ background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 12, fontWeight: 700 }}>{d}</span>
                  {list.length > 1 && <span className="absolute bottom-1 right-1 rounded-full px-1.5" style={{ background: 'var(--accent)', color: '#fff', fontSize: 11.5, fontWeight: 700 }}>{list.length}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
