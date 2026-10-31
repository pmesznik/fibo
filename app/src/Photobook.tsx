import { useEffect, useMemo, useRef, useState } from 'react'
import { Images, X } from './FiboIcons'
import { decodeBitmap } from './imageDecode'
import { BOOK_PAPERS, MAX_BOOK_PAGES, MAX_BOOK_PHOTOS, bookPages, cellsFor, fitPhoto, paginate, type BookStyle } from './bookLayout'
import { pickFolder, readImage, saveBookPdf, thumbnailBlob, type Photo } from './api'
import { reportJob } from './ProgressDock'
import { pl } from './pl'
import { useEscape } from './ui'

const STYLES: [BookStyle, string, string][] = [
  ['one', 'Jedno zdjęcie na stronie', 'Duże zdjęcia, jedno na stronie'],
  ['two', 'Dwa zdjęcia', 'Dwa zdjęcia na stronie'],
  ['four', 'Cztery zdjęcia', 'Cztery zdjęcia na stronie, jak w albumie'],
  ['mixed', 'Mieszany układ', 'Strony na przemian z 1, 3, 2, 4 i 2 zdjęciami'],
]
const BACKGROUNDS: [string, string][] = [['#ffffff', 'Biały'], ['#f4efe6', 'Kremowy'], ['#1a1a1f', 'Czarny']]
const DPI = 200


/** Rysuje jedną stronę książki: tytułową (gdy `ids` jest null) albo ze zdjęciami. `bitmaps` zwraca obraz zdjęcia o danym numerze. */
function drawPage(canvas: HTMLCanvasElement, o: { bg: string; margin: number; gap: number; mode: 'cover' | 'contain'; numbers: boolean; title: string; subtitle: string }, ids: number[] | null, number: number, bitmaps: Map<number, ImageBitmap>) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height, m = Math.min(W, H)
  ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H)
  const dark = parseInt(o.bg.slice(1, 3), 16) < 90
  const ink = dark ? '#f2f2f2' : '#222222'
  if (!ids) {
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `700 ${m * 0.075}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText(o.title.slice(0, 60), W / 2, H * 0.44, W * 0.84)
    if (o.subtitle.trim()) { ctx.font = `400 ${m * 0.035}px "Segoe UI", system-ui, sans-serif`; ctx.fillStyle = dark ? '#c9c9c9' : '#666666'; ctx.fillText(o.subtitle.slice(0, 80), W / 2, H * 0.52, W * 0.84) }
    return
  }
  const cells = cellsFor(ids.length, W, H, o.margin * m, o.gap * m)
  ids.forEach((id, i) => {
    const bmp = bitmaps.get(id)
    if (!bmp || !cells[i]) return
    const { src, dst } = fitPhoto(bmp.width, bmp.height, cells[i], o.mode)
    ctx.drawImage(bmp, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h)
  })
  if (o.numbers) {
    ctx.fillStyle = dark ? '#aaaaaa' : '#888888'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    ctx.font = `400 ${m * 0.022}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText(String(number), W / 2, H - Math.max(o.margin * m * 0.35, m * 0.02))
  }
}

/**
 * Fotoksiążka: z wybranych zdjęć powstaje wielostronicowy PDF (A4, A5 albo kwadrat) z wybranym układem, marginesami, tłem, numerami stron i stroną tytułową.
 * Strony rysuje okno programu (200 dpi), a PDF składa program lokalnie. Gotowy plik można oddać do drukarni fotoksiążek.
 */
