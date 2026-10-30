import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { FolderOpen, X } from './FiboIcons'
import { checkFiles, hidePhotos, revealInExplorer, type BrokenFile } from './api'
import { useEscape } from './ui'

/** Sprawdzenie plików biblioteki: brakujące, puste i uszkodzone zdjęcia. Tylko odczyt; wynik można ukryć w bibliotece (pliki zostają). */
export function CheckDialog({ onClose, onChanged, say }: { onClose: () => void; onChanged: () => void; say: (m: string, k?: 'ok' | 'err') => void }) {
  const [deep, setDeep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [result, setResult] = useState<BrokenFile[] | null>(null)

  useEffect(() => {
    const un = listen<[number, number]>('check-progress', (e) => setProgress(e.payload))
    return () => { un.then((f) => f()) }
  }, [])
  useEscape(onClose)

  const run = async () => {
    setBusy(true); setResult(null); setProgress(null)
    try { setResult(await checkFiles(deep)) } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }
  const hideAll = async () => {
    if (!result?.length) return
    try {
      const n = await hidePhotos(result.map((b) => b.id))
      say(`Ukryto w FIBO: ${n} (pliki zostały na dysku)`, 'ok')
      setResult([]); onChanged()
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Sprawdzanie plików">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Sprawdzanie plików</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>Szuka zdjęć z biblioteki, których pliku nie ma, które są puste albo uszkodzone. Niczego nie zmienia ani nie usuwa.</p>
          <div className="chips">
            <button className={`chip${!deep ? ' on' : ''}`} aria-pressed={!deep} onClick={() => setDeep(false)}>Szybkie (nagłówki)</button>
            <button className={`chip${deep ? ' on' : ''}`} aria-pressed={deep} onClick={() => setDeep(true)}>Dokładne (cały obraz, wolniej)</button>
          </div>
          <button className="primary" style={{ marginTop: 12 }} disabled={busy} onClick={run}>
            {busy ? (progress ? `Sprawdzam… ${progress[0]} z ${progress[1]}` : 'Sprawdzam…') : 'Sprawdź pliki'}
          </button>
          {result && result.length === 0 && <p role="status" style={{ marginTop: 12 }}>Wszystkie sprawdzone pliki są w porządku.</p>}
          {result && result.length > 0 && (
            <>
              <p role="status" style={{ margin: '12px 0 6px', fontWeight: 600 }}>Znaleziono problemów: {result.length}</p>
              <div style={{ display: 'grid', gap: 8 }}>
                {result.slice(0, 200).map((b) => (
                  <div key={b.id} className="item" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ wordBreak: 'break-all', fontSize: 13.5, userSelect: 'text' }}>{b.path}</div>
                      <small style={{ color: 'var(--err)' }}>{b.error}</small>
                    </div>
                    <button className="ico" aria-label={`Pokaż w Eksploratorze: ${b.path}`} title="Pokaż w Eksploratorze" onClick={() => revealInExplorer(b.path).catch((e) => say(`Nie udało się otworzyć Eksploratora: ${e}`, 'err'))}><FolderOpen size={17} /></button>
                  </div>
                ))}
                {result.length > 200 && <small style={{ color: 'var(--muted)' }}>… i {result.length - 200} kolejnych</small>}
              </div>
              <button className="wide" onClick={hideAll}>Ukryj wszystkie w FIBO (pliki zostają na dysku)</button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
