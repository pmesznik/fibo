import { useCallback, useEffect, useRef, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { inTauri } from './api'

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error'

const SKIP_KEY = 'skip-update-version'
const readSkip = () => { try { return localStorage.getItem(SKIP_KEY) } catch { return null } }
const mb = (n: number) => (n / 1048576).toFixed(1)

/** Sprawdzanie i instalowanie aktualizacji z GitHuba (wydania z podpisanym plikiem latest.json). */
export function useUpdater(say: (text: string, kind?: 'ok' | 'err') => void) {
  const [current, setCurrent] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  useEffect(() => { if (inTauri) getVersion().then(setCurrent).catch(() => {}) }, [])

  /** manual = klik w menu: pokazuje też wynik "masz najnowszą wersję" i błędy; automatyczne sprawdzanie milczy. */
  const checkNow = useCallback(async (manual: boolean) => {
    if (!inTauri || busy.current) return
    busy.current = true
    setPhase('checking')
    try {
      const u = await check()
      if (!u) {
        setPhase('idle')
        if (manual) say('Masz najnowszą wersję FIBO', 'ok')
      } else if (!manual && readSkip() === u.version) {
        setPhase('idle')
      } else {
        setUpdate(u); setPhase('available'); setOpen(true)
      }
    } catch (e) {
      setPhase('idle')
      if (manual) say(`Nie udało się sprawdzić aktualizacji: ${e}`, 'err')
    } finally {
      busy.current = false
    }
  }, [say])

  // Jedno automatyczne sprawdzenie krótko po uruchomieniu (po cichu, gdy brak internetu).
  useEffect(() => {
    if (!inTauri) return
    const t = window.setTimeout(() => checkNow(false), 4000)
    return () => window.clearTimeout(t)
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

  return { current, phase, update, open, done, total, error, checkNow, install, later, skip }
}

export type UpdaterApi = ReturnType<typeof useUpdater>

/** Okno z pytaniem o aktualizację, postępem pobierania i błędem. */
export function UpdateDialog({ u }: { u: UpdaterApi }) {
  useEffect(() => {
    if (!u.open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') u.later() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [u])

  if (!u.open || !u.update) return null
  const working = u.phase === 'downloading' || u.phase === 'installing'
  const pct = u.total ? Math.min(100, Math.round((u.done / u.total) * 100)) : 0
  const notes = (u.update.body ?? '').trim()

  return (
    <>
      <div className="fixed inset-0 z-[2100]" style={{ background: 'rgba(0,0,0,.5)' }} onClick={u.later} />
      <div className="glass fixed left-1/2 top-1/2 z-[2200] flex max-h-[88vh] w-[min(94vw,460px)] -translate-x-1/2 -translate-y-1/2 flex-col p-5"
        style={{ borderRadius: 'var(--r-lg)' }} role="alertdialog" aria-modal="true" aria-label="Aktualizacja FIBO">
        <h2 style={{ margin: 0, font: '700 21px/1.2 system-ui' }}>Dostępna nowa wersja</h2>
        <p style={{ margin: '6px 0 12px', color: 'var(--muted)' }}>
          FIBO <b style={{ color: 'var(--text)' }}>{u.update.version}</b> jest gotowe do pobrania. Masz wersję {u.current || '?'}.
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
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>Po instalacji FIBO uruchomi się ponownie. Zapisz najpierw otwarte edycje zdjęć.</p>
            <button className="primary" onClick={u.install}>{u.phase === 'error' ? 'Spróbuj ponownie' : 'Pobierz i zainstaluj'}</button>
            <button className="wide" onClick={u.later}>Później</button>
            <button className="text" style={{ width: '100%' }} onClick={u.skip}>Pomiń tę wersję</button>
          </>
        )}
      </div>
    </>
  )
}
