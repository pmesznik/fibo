import { useCallback, useEffect, useState } from 'react'
import { Check, X } from './FiboIcons'
import { FaceImg } from './FaceImg'
import { confirmFaces, personFaceCards, rejectFaces, type FaceCard } from './api'

const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many

const TILE = 150

/**
 * Widok twarzy jednej osoby jak w Picasie: kafelki to wycinki twarzy (nie całe zdjęcia). Twarze, których program nie jest pewien,
 * mają pomarańczowy znak „?” i przyciski „to ta osoba” oraz „to nie ta osoba”. Całe zdjęcie otwiera się dopiero po kliknięciu twarzy.
 */
export function PersonFacesView({ personId, name, onOpen, onPhotoGone, onChanged, say }: {
  personId: number
  name: string
  onOpen: (photoId: number) => void
  onPhotoGone: (photoId: number) => void
  onChanged: () => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  const [cards, setCards] = useState<FaceCard[] | null>(null)
  const [sure, setSure] = useState(false)

  const load = useCallback(async () => {
    try { setCards(await personFaceCards(personId)) } catch (e) { say(`Błąd: ${e}`, 'err'); setCards([]) }
  }, [personId, say])
  useEffect(() => { setCards(null); load() }, [load])

  const confirmOne = async (c: FaceCard) => {
    try { await confirmFaces([c.face]); setCards((l) => l?.map((x) => (x.face === c.face ? { ...x, unsure: false } : x)) ?? l); onChanged() } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const rejectOne = async (c: FaceCard) => {
    try {
      await rejectFaces([c.face])
      setCards((l) => l?.filter((x) => x.face !== c.face) ?? l)
      onPhotoGone(c.photo); onChanged()
      say(`To nie „${name}”: twarz odpięta od tej osoby (nie wróci do żadnej osoby przy grupowaniu)`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const confirmAll = async () => {
    if (!sure) { setSure(true); return }
    const ids = (cards ?? []).filter((c) => c.unsure).map((c) => c.face)
    setSure(false)
    try { await confirmFaces(ids); setCards((l) => l?.map((x) => ({ ...x, unsure: false })) ?? l); onChanged(); say(`Potwierdzono ${ids.length} ${pl(ids.length, 'twarz', 'twarze', 'twarzy')}`, 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  if (!cards) return <div className="empty" style={{ height: '40vh' }}>Wczytuję twarze…</div>
  const unsure = cards.filter((c) => c.unsure)
  const done = cards.filter((c) => !c.unsure)
  if (!cards.length) return <div className="empty" style={{ height: '40vh' }}>Ta osoba nie ma już żadnych twarzy.</div>

  const tile = (c: FaceCard) => (
    <div key={c.face} className="group" style={{ width: TILE }}>
      <div style={{ position: 'relative', width: TILE, height: TILE, background: 'var(--tonal)', boxShadow: 'var(--elev-1)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
        <button className="bare" style={{ display: 'block', width: '100%', height: '100%' }} aria-label={`Twarz ${name}: otwórz całe zdjęcie`} title="Kliknij, aby zobaczyć całe zdjęcie" onClick={() => onOpen(c.photo)}>
          <FaceImg id={c.face} size={TILE} />
        </button>
        {c.unsure && (
          <span aria-hidden title="Program nie jest pewien, czy to ta osoba" style={{ position: 'absolute', left: 0, bottom: 0, width: 38, height: 38, background: '#f28b1c', clipPath: 'polygon(0 0, 0 100%, 100% 100%)', color: '#fff', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'flex-end', paddingLeft: 6, paddingBottom: 3 }}>?</span>
        )}
        {!c.unsure && (
          <button className="bare opacity-0 transition group-hover:opacity-100 focus:opacity-100" aria-label={`To nie ${name}: odepnij twarz`} title="To nie ta osoba"
            style={{ position: 'absolute', right: 4, top: 4, width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,.6)', color: '#fff', display: 'grid', placeItems: 'center' }} onClick={() => rejectOne(c)}><X size={15} /></button>
        )}
      </div>
      {c.unsure && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 6 }}>
          <button className="fc-btn fc-yes" aria-label={`Potwierdź: to ${name}`} title="To ta osoba" onClick={() => confirmOne(c)}><Check size={17} strokeWidth={3} /></button>
          <button className="fc-btn fc-no" aria-label={`To nie ${name}: odepnij twarz`} title="To nie ta osoba" onClick={() => rejectOne(c)}><X size={17} strokeWidth={3} /></button>
        </div>
      )}
    </div>
  )

  return (
    <div>
      {unsure.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          <h2 style={{ margin: '0 0 6px', font: '650 18px/1.2 system-ui', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            Do potwierdzenia
            <span style={{ font: '400 13px system-ui', color: 'var(--muted)' }}>{unsure.length} {pl(unsure.length, 'twarz', 'twarze', 'twarzy')}</span>
            <button className="chip" onClick={confirmAll} onBlur={() => setSure(false)}>{sure ? `Na pewno? To wszystkie ${name}` : 'Potwierdź wszystkie'}</button>
          </h2>
          <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
            Program nie jest pewien, czy te twarze to „{name}”. Zatwierdź te, które pasują, a pozostałe odepnij.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>{unsure.map(tile)}</div>
        </section>
      )}
      <section>
        <h2 style={{ margin: '0 0 12px', font: '650 18px/1.2 system-ui', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          {unsure.length > 0 ? 'Potwierdzone' : 'Twarze'}
          <span style={{ font: '400 13px system-ui', color: 'var(--muted)' }}>{done.length} {pl(done.length, 'twarz', 'twarze', 'twarzy')}</span>
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>{done.map(tile)}</div>
      </section>
    </div>
  )
}
