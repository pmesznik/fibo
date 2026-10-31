import { useEffect, useRef, useState } from 'react'
import { useEscape } from './ui'
import { pl } from './pl'
import { X, Download } from './FiboIcons'
import { Thumb } from './Thumb'
import { decodeBitmap } from './imageDecode'
import { FILM_SIZES, MAX_FILM_PHOTOS, filmDuration, filmFileName, recordFilm } from './film'
import { reportJob } from './ProgressDock'
import { readAudio, readImage, saveFilm, saveWatermarkText, exportGallery, exportGif, exportGpx, exportPdf, exportPhotos, pickFile, pickFolder, type Photo, type Watermark } from './api'

const SIZES: [number, string][] = [[1024, '1024 px (e-mail)'], [1600, '1600 px'], [2048, '2048 px'], [0, 'Oryginalny rozmiar']]
const QUALITIES: [number, string][] = [[75, 'Mała'], [88, 'Dobra'], [95, 'Najlepsza']]
const FORMATS: ['jpg' | 'png' | 'webp', string][] = [['jpg', 'JPEG'], ['png', 'PNG (bez strat)'], ['webp', 'WebP (bez strat)']]

/** Eksport kopii zaznaczonych zdjęć do wybranego folderu (pomniejszonych, bez metadanych i lokalizacji). */
const WM_COLORS: [string, string][] = [['#ffffff', 'Biały'], ['#000000', 'Czarny'], ['#f5b301', 'Złoty'], ['#e5484d', 'Czerwony']]

