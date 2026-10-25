import { useCallback, useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { MapView } from './MapView'
import { Duplicates } from './Duplicates'
import { addTag, deleteTag, inTauri, listPhotos, pickFolder, refreshLibrary, removeTag, scanFolder, setFavorite, setRating, type Photo } from './api'
import { TagEditor, type TagCount } from './TagEditor'
import { Thumb } from './Thumb'
import { Viewer } from './Viewer'
import { Collage } from './Collage'
import { Justified } from './Justified'
import { Chip, Sec, Toast } from './ui'
import {
  Images, FolderOpen, Users, MapPin, Heart, Star, Plus, Play, Maximize2, X,
  SlidersHorizontal, Search as SearchIcon, ImageUp, Ruler, LayoutDashboard, Check, ListChecks, Tag, CalendarDays, Copy, RefreshCw,
} from './FiboIcons'

type Mode = 'library' | 'albums' | 'favs' | 'people' | 'map'
type Sort = 'date-desc' | 'date-asc' | 'name'
type Group = 'year' | 'month' | 'none'

/** Data zrobienia zdjęcia (EXIF), a gdy jej nie ma, data modyfikacji pliku. Format: RRRR-MM-DD GG:MM:SS. */
const whenOf = (p: Photo) => (p.taken && /^\d{4}-\d{2}/.test(p.taken) ? p.taken : new Date(p.modified * 1000).toISOString().replace('T', ' '))
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']

const TABS: { id: Mode; icon: typeof Images; label: string }[] = [
  { id: 'library', icon: Images, label: 'Biblioteka' },
  { id: 'albums', icon: FolderOpen, label: 'Albumy' },
  { id: 'favs', icon: Heart, label: 'Ulubione' },
  { id: 'people', icon: Users, label: 'Ludzie' },
  { id: 'map', icon: MapPin, label: 'Mapa' },
]

// Podgląd w przeglądarce (bez Tauri) pokazuje kafle demonstracyjne.
const DEMO: Photo[] = Array.from({ length: 48 }, (_, i) => ({
  id: -(i + 1), path: '', name: `demo-${i}.jpg`, size: 0, modified: 0, taken: null,
  width: null, height: null, camera: null, rating: i % 6, favorite: i % 7 === 0, tags: [],
  // Podgląd w przeglądarce: kilka miejsc na świecie, żeby było co zobaczyć na globusie.
  ...(i % 4 === 0 ? { lat: 52.23 + (i % 3) * 0.0001, lon: 21.01 } : i % 4 === 1 ? { lat: 48.86, lon: 2.35 } : i % 4 === 2 ? { lat: 40.71, lon: -74.0 } : { lat: null, lon: null }),
}))

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

export default function App() {
  const [mode, setMode] = useState<Mode>('library')
  const [size, setSize] = useState(200)
  const [sel, setSel] = useState<number[]>([])
  const [anchor, setAnchor] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [collage, setCollage] = useState(false)
  const [original, setOriginal] = useState(() => { try { return localStorage.getItem('grid-original') !== '0' } catch { return true } })
  const selected = sel.length === 1 ? sel[0] : null
  const setSelected = (id: number | null) => { setSel(id === null ? [] : [id]); setAnchor(id) }
  const [viewer, setViewer] = useState<{ id: number; autoplay: boolean; list?: Photo[] } | null>(null)
  const [dupOpen, setDupOpen] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<Photo[]>(inTauri ? [] : DEMO)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [toast, setToast] = useState<{ text: string; kind?: 'ok' | 'err' } | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [minStars, setMinStars] = useState(0)
  const [sort, setSort] = useState<Sort>('date-desc')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [tagDlg, setTagDlg] = useState(false)
  const [confirm, setConfirm] = useState<{ text: string; yes: string; run: () => void } | null>(null)
  const [group, setGroupState] = useState<Group>(() => {
    try { const v = localStorage.getItem('group'); return v === 'month' || v === 'none' ? v : 'year' } catch { return 'year' }
  })
  const setGroup = (g: Group) => { setGroupState(g); try { localStorage.setItem('group', g) } catch { /* brak pamięci */ } }

  const say = useCallback((text: string, kind?: 'ok' | 'err') => {
    setToast({ text, kind })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 7000)
  }, [])

  const reload = useCallback(async () => { if (inTauri) setAll(await listPhotos()) }, [])
  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!inTauri) return
    const un = listen<number>('scan-progress', (e) => { setProgress(e.payload); reload() })
    return () => { un.then((f) => f()) }
  }, [reload])

  const addFolder = async () => {
    try {
      const dir = await pickFolder()
      if (!dir) return
      setDrawer(false)
      setBusy(true)
      setProgress(0)
      const n = await scanFolder(dir)
      await reload()
      say(`Gotowe: ${n} zdjęć`, 'ok')
    } catch (e) {
      say(`Błąd skanowania: ${e}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    if (!inTauri) return say('Wczytywanie lokalizacji działa tylko w aplikacji.')
    setRefreshing(true)
    try {
      const n = await refreshLibrary()
      await reload()
      say(`Odświeżono dane ${n} zdjęć`, 'ok')
    } catch (e) {
      say(`Błąd odświeżania: ${e}`, 'err')
    } finally {
      setRefreshing(false)
    }
  }

  const onlyFav = mode === 'favs'
  const photos = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = all.filter((p) =>
      (!folder || dirOf(p.path) === folder) &&
      (!onlyFav || p.favorite) &&
      p.rating >= minStars &&
      activeTags.every((t) => p.tags.includes(t)) &&
      (!q || `${p.name} ${p.camera ?? ''} ${p.tags.join(' ')}`.toLowerCase().includes(q)),
    )
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }))
    else list.sort((a, b) => (sort === 'date-desc' ? whenOf(b).localeCompare(whenOf(a)) : whenOf(a).localeCompare(whenOf(b))))
    return list
  }, [all, query, folder, onlyFav, minStars, sort, activeTags])

  // Foldery od najnowszego; rok albumu to rok jego najnowszego zdjęcia (jak w Picasie).
  const folders = useMemo(() => {
    const map = new Map<string, Photo[]>()
    for (const p of all) {
      const d = dirOf(p.path)
      map.set(d, [...(map.get(d) ?? []), p])
    }
    const newest = (l: Photo[]) => l.reduce((m, p) => (whenOf(p) > m ? whenOf(p) : m), '')
    return [...map.entries()]
      .map(([dir, list]): [string, Photo[], string] => [dir, list.sort((a, b) => whenOf(b).localeCompare(whenOf(a))), newest(list)])
      .sort((a, b) => b[2].localeCompare(a[2]))
  }, [all])
  const foldersByYear = useMemo(() => {
    const out: { year: string; items: [string, Photo[], string][] }[] = []
    for (const f of folders) {
      const year = f[2].slice(0, 4) || '—'
      const last = out[out.length - 1]
      if (last?.year === year) last.items.push(f); else out.push({ year, items: [f] })
    }
    return out
  }, [folders])

  // Sekcje biblioteki według lat lub miesięcy, tylko przy sortowaniu po dacie.
  const sections = useMemo(() => {
    if (sort === 'name' || group === 'none') return [{ key: 'all', title: '', year: '', items: photos }]
    const out: { key: string; title: string; year: string; items: Photo[] }[] = []
    for (const p of photos) {
      const w = whenOf(p)
      const year = w.slice(0, 4)
      const key = group === 'month' ? w.slice(0, 7) : year
      const last = out[out.length - 1]
      if (last?.key === key) last.items.push(p)
      else out.push({ key, year, title: group === 'month' ? `${MONTHS[+w.slice(5, 7) - 1] ?? ''} ${year}` : year, items: [p] })
    }
    return out
  }, [photos, sort, group])
  const years = useMemo(() => [...new Set(sections.map((s) => s.year))].filter(Boolean), [sections])
  const jumpToYear = (y: string) => document.getElementById(`g-${sections.find((s) => s.year === y)?.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const allTags = useMemo<TagCount[]>(() => {
    const m = new Map<string, number>()
    for (const p of all) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'))
  }, [all])

  // Tagi: najpierw zmiana w bazie, potem w widoku (nazwa po normalizacji wraca z backendu).
  const tagPhotos = async (ids: number[], tag: string, add: boolean) => {
    const real = ids.filter((i) => i >= 0)
    if (!real.length) return say('Tagi działają tylko na prawdziwych zdjęciach.')
    try {
      if (add) {
        const name = await addTag(real, tag)
        setAll((l) => l.map((p) => (real.includes(p.id) && !p.tags.includes(name) ? { ...p, tags: [...p.tags, name].sort() } : p)))
      } else {
        await removeTag(real, tag)
        setAll((l) => l.map((p) => (real.includes(p.id) ? { ...p, tags: p.tags.filter((t) => t !== tag) } : p)))
        setActiveTags((a) => a.filter((t) => t !== tag || all.some((p) => p.tags.includes(t) && !real.includes(p.id))))
      }
    } catch (e) {
      say(`Błąd tagów: ${e}`, 'err')
    }
  }
  const dropTag = (tag: string) => setConfirm({
    text: `Usunąć tag „${tag}” ze wszystkich zdjęć? Same zdjęcia zostaną.`, yes: 'Usuń tag',
    run: async () => {
      try {
        await deleteTag(tag)
        setAll((l) => l.map((p) => ({ ...p, tags: p.tags.filter((t) => t !== tag) })))
        setActiveTags((a) => a.filter((t) => t !== tag))
        say(`Usunięto tag „${tag}”`, 'ok')
      } catch (e) { say(`Błąd: ${e}`, 'err') }
    },
  })
  const toggleTagFilter = (t: string) => setActiveTags((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))

  const patch = (id: number, change: Partial<Photo>) =>
    setAll((list) => list.map((p) => (p.id === id ? { ...p, ...change } : p)))
  const current = all.find((p) => p.id === selected) ?? null
  const chosen = useMemo(() => photos.filter((p) => sel.includes(p.id)), [photos, sel])

  /** Kliknięcie w zdjęcie: zwykłe zaznacza jedno, Ctrl dokłada, Shift zaznacza zakres. */
  const pick = (id: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey && anchor !== null) {
      const a = photos.findIndex((p) => p.id === anchor), b = photos.findIndex((p) => p.id === id)
      if (a >= 0 && b >= 0) { setSel(photos.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id)); return }
    }
    if (e.ctrlKey || e.metaKey || selectMode) {
      setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); setAnchor(id)
    } else setSelected(id)
  }
  const setGridMode = (v: boolean) => { setOriginal(v); try { localStorage.setItem('grid-original', v ? '1' : '0') } catch { /* brak pamięci */ } }
  const startCollage = () => {
    if (chosen.length < 2) return say('Zaznacz co najmniej dwa zdjęcia: Ctrl lub Shift przy kliknięciu, albo tryb zaznaczania w menu.')
    setCollage(true)
  }
  const cycleRating = () => {
    if (!current) return
    const rating = (current.rating + 1) % 6
    patch(current.id, { rating })
    if (inTauri) setRating(current.id, rating)
  }
  const toggleFav = () => {
    if (!current) return
    patch(current.id, { favorite: !current.favorite })
    if (inTauri) setFavorite(current.id, !current.favorite)
  }
  const openViewer = (id: number, autoplay = false, list?: Photo[]) => { if (inTauri && id >= 0) setViewer({ id, autoplay, list }) }
  const slideshow = () => {
    if (!photos.length) return say('Brak zdjęć do pokazu. Dodaj folder przyciskiem +.')
    setDrawer(false)
    openViewer(current && photos.includes(current) ? current.id : photos[0].id, true)
  }

  // "Wstecz" zamyka kolejno warstwy: szuflada, potem aplikacja (podgląd obsługuje Esc sam).
  useEffect(() => {
    if (viewer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirm) setConfirm(null)
      else if (tagDlg) setTagDlg(false)
      else setDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, confirm, tagDlg])

  const multi = sel.length > 1 || selectMode
  const tile = (p: Photo, ratio43: boolean) => {
    const on = sel.includes(p.id)
    return (
      <button
        key={p.id}
        onClick={(e) => pick(p.id, e)}
        onDoubleClick={() => openViewer(p.id)}
        onKeyDown={(e) => { if (e.key === 'Enter') openViewer(p.id) }}
        aria-label={`${p.name}, ocena ${p.rating}${p.favorite ? ', ulubione' : ''}`}
        aria-pressed={on}
        className={`bare group relative overflow-hidden text-left ${ratio43 ? 'aspect-[4/3]' : 'h-full w-full'}`}
        style={{ borderRadius: 'var(--r-card)', boxShadow: on ? '0 0 0 3px var(--accent)' : 'var(--elev-1)' }}
      >
        <Thumb photo={p} />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-2 opacity-0 transition group-hover:opacity-100" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.65))' }}>
          <span className="flex gap-0.5 text-amber-300">
            {Array.from({ length: p.rating }).map((_, k) => <Star key={k} size={13} fill="currentColor" />)}
          </span>
        </div>
        {p.favorite && <Heart size={16} className="absolute right-2 top-2 fill-rose-400 text-rose-400" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }} />}
        {multi && (
          <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full"
            style={{ background: on ? 'var(--accent)' : 'rgba(0,0,0,.45)', border: '2px solid #fff', color: '#fff' }} aria-hidden>
            {on && <Check size={14} strokeWidth={3} />}
          </span>
        )}
      </button>
    )
  }

  const filtersOn = minStars > 0 || sort !== 'date-desc' || !!folder || activeTags.length > 0
  const subtitle = busy ? `Skanowanie… ${progress}` : `${photos.length} z ${all.length} ${pl(all.length, 'zdjęcia', 'zdjęć', 'zdjęć')}`

  return (
    <div className="h-full">
      {/* Czysty ekran główny: menu, jedna akcja i pływający pasek zakładek */}
      <button id="menuBtn" className={`glass ${busy ? 'rec' : ''}`} aria-label="Menu" aria-expanded={drawer} aria-controls="drawer" onClick={() => setDrawer(true)}>
        <span className="bars" />
      </button>

      <nav id="tabs" className="glass" aria-label="Widoki">
        {TABS.map((t) => (
          <button key={t.id} className={mode === t.id ? 'active' : ''} aria-current={mode === t.id ? 'page' : undefined}
            onClick={() => { setMode(t.id); if (t.id === 'albums') setFolder(null) }}>
            <t.icon size={19} strokeWidth={1.8} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <button className="fab glass" aria-label="Dodaj folder ze zdjęciami" title="Dodaj folder" onClick={addFolder}>
        <Plus size={22} strokeWidth={2} />
      </button>

      {/* Szuflada */}
      <div id="drawerScrim" className={drawer ? 'open' : ''} onClick={() => setDrawer(false)} />
      <aside id="drawer" className={`glass ${drawer ? 'open' : ''}`} aria-hidden={!drawer} aria-label="Narzędzia" inert={!drawer}>
        <div className="dr-head">
          <span className="flex items-center gap-3">
            <img src="/brand/fibo-ikona.svg" alt="" width={34} height={34} style={{ borderRadius: 9 }} />
            FIBO
          </span>
          <button className="ico" aria-label="Zamknij menu" onClick={() => setDrawer(false)}><X size={22} /></button>
        </div>
        <div className="dr-body">
          <div>
            <h5>Szukaj</h5>
            <label htmlFor="q" style={{ margin: '0 0 4px' }}>Nazwa pliku, aparat lub tag</label>
            <input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="np. wakacje" />
          </div>

          <div>
            <h5>Szybkie akcje</h5>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: ImageUp, label: 'Dodaj folder', fn: addFolder, on: false },
                { icon: Play, label: 'Pokaz slajdów', fn: slideshow, on: false },
                { icon: ListChecks, label: selectMode ? 'Zaznaczanie włączone' : 'Zaznaczanie wielu', fn: () => { setSelectMode((v) => !v); setDrawer(false) }, on: selectMode },
                { icon: LayoutDashboard, label: chosen.length > 1 ? `Kolaż (${chosen.length})` : 'Kolaż', fn: () => { setDrawer(false); startCollage() }, on: false },
                { icon: Copy, label: 'Duplikaty', fn: () => { setDrawer(false); setDupOpen(true) }, on: false },
                { icon: RefreshCw, label: refreshing ? 'Odświeżanie…' : 'Odśwież dane zdjęć', fn: () => { setDrawer(false); refresh() }, on: false },
              ].map((a) => (
                <button key={a.label} onClick={a.fn} aria-pressed={a.on} className="flex flex-col items-center gap-2 text-center"
                  style={{ background: a.on ? 'color-mix(in srgb, var(--accent) 28%, var(--panel))' : 'var(--tonal)', border: 0, minHeight: 84, fontWeight: 600, fontSize: 13.5 }}>
                  <a.icon size={24} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />{a.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h5>Filtry</h5>
            <Sec id="filters" icon={<SlidersHorizontal size={17} />} title="Ocena i sortowanie"
              hint={filtersOn ? 'Filtry aktywne' : 'Wszystkie zdjęcia'} defaultOpen>
              <label>Minimalna ocena</label>
              <div className="chips">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <Chip key={n} on={minStars === n} onClick={() => setMinStars(n)} label={n ? `Co najmniej ${n} gwiazdek` : 'Dowolna ocena'}>
                    {n === 0 ? 'Wszystkie' : <>{n} <Star size={12} fill="currentColor" /></>}
                  </Chip>
                ))}
              </div>
              <label>Sortowanie</label>
              <div className="chips">
                {([['date-desc', 'Najnowsze'], ['date-asc', 'Najstarsze'], ['name', 'Nazwa']] as [Sort, string][]).map(([v, l]) => (
                  <Chip key={v} on={sort === v} onClick={() => setSort(v)}>{l}</Chip>
                ))}
              </div>
            </Sec>
            <Sec id="tags" icon={<Tag size={17} />} title="Tagi"
              hint={activeTags.length ? `Wybrane: ${activeTags.join(', ')}` : `${allTags.length} ${pl(allTags.length, 'tag', 'tagi', 'tagów')}`}>
              {allTags.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Brak tagów. Zaznacz zdjęcie i dotknij ikony tagu na pasku na dole.</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>Wybranie kilku tagów pokazuje zdjęcia mające wszystkie z nich.</p>
                  <div className="chips">
                    {allTags.map((t) => (
                      <Chip key={t.name} on={activeTags.includes(t.name)} onClick={() => { toggleTagFilter(t.name); setMode((m) => (m === 'library' || m === 'favs' ? m : 'library')) }}>
                        {t.name} <b>{t.count}</b>
                      </Chip>
                    ))}
                  </div>
                  {activeTags.length === 1 && (
                    <button className="danger wide" onClick={() => dropTag(activeTags[0])}>Usuń tag „{activeTags[0]}” ze wszystkich zdjęć</button>
                  )}
                  {activeTags.length > 0 && <button className="wide" onClick={() => setActiveTags([])}>Pokaż wszystkie zdjęcia</button>}
                </>
              )}
            </Sec>
            <Sec id="folders" icon={<FolderOpen size={17} />} title="Foldery" hint={folder ? folderName(folder) : `${folders.length} ${pl(folders.length, 'folder', 'foldery', 'folderów')}`}>
              <div className="chips">
                <Chip on={!folder} onClick={() => setFolder(null)}>Wszystkie <b>{all.length}</b></Chip>
                {folders.slice(0, 40).map(([dir, list]) => (
                  <Chip key={dir} on={folder === dir} onClick={() => { setFolder(dir); setMode('library'); setDrawer(false) }}>
                    {folderName(dir)} <b>{list.length}</b>
                  </Chip>
                ))}
              </div>
              {folders.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Brak folderów. Dodaj pierwszy przyciskiem Dodaj folder.</p>}
            </Sec>
            <Sec id="look" icon={<Ruler size={17} />} title="Wygląd" hint={original ? 'Oryginalne proporcje' : 'Równe kafelki 4:3'}>
              <label>Układ miniatur</label>
              <div className="chips">
                <Chip on={original} onClick={() => setGridMode(true)}>Oryginalne proporcje</Chip>
                <Chip on={!original} onClick={() => setGridMode(false)}>Równe kafelki</Chip>
              </div>
              <label>Grupowanie według daty zdjęcia</label>
              <div className="chips">
                {([['year', 'Lata'], ['month', 'Miesiące'], ['none', 'Bez grup']] as [Group, string][]).map(([v, l]) => (
                  <Chip key={v} on={group === v} onClick={() => setGroup(v)}>{l}</Chip>
                ))}
              </div>
              {sort === 'name' && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>Przy sortowaniu po nazwie grupy są wyłączone.</p>}
              <label htmlFor="sz">Rozmiar miniatur</label>
              <input id="sz" type="range" min={120} max={360} value={size} onChange={(e) => setSize(+e.target.value)} />
            </Sec>
          </div>
        </div>
      </aside>

      <main className="h-full overflow-y-auto" style={{ padding: 'calc(82px + var(--sat)) 20px 100px' }}>
        {(mode === 'library' || mode === 'favs') && (
          <>
            <div style={{ marginBottom: 14 }}>
              <h1 style={{ margin: 0, font: '700 22px/1.2 system-ui' }}>{mode === 'favs' ? 'Ulubione' : folder ? folderName(folder) : 'Biblioteka'}</h1>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{subtitle}</div>
              {years.length > 1 && (
                <div className="chips" style={{ marginTop: 10 }} role="navigation" aria-label="Przejdź do roku">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 13 }}><CalendarDays size={15} /> Rok</span>
                  {years.map((y) => <Chip key={y} onClick={() => jumpToYear(y)}>{y}</Chip>)}
                </div>
              )}
              {(query || folder || minStars > 0 || activeTags.length > 0) && (
                <div className="chips" style={{ marginTop: 10 }}>
                  {activeTags.map((t) => <Chip key={t} on onClick={() => toggleTagFilter(t)} label={`Usuń filtr tagu ${t}`}><Tag size={13} /> {t} <X size={13} /></Chip>)}
                  {query && <Chip on onClick={() => setQuery('')} label="Usuń szukanie"><SearchIcon size={13} /> {query} <X size={13} /></Chip>}
                  {folder && <Chip on onClick={() => setFolder(null)} label="Usuń filtr folderu"><FolderOpen size={13} /> {folderName(folder)} <X size={13} /></Chip>}
                  {minStars > 0 && <Chip on onClick={() => setMinStars(0)} label="Usuń filtr oceny">≥ {minStars} <Star size={12} fill="currentColor" /> <X size={13} /></Chip>}
                </div>
              )}
            </div>

            {photos.length === 0 && (
              <div className="empty" style={{ height: '50vh' }}>
                <div>
                  <Images size={44} strokeWidth={1.2} style={{ margin: '0 auto 10px' }} />
                  <p style={{ margin: 0 }}>
                    {all.length === 0 ? 'Brak zdjęć. Dotknij + w prawym górnym rogu i wskaż folder.'
                      : mode === 'favs' ? 'Brak ulubionych. Zaznacz zdjęcie i dotknij serca.' : 'Brak wyników. Zmień filtry w menu.'}
                  </p>
                </div>
              </div>
            )}

            {sections.map((s) => (
              <section key={s.key} id={`g-${s.key}`} style={{ marginBottom: 28, scrollMarginTop: 'calc(82px + var(--sat))' }}>
                {s.title && (
                  <h2 style={{ margin: '0 0 12px', font: '650 18px/1.2 system-ui', display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    {s.title}<span style={{ font: '400 13px system-ui', color: 'var(--muted)' }}>{s.items.length} {pl(s.items.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
                  </h2>
                )}
                {original ? (
                  <Justified photos={s.items} rowHeight={Math.round(size * 0.9)}>{(p) => tile(p, false)}</Justified>
                ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
                    {s.items.map((p) => tile(p, true))}
                  </div>
                )}
              </section>
            ))}
          </>
        )}

        {mode === 'albums' && (
          <>
            <h1 style={{ margin: '0 0 14px', font: '700 22px/1.2 system-ui' }}>Albumy</h1>
            {folders.length === 0 && <div className="empty" style={{ height: '50vh' }}>Brak albumów. Dotknij + i dodaj folder ze zdjęciami.</div>}
            {foldersByYear.map((g) => (
              <section key={g.year} style={{ marginBottom: 28 }}>
                <h2 style={{ margin: '0 0 12px', font: '650 18px/1.2 system-ui' }}>{g.year}</h2>
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size + 40}px, 1fr))` }}>
                  {g.items.map(([dir, list, newest]) => (
                    <button key={dir} className="bare text-left" onClick={() => { setFolder(dir); setMode('library') }}>
                      <div className="relative aspect-[4/3] overflow-hidden" style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--elev-1)' }}>
                        <Thumb photo={list[0]} />
                      </div>
                      <div className="mt-2 truncate" style={{ fontWeight: 600 }}>{folderName(dir)}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                        {newest.slice(0, 10).split('-').reverse().join('.')} · {list.length} {pl(list.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {mode === 'people' && (
          <div className="empty" style={{ height: '60vh' }}>
            <div>
              <h1 style={{ margin: '0 0 6px', font: '700 22px/1.2 system-ui' }}>Ludzie</h1>
              <p style={{ margin: 0 }}>Rozpoznawanie twarzy pojawi się razem z funkcjami AI.</p>
            </div>
          </div>
        )}
      </main>

      {mode === 'map' && (
        <MapView
          photos={photos}
          total={all.length}
          refreshing={refreshing}
          onRefresh={refresh}
          onOpen={(id) => openViewer(id)}
        />
      )}

      {/* Pływający pasek akcji zaznaczonego zdjęcia */}
      {current && !viewer && (
        <div className="glass fixed left-1/2 z-[1050] flex -translate-x-1/2 items-center gap-1 p-1.5" style={{ bottom: 'calc(20px + var(--sab))', borderRadius: 'var(--r-lg)' }}>
          <button className="ico" aria-label="Otwórz i edytuj" title="Otwórz i edytuj (dwuklik)" onClick={() => openViewer(current.id)}><Maximize2 size={20} /></button>
          <button className="ico" aria-label={`Ocena ${current.rating} z 5, zmień`} title={`Ocena: ${current.rating}`} onClick={cycleRating}>
            <Star size={20} fill={current.rating ? 'currentColor' : 'none'} />
          </button>
          <button className={`ico ${current.favorite ? 'on' : ''}`} aria-label="Ulubione" aria-pressed={current.favorite} onClick={toggleFav}>
            <Heart size={20} fill={current.favorite ? 'currentColor' : 'none'} />
          </button>
          <button className="ico" aria-label="Tagi" title="Tagi" onClick={() => setTagDlg(true)}><Tag size={20} /></button>
          <button className="ico" aria-label="Kolaż z zaznaczonych" title="Kolaż: zaznacz więcej zdjęć (Ctrl lub Shift)" onClick={startCollage}><LayoutDashboard size={20} /></button>
          <button className="ico" aria-label="Odznacz" onClick={() => setSelected(null)}><X size={20} /></button>
        </div>
      )}
      {sel.length > 1 && !viewer && !collage && (
        <div className="glass fixed left-1/2 z-[1050] flex -translate-x-1/2 items-center gap-1 p-1.5" style={{ bottom: 'calc(20px + var(--sab))', borderRadius: 'var(--r-lg)' }}>
          <span style={{ padding: '0 12px', fontWeight: 600 }}>{sel.length} {pl(sel.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
          <button className="ico" style={{ minWidth: 'auto', padding: '0 14px', gap: 8, display: 'flex', alignItems: 'center', fontWeight: 600 }} aria-label="Tagi zaznaczonych zdjęć" onClick={() => setTagDlg(true)}>
            <Tag size={20} /> Tagi
          </button>
          <button className="ico" style={{ minWidth: 'auto', padding: '0 14px', gap: 8, display: 'flex', alignItems: 'center', color: 'var(--accent)', fontWeight: 600 }} aria-label="Utwórz kolaż" onClick={startCollage}>
            <LayoutDashboard size={20} /> Kolaż
          </button>
          <button className="ico" aria-label="Odznacz wszystkie" onClick={() => setSelected(null)}><X size={20} /></button>
        </div>
      )}

      {collage && chosen.length > 1 && (
        <Collage
          photos={chosen}
          onClose={() => setCollage(false)}
          onSaved={async (newId) => { await reload(); setSelected(newId) }}
          say={say}
        />
      )}

      {tagDlg && chosen.length > 0 && (
        <>
          <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setTagDlg(false)} />
          <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Tagi">
            <div className="dr-head" style={{ paddingBottom: 0 }}>
              <span>Tagi</span>
              <button className="ico" aria-label="Zamknij" onClick={() => setTagDlg(false)}><X size={22} /></button>
            </div>
            <div style={{ padding: '4px 16px 8px', color: 'var(--muted)', fontSize: 13 }}>{chosen.length} {pl(chosen.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</div>
            <div className="sheet-body" style={{ padding: '0 16px 16px' }}>
              <TagEditor photos={chosen} allTags={allTags}
                onAdd={(t) => tagPhotos(chosen.map((p) => p.id), t, true)} onRemove={(t) => tagPhotos(chosen.map((p) => p.id), t, false)} />
            </div>
          </div>
        </>
      )}

      {confirm && (
        <>
          <div className="fixed inset-0 z-[1900]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setConfirm(null)} />
          <div className="glass fixed left-1/2 top-1/2 z-[2000] w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 p-5" style={{ borderRadius: 'var(--r-lg)' }} role="alertdialog" aria-label="Potwierdzenie">
            <p style={{ margin: '0 0 16px', fontSize: 16 }}>{confirm.text}</p>
            <button className="danger wide" style={{ marginTop: 0 }} onClick={() => { const c = confirm; setConfirm(null); c.run() }}>{confirm.yes}</button>
            <button className="wide" onClick={() => setConfirm(null)}>Anuluj</button>
          </div>
        </>
      )}

      <Toast text={toast?.text ?? null} kind={toast?.kind} />

      {dupOpen && (
        <Duplicates
          all={all}
          suspended={!!viewer}
          onClose={() => setDupOpen(false)}
          onOpen={(id, list) => openViewer(id, false, list)}
          onTrashed={(ids) => {
            setAll((l) => l.filter((p) => !ids.includes(p.id)))
            setSel((s) => s.filter((i) => !ids.includes(i)))
            reload()
          }}
          say={say}
        />
      )}

      {viewer && (
        <Viewer
          photos={viewer.list ?? photos}
          startId={viewer.id}
          autoplay={viewer.autoplay}
          allTags={allTags}
          onTag={tagPhotos}
          onClose={() => { setSelected(viewer.id); setViewer(null) }}
          onPatch={patch}
          onSaved={async (newId) => { await reload(); setSelected(newId) }}
        />
      )}
    </div>
  )
}
