import { useEffect, useMemo, useState } from 'react'
import { pl } from './pl'
import { listen } from '@tauri-apps/api/event'
import { Copy, Trash2, X, ScanSearch, Crown, FolderOpen, Lock, ChevronRight, ChevronDown, Shuffle, Check } from './FiboIcons'
import { findDuplicates, revealInExplorer, setFolderLocked, trashDuplicates, type DupGroup, type DupTrashReport, type Photo } from './api'
import { Thumb } from './Thumb'
import { Chip } from './ui'
import { chooseKeeper, copyRelations, dirOf, dupTree, isInside, markOne, marksForCopy, mergeMarks, planMarks, relationKey, unmark, type CopyRelation } from './dupTree'

type Level = 'exact' | 'close' | 'loose'
const LEVELS: { id: Level; label: string; dist: number | null; hint: string }[] = [
  { id: 'exact', label: 'Identyczne pliki', dist: null, hint: 'Ta sama zawartość co do bajta. Najszybsze i najbezpieczniejsze: przed usunięciem każda para jest jeszcze raz porównana bajt po bajcie.' },
  { id: 'close', label: 'Bardzo podobne', dist: 5, hint: 'Także ten sam kadr po zmniejszeniu, kompresji lub drobnej korekcie. Do Kosza podpowiadamy tylko mniejsze wersje.' },
  { id: 'loose', label: 'Podobne', dist: 10, hint: 'Także serie ujęć. Mogą trafić się różne zdjęcia, więc sprawdzaj każdą grupę przed usunięciem.' },
]
const GROUPS_PAGE = 40
const RELATIONS_PAGE = 20

