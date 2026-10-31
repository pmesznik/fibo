import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, ChevronLeft, ChevronRight, Star, Heart, Play, Pause, Maximize, Undo2, Redo2,
  RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Eye, Wand2, Save, CopyPlus, History,
  ZoomIn, ZoomOut, Compare, Sliders, Sparkles, Info, Tag, Crop as CropIcon, Trash2, Sun, Palette, Aperture, Pencil, Zap, Users, Plus,
} from './FiboIcons'
import { decodeBitmap } from './imageDecode'
import { pickFile, readAudio, hasOriginal, photoPeople, addManualFace, readImage, restoreOriginal, saveEdit, setCaption, setPersonCover, photoExif, listPeople, reassignPersonFaces, type Person, setFavorite, setRating, setFlag, setLabel, videoUrl, developRaw, isRawName, RAW_NEUTRAL, getEdit, saveEditRecipe, putEditThumbnail, deleteEdit, listEditHistory, getEditVersion, type EditVersion, type RawParams, type Photo, type PhotoPerson } from './api'
import { FaceImg } from './People'
import { CurveEditor, HistogramView, HslPanel } from './editor/ToneUi'
import { cleanHsl, cleanPoints } from './editor/tone'
import { copyEdit, deletePreset, getClip, loadPresets, savePreset, type Preset } from './editor/batch'
import { Thumb } from './Thumb'
import { Chip, Sec, Toast } from './ui'
import { TagEditor, type TagCount } from './TagEditor'
import { pl } from './pl'
import { flagOf, labelOf, nextMark } from './marks'
import {
  EFFECTS, EMPTY_EDIT, ZERO_ADJUST, MAX_INK, MAX_INK_POINTS, isEdited, renderEdit, renderGeometry, MAX_SPOTS, neutralFromSample, MAX_TEXTS, MAX_TEXT_LEN, type TextItem,
  type Adjust, type EditState, type EffectInst, type Ink,
} from './editor/effects'
import { detectHorizonAngle } from './editor/geom'

type Tab = 'basic' | 'tune' | 'fx' | 'info'

const ASPECTS: { label: string; v: number | null }[] = [
  { label: 'Oryginał', v: null }, { label: '1:1', v: 1 }, { label: '4:3', v: 4 / 3 }, { label: '3:2', v: 3 / 2 },
  { label: '16:9', v: 16 / 9 }, { label: '5:4', v: 5 / 4 }, { label: '3:4', v: 3 / 4 }, { label: '2:3', v: 2 / 3 },
]
/** Formaty odbitek (poziomo): proporcje wyliczone z wymiarów papieru, więc kadr pasuje do wydruku bez białych pasów. */
const PRINT_SIZES: { label: string; v: number }[] = [
  { label: '9×13 cm', v: 13 / 9 }, { label: '10×15 cm', v: 15 / 10 }, { label: '13×18 cm', v: 18 / 13 }, { label: '15×21 cm', v: 21 / 15 },
  { label: '20×25 cm', v: 25 / 20 }, { label: '20×30 cm', v: 30 / 20 }, { label: 'A4', v: Math.SQRT2 }, { label: '4×6"', v: 6 / 4 }, { label: '5×7"', v: 7 / 5 }, { label: '8×10"', v: 10 / 8 },
]

type TuneDef = { key: keyof Adjust; label: string; min: number; max: number }
const TUNE_GROUPS: { id: string; title: string; icon: typeof Sun; items: TuneDef[] }[] = [
  { id: 'tune-light', title: 'Światło', icon: Sun, items: [
    { key: 'fill', label: 'Doświetlenie', min: 0, max: 100 },
    { key: 'highlights', label: 'Światła', min: 0, max: 100 },
    { key: 'shadows', label: 'Cienie', min: -100, max: 100 },
    { key: 'brightness', label: 'Jasność', min: -100, max: 100 },
    { key: 'contrast', label: 'Kontrast', min: -100, max: 100 },
    { key: 'gamma', label: 'Gamma', min: -100, max: 100 },
  ] },
  { id: 'tune-color', title: 'Kolor', icon: Palette, items: [
    { key: 'temp', label: 'Temperatura barwowa', min: -100, max: 100 },
    { key: 'saturation', label: 'Nasycenie', min: -100, max: 100 },
  ] },
  { id: 'tune-sharp', title: 'Ostrość i klarowność', icon: Aperture, items: [
    { key: 'sharpen', label: 'Wyostrzenie', min: 0, max: 100 },
    { key: 'clarity', label: 'Klarowność (kontrast lokalny)', min: -100, max: 100 },
    { key: 'dehaze', label: 'Usuwanie mgły', min: -100, max: 100 },
  ] },
]

/** Kolory początkowe efektów z wyborem koloru (takie same jak w efekcie, gdy koloru nie wybrano). */
const FX_DEFAULT_COLOR: Record<string, string> = { tint: '#d89a52', gradtint: '#ff8c28' }
/** Zakraplacz ekranu z przeglądarki (WebView2 go ma); bez niego zostaje sam wybór koloru. */
const EYE_DROPPER = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
const ONE_CLICK = ['lucky', 'autocontrast', 'autocolor']
const FX_GROUPS: { id: string; title: string; icon: typeof Sun; ids: string[] }[] = [
  { id: 'fx-color', title: 'Kolor i ton', icon: Palette, ids: ['bw', 'sepia', 'tint', 'warm', 'boost', 'duotone', 'heatmap', 'night', 'infrared', 'invert'] },
  { id: 'fx-bw', title: 'Czerń i biel z filtrem, jeden kolor', icon: Aperture, ids: ['bwred', 'bwyellow', 'bwgreen', 'keepred', 'keepyellow', 'keepgreen', 'keepblue'] },
  { id: 'fx-retro', title: 'Retro i film', icon: History, ids: ['grain', 'matte', 'cross', 'lomo', 'sixties', 'polaroid', 'frame'] },
  { id: 'fx-focus', title: 'Światło i ostrość', icon: Aperture, ids: ['denoise', 'tiltshift', 'radialblur', 'soften', 'glow', 'orton', 'softfocus', 'focalbw', 'vignette', 'gradtint', 'hdr'] },
  { id: 'fx-art', title: 'Kreatywne', icon: Pencil, ids: ['posterize', 'pixelate', 'sketch', 'comic', 'neon'] },
]
const TEXT_COLORS: [string, string][] = [['#ffffff', 'Biały'], ['#111111', 'Czarny'], ['#ffd400', 'Żółty'], ['#ff4d4d', 'Czerwony'], ['#3ea6ff', 'Niebieski'], ['#4cd964', 'Zielony']]
const fxLabel = (id: string) => EFFECTS.find((e) => e.id === id)?.label ?? id

function Slider({ label, value, min, max, onChange, onStart }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void; onStart: () => void
}) {
  return (
    <>
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span><span>{Math.round(value * 10) / 10}</span>
      </label>
      <input
        type="range" aria-label={label} min={min} max={max} step={(max - min) > 40 ? 1 : 0.1} value={value}
        onPointerDown={onStart}
        onChange={(e) => onChange(+e.target.value)}
        onDoubleClick={() => { onStart(); onChange(min < 0 ? 0 : min) }}
      />
    </>
  )
}

