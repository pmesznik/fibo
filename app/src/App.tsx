import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { MapView } from './MapView'
import { People, FaceImg } from './People'
import { ExportDialog } from './ExportDialog'
import { ProgressDock, reportJob } from './ProgressDock'
import { CreditsDialog } from './CreditsDialog'
import { PersonFacesView } from './PersonFacesView'
import { TimelineRail } from './TimelineRail'
import { CalendarMaker } from './CalendarMaker'
import { MoveFacesDialog } from './MergePeople'
import { LocationDialog } from './LocationDialog'
import { RenameDialog } from './RenameDialog'
import { DateDialog } from './DateDialog'
import { ShortcutsDialog, StatsDialog } from './HelpDialogs'
import { PropsDialog } from './PropsDialog'
import { CheckDialog } from './CheckDialog'
import { getClip, pasteEditToPhotos } from './editor/batch'
import { Duplicates } from './Duplicates'
import { UpdateDialog, useUpdater } from './Updater'
import { exportSidecars, getSidecarEnabled, importSidecars, setSidecarEnabled } from './api'
import {
  addToAlbum, createAlbum, deleteAlbum, setAlbumHidden, listAlbumOrder, setAlbumOrder, listAlbums, fillPlaces, addDropped, watchRoots, thumbCacheInfo, thumbCacheClear, listRoots, movePhotos, removeFromAlbum, removeRoot,
  renameAlbum, renamePhoto, rescanRoots, trashPhotos, listSmart, saveSmart, deleteSmart, type SmartAlbum, listLocked, setFolderLocked, revealInExplorer, openPhotoExternal, findDuplicates, indexColors, rejectPersonInPhotos, rotatePhotos, getSkipGifPng, setSkipGifPng, detectCards, listPeople, listProps, renameFolder, type Prop, type Person, personPhotos, importPhotos, backupLibrary, backupPhotos, restoreLibrary, pickFile, hidePhotos, hiddenCount, restoreHidden, type Album,
} from './api'
import { AlbumPicker, PromptDialog } from './Dialogs'
import { addTag, deleteTag, inTauri, listPhotos, pickFolder, refreshLibrary, removeTag, scanFolder, setFavorite, setRating, setFlag, setLabel, type Photo } from './api'
import { TagEditor, type TagCount } from './TagEditor'
import { Thumb } from './Thumb'
import { Viewer } from './Viewer'
import { Collage } from './Collage'
import { Justified, VirtualGrid } from './Justified'
import { Chip, Sec, Toast, useEscape } from './ui'
import { dayKey, dayLabel, memoriesFor, yearsAgo, type Memory } from './memories'
import { LABELS, flagOf, labelOf, nextMark, passesFlag } from './marks'
import { durationLabel } from './api'
import { CompareView } from './CompareView'
import { EventsDialog } from './EventsDialog'
import { ContentSearch } from './ContentSearch'
import { OrganizerDialog } from './OrganizerDialog'
import { LibraryCalendar } from './LibraryCalendar'
import { beginPointerDrag, dragJustEnded } from './pointerDrag'
import { collapseStacks, findStacks, stackCount } from './stacks'
import {
  Images, FolderOpen, Users, MapPin, Heart, Star, Plus, Play, Maximize2, X,
  Compare, SlidersHorizontal, Search as SearchIcon, ImageUp, Ruler, LayoutDashboard, Check, ListChecks, Tag, CalendarDays, Copy, RefreshCw, Download, Save, Pencil, Trash2, Eye, EyeOff, ChevronLeft, Wand2, Info, RotateCw, RotateCcw,
} from './FiboIcons'

type Mode = 'library' | 'albums' | 'favs' | 'people' | 'map'
type Sort = 'date-desc' | 'date-asc' | 'name' | 'rating' | 'size' | 'custom'
type Group = 'year' | 'month' | 'none'
type Theme = 'auto' | 'light' | 'dark'

/** Ustawia motyw na <html>; „auto” zdejmuje wymuszenie i zostaje motyw systemu. */
const applyTheme = (t: Theme) => {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}

/** Data zrobienia zdjęcia (EXIF), a gdy jej nie ma, data modyfikacji pliku. Format: RRRR-MM-DD GG:MM:SS. */
const whenOf = (p: Photo) => (p.taken && /^\d{4}-\d{2}/.test(p.taken) ? p.taken : new Date(p.modified * 1000).toISOString().replace('T', ' '))
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']

const TABS: { id: Mode; icon: typeof Images; label: string }[] = [
  { id: 'library', icon: Images, label: 'Biblioteka' },
  { id: 'albums', icon: FolderOpen, label: 'Albumy' },
  { id: 'favs', icon: Heart, label: 'Ulubione' },
  { id: 'people', icon: Users, label: 'Osoby' },
  { id: 'map', icon: MapPin, label: 'Mapa' },
]

// Podgląd w przeglądarce (bez Tauri) pokazuje kafle demonstracyjne.
const DEMO: Photo[] = Array.from({ length: 48 }, (_, i) => ({
  id: -(i + 1), path: '', name: `demo-${i}.jpg`, size: 0, modified: 0, taken: null,
  width: null, height: null, camera: null, rating: i % 6, favorite: i % 7 === 0, tags: [], albums: [],
  // Podgląd w przeglądarce: kilka miejsc na świecie, żeby było co zobaczyć na globusie.
  ...(i % 4 === 0 ? { lat: 52.23 + (i % 3) * 0.0001, lon: 21.01 } : i % 4 === 1 ? { lat: 48.86, lon: 2.35 } : i % 4 === 2 ? { lat: 40.71, lon: -74.0 } : { lat: null, lon: null }),
}))

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
/** Kolory dominujące (numery jak w backendzie: color.rs). */
const COLORS: { name: string; css: string }[] = [
  { name: 'czerwony', css: '#d93025' }, { name: 'pomarańczowy', css: '#f28b1c' }, { name: 'żółty', css: '#f4d01e' }, { name: 'zielony', css: '#2e9d3d' },
  { name: 'turkusowy', css: '#1fb8c4' }, { name: 'niebieski', css: '#2f5fd7' }, { name: 'fioletowy', css: '#7e3fc4' }, { name: 'różowy', css: '#ea6fa8' },
  { name: 'brązowy', css: '#7a4a22' }, { name: 'biały', css: '#ffffff' }, { name: 'szary', css: '#8a8f98' }, { name: 'czarny', css: '#14161a' },
]

const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
const dirOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

