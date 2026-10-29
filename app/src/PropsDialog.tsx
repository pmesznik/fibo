import { useState } from 'react'
import { useEscape } from './ui'
import { X } from './FiboIcons'
import { setProps, type Prop } from './api'

/** Właściwości albumu lub folderu: opis, miejsce i data. Są przeszukiwalne; zostają w bibliotece FIBO (bez zmian w plikach i folderach na dysku). */
export function PropsDialog({ kind, id, title, current, onClose, onSaved, say }: {
  kind: 'album' | 'folder'
  id: string
  title: string
  current: Prop | undefined
  onClose: () => void
  onSaved: () => void
  say: (m: string, k?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const [description, setDescription] = useState(current?.description ?? '')
  const [place, setPlace] = useState(current?.place ?? '')
  const [date, setDate] = useState(current?.date ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await setProps(kind, id, description, place, date)
      say('Właściwości zapisane', 'ok')
      onSaved(); onClose()
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label={`Właściwości: ${title}`}>
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span className="truncate">Właściwości: {title}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>Opis, miejsce i data są przeszukiwalne. Zapisują się tylko w bibliotece FIBO, a folderów ani plików na dysku nie zmieniają.</p>
          <label htmlFor="pr-date" style={{ marginTop: 0 }}>Data</label>
          <input id="pr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label htmlFor="pr-place">Miejsce</label>
          <input id="pr-place" type="text" maxLength={200} value={place} autoComplete="off" placeholder="np. Hel" onChange={(e) => setPlace(e.target.value)} />
          <label htmlFor="pr-desc">Opis</label>
          <textarea id="pr-desc" rows={4} maxLength={2000} value={description} placeholder="Dodaj opis…" style={{ width: '100%', resize: 'vertical' }} onChange={(e) => setDescription(e.target.value)} />
          <button className="primary" style={{ marginTop: 14 }} disabled={busy} onClick={save}>{busy ? 'Zapisuję…' : 'Zapisz'}</button>
          <button className="wide" onClick={onClose}>Anuluj</button>
        </div>
      </div>
    </>
  )
}
