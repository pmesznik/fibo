import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, ChevronLeft, ChevronRight, Star, Heart, Play, Pause, Maximize, Undo2, Redo2,
  RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Eye, Wand2, Save, CopyPlus, History,
  Sliders, Sparkles, Info, Tag, Crop as CropIcon, Trash2, Sun, Palette, Aperture, Pencil, Zap,
} from './FiboIcons'
import { hasOriginal, readImage, restoreOriginal, saveEdit, setFavorite, setRating, type Photo } from './api'
import { Thumb } from './Thumb'
import { Chip, Sec, Toast } from './ui'
import { TagEditor, type TagCount } from './TagEditor'
import {
  EFFECTS, EMPTY_EDIT, ZERO_ADJUST, isEdited, renderEdit,
  type Adjust, type EditState,
} from './editor/effects'

type Tab = 'basic' | 'tune' | 'fx' | 'info'

const ASPECTS: { label: string; v: number | null }[] = [
  { label: 'Oryginał', v: null }, { label: '1:1', v: 1 }, { label: '4:3', v: 4 / 3 }, { label: '3:2', v: 3 / 2 },
  { label: '16:9', v: 16 / 9 }, { label: '5:4', v: 5 / 4 }, { label: '3:4', v: 3 / 4 }, { label: '2:3', v: 2 / 3 },
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
  { id: 'tune-sharp', title: 'Ostrość', icon: Aperture, items: [
    { key: 'sharpen', label: 'Wyostrzenie', min: 0, max: 100 },
  ] },
]

const ONE_CLICK = ['lucky', 'autocontrast', 'autocolor']
const FX_GROUPS: { id: string; title: string; icon: typeof Sun; ids: string[] }[] = [
  { id: 'fx-color', title: 'Kolor i ton', icon: Palette, ids: ['bw', 'sepia', 'warm', 'boost', 'duotone', 'heatmap', 'night', 'infrared', 'invert'] },
  { id: 'fx-retro', title: 'Retro i film', icon: History, ids: ['grain', 'matte', 'cross', 'lomo', 'sixties', 'polaroid', 'frame'] },
  { id: 'fx-focus', title: 'Światło i ostrość', icon: Aperture, ids: ['soften', 'glow', 'orton', 'softfocus', 'focalbw', 'vignette', 'gradtint', 'hdr'] },
  { id: 'fx-art', title: 'Kreatywne', icon: Pencil, ids: ['posterize', 'pixelate', 'sketch', 'comic', 'neon'] },
]
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

