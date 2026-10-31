import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Tag, X } from './FiboIcons'
import { addTag, clipStart, clipStatus, clipSuggestTags, inTauri, type ClipStatus, type Photo, type TagSuggestion } from './api'
import { pl } from './pl'
import { Thumb } from './Thumb'
import { useEscape } from './ui'

const SHOWN = 36

/**
 * Podpowiedzi tagów: program zestawia zaindeksowane zdjęcia z listą ok. 130 pojęć (ten sam model, co w szukaniu po treści, lokalnie)
 * i pokazuje pojęcia, które pasują do wielu zdjęć. Tag dostają tylko zdjęcia, które zatwierdzisz; nic nie dopisuje się samo.
 */
export function TagSuggestDialog({ photos, onClose, onChanged, onShow, say }: {
  photos: Photo[]
  onClose: () => void
  onChanged: () => void
  onShow: (ids: number[], title: string) => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const [st, setSt] = useState<ClipStatus | null>(null)
  const [min, setMin] = useState(0.24)
  const [list, setList] = useState<TagSuggestion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [off, setOff] = useState<Set<number>>(new Set())

  const refresh = useCallback(async () => { if (inTauri) setSt(await clipStatus().catch(() => null)) }, [])
  useEffect(() => { refresh() }, [refresh])

  const find = async () => {
    setBusy(true); setOpen(null); setOff(new Set())
    try { setList(await clipSuggestTags(min)) } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }
  const index = async () => {
    try { await clipStart(); say('Indeksowanie zdjęć ruszyło w tle, postęp widać w okienku', 'ok'); window.setTimeout(refresh, 800) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const apply = async (s: TagSuggestion) => {
    const ids = s.ids.filter((i) => !off.has(i))
    if (ids.length === 0) return
    try {
      await addTag(ids, s.label)
      onChanged()
      setList((l) => l?.filter((x) => x.id !== s.id) ?? l); setOpen(null)
      say(`Dodano tag „${s.label}”: ${ids.length} ${pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const toggle = (id: number) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[92vh] w-[min(96vw,780px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Podpowiedzi tagów" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Tag size={18} /> Podpowiedzi tagów</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            Program zgaduje, co jest na zdjęciach, lokalnie i z tych samych danych co „Szukanie po treści”. Tag dostają tylko zdjęcia, które zatwierdzisz.
          </p>
          {st && !st.models_ok && <div className="empty" style={{ padding: 12 }}>Model rozpoznawania treści nie jest dostępny w tej wersji programu.</div>}
          {st?.models_ok && (
            <>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>
                Zaindeksowane zdjęcia: {st.indexed} z {st.total}.
                {st.indexed < st.total && !st.running && ' Podpowiedzi obejmą tylko zaindeksowane.'}
                {st.running && ' Indeksowanie trwa w tle.'}
              </div>
              <div className="chips" style={{ marginBottom: 6 }}>
                {st.indexed < st.total && <button className="chip" disabled={st.running} onClick={index}>{st.running ? 'Indeksuję…' : st.indexed === 0 ? 'Zaindeksuj zdjęcia' : 'Dokończ indeksowanie'}</button>}
                <button className="chip on" disabled={busy || st.indexed === 0} onClick={find}>{busy ? 'Szukam…' : 'Szukaj podpowiedzi'}</button>
              </div>
              <div style={{ margin: '4px 0 10px' }}>
                <label htmlFor="ts-min" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Ostrożność (wyższa = mniej, ale pewniejszych podpowiedzi)</span><span>{min.toFixed(2).replace('.', ',')}</span></label>
                <input id="ts-min" type="range" min={0.2} max={0.32} step={0.01} value={min} onChange={(e) => { setMin(+e.target.value); setList(null) }} />
              </div>
            </>
          )}
          {list && list.length === 0 && <div className="empty" style={{ padding: 12 }}>Brak podpowiedzi przy tej ostrożności. Obniż ją suwakiem albo zaindeksuj więcej zdjęć.</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {list?.map((s) => {
              const sel = s.ids.filter((i) => !off.has(i)).length
              const isOpen = open === s.id
              return (
                <section key={s.id} className="sec" style={{ padding: 10 }}>
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 15 }}>{s.label}</b>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{s.ids.length} {pl(s.ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="chip" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>{isOpen ? 'Zwiń' : 'Przejrzyj'}</button>
                      <button className="chip" onClick={() => { onShow(s.ids, `Podpowiedź: ${s.label}`); onClose() }}>Pokaż w bibliotece</button>
                      <button className="chip on" disabled={sel === 0} onClick={() => apply(s)}><Check size={14} /> Dodaj tag ({isOpen ? sel : s.ids.length})</button>
                      <button className="chip" aria-label={`Pomiń podpowiedź ${s.label}`} onClick={() => setList((l) => l?.filter((x) => x.id !== s.id) ?? l)}>Pomiń</button>
                    </span>
                  </div>
                  {!isOpen && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 8, overflow: 'hidden' }}>
                      {s.ids.slice(0, 8).map((i) => byId.get(i)).filter((p): p is Photo => !!p).map((p) => <div key={p.id} style={{ width: 64, height: 64, borderRadius: 6, overflow: 'hidden', flex: 'none' }}><Thumb photo={p} /></div>)}
                    </div>
                  )}
                  {isOpen && (
                    <>
                      <div style={{ color: 'var(--muted)', fontSize: 12.5, margin: '6px 0' }}>Kliknij zdjęcie, żeby je odznaczyć. Pokazuję {Math.min(SHOWN, s.ids.length)} z {s.ids.length}; tag dostaną też pozostałe, których nie odznaczysz.</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 5 }}>
                        {s.ids.slice(0, SHOWN).map((i) => byId.get(i)).filter((p): p is Photo => !!p).map((p) => (
                          <button key={p.id} className="bare relative overflow-hidden" style={{ aspectRatio: '1', borderRadius: 8, opacity: off.has(p.id) ? 0.35 : 1, boxShadow: off.has(p.id) ? 'none' : '0 0 0 2px var(--accent)' }}
                            aria-pressed={!off.has(p.id)} aria-label={`${p.name}: ${off.has(p.id) ? 'odznaczone' : 'zaznaczone'}`} onClick={() => toggle(p.id)}>
                            <Thumb photo={p} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