export default function App() {
  const [mode, setMode] = useState<Mode>('library')
  // Wielkość miniatur jest zapamiętywana między uruchomieniami.
  const [size, setSizeState] = useState(() => { try { const v = +(localStorage.getItem('thumb-size') ?? ''); return v >= 120 && v <= 360 ? v : 200 } catch { return 200 } })
  const setSize = (v: number) => { setSizeState(v); try { localStorage.setItem('thumb-size', String(v)) } catch { /* brak pamięci */ } }
  const [sel, setSel] = useState<number[]>([])
  const [anchor, setAnchor] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [collage, setCollage] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [contentOpen, setContentOpen] = useState(false)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [dayViewOpen, setDayViewOpen] = useState(false)
  /** Pliki przeciągane z Eksploratora nad oknem (pokazujemy podpowiedź „Upuść”). */
  const [fileDragOver, setFileDragOver] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<{ files: number; bytes: number } | null>(null)
  const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${(b / 1048576).toFixed(1)} MB`).replace('.', ',')
  const reloadCache = () => { thumbCacheInfo().then(setCacheInfo).catch(() => {}) }
  const askClearCache = () => setConfirm({
    text: `Wyczyścić pamięć miniatur (${cacheInfo ? `${cacheInfo.files} ${pl(cacheInfo.files, 'miniatura', 'miniatury', 'miniatur')}, ${mb(cacheInfo.bytes)}` : 'wszystkie'})? Zdjęcia zostają nietknięte, a miniatury program zrobi od nowa przy następnym pokazaniu (to chwilę potrwa). Miniatury zdjęć z zapisaną edycją zostają.`,
    yes: 'Wyczyść',
    run: async () => {
      try { const r = await thumbCacheClear(); say(`Usunięto ${r.files} ${pl(r.files, 'miniaturę', 'miniatury', 'miniatur')} (${mb(r.bytes)})`, 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
      reloadCache()
    },
  })
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
  /** Filtr „Miejsca”: nazwa miejscowości z kodu GPS zdjęcia (np. „Warszawa, Polska”). */
  const [placeFilter, setPlaceFilter] = useState<string | null>(null)
  const regionNames = useMemo(() => { try { return new Intl.DisplayNames(['pl'], { type: 'region' }) } catch { return null } }, [])
  const placeOf = useCallback((p: Photo) => (p.iptc_city || p.iptc_country ? [p.iptc_city, p.iptc_country].filter(Boolean).join(', ') : p.place ? `${p.place}${p.country ? `, ${regionNames?.of(p.country) ?? p.country}` : ''}` : ''), [regionNames])
  const [minStars, setMinStars] = useState(0)
  // Stosy: para RAW + JPEG i seria zdjęć pokazują się jako jedno zdjęcie (wyłączone domyślnie; nic się nie zmienia na dysku).
  const [stacksOn, setStacksOnState] = useState(() => { try { return localStorage.getItem('stacks-on') === '1' } catch { return false } })
  const setStacksOn = (v: boolean) => { setStacksOnState(v); setOpenStacks(new Set()); try { localStorage.setItem('stacks-on', v ? '1' : '0') } catch { /* brak pamięci */ } }
  const [openStacks, setOpenStacks] = useState<Set<number>>(() => new Set())
  const toggleStack = (leader: number) => setOpenStacks((s) => { const n = new Set(s); if (!n.delete(leader)) n.add(leader); return n })
  const [flagFilter, setFlagFilter] = useState<'' | 'pick' | 'reject' | 'keep'>('')
  const [labelFilter, setLabelFilter] = useState<number | null>(null)
  /** Rodzaj plików: wszystko, same zdjęcia albo same filmy. */
  const [kindFilter, setKindFilter] = useState<'' | 'photo' | 'video'>('')
  const [color, setColor] = useState<number | null>(null)
  // Filtry dodatkowe: zakres dat (RRRR-MM-DD) oraz zdjęcia, którym czegoś brakuje (porządkowanie biblioteki).
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [missing, setMissing] = useState<'' | 'tags' | 'geo' | 'rating'>('')
  const [sort, setSort] = useState<Sort>('date-desc')
  // Przeciąganie zdjęć: na album (pasek na dole) albo, w albumie z własną kolejnością, na inne zdjęcie.
  const [dragIds, setDragIds] = useState<number[] | null>(null)
  const [dropOver, setDropOver] = useState<number | string | null>(null)
  const [albumPos, setAlbumPos] = useState<Map<number, number>>(new Map())
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [tagDlg, setTagDlg] = useState(false)
  const [confirm, setConfirm] = useState<{ text: string; yes: string; run: () => void } | null>(null)
  const [group, setGroupState] = useState<Group>(() => {
    try { const v = localStorage.getItem('group'); return v === 'month' || v === 'none' ? v : 'year' } catch { return 'year' }
  })
  const setGroup = (g: Group) => { setGroupState(g); try { localStorage.setItem('group', g) } catch { /* brak pamięci */ } }

  const [theme, setThemeState] = useState<Theme>(() => {
    try { const v = localStorage.getItem('theme'); return v === 'light' || v === 'dark' ? v : 'auto' } catch { return 'auto' }
  })
  const setTheme = (t: Theme) => { setThemeState(t); applyTheme(t); try { localStorage.setItem('theme', t) } catch { /* brak pamięci */ } }
  useEffect(() => { applyTheme(theme) }, [theme])

  const say = useCallback((text: string, kind?: 'ok' | 'err') => {
    setToast({ text, kind })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 7000)
  }, [])

  const updater = useUpdater()
  const [sidecarOn, setSidecarOn] = useState(true)
  const [xmpBusy, setXmpBusy] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => { if (inTauri) getSidecarEnabled().then(setSidecarOn).catch(() => {}) }, [])

  const [albums, setAlbums] = useState<Album[]>([])
  const [albumId, setAlbumId] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const [prompt, setPrompt] = useState<null | {
    title: string; label: string; initial?: string; confirm: string; hint?: string
    onSubmit: (v: string) => Promise<string | void> | string | void
  }>(null)
  const [roots, setRoots] = useState<string[]>([])
  const rescanBusy = useRef(false)
  const lastRescan = useRef(0)

  const reload = useCallback(async () => { if (inTauri) setAll(await listPhotos()) }, [])
  useEffect(() => { reload() }, [reload])
  const reloadAlbums = useCallback(async () => { if (inTauri) setAlbums(await listAlbums()) }, [])
  const reloadRoots = useCallback(async () => { if (inTauri) setRoots(await listRoots()) }, [])
  // Taca: trwały koszyk zdjęć z różnych folderów i albumów; akcje działają na jej zawartości po „Zaznacz z tacy”.
  // Albumy inteligentne: zapisane zestawy filtrów (szukanie, ocena, daty, braki, tagi), których zawartość liczy się na bieżąco.
  const [smart, setSmart] = useState<SmartAlbum[]>([])
  const reloadSmart = useCallback(async () => { if (inTauri) setSmart(await listSmart()) }, [])
  useEffect(() => { reloadSmart() }, [reloadSmart])
  const [locked, setLocked] = useState<string[]>([])
  const reloadLocked = useCallback(async () => { if (inTauri) setLocked(await listLocked()) }, [])
  useEffect(() => { reloadLocked() }, [reloadLocked])
  const [together, setTogether] = useState<Person[] | null>(null)
  const [props, setPropsList] = useState<Prop[]>([])
  const [propsFor, setPropsFor] = useState<null | { kind: 'album' | 'folder'; id: string; title: string }>(null)
  const reloadProps = useCallback(async () => { if (inTauri) setPropsList(await listProps()) }, [])
  useEffect(() => { reloadProps() }, [reloadProps])
  const propOf = useMemo(() => new Map(props.map((p) => [`${p.kind}:${p.key}`, p] as [string, Prop])), [props])
  const propText = (kind: 'album' | 'folder', key: string) => { const p = propOf.get(`${kind}:${key}`); return p ? `${p.description} ${p.place} ${p.date}` : '' }
  const [folderSort, setFolderSort] = useState<'date' | 'name'>('date')
  const [tray, setTray] = useState<number[]>([])
  const [trayView, setTrayView] = useState(false)
  const [helpDlg, setHelpDlg] = useState<null | 'keys' | 'stats' | 'check'>(null)
  const [dateIds, setDateIds] = useState<number[] | null>(null)
  const [renameIds, setRenameIds] = useState<number[] | null>(null)
  const [locIds, setLocIds] = useState<number[] | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [creditIds, setCreditIds] = useState<number[] | null>(null)
  const [exportIds, setExportIds] = useState<number[] | null>(null)
  const [exportSize, setExportSize] = useState<number | undefined>(undefined)
  const [person, setPerson] = useState<{ id?: number; name: string; ids: Set<number>; memory?: boolean; ranked?: Map<number, number> } | null>(null)
  // Wspomnienia „tego dnia”: zdjęcia z tej samej daty w poprzednich latach, z kartą na górze biblioteki (do odrzucenia do końca dnia).
  const today = useMemo(() => new Date(), [])
  const [memDismissed, setMemDismissed] = useState(() => { try { return localStorage.getItem('memories-dismissed') === dayKey(new Date()) } catch { return false } })
  const dismissMemories = () => { setMemDismissed(true); try { localStorage.setItem('memories-dismissed', dayKey(today)) } catch { /* brak pamięci */ } }
  const memories = useMemo(() => memoriesFor(all, today), [all, today])
  /** Wyniki szukania po treści: widok jak wspomnienie, ale w kolejności od najlepiej pasującego. */
  const openRanked = (ids: number[], title: string) => { setPersonFacesMode(false); setPerson({ name: title, ids: new Set(ids), memory: true, ranked: new Map(ids.map((id, i) => [id, i])) }); setAlbumId(null); setFolder(null); setMode('library') }
  const openMemory = (ids: number[], title: string, prefix = 'Tego dnia: ') => { setPersonFacesMode(false); setPerson({ name: `${prefix}${title}`, ids: new Set(ids), memory: true }); setAlbumId(null); setFolder(null); setMode('library') }
  const [hiddenN, setHiddenN] = useState(0)
  const reloadHidden = useCallback(async () => { if (inTauri) setHiddenN(await hiddenCount()) }, [])
  useEffect(() => { reloadHidden() }, [reloadHidden])
  useEffect(() => { reloadAlbums(); reloadRoots() }, [reloadAlbums, reloadRoots])

  /** Szuka nowych zdjęć w obserwowanych folderach i usuwa z biblioteki zdjęcia, których plików już nie ma. */
  const rescan = useCallback(async (manual = false) => {
    if (!inTauri || rescanBusy.current) return
    rescanBusy.current = true
    lastRescan.current = Date.now()
    try {
      const r = await rescanRoots()
      if (r.added || r.removed) {
        await reload(); await reloadAlbums()
        say([r.added ? `Nowe zdjęcia: ${r.added}` : '', r.removed ? `Zniknęły z dysku: ${r.removed}` : ''].filter(Boolean).join(', '), 'ok')
      } else if (manual) {
        say('Brak nowych zdjęć w obserwowanych folderach', 'ok')
      }
    } catch (e) {
      if (manual) say(`Błąd sprawdzania folderów: ${e}`, 'err')
    } finally {
      rescanBusy.current = false
    }
  }, [reload, reloadAlbums, say])

  // Automatycznie: krótko po starcie, po powrocie do okna (najwyżej raz na 30 s) i co 5 minut.
  // Pliki i foldery upuszczone na okno z Eksploratora: po potwierdzeniu trafiają do biblioteki (foldery jako obserwowane).
  useEffect(() => {
    if (!inTauri) return
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload
      if (p.type === 'enter' || p.type === 'over') { setFileDragOver(true); return }
      setFileDragOver(false)
      if (p.type !== 'drop' || p.paths.length === 0) return
      const paths = p.paths
      setConfirm({
        text: `Dodać do biblioteki ${paths.length} ${pl(paths.length, 'upuszczony element', 'upuszczone elementy', 'upuszczonych elementów')}? Foldery zostaną dodane jako obserwowane (nowe zdjęcia pojawią się same), a pojedyncze zdjęcia dodane bez obserwowania. Pliki nie są kopiowane ani zmieniane.`,
        yes: 'Dodaj',
        run: async () => {
          try {
            const r = await addDropped(paths)
            await Promise.all([reload(), reloadRoots()])
            say(r.folders + r.files === 0 ? 'Upuszczone elementy nie zawierały zdjęć ani folderów' : `Dodano z upuszczonych elementów: ${r.added} ${pl(r.added, 'nowe zdjęcie', 'nowe zdjęcia', 'nowych zdjęć')}`, r.folders + r.files === 0 ? 'err' : 'ok')
          } catch (err) { say(`Błąd: ${err}`, 'err') }
        },
      })
    })
    return () => { un.then((f) => f()) }
  }, [reload, reloadRoots, say])

  // Natychmiastowo: system zgłasza zmiany w obserwowanych folderach, a po chwili ciszy robimy to samo sprawdzenie. Lista folderów zmienia się rzadko, więc obserwowanie ustawiamy od nowa przy jej zmianie.
  useEffect(() => { if (inTauri) watchRoots().catch(() => {}) }, [roots])
  useEffect(() => {
    if (!inTauri) return
    const un = listen('files-changed', () => rescan())
    return () => { un.then((f) => f()) }
  }, [rescan])

  useEffect(() => {
    if (!inTauri) return
    const first = window.setTimeout(() => rescan(), 2500)
    const onFocus = () => { if (Date.now() - lastRescan.current > 30000) rescan() }
    window.addEventListener('focus', onFocus)
    const every = window.setInterval(() => rescan(), 5 * 60 * 1000)
    return () => { window.clearTimeout(first); window.removeEventListener('focus', onFocus); window.clearInterval(every) }
  }, [rescan])

  useEffect(() => {
    if (!inTauri) return
    // Podczas skanu wielu zdjęć nie przeładowujemy całej biblioteki po każdej partii (to zawieszało program): najwyżej raz na 4 s.
    let timer = 0
    const un = listen<number>('scan-progress', (e) => {
      setProgress(e.payload)
      if (!timer) timer = window.setTimeout(() => { timer = 0; reload() }, 4000)
    })
    return () => { un.then((f) => f()); window.clearTimeout(timer) }
  }, [reload])

  const addFolder = async (watch = true) => {
    try {
      const dir = await pickFolder()
      if (!dir) return
      setDrawer(false)
      setBusy(true)
      setProgress(0)
      const n = await scanFolder(dir, watch)
      await reload(); await reloadRoots()
      say(n ? `Gotowe: ${n} ${pl(n, 'nowe zdjęcie', 'nowe zdjęcia', 'nowych zdjęć')}. ${watch ? 'Folder jest teraz obserwowany' : 'Folder nie jest obserwowany (skan jednorazowy)'}` : 'Brak nowych zdjęć w tym folderze', 'ok')
    } catch (e) {
      say(`Błąd skanowania: ${e}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  /** Import z karty pamięci: kopiuje zdjęcia do folderu biblioteki według daty (RRRR/RRRR-MM-DD), a potem dodaje je do biblioteki. */
  const importFromCard = async (known?: string) => {
    try {
      const src = known ?? await pickFolder('Wskaż kartę pamięci lub folder ze zdjęciami do zaimportowania')
      if (!src) return
      const dest = await pickFolder('Wskaż folder biblioteki, do którego skopiować zdjęcia')
      if (!dest) return
      setDrawer(false); setBusy(true); setProgress(0)
      const r = await importPhotos(src, dest)
      const n = await scanFolder(dest)
      await reload(); await reloadRoots()
      say(r.errors.length
        ? `Zaimportowano ${r.copied}, pominięto ${r.skipped}, błędy: ${r.errors.length} (${r.errors[0]})`
        : `Zaimportowano ${r.copied} ${pl(r.copied, 'zdjęcie', 'zdjęcia', 'zdjęć')}${r.skipped ? `, pominięto ${r.skipped} już zaimportowanych` : ''} (do biblioteki dodano ${n}). Karta nie została zmieniona`,
        r.errors.length ? 'err' : 'ok')
    } catch (e) { say(`Błąd importu: ${e}`, 'err') } finally { setBusy(false) }
  }

  // Kolory dominujące zdjęć z gotowymi miniaturami liczą się po cichu w tle, raz po starcie (nowe miniatury mają kolor od razu).
  useEffect(() => {
    if (!inTauri) return
    const t = window.setTimeout(() => { indexColors().then((r) => { if (r.done > 0) reload() }).catch(() => {}) }, 9000)
    return () => window.clearTimeout(t)
  }, [reload])

  // Ustawienie: nie dodawaj plików GIF i PNG przy skanowaniu (jak w Picasie, bo to zwykle grafiki ze stron).
  const [skipGifPng, setSkipGifPngState] = useState(false)
  useEffect(() => { if (inTauri) getSkipGifPng().then(setSkipGifPngState).catch(() => {}) }, [])
  const toggleSkipGifPng = async () => {
    try { await setSkipGifPng(!skipGifPng); setSkipGifPngState(!skipGifPng); say(!skipGifPng ? 'Pliki GIF i PNG nie będą dodawane przy skanowaniu (te już w bibliotece zostają)' : 'Skanowanie dodaje znowu także pliki GIF i PNG', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  // Karta pamięci aparatu: po podłączeniu (sprawdzamy przy starcie, po powrocie do okna i co pół minuty) proponujemy import.
  const [cardOffer, setCardOffer] = useState<string | null>(null)
  const cardSeen = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!inTauri) return
    const check = () => detectCards().then((cards) => {
      const fresh = cards.find((c) => !cardSeen.current.has(c))
      if (fresh) { cardSeen.current.add(fresh); setCardOffer(fresh) }
      setCardOffer((cur) => (cur && !cards.includes(cur) ? null : cur))
    }).catch(() => {})
    const first = window.setTimeout(check, 4000)
    const every = window.setInterval(check, 30000)
    window.addEventListener('focus', check)
    return () => { window.clearTimeout(first); window.clearInterval(every); window.removeEventListener('focus', check) }
  }, [])

  /** Obrót o 90° bez utraty jakości (JPEG: zmiana znacznika orientacji, piksele bez zmian). */
  const rotateSelected = (cw: boolean) => rotateIds(realIds(), cw)
  const rotateIds = async (ids: number[], cw: boolean) => {
    setMenu(null)
    if (!ids.length) return
    try {
      const r = await rotatePhotos(ids, cw)
      await reload()
      const parts = [r.done ? `Obrócono ${r.done} ${pl(r.done, 'zdjęcie', 'zdjęcia', 'zdjęć')} bez utraty jakości` : '', r.skipped ? `${r.skipped} w innym formacie niż JPEG obrócisz w edytorze (zapis jako kopia)` : '', r.errors.length ? `błędy: ${r.errors.length} (${r.errors[0]})` : ''].filter(Boolean)
      say(parts.join('. '), r.errors.length ? 'err' : 'ok')
    } catch (e) { say(`Błąd obrotu: ${e}`, 'err') }
  }

  // Poprawianie osób z widoku zdjęć danej osoby: zdjęcie, na którym twarz nie pasuje, można odpiąć od osoby albo przenieść do innej.
  const [moveFaces, setMoveFaces] = useState<number[] | null>(null)
  const photosOfPerson = () => (person?.id === undefined ? [] : realIds().filter((i) => person.ids.has(i)))
  const dropFromPerson = (ids: number[]) => setPerson((p) => (p ? { ...p, ids: new Set([...p.ids].filter((i) => !ids.includes(i))) } : p))
  const rejectFromPerson = async (given?: number[]) => {
    setMenu(null)
    const ids = given ?? photosOfPerson()
    if (person?.id === undefined || !ids.length) return
    try {
      await rejectPersonInPhotos(person.id, ids)
      dropFromPerson(ids); setSel([])
      say(`Odpięto od osoby „${person.name}”: ${ids.length} ${pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}. Twarze wróciły do nierozpoznanych i mogą trafić do innej osoby`, 'ok')
    } catch (e) { say(`${e}`, 'err') }
  }

  const doBackup = async () => {
    try {
      const dir = await pickFolder('Wskaż folder na kopię biblioteki')
      if (!dir) return
      const f = await backupLibrary(dir)
      say(`Kopia biblioteki zapisana: ${f}`, 'ok')
    } catch (e) { say(`Błąd kopii: ${e}`, 'err') }
  }
  /** Kopiuje na wskazany dysk nowe i zmienione zdjęcia z biblioteki; niczego nie usuwa ani w kopii, ani w źródle. */
  const doPhotoBackup = async () => {
    let un: (() => void) | undefined
    try {
      const dir = await pickFolder('Wskaż dysk lub folder na kopię zapasową zdjęć')
      if (!dir) return
      setBusy(true)
      say('Kopiuję zdjęcia na wskazany dysk…')
      un = await listen<[number, number]>('photo-backup-progress', (e) => say(`Kopia zdjęć: ${e.payload[0]} z ${e.payload[1]}…`))
      const r = await backupPhotos(dir)
      say(r.errors.length
        ? `Kopia zdjęć: skopiowano ${r.copied}, pominięto ${r.skipped} (już były), błędy: ${r.errors.length} (${r.errors[0]})`
        : `Kopia zdjęć gotowa: skopiowano ${r.copied}, pominięto ${r.skipped} już zapisanych. Nic nie zostało usunięte`, r.errors.length ? 'err' : 'ok')
    } catch (e) { say(`Błąd kopii zdjęć: ${e}`, 'err') } finally { un?.(); setBusy(false) }
  }
  const doRestore = async () => {
    try {
      const f = await pickFile('Wskaż plik kopii biblioteki FIBO', ['db'])
      if (!f) return
      setConfirm({
        text: 'Przywrócić bibliotekę z kopii? Zdjęcia, tagi, oceny, albumy i foldery zostaną zastąpione danymi z kopii (pliki zdjęć nie są ruszane). Przed zmianą FIBO zapisze kopię bezpieczeństwa obecnej biblioteki. Dane twarzy zostaną policzone od nowa.', yes: 'Przywróć z kopii',
        run: async () => {
          try {
            const n = await restoreLibrary(f)
            await Promise.all([reload(), reloadAlbums(), reloadRoots(), reloadHidden()])
            say(`Biblioteka przywrócona z kopii: ${n} ${pl(n, 'zdjęcie', 'zdjęcia', 'zdjęć')}`, 'ok')
          } catch (e) { say(`Nie udało się przywrócić: ${e}`, 'err') }
        },
      })
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    if (!inTauri) return say('Wczytywanie lokalizacji działa tylko w aplikacji.')
    setRefreshing(true)
    try {
      const n = await refreshLibrary()
      await reload()
      say(`Odświeżono dane ${n} ${pl(n, 'zdjęcia', 'zdjęć', 'zdjęć')}`, 'ok')
    } catch (e) {
      say(`Błąd odświeżania: ${e}`, 'err')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { setTray((t) => { const ids = new Set(all.map((p) => p.id)); const n = t.filter((i) => ids.has(i)); return n.length === t.length ? t : n }) }, [all])
  // Ukryte albumy nie pojawiają się na listach, w wyborze albumu ani w szukaniu.
  const visibleAlbums = useMemo(() => albums.filter((a) => !a.hidden), [albums])
  const hiddenAlbums = useMemo(() => albums.filter((a) => a.hidden), [albums])
  const albumNames = useMemo(() => new Map(visibleAlbums.map((a) => [a.id, a.name] as [number, string])), [visibleAlbums])
  const [showHiddenAlbums, setShowHiddenAlbums] = useState(false)
  // Albumy od najnowszego: wg daty najnowszego zdjęcia, puste na końcu.
  const albumsNewestFirst = useMemo(() => {
    const newest = new Map<number, string>()
    for (const p of all) for (const a of p.albums) { const w = whenOf(p); if (w > (newest.get(a) ?? '')) newest.set(a, w) }
    return [...(showHiddenAlbums ? albums : visibleAlbums)].sort((a, b) => (newest.get(b.id) ?? '').localeCompare(newest.get(a.id) ?? '') || a.name.localeCompare(b.name, 'pl'))
  }, [all, albums, visibleAlbums, showHiddenAlbums])
  const toggleAlbumHidden = async (a: Album) => {
    try { await setAlbumHidden(a.id, !a.hidden); await reloadAlbums(); say(a.hidden ? `Album „${a.name}” znów jest widoczny` : `Ukryto album „${a.name}” (nic nie skasowano; przywrócisz go przyciskiem „Pokaż ukryte albumy”)`, 'ok') }
    catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const onlyFav = mode === 'favs'
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = all.filter((p) =>
      (!folder || dirOf(p.path) === folder) &&
      (albumId === null || p.albums.includes(albumId)) &&
      (!person || person.ids.has(p.id)) &&
      (!trayView || tray.includes(p.id)) &&
      (placeFilter === null || placeOf(p) === placeFilter) &&
      (!onlyFav || p.favorite) &&
      p.rating >= minStars &&
      (kindFilter === '' || (kindFilter === 'video') === !!p.video) &&
      passesFlag(p, flagFilter) &&
      (labelFilter === null || labelOf(p) === labelFilter) &&
      (color === null || p.color === color) &&
      (!dateFrom || whenOf(p).slice(0, 10).replace(/:/g, '-') >= dateFrom) &&
      (!dateTo || whenOf(p).slice(0, 10).replace(/:/g, '-') <= dateTo) &&
      (missing === '' || (missing === 'tags' ? p.tags.length === 0 : missing === 'geo' ? p.lat == null || p.lon == null : p.rating === 0)) &&
      activeTags.every((t) => p.tags.includes(t)) &&
      (!q || `${p.name} ${p.camera ?? ''} ${p.exif ?? ''} ${p.caption ?? ''} ${p.tags.join(' ')} ${p.albums.map((a) => `${albumNames.get(a) ?? ''} ${propText('album', String(a))}`).join(' ')} ${folderName(dirOf(p.path))} ${propText('folder', dirOf(p.path))} ${placeOf(p)}`.toLowerCase().includes(q)),
    )
    if (person?.ranked) list.sort((a, b) => (person.ranked!.get(a.id) ?? 1e9) - (person.ranked!.get(b.id) ?? 1e9))
    else if (sort === 'custom' && albumId !== null) list.sort((a, b) => (albumPos.get(a.id) ?? 1e9) - (albumPos.get(b.id) ?? 1e9) || whenOf(b).localeCompare(whenOf(a)))
    else if (sort === 'custom') list.sort((a, b) => whenOf(b).localeCompare(whenOf(a)))
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }))
    else if (sort === 'rating') list.sort((a, b) => b.rating - a.rating || whenOf(b).localeCompare(whenOf(a)))
    else if (sort === 'size') list.sort((a, b) => b.size - a.size)
    else list.sort((a, b) => (sort === 'date-desc' ? whenOf(b).localeCompare(whenOf(a)) : whenOf(a).localeCompare(whenOf(b))))
    return list
  }, [all, albumNames, propOf, query, folder, albumId, person, trayView, tray, onlyFav, minStars, kindFilter, flagFilter, labelFilter, color, dateFrom, dateTo, missing, sort, activeTags, albumPos, placeFilter, placeOf])
  const stacks = useMemo(() => findStacks(all), [all])
  const stackTotal = useMemo(() => stackCount(stacks), [stacks])
  const collapsed = useMemo(() => (stacksOn && stackTotal > 0 ? collapseStacks(filtered, stacks, openStacks) : null), [stacksOn, stackTotal, filtered, stacks, openStacks])
  /** Lista pokazywana w bibliotece: po filtrach, a przy włączonych stosach ze zwiniętymi stosami. */
  const photos = collapsed ? collapsed.list : filtered

  // Foldery od najnowszego; rok albumu to rok jego najnowszego zdjęcia (jak w Picasie).
  const folders = useMemo(() => {
    const map = new Map<string, Photo[]>()
    for (const p of all) {
      const d = dirOf(p.path)
      const l = map.get(d)
      if (l) l.push(p); else map.set(d, [p])
    }
    const newest = (l: Photo[]) => l.reduce((m, p) => (whenOf(p) > m ? whenOf(p) : m), '')
    return [...map.entries()]
      .map(([dir, list]): [string, Photo[], string] => [dir, list.sort((a, b) => whenOf(b).localeCompare(whenOf(a))), newest(list)])
      .sort((a, b) => b[2].localeCompare(a[2]))
  }, [all])
  const placeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of all) { const k = placeOf(p); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl'))
  }, [all, placeOf])
  // Nazwy miejsc liczy się lokalnie z dołączonej tabeli miejscowości; zdjęcia ze współrzędnymi i bez nazwy dostają ją raz.
  const fillingPlaces = useRef(false)
  useEffect(() => { if (inTauri) reloadCache() }, [])
  useEffect(() => {
    if (!inTauri || fillingPlaces.current || !all.some((p) => p.lat != null && p.lon != null && p.place == null)) return
    fillingPlaces.current = true
    fillPlaces().then((n) => { if (n > 0) return reload() }).catch(() => {}).finally(() => { fillingPlaces.current = false })
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
    if (sort === 'name' || sort === 'rating' || sort === 'size' || (sort === 'custom' && albumId !== null) || group === 'none' || person?.ranked) return [{ key: 'all', title: '', year: '', items: photos }]
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
  }, [photos, sort, group, albumId, person?.ranked])
  const years = useMemo(() => [...new Set(sections.map((s) => s.year))].filter(Boolean), [sections])
  const [timelineIdx, setTimelineIdx] = useState(0)
  // Oś czasu: przy prawej krawędzi (domyślnie), jako pasek na górze albo wyłączona.
  type TimelineMode = 'rail' | 'bar' | 'off'
  const [timelineMode, setTimelineModeState] = useState<TimelineMode>(() => { try { const v = localStorage.getItem('timeline-mode'); return v === 'bar' || v === 'off' ? v : 'rail' } catch { return 'rail' } })
  const setTimelineMode = (m: TimelineMode) => { setTimelineModeState(m); try { localStorage.setItem('timeline-mode', m) } catch { /* brak pamięci */ } }
  // Oś czasu podąża za przewijaniem: aktywna jest ostatnia sekcja, której górna krawędź minęła nagłówek.
  const scrollTick = useRef(0)
  const syncTimeline = () => {
    if (scrollTick.current) return
    scrollTick.current = requestAnimationFrame(() => {
      scrollTick.current = 0
      if (sections.length < 2 || sections[0].key === 'all') return
      const edge = 150
      let idx = 0
      for (let i = 0; i < sections.length; i++) {
        const el = document.getElementById(`g-${sections[i].key}`)
        if (!el) continue
        if (el.getBoundingClientRect().top <= edge) idx = i; else break
      }
      setTimelineIdx((c) => (c === idx ? c : idx))
    })
  }
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
  const chosen = useMemo(() => { const set = new Set(sel); return photos.filter((p) => set.has(p.id)) }, [photos, sel])

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
  /** Porównanie 2 do 4 zaznaczonych zdjęć obok siebie (klawisz C albo przycisk na pasku zaznaczenia). */
  const startCompare = () => {
    const n = chosen.filter((p) => p.id >= 0 && !p.video).length
    if (n < 2) return say('Zaznacz od dwóch do czterech zdjęć (filmów nie porównujemy), żeby je porównać: Ctrl lub Shift przy kliknięciu.')
    if (n > 4) say('Porównuję pierwsze cztery z zaznaczonych zdjęć')
    setCompareOpen(true)
  }
  const startCollage = () => {
    if (chosen.length < 2) return say('Zaznacz co najmniej dwa zdjęcia: Ctrl lub Shift przy kliknięciu, albo tryb zaznaczania w menu.')
    setCollage(true)
  }
  // Metadane w plikach XMP obok zdjęć: automatyczny zapis, zapis zbiorczy i wczytanie.
  const toggleSidecar = async () => {
    const next = !sidecarOn
    setSidecarOn(next)
    try { await setSidecarEnabled(next) } catch (e) { setSidecarOn(!next); say(`Nie udało się zmienić ustawienia: ${e}`, 'err') }
  }
  const runExport = async () => {
    if (!inTauri) return say('Zapis do plików działa tylko w aplikacji.')
    setXmpBusy(true)
    try {
      const r = await exportSidecars()
      say(`Zapisano pliki XMP: ${r.written}${r.skipped ? `, pominięto ${r.skipped} (pliki innych programów)` : ''}${r.failed ? `, błędy: ${r.failed}` : ''}`, r.failed ? 'err' : 'ok')
    } catch (e) { say(`Błąd zapisu metadanych: ${e}`, 'err') } finally { setXmpBusy(false) }
  }
  const runImport = async () => {
    if (!inTauri) return say('Wczytywanie działa tylko w aplikacji.')
    setXmpBusy(true)
    try {
      const r = await importSidecars()
      await reload()
      say(r.files ? `Wczytano metadane z ${r.files} ${pl(r.files, 'zdjęcia', 'zdjęć', 'zdjęć')} (nowe tagi i oceny: ${r.changed})` : 'Nie znaleziono tagów ani ocen zapisanych w plikach', 'ok')
    } catch (e) { say(`Błąd wczytywania metadanych: ${e}`, 'err') } finally { setXmpBusy(false) }
  }

  // Menu kontekstowe (prawy przycisk): działa na całym zaznaczeniu.
  const rateSelected = (rating: number) => {
    for (const id of sel) { patch(id, { rating }); if (inTauri && id >= 0) setRating(id, rating) }
    setMenu(null)
  }
  /** Zmiana w wielu zdjęciach naraz (jedno przejście po bibliotece zamiast jednego na zdjęcie). */
  const patchMany = (ids: number[], change: Partial<Photo>) => {
    const set = new Set(ids)
    setAll((list) => list.map((p) => (set.has(p.id) ? { ...p, ...change } : p)))
  }
  /** Flaga selekcji zaznaczonych zdjęć: klawisz P (wybierz), X (odrzuć), U (zdejmij). Powtórzony klawisz zdejmuje flagę. */
  const flagSelected = (wanted: 1 | -1 | 0) => {
    const ids = sel.filter((i) => i >= 0)
    if (!ids.length) return
    const next = nextMark(all.filter((p) => selSet.has(p.id)).map(flagOf), wanted)
    patchMany(ids, { flag: next })
    if (inTauri) setFlag(ids, next).catch((e) => say(`Nie udało się zapisać flagi: ${e}`, 'err'))
    say(next === 1 ? 'Oznaczono jako wybrane' : next === -1 ? 'Oznaczono jako odrzucone' : 'Zdjęto flagę', 'ok')
  }
  /** Etykieta kolorowa zaznaczonych zdjęć (klawisze 6 do 9, powtórzony klawisz zdejmuje etykietę). */
  const labelSelected = (wanted: number) => {
    const ids = sel.filter((i) => i >= 0)
    if (!ids.length) return
    const next = nextMark(all.filter((p) => selSet.has(p.id)).map(labelOf), wanted)
    patchMany(ids, { label: next })
    if (inTauri) setLabel(ids, next).catch((e) => say(`Nie udało się zapisać etykiety: ${e}`, 'err'))
    say(next ? `Etykieta ${LABELS[next - 1].name}` : 'Zdjęto etykietę', 'ok')
  }
  /** Gwiazdka z tacy: dodaje wszystkie zdjęcia z tacy do ulubionych (a gdy już wszystkie są ulubione, usuwa je z ulubionych). */
  const favIds = (ids: number[]) => {
    const picked = all.filter((p) => ids.includes(p.id) && p.id >= 0)
    if (!picked.length) return
    const value = !picked.every((p) => p.favorite)
    for (const p of picked) { patch(p.id, { favorite: value }); if (inTauri) setFavorite(p.id, value) }
    say(value ? `Dodano do ulubionych: ${picked.length}` : `Usunięto z ulubionych: ${picked.length}`, 'ok')
  }
  const favSelected = () => {
    const picked = all.filter((p) => sel.includes(p.id))
    const value = !picked.every((p) => p.favorite)
    for (const p of picked) { patch(p.id, { favorite: value }); if (inTauri && p.id >= 0) setFavorite(p.id, value) }
    setMenu(null)
  }

  // Własne albumy.
  const realIds = () => sel.filter((i) => i >= 0)
  const afterAlbumChange = async () => { await reload(); await reloadAlbums() }
  const pickAlbum = async (a: Album) => {
    setPicker(false)
    try { await addToAlbum(a.id, realIds()); await afterAlbumChange(); say(`Dodano do albumu „${a.name}”: ${realIds().length}`, 'ok') }
    catch (e) { say(`Błąd albumu: ${e}`, 'err') }
  }
  const newAlbum = (thenAdd: boolean) => setPrompt({
    title: 'Nowy album', label: 'Nazwa albumu', confirm: thenAdd ? 'Utwórz i dodaj zdjęcia' : 'Utwórz album',
    onSubmit: async (name) => {
      try {
        const a = await createAlbum(name)
        if (thenAdd) await addToAlbum(a.id, realIds())
        await afterAlbumChange()
        say(thenAdd ? `Utworzono album „${a.name}” i dodano zdjęcia` : `Utworzono album „${a.name}”`, 'ok')
      } catch (e) { return String(e) }
    },
  })
  const renameAlbumPrompt = (a: Album) => setPrompt({
    title: 'Zmień nazwę albumu', label: 'Nazwa albumu', initial: a.name, confirm: 'Zapisz',
    onSubmit: async (name) => { try { await renameAlbum(a.id, name); await reloadAlbums() } catch (e) { return String(e) } },
  })
  const deleteAlbumAsk = (a: Album) => setConfirm({
    text: `Usunąć album „${a.name}”? Zdjęcia zostaną w bibliotece i na dysku, znika tylko album.`, yes: 'Usuń album',
    run: async () => {
      try { await deleteAlbum(a.id); if (albumId === a.id) setAlbumId(null); await afterAlbumChange(); say(`Usunięto album „${a.name}”`, 'ok') }
      catch (e) { say(`Błąd: ${e}`, 'err') }
    },
  })
  const leaveAlbum = async () => {
    if (albumId === null) return
    setMenu(null)
    try { await removeFromAlbum(albumId, realIds()); await afterAlbumChange(); say('Usunięto z albumu (pliki zostają na dysku)', 'ok') }
    catch (e) { say(`Błąd albumu: ${e}`, 'err') }
  }

  // Operacje na plikach: zmiana nazwy, przenoszenie, kopiowanie i Kosz.
  const renameSelected = () => {
    setMenu(null)
    const p = all.find((x) => x.id === sel[0])
    if (!p || sel.length !== 1) return
    setPrompt({
      title: 'Zmień nazwę pliku', label: 'Nowa nazwa (rozszerzenie zostaje)', initial: p.name.replace(/\.[^.]+$/, ''), confirm: 'Zmień nazwę',
      hint: 'Zmienia się plik na dysku razem z jego plikiem XMP.',
      onSubmit: async (v) => { try { const n = await renamePhoto(p.id, v); await reload(); say(`Nowa nazwa: ${n}`, 'ok') } catch (e) { return String(e) } },
    })
  }
  const moveSelected = async (copy: boolean) => {
    setMenu(null)
    const ids = realIds()
    if (!ids.length) return
    try {
      const dir = await pickFolder(copy ? 'Skopiuj zdjęcia do folderu' : 'Przenieś zdjęcia do folderu')
      if (!dir) return
      const r = await movePhotos(ids, dir, copy)
      await reload()
      say(r.errors.length ? `${copy ? 'Skopiowano' : 'Przeniesiono'} ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `${copy ? 'Skopiowano' : 'Przeniesiono'}: ${r.done}`, r.errors.length ? 'err' : 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const sizeText = (list: Photo[]) => {
    const b = list.reduce((s, p) => s + p.size, 0)
    return b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${(b / 1048576).toFixed(1)} MB`
  }
  /** Usuwa zdjęcia z biblioteki bez ruszania plików. Można je przywrócić z menu. */
  const askHide = (ids: number[], what: string) => {
    if (!ids.length) return
    const list = all.filter((p) => ids.includes(p.id))
    setConfirm({
      text: `Ukryć w FIBO ${what}: ${ids.length} ${pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} (${sizeText(list)})? Pliki zostają na dysku. Ukryte zdjęcia możesz przywrócić w menu, a ponowne dodanie folderu też je przywraca.`,
      yes: 'Ukryj w FIBO',
      run: async () => {
        try {
          const n = await hidePhotos(ids)
          setAll((l) => l.filter((p) => !ids.includes(p.id)))
          setSel([])
          await Promise.all([reloadAlbums(), reloadHidden()])
          say(`Ukryto w FIBO: ${n} (pliki zostały na dysku)`, 'ok')
        } catch (e) { say(`Nie udało się ukryć: ${e}`, 'err'); await reload() }
      },
    })
  }
  /** Przenosi pliki do Kosza Windows. Od 20 zdjęć albo dla całego folderu trzeba wpisać słowo USUŃ (sprawdza je też backend). */
  const askTrash = (ids: number[], what: string, forceTyped = false) => {
    if (!ids.length) return
    const list = all.filter((p) => ids.includes(p.id))
    const summary = `${ids.length} ${pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} (${sizeText(list)})`
    const run = async (word?: string) => {
      const n = await trashPhotos(ids, word)
      setAll((l) => l.filter((p) => !ids.includes(p.id)))
      setSel([])
      await reloadAlbums()
      say(`Przeniesiono do Kosza: ${n}`, 'ok')
    }
    if (ids.length >= 20 || forceTyped) {
      setPrompt({
        title: 'Usunąć z dysku?', confirm: 'Przenieś do Kosza', label: 'Aby potwierdzić, wpisz USUŃ',
        hint: `${what}: ${summary} trafi do Kosza Windows. Folder zostaje, usuwane są tylko zdjęcia znane FIBO, i możesz je stamtąd przywrócić.`,
        onSubmit: async (v) => {
          if (v.trim() !== 'USUŃ') return 'Wpisz dokładnie słowo USUŃ.'
          try { await run(v.trim()) } catch (e) { await reload(); return `Nie udało się przenieść do Kosza: ${e}` }
        },
      })
      return
    }
    setConfirm({
      text: `Przenieść ${what}: ${summary} do Kosza Windows? Możesz je stamtąd przywrócić.`, yes: 'Przenieś do Kosza',
      run: async () => { try { await run() } catch (e) { say(`Nie udało się przenieść do Kosza: ${e}`, 'err'); await reload() } },
    })
  }
  /** Wkleja skopiowaną edycję (korekty, efekty, napisy) na wiele zdjęć naraz; wyniki są zapisywane jako kopie obok oryginałów. */
  const pasteEditSelected = () => {
    setMenu(null)
    const ids = realIds()
    if (!ids.length) return
    if (!getClip()) return say('Schowek edycji jest pusty. Otwórz zdjęcie, zmień je i użyj „Kopiuj edycję”.')
    const list = all.filter((p) => ids.includes(p.id))
    setConfirm({
      text: `Zastosować skopiowaną edycję do ${list.length} ${pl(list.length, 'zdjęcia', 'zdjęć', 'zdjęć')}? Wyniki zostaną zapisane jako nowe kopie obok oryginałów (oryginały zostają bez zmian).`, yes: 'Zastosuj',
      run: async () => {
        try {
          setBusy(true)
          const r = await pasteEditToPhotos(list, (d, t) => { say(`Przetwarzam zdjęcia: ${d} z ${t}…`); reportJob('paste', d, t) })
          await reload()
          say(r.errors.length ? `Gotowe: ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `Gotowe: ${r.done} ${pl(r.done, 'kopia', 'kopie', 'kopii')} z zastosowaną edycją`, r.errors.length ? 'err' : 'ok')
        } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false); reportJob('paste', 0, 0, true) }
      },
    })
  }
  const trashSelected = () => { setMenu(null); askTrash(realIds(), 'zaznaczone') }
  const hideSelected = () => { setMenu(null); askHide(realIds(), 'zaznaczone') }
  const unhideAll = async () => {
    try {
      const n = await restoreHidden()
      await Promise.all([reload(), reloadHidden()])
      say(`Przywrócono do biblioteki: ${n}`, 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
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
  // Widok osoby: domyślnie wycinki twarzy jak w Picasie (z potwierdzaniem niepewnych), a po przełączeniu zwykła siatka zdjęć.
  const [personFacesMode, setPersonFacesMode] = useState(true)
  useEscape(() => setTogether(null), !!together)
  const faceView = mode === 'library' && person?.id !== undefined && personFacesMode
  const timelineAvailable = sections.length > 3 && sections[0].key !== 'all' && !faceView && (mode === 'library' || mode === 'favs')
  const railOn = timelineMode === 'rail' && timelineAvailable
  const jumpToSection = (i: number) => { setTimelineIdx(i); document.getElementById(`g-${sections[i]?.key}`)?.scrollIntoView({ block: 'start' }) }
  // Po przejściu do innej zakładki, osoby, albumu albo folderu widok zaczyna się od góry (a nie od miejsca przewinięcia poprzedniego widoku).
  useEffect(() => { document.querySelector('main')?.scrollTo({ top: 0 }) }, [mode, person?.id, albumId, folder])
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
      if (prompt || picker) return // te okna same obsługują Esc
      if (menu) setMenu(null)
      else if (confirm) setConfirm(null)
      else if (tagDlg) setTagDlg(false)
      else setDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, confirm, tagDlg, menu, prompt, picker])

  // Skróty w bibliotece: 0-5 ocena, F ulubione, ? lub F1 pomoc. Nie działają podczas pisania ani gdy otwarte jest okno.
  useEffect(() => {
    if (viewer) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '?' || e.key === 'F1') { e.preventDefault(); setHelpDlg('keys'); return }
      if (confirm || prompt || picker || tagDlg || helpDlg || collage || compareOpen || dateIds || renameIds || locIds || exportIds) return
      if (!sel.some((i) => i >= 0)) return
      if (/^[0-5]$/.test(e.key)) { e.preventDefault(); rateSelected(+e.key) }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); favSelected() }
      else if (e.key.toLowerCase() === 'c' && sel.length > 1) { e.preventDefault(); startCompare() }
      else if (e.key.toLowerCase() === 'p') { e.preventDefault(); flagSelected(1) }
      else if (e.key.toLowerCase() === 'x') { e.preventDefault(); flagSelected(-1) }
      else if (e.key.toLowerCase() === 'u') { e.preventDefault(); flagSelected(0) }
      else if (/^[6-9]$/.test(e.key)) { e.preventDefault(); labelSelected(+e.key - 5) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, sel, all, confirm, prompt, picker, tagDlg, helpDlg, collage, compareOpen, dateIds, renameIds, locIds, exportIds])

  const smartFilters = () => JSON.stringify({ query: query.trim(), minStars, dateFrom, dateTo, missing, tags: activeTags })
  const applySmart = (a: SmartAlbum) => {
    try {
      const f = JSON.parse(a.filters) as { query?: string; minStars?: number; dateFrom?: string; dateTo?: string; missing?: string; tags?: string[] }
      setQuery(String(f.query ?? '')); setMinStars(Math.max(0, Math.min(5, +(f.minStars ?? 0) || 0)))
      setDateFrom(String(f.dateFrom ?? '')); setDateTo(String(f.dateTo ?? ''))
      setMissing(f.missing === 'tags' || f.missing === 'geo' || f.missing === 'rating' ? f.missing : '')
      setActiveTags(Array.isArray(f.tags) ? f.tags.map(String).slice(0, 20) : [])
      setFolder(null); setAlbumId(null); setPerson(null); setTrayView(false); setMode('library')
    } catch { say('Nie udało się wczytać filtrów albumu', 'err') }
  }
  const saveSmartAlbum = () => setPrompt({
    title: 'Album inteligentny', label: 'Nazwa albumu', initial: '', confirm: 'Zapisz',
    hint: 'Zapisuje bieżące filtry (szukanie, ocenę, daty, braki i tagi). Zawartość albumu liczy się na bieżąco, więc nowe pasujące zdjęcia pojawią się same.',
    onSubmit: async (v) => { try { await saveSmart(v, smartFilters()); await reloadSmart(); say('Album inteligentny zapisany', 'ok') } catch (e) { return String(e) } },
  })
  const smartSummary = (a: SmartAlbum) => {
    try {
      const f = JSON.parse(a.filters) as { query?: string; minStars?: number; dateFrom?: string; dateTo?: string; missing?: string; tags?: string[] }
      return [f.query && `„${f.query}”`, f.minStars ? `co najmniej ${f.minStars} ${pl(f.minStars, 'gwiazdka', 'gwiazdki', 'gwiazdek')}` : '', (f.dateFrom || f.dateTo) ? `${f.dateFrom || '…'} – ${f.dateTo || '…'}` : '', f.missing === 'tags' ? 'bez tagów' : f.missing === 'geo' ? 'bez lokalizacji' : f.missing === 'rating' ? 'bez oceny' : '', ...(f.tags ?? []).map((t) => `#${t}`)].filter(Boolean).join(' · ') || 'Wszystkie zdjęcia'
    } catch { return '' }
  }

  const multi = sel.length > 1 || selectMode
  useEffect(() => {
    if (albumId === null || !inTauri) { setAlbumPos(new Map()); return }
    let live = true
    listAlbumOrder(albumId).then((ids) => { if (live) setAlbumPos(new Map(ids.map((id, i) => [id, i] as [number, number]))) }).catch(() => {})
    return () => { live = false }
  }, [albumId])
  const reorderMode = albumId !== null && sort === 'custom'
  useEffect(() => { if (albumId === null && sort === 'custom') setSort('date-desc') }, [albumId, sort])
  /** Przenosi przeciągane zdjęcia na miejsce wskazanego zdjęcia (w dół za nie, w górę przed nie) i zapisuje kolejność całego albumu. */
  const dropOnPhoto = async (targetId: number, moving: number[] | null = dragIds) => {
    setDragIds(null)
    if (!reorderMode || albumId === null || !moving || moving.includes(targetId)) return
    const order = all.filter((p) => p.albums.includes(albumId)).sort((a, b) => (albumPos.get(a.id) ?? 1e9) - (albumPos.get(b.id) ?? 1e9) || whenOf(b).localeCompare(whenOf(a))).map((p) => p.id)
    const forward = order.indexOf(moving[0]) < order.indexOf(targetId)
    const rest = order.filter((id) => !moving.includes(id))
    const at = rest.indexOf(targetId) + (forward ? 1 : 0)
    const next = [...rest.slice(0, at), ...order.filter((id) => moving.includes(id)), ...rest.slice(at)]
    setAlbumPos(new Map(next.map((id, i) => [id, i] as [number, number])))
    try { await setAlbumOrder(albumId, next) } catch (e) { say(`Nie udało się zapisać kolejności: ${e}`, 'err') }
  }
  /** Upuszczenie przeciąganych zdjęć na album z paska na dole. */
  const dropOnAlbum = async (a: Album, dragged: number[] | null = dragIds) => {
    const ids = (dragged ?? []).filter((i) => i >= 0)
    setDragIds(null); setDropOver(null)
    if (!ids.length) return
    try { await addToAlbum(a.id, ids); await afterAlbumChange(); say(`Dodano do albumu „${a.name}”: ${ids.length}`, 'ok') }
    catch (e) { say(`Błąd albumu: ${e}`, 'err') }
  }
  /** Upuszczenie przeciąganych zdjęć na folder z paska na dole: po potwierdzeniu pliki są przenoszone na dysku (zablokowane foldery i zajęte nazwy obsługuje przenoszenie). */
  const dropOnFolder = (dir: string, dragged: number[] | null = dragIds) => {
    const ids = (dragged ?? []).filter((i) => i >= 0)
    setDragIds(null); setDropOver(null)
    const moving = all.filter((p) => ids.includes(p.id) && dirOf(p.path) !== dir)
    if (!moving.length) { say('Te zdjęcia już są w tym folderze', 'ok'); return }
    setConfirm({
      text: `Przenieść ${moving.length} ${pl(moving.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} (${sizeText(moving)}) do folderu „${folderName(dir)}”? Pliki zmienią miejsce na dysku razem z plikami XMP i edycją.`,
      yes: 'Przenieś',
      run: async () => {
        try {
          const r = await movePhotos(moving.map((p) => p.id), dir, false)
          await reload()
          say(r.errors.length ? `Przeniesiono ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `Przeniesiono do „${folderName(dir)}”: ${r.done}`, r.errors.length ? 'err' : 'ok')
        } catch (e) { say(`Błąd: ${e}`, 'err'); await reload() }
      },
    })
  }
  /** Najnowsze funkcje upuszczania: przeciąganie zaczyna się w jednym wyrenderowaniu, a kończy w późniejszym. */
  const dropApi = useRef<{ drop: (key: string, ids: number[]) => void }>({ drop: () => {} })
  const dropOnNewAlbum = (dragged: number[] | null = dragIds) => {
    const ids = (dragged ?? []).filter((i) => i >= 0)
    setDragIds(null); setDropOver(null)
    if (!ids.length) return
    setPrompt({
      title: 'Nowy album', label: 'Nazwa albumu', confirm: 'Utwórz i dodaj zdjęcia',
      onSubmit: async (name) => {
        try {
          const a = await createAlbum(name)
          await addToAlbum(a.id, ids)
          await afterAlbumChange()
          say(`Utworzono album „${a.name}” i dodano zdjęcia`, 'ok')
        } catch (e) { return String(e) }
      },
    })
  }
  dropApi.current.drop = (key, ids) => {
    if (key === 'new') dropOnNewAlbum(ids)
    else if (key.startsWith('album:')) { const a = albums.find((x) => x.id === Number(key.slice(6))); if (a) dropOnAlbum(a, ids) }
    else if (key.startsWith('dir:')) dropOnFolder(key.slice(4), ids)
    else if (key.startsWith('photo:')) dropOnPhoto(Number(key.slice(6)), ids)
  }
  const selSet = useMemo(() => new Set(sel), [sel])
  const tile = (p: Photo, ratio43: boolean) => {
    const on = selSet.has(p.id)
    const sb = collapsed?.badges.get(p.id)
    return (
      <button
        key={p.id}
        onClick={(e) => { if (dragJustEnded()) return; pick(p.id, e) }}
        onDoubleClick={() => openViewer(p.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!sel.includes(p.id)) { setSel([p.id]); setAnchor(p.id) }
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') openViewer(p.id) }}
        data-drop={reorderMode && p.id >= 0 ? `photo:${p.id}` : undefined}
        onPointerDown={(e) => {
          if (p.id < 0) return
          const ids = sel.includes(p.id) ? sel.filter((i) => i >= 0) : [p.id]
          beginPointerDrag(e, {
            label: ids.length > 1 ? `${ids.length} ${pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}` : p.name,
            onStart: () => { if (!sel.includes(p.id)) { setSel([p.id]); setAnchor(p.id) }; setDragIds(ids) },
            onHover: (k) => setDropOver(k === null ? null : k.startsWith('album:') ? Number(k.slice(6)) : k.startsWith('photo:') ? null : k),
            onDrop: (k) => dropApi.current.drop(k, ids),
            onEnd: () => { setDragIds(null); setDropOver(null) },
          })
        }}
        aria-label={`${p.video ? 'Film ' : ''}${p.name}, ocena ${p.rating}${p.favorite ? ', ulubione' : ''}${sb?.leader ? `, stos ${sb.count} zdjęć` : ''}${flagOf(p) === 1 ? ', wybrane' : flagOf(p) === -1 ? ', odrzucone' : ''}${labelOf(p) ? `, etykieta ${LABELS[labelOf(p) - 1].name}` : ''}`}
        aria-pressed={on}
        className={`bare group relative overflow-hidden text-left ${ratio43 ? 'aspect-[4/3]' : 'h-full w-full'}`}
        style={{ borderRadius: 'var(--r-card)', boxShadow: on ? '0 0 0 3px var(--accent)' : sb?.open ? '0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent)' : 'var(--elev-1)', opacity: flagOf(p) === -1 && !on ? 0.5 : 1, contentVisibility: 'auto', containIntrinsicSize: `${size}px ${Math.round(size * 0.75)}px` }}
      >
        <Thumb photo={p} />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-2 opacity-0 transition group-hover:opacity-100" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.65))' }}>
          <span className="flex gap-0.5 text-amber-300">
            {Array.from({ length: p.rating }).map((_, k) => <Star key={k} size={13} fill="currentColor" />)}
          </span>
        </div>
        {p.video && (
          <span aria-hidden className="absolute flex items-center gap-1" style={{ left: multi ? 38 : 8, top: 8, padding: '2px 8px 2px 6px', borderRadius: 99, background: 'rgba(0,0,0,.62)', color: '#fff', fontSize: 12, fontWeight: 650 }}>
            <Play size={12} fill="currentColor" /> {durationLabel(p.duration) || 'Film'}
          </span>
        )}
        {sb?.leader && (
          <span role="button" tabIndex={0} aria-label={sb.open ? `Zwiń stos ${sb.count} zdjęć` : `Rozwiń stos ${sb.count} zdjęć`} title={sb.kind === 'pair' ? 'RAW + JPEG: kliknij, żeby pokazać oba pliki' : 'Seria zdjęć: kliknij, żeby pokazać wszystkie'}
            className="absolute left-2 bottom-2 flex items-center gap-1"
            style={{ padding: '2px 8px', borderRadius: 99, background: 'rgba(0,0,0,.62)', color: '#fff', fontSize: 12, fontWeight: 650, cursor: 'pointer', zIndex: 2 }}
            onClick={(e) => { e.stopPropagation(); toggleStack(p.id) }}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleStack(p.id) } }}>
            <Copy size={12} /> {sb.open ? 'Zwiń' : sb.kind === 'pair' ? 'RAW+JPEG' : `×${sb.count}`}
          </span>
        )}
        {(flagOf(p) !== 0 || labelOf(p) !== 0 || p.edited) && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1" aria-hidden>
            {p.edited && <span title="Zdjęcie ma zapisaną edycję (oryginał bez zmian)" style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 6, background: 'rgba(0,0,0,.62)', color: '#fff' }}><Pencil size={12} /></span>}
            {labelOf(p) !== 0 && <span style={{ width: 15, height: 15, borderRadius: '50%', background: LABELS[labelOf(p) - 1].css, border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.5)' }} />}
            {flagOf(p) === 1 && <span style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 6, background: '#30a46c', color: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.5)' }}><Check size={13} strokeWidth={3} /></span>}
            {flagOf(p) === -1 && <span style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 6, background: '#e5484d', color: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.5)' }}><X size={13} strokeWidth={3} /></span>}
          </span>
        )}
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

  const filtersOn = minStars > 0 || kindFilter !== '' || flagFilter !== '' || labelFilter !== null || color !== null || !!dateFrom || !!dateTo || missing !== '' || sort !== 'date-desc' || !!folder || activeTags.length > 0
  const selPhotos = useMemo(() => (sel.length ? all.filter((p) => selSet.has(p.id)) : []), [all, sel, selSet])
  const subtitle = busy ? `Skanowanie… ${progress}` : `${photos.length} z ${all.length} ${pl(all.length, 'zdjęcia', 'zdjęć', 'zdjęć')}${selPhotos.length ? ` · zaznaczono ${selPhotos.length} (${sizeText(selPhotos)})` : ''}`

  return (
    <div className="h-full">
      {/* Czysty ekran główny: menu, jedna akcja i pływający pasek zakładek */}
      <button id="menuBtn" className={`glass ${busy ? 'rec' : ''}`} aria-label="Menu" aria-expanded={drawer} aria-controls="drawer" onClick={() => setDrawer(true)}>
        <span className="bars" />
      </button>

      <nav id="tabs" className="glass" aria-label="Widoki">
        {TABS.map((t) => (
          <button key={t.id} className={(person && !person.memory ? 'people' : mode) === t.id ? 'active' : ''} aria-current={(person && !person.memory ? 'people' : mode) === t.id ? 'page' : undefined}
            onClick={() => { setMode(t.id); if (t.id === 'albums') setFolder(null); if (t.id === 'albums' || t.id === 'library') { setAlbumId(null); setPerson(null) } }}>
            <t.icon size={19} strokeWidth={1.8} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <button className="fab-pill glass" aria-label="Dodaj folder ze zdjęciami" title="Dodaj folder ze zdjęciami" onClick={() => addFolder(true)}>
        <Plus size={20} strokeWidth={2} /><span>Dodaj folder</span>
      </button>

      {/* Szuflada */}
      <div id="drawerScrim" className={drawer ? 'open' : ''} onClick={() => setDrawer(false)} />
      <aside id="drawer" className={`glass ${drawer ? 'open' : ''}`} aria-hidden={!drawer} aria-label="Narzędzia" inert={!drawer}>
        <div className="dr-head">
          <span className="flex items-center gap-3">
            <img src="/brand/fibo-ikona.svg" alt="" width={34} height={34} style={{ borderRadius: 9 }} />
            <span>FIBO{updater.current && <small style={{ display: 'block', font: '400 12px system-ui', color: 'var(--muted)' }}>wersja {updater.current}</small>}</span>
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
                { icon: ImageUp, label: 'Dodaj folder', fn: () => addFolder(true), on: false },
                { icon: ImageUp, label: 'Dodaj folder jednorazowo', fn: () => addFolder(false), on: false },
                { icon: Info, label: 'Sprawdź pliki', fn: () => { setDrawer(false); setHelpDlg('check') }, on: false },
                { icon: Download, label: 'Importuj z karty', fn: () => importFromCard(), on: false },
                { icon: ListChecks, label: 'Statystyki', fn: () => { setDrawer(false); setHelpDlg('stats') }, on: false },
                { icon: SlidersHorizontal, label: 'Skróty klawiszowe', fn: () => { setDrawer(false); setHelpDlg('keys') }, on: false },
                { icon: Play, label: 'Pokaz slajdów', fn: slideshow, on: false },
                { icon: ListChecks, label: selectMode ? 'Zaznaczanie włączone' : 'Zaznaczanie wielu', fn: () => { setSelectMode((v) => !v); setDrawer(false) }, on: selectMode },
                { icon: LayoutDashboard, label: chosen.length > 1 ? `Kolaż (${chosen.length})` : 'Kolaż', fn: () => { setDrawer(false); startCollage() }, on: false },
                { icon: FolderOpen, label: 'Porządkuj według daty', fn: () => { setDrawer(false); setOrganizeOpen(true) }, on: false },
                { icon: SearchIcon, label: 'Szukaj po treści zdjęć', fn: () => { setDrawer(false); setContentOpen(true) }, on: false },
                { icon: CalendarDays, label: 'Wydarzenia i podróże', fn: () => { setDrawer(false); setEventsOpen(true) }, on: false },
                { icon: CalendarDays, label: 'Widok kalendarza', fn: () => { setDrawer(false); setDayViewOpen(true) }, on: false },
                { icon: CalendarDays, label: 'Kalendarz do wydruku', fn: () => { setDrawer(false); setCalOpen(true) }, on: false },
                { icon: Copy, label: 'Duplikaty', fn: () => { setDrawer(false); setDupOpen(true) }, on: false },
                { icon: RefreshCw, label: refreshing ? 'Odświeżanie…' : 'Odśwież dane zdjęć', fn: () => { setDrawer(false); refresh() }, on: false },
                { icon: Download, label: updater.phase === 'checking' ? 'Sprawdzam…' : 'Sprawdź aktualizacje', fn: () => { setDrawer(false); updater.checkNow(true) }, on: false },
                // Ręczne sprawdzenie pokazuje wynik w oknie na środku; automatycznie FIBO pyta raz dziennie.
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
                  <Chip key={n} on={minStars === n} onClick={() => setMinStars(n)} label={n ? `Co najmniej ${n} ${pl(n, 'gwiazdka', 'gwiazdki', 'gwiazdek')}` : 'Dowolna ocena'}>
                    {n === 0 ? 'Wszystkie' : <>{n} <Star size={12} fill="currentColor" /></>}
                  </Chip>
                ))}
              </div>
              <label>Rodzaj plików</label>
              <div className="chips">
                <Chip on={kindFilter === ''} onClick={() => setKindFilter('')} label="Zdjęcia i filmy">Wszystko</Chip>
                <Chip on={kindFilter === 'photo'} onClick={() => setKindFilter('photo')} label="Tylko zdjęcia">Zdjęcia</Chip>
                <Chip on={kindFilter === 'video'} onClick={() => setKindFilter('video')} label="Tylko filmy">Filmy</Chip>
              </div>
              <label>Flaga selekcji</label>
              <div className="chips">
                <Chip on={flagFilter === ''} onClick={() => setFlagFilter('')} label="Wszystkie zdjęcia">Wszystkie</Chip>
                <Chip on={flagFilter === 'pick'} onClick={() => setFlagFilter('pick')} label="Tylko wybrane">Wybrane</Chip>
                <Chip on={flagFilter === 'reject'} onClick={() => setFlagFilter('reject')} label="Tylko odrzucone">Odrzucone</Chip>
                <Chip on={flagFilter === 'keep'} onClick={() => setFlagFilter('keep')} label="Bez odrzuconych">Bez odrzuconych</Chip>
              </div>
              <label>Etykieta kolorowa</label>
              <div className="chips">
                <Chip on={labelFilter === null} onClick={() => setLabelFilter(null)} label="Dowolna etykieta">Wszystkie</Chip>
                {LABELS.map((l, i) => (
                  <Chip key={l.name} on={labelFilter === i + 1} onClick={() => setLabelFilter(labelFilter === i + 1 ? null : i + 1)} label={`Etykieta ${l.name}`}>
                    <span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', background: l.css, display: 'inline-block' }} /> {l.name}
                  </Chip>
                ))}
              </div>
              <label>Zakres dat zdjęć</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label htmlFor="date-from" style={{ marginTop: 0, fontSize: 12 }}>Od</label><input id="date-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} /></div>
                <div style={{ flex: 1 }}><label htmlFor="date-to" style={{ marginTop: 0, fontSize: 12 }}>Do</label><input id="date-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></div>
              </div>
              <label>Kolor dominujący{color !== null ? `: ${COLORS[color].name}` : ''}</label>
              <div className="swatches" role="group" aria-label="Kolor dominujący zdjęcia">
                {COLORS.map((c, i) => (
                  <button key={c.name} className={`swatch${color === i ? ' on' : ''}`} style={{ background: c.css }} aria-label={`Kolor: ${c.name}`} aria-pressed={color === i} title={c.name} onClick={() => setColor(color === i ? null : i)} />
                ))}
              </div>
              <label>Pokaż tylko zdjęcia</label>
              <div className="chips">
                {([['', 'Wszystkie'], ['tags', 'Bez tagów'], ['geo', 'Bez lokalizacji'], ['rating', 'Bez oceny']] as ['' | 'tags' | 'geo' | 'rating', string][]).map(([v, l]) => (
                  <Chip key={v} on={missing === v} onClick={() => setMissing(v)}>{l}</Chip>
                ))}
              </div>
              <label>Sortowanie</label>
              <div className="chips">
                {([['date-desc', 'Najnowsze'], ['date-asc', 'Najstarsze'], ['name', 'Nazwa'], ['rating', 'Ocena'], ['size', 'Rozmiar pliku'], ...(albumId !== null ? [['custom', 'Własna kolejność (przeciągaj)']] : [])] as [Sort, string][]).map(([v, l]) => (
                  <Chip key={v} on={sort === v} onClick={() => setSort(v)}>{l}</Chip>
                ))}
              </div>
            </Sec>
            <Sec id="tags" icon={<Tag size={17} />} title="Tagi"
              hint={activeTags.length ? `Wybrane: ${activeTags.join(', ')}` : `${allTags.length} ${pl(allTags.length, 'tag', 'tagi', 'tagów')}`}>
              {allTags.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>Brak tagów. Zaznacz zdjęcie i kliknij ikonę tagu na pasku na dole.</p>
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
            <Sec id="xmp" icon={<Save size={17} />} title="Metadane w plikach" hint={sidecarOn ? 'Zapis do plików XMP włączony' : 'Zapis do plików XMP wyłączony'}>
              <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
                Tagi, oceny i ulubione trafiają też do plików XMP obok zdjęć (np. <code>foto.jpg.xmp</code>), więc nie zginą razem z biblioteką, a inne programy je odczytają. Zdjęcia nie są zmieniane.
                Przy dodawaniu folderu FIBO wczytuje tagi i oceny, które zdjęcia już mają (z Eksploratora Windows, Picasy i innych programów).
              </p>
              <div className="chips">
                <Chip on={sidecarOn} onClick={toggleSidecar}>Zapisuj automatycznie</Chip>
              </div>
              <button className="wide" disabled={xmpBusy} onClick={runExport}><Save size={17} /> Zapisz wszystko do plików XMP</button>
              <button className="wide" disabled={xmpBusy} onClick={runImport}><Download size={17} /> Wczytaj tagi i oceny z plików</button>
            </Sec>
            <Sec id="backup" icon={<Save size={17} />} title="Kopia zapasowa biblioteki" hint="Tagi, oceny, albumy i foldery">
              <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
                Kopia zawiera dane biblioteki (nie same zdjęcia): tagi, oceny, albumy, ulubione i listę folderów. Przydaje się przed większymi porządkami albo przy zmianie komputera.
              </p>
              <button className="wide" onClick={doBackup}><Save size={17} /> Zapisz kopię biblioteki…</button>
              <button className="wide" disabled={busy} onClick={doPhotoBackup}><Save size={17} /> Kopia zdjęć na dysk zewnętrzny…</button>
              <button className="wide" onClick={doRestore}><Download size={17} /> Przywróć z kopii…</button>
            </Sec>
            <Sec id="cache" icon={<ImageUp size={17} />} title="Pamięć miniatur" hint={cacheInfo ? `${mb(cacheInfo.bytes)}, ${cacheInfo.files} ${pl(cacheInfo.files, 'miniatura', 'miniatury', 'miniatur')}` : 'Rozmiar i czyszczenie'}>
              <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
                Miniatury przyspieszają przeglądanie i zajmują miejsce na dysku. Możesz je usunąć w każdej chwili: zdjęć to nie rusza, a miniatury powstaną od nowa.
              </p>
              <button className="wide" onClick={reloadCache}><RefreshCw size={17} /> Sprawdź rozmiar</button>
              <button className="wide" onClick={askClearCache}><Trash2 size={17} /> Wyczyść pamięć miniatur…</button>
            </Sec>
            <Sec id="roots" icon={<RefreshCw size={17} />} title="Obserwowane foldery" hint={roots.length ? `${roots.length} ${pl(roots.length, 'folder', 'foldery', 'folderów')}, nowe zdjęcia dodają się same` : 'Brak obserwowanych folderów'}>
              <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
                FIBO sprawdza te foldery po uruchomieniu, po powrocie do okna i co 5 minut. Nowe zdjęcia pojawiają się same (razem z tagami i ocenami zapisanymi w pliku), a zdjęcia usunięte z dysku znikają z biblioteki.
              </p>
              <div className="chips">
                {roots.map((r) => (
                  <Chip key={r} on onClick={() => setConfirm({
                    text: `Przestać obserwować „${folderName(r)}”? Zdjęcia zostają w bibliotece, ale nowe pliki z tego folderu nie będą już dodawane.`, yes: 'Przestań obserwować',
                    run: async () => { try { await removeRoot(r); await reloadRoots() } catch (e) { say(`Błąd: ${e}`, 'err') } },
                  })} label={`Przestań obserwować ${r}`}>
                    <FolderOpen size={13} /> {folderName(r)} <X size={13} />
                  </Chip>
                ))}
              </div>
              <button className="wide" onClick={() => rescan(true)}><RefreshCw size={17} /> Sprawdź nowe zdjęcia teraz</button>
            </Sec>
            {placeCounts.length > 0 && (
              <Sec id="places" icon={<MapPin size={17} />} title="Miejsca" hint={placeFilter ?? `${placeCounts.length} ${pl(placeCounts.length, 'miejsce', 'miejsca', 'miejsc')}`}>
                <div className="chips">
                  <Chip on={placeFilter === null} onClick={() => setPlaceFilter(null)}>Wszystkie miejsca</Chip>
                  {placeCounts.slice(0, 40).map(([name, n]) => (
                    <Chip key={name} on={placeFilter === name} onClick={() => { setPlaceFilter(name); setMode('library'); setDrawer(false) }}>{name} <b>{n}</b></Chip>
                  ))}
                </div>
              </Sec>
            )}
            <Sec id="folders" icon={<FolderOpen size={17} />} title="Foldery" hint={folder ? folderName(folder) : `${folders.length} ${pl(folders.length, 'folder', 'foldery', 'folderów')}`}>
              <div className="chips" style={{ marginBottom: 8 }}>
                <Chip on={folderSort === 'date'} onClick={() => setFolderSort('date')}>Od najnowszych</Chip>
                <Chip on={folderSort === 'name'} onClick={() => setFolderSort('name')}>Po nazwie</Chip>
              </div>
              <div className="chips">
                <Chip on={!folder} onClick={() => setFolder(null)}>Wszystkie <b>{all.length}</b></Chip>
                {(folderSort === 'name' ? [...folders].sort((a, b) => folderName(a[0]).localeCompare(folderName(b[0]), 'pl', { numeric: true })) : folders).slice(0, 40).map(([dir, list]) => (
                  <Chip key={dir} on={folder === dir} onClick={() => { setFolder(dir); setMode('library'); setDrawer(false) }}>
                    {folderName(dir)} <b>{list.length}</b>
                  </Chip>
                ))}
              </div>
              {folders.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Brak folderów. Dodaj pierwszy przyciskiem Dodaj folder.</p>}
              {folder && (() => {
                const list = folders.find(([d]) => d === folder)?.[1] ?? []
                if (!list.length) return null
                const ids = list.map((p) => p.id)
                return (
                  <>
                    <button className="wide" onClick={async () => { try { await setFolderLocked(folder, !locked.includes(folder)); await reloadLocked(); say(locked.includes(folder) ? 'Folder odblokowany' : 'Folder zablokowany: FIBO nie zmieni, nie przeniesie ani nie usunie jego zdjęć', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } }}>{locked.includes(folder) ? <Eye size={17} /> : <EyeOff size={17} />} {locked.includes(folder) ? 'Odblokuj folder' : 'Zablokuj folder przed zmianami'}</button>
                    <button className="wide" onClick={async () => { try { await revealInExplorer(folder) } catch (e) { say(`Nie udało się otworzyć Eksploratora: ${e}`, 'err') } }}><FolderOpen size={17} /> Pokaż folder w Eksploratorze</button>
                    <button className="wide" onClick={() => { setDrawer(false); setPropsFor({ kind: 'folder', id: folder, title: folderName(folder) }) }}><Info size={17} /> Właściwości folderu (opis, miejsce, data)…</button>
                    <button className="wide" onClick={() => {
                      setPrompt({
                        title: 'Zmień nazwę folderu', label: 'Nowa nazwa folderu', initial: folderName(folder), confirm: 'Zmień nazwę',
                        hint: 'Zmienia się folder na dysku razem ze wszystkimi zdjęciami w środku. Inne programy, które znają starą ścieżkę, jej nie znajdą.',
                        onSubmit: async (v) => {
                          try { const np = await renameFolder(folder, v); setFolder(np); await Promise.all([reload(), reloadRoots()]); say('Nazwa folderu zmieniona', 'ok') } catch (e) { return String(e) }
                        },
                      })
                    }}><Pencil size={17} /> Zmień nazwę folderu…</button>
                    <button className="wide" onClick={() => { setDrawer(false); askHide(ids, `z folderu „${folderName(folder)}”`) }}><EyeOff size={17} /> Ukryj folder w FIBO (pliki zostają)</button>
                    <button className="wide" style={{ color: 'var(--err)' }} onClick={() => { setDrawer(false); askTrash(ids, `z folderu „${folderName(folder)}”`, true) }}><Trash2 size={17} /> Zdjęcia z folderu do Kosza…</button>
                  </>
                )
              })()}
              <div className="chips" style={{ marginTop: 10 }}>
                <Chip on={skipGifPng} onClick={toggleSkipGifPng} label="Nie dodawaj plików GIF i PNG przy skanowaniu">Pomijaj GIF i PNG przy skanowaniu</Chip>
              </div>
              {hiddenN > 0 && (
                <button className="wide" onClick={unhideAll}><Eye size={17} /> Przywróć ukryte zdjęcia ({hiddenN})</button>
              )}
            </Sec>
            <Sec id="look" icon={<Ruler size={17} />} title="Wygląd" defaultOpen
              hint={`${theme === 'auto' ? 'Motyw systemu' : theme === 'light' ? 'Jasny motyw' : 'Ciemny motyw'} · ${original ? 'oryginalne proporcje' : 'równe kafelki'}`}>
              <label>Motyw</label>
              <div className="chips">
                {([['auto', 'Jak w systemie'], ['light', 'Jasny'], ['dark', 'Ciemny']] as [Theme, string][]).map(([v, l]) => (
                  <Chip key={v} on={theme === v} onClick={() => setTheme(v)}>{l}</Chip>
                ))}
              </div>
              <label>Układ miniatur</label>
              <div className="chips">
                <Chip on={original} onClick={() => setGridMode(true)}>Oryginalne proporcje</Chip>
                <Chip on={!original} onClick={() => setGridMode(false)}>Równe kafelki</Chip>
              </div>
              <label>Oś czasu</label>
              <div className="chips">
                {([['rail', 'Przy krawędzi'], ['bar', 'Pasek na górze'], ['off', 'Wyłączona']] as [TimelineMode, string][]).map(([v, l]) => (
                  <Chip key={v} on={timelineMode === v} onClick={() => setTimelineMode(v)}>{l}</Chip>
                ))}
              </div>
              <label>Grupowanie według daty zdjęcia</label>
              <div className="chips">
                {([['year', 'Lata'], ['month', 'Miesiące'], ['none', 'Bez grup']] as [Group, string][]).map(([v, l]) => (
                  <Chip key={v} on={group === v} onClick={() => setGroup(v)}>{l}</Chip>
                ))}
              </div>
              {(sort === 'name' || sort === 'rating' || sort === 'size' || (sort === 'custom' && albumId !== null)) && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>Przy tym sortowaniu grupy są wyłączone.</p>}
              <label htmlFor="sz">Rozmiar miniatur</label>
              <input id="sz" type="range" min={120} max={360} value={size} onChange={(e) => setSize(+e.target.value)} />
            </Sec>
          </div>
        </div>
      </aside>

      <main className="h-full overflow-y-auto" onScroll={syncTimeline} style={{ padding: `calc(82px + var(--sat)) ${railOn ? 58 : 20}px 100px 20px` }}>
        {(mode === 'library' || mode === 'favs') && (
          <>
            <div style={{ marginBottom: 14 }}>
              {person && !person.memory && (
                <button className="chip" style={{ marginBottom: 8 }} aria-label="Wróć do listy osób" onClick={() => { setPerson(null); setMode('people') }}>
                  <ChevronLeft size={15} /> Osoby
                </button>
              )}
              {!person && mode === 'library' && (albumId !== null || folder) && (
                <button className="chip" style={{ marginBottom: 8 }} aria-label="Wróć do albumów i folderów" onClick={() => { setAlbumId(null); setFolder(null); setMode('albums') }}>
                  <ChevronLeft size={15} /> Albumy
                </button>
              )}
              {person?.memory && (
                <button className="chip" style={{ marginBottom: 8 }} aria-label="Wróć do biblioteki" onClick={() => setPerson(null)}>
                  <ChevronLeft size={15} /> Biblioteka
                </button>
              )}
              <h1 style={{ margin: 0, font: '700 22px/1.2 system-ui' }}>{mode === 'favs' ? 'Ulubione' : person ? person.name : albumId !== null ? (albums.find((a) => a.id === albumId)?.name ?? 'Album') : folder ? folderName(folder) : 'Biblioteka'}</h1>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{subtitle}</div>
              {(() => {
                const pr = albumId !== null ? propOf.get(`album:${albumId}`) : folder ? propOf.get(`folder:${folder}`) : undefined
                if (!pr) return null
                const meta = [pr.date && pr.date.split('-').reverse().join('.'), pr.place].filter(Boolean).join(' · ')
                return <div style={{ marginTop: 6, fontSize: 13.5 }}>{meta && <b>{meta}</b>}{meta && pr.description ? ' · ' : ''}<span style={{ color: 'var(--muted)' }}>{pr.description}</span></div>
              })()}
              {mode === 'library' && !person && !folder && albumId === null && !query && !trayView && !memDismissed && memories.length > 0 && (
                <div className="glass" role="region" aria-label="Wspomnienia z tego dnia" style={{ marginTop: 12, borderRadius: 'var(--r-lg)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <CalendarDays size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
                  <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <b style={{ fontSize: 14.5 }}>Tego dnia ({dayLabel(today)})</b>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>{memories.reduce((n, m) => n + m.ids.length, 0)} {pl(memories.reduce((n, m) => n + m.ids.length, 0), 'zdjęcie', 'zdjęcia', 'zdjęć')} z poprzednich lat</div>
                  </div>
                  <div className="chips" style={{ flex: '2 1 240px' }}>
                    {memories.slice(0, 6).map((m: Memory) => (
                      <Chip key={m.year} onClick={() => openMemory(m.ids, `${dayLabel(today)} ${m.year}`)} label={`Zdjęcia z ${m.year}`}>{m.year} · {yearsAgo(today, m.year)} · {m.ids.length}</Chip>
                    ))}
                    {memories.length > 1 && <Chip onClick={() => openMemory(memories.flatMap((m) => m.ids), dayLabel(today))} label="Wszystkie zdjęcia z tego dnia">Wszystkie</Chip>}
                  </div>
                  <button className="ico" aria-label="Ukryj wspomnienia do jutra" title="Ukryj do jutra" onClick={dismissMemories}><X size={16} /></button>
                </div>
              )}
              {mode === 'library' && !person && stackTotal > 0 && (
                <div className="chips" style={{ marginTop: 10 }}>
                  <Chip on={stacksOn} onClick={() => setStacksOn(!stacksOn)} label={stacksOn ? 'Pokaż wszystkie zdjęcia osobno' : 'Zwiń serie zdjęć i pary RAW + JPEG w stosy'}>
                    <Copy size={13} /> {stacksOn ? `Stosy włączone (${stackTotal})` : `Stosy: ${stackTotal} ${pl(stackTotal, 'seria lub para', 'serie lub pary', 'serii lub par')}`}
                  </Chip>
                </div>
              )}
              {!faceView && !railOn && years.length > 1 && (
                <div className="chips" style={{ marginTop: 10 }} role="navigation" aria-label="Przejdź do roku">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 13 }}><CalendarDays size={15} /> Rok</span>
                  {years.map((y) => <Chip key={y} onClick={() => jumpToYear(y)}>{y}</Chip>)}
                </div>
              )}
              {(query || placeFilter !== null || folder || albumId !== null || person || trayView || minStars > 0 || kindFilter !== '' || flagFilter !== '' || labelFilter !== null || color !== null || dateFrom || dateTo || missing || activeTags.length > 0) && (
                <div className="chips" style={{ marginTop: 10 }}>
                  {activeTags.map((t) => <Chip key={t} on onClick={() => toggleTagFilter(t)} label={`Usuń filtr tagu ${t}`}><Tag size={13} /> {t} <X size={13} /></Chip>)}
                  {query && <Chip on onClick={() => setQuery('')} label="Usuń szukanie"><SearchIcon size={13} /> {query} <X size={13} /></Chip>}
                  {placeFilter !== null && <Chip on onClick={() => setPlaceFilter(null)} label="Usuń filtr miejsca"><MapPin size={13} /> {placeFilter} <X size={13} /></Chip>}
                  {albumId !== null && <Chip on onClick={() => setAlbumId(null)} label="Pokaż całą bibliotekę"><FolderOpen size={13} /> Album: {albums.find((a) => a.id === albumId)?.name ?? '…'} <X size={13} /></Chip>}
                  {(query.trim() || minStars > 0 || dateFrom || dateTo || missing || activeTags.length > 0) && <Chip onClick={saveSmartAlbum} label="Zapisz filtry jako album inteligentny"><Star size={13} /> Zapisz jako album inteligentny</Chip>}
                  {trayView && <Chip on onClick={() => setTrayView(false)} label="Pokaż całą bibliotekę"><ListChecks size={13} /> Taca <X size={13} /></Chip>}
                  {person && <Chip on onClick={() => setPerson(null)} label="Pokaż całą bibliotekę"><Users size={13} /> {person.name} <X size={13} /></Chip>}
                  {person?.id !== undefined && <Chip on={personFacesMode} onClick={() => setPersonFacesMode(true)} label="Pokaż twarze">Twarze</Chip>}
                  {person?.id !== undefined && <Chip on={!personFacesMode} onClick={() => setPersonFacesMode(false)} label="Pokaż zdjęcia">Zdjęcia</Chip>}
                  {person && <Chip onClick={slideshow} label="Pokaz zdjęć tej osoby"><Play size={13} /> Pokaz zdjęć</Chip>}
                  {person && !person.memory && <Chip onClick={async () => { try { setTogether((await listPeople()).filter((o) => !o.ignored)) } catch (e) { say(`Błąd: ${e}`, 'err') } }} label="Pokaż tylko zdjęcia razem z inną osobą"><Users size={13} /> Razem z…</Chip>}
                  {folder && <Chip on onClick={() => setFolder(null)} label="Usuń filtr folderu"><FolderOpen size={13} /> {folderName(folder)} <X size={13} /></Chip>}
                  {(dateFrom || dateTo) && <Chip on onClick={() => { setDateFrom(''); setDateTo('') }} label="Usuń filtr dat"><CalendarDays size={13} /> {dateFrom || '…'} – {dateTo || '…'} <X size={13} /></Chip>}
                  {missing && <Chip on onClick={() => setMissing('')} label="Usuń filtr braków">{missing === 'tags' ? 'Bez tagów' : missing === 'geo' ? 'Bez lokalizacji' : 'Bez oceny'} <X size={13} /></Chip>}
                  {color !== null && <Chip on onClick={() => setColor(null)} label="Usuń filtr koloru"><span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', background: COLORS[color].css, border: '1px solid var(--glass-line)', display: 'inline-block' }} /> {COLORS[color].name} <X size={13} /></Chip>}
                  {kindFilter && <Chip on onClick={() => setKindFilter('')} label="Usuń filtr rodzaju">{kindFilter === 'video' ? 'Filmy' : 'Zdjęcia'} <X size={13} /></Chip>}
                  {flagFilter && <Chip on onClick={() => setFlagFilter('')} label="Usuń filtr flagi">{flagFilter === 'pick' ? 'Wybrane' : flagFilter === 'reject' ? 'Odrzucone' : 'Bez odrzuconych'} <X size={13} /></Chip>}
                  {labelFilter !== null && <Chip on onClick={() => setLabelFilter(null)} label="Usuń filtr etykiety"><span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', background: LABELS[labelFilter - 1].css, display: 'inline-block' }} /> {LABELS[labelFilter - 1].name} <X size={13} /></Chip>}
                  {minStars > 0 && <Chip on onClick={() => setMinStars(0)} label="Usuń filtr oceny">≥ {minStars} <Star size={12} fill="currentColor" /> <X size={13} /></Chip>}
                </div>
              )}
            </div>

            {timelineMode === 'bar' && timelineAvailable && (
              <div style={{ position: 'sticky', top: 'calc(70px + var(--sat))', zIndex: 5, margin: '-6px -20px 14px', padding: '8px 20px', background: 'var(--glass)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', gap: 10 }} role="group" aria-label="Oś czasu">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 13 }}><CalendarDays size={15} /> Oś czasu</span>
                <input type="range" aria-label="Oś czasu: przesuń, aby przejść do miesiąca lub roku" min={0} max={sections.length - 1} step={1}
                  value={Math.min(timelineIdx, sections.length - 1)} style={{ flex: 1, maxWidth: 420, direction: 'rtl' }}
                  onChange={(e) => { const i = +e.target.value; setTimelineIdx(i); document.getElementById(`g-${sections[i].key}`)?.scrollIntoView({ block: 'start' }) }} />
                <span style={{ minWidth: 90, fontSize: 13, fontWeight: 600 }}>{sections[Math.min(timelineIdx, sections.length - 1)]?.title}</span>
              </div>
            )}

            {faceView && person?.id !== undefined ? (
              <PersonFacesView personId={person.id} name={person.name} say={say}
                onOpen={(pid) => openViewer(pid, false, photos.some((p) => p.id === pid) ? photos : undefined)}
                onPhotoGone={(pid) => dropFromPerson([pid])} onChanged={() => {}} />
            ) : (
              <>
            {photos.length === 0 && (
              <div className="empty" style={{ height: '50vh' }}>
                <div>
                  <Images size={44} strokeWidth={1.2} style={{ margin: '0 auto 10px' }} />
                  <p style={{ margin: 0 }}>
                    {all.length === 0 ? 'Brak zdjęć. Kliknij + w prawym górnym rogu i wskaż folder.'
                      : mode === 'favs' ? 'Brak ulubionych. Zaznacz zdjęcie i kliknij serce.' : 'Brak wyników. Zmień filtry w menu.'}
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
                  <VirtualGrid photos={s.items} size={size}>{(p) => tile(p, true)}</VirtualGrid>
                )}
              </section>
            ))}
              </>
            )}
          </>
        )}

        {mode === 'albums' && (
          <>
            <h1 style={{ margin: '0 0 14px', font: '700 22px/1.2 system-ui' }}>Albumy</h1>

            <section style={{ marginBottom: 28 }}>
              <h2 style={{ margin: '0 0 12px', font: '650 18px/1.2 system-ui', display: 'flex', alignItems: 'center', gap: 12 }}>
                Moje albumy
                <button className="chip" onClick={() => { setSel([]); newAlbum(false) }}><Plus size={14} /> Nowy album</button>
                {hiddenAlbums.length > 0 && <button className="chip" onClick={() => setShowHiddenAlbums((v) => !v)}>{showHiddenAlbums ? <EyeOff size={14} /> : <Eye size={14} />} {showHiddenAlbums ? 'Schowaj ukryte albumy' : `Pokaż ukryte albumy (${hiddenAlbums.length})`}</button>}
              </h2>
              {albumsNewestFirst.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
                  Nie masz jeszcze własnych albumów. Załóż album przyciskiem powyżej albo zaznacz zdjęcia, kliknij prawym przyciskiem i wybierz „Dodaj do albumu…”.
                </p>
              ) : (
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size + 40}px, 1fr))` }}>
                  {albumsNewestFirst.map((a) => {
                    const cover = all.find((p) => p.albums.includes(a.id))
                    return (
                      <div key={a.id} style={a.hidden ? { opacity: 0.55 } : undefined}>
                        <button className="bare block w-full text-left" aria-label={`Album ${a.name}, ${a.count} ${pl(a.count, 'zdjęcie', 'zdjęcia', 'zdjęć')}`} onClick={() => { setAlbumId(a.id); setFolder(null); setMode('library') }}>
                          <div className="relative aspect-[4/3] overflow-hidden" style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--elev-1)', background: 'var(--tonal)' }}>
                            {cover ? <Thumb photo={cover} /> : <div className="empty" style={{ fontSize: 13 }}>Pusty album</div>}
                          </div>
                          <div className="mt-2 truncate" style={{ fontWeight: 600 }}>{a.hidden && <EyeOff size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />}{a.name}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{a.count} {pl(a.count, 'zdjęcie', 'zdjęcia', 'zdjęć')}</div>
                        </button>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <button className="ico" style={{ minWidth: 40, minHeight: 36 }} aria-label={`Właściwości albumu ${a.name}`} title="Właściwości: opis, miejsce, data" onClick={() => setPropsFor({ kind: 'album', id: String(a.id), title: a.name })}><Info size={16} /></button>
                          <button className="ico" style={{ minWidth: 40, minHeight: 36 }} aria-label={`Zmień nazwę albumu ${a.name}`} title="Zmień nazwę" onClick={() => renameAlbumPrompt(a)}><Pencil size={16} /></button>
                          <button className="ico" style={{ minWidth: 40, minHeight: 36 }} aria-label={a.hidden ? `Pokaż album ${a.name}` : `Ukryj album ${a.name}`} title={a.hidden ? 'Przywróć widoczność albumu' : 'Ukryj album (nic nie jest kasowane)'} onClick={() => toggleAlbumHidden(a)}>{a.hidden ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                          <button className="ico" style={{ minWidth: 40, minHeight: 36 }} aria-label={`Usuń album ${a.name}`} title="Usuń album (zdjęcia zostają)" onClick={() => deleteAlbumAsk(a)}><Trash2 size={16} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section style={{ marginBottom: 28 }}>
              <h2 style={{ margin: '0 0 12px', font: '650 18px/1.2 system-ui' }}>Albumy inteligentne</h2>
              {smart.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Ustaw filtry w bibliotece (szukanie, ocena, daty, braki, tagi) i kliknij „Zapisz jako album inteligentny”. Album sam pokaże wszystkie pasujące zdjęcia, także te dodane później.</p>
              ) : (
                <div className="chips">
                  {smart.map((a) => (
                    <span key={a.id} style={{ display: 'inline-flex', gap: 2 }}>
                      <button className="chip" title={smartSummary(a)} aria-label={`Album inteligentny ${a.name}: ${smartSummary(a)}`} onClick={() => applySmart(a)}><Star size={13} /> {a.name} <span style={{ color: 'var(--muted)', fontSize: 12 }}>{smartSummary(a)}</span></button>
                      <button className="chip" aria-label={`Usuń album inteligentny ${a.name}`} title="Usuń album inteligentny (zdjęcia zostają)" onClick={() => setConfirm({ text: `Usunąć album inteligentny „${a.name}”? Zdjęcia zostają w bibliotece.`, yes: 'Usuń album', run: async () => { try { await deleteSmart(a.id); await reloadSmart() } catch (e) { say(`Błąd: ${e}`, 'err') } } })}><X size={13} /></button>
                    </span>
                  ))}
                </div>
              )}
            </section>

            <h2 style={{ margin: '0 0 12px', font: '650 18px/1.2 system-ui' }}>Foldery</h2>
            {folders.length === 0 && <div className="empty" style={{ height: '30vh' }}>Brak folderów. Kliknij „Dodaj folder” i wskaż folder ze zdjęciami.</div>}
            {foldersByYear.map((g) => (
              <section key={g.year} style={{ marginBottom: 28 }}>
                <h2 style={{ margin: '0 0 12px', font: '650 18px/1.2 system-ui' }}>{g.year}</h2>
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size + 40}px, 1fr))` }}>
                  {g.items.map(([dir, list, newest]) => (
                    <div key={dir}>
                    <button className="bare block w-full text-left" onClick={() => { setFolder(dir); setMode('library') }}>
                      <div className="relative aspect-[4/3] overflow-hidden" style={{ borderRadius: 'var(--r-card)', boxShadow: 'var(--elev-1)' }}>
                        <Thumb photo={list[0]} />
                      </div>
                      <div className="mt-2 truncate" style={{ fontWeight: 600 }}>{folderName(dir)}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                        {newest.slice(0, 10).split('-').reverse().join('.')} · {list.length} {pl(list.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}
                      </div>
                    </button>
                    <button className="ico" style={{ minWidth: 40, minHeight: 36, marginTop: 4 }} aria-label={`Ukryj folder ${folderName(dir)}`} title="Ukryj folder w FIBO (pliki zostają, przywrócisz w menu)" onClick={() => askHide(list.map((p) => p.id), `z folderu „${folderName(dir)}”`)}><EyeOff size={16} /></button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {mode === 'people' && (
          <People say={say} ask={setConfirm} onChanged={() => {}}
            onOpenPerson={(name, ids, id) => { setPersonFacesMode(true); setPerson({ id, name, ids: new Set(ids) }); setAlbumId(null); setFolder(null); setMode('library') }} />
        )}
      </main>
      {railOn && <TimelineRail sections={sections.map((x) => ({ key: x.key, title: x.title, year: x.year, count: x.items.length }))} active={Math.min(timelineIdx, sections.length - 1)} onJump={jumpToSection} />}

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
          {person?.id !== undefined && person.ids.has(current.id) && (
            <>
              <button className="ico" style={{ minWidth: 'auto', padding: '0 12px', gap: 6, display: 'flex', alignItems: 'center', fontWeight: 600, color: 'var(--err)' }} aria-label={`To nie ${person.name}: odepnij od tej osoby`} title="Ta twarz nie należy do tej osoby: zdjęcie znika z jej widoku" onClick={() => rejectFromPerson([current.id])}><X size={18} /> Nie ta osoba</button>
              <button className="ico" style={{ minWidth: 'auto', padding: '0 12px', gap: 6, display: 'flex', alignItems: 'center', fontWeight: 600 }} aria-label="To inna osoba: przenieś twarz" title="Wskaż, kim jest ta osoba naprawdę" onClick={() => setMoveFaces([current.id])}><Users size={18} /> Przenieś…</button>
            </>
          )}
        </div>
      )}
      {sel.length > 1 && !viewer && !collage && !compareOpen && (
        <div className="glass fixed left-1/2 z-[1050] flex -translate-x-1/2 items-center gap-1 p-1.5" style={{ bottom: 'calc(20px + var(--sab))', borderRadius: 'var(--r-lg)' }}>
          <span style={{ padding: '0 12px', fontWeight: 600 }}>{sel.length} {pl(sel.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}</span>
          <button className="ico" style={{ minWidth: 'auto', padding: '0 14px', gap: 8, display: 'flex', alignItems: 'center', fontWeight: 600 }} aria-label="Tagi zaznaczonych zdjęć" onClick={() => setTagDlg(true)}>
            <Tag size={20} /> Tagi
          </button>
          {sel.length <= 4 && (
            <button className="ico" style={{ minWidth: 'auto', padding: '0 14px', gap: 8, display: 'flex', alignItems: 'center', fontWeight: 600 }} aria-label="Porównaj zaznaczone zdjęcia obok siebie" title="Porównaj (C)" onClick={startCompare}>
              <Compare size={20} /> Porównaj
            </button>
          )}
          <button className="ico" style={{ minWidth: 'auto', padding: '0 14px', gap: 8, display: 'flex', alignItems: 'center', color: 'var(--accent)', fontWeight: 600 }} aria-label="Utwórz kolaż" onClick={startCollage}>
            <LayoutDashboard size={20} /> Kolaż
          </button>
          <button className="ico" aria-label="Odznacz wszystkie" onClick={() => setSelected(null)}><X size={20} /></button>
        </div>
      )}

      {compareOpen && chosen.filter((p) => p.id >= 0 && !p.video).length > 1 && (
        <CompareView photos={chosen.filter((p) => p.id >= 0 && !p.video).slice(0, 4)} onClose={() => setCompareOpen(false)} onPatch={patch} say={say} />
      )}

      {collage && chosen.filter((p) => !p.video).length > 1 && (
        <Collage
          photos={chosen.filter((p) => !p.video)}
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

      {menu && sel.length > 0 && (
        <>
          <div className="fixed inset-0 z-[1890]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="glass fixed z-[1900] flex w-[370px] flex-col overflow-y-auto p-2" role="menu" aria-label="Akcje dla zaznaczonych zdjęć"
            ref={(el) => { if (el) el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8))}px` }}
            style={{ borderRadius: 'var(--r-card)', left: Math.max(8, Math.min(menu.x, window.innerWidth - 378)), top: menu.y, maxHeight: 'calc(100vh - 16px)' }}>
            <div style={{ padding: '6px 10px 8px', fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>
              {sel.length === 1 ? (all.find((p) => p.id === sel[0])?.name ?? '') : `${sel.length} ${pl(sel.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`}
            </div>
            {sel.length === 1 && (
              <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); openViewer(sel[0]) }}><Maximize2 size={18} /> Otwórz i edytuj</button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 6px' }} role="group" aria-label="Ocena">
              <span style={{ fontSize: 13, color: 'var(--muted)', width: 52 }}>Ocena</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className="ico" style={{ minWidth: 34, minHeight: 36, color: '#f5b301' }} aria-label={`Ocena ${n}`} onClick={() => rateSelected(n)}><Star size={17} /></button>
              ))}
              <button className="ico" style={{ minWidth: 34, minHeight: 36 }} aria-label="Wyczyść ocenę" title="Wyczyść ocenę" onClick={() => rateSelected(0)}><X size={16} /></button>
            </div>
            <div className="menu-grid">
            <button className="text menu-item" role="menuitem" onClick={favSelected}>
              <Heart size={18} /> {all.filter((p) => sel.includes(p.id)).every((p) => p.favorite) ? 'Z ulubionych' : 'Do ulubionych'}
            </button>
            <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); setTagDlg(true) }}><Tag size={18} /> Tagi…</button>
            {sel.length > 1 && (
              <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); startCollage() }}><LayoutDashboard size={18} /> Kolaż</button>
            )}
            <button className="text menu-item" role="menuitem" onClick={() => {
              const ids = realIds()
              const allIn = ids.every((i) => tray.includes(i))
              setTray((t) => (allIn ? t.filter((i) => !ids.includes(i)) : [...new Set([...t, ...ids])]))
              setMenu(null)
              say(allIn ? 'Usunięto z tacy' : `Dodano do tacy (razem ${new Set([...tray, ...ids]).size})`, 'ok')
            }}><ListChecks size={18} /> {realIds().every((i) => tray.includes(i)) ? 'Z tacy' : 'Do tacy'}</button>
            <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); setPicker(true) }}><FolderOpen size={18} /> Do albumu…</button>
            {albumId !== null && (
              <button className="text menu-item" role="menuitem" onClick={leaveAlbum}><X size={18} /> Z albumu</button>
            )}
            </div>
            <div className="menu-h" role="presentation">Edycja</div>
            <div className="menu-grid">
            <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); setDateIds(realIds()) }}><CalendarDays size={18} /> Zmień datę…</button>
            {person?.id !== undefined && photosOfPerson().length > 0 && (
              <>
                <button className="text menu-item" role="menuitem" style={{ gridColumn: '1 / -1' }} onClick={() => rejectFromPerson()}><X size={18} /> To nie „{person.name}”: odepnij od tej osoby</button>
                <button className="text menu-item" role="menuitem" style={{ gridColumn: '1 / -1' }} onClick={() => { setMenu(null); setMoveFaces(photosOfPerson()) }}><Users size={18} /> To inna osoba: przenieś twarz…</button>
              </>
            )}
            <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); setCreditIds(realIds()) }}><Pencil size={18} /> Autor, prawa i opis (IPTC)…</button>
            <button className="text menu-item" role="menuitem" title="Bez utraty jakości (JPEG): zmienia tylko znacznik orientacji" onClick={() => rotateSelected(true)}><RotateCw size={18} /> Obróć w prawo</button>
            <button className="text menu-item" role="menuitem" title="Bez utraty jakości (JPEG): zmienia tylko znacznik orientacji" onClick={() => rotateSelected(false)}><RotateCcw size={18} /> Obróć w lewo</button>
            <button className="text menu-item" role="menuitem" onClick={pasteEditSelected}><Wand2 size={18} /> Wklej edycję…</button>
            <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); setLocIds(realIds()) }}><MapPin size={18} /> Lokalizacja…</button>
            </div>
            <div className="menu-h" role="presentation">Plik</div>
            <div className="menu-grid">
            {sel.length === 1 && (
              <button className="text menu-item" role="menuitem" onClick={renameSelected}><Pencil size={18} /> Zmień nazwę…</button>
            )}
            {sel.length > 1 && (
              <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); setRenameIds(realIds()) }}><Pencil size={18} /> Zmień nazwy…</button>
            )}
            <button className="text menu-item" role="menuitem" onClick={() => moveSelected(false)}><ImageUp size={18} /> Przenieś…</button>
            <button className="text menu-item" role="menuitem" onClick={() => moveSelected(true)}><Copy size={18} /> Kopiuj…</button>
            {sel.length === 1 && <button className="text menu-item" role="menuitem" onClick={async () => { setMenu(null); const p = all.find((x) => x.id === sel[0]); if (p) { try { await revealInExplorer(p.path) } catch (e) { say(`Nie udało się otworzyć Eksploratora: ${e}`, 'err') } } }}><FolderOpen size={18} /> W Eksploratorze</button>}
            {sel.length === 1 && sel[0] >= 0 && <button className="text menu-item" role="menuitem" onClick={async () => { setMenu(null); try { await openPhotoExternal(sel[0]) } catch (e) { say(`Nie udało się otworzyć w programie: ${e}`, 'err') } }}><ImageUp size={18} /> W programie</button>}
            {sel.length === 1 && sel[0] >= 0 && <button className="text menu-item" role="menuitem" onClick={async () => {
              setMenu(null)
              const id = sel[0]
              say('Szukam podobnych zdjęć… (za pierwszym razem może to chwilę potrwać)')
              try {
                const groups = await findDuplicates(8)
                const ids = new Set(groups.filter((g) => g.ids.includes(id)).flatMap((g) => g.ids))
                const found = all.filter((p) => ids.has(p.id)).map((p) => p.id)
                if (found.length < 2) say('Nie znaleziono podobnych zdjęć', 'ok')
                else { setSel(found); say(`Zaznaczono ${found.length} podobnych zdjęć (z wybranym)`, 'ok') }
              } catch (e) { say(`Błąd: ${e}`, 'err') }
            }}><Copy size={18} /> Zaznacz podobne</button>}
            <button className="text menu-item" role="menuitem" onClick={() => { setMenu(null); setExportIds(realIds()) }}><Download size={18} /> Eksportuj…</button>
            </div>
            <div className="menu-h" role="presentation">Usuwanie</div>
            <button className="text menu-item" role="menuitem" onClick={hideSelected}><EyeOff size={18} /> Usuń z biblioteki (pliki zostają)…</button>
            <button className="text menu-item" role="menuitem" style={{ color: 'var(--err)' }} onClick={trashSelected}><Trash2 size={18} /> Przenieś do Kosza…</button>
            <div style={{ height: 1, background: 'var(--glass-line)', margin: '6px 6px 2px' }} />
            <div className="menu-grid">
            <button className="text menu-item" role="menuitem" onClick={() => { setSel(photos.map((p) => p.id)); setMenu(null) }}><ListChecks size={18} /> Zaznacz wszystkie ({photos.length})</button>
            <button className="text menu-item" role="menuitem" onClick={() => { setSelected(null); setMenu(null) }}><X size={18} /> Odznacz</button>
            </div>

          </div>
        </>
      )}

      {picker && sel.length > 0 && (
        <AlbumPicker albums={visibleAlbums} count={realIds().length} onPick={pickAlbum} onClose={() => setPicker(false)}
          onCreate={() => { setPicker(false); newAlbum(true) }} />
      )}
      {tray.length > 0 && (
        <div className="glass fixed flex flex-wrap items-center gap-1" role="group" aria-label="Taca zdjęć"
          style={{ left: 16, bottom: 'calc(16px + var(--sab))', zIndex: 1040, padding: '6px 8px 6px 14px', borderRadius: 'var(--r-lg)', maxWidth: 'min(94vw, 760px)' }}>
          <span style={{ fontWeight: 650, fontSize: 13.5, marginRight: 4 }}>Taca: {tray.length}</span>
          {realIds().length > 0 && <button className="chip" title="Dodaj zaznaczone zdjęcia do tacy" onClick={() => { const n = new Set([...tray, ...realIds()]); setTray([...n]); say(`Dodano do tacy (razem ${n.size})`, 'ok') }}>Zatrzymaj zaznaczone</button>}
          <button className={`chip${trayView ? ' on' : ''}`} aria-pressed={trayView} onClick={() => { setTrayView((v) => !v); setMode('library'); setAlbumId(null); setFolder(null) }}>{trayView ? 'Pokaż wszystko' : 'Pokaż tacę'}</button>
          <button className="chip" onClick={() => { setSel([...tray]); say(`Zaznaczono z tacy: ${tray.length}. Kliknij prawym przyciskiem, żeby wybrać akcję`, 'ok') }}>Zaznacz</button>
          <button className="chip" title="Dodaj zdjęcia z tacy do albumu" onClick={() => { setSel([...tray]); setPicker(true) }}><FolderOpen size={14} /> Do albumu</button>
          <button className="chip" title="Dodaj zdjęcia z tacy do ulubionych (gwiazdka)" onClick={() => favIds(tray)}><Star size={14} /> Ulubione</button>
          <button className="ico" aria-label="Obróć zdjęcia z tacy w lewo" title="Obróć w lewo (bez utraty jakości)" onClick={() => rotateIds(tray, false)}><RotateCcw size={17} /></button>
          <button className="ico" aria-label="Obróć zdjęcia z tacy w prawo" title="Obróć w prawo (bez utraty jakości)" onClick={() => rotateIds(tray, true)}><RotateCw size={17} /></button>
          <button className="chip" disabled={tray.length < 2} title="Zrób kolaż ze zdjęć z tacy" onClick={() => { setSel([...tray]); setCollage(true) }}><LayoutDashboard size={14} /> Kolaż</button>
          <button className="chip" title="Eksport lub wydruk (PDF) zdjęć z tacy" onClick={() => setExportIds([...tray])}><Download size={14} /> Eksport i druk</button>
          <button className="chip" title="Pomniejszone kopie do wysłania e-mailem (1024 px, bez lokalizacji)" onClick={() => { setExportSize(1024); setExportIds([...tray]) }}>E-mail</button>
          <button className="ico" aria-label="Wyczyść tacę" title="Wyczyść tacę" onClick={() => { setTray([]); setTrayView(false) }}><X size={18} /></button>
        </div>
      )}
      {together && person && (
        <>
          <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setTogether(null)} />
          <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Zdjęcia razem z inną osobą">
            <div className="dr-head" style={{ paddingBottom: 0 }}>
              <span>Razem z kim?</span>
              <button className="ico" aria-label="Zamknij" onClick={() => setTogether(null)}><X size={22} /></button>
            </div>
            <div style={{ padding: '4px 16px 8px', color: 'var(--muted)', fontSize: 13 }}>Pokażę tylko zdjęcia, na których są obie osoby: „{person.name}” i wybrana.</div>
            <div className="sheet-body" style={{ padding: '0 16px 16px' }}>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }}>
                {together.map((o) => (
                  <button key={o.id} className="bare text-center" aria-label={o.name ?? 'Nieznana osoba'} onClick={async () => {
                    try {
                      const ids = new Set(await personPhotos(o.id))
                      const both = [...person.ids].filter((i) => ids.has(i))
                      if (!both.length) { say(`Nie ma zdjęć, na których są razem „${person.name}” i „${o.name ?? 'Nieznana osoba'}”`); return }
                      setPerson({ name: `${person.name} i ${o.name ?? 'Nieznana osoba'}`, ids: new Set(both) }); setTogether(null)
                    } catch (e) { say(`Błąd: ${e}`, 'err') }
                  }}>
                    <div style={{ width: 64, height: 64, margin: '0 auto', borderRadius: '50%', overflow: 'hidden', background: 'var(--tonal)' }}>{o.cover !== null && <FaceImg id={o.cover} size={64} />}</div>
                    <div className="truncate" style={{ fontSize: 13, marginTop: 4 }}>{o.name ?? 'Nieznana osoba'}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {propsFor && <PropsDialog kind={propsFor.kind} id={propsFor.id} title={propsFor.title} current={propOf.get(`${propsFor.kind}:${propsFor.id}`)} say={say} onSaved={reloadProps} onClose={() => setPropsFor(null)} />}
      {helpDlg === 'check' && <CheckDialog say={say} onChanged={() => { reload(); reloadHidden() }} onClose={() => setHelpDlg(null)} />}
      {helpDlg === 'keys' && <ShortcutsDialog onClose={() => setHelpDlg(null)} />}
      {helpDlg === 'stats' && <StatsDialog photos={all} onClose={() => setHelpDlg(null)} />}
      {dateIds && dateIds.length > 0 && (
        <DateDialog photos={dateIds.map((id) => all.find((p) => p.id === id)).filter((p): p is Photo => !!p)} say={say}
          onDone={() => { reload() }} onClose={() => setDateIds(null)} />
      )}
      {renameIds && renameIds.length > 1 && (
        <RenameDialog photos={renameIds.map((id) => all.find((p) => p.id === id)).filter((p): p is Photo => !!p)} say={say}
          onDone={() => { setSel([]); reload() }} onClose={() => setRenameIds(null)} />
      )}
      {locIds && locIds.length > 0 && (() => {
        const first = all.find((p) => p.id === locIds[0] && p.lat != null && p.lon != null)
        return <LocationDialog ids={locIds} initial={first ? { lat: first.lat as number, lon: first.lon as number } : null} say={say}
          onSaved={() => { reload() }} onClose={() => setLocIds(null)} />
      })()}
      {exportIds && exportIds.length > 0 && <ExportDialog ids={exportIds} photos={all} initialSize={exportSize} say={say} onClose={() => { setExportIds(null); setExportSize(undefined) }} />}
      {prompt && <PromptDialog {...prompt} onClose={() => setPrompt(null)} />}

      <UpdateDialog u={updater} />

      {dragIds && !reorderMode && (mode === 'library' || mode === 'favs') && (
        <div className="glass fixed inset-x-3 z-[1500] flex flex-col gap-2 p-3" style={{ bottom: 'calc(12px + var(--sab))', borderRadius: 'var(--r-lg)' }} role="region" aria-label="Upuść zdjęcia na album lub folder">
          <div className="flex items-center gap-2 overflow-x-auto" style={{ width: '100%', flexWrap: 'nowrap' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Upuść na album ({dragIds.length}):</span>
          {visibleAlbums.map((a) => (
            <span key={a.id} className={`chip${dropOver === a.id ? ' on' : ''}`} style={{ flex: 'none' }} data-drop={`album:${a.id}`}>
              <FolderOpen size={14} /> {a.name}
            </span>
          ))}
          <span className={`chip${dropOver === 'new' ? ' on' : ''}`} style={{ flex: 'none' }} data-drop="new">
            <Plus size={14} /> Nowy album…
          </span>
          </div>
          {(() => {
            const targets = [...folders].filter(([d]) => !locked.includes(d)).sort((a, b) => folderName(a[0]).localeCompare(folderName(b[0]), 'pl', { numeric: true })).slice(0, 40)
            return targets.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto" style={{ width: '100%', flexWrap: 'nowrap' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Przenieś do folderu:</span>
                {targets.map(([dir]) => (
                  <span key={dir} className={`chip${dropOver === `dir:${dir}` ? ' on' : ''}`} style={{ flex: 'none' }} title={dir} data-drop={`dir:${dir}`}>
                    <FolderOpen size={14} /> {folderName(dir)}
                  </span>
                ))}
              </div>
            )
          })()}
        </div>
      )}
      {moveFaces && person?.id !== undefined && (
        <MoveFacesDialog personId={person.id} personName={person.name} photoIds={moveFaces} say={say} onClose={() => setMoveFaces(null)}
          onDone={(ids) => { dropFromPerson(ids); setSel([]) }} />
      )}
      {organizeOpen && (
        <OrganizerDialog say={say} selected={sel.filter((i) => i >= 0)} visible={filtered.filter((p) => p.id >= 0).map((p) => p.id)}
          onClose={() => setOrganizeOpen(false)} onDone={() => { reload(); reloadRoots() }} />
      )}
      {contentOpen && <ContentSearch say={say} onClose={() => setContentOpen(false)} onResults={openRanked} />}
      {eventsOpen && (
        <EventsDialog photos={all} albumNames={albumNames} onClose={() => setEventsOpen(false)}
          onShow={(ids, title) => openMemory(ids, title, '')}
          onCreate={async (name, ids) => {
            try {
              const a = await createAlbum(name)
              await addToAlbum(a.id, ids)
              await afterAlbumChange()
              say(`Utworzono album „${a.name}”: ${ids.length} ${pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}`, 'ok')
              return true
            } catch (e) { say(`Nie udało się utworzyć albumu: ${e}`, 'err'); return false }
          }} />
      )}
      {fileDragOver && (
        <div role="status" className="glass" style={{ position: 'fixed', inset: 12, zIndex: 2600, display: 'grid', placeItems: 'center', border: '3px dashed var(--accent)', borderRadius: 'var(--r-lg)', pointerEvents: 'none', fontSize: 20, fontWeight: 700 }}>
          Upuść zdjęcia lub foldery, aby dodać je do biblioteki
        </div>
      )}
      {dayViewOpen && <LibraryCalendar photos={all} onClose={() => setDayViewOpen(false)} onOpenDay={(ids, title) => openMemory(ids, title, '')} />}
      {calOpen && <CalendarMaker photos={all.filter((p) => !p.video)} say={say} onClose={() => setCalOpen(false)} />}
      {creditIds && creditIds.length > 0 && <CreditsDialog photos={all.filter((p) => creditIds.includes(p.id))} say={say} onClose={() => setCreditIds(null)} onDone={reload} />}
      {cardOffer && (
        <div className="glass fixed left-3 z-[1550] flex flex-wrap items-center gap-3 p-3" style={{ bottom: 'calc(12px + var(--sab))', borderRadius: 'var(--r-lg)', maxWidth: 'min(92vw, 460px)' }} role="status">
          <span style={{ flex: '1 1 200px', fontSize: 14 }}>Wykryto kartę pamięci z aparatu ({cardOffer}) ze zdjęciami.</span>
          <button className="primary" style={{ width: 'auto', padding: '0 16px' }} disabled={busy} onClick={() => { const c = cardOffer; setCardOffer(null); importFromCard(c) }}>Importuj zdjęcia</button>
          <button className="chip" onClick={() => setCardOffer(null)}>Nie teraz</button>
        </div>
      )}
      {inTauri && <ProgressDock />}
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
          onOpenPerson={async (pid, name) => {
            try {
              const ids = await personPhotos(pid)
              setPersonFacesMode(true); setPerson({ id: pid, name: name ?? 'Nieznana osoba', ids: new Set(ids) }); setAlbumId(null); setFolder(null); setMode('library')
              setViewer(null)
            } catch (e) { say(`Błąd: ${e}`, 'err') }
          }}
        />
      )}
    </div>
  )
}
