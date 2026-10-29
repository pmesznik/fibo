import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Search, Users, X } from './FiboIcons'
import { FaceImg } from './FaceImg'
import { listPeople, mergePeople, mergeSuggestions, movePersonFaces, personFaces, type MergeSuggestion, type Person } from './api'

const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
const nm = (p: Person) => p.name ?? 'Nieznana osoba'
const pct = (s: number) => `${Math.max(0, Math.round(s * 100))}%`

function Modal({ title, onClose, children, width = 640 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-[2300]" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[2400] flex max-h-[90vh] -translate-x-1/2 -translate-y-1/2 flex-col"
        style={{ borderRadius: 'var(--r-lg)', width: `min(94vw, ${width}px)` }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dr-head" style={{ paddingBottom: 6 }}>
          <span style={{ fontSize: 20 }}>{title}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '0 16px 16px', overflowY: 'auto' }}>{children}</div>
      </div>
    </>
  )
}

function Avatar({ p, size }: { p: Person; size: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flex: 'none', display: 'inline-block', background: 'var(--tonal)', boxShadow: 'var(--elev-1)' }}>
      {p.cover !== null && <FaceImg id={p.cover} size={size} />}
    </span>
  )
}

function Known({ p }: { p: Person }) {
  return p.name
    ? <span className="chip on" style={{ minHeight: 0, padding: '1px 8px', fontSize: 11.5, cursor: 'default' }}><Check size={11} /> znana</span>
    : <span className="chip" style={{ minHeight: 0, padding: '1px 8px', fontSize: 11.5, cursor: 'default' }}>bez imienia</span>
}

