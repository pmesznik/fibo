import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { RefreshCw, ScanSearch, X } from './FiboIcons'
import { inTauri, ocrSearch, ocrStart, ocrStatus, ocrStop, type OcrStatus } from './api'
import { pl } from './pl'
import { useEscape } from './ui'

/**
 * Szukanie tekstu na zdjęciach (paragony, tablice, dokumenty, napisy). Program rozpoznaje tekst lokalnie, małymi modelami z instalatora,
 * jednorazowo i na życzenie, w tle (można wstrzymać). Potem wpisujesz słowa, a program pokazuje zdjęcia, na których one są.
 */
export function TextSearch({ onResults, onClose, say }: {
  onResults: (ids: number[], title: string) => void
  onClose: () => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const [st, setSt] = useState<OcrStatus | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [snips, setSnips] = useState<{ id: number; text: string }[]>([])

  const refresh = useCallback(async () => { if (inTauri) setSt(await ocrStatus().catch(() => null)) }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!inTauri) return
    const t = window.setInterval(() => { if (st?.running) refresh() }, 3000)
    const un = listen<{ stored: number; skipped: number; stopped: boolean; error: string | null }>('ocr-done', (e) => {
      const d = e.payload
      if (d.error) say(`Rozpoznawanie tekstu: ${d.error}`, 'err')
      else if (d.stopped) say('Rozpoznawanie tekstu wstrzymane, można je wznowić w każdej chwili', 'ok')
      else say(`Rozpoznano tekst na ${d.stored} ${pl(d.stored, 'zdjęciu', 'zdjęciach', 'zdjęciach')}${d.skipped ? `, pominięto ${d.skipped}` : ''}`, 'ok')
      refresh()
    })
    return () => { window.clearInterval(t); un.then((f) => f()) }
  }, [st?.running, refresh, say])

  const toggle = async () => {
    try {
      if (st?.running) await ocrStop()
      else await ocrStart()
      window.setTimeout(refresh, 500)
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const search = async () => {
    const query = q.trim()
    if (!query || busy) return
    setBusy(true); setNote(null); setSnips([])
    try {
      const r = await ocrSearch(query)
      if (r.indexed === 0) setNote('Najpierw rozpoznaj tekst na zdjęciach (przycisk wyżej). To jednorazowa praca w tle.')
      else if (r.ids.length === 0) setNote(`Nie znalazłem „${query}” na zdjęciach${st && st.indexed < st.total ? ` (rozpoznano ${st.indexed} z ${st.total}, reszta jeszcze nie)` : ''}.`)
      else {
        setSnips(r.ids.slice(0, 8).map((id, i) => ({ id, text: r.snippets[i] })))
        setNote(`Znaleziono ${r.ids.length} ${pl(r.ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}. Przykłady tekstu poniżej.`)
        onResults(r.ids, `Tekst: ${query}`)
      }
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }

  const pct = st && st.total > 0 ? Math.round((st.indexed / st.total) * 100) : 0
  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[90vh] w-[min(94vw,560px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Szukanie tekstu na zdjęciach" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><ScanSearch size={18} /> Tekst na zdjęciach</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            Program czyta napisy na zdjęciach (paragony, tablice, dokumenty) lokalnie, małym modelem z instalatora. Tekst zostaje w bibliotece na tym komputerze.
          </p>
          {st && !st.models_ok && <div className="empty" style={{ padding: 12 }}>Modele rozpoznawania tekstu nie są dostępne w tej wersji programu.</div>}
          {st?.models_ok && (
            <>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>
                Rozpoznano tekst na {st.indexed} z {st.total} {pl(st.total, 'zdjęcia', 'zdjęć', 'zdjęć')} ({pct}%).{st.indexed < st.total && !st.running && ' Rozpoznawanie trwa około 1 do 2 sekund na zdjęcie, w tle, i można je wstrzymać.'}
              </div>
              {st.indexed < st.total && (
                <div className="chips" style={{ marginBottom: 8 }}>
                  <button className="chip" onClick={toggle}><RefreshCw size={14} /> {st.running ? 'Wstrzymaj rozpoznawanie' : st.indexed === 0 ? 'Rozpoznaj tekst na zdjęciach' : 'Dokończ rozpoznawanie'}</button>
                </div>
              )}
              <label htmlFor="ocr-q">Szukany tekst</label>
              <div className="flex gap-2">
                <input id="ocr-q" type="search" autoComplete="off" maxLength={200} placeholder="np. paragon, Biedronka, 123-456" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search() }} />
                <button className="chip on" disabled={busy || !q.trim()} onClick={search}>{busy ? 'Szukam…' : 'Szukaj'}</button>
              </div>
              {note && <p style={{ margin: '10px 0 4px', fontSize: 13.5 }} aria-live="polite">{note}</p>}
              {snips.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13, color: 'var(--muted)' }}>
                  {snips.map((s) => <li key={s.id} style={{ padding: '2px 0' }}>{s.text}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
