import { useEffect, useMemo, useState } from 'react'
import { pl } from './pl'
import { listen } from '@tauri-apps/api/event'
import { Copy, Trash2, X, ScanSearch, Crown, FolderOpen } from './FiboIcons'
import { findDuplicates, revealInExplorer, trashPhotos, type DupGroup, type Photo } from './api'
import { Thumb } from './Thumb'
import { Chip } from './ui'

type Level = 'exact' | 'close' | 'loose'
const LEVELS: { id: Level; label: string; dist: number | null; hint: string }[] = [
  { id: 'exact', label: 'Identyczne pliki', dist: null, hint: 'Ta sama zawartość co do bajta. Najszybsze i bezpieczne.' },
  { id: 'close', label: 'Bardzo podobne', dist: 5, hint: 'Ten sam kadr po zmniejszeniu, kompresji lub drobnej korekcie.' },
  { id: 'loose', label: 'Podobne', dist: 10, hint: 'Także serie ujęć. Mogą trafić się różne zdjęcia, więc sprawdzaj przed usunięciem.' },
]

const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`
const pixels = (p: Photo) => (p.width ?? 0) * (p.height ?? 0)

/** Które zdjęcie z grupy zostawić: największa rozdzielczość, potem największy plik, potem to z datą EXIF, potem najstarsze w bibliotece. */
const dirOf = (p: Photo) => p.path.replace(/[\\/][^\\/]*$/, '')

/** Które zdjęcie jest „główne”: najpierw to z ważniejszego katalogu (jeśli wybrano kolejność), a przy remisie jak wyżej. */
const bestOf = (list: Photo[], order: string[] = []) => {
  const rank = (p: Photo) => { const i = order.indexOf(dirOf(p)); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
  return [...list].sort((a, b) =>
    rank(a) - rank(b) || pixels(b) - pixels(a) || b.size - a.size || Number(!!b.taken) - Number(!!a.taken) || a.id - b.id)[0]
}

export function Duplicates({ all, suspended, onClose, onOpen, onTrashed, say }: {
  all: Photo[]
  suspended: boolean            // gdy na wierzchu jest podgląd, Esc ma zamykać podgląd, nie ten ekran
  onClose: () => void
  onOpen: (id: number, list: Photo[]) => void
  onTrashed: (ids: number[]) => void
  say: (text: string, kind?: 'ok' | 'err') => void
}) {
  const [level, setLevel] = useState<Level>('exact')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [groups, setGroups] = useState<DupGroup[] | null>(null)
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [order, setOrder] = useState<string[]>([])      // ważniejsze katalogi, od najważniejszego
  const [word, setWord] = useState('')                  // słowo potwierdzenia przy dużej liczbie plików

  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all])
  const members = (g: DupGroup) => g.ids.map((i) => byId.get(i)).filter((p): p is Photo => !!p)

  useEffect(() => {
    const un = listen<[number, number]>('dup-progress', (e) => setProgress(e.payload))
    return () => { un.then((f) => f()) }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || suspended) return
      if (confirm) setConfirm(false); else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, suspended, onClose])

  const search = async () => {
    setBusy(true); setProgress(null); setGroups(null); setMarked(new Set())
    try {
      const res = await findDuplicates(LEVELS.find((l) => l.id === level)!.dist)
      setGroups(res)
      // Domyślnie do usunięcia: wszystko poza najlepszym zdjęciem z każdej grupy.
      const m = new Set<number>()
      for (const g of res) {
        const list = members(g)
        if (list.length < 2) continue
        const keep = bestOf(list, order).id
        for (const p of list) if (p.id !== keep) m.add(p.id)
      }
      setMarked(m)
    } catch (e) {
      say(`Błąd szukania duplikatów: ${e}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  /** Foldery występujące w grupach (z liczbą zdjęć), do wyboru ważniejszego katalogu. */
  const folderStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of groups ?? []) for (const p of members(g)) m.set(dirOf(p), (m.get(dirOf(p)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, byId])

  /** Po zmianie kolejności katalogów zaznaczenie jest liczone od nowa: główne zdjęcie zostaje, reszta idzie do Kosza. */
  const applyOrder = (next: string[]) => {
    setOrder(next)
    const m = new Set<number>()
    for (const g of groups ?? []) {
      const list = members(g)
      if (list.length < 2) continue
      const keep = bestOf(list, next).id
      for (const p of list) if (p.id !== keep) m.add(p.id)
    }
    setMarked(m)
  }
  const pickFolder = (dir: string) => applyOrder(order.includes(dir) ? order.filter((d) => d !== dir) : [...order, dir])

  const toggle = (g: DupGroup, id: number) => {
    const left = g.ids.filter((i) => !marked.has(i))
    if (!marked.has(id) && left.length <= 1) return say('W każdej grupie musi zostać co najmniej jedno zdjęcie.')
    setMarked((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const markedList = useMemo(() => [...marked], [marked])
  const markedBytes = markedList.reduce((n, id) => n + (byId.get(id)?.size ?? 0), 0)

  const doTrash = async () => {
    setConfirm(false); setDeleting(true); setWord('')
    try {
      const n = await trashPhotos(markedList, markedList.length >= 20 ? word.trim() : undefined)
      say(`Przeniesiono do Kosza: ${n}`, 'ok')
      onTrashed(markedList)
      setGroups((gs) => (gs ?? []).map((g) => ({ ...g, ids: g.ids.filter((i) => !marked.has(i)) })).filter((g) => g.ids.length > 1))
      setMarked(new Set())
    } catch (e) {
      say(`Nie udało się przenieść do Kosza: ${e}`, 'err')
      onTrashed([]) // odśwież bibliotekę, bo część plików mogła zniknąć
    } finally {
      setDeleting(false)
    }
  }

  const lvl = LEVELS.find((l) => l.id === level)!
  const shown = (groups ?? []).filter((g) => members(g).length > 1)

  return (
    <div className="fixed inset-0 z-[1500] overflow-y-auto" style={{ background: 'var(--bg)' }} role="dialog" aria-modal="true" aria-label="Duplikaty">
      <button className="glass" aria-label="Zamknij duplikaty" title="Zamknij (Esc)" onClick={onClose}
        style={{ position: 'fixed', zIndex: 5, left: 12, top: 'calc(12px + var(--sat))', width: 'var(--bar-h)', height: 'var(--bar-h)', padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}><X size={20} /></button>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'calc(76px + var(--sat)) 20px 140px' }}>
        <h1 style={{ margin: 0, font: '700 22px/1.2 system-ui' }}>Duplikaty</h1>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>Znajdź kopie tych samych zdjęć i przenieś zbędne do Kosza</div>

        <section className="sec">
          <h2 className="sec-h"><i><ScanSearch size={17} /></i>Co szukać</h2>
          <div className="chips">
            {LEVELS.map((l) => <Chip key={l.id} on={level === l.id} onClick={() => setLevel(l.id)}>{l.label}</Chip>)}
          </div>
          <p style={{ margin: '10px 2px 0', color: 'var(--muted)', fontSize: 13 }}>{lvl.hint}</p>
          <button className="primary" style={{ marginTop: 12 }} disabled={busy || all.length === 0} onClick={search}>
            {busy ? (progress ? `Analizuję zdjęcia… ${progress[0]} z ${progress[1]}` : 'Szukam…') : 'Szukaj duplikatów'}
          </button>
          {all.length === 0 && <p style={{ margin: '8px 2px 0', color: 'var(--muted)', fontSize: 13 }}>Biblioteka jest pusta. Dodaj folder przyciskiem + na głównym ekranie.</p>}
        </section>

        {groups && shown.length === 0 && (
          <div className="empty" style={{ height: '30vh' }}><div><Copy size={40} strokeWidth={1.2} style={{ margin: '0 auto 10px' }} />
            <p style={{ margin: 0 }}>Nie znaleziono duplikatów. Spróbuj poziomu „Podobne”, żeby znaleźć też warianty tego samego ujęcia.</p></div></div>
        )}

        {shown.length > 0 && folderStats.length > 1 && (
          <section className="sec" aria-label="Ważniejszy katalog">
            <h2 className="sec-h"><i><FolderOpen size={17} /></i>Który katalog jest ważniejszy?</h2>
            <p style={{ margin: '0 2px 8px', color: 'var(--muted)', fontSize: 13 }}>
              Kliknij katalogi w kolejności ważności (1 = najważniejszy). Zdjęcie z ważniejszego katalogu jest „główne” i zostaje, a jego kopie z innych katalogów są zaznaczane do Kosza. Bez wyboru główne jest największe i najlepsze.
            </p>
            <div style={{ display: 'grid', gap: 6 }}>
              {folderStats.map(([dir, n]) => {
                const rank = order.indexOf(dir)
                return (
                  <div key={dir} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className={`chip${rank >= 0 ? ' on' : ''}`} aria-pressed={rank >= 0} aria-label={`${rank >= 0 ? `Ważność ${rank + 1}: ` : 'Ustaw jako ważniejszy: '}${dir}`} onClick={() => pickFolder(dir)}
                      style={{ minWidth: 44, justifyContent: 'center' }}>{rank >= 0 ? `${rank + 1}` : '○'}</button>
                    <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: 13.5, userSelect: 'text' }} title={dir}>{dir} <span style={{ color: 'var(--muted)' }}>({n})</span></span>
                    <button className="ico" aria-label={`Pokaż w Eksploratorze: ${dir}`} title="Pokaż katalog w Eksploratorze" onClick={() => revealInExplorer(dir).catch((e) => say(`Nie udało się otworzyć Eksploratora: ${e}`, 'err'))}><FolderOpen size={17} /></button>
                  </div>
                )
              })}
            </div>
            {order.length > 0 && <button className="wide" onClick={() => applyOrder([])}>Wyczyść kolejność katalogów</button>}
          </section>
        )}

        {shown.map((g, gi) => {
          const list = members(g)
          const keep = bestOf(list, order).id
          return (
            <section key={g.ids.join('-')} className="sec" aria-label={`Grupa ${gi + 1}`}>
              <h2 className="sec-h"><i><Copy size={17} /></i>
                Grupa {gi + 1}<span style={{ font: '400 13px system-ui', color: 'var(--muted)' }}>{list.length} {pl(list.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} · {g.kind === 'exact' ? 'identyczne' : 'podobne'}</span>
              </h2>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                {list.map((p) => {
                  const del = marked.has(p.id)
                  return (
                    <div key={p.id} className="item" style={{ display: 'block', margin: 0, padding: 8, opacity: del ? 0.75 : 1, borderColor: del ? 'var(--err)' : undefined }}>
                      <button className="bare relative block w-full overflow-hidden" aria-label={`Podgląd ${p.name}`} onClick={() => onOpen(p.id, list)}
                        style={{ aspectRatio: '4 / 3', borderRadius: 'var(--r-md)' }}>
                        <Thumb photo={p} fit="contain" />
                        {p.id === keep && (
                          <span className="chip on" style={{ position: 'absolute', left: 6, top: 6, minHeight: 26, padding: '2px 9px', fontSize: 12, background: 'var(--panel)' }}><Crown size={12} /> {order.length ? 'Główne' : 'Najlepsze'}</span>
                        )}
                        {p.id !== keep && order.length > 0 && (
                          <span className="chip" style={{ position: 'absolute', left: 6, top: 6, minHeight: 26, padding: '2px 9px', fontSize: 12, background: 'var(--panel)' }}>Duplikat</span>
                        )}
                      </button>
                      <div className="truncate" style={{ fontWeight: 600, fontSize: 13.5, marginTop: 6 }} title={p.path}>{p.name}</div>
                      <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12 }}>
                        {p.width ? `${p.width}×${p.height} px · ` : ''}{mb(p.size)}
                      </small>
                      <small style={{ display: 'block', color: 'var(--muted)', fontSize: 12, wordBreak: 'break-all', userSelect: 'text' }} title={p.path}>
                        {dirOf(p)}{p.taken ? ` · ${p.taken.slice(0, 10)}` : ''}
                      </small>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0', minHeight: 36, cursor: 'pointer', color: del ? 'var(--err)' : 'var(--text)', fontSize: 13 }}>
                        <input type="checkbox" checked={del} onChange={() => toggle(g, p.id)} style={{ width: 20, height: 20, accentColor: 'var(--err)' }} />
                        {del ? 'Do Kosza' : 'Zostaw'}
                      </label>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {shown.length > 0 && (
        <div className="glass" style={{ position: 'fixed', zIndex: 5, left: '50%', transform: 'translateX(-50%)', bottom: 'calc(20px + var(--sab))', width: 'min(94vw, 560px)', borderRadius: 'var(--r-lg)', padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 6, fontSize: 13.5 }}>
            <b>{markedList.length}</b> do Kosza<div style={{ color: 'var(--muted)', fontSize: 12 }}>{mb(markedBytes)} do odzyskania</div>
          </div>
          <button className="danger" style={{ minHeight: 46 }} disabled={!markedList.length || deleting} onClick={() => setConfirm(true)}>
            <span className="inline-flex items-center gap-2"><Trash2 size={17} /> {deleting ? 'Przenoszę…' : 'Przenieś do Kosza'}</span>
          </button>
        </div>
      )}

      {confirm && (
        <>
          <div className="fixed inset-0 z-[10]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setConfirm(false)} />
          <div className="glass fixed left-1/2 top-1/2 z-[11] w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 p-5" style={{ borderRadius: 'var(--r-lg)' }} role="alertdialog" aria-label="Potwierdzenie">
            <h2 style={{ margin: 0, font: '700 20px/1.2 system-ui' }}>Przenieść do Kosza?</h2>
            <p style={{ color: 'var(--muted)', margin: '6px 0 16px' }}>{markedList.length} {markedList.length === 1 ? 'plik zostanie przeniesiony' : 'plików zostanie przeniesionych'} do Kosza Windows ({mb(markedBytes)}). Możesz je stamtąd przywrócić.</p>
            {markedList.length >= 20 && (
              <>
                <label htmlFor="dup-word" style={{ marginTop: 0 }}>Aby potwierdzić, wpisz USUŃ</label>
                <input id="dup-word" type="text" value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
              </>
            )}
            <button className="danger wide" style={{ marginTop: 10 }} disabled={markedList.length >= 20 && word.trim() !== 'USUŃ'} onClick={doTrash}>Przenieś do Kosza</button>
            <button className="wide" onClick={() => setConfirm(false)}>Anuluj</button>
          </div>
        </>
      )}
    </div>
  )
}
