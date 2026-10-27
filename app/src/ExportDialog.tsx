import { useState } from 'react'
import { X, Download } from './FiboIcons'
import { exportGallery, exportGif, exportGpx, exportPhotos, pickFile, pickFolder, type Watermark } from './api'

const SIZES: [number, string][] = [[1024, '1024 px (e-mail)'], [1600, '1600 px'], [2048, '2048 px'], [0, 'Oryginalny rozmiar']]
const QUALITIES: [number, string][] = [[75, 'Mała'], [88, 'Dobra'], [95, 'Najlepsza']]

/** Eksport kopii zaznaczonych zdjęć do wybranego folderu (pomniejszonych, bez metadanych i lokalizacji). */
export function ExportDialog({ ids, onClose, say }: { ids: number[]; onClose: () => void; say: (m: string, kind?: 'ok' | 'err') => void }) {
  const [size, setSize] = useState(1600)
  const [quality, setQuality] = useState(88)
  const [busy, setBusy] = useState(false)
  // Znak wodny z własnego logo: plik, położenie, rozmiar i krycie (ustawienia są zapamiętywane na tym komputerze).
  const [wm, setWm] = useState<{ path: string; position: string; sizePct: number; opacity: number } | null>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('watermark-logo') ?? 'null')
      return v && typeof v.path === 'string' ? { path: v.path, position: String(v.position ?? 'br'), sizePct: +v.sizePct || 20, opacity: +v.opacity || 70 } : null
    } catch { return null }
  })
  const [useWm, setUseWm] = useState(false)
  const saveWm = (w: typeof wm) => { setWm(w); try { localStorage.setItem('watermark-logo', JSON.stringify(w)) } catch { /* brak pamięci przeglądarki */ } }
  const pickLogo = async () => {
    try {
      const f = await pickFile('Wybierz logo (PNG z przezroczystością, JPEG lub WebP)', ['png', 'jpg', 'jpeg', 'webp'], 'Logo')
      if (f) { saveWm({ path: f, position: wm?.position ?? 'br', sizePct: wm?.sizePct ?? 20, opacity: wm?.opacity ?? 70 }); setUseWm(true) }
    } catch (e) { say(`Błąd: ${e}`, 'err') }
  }
  const watermark: Watermark | null = useWm && wm ? { ...wm } : null
  const [title, setTitle] = useState('Galeria')
  const [delay, setDelay] = useState(1000)

  const run = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na wyeksportowane zdjęcia')
      if (!dir) return
      setBusy(true)
      const r = await exportPhotos(ids, dir, size, quality, watermark)
      say(r.errors.length ? `Wyeksportowano ${r.done}, błędy: ${r.errors.length} (${r.errors[0]})` : `Wyeksportowano ${r.done} do wybranego folderu`, r.errors.length ? 'err' : 'ok')
      if (!r.errors.length) onClose()
    } catch (e) { say(`Błąd eksportu: ${e}`, 'err') } finally { setBusy(false) }
  }

  /** Galeria HTML: strona offline (index.html, zdjęcia i miniatury) do otwarcia w przeglądarce, wysłania znajomym lub wgrania na serwer. */
  const runGallery = async () => {
    try {
      const dir = await pickFolder('Wybierz folder, w którym powstanie galeria')
      if (!dir) return
      setBusy(true)
      const r = await exportGallery(ids, dir, title, size > 0 ? size : 2048, quality)
      say(r.errors.length ? `Galeria: ${r.done} zdjęć, błędy: ${r.errors.length} (${r.errors[0]})` : `Galeria gotowa (${r.done} zdjęć): ${r.folder}. Otwórz plik index.html`, r.errors.length ? 'err' : 'ok')
      if (!r.errors.length) onClose()
    } catch (e) { say(`Błąd galerii: ${e}`, 'err') } finally { setBusy(false) }
  }

  const runGpx = async () => {
    try {
      const dir = await pickFolder('Wybierz folder na plik GPX')
      if (!dir) return
      setBusy(true)
      const [file, n] = await exportGpx(ids, dir)
      say(`Zapisano ${n} ${n === 1 ? 'lokalizację' : 'lokalizacji'} do pliku: ${file}`, 'ok')
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
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[85vh] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Eksport zdjęć">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Eksport zdjęć</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            {ids.length} {ids.length === 1 ? 'zdjęcie' : 'zdjęć'}. Kopie są zapisywane jako JPEG bez danych EXIF (także bez lokalizacji GPS). Oryginały zostają nietknięte, a istniejące pliki nie są nadpisywane.
          </p>
          <label>Dłuższy bok</label>
          <div className="chips">
            {SIZES.map(([v, l]) => <button key={v} className={`chip${size === v ? ' on' : ''}`} aria-pressed={size === v} onClick={() => setSize(v)}>{l}</button>)}
          </div>
          <label>Jakość</label>
          <div className="chips">
            {QUALITIES.map(([v, l]) => <button key={v} className={`chip${quality === v ? ' on' : ''}`} aria-pressed={quality === v} onClick={() => setQuality(v)}>{l}</button>)}
          </div>
          <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>Znak wodny (logo)</h3>
          <div className="chips">
            <button className="chip" onClick={pickLogo}>{wm ? 'Zmień logo…' : 'Wybierz logo…'}</button>
            {wm && <button className={`chip${useWm ? ' on' : ''}`} aria-pressed={useWm} onClick={() => setUseWm((v) => !v)}>{useWm ? 'Znak wodny włączony' : 'Użyj znaku wodnego'}</button>}
          </div>
          {wm && <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 12.5, wordBreak: 'break-all' }}>Logo: {wm.path.split(/[\\/]/).pop()}</p>}
          {wm && useWm && (
            <>
              <label>Położenie</label>
              <div role="group" aria-label="Położenie znaku wodnego" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 4 }}>
                {['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((p) => (
                  <button key={p} className={`chip${wm.position === p ? ' on' : ''}`} aria-pressed={wm.position === p} aria-label={`Położenie: ${({ t: 'góra', m: 'środek', b: 'dół' } as Record<string, string>)[p[0]]} ${({ l: 'lewo', c: 'środek', r: 'prawo' } as Record<string, string>)[p[1]]}`}
                    style={{ minWidth: 44, height: 32, justifyContent: 'center' }} onClick={() => saveWm({ ...wm, position: p })}>{wm.position === p ? '●' : '○'}</button>
                ))}
              </div>
              <label htmlFor="wm-size" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Rozmiar logo</span><span>{wm.sizePct}% szerokości zdjęcia</span></label>
              <input id="wm-size" type="range" min={3} max={60} value={wm.sizePct} onChange={(e) => saveWm({ ...wm, sizePct: +e.target.value })} />
              <label htmlFor="wm-op" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Krycie</span><span>{wm.opacity}%</span></label>
              <input id="wm-op" type="range" min={5} max={100} value={wm.opacity} onChange={(e) => saveWm({ ...wm, opacity: +e.target.value })} />
            </>
          )}
          <button className="primary" style={{ marginTop: 16 }} disabled={busy} onClick={run}>
            <span className="inline-flex items-center gap-2"><Download size={17} /> {busy ? 'Eksportuję…' : 'Wybierz folder i eksportuj'}</span>
          </button>
          <h3 style={{ margin: '18px 0 4px', fontSize: 14 }}>Albo galeria HTML</h3>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Strona do otwarcia w przeglądarce, z miniaturami, powiększeniem i opisami zdjęć. Działa offline i niczego nie ładuje z internetu.</p>
          <label htmlFor="gal-title" style={{ marginTop: 0 }}>Tytuł galerii (nazwa folderu)</label>
          <input id="gal-title" type="text" value={title} maxLength={80} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
          <button className="wide" disabled={busy || !title.trim()} onClick={runGallery}>Utwórz galerię HTML</button>
          <h3 style={{ margin: '18px 0 4px', fontSize: 14 }}>Animowany GIF</h3>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Z zaznaczonych zdjęć (2 do 60, w widocznej kolejności) powstaje animacja do 480 px.</p>
          <div className="chips">
            {([[500, '0,5 s'], [1000, '1 s'], [2000, '2 s']] as [number, string][]).map(([v, l]) => (
              <button key={v} className={`chip${delay === v ? ' on' : ''}`} aria-pressed={delay === v} onClick={() => setDelay(v)}>Klatka: {l}</button>
            ))}
          </div>
          <button className="wide" disabled={busy || ids.length < 2} onClick={runGif}>Utwórz animowany GIF</button>
          <h3 style={{ margin: '18px 0 4px', fontSize: 14 }}>Lokalizacje do GPX</h3>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 13 }}>Plik z punktami (nazwa zdjęcia, data, opis) dla map i aplikacji do tras. Zdjęcia bez lokalizacji są pomijane.</p>
          <button className="wide" disabled={busy} onClick={runGpx}>Zapisz lokalizacje jako GPX</button>
        </div>
      </div>
    </>
  )
}