/** Wybór osoby z listy: najpierw najbardziej podobne (znane osoby wyróżnione), potem wszystkie; można szukać po imieniu. */
export function PersonPicker({ people, exclude, sugg, onPick, onNew }: {
  people: Person[]; exclude: number[]; sugg: Map<number, MergeSuggestion>; onPick: (p: Person) => void; onNew?: () => void
}) {
  const [q, setQ] = useState('')
  const pool = useMemo(() => people.filter((p) => !exclude.includes(p.id) && !p.ignored), [people, exclude])
  const ranked = useMemo(() => pool.filter((p) => sugg.has(p.id) && !sugg.get(p.id)!.conflict && sugg.get(p.id)!.score >= 0.3)
    .sort((a, b) => (Number(!!b.name) * 0.15 + sugg.get(b.id)!.score) - (Number(!!a.name) * 0.15 + sugg.get(a.id)!.score)).slice(0, 6), [pool, sugg])
  const all = useMemo(() => [...pool].sort((a, b) => Number(!!b.name) - Number(!!a.name) || (a.name ?? '').localeCompare(b.name ?? '', 'pl') || b.photos - a.photos), [pool])
  const needle = q.trim().toLowerCase()
  const found = needle ? all.filter((p) => (p.name ?? 'nieznana osoba').toLowerCase().includes(needle)) : null

  const row = (p: Person, withScore: boolean) => {
    const s = sugg.get(p.id)
    return (
      <button key={p.id} className="bare" onClick={() => onPick(p)} aria-label={`Wybierz: ${nm(p)}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 'var(--r-md)', textAlign: 'left', width: '100%' }}>
        <Avatar p={p} size={42} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="truncate" style={{ display: 'block', fontWeight: 600 }}>{nm(p)}</span>
          <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{p.photos} {pl(p.photos, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
        </span>
        {withScore && s && (s.conflict
          ? <span title="Występują razem na jednym zdjęciu" style={{ color: 'var(--err)', fontSize: 12.5 }}>razem na zdjęciu</span>
          : <span style={{ fontWeight: 650, fontSize: 13, color: s.score >= 0.55 ? 'var(--ok, #2e9d5b)' : 'var(--muted)' }} title="Podobieństwo twarzy">{pct(s.score)}</span>)}
        <Known p={p} />
      </button>
    )
  }

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input type="text" aria-label="Szukaj osoby" placeholder="Szukaj osoby po imieniu…" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }} />
        <span aria-hidden style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}><Search size={16} /></span>
      </div>
      {onNew && <button className="wide" style={{ marginTop: 0, marginBottom: 8 }} onClick={onNew}><Users size={16} /> Nowa osoba (osobna grupa)</button>}
      <div style={{ maxHeight: '38vh', overflowY: 'auto' }}>
        {found ? (found.length ? found.map((p) => row(p, true)) : <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>Nikogo takiego nie ma na liście.</p>) : (
          <>
            {ranked.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 2px' }}>Najbardziej podobne twarze</div>}
            {ranked.map((p) => row(p, true))}
            <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 2px 4px' }}>Wszystkie osoby</div>
            {all.map((p) => row(p, false))}
          </>
        )}
      </div>
    </div>
  )
}

function FaceStrip({ id, n = 10 }: { id: number; n?: number }) {
  const [faces, setFaces] = useState<number[]>([])
  useEffect(() => { let dead = false; personFaces(id).then((f) => { if (!dead) setFaces(f.slice(0, n)) }).catch(() => {}); return () => { dead = true } }, [id, n])
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 44, marginTop: 8 }} aria-label="Przykładowe twarze tej osoby">
      {faces.map((f) => <span key={f} style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', background: 'var(--tonal)' }}><FaceImg id={f} size={44} /></span>)}
    </div>
  )
}

/**
 * Łączenie dwóch osób z podglądem obu: zdjęcie okładkowe, przykładowe twarze, liczby zdjęć, imię i podobieństwo twarzy.
 * Użytkownik wybiera, która osoba zostaje (druga do niej dołącza) i które imię zostaje, gdy obie je mają.
 */
export function MergeDialog({ people, a, b: initialB, onClose, onDone, say }: {
  people: Person[]; a: Person; b: Person | null; onClose: () => void; onDone: () => void; say: (m: string, kind?: 'ok' | 'err') => void
}) {
  const [b, setB] = useState<Person | null>(initialB)
  const [sugg, setSugg] = useState<Map<number, MergeSuggestion>>(new Map())
  const [keep, setKeep] = useState<'a' | 'b'>('a')
  const [nameFrom, setNameFrom] = useState<'a' | 'b'>('a')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let dead = false
    mergeSuggestions(a.id).then((l) => { if (!dead) setSugg(new Map(l.map((s) => [s.other, s]))) }).catch(() => {})
    return () => { dead = true }
  }, [a.id])

  // Domyślnie zostaje osoba z imieniem, a gdy obie (albo żadna) je mają, ta z większą liczbą zdjęć.
  const choose = (p: Person) => {
    setB(p)
    const k: 'a' | 'b' = p.name && !a.name ? 'b' : a.name && !p.name ? 'a' : p.photos > a.photos ? 'b' : 'a'
    setKeep(k); setNameFrom(k)
  }
  useEffect(() => { if (initialB) choose(initialB) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const s = b ? sugg.get(b.id) : undefined
  const kept = b ? (keep === 'a' ? a : b) : a
  const other = b ? (keep === 'a' ? b : a) : null
  const bothNamed = !!(b && a.name && b.name && a.name !== b.name)
  const finalName = bothNamed ? (nameFrom === 'a' ? a.name : b!.name) : (kept.name ?? other?.name ?? null)
  const total = b ? (a.photos + b.photos) : a.photos

  const go = async () => {
    if (!b || !other) return
    setBusy(true)
    try {
      await mergePeople(other.id, kept.id, bothNamed ? finalName : null)
      say(`Połączono w jedną osobę: ${finalName ?? 'bez imienia'}`, 'ok')
      onDone(); onClose()
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }

  const panel = (p: Person, side: 'a' | 'b') => (
    <div style={{ flex: '1 1 240px', minWidth: 0, padding: 12, borderRadius: 'var(--r-md)', background: 'var(--tonal)', outline: keep === side ? '2px solid var(--accent)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar p={p} size={72} />
        <div style={{ minWidth: 0 }}>
          <div className="truncate" style={{ fontWeight: 700, fontSize: 16 }}>{nm(p)}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{p.photos} {pl(p.photos, 'zdjęcie', 'zdjęcia', 'zdjęć')} · {p.count} {pl(p.count, 'twarz', 'twarze', 'twarzy')}</div>
          <div style={{ marginTop: 4 }}><Known p={p} /></div>
        </div>
      </div>
      <FaceStrip id={p.id} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontSize: 13.5 }}>
        <input type="radio" name="keep" checked={keep === side} onChange={() => { setKeep(side); if (!bothNamed) setNameFrom(side) }} /> Zostaw tę osobę (druga do niej dołączy)
      </label>
    </div>
  )

  return (
    <Modal title="Połącz osoby" onClose={onClose} width={700}>
      <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13.5 }}>
        Łącz tylko wtedy, gdy to na pewno ta sama osoba (np. dziecko w różnym wieku). Twarze obu osób trafią do jednej grupy.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {panel(a, 'a')}
        {b ? panel(b, 'b') : (
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontWeight: 650, marginBottom: 6 }}>Z kim połączyć „{nm(a)}”?</div>
            <PersonPicker people={people} exclude={[a.id]} sugg={sugg} onPick={choose} />
          </div>
        )}
      </div>

      {b && (
        <>
          <div role="group" aria-label="Podobieństwo twarzy" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
              <span>Podobieństwo twarzy</span>
              <b>{s ? pct(s.score) : '…'}</b>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--tonal)', overflow: 'hidden', marginTop: 4 }}>
              <div style={{ width: s ? `${Math.min(100, Math.max(4, s.score * 100))}%` : '0%', height: '100%', background: s && s.score >= 0.55 ? 'var(--ok, #2e9d5b)' : s && s.score >= 0.4 ? 'var(--accent)' : 'var(--muted)', transition: 'width .4s' }} />
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 4 }}>
              {s ? (s.score >= 0.55 ? 'Bardzo podobne twarze.' : s.score >= 0.4 ? 'Podobne twarze (np. ta sama osoba w innym wieku).' : 'Twarze niezbyt podobne: obejrzyj dokładnie przed połączeniem.') : 'Liczę podobieństwo…'}
            </div>
            {s?.conflict && (
              <div role="alert" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 'var(--r-md)', background: 'color-mix(in srgb, var(--err) 14%, transparent)', color: 'var(--err)', fontSize: 13.5 }}>
                Te osoby występują razem na tym samym zdjęciu, więc to prawdopodobnie dwie różne osoby.
              </div>
            )}
          </div>

          {bothNamed && (
            <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
              <legend style={{ fontSize: 13.5, marginBottom: 4 }}>Obie osoby mają imię. Które zostaje?</legend>
              {(['a', 'b'] as const).map((side) => (
                <label key={side} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 16, cursor: 'pointer' }}>
                  <input type="radio" name="nm" checked={nameFrom === side} onChange={() => setNameFrom(side)} /> {side === 'a' ? a.name : b.name}
                </label>
              ))}
            </fieldset>
          )}

          <div role="status" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', fontSize: 14 }}>
            Po połączeniu: <b>{finalName ?? 'osoba bez imienia'}</b> · {total} {pl(total, 'zdjęcie', 'zdjęcia', 'zdjęć')}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="primary" style={{ width: 'auto', padding: '0 22px' }} disabled={busy} onClick={go}>{busy ? 'Łączę…' : 'Połącz osoby'}</button>
            <button className="chip" onClick={() => setB(null)}>Wybierz inną osobę</button>
            <button className="chip" onClick={onClose}>Anuluj</button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '10px 0 0' }}>Pomyłkę poprawisz później: w oknie „Twarze” możesz przenieść pojedyncze twarze do innej osoby.</p>
        </>
      )}
    </Modal>
  )
}

/**
 * Przenoszenie twarzy z widoku zdjęć danej osoby: wskazane zdjęcia mają inną osobę niż ta, w której widoku jesteśmy.
 * Program podpowiada najbardziej podobne osoby, znane na początku listy.
 */
export function MoveFacesDialog({ personId, personName, photoIds, onClose, onDone, say }: {
  personId: number; personName: string; photoIds: number[]; onClose: () => void; onDone: (moved: number[]) => void; say: (m: string, kind?: 'ok' | 'err') => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [sugg, setSugg] = useState<Map<number, MergeSuggestion>>(new Map())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let dead = false
    listPeople().then((l) => { if (!dead) setPeople(l) }).catch((e) => say(`Błąd: ${e}`, 'err'))
    mergeSuggestions(personId).then((l) => { if (!dead) setSugg(new Map(l.map((x) => [x.other, x]))) }).catch(() => {})
    return () => { dead = true }
  }, [personId, say])

  const go = async (to: number | null, label: string) => {
    setBusy(true)
    try {
      await movePersonFaces(personId, photoIds, to)
      say(`Przeniesiono twarz z „${personName}” do: ${label}`, 'ok')
      onDone(photoIds); onClose()
    } catch (e) { say(`${e}`, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title="Przenieś do innej osoby" onClose={onClose} width={520}>
      <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13.5 }}>
        Na {photoIds.length === 1 ? 'tym zdjęciu' : `tych ${photoIds.length} zdjęciach`} twarz „{personName}” nie pasuje. Wskaż, kim jest naprawdę. Pomyłkę można poprawić tą samą drogą.
      </p>
      <div aria-busy={busy}>
        <PersonPicker people={people} exclude={[personId]} sugg={sugg} onPick={(p) => go(p.id, nm(p))} onNew={() => go(null, 'nowa osoba')} />
      </div>
    </Modal>
  )
}
