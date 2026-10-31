import { useMemo, useState } from 'react'
import { Check, Compare, RefreshCw, X } from './FiboIcons'
import { qualityScan, setFlag, type Photo } from './api'
import { bestOfBursts, DEFAULT_BLUR, DEFAULT_DARK, DEFAULT_BRIGHT, problemPhotos, type Problem } from './quality'
import { findStacks } from './stacks'
import { flagOf } from './marks'
import { pl } from './pl'
import { Thumb } from './Thumb'
import { useEscape } from './ui'

const TABS: [Problem | 'best', string][] = [['blur', 'Nieostre i poruszone'], ['dark', 'Ciemne'], ['bright', 'Prześwietlone'], ['best', 'Najlepsze z serii']]
const SHOWN = 120

/**
 * Przegląd jakości: zdjęcia nieostre, poruszone, zbyt ciemne i prześwietlone oraz wybór najlepszego ujęcia z każdej serii.
 * Program niczego nie usuwa ani nie ukrywa sam: odrzucenie to zwykła flaga „odrzucone”, którą można zdjąć w każdej chwili.
 */
export function QualityDialog({ photos, onClose, onChanged, onShow, say }: {
  photos: Photo[]
  onClose: () => void
  onChanged: () => void
  onShow: (ids: number[], title: string) => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const real = useMemo(() => photos.filter((p) => p.id >= 0 && !p.video), [photos])
  const unmeasured = real.filter((p) => p.q_sharp == null).length
  const [tab, setTab] = useState<Problem | 'best'>('blur')
  const [blur, setBlur] = useState(DEFAULT_BLUR)
  const [dark, setDark] = useState(DEFAULT_DARK)
  const [bright, setBright] = useState(DEFAULT_BRIGHT)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const limit = tab === 'blur' ? blur : tab === 'dark' ? dark : bright
  const list = useMemo(() => (tab === 'best' ? [] : problemPhotos(real, tab, limit)), [real, tab, limit])
  const bursts = useMemo(() => (tab === 'best' ? bestOfBursts(findStacks(real), real) : []), [real, tab])

  const scan = async () => {
    setBusy(true)
    try {
      const r = await qualityScan()
      onChanged()
      say(`Oceniono jakość: ${r.done} ${pl(r.done, 'zdjęcie', 'zdjęcia', 'zdjęć')}${r.failed ? `, nie udało się: ${r.failed}` : ''}`, r.failed ? 'err' : 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const ids = list.slice(0, SHOWN).map((p) => p.id)
  const chosen = ids.filter((i) => picked.has(i))
  const reject = async () => {
    if (chosen.length === 0) return
    try {
      await setFlag(chosen, -1)
      onChanged(); setPicked(new Set())
      say(`Oznaczono jako odrzucone: ${chosen.length} ${pl(chosen.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}. Pliki zostają, a flagę zdejmiesz w menu zdjęcia`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const pickBest = async () => {
    const best = bursts.filter((b) => flagOf(b.best) !== 1).map((b) => b.best.id)
    if (best.length === 0) { say('Najlepsze ujęcia z serii są już wybrane', 'ok'); return }
    try {
      await setFlag(best, 1)
      onChanged()
      say(`Wybrano najlepsze ujęcie w ${best.length} ${pl(best.length, 'serii', 'seriach', 'seriach')}. Pozostałe zdjęcia serii zostają bez zmian`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  const slider = (label: string, value: number, set: (v: number) => void, min: number, max: number, unit: string) => (
    <div style={{ margin: '8px 0' }}>
      <label htmlFor="q-limit" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><span>{value}{unit}</span></label>
      <input id="q-limit" type="range" min={min} max={max} value={value} onChange={(e) => { set(+e.target.value); setPicked(new Set()) }} />
    </div>
  )

  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[92vh] w-[min(96vw,820px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Przegląd jakości zdjęć" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Compare size={18} /> Przegląd jakości</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            Program liczy ostrość i jasność lokalnie, z miniatur, i pokazuje zdjęcia do przejrzenia. Niczego nie usuwa ani nie ukrywa sam. Zamknięte oczy nie są wykrywane.
          </p>
          <div className="chips" style={{ marginBottom: 8 }}>
            <button className="chip" disabled={busy || unmeasured === 0} onClick={scan}>
              <RefreshCw size={14} /> {busy ? 'Oceniam…' : unmeasured > 0 ? `Oceń jakość (${unmeasured} ${pl(unmeasured, 'zdjęcie', 'zdjęcia', 'zdjęć')})` : 'Wszystkie zdjęcia ocenione'}
            </button>
          </div>
          <div className="chips" role="group" aria-label="Rodzaj problemu">
            {TABS.map(([v, l]) => <button key={v} className={`chip${tab === v ? ' on' : ''}`} aria-pressed={tab === v} onClick={() => { setTab(v); setPicked(new Set()) }}>{l}</button>)}
          </div>

          {tab !== 'best' && (
            <>
              {tab === 'blur' && slider('Nieostre, jeśli ostrość poniżej', blur, setBlur, 5, 400, '')}
              {tab === 'dark' && slider('Ciemne, jeśli średnia jasność poniżej', dark, setDark, 10, 120, '')}
              {tab === 'bright' && slider('Prześwietlone, jeśli ponad tyle pikseli jest białych', bright, setBright, 5, 80, '%')}
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 8px' }}>
                {real.length - unmeasured === 0 ? 'Najpierw oceń jakość zdjęć.' : `${list.length} ${pl(list.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} do przejrzenia${list.length > SHOWN ? `, pokazuję ${SHOWN} najgorszych` : ''}`}
              </div>
              {list.length > 0 && (
                <>
                  <div className="chips" style={{ marginBottom: 8 }}>
                    <button className="chip" onClick={() => setPicked(new Set(ids))}>Zaznacz wszystkie</button>
                    <button className="chip" disabled={chosen.length === 0} onClick={() => setPicked(new Set())}>Odznacz</button>
                    <button className="chip" disabled={chosen.length === 0} onClick={reject}><Check size={14} /> Odrzuć zaznaczone ({chosen.length})</button>
                    <button className="chip" onClick={() => { onShow(list.map((p) => p.id), TABS.find((t) => t[0] === tab)![1]); onClose() }}>Pokaż w bibliotece</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 6 }}>
                    {list.slice(0, SHOWN).map((p) => (
                      <button key={p.id} className="bare relative overflow-hidden" style={{ aspectRatio: '1', borderRadius: 8, boxShadow: picked.has(p.id) ? '0 0 0 3px var(--accent)' : 'var(--elev-1)' }}
                        aria-pressed={picked.has(p.id)} aria-label={`${p.name}, ${tab === 'blur' ? `ostrość ${Math.round(p.q_sharp ?? 0)}` : tab === 'dark' ? `jasność ${Math.round(p.q_mean ?? 0)}` : `prześwietlenie ${Math.round((p.q_hi ?? 0) * 100)}%`}`} onClick={() => toggle(p.id)}>
                        <Thumb photo={p} />
                        {picked.has(p.id) && <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full" style={{ background: 'var(--accent)', color: '#fff' }}><Check size={14} strokeWidth={3} /></span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'best' && (
            <>
              <p style={{ margin: '8px 0', color: 'var(--muted)', fontSize: 13 }}>
                Dla każdej serii zdjęć (co najmniej trzy ujęcia po sobie) program wybiera najostrzejsze. „Wybierz najlepsze” oznacza je flagą „wybrane”, a pozostałych nie rusza.
              </p>
              <div className="chips" style={{ marginBottom: 8 }}>
                <button className="chip" disabled={bursts.length === 0} onClick={pickBest}><Check size={14} /> Wybierz najlepsze ({bursts.length} {pl(bursts.length, 'seria', 'serie', 'serii')})</button>
                <button className="chip" disabled={bursts.length === 0} onClick={() => { onShow(bursts.map((b) => b.best.id), 'Najlepsze z serii'); onClose() }}>Pokaż w bibliotece</button>
              </div>
              {bursts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>{real.length - unmeasured === 0 ? 'Najpierw oceń jakość zdjęć.' : 'Nie znalazłem serii zdjęć z ocenioną ostrością.'}</div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {bursts.slice(0, 40).map((b) => (
                  <div key={b.best.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ width: 84, height: 84, borderRadius: 8, overflow: 'hidden', boxShadow: '0 0 0 3px var(--accent)', flex: 'none' }}><Thumb photo={b.best} /></div>
                    <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
                      {b.others.map((p) => <div key={p.id} style={{ width: 56, height: 56, borderRadius: 6, overflow: 'hidden', flex: 'none', opacity: 0.8 }}><Thumb photo={p} /></div>)}
                    </div>
                    <span style={{ color: 'var(--muted)', fontSize: 12.5, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{b.others.length + 1} {pl(b.others.length + 1, 'ujęcie', 'ujęcia', 'ujęć')}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
