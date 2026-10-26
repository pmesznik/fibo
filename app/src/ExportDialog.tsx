import { useState } from 'react'
import { X, Download } from './FiboIcons'
import { exportPhotos, pickFolder } from './api'

const SIZES: [number, string][] = [[1024, '1024 px (e-mail)'], [1600, '1600 px'], [2048, '2048 px'], [0, 'Oryginalny rozmiar']]
const QUALITIES: [number, string][] = [[75, 'Mała'], [88, 'Dobra'], [95, 'Najlepsza']]

/** Eksport kopii zaznaczonych zdjęć do wybranego folderu (pomniejszonych, bez metadanych i lokalizacji). */
export function ExportDialog({ ids, onClose, say }: { ids: number[]; onClose: () => void; say: (m: string, kind?: 'ok' | 'err') => void }) {
  const [size, setSize] = useState(1600)
  const [quality, setQuality] = useState(88)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na wyeksportowane zdjęcia')
      if (!dir) return
      setBusy(true)
      const r = await exportPhotos(ids, dir, size, quality)
      say(r.errors.length ? `Wyeksportowano ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `Wyeksportowano ${r.done} do wybranego folderu`, r.errors.length ? 'err' : 'ok')
      if (!r.errors.length) onClose()
    } catch (e) { say(`Błąd eksportu: ${e}`, 'err') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Eksport zdjęć">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Eksport zdjęć</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            {ids.length} {ids.length === 1 ? 'zdjęcie' : 'zdjęć'}. Kopie są zapisywane jako JPEG bez danych EXIF (także bez lokalizacji GPS). Oryginały zostają nietknięte, a istniejące pliki nie są nadpisywane.
          </p>
          <label>Dłuższy bok</label>
          <div className="chips">
            {SIZES.map(([v, l]) => <button key={v} className={`chip${size === v ? ' on' : ''}`} aria-pressed={size === v} onClick={() => setSize(v)}>{l}</button>)}
          </div>
          <label>Jakość</label>
          <div className="chips">
            {QUALITIES.map(([v, l]) => <button key={v} className={`chip${quality === v ? ' on' : ''}`} aria-pressed={quality === v} onClick={() => setQuality(v)}>{l}</button>)}
          </div>
          <button className="primary" style={{ marginTop: 16 }} disabled={busy} onClick={run}>
            <span className="inline-flex items-center gap-2"><Download size={17} /> {busy ? 'Eksportuję…' : 'Wybierz folder i eksportuj'}</span>
          </button>
        </div>
      </div>
    </>
  )
}
