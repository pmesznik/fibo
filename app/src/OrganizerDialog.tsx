import { useEffect, useState } from 'react'
import { X, FolderOpen, Check, History } from './FiboIcons'
import { organizeApply, organizeLast, organizePlan, organizeUndo, pickFolder, type OrganizePlan } from './api'
import { pl } from './pl'
import { useEscape } from './ui'

const PATTERNS: [string, string, string][] = [
  ['year', 'Rok', '2023'],
  ['month', 'Rok i miesiąc', '2023 / 07'],
  ['day', 'Rok i dzień', '2023 / 2023-07-14'],
]

/**
 * Organizator plików: przenosi wskazane zdjęcia do folderów według daty wykonania. Najpierw plan do sprawdzenia (nic się nie zmienia na dysku),
 * potem przeniesienie, a po nim można cofnąć całą partię jednym kliknięciem. Zdjęcia nigdy nie są nadpisywane, a zablokowane foldery są pomijane.
 */
export function OrganizerDialog({ selected, visible, onDone, onClose, say }: {
  selected: number[]
  visible: number[]
  onDone: () => void
  onClose: () => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const [scope, setScope] = useState<'selected' | 'visible'>(selected.length > 0 ? 'selected' : 'visible')
  const [dest, setDest] = useState<string | null>(null)
  const [pattern, setPattern] = useState('month')
  const [plan, setPlan] = useState<OrganizePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ batch: number; count: number } | null>(null)
  const ids = scope === 'selected' ? selected : visible

  useEffect(() => { organizeLast().then(setLast).catch(() => {}) }, [])
  // Zmiana zakresu, folderu albo układu unieważnia podgląd planu.
  useEffect(() => { setPlan(null) }, [scope, dest, pattern])

  const chooseFolder = async () => {
    try { const f = await pickFolder('Wybierz folder, w którym mają powstać foldery z datami'); if (f) setDest(f) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const check = async () => {
    if (!dest) return
    setBusy(true)
    try { setPlan(await organizePlan(ids, dest, pattern)) } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }
  const run = async () => {
    if (!dest || !plan || plan.moves.length === 0) return
    setBusy(true)
    try {
      const r = await organizeApply(ids, dest, pattern)
      onDone()
      say(`Przeniesiono ${r.done} ${pl(r.done, 'zdjęcie', 'zdjęcia', 'zdjęć')}${r.errors.length ? `, błędy: ${r.errors.length} (${r.errors[0]})` : ''}. Możesz to cofnąć w tym oknie`, r.errors.length ? 'err' : 'ok')
      setPlan(null)
      setLast(await organizeLast())
    } catch (e) { say(`Błąd przenoszenia: ${e}`, 'err') } finally { setBusy(false) }
  }
  const undo = async () => {
    if (!last) return
    setBusy(true)
    try {
      const r = await organizeUndo(last.batch)
      onDone()
      say(`Cofnięto: ${r.done} ${pl(r.done, 'zdjęcie', 'zdjęcia', 'zdjęć')}${r.errors.length ? `. Nie ruszono ${r.errors.length}: ${r.errors[0]}` : ''}`, r.errors.length ? 'err' : 'ok')
      setLast(await organizeLast())
    } catch (e) { say(`Błąd cofania: ${e}`, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[88vh] w-[min(94vw,640px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Porządkowanie zdjęć według daty" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><FolderOpen size={18} /> Porządkowanie według daty</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13 }}>
            Program przeniesie zdjęcia do folderów utworzonych z daty wykonania. Najpierw zobaczysz plan i nic się nie zmieni na dysku. Pliki nie są nadpisywane (zajęta nazwa dostaje _1, _2), a cały krok można cofnąć.
          </p>

          <label style={{ marginTop: 0 }}>Które zdjęcia</label>
          <div className="chips">
            <button className={`chip${scope === 'selected' ? ' on' : ''}`} aria-pressed={scope === 'selected'} disabled={selected.length === 0} onClick={() => setScope('selected')}>Zaznaczone ({selected.length})</button>
            <button className={`chip${scope === 'visible' ? ' on' : ''}`} aria-pressed={scope === 'visible'} onClick={() => setScope('visible')}>Wszystkie widoczne ({visible.length})</button>
          </div>

          <label>Folder docelowy</label>
          <div className="chips" style={{ alignItems: 'center' }}>
            <button className="chip" onClick={chooseFolder}><FolderOpen size={14} /> {dest ? 'Zmień folder…' : 'Wybierz folder…'}</button>
            {dest && <span style={{ fontSize: 13, color: 'var(--muted)', wordBreak: 'break-all' }}>{dest}</span>}
          </div>

          <label>Układ folderów</label>
          <div className="chips">
            {PATTERNS.map(([v, l, ex]) => <button key={v} className={`chip${pattern === v ? ' on' : ''}`} aria-pressed={pattern === v} onClick={() => setPattern(v)} title={`Przykład: ${ex}`}>{l} <small style={{ color: 'var(--muted)' }}>{ex}</small></button>)}
          </div>

          <div style={{ marginTop: 14 }}>
            <button className="primary" disabled={!dest || ids.length === 0 || busy} onClick={check} style={{ width: 'auto', padding: '0 20px' }}>{busy && !plan ? 'Sprawdzam…' : 'Sprawdź plan'}</button>
          </div>

          {plan && (
            <section className="sec" style={{ marginTop: 12 }} aria-live="polite">
              <b style={{ fontSize: 15 }}>{plan.moves.length === 0 ? 'Nie ma nic do przeniesienia' : `Do przeniesienia: ${plan.moves.length} ${pl(plan.moves.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`}</b>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                {plan.in_place > 0 && <div>Już na miejscu: {plan.in_place}</div>}
                {plan.file_dates > 0 && <div>Bez daty wykonania: {plan.file_dates} (użyję daty pliku)</div>}
                {plan.skipped.length > 0 && <div>Pominięte: {plan.skipped.length} ({plan.skipped[0][1]}{plan.skipped.length > 1 ? ', i inne' : ''})</div>}
              </div>
              {plan.moves.length > 0 && (
                <>
                  <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', maxHeight: 190, overflowY: 'auto', fontSize: 13 }}>
                    {plan.moves.slice(0, 40).map((m) => (
                      <li key={m.id} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                        <span style={{ color: 'var(--muted)' }}>→ {m.rel}</span>
                      </li>
                    ))}
                  </ul>
                  {plan.moves.length > 40 && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>…i {plan.moves.length - 40} kolejnych</div>}
                  <button className="primary" disabled={busy} onClick={run} style={{ marginTop: 10, width: 'auto', padding: '0 20px' }}>
                    <span className="inline-flex items-center gap-2"><Check size={16} /> {busy ? 'Przenoszę…' : `Przenieś ${plan.moves.length} ${pl(plan.moves.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`}</span>
                  </button>
                </>
              )}
            </section>
          )}

          {last && (
            <section className="sec" style={{ marginTop: 12 }}>
              <b style={{ fontSize: 14.5 }}>Ostatnie porządkowanie</b>
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '2px 0 8px' }}>
                {new Date(last.batch).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}: {last.count} {pl(last.count, 'zdjęcie', 'zdjęcia', 'zdjęć')}. Cofnięcie przenosi je na dawne miejsca i usuwa puste foldery.
              </div>
              <button className="chip" disabled={busy} onClick={undo}><History size={14} /> Cofnij porządkowanie</button>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
