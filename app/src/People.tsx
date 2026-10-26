import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { EyeOff, Eye, Pencil, Pause, Play, Trash2, Users, X } from './FiboIcons'
import {
  facesDeleteAll, facesStart, facesStatus, facesStop, faceUrl, ignorePerson, listPeople, mergePeople, personPhotos,
  renamePerson, setFacesEnabled, type FacesProgress, type FacesStatus, type Person,
} from './api'
import { PromptDialog } from './Dialogs'

const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many

/** Zakładka Ludzie: zgoda na rozpoznawanie twarzy, postęp analizy i lista osób. Wszystko liczy się na tym komputerze. */
export function People({ say, ask, onOpenPerson, onChanged }: {
  say: (m: string, kind?: 'ok' | 'err') => void
  ask: (c: { text: string; yes: string; run: () => void }) => void
  onOpenPerson: (name: string, ids: number[]) => void
  onChanged: () => void
}) {
  const [st, setSt] = useState<FacesStatus | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [prog, setProg] = useState<FacesProgress | null>(null)
  const [renaming, setRenaming] = useState<Person | null>(null)
  const [mergeFrom, setMergeFrom] = useState<Person | null>(null)
  const [showIgnored, setShowIgnored] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await facesStatus()
      setSt(s)
      setPeople(s.enabled ? await listPeople() : [])
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }, [say])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const un = listen<FacesProgress>('faces-progress', (e) => {
      setProg(e.payload)
      if (e.payload.finished) {
        if (e.payload.error) say(`Rozpoznawanie twarzy: ${e.payload.error}`, 'err')
        refresh()
      } else if (e.payload.done % 25 === 0) refresh()
    })
    return () => { un.then((f) => f()) }
  }, [refresh, say])

  const enable = async () => {
    try { await setFacesEnabled(true); await facesStart(); await refresh() } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const toggleRun = async () => {
    try {
      if (st?.running) { await facesStop(); say('Analiza wstrzymana, można ją wznowić w każdej chwili', 'ok') } else await facesStart()
      setTimeout(refresh, 400)
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const wipe = () => ask({
    text: 'Usunąć wszystkie dane twarzy i wyłączyć rozpoznawanie? Znikną rozpoznane osoby, imiona i wycinki twarzy. Same zdjęcia zostają nietknięte.',
    yes: 'Usuń dane twarzy',
    run: async () => { try { await facesDeleteAll(); setProg(null); await refresh(); say('Dane twarzy usunięte', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } },
  })
  const open = async (p: Person) => {
    if (mergeFrom) {
      if (mergeFrom.id === p.id) { setMergeFrom(null); return }
      const from = mergeFrom
      ask({
        text: `Połączyć „${from.name ?? 'Nieznana osoba'}” z „${p.name ?? 'Nieznana osoba'}”? To ta sama osoba, a jej twarze trafią do jednej grupy.`, yes: 'Połącz',
        run: async () => { try { await mergePeople(from.id, p.id); setMergeFrom(null); await refresh(); say('Osoby połączone', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } },
      })
      return
    }
    try { onOpenPerson(p.name ?? 'Nieznana osoba', await personPhotos(p.id)) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  if (!st) return <div className="empty" style={{ height: '40vh' }}>Chwila…</div>

  if (!st.enabled) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 6px', font: '700 22px/1.2 system-ui', display: 'flex', alignItems: 'center', gap: 10 }}><Users size={24} /> Ludzie</h1>
        <p style={{ color: 'var(--muted)', margin: '0 0 14px' }}>FIBO może znaleźć twarze na zdjęciach i pogrupować je w osoby, żebyś mógł przeglądać zdjęcia według ludzi.</p>
        <div className="glass" style={{ borderRadius: 'var(--r-lg)', padding: 18 }}>
          <b>Prywatność: wszystko zostaje na tym komputerze</b>
          <ul style={{ margin: '8px 0 12px', paddingLeft: 20, color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>
            <li>Zdjęcia, twarze i imiona nie są nigdzie wysyłane. Modele rozpoznawania są dołączone do programu i nic się nie pobiera.</li>
            <li>Wektory twarzy są w bazie zaszyfrowane kluczem Twojego konta Windows.</li>
            <li>Imiona zostają tylko w bazie FIBO i nie trafiają do plików zdjęć ani do plików XMP.</li>
            <li>Analiza działa w tle i można ją wstrzymać. Wszystkie dane twarzy usuniesz jednym przyciskiem.</li>
          </ul>
          {!st.models_ok && <p role="alert" style={{ color: 'var(--err)', fontSize: 14 }}>Ta wersja programu nie zawiera modeli rozpoznawania twarzy.</p>}
          <button className="primary" disabled={!st.models_ok} onClick={enable}>Włącz rozpoznawanie twarzy</button>
        </div>
      </div>
    )
  }

  const shown = people.filter((p) => showIgnored || !p.ignored)
  const pct = st.photos ? Math.min(100, Math.round((st.scanned / st.photos) * 100)) : 100
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, font: '700 22px/1.2 system-ui' }}>Ludzie</h1>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>{st.people} {pl(st.people, 'osoba', 'osoby', 'osób')} · {st.faces} {pl(st.faces, 'twarz', 'twarze', 'twarzy')}</div>
        <div className="glass" style={{ borderRadius: 'var(--r-lg)', padding: '10px 14px', marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div style={{ fontSize: 13.5 }}>
              {st.running ? 'Analizuję zdjęcia na tym komputerze…' : pct >= 100 ? 'Wszystkie zdjęcia przeanalizowane' : 'Analiza wstrzymana'} ({st.scanned} z {st.photos})
            </div>
            <div role="progressbar" aria-label="Postęp analizy twarzy" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
              style={{ height: 6, borderRadius: 3, background: 'var(--tonal)', marginTop: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
            </div>
            {prog && !prog.finished && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Przetworzono w tej sesji: {prog.done} z {prog.total}</div>}
          </div>
          {(st.running || pct < 100) && (
            <button className="chip" onClick={toggleRun}>{st.running ? <><Pause size={15} /> Wstrzymaj</> : <><Play size={15} /> Wznów</>}</button>
          )}
          <button className="chip" onClick={wipe}><Trash2 size={15} /> Usuń dane twarzy</button>
        </div>
        {mergeFrom && (
          <div role="status" className="chips" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 13.5 }}>Wybierz osobę, z którą połączyć „{mergeFrom.name ?? 'Nieznana osoba'}”.</span>
            <button className="chip" onClick={() => setMergeFrom(null)}><X size={14} /> Anuluj</button>
          </div>
        )}
        {people.some((p) => p.ignored) && (
          <div className="chips" style={{ marginTop: 10 }}>
            <button className="chip" onClick={() => setShowIgnored((v) => !v)}>{showIgnored ? 'Ukryj pominięte osoby' : 'Pokaż pominięte osoby'}</button>
          </div>
        )}
      </div>

      {shown.length === 0 && (
        <div className="empty" style={{ height: '40vh' }}>
          <div>
            <Users size={44} strokeWidth={1.2} style={{ margin: '0 auto 10px' }} />
            {st.running ? 'Szukam twarzy. Pierwsze osoby pojawią się za chwilę.' : 'Nie znaleziono jeszcze żadnych twarzy.'}
          </div>
        </div>
      )}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {shown.map((p) => (
          <div key={p.id} style={{ opacity: p.ignored ? 0.55 : 1 }}>
            <button className="bare block w-full text-center" aria-label={`${p.name ?? 'Nieznana osoba'}, ${p.photos} zdjęć`} onClick={() => open(p)}>
              <div style={{ width: 120, height: 120, margin: '0 auto', borderRadius: '50%', overflow: 'hidden', boxShadow: 'var(--elev-1)', background: 'var(--tonal)' }}>
                {p.cover && <img src={faceUrl(p.cover)} alt="" width={120} height={120} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div className="mt-2 truncate" style={{ fontWeight: 600 }}>{p.name ?? 'Nieznana osoba'}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{p.photos} {pl(p.photos, 'zdjęcie', 'zdjęcia', 'zdjęć')}</div>
            </button>
            <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 4 }}>
              <button className="ico" style={{ minWidth: 40, minHeight: 36 }} aria-label={`Nazwij osobę ${p.name ?? ''}`} title="Nadaj imię" onClick={() => setRenaming(p)}><Pencil size={16} /></button>
              <button className="ico" style={{ minWidth: 40, minHeight: 36 }} aria-label="Połącz z inną osobą" title="To ta sama osoba co inna: połącz" onClick={() => setMergeFrom(p)}><Users size={16} /></button>
              <button className="ico" style={{ minWidth: 40, minHeight: 36 }} aria-label={p.ignored ? 'Przywróć osobę na listę' : 'Pomiń tę osobę'} title={p.ignored ? 'Przywróć' : 'Pomiń (np. przypadkowy przechodzień)'}
                onClick={async () => { await ignorePerson(p.id, !p.ignored); refresh() }}>{p.ignored ? <Eye size={16} /> : <EyeOff size={16} />}</button>
            </div>
          </div>
        ))}
      </div>

      {renaming && (
        <PromptDialog title="Imię osoby" label="Imię lub nazwa" initial={renaming.name ?? ''} confirm="Zapisz"
          hint="Imię zostaje tylko w bazie FIBO na tym komputerze (nie trafia do plików zdjęć)."
          onSubmit={async (v) => { try { await renamePerson(renaming.id, v); await refresh(); onChanged() } catch (e) { return String(e) } }}
          onClose={() => setRenaming(null)} />
      )}
    </div>
  )
}
