import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { EyeOff, Eye, Pencil, Star, Pause, Play, Trash2, Users, X } from './FiboIcons'
import {
  facesDeleteAll, facesReanalyze, facesRegroup, facesStart, personFaces, setPersonCover, facesStatus, facesStop, ignorePerson, listPeople, personPhotos, deletePerson, mergeSuggestions, restoreRejectedFaces,
  renamePerson, setFacesEnabled, type FacesProgress, type FacesStatus, type MergeSuggestion, type Person,
} from './api'
import { PromptDialog } from './Dialogs'
import { useEscape } from './ui'
import { FaceImg } from './FaceImg'
import { MergeDialog } from './MergePeople'

export { FaceImg }

const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many

/** Zakładka Osoby: zgoda na rozpoznawanie twarzy, postęp analizy i lista osób. Wszystko liczy się na tym komputerze. */
export function People({ say, ask, onOpenPerson, onChanged }: {
  say: (m: string, kind?: 'ok' | 'err') => void
  ask: (c: { text: string; yes: string; run: () => void }) => void
  onOpenPerson: (name: string, ids: number[], id: number) => void
  onChanged: () => void
}) {
  const [st, setSt] = useState<FacesStatus | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [prog, setProg] = useState<FacesProgress | null>(null)
  const [renaming, setRenaming] = useState<Person | null>(null)
  // Okno łączenia (a = osoba wyjściowa, b = druga, jeśli już wybrana) i okno zarządzania twarzami jednej osoby.
  const [merge, setMerge] = useState<{ a: Person; b: Person | null } | null>(null)
  // Podpowiedzi: dla osoby bez imienia najlepiej pasująca znana osoba.
  const [sugg, setSugg] = useState<Map<number, MergeSuggestion>>(new Map())
  const [showIgnored, setShowIgnored] = useState(false)
  // Łączenie przez przeciągnięcie: upuszczenie jednej osoby na drugą tylko proponuje połączenie, dopiero „Zatwierdź” je wykonuje.
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [coverFor, setCoverFor] = useState<Person | null>(null)
  const [coverFaces, setCoverFaces] = useState<number[]>([])
  useEscape(() => setCoverFor(null), !!coverFor)

  const refresh = useCallback(async () => {
    try {
      const s = await facesStatus()
      setSt(s)
      setPeople(s.enabled ? await listPeople() : [])
      // Podpowiedzi liczą się na zaszyfrowanych wektorach twarzy, więc nie w trakcie analizy (wtedy dane ciągle się zmieniają).
      if (s.enabled && !s.running) mergeSuggestions(null).then((l) => setSugg(new Map(l.map((x) => [x.id, x])))).catch(() => {})
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
  const regroup = async () => {
    try { await facesRegroup(); setTimeout(refresh, 600) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const reanalyze = () => ask({
    text: 'Przeanalizować wszystkie zdjęcia od nowa? To potrwa kilka minut w tle. Imiona osób i Twoje ręczne poprawki zostają, a twarze zostaną znalezione dokładniej.',
    yes: 'Przeanalizuj od nowa',
    run: async () => { try { await facesReanalyze(); setTimeout(refresh, 600) } catch (e) { say(`Błąd: ${e}`, 'err') } },
  })
  const wipe = () => ask({
    text: 'Usunąć wszystkie dane twarzy i wyłączyć rozpoznawanie? Znikną rozpoznane osoby, imiona i wycinki twarzy. Same zdjęcia zostają nietknięte.',
    yes: 'Usuń dane twarzy',
    run: async () => { try { await facesDeleteAll(); setProg(null); await refresh(); say('Dane twarzy usunięte', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } },
  })
  const pickCover = async (p: Person) => {
    try { setCoverFaces(await personFaces(p.id)); setCoverFor(p) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const chooseCover = async (face: number) => {
    if (!coverFor) return
    try { await setPersonCover(coverFor.id, face); setCoverFor(null); await refresh(); say('Okładka osoby zmieniona', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const removePerson = (p: Person) => ask({
    text: `Usunąć osobę „${p.name ?? 'Nieznana osoba'}” (${p.photos} ${pl(p.photos, 'zdjęcie', 'zdjęcia', 'zdjęć')})? Znika cała grupa, a jej twarze nie zostaną już nikomu przypisane. Same zdjęcia zostają nietknięte. Twarze możesz przywrócić przyciskiem „Przywróć odrzucone twarze”.`,
    yes: 'Usuń osobę',
    run: async () => { try { await deletePerson(p.id); await refresh(); onChanged(); say('Osoba usunięta', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } },
  })
  const restoreRejected = async () => {
    try { const n = await restoreRejectedFaces(); await facesRegroup(); setTimeout(refresh, 800); say(`Przywrócono ${n} ${pl(n, 'twarz', 'twarze', 'twarzy')} do grupowania`, 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const open = async (p: Person) => {
    try { onOpenPerson(p.name ?? 'Nieznana osoba', await personPhotos(p.id), p.id) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  if (!st) return <div className="empty" style={{ height: '40vh' }}>Chwila…</div>

  if (!st.enabled) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 6px', font: '700 22px/1.2 system-ui', display: 'flex', alignItems: 'center', gap: 10 }}><Users size={24} /> Osoby</h1>
        <p style={{ color: 'var(--muted)', margin: '0 0 14px' }}>FIBO może znaleźć twarze na zdjęciach i pogrupować je w osoby, żeby można było przeglądać zdjęcia według osób.</p>
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
        <h1 style={{ margin: 0, font: '700 22px/1.2 system-ui' }}>Osoby</h1>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>{st.people} {pl(st.people, 'osoba', 'osoby', 'osób')} · {st.faces} {pl(st.faces, 'twarz', 'twarze', 'twarzy')}{st.unassigned > 0 ? ` (${st.unassigned} bez grupy: za mało pewne)` : ''} · przeciągnij osobę na inną albo użyj przycisku „Połącz”</div>
        <div className="glass" style={{ borderRadius: 'var(--r-lg)', padding: '10px 14px', marginTop: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div style={{ fontSize: 13.5 }}>
              {prog?.grouping ? 'Grupuję twarze w osoby…' : st.running ? 'Analizuję zdjęcia na tym komputerze…' : pct >= 100 ? 'Wszystkie zdjęcia przeanalizowane' : 'Analiza wstrzymana'} ({st.scanned} z {st.photos})
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
          {!st.running && <button className="chip" onClick={regroup} title="Grupuje twarze w osoby od nowa (szybko). Imiona i ręczne poprawki zostają.">Pogrupuj od nowa</button>}
          {!st.running && <button className="chip" onClick={reanalyze} title="Analizuje wszystkie zdjęcia od nowa, dokładniej">Przeanalizuj ponownie</button>}
          <button className="chip" onClick={wipe}><Trash2 size={15} /> Usuń dane twarzy</button>
        </div>
        {st.rejected > 0 && !st.running && (
          <div className="chips" style={{ marginTop: 10 }}>
            <button className="chip" onClick={restoreRejected} title="Odrzucone twarze wracają do automatycznego grupowania">Przywróć odrzucone twarze ({st.rejected})</button>
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
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        {shown.map((p) => (
          <div key={p.id} draggable aria-grabbed={dragId === p.id}
            onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(p.id)) }}
            onDragEnd={() => { setDragId(null); setOverId(null) }}
            onDragOver={(e) => { if (dragId !== null && dragId !== p.id) { e.preventDefault(); setOverId(p.id) } }}
            onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault()
              const from = people.find((x) => x.id === dragId)
              setDragId(null); setOverId(null)
              if (from && from.id !== p.id) setMerge({ a: from, b: p })
            }}
            style={{ opacity: p.ignored ? 0.55 : dragId === p.id ? 0.4 : 1, borderRadius: 'var(--r-lg)', outline: overId === p.id ? '3px solid var(--accent)' : 'none', outlineOffset: 4, cursor: 'grab' }}>
            <button className="bare block w-full text-center" aria-label={`${p.name ?? 'Nieznana osoba'}, ${p.photos} ${pl(p.photos, 'zdjęcie', 'zdjęcia', 'zdjęć')}`} onClick={() => open(p)}>
              <div style={{ width: 120, height: 120, margin: '0 auto', borderRadius: '50%', overflow: 'hidden', boxShadow: 'var(--elev-1)', background: 'var(--tonal)' }}>
                {p.cover !== null && <FaceImg id={p.cover} />}
              </div>
              <div className="mt-2 truncate" style={{ fontWeight: 600 }}>{p.name ?? 'Nieznana osoba'}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{p.photos} {pl(p.photos, 'zdjęcie', 'zdjęcia', 'zdjęć')}</div>
              {p.unsure > 0 && <div style={{ color: '#d97706', fontSize: 12.5, fontWeight: 600 }} title="Twarze, których program nie jest pewien">? {p.unsure} do potwierdzenia</div>}
            </button>
            {(() => {
              const sg = !p.name && !p.ignored ? sugg.get(p.id) : undefined
              const known = sg ? people.find((x) => x.id === sg.other) : undefined
              if (!sg || !known) return null
              return (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
                  <button className="chip on" onClick={() => setMerge({ a: p, b: known })} title={`Podobieństwo twarzy ${Math.round(sg.score * 100)}%. Kliknij, aby porównać i połączyć`}
                    aria-label={`Czy to ${known.name}? Podobieństwo ${Math.round(sg.score * 100)} procent. Porównaj i połącz`}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', display: 'inline-block', background: 'var(--tonal)' }}>{known.cover !== null && <FaceImg id={known.cover} size={22} />}</span>
                    Czy to {known.name}? {Math.round(sg.score * 100)}%
                  </button>
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <button className="ico" style={{ minWidth: 34, minHeight: 36 }} aria-label={`Nazwij osobę ${p.name ?? ''}`} title="Nadaj imię" onClick={() => setRenaming(p)}><Pencil size={16} /></button>
              <button className="ico" style={{ minWidth: 34, minHeight: 36 }} aria-label={`Połącz ${p.name ?? 'osobę'} z inną osobą`} title="To ta sama osoba co inna: połącz (z podglądem)" onClick={() => setMerge({ a: p, b: null })}><Users size={16} /></button>
              <button className="ico" style={{ minWidth: 34, minHeight: 36 }} aria-label={p.ignored ? 'Przywróć osobę na listę' : 'Pomiń tę osobę'} title={p.ignored ? 'Przywróć' : 'Pomiń (np. przypadkowy przechodzień)'}
                onClick={async () => { await ignorePerson(p.id, !p.ignored); refresh() }}>{p.ignored ? <Eye size={16} /> : <EyeOff size={16} />}</button>
              <button className="ico" style={{ minWidth: 34, minHeight: 36 }} aria-label={`Wybierz okładkę osoby ${p.name ?? 'Nieznana osoba'}`} title="Wybierz twarz na okładkę" onClick={() => pickCover(p)}><Star size={16} /></button>
              <button className="ico" style={{ minWidth: 34, minHeight: 36 }} aria-label={`Usuń osobę ${p.name ?? 'Nieznana osoba'}`} title="Usuń całą grupę (zdjęcia zostają)" onClick={() => removePerson(p)}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>

      {coverFor && (
        <>
          <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setCoverFor(null)} />
          <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Wybierz okładkę osoby">
            <div className="dr-head" style={{ paddingBottom: 0 }}>
              <span>Okładka: {coverFor.name ?? 'Nieznana osoba'}</span>
              <button className="ico" aria-label="Zamknij" onClick={() => setCoverFor(null)}><X size={22} /></button>
            </div>
            <div style={{ padding: '4px 16px 8px', color: 'var(--muted)', fontSize: 13 }}>Kliknij twarz, która ma być okładką.</div>
            <div className="sheet-body" style={{ padding: '0 16px 16px' }}>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
                {coverFaces.map((f) => (
                  <button key={f} className="bare" aria-label="Użyj tej twarzy jako okładki" onClick={() => chooseCover(f)}
                    style={{ width: 84, height: 84, borderRadius: '50%', overflow: 'hidden', boxShadow: f === coverFor.cover ? '0 0 0 3px var(--accent)' : 'var(--elev-1)' }}>
                    <FaceImg id={f} size={84} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {merge && (
        <MergeDialog people={people} a={merge.a} b={merge.b} say={say} onClose={() => setMerge(null)} onDone={() => { refresh(); onChanged() }} />
      )}
      {renaming && (
        <PromptDialog title="Imię osoby" label="Imię lub nazwa" initial={renaming.name ?? ''} confirm="Zapisz"
          hint="Imię zostaje tylko w bazie FIBO na tym komputerze (nie trafia do plików zdjęć)."
          onSubmit={async (v) => { try { await renamePerson(renaming.id, v); await refresh(); onChanged() } catch (e) { return String(e) } }}
          onClose={() => setRenaming(null)} />
      )}
    </div>
  )
}
