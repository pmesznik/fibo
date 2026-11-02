import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Heart, X } from './FiboIcons'
import { addTag, clipSearch, clipStart, clipStatus, inTauri, type ClipStatus, type Photo } from './api'
import { petTag, splitPets } from './pets'
import { pl } from './pl'
import { Thumb } from './Thumb'
import { useEscape } from './ui'

const SHOWN = 60

type Group = { key: 'pies' | 'kot'; title: string; ids: number[] }

/**
 * Zwierzęta domowe: program wyszukuje zdjęcia z psami i kotami tym samym lokalnym modelem treści co „Szukanie po treści”
 * (nie rozpoznaje konkretnego zwierzaka). Zatwierdzasz zdjęcia i dopisujesz tag „pies” albo „kot”, a opcjonalnie imię zwierzaka.
 */
export function PetsDialog({ photos, onClose, onChanged, onShow, say }: {
  photos: Photo[]
  onClose: () => void
  onChanged: () => void
  onShow: (ids: number[], title: string) => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const [st, setSt] = useState<ClipStatus | null>(null)
  const [min, setMin] = useState(0.26)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState<Set<number>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({ pies: '', kot: '' })

  const refresh = useCallback(async () => { if (inTauri) setSt(await clipStatus().catch(() => null)) }, [])
  useEffect(() => { refresh() }, [refresh])

  const find = async () => {
    setBusy(true); setOff(new Set())
    try {
      const [dog, cat] = await Promise.all([clipSearch('pies'), clipSearch('kot')])
      const r = splitPets(dog, cat, min)
      setGroups([{ key: 'pies', title: 'Psy', ids: r.dogs }, { key: 'kot', title: 'Koty', ids: r.cats }])
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }
  const index = async () => {
    try { await clipStart(); say('Indeksowanie zdjęć ruszyło w tle, postęp widać w okienku', 'ok'); window.setTimeout(refresh, 800) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const apply = async (g: Group) => {
    const ids = g.ids.filter((i) => !off.has(i))
    if (!ids.length) return
    const extra = petTag(names[g.key] ?? '')
    try {
      await addTag(ids, g.key)
      if (extra && extra.toLowerCase() !== g.key) await addTag(ids, extra)
      onChanged()
      setGroups((l) => l?.map((x) => (x.key === g.key ? { ...x, ids: [] } : x)) ?? l)
      say(`Dodano tag „${g.key}”${extra ? ` i „${extra}”` : ''}: ${ids.length} ${pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const toggle = (id: number) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[92vh] w-[min(96vw,780px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Zwierzęta domowe" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Heart size={18} /> Zwierzęta domowe</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            Program wyszukuje zdjęcia z psami i kotami lokalnym modelem treści (ten sam co „Szukanie po treści”). Nie odróżnia konkretnych zwierzaków, więc imię zwierzaka dopisujesz sam przy zatwierdzaniu. Tag dostają tylko zdjęcia, które zostawisz zaznaczone.
          </p>
          {st && !st.models_ok && <div className="empty" style={{ padding: 12 }}>Model rozpoznawania treści nie jest dostępny w tej wersji programu.</div>}
          {st?.models_ok && (
            <>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>
                Zaindeksowane zdjęcia: {st.indexed} z {st.total}.
                {st.indexed < st.total && !st.running && ' Wyniki obejmą tylko zaindeksowane.'}
                {st.running && ' Indeksowanie trwa w tle.'}
              </div>
              <div className="chips" style={{ marginBottom: 6 }}>
                {st.indexed < st.total && <button className="chip" disabled={st.running} onClick={index}>{st.running ? 'Indeksuję…' : st.indexed === 0 ? 'Zaindeksuj zdjęcia' : 'Dokończ indeksowanie'}</button>}
                <button className="chip on" disabled={busy || st.indexed === 0} onClick={find}>{busy ? 'Szukam…' : 'Znajdź psy i koty'}</button>
              </div>
              <div style={{ margin: '4px 0 10px' }}>
                <label htmlFor="pt-min" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Ostrożność (wyższa = mniej, ale pewniejszych zdjęć)</span><span>{min.toFixed(2).replace('.', ',')}</span></label>
                <input id="pt-min" type="range" min={0.2} max={0.34} step={0.01} value={min} onChange={(e) => { setMin(+e.target.value); setGroups(null) }} />
              </div>
            </>
          )}
          {groups && groups.every((g) => g.ids.length === 0) && <div className="empty" style={{ padding: 12 }}>Brak zdjęć przy tej ostrożności. Obniż ją suwakiem albo zaindeksuj więcej zdjęć.</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {groups?.filter((g) => g.ids.length > 0).map((g) => {
              const sel = g.ids.filter((i) => !off.has(i)).length
              return (
                <section key={g.key} className="sec" style={{ padding: 10 }}>
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 15 }}>{g.title}</b>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{g.ids.length} {pl(g.ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <label htmlFor={`pt-name-${g.key}`} style={{ margin: 0, fontSize: 13 }}>Imię (opcjonalnie)</label>
                      <input id={`pt-name-${g.key}`} type="text" maxLength={40} value={names[g.key] ?? ''} style={{ width: 150 }}
                        onChange={(e) => setNames((n) => ({ ...n, [g.key]: e.target.value }))} />
                      <button className="chip" onClick={() => { onShow(g.ids, g.title); onClose() }}>Pokaż w bibliotece</button>
                      <button className="chip on" disabled={sel === 0} onClick={() => apply(g)}><Check size={14} /> Dodaj tag ({sel})</button>
                    </span>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12.5, margin: '6px 0' }}>Kliknij zdjęcie, żeby je odznaczyć. Pokazuję {Math.min(SHOWN, g.ids.length)} z {g.ids.length}; tag dostaną też pozostałe, których nie odznaczysz.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 5 }}>
                    {g.ids.slice(0, SHOWN).map((i) => byId.get(i)).filter((p): p is Photo => !!p).map((p) => (
                      <button key={p.id} className="bare relative overflow-hidden" style={{ aspectRatio: '1', borderRadius: 8, opacity: off.has(p.id) ? 0.35 : 1, boxShadow: off.has(p.id) ? 'none' : '0 0 0 2px var(--accent)' }}
                        aria-pressed={!off.has(p.id)} aria-label={`${p.name}: ${off.has(p.id) ? 'odznaczone' : 'zaznaczone'}`} onClick={() => toggle(p.id)}>
                        <Thumb photo={p} />
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