export function ExportDialog({ ids, onClose, say, initialSize, photos }: { ids: number[]; onClose: () => void; say: (m: string, kind?: 'ok' | 'err') => void; initialSize?: number; photos?: Photo[] }) {
  useEscape(onClose)
  const [size, setSize] = useState(initialSize ?? 1600)
  const [quality, setQuality] = useState(88)
  const [format, setFormat] = useState<'jpg' | 'png' | 'webp'>('jpg')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'copies' | 'gallery' | 'pdf' | 'gif' | 'film' | 'gpx'>('copies')
  // Znak wodny z własnego logo: plik, położenie, rozmiar i krycie (ustawienia są zapamiętywane na tym komputerze).
  const [wm, setWm] = useState<{ path: string; position: string; sizePct: number; opacity: number } | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('watermark-logo') ?? 'null')
      return v && typeof v.path === 'string' ? { path: v.path, position: String(v.position ?? 'br'), sizePct: +v.sizePct || 20, opacity: +v.opacity || 70 } : null
    } catch { return null }
  })
  const [useWm, setUseWm] = useState(false)
  /** Rodzaj znaku: logo z pliku albo tekst (np. „© Jan Kowalski”), rysowany na przezroczystym PNG tuż przed eksportem. */
  const stored = (() => { try { return JSON.parse(localStorage.getItem('watermark-logo') ?? 'null') ?? {} } catch { return {} } })()
  const [kind, setKind] = useState<'logo' | 'text'>(stored.kind === 'text' ? 'text' : 'logo')
  const [wmText, setWmText] = useState<string>(typeof stored.text === 'string' ? stored.text.slice(0, 80) : '')
  const [wmColor, setWmColor] = useState<string>(WM_COLORS.some((c) => c[0] === stored.color) ? stored.color : '#ffffff')
  const [textPos, setTextPos] = useState({ position: String(stored.textPosition ?? 'br'), sizePct: +stored.textSizePct || 30, opacity: +stored.textOpacity || 80 })
  const persist = (patch: Record<string, unknown>) => { try { localStorage.setItem('watermark-logo', JSON.stringify({ ...(wm ?? {}), kind, text: wmText, color: wmColor, textPosition: textPos.position, textSizePct: textPos.sizePct, textOpacity: textPos.opacity, ...patch })) } catch { /* brak pamięci przeglądarki */ } }
  const saveWm = (w: typeof wm) => { setWm(w); persist(w ?? {}) }
  const saveText = (patch: { kind?: 'logo' | 'text'; text?: string; color?: string; pos?: Partial<typeof textPos> }) => {
    const next = { kind: patch.kind ?? kind, text: patch.text ?? wmText, color: patch.color ?? wmColor, pos: { ...textPos, ...(patch.pos ?? {}) } }
    setKind(next.kind); setWmText(next.text); setWmColor(next.color); setTextPos(next.pos)
    persist({ kind: next.kind, text: next.text, color: next.color, textPosition: next.pos.position, textSizePct: next.pos.sizePct, textOpacity: next.pos.opacity })
  }
  const pickLogo = async () => {
    try {
      const f = await pickFile('Wybierz logo (PNG z przezroczystością, JPEG lub WebP)', ['png', 'jpg', 'jpeg', 'webp'], 'Logo')
      if (f) { saveWm({ path: f, position: wm?.position ?? 'br', sizePct: wm?.sizePct ?? 20, opacity: wm?.opacity ?? 70 }); setUseWm(true) }
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const textMode = kind === 'text'
  const watermark: Watermark | null = useWm && (textMode ? wmText.trim() !== '' : !!wm) ? (textMode ? { path: '', position: textPos.position, sizePct: textPos.sizePct, opacity: textPos.opacity } : { ...wm! }) : null
  /** Rysuje tekst znaku na przezroczystym PNG (z lekkim cieniem, żeby był czytelny na jasnym i ciemnym tle) i zapisuje go lokalnie. */
  const renderTextMark = async (): Promise<string> => {
    const text = wmText.trim().slice(0, 80)
    const font = '700 160px "Segoe UI", system-ui, sans-serif'
    const probe = document.createElement('canvas').getContext('2d')!
    probe.font = font
    const w = Math.min(7000, Math.ceil(probe.measureText(text).width) + 80), h = 240
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d')!
    g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center'
    g.shadowColor = wmColor === '#000000' ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.6)'; g.shadowBlur = 14; g.shadowOffsetY = 3
    g.fillStyle = wmColor
    g.fillText(text, w / 2, h / 2)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    if (!blob) throw new Error('nie udało się narysować znaku wodnego')
    return saveWatermarkText(await blob.arrayBuffer())
  }
  const [title, setTitle] = useState('Galeria')
  const [delay, setDelay] = useState(1000)
  const [layout, setLayout] = useState<[number, number]>([2, 2])

  // Film ze zdjęć (MP4): czas na zdjęcie, przejście, rozdzielczość i muzyka; nagrywanie trwa tyle, ile film.
  const [filmSec, setFilmSec] = useState(4)
  const [filmFade, setFilmFade] = useState(0.8)
  const [filmZoom, setFilmZoom] = useState(true)
  const [filmSize, setFilmSize] = useState(0)
  const [filmMusic, setFilmMusic] = useState<{ name: string; bytes: ArrayBuffer } | null>(null)
  const [filmProg, setFilmProg] = useState<{ done: number; total: number } | null>(null)
  const [filmAbort, setFilmAbort] = useState<AbortController | null>(null)
  // Zamknięcie okna w trakcie nagrywania przerywa film.
  const filmAbortRef = useRef<AbortController | null>(null)
  filmAbortRef.current = filmAbort
  useEffect(() => () => filmAbortRef.current?.abort(), [])
  const filmIds = (photos ? ids.filter((i) => !photos.find((p) => p.id === i)?.video) : ids).slice(0, MAX_FILM_PHOTOS)
  const pickFilmMusic = async () => {
    try {
      const f = await pickFile('Wybierz muzykę do filmu', ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'flac'], 'Muzyka')
      if (f) setFilmMusic({ name: f.split(/[\\/]/).pop() ?? 'muzyka', bytes: await readAudio(f) })
    } catch (e) { say(`Błąd muzyki: ${e}`, 'err') }
  }
  const runFilm = async () => {
    if (filmIds.length < 2) return
    const ac = new AbortController()
    try {
      const dir = await pickFolder('Wybierz folder na film')
      if (!dir) return
      setFilmAbort(ac); setFilmProg({ done: 0, total: 1 }); setBusy(true)
      const [, width, height] = FILM_SIZES[filmSize]
      const opts = { count: filmIds.length, secPerPhoto: filmSec, fadeSec: Math.min(filmFade, filmSec / 2), zoom: filmZoom, width, height, fps: 30 }
      const r = await recordFilm(opts, async (i) => decodeBitmap(await readImage(filmIds[i]), `foto${i}.jpg`), filmMusic?.bytes ?? null, (d, t) => { setFilmProg({ done: d, total: t }); reportJob('film', Math.round(d), Math.round(t)) }, ac.signal)
      reportJob('film', 1, 1, true)
      const path = await saveFilm(dir, filmFileName(new Date(), r.ext), await r.blob.arrayBuffer())
      say(`Film zapisany: ${path.split(/[\\/]/).pop()} (${Math.round(r.seconds)} s${r.ext === 'webm' ? ', format WebM, bo okno nie umie MP4' : ''})`, 'ok')
      onClose()
    } catch (e) {
      reportJob('film', 1, 1, true)
      say(ac.signal.aborted ? 'Przerwano tworzenie filmu' : `Błąd filmu: ${e}`, ac.signal.aborted ? 'ok' : 'err')
    } finally { setBusy(false); setFilmProg(null); setFilmAbort(null) }
  }

  const run = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na wyeksportowane zdjęcia')
      if (!dir) return
      setBusy(true)
      const wmFinal = watermark && textMode ? { ...watermark, path: await renderTextMark() } : watermark
      const r = await exportPhotos(ids, dir, size, quality, wmFinal, format)
      say(r.errors.length ? `Wyeksportowano ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `Wyeksportowano ${r.done} do wybranego folderu`, r.errors.length ? 'err' : 'ok')
      if (!r.errors.length) onClose()
    } catch (e) { say(`Błąd eksportu: ${e}`, 'err') } finally { setBusy(false) }
  }

  /** Kopie bez metadanych (EXIF, GPS, aparat): oryginalny rozmiar i najwyższa jakość, bez znaku wodnego. */
  const runStrip = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na kopie bez metadanych')
      if (!dir) return
      setBusy(true)
      const r = await exportPhotos(ids, dir, 0, 98, null)
      say(r.errors.length ? `Kopie bez metadanych: ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `Zapisano ${r.done} kopii bez metadanych i lokalizacji (oryginały nietknięte)`, r.errors.length ? 'err' : 'ok')
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }

  /** Galeria HTML: strona offline (index.html, zdjęcia i miniatury) do otwarcia w przeglądarce, wysłania znajomym lub wgrania na serwer. */
  const runGallery = async () => {
    try {
      const dir = await pickFolder('Wybierz folder, w którym powstanie galeria')
      if (!dir) return
      setBusy(true)
      const r = await exportGallery(ids, dir, title, size > 0 ? size : 2048, quality)
      say(r.errors.length ? `Galeria: ${r.done} ${pl(r.done, 'zdjęcie', 'zdjęcia', 'zdjęć')}, błędy: ${r.errors.length} (${r.errors[0]})` : `Galeria gotowa (${r.done} ${pl(r.done, 'zdjęcie', 'zdjęcia', 'zdjęć')}): ${r.folder}. Otwórz plik index.html`, r.errors.length ? 'err' : 'ok')
      if (!r.errors.length) onClose()
    } catch (e) { say(`Błąd galerii: ${e}`, 'err') } finally { setBusy(false) }
  }

  const runPdf = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na plik PDF')
      if (!dir) return
      setBusy(true)
      const [file, pages] = await exportPdf(ids, dir, layout[0], layout[1], 1800, quality)
      say(`PDF gotowy (${pages} ${pl(pages, 'strona', 'strony', 'stron')} A4): ${file}. Otwórz go i wydrukuj albo wyślij dalej`, 'ok')
    } catch (e) { say(`${e}`, 'err') } finally { setBusy(false) }
  }
  const runGpx = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na plik GPX')
      if (!dir) return
      setBusy(true)
      const [file, n] = await exportGpx(ids, dir)
      say(`Zapisano ${n} ${pl(n, 'lokalizację', 'lokalizacje', 'lokalizacji')} do pliku: ${file}`, 'ok')
    } catch (e) { say(`${e}`, 'err') } finally { setBusy(false) }
  }
  const runGif = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na animowany GIF')
      if (!dir) return
      setBusy(true)
      const file = await exportGif(ids, dir, 480, delay)
      say(`Animacja zapisana: ${file}`, 'ok')
    } catch (e) { say(`${e}`, 'err') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Eksport zdjęć">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Eksport zdjęć</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <div className="seg" role="tablist" aria-label="Rodzaj eksportu">
            {([['copies', 'Kopie'], ['gallery', 'Galeria'], ['pdf', 'PDF'], ['gif', 'GIF'], ['film', 'Film'], ['gpx', 'Lokalizacje']] as [typeof tab, string][]).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>
            ))}
          </div>
          {tab === 'copies' && (
          <>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            {ids.length} {pl(ids.length, 'zdjęcie', 'zdjęcia', 'zdjęć')}. Kopie powstają bez danych EXIF (także bez lokalizacji GPS), więc nadają się do wysłania dalej. Zdjęcia HEIC, RAW i inne formaty można tu zamienić na JPEG, PNG albo WebP. Oryginały zostają nietknięte, a istniejące pliki nie są nadpisywane.
          </p>
          <label>Dłuższy bok</label>
          <div className="chips">
            {SIZES.map(([v, l]) => <button key={v} className={`chip${size === v ? ' on' : ''}`} aria-pressed={size === v} onClick={() => setSize(v)}>{l}</button>)}
          </div>
          <label>Format</label>
          <div className="chips">
            {FORMATS.map(([v, l]) => <button key={v} className={`chip${format === v ? ' on' : ''}`} aria-pressed={format === v} onClick={() => setFormat(v)}>{l}</button>)}
          </div>
          {format === 'jpg' && <label>Jakość</label>}
          {format === 'jpg' && <div className="chips">
            {QUALITIES.map(([v, l]) => <button key={v} className={`chip${quality === v ? ' on' : ''}`} aria-pressed={quality === v} onClick={() => setQuality(v)}>{l}</button>)}
          </div>}
          <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>Znak wodny</h3>
          <div className="chips" role="group" aria-label="Rodzaj znaku wodnego">
            <button className={`chip${!textMode ? ' on' : ''}`} aria-pressed={!textMode} onClick={() => saveText({ kind: 'logo' })}>Logo z pliku</button>
            <button className={`chip${textMode ? ' on' : ''}`} aria-pressed={textMode} onClick={() => saveText({ kind: 'text' })}>Tekst</button>
          </div>
          {!textMode && (
            <div className="chips" style={{ marginTop: 6 }}>
              <button className="chip" onClick={pickLogo}>{wm ? 'Zmień logo…' : 'Wybierz logo…'}</button>
              {wm && <button className={`chip${useWm ? ' on' : ''}`} aria-pressed={useWm} onClick={() => setUseWm((v) => !v)}>{useWm ? 'Znak wodny włączony' : 'Użyj znaku wodnego'}</button>}
            </div>
          )}
          {!textMode && wm && <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 12.5, wordBreak: 'break-all' }}>Logo: {wm.path.split(/[\\/]/).pop()}</p>}
          {textMode && (
            <>
              <label htmlFor="wm-text">Tekst znaku wodnego</label>
              <input id="wm-text" type="text" maxLength={80} autoComplete="off" placeholder="np. © Jan Kowalski 2026" value={wmText} onChange={(e) => { saveText({ text: e.target.value }); setUseWm(e.target.value.trim() !== '') }} />
              <label>Kolor</label>
              <div className="chips" role="group" aria-label="Kolor tekstu znaku wodnego">
                {WM_COLORS.map(([v, l]) => <button key={v} className={`chip${wmColor === v ? ' on' : ''}`} aria-pressed={wmColor === v} onClick={() => saveText({ color: v })}>{l}</button>)}
              </div>
              {wmText.trim() !== '' && <button className={`chip${useWm ? ' on' : ''}`} style={{ marginTop: 8 }} aria-pressed={useWm} onClick={() => setUseWm((v) => !v)}>{useWm ? 'Znak wodny włączony' : 'Użyj znaku wodnego'}</button>}
            </>
          )}
          {useWm && (textMode ? wmText.trim() !== '' : !!wm) && (() => {
            const cur = textMode ? textPos : { position: wm!.position, sizePct: wm!.sizePct, opacity: wm!.opacity }
            const upd = (patch: Partial<typeof textPos>) => (textMode ? saveText({ pos: patch }) : saveWm({ ...wm!, ...(patch.position !== undefined ? { position: patch.position } : {}), ...(patch.sizePct !== undefined ? { sizePct: patch.sizePct } : {}), ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}) }))
            return (
              <>
                <label>Położenie</label>
                <div role="group" aria-label="Położenie znaku wodnego" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 4 }}>
                  {['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((p) => (
                    <button key={p} className={`chip${cur.position === p ? ' on' : ''}`} aria-pressed={cur.position === p} aria-label={`Położenie: ${({ t: 'góra', m: 'środek', b: 'dół' } as Record<string, string>)[p[0]]} ${({ l: 'lewo', c: 'środek', r: 'prawo' } as Record<string, string>)[p[1]]}`}
                      style={{ minWidth: 44, height: 32, justifyContent: 'center' }} onClick={() => upd({ position: p })}>{cur.position === p ? '●' : '○'}</button>
                  ))}
                </div>
                <label htmlFor="wm-size" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Rozmiar znaku</span><span>{cur.sizePct}% szerokości zdjęcia</span></label>
                <input id="wm-size" type="range" min={3} max={60} value={cur.sizePct} onChange={(e) => upd({ sizePct: +e.target.value })} />
                <label htmlFor="wm-op" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Krycie</span><span>{cur.opacity}%</span></label>
                <input id="wm-op" type="range" min={5} max={100} value={cur.opacity} onChange={(e) => upd({ opacity: +e.target.value })} />
              </>
            )
          })()}
          <button className="primary" style={{ marginTop: 16 }} disabled={busy} onClick={run}>
            <span className="inline-flex items-center gap-2"><Download size={17} /> {busy ? 'Eksportuję…' : 'Wybierz folder i eksportuj'}</span>
          </button>
          <h3 style={{ margin: '18px 0 4px', fontSize: 14 }}>Kopie bez metadanych</h3>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Pełny rozmiar i najwyższa jakość, ale bez EXIF, aparatu i lokalizacji GPS. Dobre przed opublikowaniem zdjęć.</p>
          <button className="wide" disabled={busy} onClick={runStrip}>Zapisz kopie bez metadanych</button>
          </>
          )}
          {tab === 'gallery' && (
          <>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Strona do otwarcia w przeglądarce, z miniaturami, powiększeniem i opisami zdjęć. Działa offline i niczego nie ładuje z internetu.</p>
          <label htmlFor="gal-title" style={{ marginTop: 0 }}>Tytuł galerii (nazwa folderu)</label>
          <input id="gal-title" type="text" value={title} maxLength={80} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
          <button className="wide" disabled={busy || !title.trim()} onClick={runGallery}>Utwórz galerię HTML</button>
          </>
          )}
          {tab === 'pdf' && (
          <>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Strony A4 ze zdjęciami (jakość jak wyżej). Plik otworzysz w dowolnym programie do PDF i wydrukujesz lub wyślesz.</p>
          <div className="chips">
            {([[[1, 1], '1 na stronie'], [[1, 2], '2 na stronie (ok. 13×18)'], [[2, 2], '4 na stronie (ok. 9×13)'], [[2, 3], '6 na stronie'], [[3, 3], '9 na stronie'], [[3, 4], 'Arkusz kontaktowy (12)'], [[4, 5], 'Arkusz kontaktowy (20)']] as [[number, number], string][]).map(([v, l]) => (
              <button key={l} className={`chip${layout[0] === v[0] && layout[1] === v[1] ? ' on' : ''}`} aria-pressed={layout[0] === v[0] && layout[1] === v[1]} onClick={() => setLayout(v)}>{l}</button>
            ))}
          </div>
          {(() => {
            const per = layout[0] * layout[1]
            const pages = Math.ceil(ids.length / per)
            const shown = Math.min(per, ids.length)
            return (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
                <div role="img" aria-label={`Podgląd pierwszej strony A4: ${layout[0]} w poziomie, ${layout[1]} w pionie`}
                  style={{ width: 96, aspectRatio: '595 / 842', flex: 'none', background: '#fff', border: '1px solid var(--glass-line)', borderRadius: 3, boxShadow: 'var(--elev-1)', padding: 5,
                    display: 'grid', gridTemplateColumns: `repeat(${layout[0]}, 1fr)`, gridTemplateRows: `repeat(${layout[1]}, 1fr)`, gap: 3 }}>
                  {Array.from({ length: per }).map((_, k) => {
                    const ph = k < shown ? photos?.find((p) => p.id === ids[k]) : undefined
                    return <div key={k} style={{ position: 'relative', overflow: 'hidden', background: k < shown ? 'var(--tonal)' : 'transparent', outline: k < shown ? 'none' : '1px dashed var(--glass-line)' }}>{ph && <Thumb photo={ph} fit="contain" />}</div>
                  })}
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  <b style={{ color: 'var(--text)' }}>Przegląd przed drukiem</b><br />
                  {pages} {pl(pages, 'strona', 'strony', 'stron')} A4, po {per} {pl(per, 'zdjęciu', 'zdjęcia', 'zdjęć')} na stronie. Zdjęcia nie są przycinane, tylko dopasowane do pola.
                </div>
              </div>
            )
          })()}
          <button className="wide" disabled={busy} onClick={runPdf}>Utwórz PDF</button>
          </>
          )}
          {tab === 'gif' && (
          <>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Z zaznaczonych zdjęć (2 do 60, w widocznej kolejności) powstaje animacja do 480 px.</p>
          <div className="chips">
            {([[500, '0,5 s'], [1000, '1 s'], [2000, '2 s']] as [number, string][]).map(([v, l]) => (
              <button key={v} className={`chip${delay === v ? ' on' : ''}`} aria-pressed={delay === v} onClick={() => setDelay(v)}>Klatka: {l}</button>
            ))}
          </div>
          <button className="wide" disabled={busy || ids.length < 2} onClick={runGif}>Utwórz animowany GIF</button>
          </>
          )}
          {tab === 'film' && (
          <>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Z zaznaczonych zdjęć ({filmIds.length}, w widocznej kolejności) powstaje film z płynnymi przejściami. Nagrywanie trwa tyle, ile sam film, więc zostaw okno programu na wierzchu.</p>
          <label>Czas na zdjęcie</label>
          <div className="chips" role="group" aria-label="Czas na zdjęcie">
            {[2, 3, 4, 6, 8].map((v) => <button key={v} className={`chip${filmSec === v ? ' on' : ''}`} aria-pressed={filmSec === v} disabled={busy} onClick={() => setFilmSec(v)}>{v} s</button>)}
          </div>
          <label>Przejście</label>
          <div className="chips" role="group" aria-label="Przejście między zdjęciami">
            {([[0, 'Brak'], [0.5, 'Krótkie'], [0.8, 'Płynne'], [1.5, 'Długie']] as [number, string][]).map(([v, l]) => <button key={v} className={`chip${filmFade === v ? ' on' : ''}`} aria-pressed={filmFade === v} disabled={busy} onClick={() => setFilmFade(v)}>{l}</button>)}
          </div>
          <label>Jakość</label>
          <div className="chips" role="group" aria-label="Rozdzielczość filmu">
            {FILM_SIZES.map(([l], i) => <button key={l} className={`chip${filmSize === i ? ' on' : ''}`} aria-pressed={filmSize === i} disabled={busy} onClick={() => setFilmSize(i)}>{l}</button>)}
            <button className={`chip${filmZoom ? ' on' : ''}`} aria-pressed={filmZoom} disabled={busy} onClick={() => setFilmZoom((v) => !v)}>Powolne przybliżenie</button>
          </div>
          <label>Muzyka (opcjonalnie)</label>
          <div className="chips" style={{ alignItems: 'center' }}>
            <button className="chip" disabled={busy} onClick={pickFilmMusic}>{filmMusic ? 'Zmień muzykę…' : 'Wybierz muzykę…'}</button>
            {filmMusic && <><span style={{ fontSize: 13, color: 'var(--muted)' }}>{filmMusic.name}</span><button className="chip" disabled={busy} onClick={() => setFilmMusic(null)}>Usuń</button></>}
          </div>
          <p style={{ margin: '8px 0', color: 'var(--muted)', fontSize: 13 }}>Długość filmu: {Math.round(filmDuration({ count: filmIds.length, secPerPhoto: filmSec }))} s. Muzyka jest powtarzana i wyciszana na końcu.</p>
          {filmProg ? (
            <div role="status" aria-live="polite">
              <div style={{ height: 8, borderRadius: 4, background: 'var(--tonal)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (filmProg.done / Math.max(1, filmProg.total)) * 100)}%`, height: '100%', background: 'var(--accent)' }} /></div>
              <div style={{ fontSize: 13, margin: '6px 0' }}>Nagrywam: {Math.round(filmProg.done)} z {Math.round(filmProg.total)} s</div>
              <button className="wide" onClick={() => filmAbort?.abort()}><X size={15} /> Przerwij</button>
            </div>
          ) : (
            <button className="wide" disabled={busy || filmIds.length < 2} onClick={runFilm}>Utwórz film…</button>
          )}
          </>
          )}
          {tab === 'gpx' && (
          <>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Plik z punktami (nazwa zdjęcia, data, opis) dla map i aplikacji do tras. Zdjęcia bez lokalizacji są pomijane.</p>
          <button className="wide" disabled={busy} onClick={runGpx}>Zapisz lokalizacje jako GPX</button>
          </>
          )}
        </div>
      </div>
    </>
  )
}
