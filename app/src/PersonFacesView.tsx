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
  /** Stosy twarzy do potwierdzenia, które użytkownik rozwinął (numer stosu). */
  const [open, setOpen] = useState<Set<number>>(new Set())

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
      say(`To nie „${name}”: twarz wróciła do nierozpoznanych i może trafić do innej osoby`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  /** Potwierdzenie albo odrzucenie całego stosu podobnych twarzy jednym kliknięciem. */
  const confirmStack = async (members: FaceCard[]) => {
    const ids = members.map((c) => c.face)
    try { await confirmFaces(ids); setCards((l) => l?.map((x) => (ids.includes(x.face) ? { ...x, unsure: false } : x)) ?? l); onChanged(); say(`Potwierdzono stos: ${ids.length} ${pl(ids.length, 'twarz', 'twarze', 'twarzy')}`, 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const rejectStack = async (members: FaceCard[]) => {
    const ids = members.map((c) => c.face)
    try {
      await rejectFaces(ids)
      setCards((l) => l?.filter((x) => !ids.includes(x.face)) ?? l)
      members.forEach((c) => onPhotoGone(c.photo)); onChanged()
      say(`To nie „${name}”: ${ids.length} ${pl(ids.length, 'twarz wróciła', 'twarze wróciły', 'twarzy wróciło')} do nierozpoznanych`, 'ok')
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

  /** Stosy: twarze do potwierdzenia o tym samym numerze stosu. Stos z jedną twarzą to zwykły kafelek. */
  const stacks = new Map<number, FaceCard[]>()
  for (const c of unsure) { const l = stacks.get(c.stack); if (l) l.push(c); else stacks.set(c.stack, [c]) }
  const stackTile = (key: number, members: FaceCard[]) => {
    if (members.length < 2) return tile(members[0])
    if (open.has(key)) {
      return (
        <div key={`s${key}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: 8, borderRadius: 'var(--r-card)', outline: '2px dashed #f28b1c', outlineOffset: -2 }}>
          {members.map(tile)}
          <button className="chip" style={{ alignSelf: 'center' }} onClick={() => setOpen((o) => { const n = new Set(o); n.delete(key); return n })}>Zwiń stos</button>
        </div>
      )
    }
    return (
      <div key={`s${key}`} style={{ width: TILE }}>
        <div style={{ position: 'relative', width: TILE, height: TILE }}>
          <span aria-hidden style={{ position: 'absolute', inset: 0, transform: 'translate(8px, -8px)', borderRadius: 'var(--r-card)', background: 'var(--tonal)', boxShadow: 'var(--elev-1)' }} />
          <span aria-hidden style={{ position: 'absolute', inset: 0, transform: 'translate(4px, -4px)', borderRadius: 'var(--r-card)', background: 'var(--tonal)', boxShadow: 'var(--elev-1)' }} />
          <button className="bare" style={{ position: 'absolute', inset: 0, borderRadius: 'var(--r-card)', overflow: 'hidden', boxShadow: 'var(--elev-1)' }} aria-label={`Stos ${members.length} podobnych twarzy do potwierdzenia: rozwiń`} title="Podobne twarze z kilku zdjęć: kliknij, żeby rozwinąć stos"
            onClick={() => setOpen((o) => new Set(o).add(key))}>
            <FaceImg id={members[0].face} size={TILE} />
          </button>
          <span style={{ position: 'absolute', right: 6, bottom: 6, background: '#f28b1c', color: '#fff', borderRadius: 999, padding: '1px 9px', font: '700 13px system-ui' }}>×{members.length}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 5 }}>
          <button className="fc-btn fc-yes" aria-label={`Potwierdź cały stos: to ${name} (${members.length} twarzy)`} title="To ta osoba: cały stos" onClick={() => confirmStack(members)}><Check size={14} strokeWidth={3} /></button>
          <button className="fc-btn fc-no" aria-label={`To nie ${name}: odepnij cały stos (${members.length} twarzy)`} title="To nie ta osoba: cały stos" onClick={() => rejectStack(members)}><X size={14} strokeWidth={3} /></button>
        </div>
      </div>
    )
  }
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
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 5 }}>
          <button className="fc-btn fc-yes" aria-label={`Potwierdź: to ${name}`} title="To ta osoba" onClick={() => confirmOne(c)}><Check size={14} strokeWidth={3} /></button>
          <button className="fc-btn fc-no" aria-label={`To nie ${name}: odepnij twarz`} title="To nie ta osoba" onClick={() => rejectOne(c)}><X size={14} strokeWidth={3} /></button>
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
            Program nie jest pewien, czy te twarze to „{name}”. Zatwierdź te, które pasują, a pozostałe odepnij. Podobne twarze z kilku zdjęć są ułożone w stosy z liczbą ×N: stos potwierdzasz lub odpinasz jednym kliknięciem albo rozwijasz.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>{[...stacks.entries()].map(([k, m]) => stackTile(k, m))}</div>
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