export function Viewer({ photos, startId, autoplay = false, allTags, onTag, onClose, onPatch, onSaved }: {
  photos: Photo[]
  startId: number
  autoplay?: boolean
  allTags: TagCount[]
  onTag: (ids: number[], tag: string, add: boolean) => void
  onClose: () => void
  onPatch: (id: number, change: Partial<Photo>) => void
  onSaved: (newId: number) => void
}) {
  const [id, setId] = useState(startId)
  const index = Math.max(0, photos.findIndex((p) => p.id === id))
  const photo = photos[index]

  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT)
  const [undo, setUndo] = useState<EditState[]>([])
  const [redo, setRedo] = useState<EditState[]>([])
  const [sheet, setSheet] = useState(false)
  const [tab, setTab] = useState<Tab>('basic')
  const [redEyeMode, setRedEyeMode] = useState(false)
  const [playing, setPlaying] = useState(autoplay)
  const [original, setOriginal] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind?: 'ok' | 'err' } | null>(null)
  const [pendingNav, setPendingNav] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dirty = isEdited(edit)

  // Wczytanie zdjęcia do edycji.
  useEffect(() => {
    if (!photo) return
    let dead = false
    setBitmap(null); setLoadError(null); setEdit(EMPTY_EDIT); setUndo([]); setRedo([]); setRedEyeMode(false)
    readImage(photo.id)
      .then((buf) => createImageBitmap(new Blob([buf]), { imageOrientation: 'from-image' }))
      .then((b) => { if (!dead) setBitmap(b) })
      .catch((e) => !dead && setLoadError(String(e)))
    hasOriginal(photo.id).then((v) => !dead && setOriginal(v)).catch(() => {})
    return () => { dead = true }
  }, [photo?.id, photo?.modified])

  // Podgląd na żywo.
  useEffect(() => {
    if (!bitmap || !canvasRef.current) return
    const raf = requestAnimationFrame(() => {
      const c = canvasRef.current
      if (!c) return
      const out = renderEdit(bitmap, edit, 1800)
      c.width = out.width; c.height = out.height
      c.getContext('2d')!.drawImage(out, 0, 0)
    })
    return () => cancelAnimationFrame(raf)
  }, [bitmap, edit])

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
  const live = (fn: (s: EditState) => EditState) => setEdit(fn) // suwaki: snap() robi onPointerDown

  const go = useCallback((delta: number) => {
    const next = photos[index + delta]
    if (!next) { setPlaying(false); return }
    if (dirty) { setPendingNav(next.id); return }
    setId(next.id)
  }, [photos, index, dirty])

  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => go(1), 3500)
    return () => window.clearInterval(t)
  }, [playing, go])

  const rate = (r: number) => {
    if (!photo) return
    const rating = photo.rating === r ? 0 : r
    onPatch(photo.id, { rating }); setRating(photo.id, rating)
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
        if (redEyeMode) setRedEyeMode(false)
        else if (pendingNav !== null) setPendingNav(null)
        else if (sheet) setSheet(false)
        else if (document.fullscreenElement) document.exitFullscreen()
        else requestClose()
      }
      else if (e.key === ' ' && t?.tagName !== 'BUTTON') { e.preventDefault(); setPlaying((p) => !p) }
      else if (/^[0-5]$/.test(e.key)) rate(+e.key)
      else if (e.key.toLowerCase() === 'f') toggleFav()
      else if (e.key.toLowerCase() === 'e') setSheet((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!redEyeMode) return
    const r = e.currentTarget.getBoundingClientRect()
    change((s) => ({ ...s, redeye: [...s.redeye, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r: 0.025 }] }))
  }

  const fxAmount = (fid: string) => edit.fx.find((f) => f.id === fid)?.amount
  const toggleFx = (fid: string) => {
    const has = fxAmount(fid) !== undefined
    change((s) => ({ ...s, fx: has ? s.fx.filter((f) => f.id !== fid) : [...s.fx, { id: fid, amount: 100 }] }))
  }
  const strip = useMemo(() => photos.slice(Math.max(0, index - 12), index + 13), [photos, index])

  if (!photo) return null
  const slidersFx = edit.fx.filter((f) => EFFECTS.find((e) => e.id === f.id)?.slider)

  return (
    <div className="fixed inset-0 z-[1500]" style={{ background: 'var(--bg)' }} role="dialog" aria-modal="true" aria-label={`Podgląd: ${photo.name}`}>
      {/* Obraz na całym ekranie */}
      <div className="absolute inset-0 flex items-center justify-center"
        style={{ padding: 'calc(76px + var(--sat)) ' + (sheet ? '394px' : '16px') + ' calc(104px + var(--sab)) 16px', transition: 'padding .3s var(--ease)', background: 'color-mix(in srgb, var(--bg) 60%, #000)' }}>
        {loadError && <div className="empty">Nie można otworzyć zdjęcia: {loadError}</div>}
        {!bitmap && !loadError && <div className="empty">Wczytywanie…</div>}
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          aria-label={photo.name}
          className={bitmap ? '' : 'hidden'}
          style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 'var(--r-md)', boxShadow: '0 10px 40px rgba(0,0,0,.4)', cursor: redEyeMode ? 'crosshair' : 'default' }}
        />
      </div>

      {photos[index - 1] && (
        <button className="glass" aria-label="Poprzednie zdjęcie" onClick={() => go(-1)}
          style={{ position: 'absolute', left: 12, top: '50%', width: 48, height: 48, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}><ChevronLeft size={24} /></button>
      )}
      {photos[index + 1] && (
        <button className="glass" aria-label="Następne zdjęcie" onClick={() => go(1)}
          style={{ position: 'absolute', right: sheet ? 382 : 12, top: '50%', width: 48, height: 48, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', transition: 'right .3s var(--ease)' }}><ChevronRight size={24} /></button>
      )}

      {/* Górne elementy pływające */}
      <button id="viewerClose" className="glass" aria-label="Zamknij podgląd" title="Zamknij (Esc)" onClick={requestClose}
        style={{ position: 'absolute', left: 12, top: 'calc(12px + var(--sat))', width: 46, height: 46, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}><X size={20} /></button>

      <div className="glass flex items-center gap-1" style={{ position: 'absolute', left: 70, top: 'calc(12px + var(--sat))', height: 46, padding: '0 8px 0 16px', borderRadius: 'var(--r-lg)', maxWidth: `calc(100% - ${sheet ? 480 : 140}px)` }}>
        <div className="min-w-0" style={{ marginRight: 8 }}>
          <div className="truncate" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>{photo.name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.1 }}>{index + 1} / {photos.length}{dirty ? ' · zmieniono' : ''}</div>
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
        <button className="ico" aria-label="Pełny ekran" onClick={fullscreen}><Maximize size={19} /></button>
      </div>

      <button className="fab glass" style={{ zIndex: 1600, background: sheet ? 'var(--accent)' : undefined, color: sheet ? '#fff' : undefined }}
        aria-label="Edycja zdjęcia" aria-expanded={sheet} title="Edycja (E)" onClick={() => setSheet((v) => !v)}>
        {sheet ? <X size={20} /> : <Wand2 size={20} />}
      </button>

      {/* Panel edycji */}
      <aside className="sheet glass" aria-hidden={!sheet} inert={!sheet}
        style={{ transform: sheet ? 'none' : 'translateX(110%)', visibility: sheet ? 'visible' : 'hidden', transition: 'transform .32s var(--ease), visibility 0s linear ' + (sheet ? '0s' : '.32s') }}>
        <div className="chips" style={{ padding: 12 }}>
          {([['basic', 'Podstawowe', Wand2], ['tune', 'Dostrajanie', Sliders], ['fx', 'Efekty', Sparkles], ['info', 'Info', Info]] as [Tab, string, typeof Wand2][]).map(([t, l, I]) => (
            <Chip key={t} on={tab === t} onClick={() => setTab(t)}><I size={14} /> {l}</Chip>
          ))}
        </div>

        <div className="sheet-body">
          {tab === 'basic' && (
            <>
              <h2 className="sec-h" style={{ margin: '4px 2px 0' }}>Podstawowe poprawki</h2>
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '0 2px 4px' }}>Szybkie korekty i kadrowanie</div>
              <Sec id="b-one" icon={<Zap size={17} />} title="Jedno kliknięcie" hint="Automatyczne poprawki" defaultOpen>
                <div className="chips">
                  {ONE_CLICK.map((fid) => <Chip key={fid} on={fxAmount(fid) !== undefined} onClick={() => toggleFx(fid)}>{fxLabel(fid)}</Chip>)}
                  <Chip on={edit.adj.fill > 0} onClick={() => change((s) => ({ ...s, adj: { ...s.adj, fill: s.adj.fill ? 0 : 40 } }))}>Doświetlenie</Chip>
                </div>
              </Sec>
              <Sec id="b-rot" icon={<RotateCw size={17} />} title="Obrót i odbicie" hint="Prostowanie, czerwone oczy" defaultOpen>
                <div className="flex flex-wrap gap-1">
                  <button className="ico" aria-label="Obróć w lewo" title="Obróć w lewo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, rot: (s.geo.rot + 3) % 4 } }))}><RotateCcw size={20} /></button>
                  <button className="ico" aria-label="Obróć w prawo" title="Obróć w prawo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, rot: (s.geo.rot + 1) % 4 } }))}><RotateCw size={20} /></button>
                  <button className={`ico ${edit.geo.flipH ? 'on' : ''}`} aria-label="Odbij poziomo" title="Odbij poziomo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, flipH: !s.geo.flipH } }))}><FlipHorizontal size={20} /></button>
                  <button className={`ico ${edit.geo.flipV ? 'on' : ''}`} aria-label="Odbij pionowo" title="Odbij pionowo" onClick={() => change((s) => ({ ...s, geo: { ...s.geo, flipV: !s.geo.flipV } }))}><FlipVertical size={20} /></button>
                  <button className={`ico ${redEyeMode ? 'on' : ''}`} aria-label="Czerwone oczy" aria-pressed={redEyeMode} title="Czerwone oczy" onClick={() => { setRedEyeMode((v) => !v); setSheet(true) }}><Eye size={20} /></button>
                </div>
                {redEyeMode && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted)' }}>Kliknij środek oka na zdjęciu. Esc kończy.</p>}
                {edit.redeye.length > 0 && (
                  <button className="wide" onClick={() => change((s) => ({ ...s, redeye: [] }))}>Usuń poprawki oczu ({edit.redeye.length})</button>
                )}
                <Slider label="Prostowanie (°)" value={edit.geo.angle} min={-15} max={15} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, angle: v } }))} />
              </Sec>
              <Sec id="b-crop" icon={<CropIcon size={17} />} title="Kadrowanie" hint={edit.geo.aspect === null && edit.geo.zoom === 1 ? 'Bez kadrowania' : 'Przycięte'}>
                <div className="chips">
                  {ASPECTS.map((a) => (
                    <Chip key={a.label} on={edit.geo.aspect === a.v} onClick={() => change((s) => ({ ...s, geo: { ...s.geo, aspect: a.v, panX: 0, panY: 0, zoom: a.v === null ? 1 : s.geo.zoom } }))}>{a.label}</Chip>
                  ))}
                </div>
                <Slider label="Zbliżenie" value={edit.geo.zoom} min={1} max={4} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, zoom: v } }))} />
                <Slider label="Przesunięcie poziome" value={edit.geo.panX} min={-1} max={1} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, panX: v } }))} />
                <Slider label="Przesunięcie pionowe" value={edit.geo.panY} min={-1} max={1} onStart={snap} onChange={(v) => live((s) => ({ ...s, geo: { ...s.geo, panY: v } }))} />
              </Sec>
            </>
          )}

          {tab === 'tune' && (
            <>
              <h2 className="sec-h" style={{ margin: '4px 2px 0' }}>Dostrajanie</h2>
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '0 2px 4px' }}>Dwuklik na suwaku zeruje go</div>
              {TUNE_GROUPS.map((g) => (
                <Sec key={g.id} id={g.id} icon={<g.icon size={17} />} title={g.title}
                  hint={g.items.some((t) => edit.adj[t.key]) ? 'Zmieniono' : 'Bez zmian'} defaultOpen={g.id === 'tune-light'}>
                  {g.items.map((t) => (
                    <Slider key={t.key} label={t.label} value={edit.adj[t.key]} min={t.min} max={t.max} onStart={snap}
                      onChange={(v) => live((s) => ({ ...s, adj: { ...s.adj, [t.key]: v } }))} />
                  ))}
                </Sec>
              ))}
              <button className="wide" onClick={() => change((s) => ({ ...s, adj: ZERO_ADJUST }))}>Zeruj dostrajanie</button>
            </>
          )}

          {tab === 'fx' && (
            <>
              <h2 className="sec-h" style={{ margin: '4px 2px 0' }}>Efekty</h2>
              <div style={{ color: 'var(--muted)', fontSize: 13, margin: '0 2px 4px' }}>Nakładają się w kolejności wyboru</div>
              {slidersFx.length > 0 && (
                <Sec id="fx-active" icon={<Sliders size={17} />} title="Siła efektów" hint={`${slidersFx.length} aktywne`} defaultOpen>
                  {slidersFx.map((f) => (
                    <Slider key={f.id} label={fxLabel(f.id)} value={f.amount} min={0} max={100} onStart={snap}
                      onChange={(v) => live((s) => ({ ...s, fx: s.fx.map((x) => (x.id === f.id ? { ...x, amount: v } : x)) }))} />
                  ))}
                </Sec>
              )}
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
              ].map(([k, v]) => (
                <div key={k} className="item" style={{ display: 'block' }}>
                  <small style={{ color: 'var(--muted)', fontSize: 12 }}>{k}</small>
                  <div style={{ wordBreak: 'break-all' }}>{v}</div>
                </div>
              ))}
              <Sec id="v-tags" icon={<Tag size={17} />} title="Tagi" hint={photo.tags.length ? photo.tags.join(', ') : 'Brak tagów'} defaultOpen>
                <TagEditor photos={[photo]} allTags={allTags}
                  onAdd={(t) => onTag([photo.id], t, true)} onRemove={(t) => onTag([photo.id], t, false)} />
              </Sec>
            </>
          )}
        </div>

        <div className="sheet-foot">
          <button className="primary" disabled={!dirty || saving} onClick={() => save('overwrite')}><span className="inline-flex items-center gap-2"><Save size={17} /> {saving ? 'Zapisywanie…' : 'Zapisz zmiany'}</span></button>
          <button className="wide" disabled={!dirty || saving} onClick={() => save('copy')}><CopyPlus size={17} /> Zapisz jako kopię</button>
          <div className="flex gap-2" style={{ marginTop: 6 }}>
            <button className="text flex-1" disabled={!original} onClick={restore}><span className="inline-flex items-center gap-1"><History size={15} /> Oryginał</span></button>
            <button className="danger flex-1" disabled={!dirty} onClick={() => { snap(); setEdit(EMPTY_EDIT); setRedEyeMode(false) }}><span className="inline-flex items-center gap-1"><Trash2 size={15} /> Odrzuć zmiany</span></button>
          </div>
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
