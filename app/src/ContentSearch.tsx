import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { X, Search, Play } from './FiboIcons'
import { clipSearch, clipStart, clipStatus, clipStop, inTauri, type ClipStatus } from './api'
import { pl } from './pl'
import { useEscape } from './ui'

/** Przykładowe słowa na początek: wszystkie są na liście pojęć programu. */
const EXAMPLES = ['plaża', 'góry', 'pies', 'kot', 'tort', 'zachód słońca', 'kwiaty', 'las', 'dzieci', 'samochód', 'jedzenie', 'kościół', 'morze', 'śnieg']

/**
 * Szukanie po treści zdjęcia słowami, w całości na tym komputerze. Najpierw trzeba jednorazowo zaindeksować zdjęcia (na życzenie, w tle),
 * potem wpisujesz słowa po polsku lub angielsku („pies na plaży”) i dostajesz zdjęcia od najlepiej pasujących.
 */
export function ContentSearch({ onResults, onClose, say }: {
  onResults: (ids: number[], title: string) => void
  onClose: () => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const [st, setSt] = useState<ClipStatus | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => { if (inTauri) setSt(await clipStatus().catch(() => null)) }, [])
  useEffect(() => { refresh() }, [refresh])
  // Podczas indeksowania odświeżamy licznik co kilka sekund; po zakończeniu przychodzi zdarzenie.
  useEffect(() => {
    if (!inTauri) return
    const t = window.setInterval(() => { if (st?.running) refresh() }, 3000)
    const un = listen<{ stored: number; skipped: number; stopped: boolean; error: string | null }>('clip-done', (e) => {
      const d = e.payload
      if (d.error) say(`Indeksowanie: ${d.error}`, 'err')
      else if (d.stopped) say('Indeksowanie wstrzymane, można je wznowić w każdej chwili', 'ok')
      else say(`Zaindeksowano ${d.stored} ${pl(d.stored, 'zdjęcie', 'zdjęcia', 'zdjęć')}${d.skipped ? `, pominięto ${d.skipped}` : ''}`, 'ok')
      refresh()
    })
    return () => { window.clearInterval(t); un.then((f) => f()) }
  }, [st?.running, refresh, say])

  const toggleIndex = async () => {
    try {
      if (st?.running) await clipStop()
      else await clipStart()
      window.setTimeout(refresh, 500)
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  const search = async (text: string) => {
    const query = text.trim()
    if (!query || busy) return
    setBusy(true); setNote(null)
    try {
      const r = await clipSearch(query)
      if (r.matched.length === 0) {
        setNote(`Nie znam ${r.unknown.length > 1 ? 'tych słów' : 'tego słowa'}: ${r.unknown.join(', ')}. Spróbuj prostszych słów, np. ${EXAMPLES.slice(0, 5).join(', ')}.`)
      } else if (r.indexed === 0) {
        setNote('Najpierw zaindeksuj zdjęcia (przycisk wyżej). To jednorazowa praca w tle.')
      } else if (r.ids.length === 0) {
        setNote(`Nie znalazłem zdjęć pasujących do: ${r.matched.join(', ')}.${r.indexed < (st?.total ?? 0) ? ` Zaindeksowano dopiero ${r.indexed} z ${st?.total} zdjęć.` : ''}`)
      } else {
        onResults(r.ids, `Szukanie: ${r.matched.join(' i ')}`)
        onClose()
      }
    } catch (e) { say(`Błąd szukania: ${e}`, 'err') } finally { setBusy(false) }
  }

  const pct = st && st.total > 0 ? Math.round((st.indexed / st.total) * 100) : 0
  const pending = st ? st.total - st.indexed : 0
  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[88vh] w-[min(94vw,560px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Szukanie po treści zdjęć" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Search size={18} /> Szukanie po treści zdjęć</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13 }}>
            Wpisz, co jest na zdjęciu (po polsku lub angielsku), np. „pies na plaży” albo „tort urodzinowy”. Wszystko liczy się na tym komputerze: program rozpoznaje ok. {st?.concepts ?? 130} pojęć, więc nie każde słowo jest znane.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); search(q) }} style={{ display: 'flex', gap: 8 }}>
            <label htmlFor="content-q" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Co jest na zdjęciu</label>
            <input id="content-q" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="np. pies na plaży" maxLength={200} autoFocus style={{ flex: 1, minWidth: 0 }} />
            <button className="primary" type="submit" disabled={busy || !q.trim() || !st?.models_ok} style={{ width: 'auto', padding: '0 18px' }}>{busy ? 'Szukam…' : 'Szukaj'}</button>
          </form>
          <div className="chips" style={{ marginTop: 10 }} aria-label="Przykłady">
            {EXAMPLES.map((w) => <button key={w} className="chip" onClick={() => { setQ(w); search(w) }}>{w}</button>)}
          </div>
          {note && <p role="status" style={{ margin: '12px 0 0', fontSize: 13.5 }}>{note}</p>}

          <section className="sec" style={{ marginTop: 16 }}>
            <h3 className="sec-h" style={{ margin: 0 }}>Indeksowanie zdjęć</h3>
            {!st && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Wczytuję stan…</p>}
            {st && !st.models_ok && <p style={{ color: 'var(--err)', fontSize: 13 }}>Ta wersja programu nie ma modelu rozpoznawania treści zdjęć.</p>}
            {st && st.models_ok && (
              <>
                <p style={{ margin: '6px 0 8px', fontSize: 13.5 }}>
                  {pending <= 0 ? 'Wszystkie zdjęcia są zaindeksowane.' : st.running ? 'Indeksuję zdjęcia w tle…' : st.indexed === 0 ? 'Zdjęcia nie zostały jeszcze zaindeksowane.' : 'Część zdjęć czeka na zaindeksowanie.'}{' '}
                  <b>{st.indexed.toLocaleString('pl-PL')}</b> z {st.total.toLocaleString('pl-PL')} ({pct}%)
                </p>
                <div role="progressbar" aria-label="Postęp indeksowania" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 6, borderRadius: 3, background: 'var(--tonal)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
                </div>
                {(pending > 0 || st.running) && (
                  <button className="chip" style={{ marginTop: 10 }} onClick={toggleIndex}>
                    {st.running ? <><X size={14} /> Wstrzymaj</> : <><Play size={14} /> {st.indexed === 0 ? 'Zaindeksuj zdjęcia' : 'Wznów indeksowanie'}</>}
                  </button>
                )}
                <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 12.5 }}>
                  Pierwsze indeksowanie dużej biblioteki trwa wiele godzin (około 0,2 s na zdjęcie), ale można je wstrzymać i wznowić. Program robi to tylko po kliknięciu, a nowe zdjęcia dopisuje przy następnym kliknięciu.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
