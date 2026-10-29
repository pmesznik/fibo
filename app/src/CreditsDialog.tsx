import { useState } from 'react'
import { X } from './FiboIcons'
import { setCredits, type Photo } from './api'

/** Autor i prawa autorskie wybranych zdjęć. Zapisują się w bibliotece i w plikach XMP obok zdjęć (pliki zdjęć zostają nietknięte). */
export function CreditsDialog({ photos, onClose, onDone, say }: { photos: Photo[]; onClose: () => void; onDone: () => void; say: (m: string, kind?: 'ok' | 'err') => void }) {
  const [author, setAuthor] = useState(photos[0]?.author ?? '')
  const [copyright, setCopyright] = useState(photos[0]?.copyright ?? '')
  const [busy, setBusy] = useState(false)
  const differs = photos.some((p) => (p.author ?? '') !== (photos[0]?.author ?? '') || (p.copyright ?? '') !== (photos[0]?.copyright ?? ''))
  const save = async () => {
    setBusy(true)
    try {
      await setCredits(photos.map((p) => p.id), author, copyright)
      say(`Zapisano autora i prawa autorskie: ${photos.length} ${photos.length === 1 ? 'zdjęcie' : photos.length < 5 ? 'zdjęcia' : 'zdjęć'}`, 'ok')
      onDone(); onClose()
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }
  return (
    <>
      <div className="fixed inset-0 z-[2300]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[2400] flex w-[min(94vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Autor i prawa autorskie">
        <div className="dr-head" style={{ paddingBottom: 6 }}>
          <span style={{ fontSize: 20 }}>Autor i prawa autorskie</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>
            {photos.length} {photos.length === 1 ? 'zdjęcie' : 'zdjęć'}. Dane trafiają do biblioteki FIBO i do plików XMP obok zdjęć (jeśli zapis XMP jest włączony), a same zdjęcia się nie zmieniają.
            {differs && ' Wybrane zdjęcia mają różne wartości: zapis ustawi wszystkim te same.'}
          </p>
          <label htmlFor="cr-author" style={{ marginTop: 6 }}>Autor</label>
          <input id="cr-author" type="text" maxLength={200} autoComplete="off" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <label htmlFor="cr-copy">Prawa autorskie</label>
          <input id="cr-copy" type="text" maxLength={200} autoComplete="off" placeholder="np. © 2026 Jan Kowalski" value={copyright} onChange={(e) => setCopyright(e.target.value)} />
          <button className="primary" style={{ marginTop: 14 }} disabled={busy} onClick={save}>{busy ? 'Zapisuję…' : 'Zapisz'}</button>
        </div>
      </div>
    </>
  )
}
