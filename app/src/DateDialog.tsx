import { useState } from 'react'
import { X } from './FiboIcons'
import { setDate, shiftDates, type Photo } from './api'

/** Zmiana daty zdjęć: ustawienie dokładnej daty albo przesunięcie o dni, godziny i minuty (np. zły zegar aparatu).
 *  Dotyczy biblioteki FIBO, plików zdjęć nie zmieniamy. */
export function DateDialog({ photos, onClose, onDone, say }: {
  photos: Photo[]
  onClose: () => void
  onDone: () => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  const first = photos[0]
  const initial = (first?.taken ?? new Date((first?.modified ?? 0) * 1000).toISOString()).slice(0, 16).replace(/:/g, '-').replace(' ', 'T').replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3')
  const [mode, setMode] = useState<'set' | 'shift'>('shift')
  const [value, setValue] = useState(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(initial) ? initial : '')
  const [sign, setSign] = useState<1 | -1>(1)
  const [days, setDays] = useState(0)
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(0)
  const [busy, setBusy] = useState(false)

  const total = sign * (days * 1440 + hours * 60 + minutes)
  const can = mode === 'set' ? !!value : total !== 0

  const run = async () => {
    setBusy(true)
    try {
      const ids = photos.map((p) => p.id)
      const n = mode === 'set' ? await setDate(ids, value.replace('T', ' ') + ':00') : await shiftDates(ids, total)
      say(`Zmieniono datę: ${n} ${n === 1 ? 'zdjęcie' : 'zdjęć'}`, 'ok')
      onDone(); onClose()
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }
  const num = (v: string, max: number) => Math.max(0, Math.min(max, Math.floor(+v || 0)))

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Zmień datę zdjęć">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Zmień datę: {photos.length} {photos.length === 1 ? 'zdjęcie' : 'zdjęć'}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>Zmiana dotyczy biblioteki FIBO (plików zdjęć nie zmieniamy) i zostaje po ponownym skanowaniu.</p>
          <div className="chips">
            <button className={`chip${mode === 'shift' ? ' on' : ''}`} aria-pressed={mode === 'shift'} onClick={() => setMode('shift')}>Przesuń o…</button>
            <button className={`chip${mode === 'set' ? ' on' : ''}`} aria-pressed={mode === 'set'} onClick={() => setMode('set')}>Ustaw datę</button>
          </div>
          {mode === 'set' ? (
            <>
              <label htmlFor="dt-set">Data i godzina (wszystkie zaznaczone zdjęcia dostaną tę samą)</label>
              <input id="dt-set" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
            </>
          ) : (
            <>
              <div className="chips" style={{ marginTop: 10 }}>
                <button className={`chip${sign === 1 ? ' on' : ''}`} aria-pressed={sign === 1} onClick={() => setSign(1)}>Później (+)</button>
                <button className={`chip${sign === -1 ? ' on' : ''}`} aria-pressed={sign === -1} onClick={() => setSign(-1)}>Wcześniej (−)</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label htmlFor="dt-d">Dni</label><input id="dt-d" type="number" min={0} max={36500} value={days} onChange={(e) => setDays(num(e.target.value, 36500))} /></div>
                <div style={{ flex: 1 }}><label htmlFor="dt-h">Godziny</label><input id="dt-h" type="number" min={0} max={23} value={hours} onChange={(e) => setHours(num(e.target.value, 23))} /></div>
                <div style={{ flex: 1 }}><label htmlFor="dt-m">Minuty</label><input id="dt-m" type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(num(e.target.value, 59))} /></div>
              </div>
            </>
          )}
          <button className="primary" style={{ marginTop: 14 }} disabled={busy || !can} onClick={run}>{busy ? 'Zmieniam…' : 'Zmień datę'}</button>
          <button className="wide" onClick={onClose}>Anuluj</button>
        </div>
      </div>
    </>
  )
}
