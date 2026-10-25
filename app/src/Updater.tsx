import { useCallback, useEffect, useRef, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { inTauri } from './api'

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error'
/** Komunikat po ręcznym sprawdzeniu: pokazujemy go w oknie na środku, żeby było go widać zawsze. */
type Info = { kind: 'checking' } | { kind: 'latest' } | { kind: 'error'; text: string }

const SKIP_KEY = 'skip-update-version'
const LAST_KEY = 'update-last-check'
const DAY = 24 * 60 * 60 * 1000
const CHECK_TIMEOUT = 20_000

const readSkip = () => { try { return localStorage.getItem(SKIP_KEY) } catch { return null } }
const readLast = () => { try { return Number(localStorage.getItem(LAST_KEY)) || 0 } catch { return 0 } }
const writeLast = () => { try { localStorage.setItem(LAST_KEY, String(Date.now())) } catch { /* brak pamięci */ } }
const mb = (n: number) => (n / 1048576).toFixed(1)

/** Sprawdzanie i instalowanie aktualizacji z GitHuba. Automatycznie najwyżej raz na dobę, ręcznie w każdej chwili. */
export function useUpdater() {
  const [current, setCurrent] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<Info | null>(null)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastCheck, setLastCheck] = useState(readLast())
  const busy = useRef(false)

  useEffect(() => { if (inTauri) getVersion().then(setCurrent).catch(() => {}) }, [])

  /** manual = klik w menu: zawsze pokazuje wynik (jest nowa wersja, nie ma, błąd). Automatyczne sprawdzanie milczy, dopóki nie ma nowej wersji. */
  const checkNow = useCallback(async (manual: boolean) => {
    if (!inTauri) return
    if (busy.current) {
      if (manual) setInfo({ kind: 'checking' })
      return
    }
    busy.current = true
    setPhase('checking')
    if (manual) setInfo({ kind: 'checking' })
    try {
      // Limit czasu, żeby zawieszone połączenie nie blokowało kolejnych prób.
      const u = await check({ timeout: CHECK_TIMEOUT })
      writeLast(); setLastCheck(Date.now())
      if (!u) {
        setPhase('idle')
        if (manual) setInfo({ kind: 'latest' })
      } else if (!manual && readSkip() === u.version) {
        setPhase('idle')
      } else {
        setInfo(null); setUpdate(u); setPhase('available'); setOpen(true)
      }
    } catch (e) {
      setPhase('idle')
      if (manual) setInfo({ kind: 'error', text: String(e) })
    } finally {
      busy.current = false
    }
  }, [])

  // Automatyczne sprawdzanie raz na dobę: krótko po uruchomieniu i co godzinę, gdy program jest otwarty długo.
  useEffect(() => {
    if (!inTauri) return
    const due = () => Date.now() - readLast() >= DAY
    const first = window.setTimeout(() => { if (due()) checkNow(false) }, 4000)
    const hourly = window.setInterval(() => { if (due()) checkNow(false) }, 60 * 60 * 1000)
    return () => { window.clearTimeout(first); window.clearInterval(hourly) }
  }, [checkNow])

  const install = async () => {
    if (!update) return
    setError(null); setDone(0); setTotal(0); setPhase('downloading')
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') setTotal(e.data.contentLength ?? 0)
        else if (e.event === 'Progress') setDone((d) => d + e.data.chunkLength)
        else if (e.event === 'Finished') setPhase('installing')
      })
      setPhase('installing')
      await relaunch()
    } catch (e) {
      setError(String(e)); setPhase('error')
    }
  }

  const later = () => { if (phase !== 'downloading' && phase !== 'installing') setOpen(false) }
  const skip = () => {
    if (update) { try { localStorage.setItem(SKIP_KEY, update.version) } catch { /* brak pamięci */ } }
    setOpen(false); setPhase('idle')
  }
  const closeInfo = () => setInfo(null)

  return { current, phase, update, open, info, done, total, error, lastCheck, checkNow, install, later, skip, closeInfo }
}

export type UpdaterApi = ReturnType<typeof useUpdater>

const backdrop = { background: 'rgba(0,0,0,.5)' } as const