export function Viewer({ photos, startId, autoplay = false, allTags, onTag, onClose, onPatch, onSaved, onOpenPerson }: {
  photos: Photo[]
  startId: number
  autoplay?: boolean
  allTags: TagCount[]
  onTag: (ids: number[], tag: string, add: boolean) => void
  onClose: () => void
  onPatch: (id: number, change: Partial<Photo>) => void
  onSaved: (newId: number) => void
  onOpenPerson?: (personId: number, name: string | null) => void
}) {
  const [id, setId] = useState(startId)
  const index = Math.max(0, photos.findIndex((p) => p.id === id))
  const photo = photos[index]

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  // Bitmapa zajmuje dziesiątki MB: poprzednią zwalniamy po zmianie zdjęcia i przy zamknięciu podglądu (z krótkim opóźnieniem, bo rysowanie może jeszcze z niej korzystać).
  const bmpRef = useRef<ImageBitmap | null>(null)
  const releaseBitmap = () => { const old = bmpRef.current; bmpRef.current = null; if (old) window.setTimeout(() => old.close(), 600) }
  useEffect(() => releaseBitmap, [])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT)
  const [undo, setUndo] = useState<EditState[]>([])
  const [redo, setRedo] = useState<EditState[]>([])
  const [sheet, setSheet] = useState(false)
  /** Wywoływanie RAW: ustawienia suwaków, trwające wywołanie i to, czy edytor pracuje na własnym wywołaniu (a nie na podglądzie z aparatu). */
  const [rawP, setRawP] = useState<RawParams>(RAW_NEUTRAL)
  const [rawBusy, setRawBusy] = useState(false)
  const [rawApplied, setRawApplied] = useState(false)
  /** Efekt, któremu użytkownik właśnie wskazuje środek (kliknięciem na zdjęciu). */
  const [centerFor, setCenterFor] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('basic')
  const [redEyeMode, setRedEyeMode] = useState(false)
  const [neutralMode, setNeutralMode] = useState(false)
  const [retouchMode, setRetouchMode] = useState(false)
  /** Rysowanie: wybrane narzędzie (null = wyłączone), kolor i grubość. */
  const [inkTool, setInkTool] = useState<Ink['kind'] | null>(null)
  const [inkColor, setInkColor] = useState('#ff3030')
  const [inkWidth, setInkWidth] = useState(0.008)
  const inking = useRef(false)
  const [retouchSize, setRetouchSize] = useState(2)
  const [playing, setPlaying] = useState(autoplay)
  // Muzyka do pokazu slajdów: plik z dysku trafia do odtwarzacza jako blob (bez sieci), gra w pętli tylko podczas pokazu.
  const [music, setMusic] = useState<{ url: string; name: string } | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => () => { if (music) URL.revokeObjectURL(music.url) }, [music])
  useEffect(() => {
    const a = audioRef.current
    if (!a || !music) return
    if (playing) a.play().catch(() => {}); else a.pause()
  }, [playing, music])
  const chooseMusic = async () => {
    try {
      if (music) { setMusic(null); return }
      const f = await pickFile('Wybierz muzykę do pokazu slajdów', ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac'], 'Muzyka')
      if (!f) return
      const bytes = await readAudio(f)
      const ext = (f.split('.').pop() ?? '').toLowerCase()
      const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' || ext === 'aac' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : ext === 'flac' ? 'audio/flac' : 'audio/ogg'
      setMusic({ url: URL.createObjectURL(new Blob([bytes], { type: mime })), name: f.split(/[\\/]/).pop() ?? 'muzyka' })
      say('Muzyka będzie grać podczas pokazu slajdów', 'ok')
    } catch (e) { say(`Błąd muzyki: ${e}`, 'err') }
  }
  const [slideSecs, setSlideSecs] = useState(() => { try { const v = +(localStorage.getItem('slide-secs') ?? 4); return [2, 4, 7, 12].includes(v) ? v : 4 } catch { return 4 } })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [compare, setCompare] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const [original, setOriginal] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind?: 'ok' | 'err' } | null>(null)
  const [pendingNav, setPendingNav] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** Ostatnio zapisany albo wczytany przepis edycji nieniszczącej (tekst JSON) i lista wersji z historii. */
  const [savedRecipe, setSavedRecipe] = useState<string | null>(null)
  const [hist, setHist] = useState<EditVersion[] | null>(null)
  const recipeJson = () => JSON.stringify({ v: 1, edit, raw: rawApplied ? rawP : null })
  const changed = isEdited(edit) || rawApplied
  const dirty = changed && recipeJson() !== savedRecipe

  // Wczytanie zdjęcia do edycji.
  useEffect(() => {
    if (!photo) return
    let dead = false
    setRawP(RAW_NEUTRAL); setRawApplied(false); setSavedRecipe(null); setHist(null)
    const recipeP = photo.edited ? getEdit(photo.id).catch(() => null) : Promise.resolve(null)
    releaseBitmap(); setBitmap(null); setLoadError(null); setEdit(EMPTY_EDIT); setUndo([]); setRedo([]); setRedEyeMode(false); setSelText(null)
    setZoom(1); setPan({ x: 0, y: 0 }); setCompare(false)
    // Film odtwarza okno aplikacji, więc nie ma obrazu do wczytania ani edycji.
    if (photo.video) { setOriginal(false); return () => { dead = true } }
    readImage(photo.id)
      .then((buf) => decodeBitmap(buf, photo.name))
      .then((b) => { if (dead) { b.close(); return }; bmpRef.current = b; setBitmap(b); recipeP.then((rec) => { if (!dead && rec) applyRecipe(rec.recipe, true) }) })
      .catch((e) => !dead && setLoadError(String(e)))
    hasOriginal(photo.id).then((v) => !dead && setOriginal(v)).catch(() => {})
    return () => { dead = true }
  }, [photo?.id, photo?.modified])

  // Przy powiększeniu rysujemy w większej rozdzielczości (stopniami co 900 px, żeby nie przerysowywać przy każdym kroku rolki).
  const renderSide = bitmap && zoom > 1 ? Math.min(Math.max(bitmap.width, bitmap.height), Math.ceil((1800 * zoom) / 900) * 900) : 1800

  // Podgląd na żywo. Przy porównaniu pokazujemy oryginał bez żadnych zmian.
  useEffect(() => {
    if (!bitmap || !canvasRef.current) return
    const raf = requestAnimationFrame(() => {
      const c = canvasRef.current
      if (!c) return
      const out = renderEdit(bitmap, compare ? EMPTY_EDIT : edit, renderSide)
      c.width = out.width; c.height = out.height
      c.getContext('2d')!.drawImage(out, 0, 0)
      if (playing && c.dataset.shown !== String(photo?.id)) {
        c.style.transition = 'none'; c.style.opacity = '0'
        requestAnimationFrame(() => { c.style.transition = 'opacity .8s ease'; c.style.opacity = '1' })
      } else { c.style.transition = ''; c.style.opacity = '' }
      c.dataset.shown = String(photo?.id)
    })
    return () => cancelAnimationFrame(raf)
  }, [bitmap, edit, compare, renderSide, playing, photo?.id])

  // Powiększanie kółkiem myszy w miejscu kursora; przy powrocie do 1 obraz wraca na środek.
  const zoomAt = (factor: number, cx = 0, cy = 0) => {
    setZoom((z0) => {
      const z1 = Math.min(8, Math.max(1, z0 * factor))
      setPan((p) => (z1 === 1 ? { x: 0, y: 0 } : { x: cx * (1 - z1 / z0) + p.x * (z1 / z0), y: cy * (1 - z1 / z0) + p.y * (z1 / z0) }))
      return z1
    })
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!bitmap) return
    const r = e.currentTarget.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
  }
  /** Dwuklik: dopasowanie do okna <-> powiększenie do 100% (jeden piksel zdjęcia na jeden piksel ekranu). */
  const toggleActualSize = () => {
    if (!bitmap || !canvasRef.current) return
    if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); return }
    const fullW = edit.geo.rot % 2 === 1 ? bitmap.height : bitmap.width
    const z100 = fullW / Math.max(1, canvasRef.current.clientWidth)
    setZoom(Math.min(8, Math.max(2, z100)))
  }
  const onPanStart = (e: React.PointerEvent) => {
    if (zoom <= 1 || redEyeMode || neutralMode || retouchMode) return
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPanMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })
  }
  const onPanEnd = () => { drag.current = null }

  const say = useCallback((text: string, kind?: 'ok' | 'err') => {
    setToast({ text, kind })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 7000)
  }, [])

  // Historia zmian.
  const snap = useCallback(() => { setUndo((u) => [...u.slice(-49), edit]); setRedo([]) }, [edit])
  const doUndo = () => setUndo((u) => {
    if (!u.length) return u
    setRedo((r) => [...r, edit]); setEdit(u[u.length - 1]); return u.slice(0, -1)
  })
  const doRedo = () => setRedo((r) => {
    if (!r.length) return r
    setUndo((u) => [...u, edit]); setEdit(r[r.length - 1]); return r.slice(0, -1)
  })
  const change = (fn: (s: EditState) => EditState) => { snap(); setEdit(fn) }
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets())
  const [presetName, setPresetName] = useState('')
  const [newText, setNewText] = useState('')
  // Opis zdjęcia (zapis po opuszczeniu pola) i osoby rozpoznane na zdjęciu.
  const [captionDraft, setCaptionDraft] = useState('')
  const [people, setPeople] = useState<PhotoPerson[]>([])
  /** Ręczne zaznaczanie twarzy: tryb rysowania ramki, ramka w trakcie rysowania i wybór osoby po jej narysowaniu (ułamki zdjęcia). */
  const [tagMode, setTagMode] = useState(false)
  const [tagBox, setTagBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [tagPick, setTagPick] = useState<{ x: number; y: number; w: number; h: number; options: Person[] } | null>(null)
  const [reassign, setReassign] = useState<{ from: PhotoPerson; options: Person[] } | null>(null)
  const [exifRows, setExifRows] = useState<[string, string][]>([])
  useEffect(() => { setCaptionDraft(photo?.caption ?? '') }, [photo?.id, photo?.caption])
  useEffect(() => {
    let dead = false
    setPeople([]); setExifRows([])
    if (photo && photo.id >= 0) photoExif(photo.id).then((v) => { if (!dead) setExifRows(v) }).catch(() => {})
    if (photo && photo.id >= 0) photoPeople(photo.id).then((v) => { if (!dead) setPeople(v) }).catch(() => {})
    return () => { dead = true }
  }, [photo?.id])
  const saveCaption = async () => {
    if (!photo || captionDraft.trim() === (photo.caption ?? '')) return
    try { await setCaption(photo.id, captionDraft); onPatch(photo.id, { caption: captionDraft.trim() || null }); say('Opis zapisany', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const [selText, setSelText] = useState<number | null>(null)
  const selT = selText !== null ? edit.texts[selText] : undefined
  const addText = () => {
    const text = newText.trim()
    if (!text || edit.texts.length >= MAX_TEXTS) return
    change((s) => ({ ...s, texts: [...s.texts, { text, x: 0.5, y: 0.88, size: 0.08, color: '#ffffff', bold: true }] }))
    setSelText(edit.texts.length)
    setNewText('')
  }
  const editText = (p: Partial<TextItem>) => { if (selText !== null) live((s) => ({ ...s, texts: s.texts.map((t, k) => (k === selText ? { ...t, ...p } : t)) })) }
  const live = (fn: (s: EditState) => EditState) => setEdit(fn) // suwaki: snap() robi onPointerDown

  const go = useCallback((delta: number) => {
    const next = photos[index + delta]
    if (!next) { setPlaying(false); return }
    if (dirty) { setPendingNav(next.id); return }
    setId(next.id)
  }, [photos, index, dirty])

  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => go(1), slideSecs * 1000)
    return () => window.clearInterval(t)
  }, [playing, go, slideSecs])

  const rate = (r: number) => {
    if (!photo) return
    const rating = photo.rating === r ? 0 : r
    onPatch(photo.id, { rating }); setRating(photo.id, rating)
  }
  const markFlag = (wanted: 1 | -1 | 0) => {
    if (!photo) return
    const next = nextMark([flagOf(photo)], wanted)
    onPatch(photo.id, { flag: next }); setFlag([photo.id], next).catch(() => {})
  }
  const markLabel = (wanted: number) => {
    if (!photo) return
    const next = nextMark([labelOf(photo)], wanted)
    onPatch(photo.id, { label: next }); setLabel([photo.id], next).catch(() => {})
  }
  const toggleFav = () => {
    if (!photo) return
    onPatch(photo.id, { favorite: !photo.favorite }); setFavorite(photo.id, !photo.favorite)
  }
  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen().catch(() => {})
  }
  const requestClose = () => { if (dirty) setPendingNav(-1); else onClose() }

  const save = async (mode: 'overwrite' | 'copy') => {
    if (!bitmap || !photo) return
    setSaving(true)
    try {
      const lower = photo.name.toLowerCase()
      const nativeExt = lower.endsWith('.png') ? 'png' : lower.endsWith('.webp') ? 'webp' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'jpg' : null
      // Formaty bez kodera w przeglądarce (gif, bmp, tiff) zawsze zapisujemy jako kopię JPG.
      const realMode = nativeExt ? mode : 'copy'
      const ext = nativeExt ?? 'jpg'
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      const out = renderEdit(bitmap, edit, 100000)
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, mime, 0.95))
      if (!blob) throw new Error('nie udało się zakodować obrazu')
      const newId = await saveEdit(photo.id, await blob.arrayBuffer(), realMode, ext)
      say(realMode === 'copy' ? 'Zapisano kopię obok oryginału' : 'Zapisano. Oryginał jest w folderze .originals', 'ok')
      setEdit(EMPTY_EDIT); setUndo([]); setRedo([])
      onSaved(newId)
      setId(newId)
      if (pendingNav !== null) { pendingNav === -1 ? onClose() : setId(pendingNav); setPendingNav(null) }
    } catch (e) {
      say(`Błąd zapisu: ${e}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  const restore = async () => {
    if (!photo) return
    try { const nid = await restoreOriginal(photo.id); onSaved(nid); say('Przywrócono oryginał', 'ok') } catch (e) { say(String(e), 'err') }
  }

  // Skróty klawiszowe. Esc zamyka warstwy po kolei: tryb oczu, panel, pełny ekran, podgląd.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLInputElement | null
      const typing = t?.tagName === 'INPUT' && t.type !== 'range'
      if (typing) return
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return }
      const onRange = t?.type === 'range'
      if (e.key === 'ArrowLeft' && !onRange) go(-1)
      else if (e.key === 'ArrowRight' && !onRange) go(1)
      else if (e.key === 'Escape') {
        if (centerFor) setCenterFor(null)
        else if (inkTool) setInkTool(null)
        else if (redEyeMode) setRedEyeMode(false)
        else if (neutralMode) setNeutralMode(false)
        else if (retouchMode) setRetouchMode(false)
        else if (pendingNav !== null) setPendingNav(null)
        else if (sheet) setSheet(false)
        else if (document.fullscreenElement) document.exitFullscreen()
        else requestClose()
      }
      else if (e.key === ' ' && t?.tagName !== 'BUTTON' && t?.tagName !== 'VIDEO' && !photo?.video) { e.preventDefault(); setPlaying((p) => !p) }
      else if (/^[0-5]$/.test(e.key)) rate(+e.key)
      else if (e.key.toLowerCase() === 'f') toggleFav()
      else if (e.key.toLowerCase() === 'p') markFlag(1)
      else if (e.key.toLowerCase() === 'x') markFlag(-1)
      else if (e.key.toLowerCase() === 'u') markFlag(0)
      else if (/^[6-9]$/.test(e.key)) markLabel(+e.key - 5)
      else if (e.key.toLowerCase() === 'e' && !photo?.video) setSheet((v) => !v)
      else if (e.key === '+' || e.key === '=') zoomAt(1.4)
      else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.4)
      else if (e.key.toLowerCase() === 'z') toggleActualSize()
      else if (e.key.toLowerCase() === 'b') setCompare(true)
    }
    const onUp = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'b') setCompare(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp) }
  })

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r0 = e.currentTarget.getBoundingClientRect()
    if (centerFor) {
      const cx = Math.min(1, Math.max(0, (e.clientX - r0.left) / r0.width)), cy = Math.min(1, Math.max(0, (e.clientY - r0.top) / r0.height))
      change((st) => ({ ...st, fx: st.fx.map((x) => (x.id === centerFor ? { ...x, cx, cy } : x)) }))
      setCenterFor(null)
      return
    }
    if (neutralMode && bitmap) {
      const n = neutralFromSample(renderGeometry(bitmap, edit.geo, 800), (e.clientX - r0.left) / r0.width, (e.clientY - r0.top) / r0.height)
      if (!n) { say('Ten punkt jest zbyt ciemny. Kliknij fragment, który ma być szary lub biały.'); return }
      change((s) => ({ ...s, neutral: n }))
      setNeutralMode(false)
      return
    }
    if (retouchMode) {
      if (edit.spots.length >= MAX_SPOTS) { say('Osiągnięto limit poprawek retuszu'); return }
      change((s) => ({ ...s, spots: [...s.spots, { x: (e.clientX - r0.left) / r0.width, y: (e.clientY - r0.top) / r0.height, r: retouchSize / 100 }] }))
      return
    }
    if (!redEyeMode) return
    const r = e.currentTarget.getBoundingClientRect()
    change((s) => ({ ...s, redeye: [...s.redeye, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r: 0.025 }] }))
  }

  /** Wczytuje zapisany przepis edycji do edytora. Ze starszych wersji brakujące pola dostają wartości domyślne. `fresh` = świeżo otwarte zdjęcie (przepis jest „zapisany”). */
  const applyRecipe = (json: string, fresh = false) => {
    try {
      const r = JSON.parse(json) as { edit?: Partial<EditState>; raw?: RawParams | null }
      const e = r.edit ?? {}
      const next: EditState = {
        ...EMPTY_EDIT, ...e,
        geo: { ...EMPTY_EDIT.geo, ...(e.geo ?? {}) }, adj: { ...ZERO_ADJUST, ...(e.adj ?? {}) },
        fx: Array.isArray(e.fx) ? e.fx : [], redeye: Array.isArray(e.redeye) ? e.redeye : [], texts: Array.isArray(e.texts) ? e.texts : [], spots: Array.isArray(e.spots) ? e.spots : [],
        neutral: e.neutral ?? null,
        ink: Array.isArray(e.ink) ? e.ink.filter((k) => k && ['arrow', 'line', 'rect', 'ellipse', 'pen'].includes(k.kind) && Array.isArray(k.pts) && k.pts.length >= 2 && typeof k.color === 'string' && Number.isFinite(k.width)).slice(0, MAX_INK).map((k) => ({ ...k, pts: k.pts.slice(0, MAX_INK_POINTS) })) : undefined,
        curves: e.curves ? { rgb: cleanPoints(e.curves.rgb), r: cleanPoints(e.curves.r), g: cleanPoints(e.curves.g), b: cleanPoints(e.curves.b) } : undefined,
        hsl: e.hsl ? cleanHsl(e.hsl) : undefined,
      }
      setEdit(next); setUndo([]); setRedo([])
      const raw = r.raw && photo && isRawName(photo.name) ? { ...RAW_NEUTRAL, ...r.raw } : null
      if (raw) { setRawP(raw); developNow(raw, true) }
      if (fresh) setSavedRecipe(JSON.stringify({ v: 1, edit: next, raw }))
    } catch { say('Nie udało się wczytać zapisanej edycji', 'err') }
  }
  /** Zapis edycji nieniszczący: przepis trafia do bazy, historii i pliku obok zdjęcia, a oryginał zostaje nietknięty. */
  const saveRecipe = async () => {
    if (!bitmap || !photo) return
    setSaving(true)
    try {
      const json = recipeJson()
      await saveEditRecipe(photo.id, json)
      // Miniatura z edycją, żeby biblioteka pokazywała zdjęcie tak, jak wygląda po edycji.
      const out = renderEdit(bitmap, edit, 360)
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.85))
      if (blob) await putEditThumbnail(photo.id, await blob.arrayBuffer()).catch(() => {})
      setSavedRecipe(json); setHist(null)
      onPatch(photo.id, { edited: true, rev: (photo.rev ?? 0) + 1 })
      say('Zapisano edycję. Oryginał jest nietknięty, a edycję można zmienić, cofnąć albo przywrócić z historii', 'ok')
      if (pendingNav !== null) { pendingNav === -1 ? onClose() : setId(pendingNav); setPendingNav(null) }
    } catch (e) { say(`Błąd zapisu edycji: ${e}`, 'err') } finally { setSaving(false) }
  }
  /** Usuwa zapisaną edycję (zdjęcie wraca do oryginału); historia zostaje, więc edycję można jeszcze przywrócić. */
  const removeRecipe = async () => {
    if (!photo) return
    try {
      await deleteEdit(photo.id)
      setEdit(EMPTY_EDIT); setUndo([]); setRedo([]); setSavedRecipe(null); setHist(null)
      if (rawApplied) await backToCamera()
      onPatch(photo.id, { edited: false, rev: (photo.rev ?? 0) + 1 })
      say('Usunięto zapisaną edycję. Zdjęcie wróciło do oryginału, a wersje zostały w historii', 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const openHistory = async () => {
    if (!photo) return
    if (hist) { setHist(null); return }
    try { setHist(await listEditHistory(photo.id)) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const loadVersion = async (v: EditVersion) => {
    if (!photo) return
    try { applyRecipe(await getEditVersion(photo.id, v.id)); say('Wczytano wersję z historii. Zapisz edycję, żeby ją zachować', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') }
  }

  /** Wywołuje RAW z ustawieniami z suwaków i podstawia wynik jako źródło edycji (inne poprawki zostają na wierzchu). */
  const developNow = async (params: RawParams, quiet = false) => {
    if (!photo || rawBusy) return
    setRawBusy(true)
    try {
      const buf = await developRaw(photo.id, params)
      const b = await decodeBitmap(buf, 'raw.jpg')
      releaseBitmap(); bmpRef.current = b; setBitmap(b); setRawApplied(true)
      if (!quiet) say('Wywołano zdjęcie RAW. Zapis tworzy nową kopię JPG obok pliku RAW', 'ok')
    } catch (e) { say(`Nie udało się wywołać RAW: ${e}`, 'err') } finally { setRawBusy(false) }
  }
  /** Wraca do podglądu zapisanego przez aparat w pliku. */
  const backToCamera = async () => {
    if (!photo || rawBusy) return
    setRawBusy(true)
    try {
      const b = await decodeBitmap(await readImage(photo.id), photo.name)
      releaseBitmap(); bmpRef.current = b; setBitmap(b); setRawApplied(false); setRawP(RAW_NEUTRAL)
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setRawBusy(false) }
  }
  const fxAmount = (fid: string) => edit.fx.find((f) => f.id === fid)?.amount
  const toggleFx = (fid: string) => {
    const has = fxAmount(fid) !== undefined
    change((s) => ({ ...s, fx: has ? s.fx.filter((f) => f.id !== fid) : [...s.fx, { id: fid, amount: 100 }] }))
  }
  const strip = useMemo(() => photos.slice(Math.max(0, index - 12), index + 13), [photos, index])

  const inkFrac = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r || r.width < 1 || r.height < 1) return [0, 0]
    const q = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000
    return [q((e.clientX - r.left) / r.width), q((e.clientY - r.top) / r.height)]
  }
  const inkDown = (e: React.PointerEvent) => {
    if (!inkTool || (edit.ink?.length ?? 0) >= MAX_INK) return
    snap()
    const p = inkFrac(e)
    inking.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    setEdit((s) => ({ ...s, ink: [...(s.ink ?? []), { kind: inkTool, color: inkColor, width: inkWidth, pts: [p, p] }] }))
  }
  const inkMove = (e: React.PointerEvent) => {
    if (!inking.current) return
    const p = inkFrac(e)
    setEdit((s) => {
      const list = [...(s.ink ?? [])]
      const last = list[list.length - 1]
      if (!last) return s
      list[list.length - 1] = { ...last, pts: last.kind === 'pen' ? [...last.pts, p].slice(0, MAX_INK_POINTS) : [last.pts[0], p] }
      return { ...s, ink: list }
    })
  }
  const inkUp = () => {
    if (!inking.current) return
    inking.current = false
    // Rysunek bez długości (samo kliknięcie) nie zostaje.
    setEdit((s) => {
      const list = [...(s.ink ?? [])]
      const last = list[list.length - 1]
      if (last && Math.hypot(last.pts[last.pts.length - 1][0] - last.pts[0][0], last.pts[last.pts.length - 1][1] - last.pts[0][1]) < 0.004 && last.kind !== 'pen') list.pop()
      return { ...s, ink: list.length ? list : undefined }
    })
  }
  const autoStraighten = () => {
    if (!bitmap) return
    const c = document.createElement('canvas')
    const k = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height))
    c.width = Math.max(1, Math.round(bitmap.width * k)); c.height = Math.max(1, Math.round(bitmap.height * k))
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, c.width, c.height)
    const a = detectHorizonAngle({ d: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height })
    if (a === null) { say('Nie znalazłem wyraźnej poziomej linii (horyzontu). Wyprostuj ręcznie suwakiem', 'err'); return }
    change((s) => ({ ...s, geo: { ...s.geo, angle: Math.max(-15, Math.min(15, a)) } }))
    say(`Wyprostowano o ${a.toString().replace('.', ',')}°. Możesz to poprawić suwakiem`, 'ok')
  }
  const startTagging = () => {
    if (JSON.stringify(edit.geo) !== JSON.stringify(EMPTY_EDIT.geo)) { say('Przed zaznaczaniem twarzy cofnij obrót, odbicie i kadrowanie, żeby ramka pasowała do zdjęcia', 'err'); return }
    setRedEyeMode(false); setNeutralMode(false); setRetouchMode(false); setCenterFor(null)
    setZoom(1); setPan({ x: 0, y: 0 }); setTagBox(null); setTagMode(true)
  }
  const tagFrac = (e: React.PointerEvent) => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r || r.width < 1 || r.height < 1) return { x: 0, y: 0 }
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const tagDown = (e: React.PointerEvent) => {
    const p = tagFrac(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    setTagBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const tagMove = (e: React.PointerEvent) => {
    if (!tagBox) return
    const p = tagFrac(e)
    setTagBox({ ...tagBox, x1: p.x, y1: p.y })
  }
  const tagUp = async () => {
    if (!tagBox) return
    const b = { x: Math.min(tagBox.x0, tagBox.x1), y: Math.min(tagBox.y0, tagBox.y1), w: Math.abs(tagBox.x1 - tagBox.x0), h: Math.abs(tagBox.y1 - tagBox.y0) }
    setTagBox(null)
    if (b.w < 0.02 || b.h < 0.02) { say('Przeciągnij myszą od jednego rogu twarzy do drugiego', 'err'); return }
    try { setTagPick({ ...b, options: (await listPeople()).filter((o) => !o.ignored) }) } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const tagSave = async (person: number | null) => {
    const p = tagPick
    if (!p || !photo) return
    setTagPick(null)
    say('Dodaję twarz…', 'ok')
    try {
      await addManualFace(photo.id, p.x, p.y, p.w, p.h, person)
      setPeople(await photoPeople(photo.id)); setTagMode(false)
      say('Dodano twarz do osoby', 'ok')
    } catch (e) { say(`${e}`, 'err') }
  }

  if (!photo) return null
  const slidersFx = edit.fx.filter((f) => EFFECTS.find((e) => e.id === f.id)?.slider)

  return (
    <div className="fixed inset-0 z-[1500]" style={{ background: 'var(--bg)' }} role="dialog" aria-modal="true" aria-label={`Podgląd: ${photo.name}`}>
      {/* Obraz na całym ekranie */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden" onWheel={onWheel}
        style={{ padding: 'calc(76px + var(--sat)) ' + (sheet ? '394px' : '16px') + ' calc(104px + var(--sab)) 16px', transition: 'padding .3s var(--ease)', background: 'color-mix(in srgb, var(--bg) 60%, #000)' }}>
        {loadError && <div className="empty">Nie można otworzyć zdjęcia: {loadError}</div>}
        {photo.video && (
          <video key={photo.id} src={videoUrl(photo.id)} controls autoPlay playsInline aria-label={photo.name}
            onError={() => say('Okno aplikacji nie umie odtworzyć tego filmu (nieobsługiwany kodek, np. H.265 bez rozszerzenia systemu). Otwórz go w innym odtwarzaczu.', 'err')}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 'var(--r-md)', boxShadow: '0 10px 40px rgba(0,0,0,.4)', background: '#000' }} />
        )}
        {!photo.video && !bitmap && !loadError && <div className="empty">Wczytywanie…</div>}
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          onDoubleClick={toggleActualSize}
          onPointerDown={onPanStart}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerCancel={onPanEnd}
          aria-label={photo.name}
          className={bitmap && !photo.video ? '' : 'hidden'}
          style={{
            maxWidth: '100%', maxHeight: '100%', borderRadius: 'var(--r-md)', boxShadow: '0 10px 40px rgba(0,0,0,.4)',
            cursor: redEyeMode || neutralMode || retouchMode || centerFor ? 'crosshair' : zoom > 1 ? 'grab' : 'zoom-in', touchAction: 'none',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center',
          }}
        />
        {inkTool && (() => {
          const r = canvasRef.current?.getBoundingClientRect()
          if (!r) return null
          return (
            <div role="application" aria-label="Rysowanie na zdjęciu: przeciągnij myszą" onPointerDown={inkDown} onPointerMove={inkMove} onPointerUp={inkUp} onPointerCancel={inkUp}
              style={{ position: 'fixed', left: r.left, top: r.top, width: r.width, height: r.height, cursor: 'crosshair', touchAction: 'none', zIndex: 4, outline: '2px dashed var(--accent)', outlineOffset: -2 }} />
          )
        })()}
        {tagMode && (() => {
          const r = canvasRef.current?.getBoundingClientRect()
          if (!r) return null
          const b = tagBox && { x: Math.min(tagBox.x0, tagBox.x1), y: Math.min(tagBox.y0, tagBox.y1), w: Math.abs(tagBox.x1 - tagBox.x0), h: Math.abs(tagBox.y1 - tagBox.y0) }
          return (
            <div role="application" aria-label="Zaznacz twarz na zdjęciu przeciągając myszą" onPointerDown={tagDown} onPointerMove={tagMove} onPointerUp={tagUp} onPointerCancel={() => setTagBox(null)}
              style={{ position: 'fixed', left: r.left, top: r.top, width: r.width, height: r.height, cursor: 'crosshair', touchAction: 'none', zIndex: 4, outline: '2px dashed var(--accent)', outlineOffset: -2 }}>
              {b && <div style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.6), 0 0 0 9999px rgba(0,0,0,.35)', borderRadius: 6 }} />}
            </div>
          )
        })()}
        {compare && (
          <div className="chip on" style={{ position: 'absolute', left: '50%', bottom: 'calc(112px + var(--sab))', transform: 'translateX(-50%)', background: 'var(--panel)', pointerEvents: 'none' }}>Oryginał (bez zmian)</div>
        )}
        {zoom > 1 && (
          <div className="chip" style={{ position: 'absolute', left: 16, bottom: 'calc(112px + var(--sab))', background: 'var(--panel)', pointerEvents: 'none' }}>{Math.round(zoom * 100)}%</div>
        )}
      </div>

      {photos[index - 1] && (
        <button className="glass" aria-label="Poprzednie zdjęcie" onClick={() => go(-1)}
          style={{ position: 'absolute', left: 12, top: '50%', width: 48, height: 48, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}><ChevronLeft size={24} /></button>
      )}
      {photos[index + 1] && (
        <button className="glass" aria-label="Następne zdjęcie" onClick={() => go(1)}
          style={{ position: 'absolute', right: sheet ? 382 : 12, top: '50%', width: 48, height: 48, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', transition: 'right .3s var(--ease)' }}><ChevronRight size={24} /></button>
      )}

      {music && <audio ref={audioRef} src={music.url} loop />}
      {tagMode && !tagPick && (
        <div className="chip glass" role="status" style={{ position: 'absolute', left: '50%', top: 'calc(84px + var(--sat))', transform: 'translateX(-50%)', zIndex: 5, gap: 10 }}>
          Zaznacz twarz: przeciągnij ramkę od rogu do rogu
          <button className="text" onClick={() => { setTagMode(false); setTagBox(null) }}>Anuluj</button>
        </div>
      )}
      {tagPick && (
        <>
          <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setTagPick(null)} />
          <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Kto jest na zaznaczonej twarzy">
            <div className="dr-head" style={{ paddingBottom: 0 }}>
              <span>Kto to jest?</span>
              <button className="ico" aria-label="Zamknij" onClick={() => setTagPick(null)}><X size={22} /></button>
            </div>
            <div style={{ padding: '4px 16px 8px', color: 'var(--muted)', fontSize: 13 }}>Wskaż osobę dla zaznaczonej twarzy. Program zapamięta ją i użyje przy rozpoznawaniu kolejnych zdjęć.</div>
            <div className="sheet-body" style={{ padding: '0 16px 16px' }}>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }}>
                <button className="bare text-center" aria-label="Nowa osoba" onClick={() => tagSave(null)}>
                  <div style={{ width: 64, height: 64, margin: '0 auto', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--tonal)', fontSize: 28 }}>+</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Nowa osoba</div>
                </button>
                {tagPick.options.map((o) => (
                  <button key={o.id} className="bare text-center" aria-label={o.name ?? 'Nieznana osoba'} onClick={() => tagSave(o.id)}>
                    <div style={{ width: 64, height: 64, margin: '0 auto', borderRadius: '50%', overflow: 'hidden', background: 'var(--tonal)' }}>{o.cover !== null && <FaceImg id={o.cover} size={64} />}</div>
                    <div className="truncate" style={{ fontSize: 13, marginTop: 4 }}>{o.name ?? 'Nieznana osoba'}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {reassign && (
        <>
          <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setReassign(null)} />
          <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Wskaż właściwą osobę">
            <div className="dr-head" style={{ paddingBottom: 0 }}>
              <span>Kto to jest?</span>
              <button className="ico" aria-label="Zamknij" onClick={() => setReassign(null)}><X size={22} /></button>
            </div>
            <div style={{ padding: '4px 16px 8px', color: 'var(--muted)', fontSize: 13 }}>Ta twarz na zdjęciu została rozpoznana jako „{reassign.from.name ?? 'Nieznana osoba'}”. Wskaż właściwą osobę.</div>
            <div className="sheet-body" style={{ padding: '0 16px 16px' }}>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }}>
                <button className="bare text-center" aria-label="Nowa osoba" onClick={async () => { try { await reassignPersonFaces(photo.id, reassign.from.id, null); setReassign(null); setPeople(await photoPeople(photo.id)); say('Utworzono nową osobę', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } }}>
                  <div style={{ width: 64, height: 64, margin: '0 auto', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--tonal)', fontSize: 28 }}>+</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Nowa osoba</div>
                </button>
                {reassign.options.map((o) => (
                  <button key={o.id} className="bare text-center" aria-label={o.name ?? 'Nieznana osoba'} onClick={async () => { try { await reassignPersonFaces(photo.id, reassign.from.id, o.id); setReassign(null); setPeople(await photoPeople(photo.id)); say('Zmieniono osobę', 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } }}>
                    <div style={{ width: 64, height: 64, margin: '0 auto', borderRadius: '50%', overflow: 'hidden', background: 'var(--tonal)' }}>{o.cover !== null && <FaceImg id={o.cover} size={64} />}</div>
                    <div className="truncate" style={{ fontSize: 13, marginTop: 4 }}>{o.name ?? 'Nieznana osoba'}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {playing && photo.caption && (
        <div className="glass" role="status" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(40px + var(--sab))', maxWidth: 'min(80%, 720px)', padding: '10px 18px', borderRadius: 'var(--r-lg)', textAlign: 'center', fontSize: 16, zIndex: 3 }}>
          {photo.caption}
        </div>
      )}
      {onOpenPerson && !photo.video && photo.id >= 0 && (
        <div className="flex gap-2" role="group" aria-label="Osoby na zdjęciu"
          style={{ position: 'absolute', left: 12, bottom: 'calc(112px + var(--sab))', maxWidth: `calc(100% - ${sheet ? 420 : 24}px)`, flexWrap: 'wrap', zIndex: 3 }}>
          <button className={`chip glass${tagMode ? ' on' : ''}`} style={{ gap: 6 }} aria-pressed={tagMode} title="Zaznacz twarz, której program nie wykrył, i wskaż, kto to jest" onClick={() => (tagMode ? setTagMode(false) : startTagging())}>
            <Users size={14} /> Dodaj twarz
          </button>
          {people.map((p) => (
            <button key={p.id} className="chip glass" style={{ paddingLeft: 4, gap: 6 }} aria-label={`Pokaż zdjęcia: ${p.name ?? 'Nieznana osoba'}`} title="Pokaż wszystkie zdjęcia tej osoby"
              onClick={() => onOpenPerson(p.id, p.name)}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', display: 'inline-block', background: 'var(--tonal)' }}><FaceImg id={p.face} size={26} /></span>
              {p.name ?? 'Nieznana osoba'}
            </button>
          ))}
          {people.map((p) => (
            <button key={`r${p.id}`} className="chip glass" style={{ gap: 6 }} aria-label={`To nie jest ${p.name ?? 'ta osoba'}: wskaż właściwą osobę`} title="Źle rozpoznana twarz: przenieś ją do innej osoby"
              onClick={async () => { try { setReassign({ from: p, options: (await listPeople()).filter((o) => o.id !== p.id && !o.ignored) }) } catch (e) { say(`Błąd: ${e}`, 'err') } }}>
              <Pencil size={13} /> To nie {p.name ?? 'ta osoba'}
            </button>
          ))}
          {people.map((p) => (
            <button key={`c${p.id}`} className="chip glass" style={{ gap: 6 }} aria-label={`Ustaw tę twarz jako okładkę osoby ${p.name ?? 'Nieznana osoba'}`} title={`Ustaw tę twarz jako okładkę: ${p.name ?? 'Nieznana osoba'}`}
              onClick={async () => { try { await setPersonCover(p.id, p.face); say(`Okładka osoby „${p.name ?? 'Nieznana osoba'}” zmieniona`, 'ok') } catch (e) { say(`Błąd: ${e}`, 'err') } }}>
              <Star size={13} /> Okładka: {p.name ?? 'Nieznana osoba'}
            </button>
          ))}
        </div>
      )}

      {/* Górne elementy pływające */}
      <button id="viewerClose" className="glass" aria-label="Zamknij podgląd" title="Zamknij (Esc)" onClick={requestClose}
        style={{ position: 'absolute', left: 12, top: 'calc(12px + var(--sat))', width: 'var(--bar-h)', height: 'var(--bar-h)', padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}><X size={20} /></button>

      <div className="glass flex items-center gap-1" style={{ position: 'absolute', left: 'calc(24px + var(--bar-h))', top: 'calc(12px + var(--sat))', height: 'var(--bar-h)', padding: '0 8px 0 16px', borderRadius: 'var(--r-lg)', maxWidth: `calc(100% - ${sheet ? 480 : 140}px)` }}>
        <div className="min-w-0" style={{ marginRight: 8 }}>
          <div className="truncate" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>{photo.name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.1 }}>{index + 1} / {photos.length}{dirty ? ' · zmieniono' : ''}</div>
        </div>
        <div className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="bare" onClick={() => rate(n)} aria-label={`Ocena ${n}`} aria-pressed={n <= photo.rating}
              style={{ padding: 5, color: '#f5b301', minWidth: 28, minHeight: 36 }}>
              <Star size={16} fill={n <= photo.rating ? 'currentColor' : 'none'} strokeWidth={1.6} />
            </button>
          ))}
        </div>
        <button className={`ico ${photo.favorite ? 'on' : ''}`} aria-label="Ulubione" aria-pressed={photo.favorite} title="Ulubione (F)" onClick={toggleFav}><Heart size={19} fill={photo.favorite ? 'currentColor' : 'none'} /></button>
        <button className="ico" aria-label="Cofnij" title="Cofnij (Ctrl+Z)" disabled={!undo.length} onClick={doUndo}><Undo2 size={19} /></button>
        <button className="ico" aria-label="Ponów" title="Ponów (Ctrl+Y)" disabled={!redo.length} onClick={doRedo}><Redo2 size={19} /></button>
        <button className={`ico ${playing ? 'on' : ''}`} aria-label="Pokaz slajdów" aria-pressed={playing} title="Pokaz slajdów (spacja)" onClick={() => setPlaying((p) => !p)}>{playing ? <Pause size={19} /> : <Play size={19} />}</button>
        <button className={`ico ${music ? 'on' : ''}`} aria-label={music ? `Wyłącz muzykę: ${music.name}` : 'Dodaj muzykę do pokazu slajdów'} aria-pressed={!!music} title={music ? `Muzyka: ${music.name} (kliknij, aby wyłączyć)` : 'Muzyka do pokazu slajdów'} onClick={chooseMusic}><Sparkles size={19} /></button>
        <button className="chip" aria-label={`Czas slajdu: ${slideSecs} sekund. Kliknij, aby zmienić`} title="Czas jednego slajdu w pokazie"
          onClick={() => setSlideSecs((s) => { const n = ({ 2: 4, 4: 7, 7: 12, 12: 2 } as Record<number, number>)[s] ?? 4; try { localStorage.setItem('slide-secs', String(n)) } catch { /* brak pamięci przeglądarki */ } return n })}>{slideSecs} s</button>
        <button className="ico" aria-label="Pomniejsz" title="Pomniejsz (−)" disabled={zoom <= 1} onClick={() => zoomAt(1 / 1.4)}><ZoomOut size={19} /></button>
        <button className="ico" aria-label="Powiększ" title="Powiększ (+, kółko myszy, dwuklik: 100%)" onClick={() => zoomAt(1.4)}><ZoomIn size={19} /></button>
        <button className={`ico ${compare ? 'on' : ''}`} aria-label="Przytrzymaj, aby zobaczyć oryginał" aria-pressed={compare} title="Przytrzymaj, aby zobaczyć oryginał (B)"
          disabled={!dirty} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}><Compare size={19} /></button>
        <button className="ico" aria-label="Pełny ekran" onClick={fullscreen}><Maximize size={19} /></button>
      </div>

      {!photo.video && <button className="fab glass" style={{ zIndex: 1600, background: sheet ? 'var(--accent)' : undefined, color: sheet ? '#fff' : undefined }}
        aria-label="Edycja zdjęcia" aria-expanded={sheet} title="Edycja (E)" onClick={() => setSheet((v) => !v)}>
        {sheet ? <X size={20} /> : <Wand2 size={20} />}
      </button>}

      {/* Panel edycji */}
      <aside className="sheet glass" aria-hidden={!sheet} inert={!sheet}
        style={{ transform: sheet ? 'none' : 'translateX(110%)', visibility: sheet ? 'visible' : 'hidden', transition: 'transform .32s var(--ease), visibility 0s linear ' + (sheet ? '0s' : '.32s') }}>
        <div className="seg" role="tablist" aria-label="Panel edycji" style={{ margin: '12px 12px 4px' }}>
          {([['basic', 'Podstawowe', Wand2], ['tune', 'Dostrajanie', Sliders], ['fx', 'Efekty', Sparkles], ['info', 'Info', Info]] as [Tab, string, typeof Wand2][]).map(([t, l, I]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '0 6px', fontSize: 12.5 }} onClick={() => setTab(t)}><I size={13} /> {l}</button>
          ))}
        </div>

        <div className="sheet-body">
          {tab === 'basic' && (
            <>
              <h2 className="sec-h" style={{ margin: '4px 2px 0' }}>Podstawowe poprawki</h2>
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '0 2px 4px' }}>Szybkie korekty i kadrowanie</div>
              {isRawName(photo.name) && (
                <Sec id="b-raw" icon={<Aperture size={17} />} title="Wywoływanie RAW" hint={rawApplied ? 'Własne wywołanie' : 'Podgląd z aparatu'} defaultOpen>
                  <div style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 4 }}>
                    Program wywołuje zdjęcie z surowych danych matrycy: niższa ekspozycja odsłania szczegóły w światłach, które aparat obciął w swoim JPEG.
                  </div>
                  <Slider label="Ekspozycja (EV)" value={rawP.exposure} min={-3} max={3} onStart={() => {}} onChange={(v) => setRawP((p) => ({ ...p, exposure: Math.round(v * 20) / 20 }))} />
                  <Slider label="Temperatura barwowa" value={rawP.temp} min={-100} max={100} onStart={() => {}} onChange={(v) => setRawP((p) => ({ ...p, temp: Math.round(v) }))} />
                  <Slider label="Odcień (zieleń, magenta)" value={rawP.tint} min={-100} max={100} onStart={() => {}} onChange={(v) => setRawP((p) => ({ ...p, tint: Math.round(v) }))} />
                  <Slider label="Odzyskiwanie świateł" value={rawP.highlights} min={0} max={100} onStart={() => {}} onChange={(v) => setRawP((p) => ({ ...p, highlights: Math.round(v) }))} />
                  <div className="chips" style={{ marginTop: 8 }}>
                    <button className="chip on" disabled={rawBusy} onClick={() => developNow(rawP)}>{rawBusy ? 'Wywołuję…' : 'Wywołaj RAW'}</button>
                    {rawApplied && <button className="chip" disabled={rawBusy} onClick={backToCamera}>Wróć do podglądu aparatu</button>}
                    {(rawP.exposure !== 0 || rawP.temp !== 0 || rawP.tint !== 0 || rawP.highlights !== 0) && <button className="chip" disabled={rawBusy} onClick={() => setRawP(RAW_NEUTRAL)}>Wyzeruj suwaki</button>}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>Wywołanie trwa kilka sekund. Suwaki działają po kliknięciu „Wywołaj RAW”, a pozostałe poprawki nakładają się na wynik.</div>
                </Sec>
              )}
              <Sec id="b-one" icon={<Zap size={17} />} title="Jedno kliknięcie" hint="Automatyczne poprawki" defaultOpen>
                <div className="chips">
                  {ONE_CLICK.map((fid) => <Chip key={fid} on={fxAmount(fid) !== undefined} onClick={() => toggleFx(fid)}>{fxLabel(fid)}</Chip>)}
                  <Chip on={edit.adj.fill > 0} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, fill: s.adj.fill ? 0 : 40 } }))}>Doświetlenie</Chip>
                  <Chip on={edit.adj.highlights > 0} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, highlights: s.adj.highlights ? 0 : 45 } }))}>Przygaś światła</Chip>
                  <Chip on={edit.adj.shadows > 0} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, shadows: s.adj.shadows ? 0 : 45 } }))}>Rozjaśnij cienie</Chip>
                </div>
              </Sec>
              <Sec id="b-rot" icon={<RotateCw size={17} />} title="Obrót i odbicie" hint="Prostowanie, czerwone oczy" defaultOpen>
                <div className="flex flex-wrap gap-1">
                  <button className="ico" aria-label="Obróć w lewo" title="Obróć w lewo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, rot: (s.geo.rot + 3) % 4 } }))}><RotateCcw size={20} /></button>
                  <button className="ico" aria-label="Obróć w prawo" title="Obróć w prawo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, rot: (s.geo.rot + 1) % 4 } }))}><RotateCw size={20} /></button>
                  <button className={`ico ${edit.geo.flipH ? 'on' : ''}`} aria-label="Odbij poziomo" title="Odbij poziomo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, flipH: !s.geo.flipH } }))}><FlipHorizontal size={20} /></button>
                  <button className={`ico ${edit.geo.flipV ? 'on' : ''}`} aria-label="Odbij pionowo" title="Odbij pionowo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, flipV: !s.geo.flipV } }))}><FlipVertical size={20} /></button>
                  <button className={`ico ${retouchMode ? 'on' : ''}`} aria-label="Retusz plam" aria-pressed={retouchMode} title="Retusz: kliknij plamę lub pyłek, a zniknie" onClick={() => { setRetouchMode((v) => !v); setNeutralMode(false); setRedEyeMode(false); setSheet(true) }}><Wand2 size={20} /></button>
                  <button className={`ico ${neutralMode ? 'on' : ''}`} aria-label="Neutralny kolor (zakraplacz)" aria-pressed={neutralMode} title="Neutralny kolor: kliknij to, co ma być szare lub białe" onClick={() => { setNeutralMode((v) => !v); setRedEyeMode(false); setSheet(true) }}><Palette size={20} /></button>
                  <button className={`ico ${redEyeMode ? 'on' : ''}`} aria-label="Czerwone oczy" aria-pressed={redEyeMode} title="Czerwone oczy" onClick={() => { setRedEyeMode((v) => !v); setSheet(true) }}><Eye size={20} /></button>
                </div>
                {retouchMode && (
                  <>
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>Kliknij plamę lub pyłek na zdjęciu. Rozmiar pędzla dobierz do plamy. Esc kończy.</p>
                    <Slider label="Rozmiar pędzla (% krótszego boku)" value={retouchSize} min={0.5} max={8} onStart={() => {}} onChange={setRetouchSize} />
                  </>
                )}
                {edit.spots.length > 0 && <button className="wide" onClick={() => change((s) => ({ ...s, spots: [] }))}>Usuń retusz ({edit.spots.length})</button>}
                {neutralMode && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>Kliknij na zdjęciu miejsce, które powinno być szare lub białe. Esc kończy.</p>}
                {edit.neutral && <button className="wide" onClick={() => change((s) => ({ ...s, neutral: null }))}>Usuń korektę neutralnego koloru</button>}
                {redEyeMode && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>Kliknij środek oka na zdjęciu. Esc kończy.</p>}
                {edit.redeye.length > 0 && (
                  <button className="wide" onClick={() => change((s) => ({ ...s, redeye: [] }))}>Usuń poprawki oczu ({edit.redeye.length})</button>
                )}
                <Slider label="Prostowanie (°)" value={edit.geo.angle} min={-15} max={15} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, angle: v } }))} />
                <button className="wide" onClick={autoStraighten} title="Szuka dominującej poziomej linii (horyzont, blat, krawędź) i obraca zdjęcie tak, żeby była równa"><Wand2 size={17} /> Prostuj horyzont automatycznie</button>
                <Slider label="Perspektywa pionowa" value={edit.geo.persV} min={-100} max={100} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, persV: v } }))} />
                <Slider label="Perspektywa pozioma" value={edit.geo.persH} min={-100} max={100} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, persH: v } }))} />
              </Sec>
              <Sec id="b-crop" icon={<CropIcon size={17} />} title="Kadrowanie" hint={edit.geo.aspect === null && edit.geo.zoom === 1 ? 'Bez kadrowania' : 'Przycięte'}>
                <div className="chips">
                  {ASPECTS.map((a) => (
                    <Chip key={a.label} on={edit.geo.aspect === a.v} onClick={() => change((s) => ({ ...s, geo: { ...s.geo, aspect: a.v, panX: 0, panY: 0, zoom: a.v === null ? 1 : s.geo.zoom } }))}>{a.label}</Chip>
                  ))}
                </div>
                <label style={{ marginTop: 10 }}>Formaty odbitek</label>
                <div className="chips">
                  {PRINT_SIZES.map((a) => {
                    const cur = edit.geo.aspect
                    const on = cur !== null && (Math.abs(cur - a.v) < 1e-6 || Math.abs(cur - 1 / a.v) < 1e-6)
                    return <Chip key={a.label} on={on} onClick={() => change((s) => ({ ...s, geo: { ...s.geo, aspect: a.v, panX: 0, panY: 0 } }))}>{a.label}</Chip>
                  })}
                  <Chip on={false} onClick={() => change((s) => (s.geo.aspect === null ? s : { ...s, geo: { ...s.geo, aspect: 1 / s.geo.aspect!, panX: 0, panY: 0 } }))} label="Obróć ramkę: pionowo lub poziomo">Obróć ramkę</Chip>
                </div>
                <Slider label="Zbliżenie" value={edit.geo.zoom} min={1} max={4} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, zoom: v } }))} />
                <Slider label="Przesunięcie poziome" value={edit.geo.panX} min={-1} max={1} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, panX: v } }))} />
                <Slider label="Przesunięcie pionowe" value={edit.geo.panY} min={-1} max={1} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, panY: v } }))} />
              </Sec>
            </>
          )}

          {(tab === 'basic' || tab === 'tune' || tab === 'fx') && (
            <div className="chips" style={{ margin: '8px 0 0' }} role="group" aria-label="Kopiowanie edycji">
              <button className="chip" disabled={!isEdited(edit)} title="Kopiuje korekty, efekty i napisy (bez kadrowania) do schowka edycji"
                onClick={() => { if (copyEdit(edit)) { say('Skopiowano edycję. Wklej ją tu lub zbiorczo w bibliotece', 'ok') } else say('Najpierw coś zmień w zdjęciu') }}>Kopiuj edycję</button>
              <button className="chip" title="Wkleja skopiowane korekty, efekty i napisy"
                onClick={() => { const c = getClip(); if (!c) return say('Schowek edycji jest pusty. Najpierw skopiuj edycję z innego zdjęcia'); change((s) => ({ ...s, adj: c.adj, fx: c.fx, texts: c.texts })) }}>Wklej edycję</button>
            </div>
          )}

          {tab === 'tune' && (
            <>
              <h2 className="sec-h" style={{ margin: '4px 2px 0' }}>Dostrajanie</h2>
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '0 2px 4px' }}>Dwuklik na suwaku zeruje go</div>
              <HistogramView source={canvasRef.current} version={edit} />
              {TUNE_GROUPS.map((g) => (
                <Sec key={g.id} id={g.id} icon={<g.icon size={17} />} title={g.title}
                  hint={g.items.some((t) => edit.adj[t.key]) ? 'Zmieniono' : 'Bez zmian'} defaultOpen={g.id === 'tune-light'}>
                  {g.id === 'tune-light' && (
                    <div className="chips" style={{ marginBottom: 6 }}>
                      <Chip on={false} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, fill: 40 } }))}>Doświetl</Chip>
                      <Chip on={false} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, highlights: 45 } }))}>Przygaś światła</Chip>
                      <Chip on={false} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, shadows: 45 } }))}>Rozjaśnij cienie</Chip>
                      <Chip on={false} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, fill: 0, highlights: 0, shadows: 0 } }))}>Wyzeruj światło</Chip>
                    </div>
                  )}
                  {g.items.map((t) => (
                    <Slider key={t.key} label={t.label} value={edit.adj[t.key]} min={t.min} max={t.max} onStart={snap}
                      onChange={(v) => live((s) => ({ ...s, adj: { ...s.adj, [t.key]: v } }))} />
                  ))}
                </Sec>
              ))}
              <Sec id="tune-curves" icon={<Sliders size={17} />} title="Krzywe" hint={edit.curves ? 'Zmieniono' : 'Bez zmian'}>
                <CurveEditor value={edit.curves} onStart={snap} onChange={(c) => live((s) => ({ ...s, curves: c }))} />
              </Sec>
              <Sec id="tune-hsl" icon={<Palette size={17} />} title="Kolor według zakresów (HSL)" hint={edit.hsl ? 'Zmieniono' : 'Bez zmian'}>
                <HslPanel value={edit.hsl} onStart={snap} onChange={(h) => live((s) => ({ ...s, hsl: h }))} Slider={Slider} />
              </Sec>
              <button className="wide" onClick={() => change((s) => ({ ...s, adj: ZERO_ADJUST, curves: undefined, hsl: undefined }))}>Zeruj dostrajanie</button>
            </>
          )}

          {tab === 'fx' && (
            <>
              <h2 className="sec-h" style={{ margin: '4px 2px 0' }}>Efekty</h2>
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '0 2px 4px' }}>Nakładają się w kolejności wyboru</div>
              {slidersFx.length > 0 && (
                <Sec id="fx-active" icon={<Sliders size={17} />} title="Siła efektów" hint={`${slidersFx.length} aktywne`} defaultOpen>
                  {slidersFx.map((f) => {
                    const def = EFFECTS.find((e) => e.id === f.id)
                    const setOpt = (patch: Partial<EffectInst>) => live((s) => ({ ...s, fx: s.fx.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }))
                    return (
                      <div key={f.id}>
                        <Slider label={fxLabel(f.id)} value={f.amount} min={0} max={100} onStart={snap}
                          onChange={(v) => setOpt({ amount: v })} />
                        {def?.opts?.includes('size') && (
                          <Slider label="Rozmiar ogniska" value={Math.round((f.size ?? 1) * 100)} min={30} max={200} onStart={snap} onChange={(v) => setOpt({ size: v / 100 })} />
                        )}
                        {def?.opts?.includes('center') && (
                          <div className="chips" style={{ marginTop: 6 }}>
                            <Chip on={centerFor === f.id} onClick={() => setCenterFor(centerFor === f.id ? null : f.id)} label="Wskaż środek efektu kliknięciem na zdjęciu">{centerFor === f.id ? 'Kliknij na zdjęciu…' : 'Wskaż środek'}</Chip>
                            {f.cx !== undefined && <Chip onClick={() => { snap(); setOpt({ cx: undefined, cy: undefined }) }} label="Wróć do środka kadru">Wyśrodkuj</Chip>}
                          </div>
                        )}
                        {def?.opts?.includes('color') && (
                          <div className="chips" style={{ marginTop: 6, alignItems: 'center' }}>
                            <input type="color" aria-label={`Kolor: ${fxLabel(f.id)}`} value={f.color ?? FX_DEFAULT_COLOR[f.id] ?? '#d89a52'} onFocus={snap}
                              onChange={(e) => setOpt({ color: e.target.value })} style={{ width: 44, height: 34, padding: 2, minHeight: 0 }} />
                            {EYE_DROPPER && <Chip onClick={async () => { try { const r = await new EYE_DROPPER().open(); snap(); setOpt({ color: r.sRGBHex }) } catch { /* anulowano */ } }} label="Wybierz kolor z ekranu zakraplaczem">Zakraplacz</Chip>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </Sec>
              )}
              <Sec id="fx-presets" icon={<Sparkles size={17} />} title="Moje zestawy" hint={presets.length ? `${presets.length} zapisanych` : 'Zapisz ulubione ustawienia'}>
                <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Zestaw to zapisane korekty, efekty i napisy. Zastosujesz go jednym kliknięciem na każdym zdjęciu (kadrowanie i obrót nie wchodzą do zestawu).</p>
                {presets.length > 0 && (
                  <div className="chips">
                    {presets.map((p) => (
                      <span key={p.name} style={{ display: 'inline-flex', gap: 2 }}>
                        <button className="chip" onClick={() => change((s) => ({ ...s, adj: JSON.parse(JSON.stringify(p.clip.adj)), fx: JSON.parse(JSON.stringify(p.clip.fx)), texts: JSON.parse(JSON.stringify(p.clip.texts)) }))}>{p.name}</button>
                        <button className="chip" aria-label={`Usuń zestaw ${p.name}`} title="Usuń zestaw" onClick={() => { deletePreset(p.name); setPresets(loadPresets()) }}><X size={13} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <label htmlFor="preset-name">Zapisz bieżące ustawienia jako zestaw</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="preset-name" type="text" maxLength={40} value={presetName} placeholder="Nazwa zestawu" autoComplete="off" onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (document.getElementById('preset-save') as HTMLButtonElement | null)?.click() } }} />
                  <button id="preset-save" className="chip" disabled={!presetName.trim()} onClick={() => { if (savePreset(presetName, edit)) { setPresets(loadPresets()); setPresetName(''); say('Zestaw zapisany', 'ok') } else say('Najpierw ustaw korekty, efekty lub napis') }}>Zapisz</button>
                </div>
              </Sec>
              <Sec id="fx-ink" icon={<Pencil size={17} />} title="Rysowanie i strzałki" hint={edit.ink?.length ? `${edit.ink.length} ${pl(edit.ink.length, 'rysunek', 'rysunki', 'rysunków')}` : 'Bez rysunków'}>
                <div className="chips" role="group" aria-label="Narzędzie rysowania">
                  {([['arrow', 'Strzałka'], ['line', 'Linia'], ['rect', 'Prostokąt'], ['ellipse', 'Elipsa'], ['pen', 'Pędzel']] as [Ink['kind'], string][]).map(([k, l]) => (
                    <button key={k} className={`chip${inkTool === k ? ' on' : ''}`} aria-pressed={inkTool === k}
                      onClick={() => { setInkTool(inkTool === k ? null : k); setRedEyeMode(false); setNeutralMode(false); setRetouchMode(false); setCenterFor(null); setZoom(1); setPan({ x: 0, y: 0 }); setSheet(true) }}>{l}</button>
                  ))}
                </div>
                {inkTool && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>Przeciągnij myszą po zdjęciu. Esc kończy rysowanie. Rysunki są częścią edycji i można je cofnąć.</p>}
                <label>Kolor</label>
                <div className="chips" role="group" aria-label="Kolor rysunku">
                  {[['#ff3030', 'Czerwony'], ['#ffd400', 'Żółty'], ['#2fd05a', 'Zielony'], ['#2f8cff', 'Niebieski'], ['#ffffff', 'Biały'], ['#111111', 'Czarny']].map(([c, l]) => (
                    <button key={c} className={`chip${inkColor === c ? ' on' : ''}`} aria-pressed={inkColor === c} aria-label={l} title={l} onClick={() => setInkColor(c)}>
                      <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: '1px solid rgba(128,128,128,.6)', display: 'inline-block' }} />
                    </button>
                  ))}
                </div>
                <label>Grubość</label>
                <div className="chips" role="group" aria-label="Grubość linii">
                  {([[0.004, 'Cienka'], [0.008, 'Średnia'], [0.016, 'Gruba']] as [number, string][]).map(([w, l]) => <button key={w} className={`chip${inkWidth === w ? ' on' : ''}`} aria-pressed={inkWidth === w} onClick={() => setInkWidth(w)}>{l}</button>)}
                </div>
                {(edit.ink?.length ?? 0) > 0 && (
                  <div className="chips" style={{ marginTop: 8 }}>
                    <button className="chip" onClick={() => change((st) => { const l = (st.ink ?? []).slice(0, -1); return { ...st, ink: l.length ? l : undefined } })}>Cofnij ostatni rysunek</button>
                    <button className="chip" onClick={() => change((st) => ({ ...st, ink: undefined }))}>Usuń wszystkie ({edit.ink!.length})</button>
                  </div>
                )}
              </Sec>
              <Sec id="fx-text" icon={<Pencil size={17} />} title="Tekst na zdjęciu" hint={edit.texts.length ? `${edit.texts.length} ${pl(edit.texts.length, 'napis', 'napisy', 'napisów')}` : 'Bez napisów'} defaultOpen={edit.texts.length > 0}>
                <label htmlFor="new-text">Nowy napis</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="new-text" type="text" maxLength={MAX_TEXT_LEN} value={newText} placeholder="Wpisz tekst" autoComplete="off"
                    onChange={(e) => setNewText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addText() } }} />
                  <button className="chip" disabled={!newText.trim() || edit.texts.length >= MAX_TEXTS} onClick={addText}><Plus size={14} /> Dodaj</button>
                </div>
                {edit.texts.length > 0 && (
                  <div className="chips" style={{ marginTop: 8 }}>
                    {edit.texts.map((t, i) => <Chip key={i} on={selText === i} onClick={() => setSelText(i)}>{t.text.slice(0, 18) || '…'}</Chip>)}
                  </div>
                )}
                {selT && selText !== null && (
                  <>
                    <label htmlFor="sel-text">Treść</label>
                    <input id="sel-text" type="text" maxLength={MAX_TEXT_LEN} value={selT.text} autoComplete="off"
                      onFocus={snap} onChange={(e) => editText({ text: e.target.value })} />
                    <Slider label="Rozmiar" value={Math.round(selT.size * 100)} min={2} max={30} onStart={snap} onChange={(v) => editText({ size: v / 100 })} />
                    <Slider label="Położenie poziome" value={Math.round(selT.x * 100)} min={0} max={100} onStart={snap} onChange={(v) => editText({ x: v / 100 })} />
                    <Slider label="Położenie pionowe" value={Math.round(selT.y * 100)} min={0} max={100} onStart={snap} onChange={(v) => editText({ y: v / 100 })} />
                    <label>Kolor</label>
                    <div className="chips">
                      {TEXT_COLORS.map(([c, n]) => (
                        <button key={c} className={`chip${selT.color === c ? ' on' : ''}`} aria-label={`Kolor ${n}`} aria-pressed={selT.color === c} onClick={() => { snap(); editText({ color: c }) }}>
                          <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: '1px solid var(--glass-line)', display: 'inline-block' }} /> {n}
                        </button>
                      ))}
                      <Chip on={selT.bold} onClick={() => { snap(); editText({ bold: !selT.bold }) }}>Pogrubienie</Chip>
                    </div>
                    <button className="wide" style={{ color: 'var(--err)' }} onClick={() => { change((s) => ({ ...s, texts: s.texts.filter((_, k) => k !== selText) })); setSelText(null) }}><Trash2 size={16} /> Usuń ten napis</button>
                  </>
                )}
              </Sec>
              {FX_GROUPS.map((g) => (
                <Sec key={g.id} id={g.id} icon={<g.icon size={17} />} title={g.title}
                  hint={`${g.ids.filter((i) => fxAmount(i) !== undefined).length} z ${g.ids.length} włączonych`} defaultOpen={g.id === 'fx-color'}>
                  <div className="chips">
                    {g.ids.map((i) => <Chip key={i} on={fxAmount(i) !== undefined} onClick={() => toggleFx(i)}>{fxLabel(i)}</Chip>)}
                  </div>
                </Sec>
              ))}
            </>
          )}

          {tab === 'info' && (
            <>
              <h2 className="sec-h" style={{ margin: '4px 2px 8px' }}>Informacje</h2>
              {[
                ['Nazwa', photo.name],
                ['Folder', photo.path.replace(/[\\/][^\\/]*$/, '')],
                ['Wymiary', photo.width ? `${photo.width} × ${photo.height} px` : '—'],
                ['Rozmiar', `${(photo.size / 1048576).toFixed(2)} MB`],
                ['Data zdjęcia', photo.taken ?? new Date(photo.modified * 1000).toLocaleString('pl-PL')],
                ['Aparat', photo.camera ?? '—'],
                ...(photo.title ? [['Tytuł', photo.title]] : []),
                ...(photo.iptc_city || photo.iptc_country ? [['Miejsce', [photo.iptc_city, photo.iptc_country].filter(Boolean).join(', ')]] : photo.place ? [['Miejsce', `${photo.place}${photo.country ? `, ${(() => { try { return new Intl.DisplayNames(['pl'], { type: 'region' }).of(photo.country) } catch { return photo.country } })()}` : ''}`]] : []),
              ].map(([k, v]) => (
                <div key={k} className="item" style={{ display: 'block' }}>
                  <small style={{ color: 'var(--muted)', fontSize: 12 }}>{k}</small>
                  <div style={{ wordBreak: 'break-all' }}>{v}</div>
                </div>
              ))}
              {exifRows.length > 0 && (
                <Sec id="v-exif" icon={<Info size={17} />} title="Dane EXIF" hint={`${exifRows.length} pól z pliku`}>
                  {exifRows.map(([k, v]) => (
                    <div key={k} className="item" style={{ display: 'block' }}>
                      <small style={{ color: 'var(--muted)', fontSize: 12 }}>{k}</small>
                      <div style={{ wordBreak: 'break-word' }}>{v}</div>
                    </div>
                  ))}
                </Sec>
              )}
              <label htmlFor="v-caption">Opis zdjęcia</label>
              <textarea id="v-caption" rows={3} maxLength={2000} value={captionDraft} placeholder="Dodaj opis…" onChange={(e) => setCaptionDraft(e.target.value)} onBlur={saveCaption}
                style={{ width: '100%', resize: 'vertical' }} />
              <Sec id="v-tags" icon={<Tag size={17} />} title="Tagi" hint={photo.tags.length ? photo.tags.join(', ') : 'Brak tagów'} defaultOpen>
                <TagEditor photos={[photo]} allTags={allTags}
                  onAdd={(t) => onTag([photo.id], t, true)} onRemove={(t) => onTag([photo.id], t, false)} />
              </Sec>
            </>
          )}
        </div>

        <div className="sheet-foot">
          <button className="primary" disabled={!dirty || saving} onClick={saveRecipe} title="Zapisuje edycję jako przepis: plik zdjęcia się nie zmienia">
            <span className="inline-flex items-center gap-2"><Save size={17} /> {saving ? 'Zapisywanie…' : 'Zapisz edycję (oryginał bez zmian)'}</span>
          </button>
          <button className="wide" disabled={!changed || saving} onClick={() => save('overwrite')}><Save size={17} /> Zapisz zmiany w pliku</button>
          <button className="wide" disabled={!changed || saving} onClick={() => save('copy')}><CopyPlus size={17} /> Zapisz jako kopię</button>
          <div className="flex gap-2" style={{ marginTop: 6 }}>
            <button className="text flex-1" disabled={!original} onClick={restore}><span className="inline-flex items-center gap-1"><History size={15} /> Oryginał</span></button>
            <button className="danger flex-1" disabled={!changed} onClick={() => { snap(); setEdit(EMPTY_EDIT); setRedEyeMode(false); if (rawApplied) backToCamera() }}><span className="inline-flex items-center gap-1"><Trash2 size={15} /> Odrzuć zmiany</span></button>
          </div>
          {(photo.edited || savedRecipe !== null) && (
            <div className="flex gap-2" style={{ marginTop: 6 }}>
              <button className="text flex-1" onClick={openHistory} aria-expanded={hist !== null}><span className="inline-flex items-center gap-1"><History size={15} /> Historia edycji</span></button>
              <button className="danger flex-1" onClick={removeRecipe} title="Zdjęcie wraca do oryginału; wersje zostają w historii"><span className="inline-flex items-center gap-1"><Trash2 size={15} /> Usuń edycję</span></button>
            </div>
          )}
          {hist && (
            <div style={{ marginTop: 6, maxHeight: 150, overflowY: 'auto', display: 'grid', gap: 4 }}>
              {hist.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Brak zapisanych wersji.</div>}
              {hist.map((h, i) => (
                <button key={h.id} className="chip" style={{ justifyContent: 'space-between' }} onClick={() => loadVersion(h)}>
                  <span>{new Date(h.created * 1000).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}{i === 0 ? ' (ostatnia)' : ''}</span><span>Wczytaj</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Pasek miniatur */}
      <footer className="glass flex items-center gap-2 overflow-x-auto"
        style={{ position: 'absolute', left: 12, right: sheet ? 394 : 12, bottom: 'calc(12px + var(--sab))', height: 80, padding: '8px 10px', borderRadius: 'var(--r-lg)', transition: 'right .3s var(--ease)' }}>
        {strip.map((p) => (
          <button key={p.id} className="bare relative shrink-0 overflow-hidden" aria-label={p.name} aria-current={p.id === photo.id}
            onClick={() => (dirty ? setPendingNav(p.id) : setId(p.id))}
            style={{ height: 60, width: 88, borderRadius: 'var(--r-sm)', opacity: p.id === photo.id ? 1 : 0.65, boxShadow: p.id === photo.id ? '0 0 0 3px var(--accent)' : 'none' }}>
            <Thumb photo={p} />
          </button>
        ))}
      </footer>

      {pendingNav !== null && (
        <>
          <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setPendingNav(null)} />
          <div className="glass fixed left-1/2 top-1/2 z-[1800] w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 p-5" style={{ borderRadius: 'var(--r-lg)' }} role="alertdialog" aria-label="Niezapisane zmiany">
            <h2 style={{ margin: 0, font: '700 20px/1.2 system-ui' }}>Niezapisane zmiany</h2>
            <p style={{ color: 'var(--muted)', margin: '6px 0 16px' }}>Edycja tego zdjęcia nie została zapisana.</p>
            <button className="primary" onClick={() => save('overwrite')}>Zapisz i przejdź dalej</button>
            <button className="wide" onClick={() => setPendingNav(null)}>Wróć do edycji</button>
            <button className="danger wide" onClick={() => { const t = pendingNav; setPendingNav(null); setEdit(EMPTY_EDIT); t === -1 ? onClose() : setId(t) }}>Odrzuć zmiany</button>
          </div>
        </>
      )}

      <Toast text={toast?.text ?? null} kind={toast?.kind} />
    </div>
  )
}