const fmtBytes = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1).replace('.', ',')} GB` : `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1).replace('.', ',')} MB`
const fmt = (n: number) => n.toLocaleString('pl-PL')
const short = (d: string) => d.split(/[\\/]/).filter(Boolean).slice(-2).join('\\') || d

/**
 * Duplikaty jako osobna zakładka. Najpierw szukanie (identyczne lub podobne), potem trzy poziomy porządkowania:
 * skopiowane foldery (całe drzewa, które powtarzają inne), drzewo folderów z duplikatami i pojedyncze grupy zdjęć.
 * Nic nie jest zaznaczane samo: zaznaczasz podpowiedzi, foldery-kopie albo pojedyncze zdjęcia, a przed usunięciem program
 * sprawdza każdą parę jeszcze raz (zostaje kopia, identyczna zawartość) i zapisuje dziennik.
 */
export function Duplicates({ all, locked, onLockedChanged, suspended, onOpen, onTrashed, say }: {
  all: Photo[]
  /** Foldery chronione (te same co „zablokowane” w menu folderu): oryginały, z których nic nie usuwamy. */
  locked: string[]
  onLockedChanged: () => Promise<void> | void
  suspended: boolean
  onOpen: (id: number, list: Photo[]) => void
  onTrashed: (ids: number[]) => void
  say: (text: string, kind?: 'ok' | 'err') => void
}) {
  const [level, setLevel] = useState<Level>('exact')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  /** Zaznaczone do Kosza: zdjęcie i kopia, która zostaje. */
  const [marks, setMarks] = useState<Map<number, number>>(new Map())
  const [swapped, setSwapped] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const [groupLimit, setGroupLimit] = useState(GROUPS_PAGE)
  const [relLimit, setRelLimit] = useState(RELATIONS_PAGE)
  const [confirm, setConfirm] = useState(false)
  const [word, setWord] = useState('')
  const [similarOk, setSimilarOk] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [report, setReport] = useState<DupTrashReport | null>(null)

  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all])
  const members = (g: DupGroup) => g.ids.map((i) => byId.get(i)).filter((p): p is Photo => !!p)
  const live = useMemo(() => (groups ?? []).filter((g) => g.ids.filter((i) => byId.has(i)).length > 1), [groups, byId])
  const groupOf = useMemo(() => { const m = new Map<number, DupGroup>(); for (const g of live) for (const i of g.ids) m.set(i, g); return m }, [live])

  useEffect(() => {
    const un = listen<[number, number]>('dup-progress', (e) => setProgress(e.payload))
    return () => { un.then((f) => f()) }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !suspended && confirm) setConfirm(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, suspended])

  // Zdjęcia, które zniknęły z biblioteki albo trafiły do chronionego folderu, nie mogą być zaznaczone.
  useEffect(() => {
    setMarks((m) => {
      let changed = false
      const n = new Map(m)
      for (const [d, k] of m) {
        const p = byId.get(d)
        if (!p || !byId.has(k) || locked.some((x) => isInside(p.path, x))) { n.delete(d); changed = true }
      }
      return changed ? n : m
    })
  }, [byId, locked])

  const relations = useMemo(() => copyRelations(live, all, locked, swapped), [live, all, locked, swapped])
  const tree = useMemo(() => dupTree(live, all, relations, locked, open), [live, all, relations, locked, open])
  const suggestion = useMemo(() => planMarks(live, all, locked, relations), [live, all, locked, relations])
  const suggestionBytes = useMemo(() => [...suggestion.keys()].reduce((n, i) => n + (byId.get(i)?.size ?? 0), 0), [suggestion, byId])

  const search = async () => {
    setBusy(true); setProgress(null); setGroups(null); setMarks(new Map()); setFocus(null); setReport(null); setGroupLimit(GROUPS_PAGE); setRelLimit(RELATIONS_PAGE)
    try { setGroups(await findDuplicates(LEVELS.find((l) => l.id === level)!.dist)) }
    catch (e) { say(`Błąd szukania duplikatów: ${e}`, 'err') }
    finally { setBusy(false) }
  }

  const addMarks = (add: Map<number, number>, what: string) => {
    const { marks: next, skipped } = mergeMarks(marks, add)
    const added = next.size - marks.size
    setMarks(next)
    say(added > 0
      ? `Zaznaczono ${fmt(added)} ${pl(added, 'kopię', 'kopie', 'kopii')} ${what}${skipped ? `. Pominięto ${fmt(skipped)}, bo inaczej zniknęłaby ostatnia kopia` : ''}. Sprawdź i kliknij „Przenieś do Kosza” na dole`
      : skipped ? 'Nic nie dodano: te zdjęcia są już ostatnimi kopiami' : 'Nie ma tu nic do zaznaczenia', added > 0 ? 'ok' : undefined)
  }
  const markRelation = (r: CopyRelation) => addMarks(marksForCopy(r.copy, r.withSub, live, all, locked), `z „${short(r.copy)}”`)
  const markFolder = (dir: string) => addMarks(marksForCopy(dir, true, live, all, locked), `z „${short(dir)}”`)
  const toggle = (g: DupGroup, id: number) => {
    if (marks.has(id)) { setMarks(unmark(marks, id)); return }
    const p = byId.get(id)
    if (p && locked.some((x) => isInside(p.path, x))) return say('To zdjęcie leży w chronionym folderze. Zdejmij ochronę w drzewie folderów, jeśli naprawdę chcesz je usunąć.')
    const next = markOne(marks, members(g), id, locked)
    if (!next) return say('W każdej grupie musi zostać co najmniej jedna kopia.')
    setMarks(next)
  }
  const protect = async (dir: string, on: boolean) => {
    try {
      await setFolderLocked(dir, on)
      await onLockedChanged()
      say(on ? `„${short(dir)}” jest chroniony: to oryginał, z którego FIBO niczego nie usunie ani nie przeniesie` : `Zdjęto ochronę z „${short(dir)}”`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const reveal = (dir: string) => revealInExplorer(dir).catch((e) => say(`Nie udało się otworzyć Eksploratora: ${e}`, 'err'))
  const swap = (r: CopyRelation) => setSwapped((s) => { const n = new Set(s); const k = relationKey(r); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const markedList = useMemo(() => [...marks.keys()], [marks])
  const markedBytes = markedList.reduce((n, id) => n + (byId.get(id)?.size ?? 0), 0)
  /** Zaznaczone zdjęcie, które nie jest identycznym plikiem jak kopia, która zostaje (grupa podobnych albo inny rozmiar pliku). */
  const isSimilar = (id: number) => { const g = groupOf.get(id); const k = byId.get(marks.get(id)!), p = byId.get(id); return g?.kind !== 'exact' || !k || !p || k.size !== p.size }
  const markedSimilar = markedList.filter(isSimilar).length
  /** Podsumowanie przed usunięciem: z których folderów ile zdjęć. */
  const byFolder = useMemo(() => {
    const m = new Map<string, number>()
    for (const id of markedList) { const p = byId.get(id); if (p) m.set(dirOf(p.path), (m.get(dirOf(p.path)) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [markedList, byId])

  const doTrash = async () => {
    setDeleting(true)
    try {
      // Bez zgody na podobne wysyłamy tylko identyczne; podobne zostają zaznaczone na później.
      const send = similarOk ? markedList : markedList.filter((id) => !isSimilar(id))
      const items = send.map((id) => ({ id, keep: marks.get(id)! }))
      const r = await trashDuplicates(items, similarOk, markedList.length >= 20 ? word.trim() : undefined)
      setReport(r)
      const skippedPaths = new Set(r.skipped.map((s) => s.path))
      const gone = new Set(send.filter((id) => !skippedPaths.has(byId.get(id)?.path ?? '')))
      onTrashed([...gone])
      setGroups((gs) => (gs ?? []).map((g) => ({ ...g, ids: g.ids.filter((i) => !gone.has(i)) })).filter((g) => g.ids.length > 1))
      setMarks((m) => { const n = new Map(m); for (const id of send) n.delete(id); return n })
      setWord(''); setSimilarOk(false)
      say(`Przeniesiono do Kosza: ${fmt(r.trashed)}${r.skipped.length ? `, pominięto ${fmt(r.skipped.length)}` : ''}`, r.skipped.length ? undefined : 'ok')
    } catch (e) {
      say(`Nie udało się przenieść do Kosza: ${e}`, 'err')
      onTrashed([])
      setConfirm(false)
    } finally { setDeleting(false) }
  }

  const lvl = LEVELS.find((l) => l.id === level)!
  const shown = useMemo(() => live.filter((g) => !focus || g.ids.some((i) => { const p = byId.get(i); return p && isInside(dirOf(p.path), focus) })), [live, focus, byId])
  const pct = progress && progress[1] > 0 ? Math.min(100, Math.floor((progress[0] / progress[1]) * 100)) : 0
  const relationsShown = relations.slice(0, relLimit)
  const protectedHere = (d: string) => locked.some((x) => isInside(d, x))

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 4px 150px' }} aria-label="Duplikaty">
      <h1 style={{ margin: '4px 0 0', font: '700 22px/1.2 system-ui' }}>Duplikaty</h1>
      <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>Znajdź skopiowane foldery i powtórzone zdjęcia, ustal, co jest oryginałem, i przenieś zbędne kopie do Kosza</div>

      <section className="sec">
        <h2 className="sec-h"><i><ScanSearch size={17} /></i>Czego szukać</h2>
        <div className="chips">
          {LEVELS.map((l) => <Chip key={l.id} on={level === l.id} onClick={() => setLevel(l.id)}>{l.label}</Chip>)}
        </div>
        <p style={{ margin: '10px 2px 0', color: 'var(--muted)', fontSize: 13 }}>{lvl.hint}</p>
        <button className="primary" style={{ marginTop: 12 }} disabled={busy || all.length === 0} onClick={search}>
          {busy ? 'Szukam…' : groups ? 'Szukaj ponownie' : 'Szukaj duplikatów'}
        </button>
        {busy && (
          <div style={{ marginTop: 10 }} role="status">
            <div style={{ fontSize: 13, marginBottom: 6 }}>{progress && progress[1] > 0 ? <>Analizuję zdjęcia: <b>{fmt(progress[0])}</b> z {fmt(progress[1])} ({pct}%)</> : 'Porównuję zdjęcia…'}</div>
            <div role="progressbar" aria-label="Postęp szukania duplikatów" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 8, borderRadius: 4, background: 'var(--tonal)', overflow: 'hidden' }}>
              <div style={{ width: `${progress && progress[1] > 0 ? pct : 3}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s' }} />
            </div>
          </div>
        )}
        {all.length === 0 && <p style={{ margin: '8px 2px 0', color: 'var(--muted)', fontSize: 13 }}>Biblioteka jest pusta. Dodaj folder przyciskiem + na głównym ekranie.</p>}
      </section>

      {groups && live.length === 0 && (
        <div className="empty" style={{ height: '30vh' }}><div><Copy size={40} strokeWidth={1.2} style={{ margin: '0 auto 10px' }} />
          <p style={{ margin: 0 }}>Nie znaleziono duplikatów. Spróbuj poziomu „Bardzo podobne”, żeby znaleźć też zmniejszone kopie.</p></div></div>
      )}

      {live.length > 0 && (
        <section className="sec" aria-label="Podsumowanie">
          <h2 className="sec-h"><i><Copy size={17} /></i>Znaleziono {fmt(live.length)} {pl(live.length, 'grupę', 'grupy', 'grup')} duplikatów</h2>
          <p style={{ margin: '0 2px 10px', fontSize: 14 }}>
            Podpowiedź: <b>{fmt(suggestion.size)}</b> {pl(suggestion.size, 'zbędna kopia', 'zbędne kopie', 'zbędnych kopii')} ({fmtBytes(suggestionBytes)}).
            {' '}W każdej grupie zostaje jedna kopia: z chronionego folderu, z oryginału, bez „kopia” w nazwie, o największej rozdzielczości.
            {locked.length === 0 && <> Najpierw warto oznaczyć foldery z oryginałami ikoną kłódki w drzewie poniżej.</>}
          </p>
          <div className="chips">
            <button className="chip accent" disabled={suggestion.size === 0} onClick={() => addMarks(suggestion, 'według podpowiedzi')}><Check size={14} /> Zaznacz podpowiedzi</button>
            <button className="chip" disabled={marks.size === 0} onClick={() => setMarks(new Map())}><X size={14} /> Wyczyść zaznaczenie</button>
          </div>
        </section>
      )}

      {relations.length > 0 && (
        <section className="sec" aria-label="Skopiowane foldery">
          <h2 className="sec-h"><i><FolderOpen size={17} /></i>Skopiowane foldery<span style={{ font: '400 13px system-ui', color: 'var(--muted)' }}>{fmt(relations.length)}, od największych</span></h2>
          <p style={{ margin: '0 2px 8px', color: 'var(--muted)', fontSize: 13 }}>
            Foldery, których wszystkie zdjęcia (razem z podfolderami) są też gdzie indziej. Strzałka prowadzi od kopii do oryginału.
            Zaznaczenie kopii obejmuje tylko zdjęcia, które mają odpowiednik poza nią; zdjęć, które są tylko w kopii, nie ruszamy.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            {relationsShown.map((r) => (
              <div key={`${r.copy}|${r.original}|${r.kind}`} className="item" style={{ display: 'block', margin: 0, padding: 10, opacity: r.blocked ? 0.65 : 1 }}>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span className={`chip${r.kind === 'identical' ? ' on' : ''}`} style={{ minHeight: 26, padding: '2px 10px', fontWeight: 700, fontSize: 12.5 }}>
                    {r.kind === 'identical' ? '100% te same' : r.kind === 'subset' ? 'w całości w oryginale' : `rozproszone w ${fmt(r.elsewhere)} ${pl(r.elsewhere, 'folderze', 'folderach', 'folderach')}`}
                  </span>
                  <span style={{ fontSize: 13 }}><b>{fmt(r.shared)}</b> {pl(r.shared, 'wspólne zdjęcie', 'wspólne zdjęcia', 'wspólnych zdjęć')} · {fmtBytes(r.bytes)}{r.withSub ? ' · z podfolderami' : ''}{!r.exact ? ' · część tylko podobna' : ''}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '4px 8px', marginTop: 8 }}>
                  <span className="chip" style={{ minHeight: 24, padding: '1px 8px', fontSize: 12 }}>Kopia</span>
                  <span style={{ wordBreak: 'break-all', fontSize: 13, userSelect: 'text' }} title={r.copy}>{r.copy} <span style={{ color: 'var(--muted)' }}>({fmt(r.copyCount)})</span></span>
                  <button className="ico" aria-label={`Pokaż w Eksploratorze: ${r.copy}`} title="Pokaż w Eksploratorze" onClick={() => reveal(r.copy)}><FolderOpen size={17} /></button>
                  <span className="chip on" style={{ minHeight: 24, padding: '1px 8px', fontSize: 12 }}><Crown size={12} /> Oryginał</span>
                  <span style={{ wordBreak: 'break-all', fontSize: 13, userSelect: 'text' }} title={r.original}>
                    {r.kind === 'scattered' ? <>najwięcej w {r.original} i w innych</> : r.original}
                    {r.kind !== 'scattered' && <span style={{ color: 'var(--muted)' }}> ({fmt(r.originalCount)})</span>}
                    {protectedHere(r.original) && <Lock size={13} style={{ verticalAlign: '-2px', marginLeft: 6 }} aria-label="chroniony" />}
                  </span>
                  {r.kind !== 'scattered' ? <button className="ico" aria-label={`Pokaż w Eksploratorze: ${r.original}`} title="Pokaż w Eksploratorze" onClick={() => reveal(r.original)}><FolderOpen size={17} /></button> : <span />}
                </div>
                <div style={{ color: r.sure ? 'var(--muted)' : 'var(--hook, var(--accent))', fontSize: 12.5, marginTop: 6 }}>
                  {r.sure ? 'Dlaczego: ' : 'Uwaga: '}{r.reasons.join(', ')}
                </div>
                <div className="chips" style={{ marginTop: 8 }}>
                  <button className="chip accent" disabled={r.blocked} onClick={() => markRelation(r)} title={r.blocked ? 'Kopia leży w chronionym folderze' : 'Zaznacz do Kosza zdjęcia z kopii, które są w oryginale'}><Trash2 size={14} /> Zaznacz kopie stąd</button>
                  {r.kind !== 'scattered' && <button className="chip" onClick={() => swap(r)} title="Zamień, który folder jest oryginałem"><Shuffle size={14} /> Zamień kierunek</button>}
                  {r.kind !== 'scattered' && !protectedHere(r.original) && <button className="chip" onClick={() => protect(r.original, true)} title="Oznacz oryginał jako chroniony: nic z niego nie zostanie usunięte"><Lock size={14} /> Chroń oryginał</button>}
                  <button className="chip" onClick={() => { setFocus(r.copy); setGroupLimit(GROUPS_PAGE) }}>Pokaż zdjęcia</button>
                </div>
              </div>
            ))}
          </div>
          {relations.length > relLimit && <button className="wide" style={{ marginTop: 8 }} onClick={() => setRelLimit((n) => n + RELATIONS_PAGE)}>Pokaż więcej ({fmt(relations.length - relLimit)})</button>}
        </section>
      )}

      {tree.length > 0 && (
        <section className="sec" aria-label="Drzewo folderów">
          <h2 className="sec-h"><i><FolderOpen size={17} /></i>Drzewo folderów z duplikatami</h2>
          <p style={{ margin: '0 2px 8px', color: 'var(--muted)', fontSize: 13 }}>
            Kłódka chroni folder razem z podfolderami: to oryginał, z którego FIBO nigdy niczego nie usunie (tak samo jak „Zablokuj folder” w menu).
            Kliknij nazwę, żeby zobaczyć tylko jego duplikaty.
          </p>
          <div role="tree" style={{ display: 'grid', gap: 2 }}>
            {tree.map((n) => {
              const isOpen = open.has(n.path)
              return (
                <div key={n.path} role="treeitem" aria-expanded={n.children ? isOpen : undefined} aria-selected={focus === n.path}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: n.depth * 18, minHeight: 38, borderRadius: 10, background: focus === n.path ? 'var(--tonal)' : undefined }}>
                  <button className="ico" style={{ width: 30, height: 30, visibility: n.children ? 'visible' : 'hidden' }} aria-label={isOpen ? 'Zwiń' : 'Rozwiń'}
                    onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x })}>
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <button className="bare" style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '4px 2px', wordBreak: 'break-all', fontSize: 13.5 }} title={n.path}
                    onClick={() => { setFocus(focus === n.path ? null : n.path); setGroupLimit(GROUPS_PAGE) }}>
                    <span style={{ fontWeight: n.role ? 650 : 450 }}>{n.label}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {fmt(n.dups)} z {fmt(n.total)} ma kopię</span>
                    {n.role === 'copy' && <span className="chip" style={{ marginLeft: 6, minHeight: 20, padding: '0 7px', fontSize: 11 }}>kopia</span>}
                    {n.role === 'original' && <span className="chip on" style={{ marginLeft: 6, minHeight: 20, padding: '0 7px', fontSize: 11 }}>oryginał</span>}
                    {n.role === 'both' && <span className="chip" style={{ marginLeft: 6, minHeight: 20, padding: '0 7px', fontSize: 11 }}>oryginał i kopia</span>}
                  </button>
                  <button className={`ico${n.protected ? ' on' : ''}`} aria-pressed={n.protected} aria-label={n.protected ? `Zdejmij ochronę: ${n.path}` : `Chroń jako oryginał: ${n.path}`}
                    title={n.protected ? (locked.includes(n.path) ? 'Chroniony (oryginał). Kliknij, żeby zdjąć ochronę' : 'Chroniony przez folder nadrzędny') : 'Chroń jako oryginał'}
                    disabled={n.protected && !locked.includes(n.path)} onClick={() => protect(n.path, !n.protected)}
                    style={{ color: n.protected ? 'var(--hook, var(--accent))' : 'var(--muted)', opacity: n.protected ? 1 : 0.5 }}><Lock size={16} className={n.protected ? '' : 'lock-off'} /></button>
                  {/* Przy folderze z oryginałami (albo zawierającym oryginał) nie podsuwamy usuwania: łatwo byłoby skasować oryginały zamiast kopii. */}
                  {!n.protected && n.role !== 'original' && n.role !== 'both' && !relations.some((r) => r.kind !== 'scattered' && isInside(r.original, n.path)) ? (
                    <button className="chip" style={{ minHeight: 30, padding: '2px 10px', fontSize: 12.5 }} onClick={() => markFolder(n.path)}
                      title="Zaznacz do Kosza zdjęcia z tego folderu, które mają kopię poza nim">Usuń kopie stąd</button>
                  ) : <span style={{ minWidth: 0 }} />}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {live.length > 0 && (
        <section className="sec" aria-label="Grupy zdjęć">
          <h2 className="sec-h"><i><Copy size={17} /></i>Grupy zdjęć
            <span style={{ font: '400 13px system-ui', color: 'var(--muted)' }}>{fmt(shown.length)}{focus ? ` w „${short(focus)}”` : ''}</span>
            {focus && <button className="chip" style={{ minHeight: 28, padding: '2px 10px', fontSize: 12.5 }} onClick={() => setFocus(null)}><X size={13} /> Wszystkie</button>}
          </h2>
          {shown.slice(0, groupLimit).map((g) => {
            const list = members(g)
            const keeper = list.find((p) => !marks.has(p.id) && [...marks.values()].includes(p.id)) ?? chooseKeeper(list.filter((p) => !marks.has(p.id)).length ? list.filter((p) => !marks.has(p.id)) : list, locked, relations)
            return (
              <div key={g.ids.join('-')} style={{ margin: '10px 0 16px' }}>
                <div style={{ color: 'var(--muted)', fontSize: 12.5, margin: '0 2px 6px' }}>{list.length} {pl(list.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} · {g.kind === 'exact' ? 'identyczne pliki' : 'podobne (sprawdź)'}</div>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                  {list.map((p) => {
                    const del = marks.has(p.id)
                    const keepP = del ? byId.get(marks.get(p.id)!) : undefined
                    const prot = locked.some((x) => isInside(p.path, x))
                    return (
                      <div key={p.id} className="item" style={{ display: 'block', margin: 0, padding: 8, opacity: del ? 0.75 : 1, borderColor: del ? 'var(--err)' : undefined }}>
                        <button className="bare relative block w-full overflow-hidden" aria-label={`Podgląd ${p.name}`} onClick={() => onOpen(p.id, list)} style={{ aspectRatio: '4 / 3', borderRadius: 'var(--r-md)' }}>
                          <Thumb photo={p} fit="contain" />
                          {!del && p.id === keeper.id && <span className="chip on" style={{ position: 'absolute', left: 6, top: 6, minHeight: 24, padding: '1px 8px', fontSize: 12, background: 'var(--panel)' }}><Crown size={12} /> Zostaje</span>}
                          {prot && <span className="chip" style={{ position: 'absolute', right: 6, top: 6, minHeight: 24, padding: '1px 8px', fontSize: 12, background: 'var(--panel)' }}><Lock size={12} /> Chronione</span>}
                        </button>
                        <div className="truncate" style={{ fontWeight: 600, fontSize: 13.5, marginTop: 6 }} title={p.path}>{p.name}</div>
                        <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>{p.width ? `${p.width}×${p.height} px · ` : ''}{fmtBytes(p.size)}{p.taken ? ` · ${p.taken.slice(0, 10)}` : ''}</small>
                        <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12, wordBreak: 'break-all', userSelect: 'text' }} title={p.path}>{dirOf(p.path)}</small>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0', minHeight: 36, cursor: prot ? 'not-allowed' : 'pointer', color: del ? 'var(--err)' : 'var(--text)', fontSize: 13 }}>
                          <input type="checkbox" checked={del} disabled={prot} onChange={() => toggle(g, p.id)} style={{ width: 20, height: 20, accentColor: 'var(--err)' }} />
                          {del ? <span>Do Kosza{keepP ? <span style={{ color: 'var(--muted)' }}> (zostaje w „{short(dirOf(keepP.path))}”)</span> : null}</span> : 'Zostaw'}
                        </label>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {shown.length > groupLimit && <button className="wide" onClick={() => setGroupLimit((n) => n + GROUPS_PAGE)}>Pokaż kolejne grupy ({fmt(shown.length - groupLimit)})</button>}
        </section>
      )}

      {marks.size > 0 && (
        <div className="glass" style={{ position: 'fixed', zIndex: 30, left: '50%', transform: 'translateX(-50%)', bottom: 'calc(92px + var(--sab))', width: 'min(94vw, 560px)', borderRadius: 'var(--r-lg)', padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 6, fontSize: 14 }}>
            <b>{fmt(markedList.length)}</b> do Kosza<div style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtBytes(markedBytes)} do odzyskania, z {fmt(byFolder.length)} {pl(byFolder.length, 'folderu', 'folderów', 'folderów')}</div>
          </div>
          <button className="danger" style={{ minHeight: 46 }} disabled={deleting} onClick={() => { setReport(null); setConfirm(true) }}>
            <span className="inline-flex items-center gap-2"><Trash2 size={17} /> Przenieś do Kosza…</span>
          </button>
        </div>
      )}

      {confirm && (
        <>
          <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => !deleting && setConfirm(false)} />
          <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[88vh] w-[min(94vw,520px)] -translate-x-1/2 -translate-y-1/2 flex-col p-5" style={{ borderRadius: 'var(--r-lg)' }} role="alertdialog" aria-label="Potwierdzenie usunięcia duplikatów">
            {!report ? (
              <>
                <h2 style={{ margin: 0, font: '700 20px/1.2 system-ui' }}>Przenieść {fmt(markedList.length)} {pl(markedList.length, 'kopię', 'kopie', 'kopii')} do Kosza?</h2>
                <p style={{ color: 'var(--muted)', margin: '6px 0 10px', fontSize: 13.5 }}>
                  {fmtBytes(markedBytes)}. Pliki trafią do Kosza Windows, skąd można je przywrócić. Przed usunięciem każdy plik zostanie jeszcze raz porównany z kopią,
                  która zostaje; jeśli tej kopii nie ma albo zawartość się różni, plik zostanie pominięty. Lista trafi do dziennika.
                </p>
                <div style={{ overflowY: 'auto', maxHeight: 180, fontSize: 13, border: '1px solid var(--glass-line)', borderRadius: 10, padding: '6px 10px', marginBottom: 10 }}>
                  {byFolder.slice(0, 12).map(([dir, n]) => <div key={dir} style={{ display: 'flex', gap: 8, padding: '2px 0' }}><b style={{ minWidth: 44, textAlign: 'right' }}>{fmt(n)}</b><span style={{ wordBreak: 'break-all' }}>{dir}</span></div>)}
                  {byFolder.length > 12 && <div style={{ color: 'var(--muted)' }}>i {fmt(byFolder.length - 12)} innych folderów</div>}
                </div>
                {markedSimilar > 0 && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, margin: '0 0 10px', color: 'var(--err)' }}>
                    <input type="checkbox" checked={similarOk} onChange={(e) => setSimilarOk(e.target.checked)} style={{ width: 20, height: 20, flex: 'none' }} />
                    {fmt(markedSimilar)} {pl(markedSimilar, 'zdjęcie jest', 'zdjęcia są', 'zdjęć jest')} tylko {pl(markedSimilar, 'podobne', 'podobne', 'podobnych')} do kopii, która zostaje (inny plik). Obejrzałem je i chcę usunąć także te.
                  </label>
                )}
                {markedList.length >= 20 && (
                  <>
                    <label htmlFor="dup-word" style={{ marginTop: 0 }}>Aby potwierdzić, wpisz USUŃ</label>
                    <input id="dup-word" type="text" value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
                  </>
                )}
                <button className="danger wide" style={{ marginTop: 10 }} disabled={deleting || (markedList.length >= 20 && word.trim() !== 'USUŃ') || (!similarOk && markedList.length === markedSimilar)} onClick={doTrash}>
                  {deleting ? 'Sprawdzam i przenoszę…' : markedSimilar > 0 && !similarOk ? `Przenieś tylko identyczne (${fmt(markedList.length - markedSimilar)})` : 'Przenieś do Kosza'}
                </button>
                <button className="wide" disabled={deleting} onClick={() => setConfirm(false)}>Anuluj</button>
              </>
            ) : (
              <>
                <h2 style={{ margin: 0, font: '700 20px/1.2 system-ui' }}>Gotowe</h2>
                <p style={{ margin: '6px 0 10px', fontSize: 14 }}>Przeniesiono do Kosza: <b>{fmt(report.trashed)}</b>.{report.skipped.length > 0 && <> Pominięto <b>{fmt(report.skipped.length)}</b>, bo nie przeszły sprawdzenia:</>}</p>
                {report.skipped.length > 0 && (
                  <div style={{ overflowY: 'auto', maxHeight: 220, fontSize: 12.5, border: '1px solid var(--glass-line)', borderRadius: 10, padding: '6px 10px', marginBottom: 10 }}>
                    {report.skipped.slice(0, 200).map((s) => <div key={s.path} style={{ padding: '3px 0', wordBreak: 'break-all' }}>{s.path}<div style={{ color: 'var(--muted)' }}>{s.reason}</div></div>)}
                  </div>
                )}
                {report.log && <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 12.5, wordBreak: 'break-all' }}>Dziennik usunięć: {report.log}</p>}
                <button className="primary wide" onClick={() => { setConfirm(false); setReport(null) }}>Zamknij</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