export function Photobook({ photos, onClose, say }: { photos: Photo[]; onClose: () => void; say: (m: string, kind?: 'ok' | 'err') => void }) {
  useEscape(onClose)
  const list = useMemo(() => photos.filter((p) => p.id >= 0 && !p.video).slice(0, MAX_BOOK_PHOTOS), [photos])
  const [style, setStyle] = useState<BookStyle>('mixed')
  const [paper, setPaper] = useState<'a4' | 'a5' | 'square'>('a4')
  const [landscape, setLandscape] = useState(false)
  const [margin, setMargin] = useState(0.06)
  const [bg, setBg] = useState('#ffffff')
  const [mode, setMode] = useState<'cover' | 'contain'>('cover')
  const [numbers, setNumbers] = useState(true)
  const [withTitle, setWithTitle] = useState(true)
  const [title, setTitle] = useState('Nasze zdjęcia')
  const [subtitle, setSubtitle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const thumbs = useRef(new Map<number, ImageBitmap>())
  const [previewTick, setPreviewTick] = useState(0)
  const previews = useRef<HTMLDivElement>(null)

  const sizePt = BOOK_PAPERS.find((p) => p.id === paper)!
  const [pw, ph] = paper === 'square' ? [sizePt.w, sizePt.h] : landscape ? [sizePt.h, sizePt.w] : [sizePt.w, sizePt.h]
  const counts = useMemo(() => paginate(list.length, style), [list.length, style])
  const groups = useMemo(() => { let k = 0; return counts.map((c) => { const g = list.slice(k, k + c).map((p) => p.id); k += c; return g }) }, [counts, list])
  const pages = bookPages(list.length, style, withTitle)
  const opts = { bg, margin, gap: margin > 0 ? Math.min(0.03, margin * 0.5) : 0.008, mode, numbers, title, subtitle }

  // Podgląd pierwszych stron z miniatur (szybko, bez wczytywania pełnych zdjęć).
  useEffect(() => {
    let dead = false
    const need = groups.slice(0, 6).flat().filter((id) => !thumbs.current.has(id))
    Promise.all(need.map(async (id) => { try { thumbs.current.set(id, await createImageBitmap(await thumbnailBlob(id))) } catch { /* brak miniatury */ } })).then(() => { if (!dead) setPreviewTick((t) => t + 1) })
    return () => { dead = true }
  }, [groups])
  useEffect(() => () => { thumbs.current.forEach((b) => b.close()); thumbs.current.clear() }, [])
  useEffect(() => {
    const host = previews.current
    if (!host) return
    host.replaceChildren()
    const shown = [...(withTitle ? [null] : []), ...groups.slice(0, 6)].slice(0, 6) as (number[] | null)[]
    shown.forEach((ids, i) => {
      const c = document.createElement('canvas')
      c.width = 180; c.height = Math.round(180 * ph / pw)
      c.style.cssText = 'border-radius:4px;box-shadow:0 1px 6px rgba(0,0,0,.35);flex:none;background:#fff'
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', ids ? `Podgląd strony ${i + 1 - (withTitle ? 1 : 0)}` : 'Podgląd strony tytułowej')
      drawPage(c, opts, ids, i + 1 - (withTitle ? 1 : 0), thumbs.current)
      host.appendChild(c)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, previewTick, bg, margin, mode, numbers, title, subtitle, withTitle, pw, ph])

  const make = async () => {
    if (list.length === 0) return
    if (pages > MAX_BOOK_PAGES) { say(`Za dużo stron (${pages}). Wybierz mniej zdjęć albo układ z większą liczbą zdjęć na stronie`, 'err'); return }
    try {
      const dir = await pickFolder('Wskaż folder, w którym zapisać fotoksiążkę (PDF)')
      if (!dir) return
      const W = Math.round(pw * DPI / 72), H = Math.round(ph * DPI / 72)
      const specs: (number[] | null)[] = [...(withTitle ? [null] : []), ...groups]
      const parts: Uint8Array[] = []
      const head = new Uint8Array(4); new DataView(head.buffer).setUint32(0, specs.length, true); parts.push(head)
      for (let i = 0; i < specs.length; i++) {
        setBusy(`Tworzę fotoksiążkę… strona ${i + 1} z ${specs.length}`)
        reportJob('pdf', i, specs.length)
        const bitmaps = new Map<number, ImageBitmap>()
        for (const id of specs[i] ?? []) bitmaps.set(id, await decodeBitmap(await readImage(id), `foto${id}.jpg`))
        const c = document.createElement('canvas'); c.width = W; c.height = H
        drawPage(c, opts, specs[i], i + 1 - (withTitle ? 1 : 0), bitmaps)
        bitmaps.forEach((b) => b.close())
        const blob: Blob | null = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9))
        if (!blob) throw new Error('nie udało się narysować strony')
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, bytes.length, true)
        parts.push(len, bytes)
      }
      const body = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
      let at = 0
      for (const p of parts) { body.set(p, at); at += p.length }
      setBusy('Zapisuję PDF…')
      const path = await saveBookPdf(body.buffer, dir, title.replace(/[^A-Za-z0-9_-]+/g, '_') || 'Fotoksiazka', paper, paper !== 'square' && landscape)
      say(`Fotoksiążka zapisana: ${path}. Możesz ją wydrukować albo oddać do drukarni`, 'ok')
      onClose()
    } catch (e) { say(`Błąd fotoksiążki: ${e}`, 'err') } finally { reportJob('pdf', 0, 0, true); setBusy(null) }
  }

  return (
    <div className="fixed inset-0 z-[1800] grid place-items-center" style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => { if (!busy) onClose() }}>
      <div className="glass flex max-h-[94vh] w-[min(96vw,760px)] flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Fotoksiążka" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Images size={18} /> Fotoksiążka (PDF)</span>
          <button className="ico" aria-label="Zamknij" disabled={!!busy} onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            {list.length} {pl(list.length, 'zdjęcie', 'zdjęcia', 'zdjęć')} w widocznej kolejności{photos.filter((p) => p.id >= 0 && !p.video).length > MAX_BOOK_PHOTOS ? ` (pierwsze ${MAX_BOOK_PHOTOS})` : ''}, razem {pages} {pl(pages, 'strona', 'strony', 'stron')}. Gotowy plik PDF możesz wydrukować albo oddać do drukarni.
          </p>
          <div ref={previews} style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '4px 2px 10px' }} aria-label="Podgląd pierwszych stron" />

          <label>Układ stron</label>
          <div className="chips" role="group" aria-label="Układ stron">
            {STYLES.map(([v, l, t]) => <button key={v} className={`chip${style === v ? ' on' : ''}`} aria-pressed={style === v} title={t} disabled={!!busy} onClick={() => setStyle(v)}>{l}</button>)}
          </div>
          <label>Papier</label>
          <div className="chips" role="group" aria-label="Papier">
            {BOOK_PAPERS.map((p) => <button key={p.id} className={`chip${paper === p.id ? ' on' : ''}`} aria-pressed={paper === p.id} disabled={!!busy} onClick={() => setPaper(p.id)}>{p.label}</button>)}
            {paper !== 'square' && <button className={`chip${landscape ? ' on' : ''}`} aria-pressed={landscape} disabled={!!busy} onClick={() => setLandscape((v) => !v)}>{landscape ? 'Poziomo' : 'Pionowo'}</button>}
          </div>
          <label>Marginesy i tło</label>
          <div className="chips" role="group" aria-label="Marginesy">
            {([[0, 'Bez marginesu'], [0.03, 'Wąskie'], [0.06, 'Średnie'], [0.1, 'Szerokie']] as [number, string][]).map(([v, l]) => <button key={v} className={`chip${margin === v ? ' on' : ''}`} aria-pressed={margin === v} disabled={!!busy} onClick={() => setMargin(v)}>{l}</button>)}
          </div>
          <div className="chips" role="group" aria-label="Kolor tła" style={{ marginTop: 6 }}>
            {BACKGROUNDS.map(([v, l]) => <button key={v} className={`chip${bg === v ? ' on' : ''}`} aria-pressed={bg === v} disabled={!!busy} onClick={() => setBg(v)}>{l}</button>)}
            <button className={`chip${mode === 'cover' ? ' on' : ''}`} aria-pressed={mode === 'cover'} disabled={!!busy} title="Zdjęcie wypełnia pole i jest przycinane" onClick={() => setMode(mode === 'cover' ? 'contain' : 'cover')}>{mode === 'cover' ? 'Wypełniaj pola (przycinanie)' : 'Całe zdjęcia (bez przycinania)'}</button>
            <button className={`chip${numbers ? ' on' : ''}`} aria-pressed={numbers} disabled={!!busy} onClick={() => setNumbers((v) => !v)}>Numery stron</button>
          </div>
          <div className="chips" style={{ marginTop: 8 }}><button className={`chip${withTitle ? ' on' : ''}`} aria-pressed={withTitle} disabled={!!busy} onClick={() => setWithTitle((v) => !v)}>Dodaj stronę tytułową</button></div>
          {withTitle && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px' }}><label htmlFor="pb-title">Tytuł</label><input id="pb-title" type="text" maxLength={60} autoComplete="off" value={title} disabled={!!busy} onChange={(e) => setTitle(e.target.value)} /></div>
              <div style={{ flex: '1 1 220px' }}><label htmlFor="pb-sub">Podtytuł (np. rok)</label><input id="pb-sub" type="text" maxLength={80} autoComplete="off" value={subtitle} disabled={!!busy} onChange={(e) => setSubtitle(e.target.value)} /></div>
            </div>
          )}
          <button className="primary" style={{ marginTop: 14 }} disabled={!!busy || list.length === 0 || pages > MAX_BOOK_PAGES} onClick={make}>{busy ?? 'Utwórz fotoksiążkę (PDF)…'}</button>
          {pages > MAX_BOOK_PAGES && <p style={{ color: 'var(--err)', fontSize: 13 }}>Za dużo stron ({pages}, najwięcej {MAX_BOOK_PAGES}). Wybierz mniej zdjęć albo układ z większą liczbą zdjęć na stronie.</p>}
        </div>
      </div>
    </div>
  )
}
