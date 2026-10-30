import { useState } from 'react'
import { useEscape } from './ui'
import { X } from './FiboIcons'
import { renameBatch, type Photo } from './api'
import { pl } from './pl'

const dateOf = (p: Photo) => {
  const t = p.taken ?? new Date(p.modified * 1000).toISOString()
  return t.slice(0, 10).replace(/:/g, '-')
}

/** Zmiana nazw wielu zdjęć według szablonu: [data]_[prefiks]_[numer]. Pokazuje podgląd nowych nazw. */
export function RenameDialog({ photos, onClose, onDone, say }: {
  photos: Photo[]
  onClose: () => void
  onDone: () => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const [prefix, setPrefix] = useState('')
  const [withDate, setWithDate] = useState(true)
  const [start, setStart] = useState(1)
  const [busy, setBusy] = useState(false)

  const width = Math.max(3, String(start + photos.length).length)
  const stem = (p: Photo, i: number) =>
    [withDate ? dateOf(p) : '', prefix.trim(), String(start + i).padStart(width, '0')].filter(Boolean).join('_')
  const ext = (p: Photo) => (p.name.match(/\.[^.]+$/)?.[0] ?? '')

  const run = async () => {
    setBusy(true)
    try {
      const r = await renameBatch(photos.map((p) => p.id), prefix, withDate, start)
      say(r.errors.length ? `Zmieniono ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `Zmieniono nazwy: ${r.done}`, r.errors.length ? 'err' : 'ok')
      onDone()
      onClose()
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Zmień nazwy zdjęć">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Zmień nazwy: {photos.length} {pl(photos.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>Pliki dostają nazwy w kolejności, w jakiej je widzisz. Rozszerzenie i pliki XMP zostają zachowane, a istniejące pliki nie są nadpisywane.</p>
          <label htmlFor="rn-prefix" style={{ marginTop: 0 }}>Nazwa (opcjonalnie)</label>
          <input id="rn-prefix" type="text" value={prefix} maxLength={80} autoComplete="off" placeholder="np. Wakacje" onChange={(e) => setPrefix(e.target.value)} />
          <div className="chips" style={{ marginTop: 10 }}>
            <button className={`chip${withDate ? ' on' : ''}`} aria-pressed={withDate} onClick={() => setWithDate((v) => !v)}>Dodaj datę zdjęcia</button>
          </div>
          <label htmlFor="rn-start">Numer początkowy</label>
          <input id="rn-start" type="number" min={0} max={1000000} value={start} onChange={(e) => setStart(Math.max(0, Math.min(1000000, Math.floor(+e.target.value || 0))))} />
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>Podgląd:</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13.5 }}>
            {photos.slice(0, 3).map((p, i) => <li key={p.id}>{p.name} → <b>{stem(p, i)}{ext(p)}</b></li>)}
            {photos.length > 3 && <li style={{ color: 'var(--muted)' }}>… i {photos.length - 3} więcej</li>}
          </ul>
          <button className="primary" style={{ marginTop: 14 }} disabled={busy} onClick={run}>{busy ? 'Zmieniam…' : 'Zmień nazwy'}</button>
          <button className="wide" onClick={onClose}>Anuluj</button>
        </div>
      </div>
    </>
  )
}
