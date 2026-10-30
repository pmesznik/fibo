import { useMemo, useState } from 'react'
import { X, CalendarDays, MapPin, Plus, Check } from './FiboIcons'
import { Thumb } from './Thumb'
import { findEvents, rangeLabel, suggestName, type PhotoEvent } from './events'
import { pl } from './pl'
import { useEscape } from './ui'
import type { Photo } from './api'

const PAGE = 40

/**
 * Wydarzenia i podróże: propozycje albumów ze zdjęć zrobionych blisko siebie w czasie. Można je obejrzeć albo zamienić w album
 * (pod nazwą, którą można zmienić). Nic nie jest tworzone bez kliknięcia.
 */
export function EventsDialog({ photos, albumNames, onShow, onCreate, onClose }: {
  photos: Photo[]
  albumNames: Map<number, string>
  onShow: (ids: number[], title: string) => void
  onCreate: (name: string, ids: number[]) => Promise<boolean>
  onClose: () => void
}) {
  useEscape(onClose)
  const events = useMemo(() => findEvents(photos), [photos])
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Set<string>>(() => new Set())

  const start = (e: PhotoEvent) => { setEditing(e.id); setName(suggestName(e)) }
  const create = async (e: PhotoEvent) => {
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await onCreate(name.trim(), e.ids)
    setBusy(false)
    if (ok) { setDone((s) => new Set(s).add(e.id)); setEditing(null) }
  }

  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="glass flex max-h-[88vh] w-[min(94vw,720px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Wydarzenia i podróże" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><CalendarDays size={18} /> Wydarzenia i podróże</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '0 16px 6px', color: 'var(--muted)', fontSize: 13 }}>
          Zdjęcia zrobione blisko siebie w czasie (przerwa do 20 godzin), od 10 zdjęć. Wybierz propozycję, żeby ją obejrzeć albo zamienić w album. Nic nie powstaje bez Twojego kliknięcia.
        </div>
        <div style={{ overflowY: 'auto', padding: '8px 16px 16px', display: 'grid', gap: 10 }}>
          {events.length === 0 && <div className="empty">Nie znalazłem wydarzeń. Potrzebne są zdjęcia z datą, po co najmniej 10 z jednego dnia lub z kilku dni z rzędu.</div>}
          {events.slice(0, limit).map((e) => {
            const previews = [0, Math.floor(e.ids.length / 3), Math.floor((e.ids.length * 2) / 3), e.ids.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => byId.get(e.ids[i])).filter((p): p is Photo => !!p)
            const label = rangeLabel(e.first, e.last)
            return (
              <div key={e.id} className="sec" style={{ margin: 0 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 4, flex: 'none' }} aria-hidden>
                    {previews.map((p) => (
                      <div key={p.id} style={{ position: 'relative', width: 58, height: 58, borderRadius: 10, overflow: 'hidden' }}><Thumb photo={p} /></div>
                    ))}
                  </div>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <b style={{ fontSize: 15 }}>{label}</b>
                    <div style={{ color: 'var(--muted)', fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{e.kind === 'trip' ? `Podróż, ${e.days} ${pl(e.days, 'dzień', 'dni', 'dni')}` : 'Wydarzenie jednodniowe'}</span>
                      <span>{e.ids.length} {pl(e.ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
                      {e.place && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><MapPin size={12} /> {e.place.lat.toFixed(2)}, {e.place.lon.toFixed(2)}</span>}
                      {e.album !== null && <span className="chip on" style={{ minHeight: 0, padding: '1px 8px', fontSize: 12, cursor: 'default' }}>Ma album: {albumNames.get(e.album) ?? 'album'}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <button className="chip" onClick={() => { onShow(e.ids, label); onClose() }}>Pokaż</button>
                    {done.has(e.id)
                      ? <span className="chip on" style={{ cursor: 'default' }}><Check size={14} /> Album utworzony</span>
                      : e.album === null && <button className="chip" onClick={() => start(e)} aria-expanded={editing === e.id}><Plus size={14} /> Utwórz album</button>}
                  </div>
                </div>
                {editing === e.id && (
                  <form style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }} onSubmit={(ev) => { ev.preventDefault(); create(e) }}>
                    <label htmlFor={`ev-${e.id}`} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Nazwa albumu</label>
                    <input id={`ev-${e.id}`} type="text" value={name} maxLength={80} autoFocus onChange={(x) => setName(x.target.value)} style={{ flex: '1 1 240px', minWidth: 0 }} />
                    <button className="primary" type="submit" disabled={busy || !name.trim()} style={{ width: 'auto', padding: '0 18px' }}>{busy ? 'Tworzenie…' : 'Zapisz album'}</button>
                    <button className="chip" type="button" onClick={() => setEditing(null)}>Anuluj</button>
                  </form>
                )}
              </div>
            )
          })}
          {events.length > limit && <button className="chip" style={{ justifySelf: 'center' }} onClick={() => setLimit((l) => l + PAGE)}>Pokaż więcej ({events.length - limit})</button>}
        </div>
      </div>
    </div>
  )
}