/** Okno z pytaniem o aktualizację, postępem pobierania i błędem oraz okno z wynikiem ręcznego sprawdzenia. */
export function UpdateDialog({ u }: { u: UpdaterApi }) {
  const showing = (u.open && !!u.update) || !!u.info
  useEffect(() => {
    if (!showing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (u.open) u.later(); else if (u.info && u.info.kind !== 'checking') u.closeInfo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [u, showing])

  // Wynik ręcznego sprawdzenia (nie ma nowej wersji, trwa sprawdzanie, błąd).
  if (u.info && !(u.open && u.update)) {
    const i = u.info
    return (
      <>
        <div className="fixed inset-0 z-[2100]" style={backdrop} onClick={i.kind === 'checking' ? undefined : u.closeInfo} />
        <div className="glass fixed left-1/2 top-1/2 z-[2200] w-[min(94vw,420px)] -translate-x-1/2 -translate-y-1/2 p-5"
          style={{ borderRadius: 'var(--r-lg)' }} role="alertdialog" aria-modal="true" aria-label="Aktualizacje">
          {i.kind === 'checking' && (
            <>
              <h2 style={{ margin: 0, font: '700 20px/1.2 system-ui' }}>Sprawdzam aktualizacje…</h2>
              <p role="status" style={{ margin: '8px 0 0', color: 'var(--muted)' }}>Łączę się z GitHubem. To potrwa chwilę.</p>
            </>
          )}
          {i.kind === 'latest' && (
            <>
              <h2 style={{ margin: 0, font: '700 20px/1.2 system-ui' }}>Masz najnowszą wersję</h2>
              <p style={{ margin: '8px 0 16px', color: 'var(--muted)' }}>
                FIBO {u.current || ''} jest aktualne. Program sam sprawdza aktualizacje raz dziennie i pyta, czy je zainstalować.
              </p>
              <button className="primary" onClick={u.closeInfo} autoFocus>OK</button>
            </>
          )}
          {i.kind === 'error' && (
            <>
              <h2 style={{ margin: 0, font: '700 20px/1.2 system-ui' }}>Nie udało się sprawdzić aktualizacji</h2>
              <p role="alert" style={{ margin: '8px 0 6px', color: 'var(--err)', fontSize: 13.5, wordBreak: 'break-word' }}>{i.text}</p>
              <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 13 }}>Sprawdź połączenie z internetem i spróbuj ponownie.</p>
              <button className="primary" onClick={() => u.checkNow(true)}>Spróbuj ponownie</button>
              <button className="wide" onClick={u.closeInfo}>Zamknij</button>
            </>
          )}
        </div>
      </>
    )
  }

  if (!u.open || !u.update) return null
  const working = u.phase === 'downloading' || u.phase === 'installing'
  const pct = u.total ? Math.min(100, Math.round((u.done / u.total) * 100)) : 0
  const notes = (u.update.body ?? '').trim()

  return (
    <>
      <div className="fixed inset-0 z-[2100]" style={backdrop} onClick={u.later} />
      <div className="glass fixed left-1/2 top-1/2 z-[2200] flex max-h-[88vh] w-[min(94vw,460px)] -translate-x-1/2 -translate-y-1/2 flex-col p-5"
        style={{ borderRadius: 'var(--r-lg)' }} role="alertdialog" aria-modal="true" aria-label="Aktualizacja FIBO">
        <h2 style={{ margin: 0, font: '700 21px/1.2 system-ui' }}>Dostępna nowa wersja</h2>
        <p style={{ margin: '6px 0 12px', color: 'var(--muted)' }}>
          FIBO <b style={{ color: 'var(--text)' }}>{u.update.version}</b> jest gotowe do pobrania. Masz wersję {u.current || '?'}. Czy chcesz zaktualizować?
        </p>

        {notes && !working && (
          <div style={{ overflowY: 'auto', maxHeight: '28vh', background: 'var(--surface-2)', border: '1px solid var(--glass-line)', borderRadius: 14, padding: '10px 12px', fontSize: 13.5, whiteSpace: 'pre-wrap', marginBottom: 12 }}>
            {notes}
          </div>
        )}

        {working && (
          <div style={{ margin: '4px 0 14px' }} role="status">
            <div style={{ height: 10, borderRadius: 99, background: 'var(--tonal)', overflow: 'hidden' }}>
              <div style={{ width: u.phase === 'installing' ? '100%' : `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s var(--ease)' }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--muted)' }}>
              {u.phase === 'installing'
                ? 'Instaluję aktualizację. FIBO zamknie się i uruchomi ponownie…'
                : u.total ? `Pobieranie… ${mb(u.done)} MB z ${mb(u.total)} MB (${pct}%)` : 'Pobieranie…'}
            </div>
          </div>
        )}

        {u.phase === 'error' && (
          <p role="alert" style={{ margin: '0 0 12px', color: 'var(--err)', fontSize: 13.5, wordBreak: 'break-word' }}>Nie udało się zaktualizować: {u.error}</p>
        )}

        {!working && (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>Po instalacji FIBO uruchomi się ponownie. Zapisz najpierw otwarte edycje zdjęć. Jeśli wybierzesz „Później”, zapytam ponownie następnego dnia.</p>
            <button className="primary" onClick={u.install}>{u.phase === 'error' ? 'Spróbuj ponownie' : 'Pobierz i zainstaluj'}</button>
            <button className="wide" onClick={u.later}>Później</button>
            <button className="text" style={{ width: '100%' }} onClick={u.skip}>Pomiń tę wersję</button>
          </>
        )}
      </div>
    </>
  )
}
