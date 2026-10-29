import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Download, Printer, Sparkles, Trash2, X } from './FiboIcons'
import { Thumb } from './Thumb'
import { decodeBitmap } from './imageDecode'
import { photoFaceStats, pickFolder, readImage, saveCalendarPdf, thumbnailBlob, type Photo } from './api'
import { MONTHS, MONTHS_SHORT, autoPick, parseEvents, type FaceStat, type WeekStart } from './calendarData'
import { ACCENT_CHOICES, drawCalendarPage, pagePx, type CalOptions, type CalStyle, type Orient, type PageRef, type Paper } from './calendarRender'
import { reportJob } from './ProgressDock'
import { Chip, useEscape } from './ui'

type Settings = {
  year: number; weekStart: WeekStart; orientation: Orient; paper: Paper; style: CalStyle
  holidays: boolean; cover: boolean; fit: 'cover' | 'contain'; accent: string; coverTitle: string; eventsText: string
}
const SETTINGS_KEY = 'calendar-settings'
const DRAFT_KEY = 'calendar-draft'

const defaults = (): Settings => {
  const now = new Date()
  // Od końca lata proponujemy kalendarz na przyszły rok, bo wtedy ludzie go przygotowują.
  return { year: now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear(), weekStart: 'mon', orientation: 'portrait', paper: 'a4', style: 'classic', holidays: true, cover: true, fit: 'cover', accent: 'auto', coverTitle: '', eventsText: '' }
}
const loadSettings = (): Settings => {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return defaults() }
}
type Drafts = Record<string, Record<number, number>>
const loadDrafts = (): Drafts => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') } catch { return {} } }

const keyOf = (p: PageRef) => (p.kind === 'cover' ? 0 : p.month)

// ---- zdjęcia na stronach: bitmapy z pamięci podręcznej (podgląd) albo wczytane na czas zapisu (wysoka rozdzielczość)

const cache = new Map<string, Promise<ImageBitmap | null>>()

async function decodeScaled(photo: Photo, maxSide: number): Promise<ImageBitmap | null> {
  try {
    const full = await decodeBitmap(await readImage(photo.id), photo.name)
    const k = Math.min(1, maxSide / Math.max(full.width, full.height))
    if (k >= 1) return full
    const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' })
    full.close()
    return small
  } catch { return null }
}

function cached(photo: Photo, kind: 'thumb' | 'preview'): Promise<ImageBitmap | null> {
  const key = `${photo.id}:${kind}:${photo.modified}`
  let p = cache.get(key)
  if (!p) {
    p = kind === 'thumb'
      ? thumbnailBlob(photo.id).then(async (b) => decodeBitmap(await b.arrayBuffer(), 'x.jpg')).catch(() => null)
      : decodeScaled(photo, 1600)
    cache.set(key, p)
  }
  return p
}

/** Ostrość zdjęcia z miniatury (wariancja laplasjanu na szarości 96x72): większa = ostrzejsze. */
async function thumbSharpness(id: number): Promise<number> {
  const bmp = await decodeBitmap(await (await thumbnailBlob(id)).arrayBuffer(), 'x.jpg')
  const c = document.createElement('canvas')
  c.width = 96; c.height = 72
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, 96, 72)
  bmp.close()
  const d = ctx.getImageData(0, 0, 96, 72).data
  const g = new Float32Array(96 * 72)
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  let sum = 0, sum2 = 0, n = 0
  for (let y = 1; y < 71; y++) for (let x = 1; x < 95; x++) {
    const l = 4 * g[y * 96 + x] - g[y * 96 + x - 1] - g[y * 96 + x + 1] - g[(y - 1) * 96 + x] - g[(y + 1) * 96 + x]
    sum += l; sum2 += l * l; n++
  }
  return sum2 / n - (sum / n) ** 2
}

/** Pojedyncza strona (podgląd albo miniatura) rysowana na własnym płótnie. */
function PagePreview({ page, opt, photo, dpi, className, hints }: { page: PageRef; opt: CalOptions; photo: Photo | null; dpi: number; className?: string; hints?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const optKey = JSON.stringify(opt)
  useEffect(() => {
    let dead = false
    const { w, h } = pagePx(opt.paper, opt.orientation, dpi)
    const c = ref.current
    if (!c) return
    c.width = w; c.height = h
    ;(async () => {
      const bmp = photo ? await cached(photo, dpi >= 60 ? 'preview' : 'thumb') : null
      if (dead) return
      const ctx = c.getContext('2d')
      if (ctx) drawCalendarPage(ctx, w, h, page, opt, bmp, photo?.color, hints)
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optKey, photo?.id, photo?.modified, page.kind, (page as { month?: number }).month, dpi, hints])
  return <canvas ref={ref} className={className} aria-hidden />
}

function PhotoPicker({ photos, month, onPick, onClose }: { photos: Photo[]; month: number | null; onPick: (p: Photo) => void; onClose: () => void }) {
  useEscape(onClose)
  const [filter, setFilter] = useState<'month' | 'fav' | 'all'>(month ? 'month' : 'fav')
  const [limit, setLimit] = useState(240)
  const list = useMemo(() => {
    const ok = photos.filter((p) => p.id >= 0)
    const f = filter === 'month' && month ? ok.filter((p) => Number(p.taken?.slice(5, 7)) === month) : filter === 'fav' ? ok.filter((p) => p.favorite || p.rating >= 4) : ok
    return [...f].sort((a, b) => (b.taken ?? '').localeCompare(a.taken ?? ''))
  }, [photos, filter, month])
  return (
    <>
      <div className="fixed inset-0 z-[2300]" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[2400] flex max-h-[88vh] w-[min(94vw,820px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-modal="true" aria-label="Wybierz zdjęcie do kalendarza">
        <div className="dr-head" style={{ paddingBottom: 6 }}>
          <span style={{ fontSize: 20 }}>{month ? `Zdjęcie na ${MONTHS[month - 1].toLowerCase()}` : 'Zdjęcie na okładkę'}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div className="chips" style={{ padding: '0 16px 8px' }}>
          {month && <Chip on={filter === 'month'} onClick={() => setFilter('month')}>Z tego miesiąca (z każdego roku)</Chip>}
          <Chip on={filter === 'fav'} onClick={() => setFilter('fav')}>Ulubione i dobrze ocenione</Chip>
          <Chip on={filter === 'all'} onClick={() => setFilter('all')}>Wszystkie</Chip>
        </div>
        <div style={{ padding: '0 16px 16px', overflowY: 'auto' }}>
          {list.length === 0 && <p style={{ color: 'var(--muted)' }}>Brak zdjęć w tym filtrze. Wybierz „Wszystkie”.</p>}
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
            {list.slice(0, limit).map((p) => (
              <button key={p.id} className="bare relative aspect-square overflow-hidden" style={{ borderRadius: 'var(--r-md)', boxShadow: 'var(--elev-1)' }} aria-label={`Wybierz ${p.name}`} title={`${p.name} ${p.taken?.slice(0, 10) ?? ''}`} onClick={() => onPick(p)}>
                <Thumb photo={p} />
              </button>
            ))}
          </div>
          {list.length > limit && <button className="wide" onClick={() => setLimit((l) => l + 240)}>Pokaż więcej ({list.length - limit})</button>}
        </div>
      </div>
    </>
  )
}

/**
 * Kalendarz ze zdjęć: wybór roku (obecny lub następny), zdjęcie na okładkę i na każdy miesiąc (ręcznie albo automatycznie), styl i format,
 * polskie święta oraz własne ważne daty. Wynik to PDF do druku albo wydruk bezpośrednio z programu.
 */
export function CalendarMaker({ photos, onClose, say }: { photos: Photo[]; onClose: () => void; say: (m: string, kind?: 'ok' | 'err') => void }) {
  useEscape(onClose)
  const [st, setSt] = useState<Settings>(loadSettings)
  const [drafts, setDrafts] = useState<Drafts>(loadDrafts)
  const [sel, setSel] = useState(0)
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [eventsApplied, setEventsApplied] = useState(st.eventsText)

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSt((s) => ({ ...s, [k]: v }))
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(st)) } catch { /* brak pamięci */ } }, [st])
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)) } catch { /* brak pamięci */ } }, [drafts])
  useEffect(() => { const t = window.setTimeout(() => setEventsApplied(st.eventsText), 350); return () => window.clearTimeout(t) }, [st.eventsText])

  const picks = drafts[st.year] ?? {}
  const setPicks = useCallback((next: Record<number, number>) => setDrafts((d) => ({ ...d, [st.year]: next })), [st.year])
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])

  const opt: CalOptions = useMemo(
    () => ({ year: st.year, weekStart: st.weekStart, orientation: st.orientation, paper: st.paper, style: st.style, holidays: st.holidays, events: parseEvents(eventsApplied), fit: st.fit, accent: st.accent, coverTitle: st.coverTitle }),
    [st.year, st.weekStart, st.orientation, st.paper, st.style, st.holidays, eventsApplied, st.fit, st.accent, st.coverTitle],
  )
  const pages: PageRef[] = useMemo(() => [...(st.cover ? [{ kind: 'cover' } as PageRef] : []), ...Array.from({ length: 12 }, (_, i) => ({ kind: 'month', month: i + 1 }) as PageRef)], [st.cover])
  const page = pages[Math.min(sel, pages.length - 1)]
  const photoOf = (p: PageRef) => byId.get(picks[keyOf(p)]) ?? null
  const filled = pages.filter((p) => photoOf(p)).length

  const runAuto = async () => {
    setBusy('Dobieram zdjęcia…')
    try {
      const stats = new Map<number, FaceStat>()
      try { (await photoFaceStats()).forEach(([id, n, q]) => stats.set(id, { faces: n, quality: q })) } catch { /* bez danych o twarzach */ }
      const res = await autoPick(photos, st.year, st.orientation, stats, thumbSharpness, (d, t) => setBusy(`Dobieram zdjęcia… ${d} z ${t}`))
      setPicks(res)
      const n = Object.keys(res).length
      say(n ? `Dobrano zdjęcia: ${n}. Możesz zmienić każde z nich.` : 'Brak zdjęć do wyboru. Dodaj zdjęcia do biblioteki.', n ? 'ok' : 'err')
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(null) }
  }

  /** Renderuje stronę w wysokiej rozdzielczości do JPEG. */
  const renderJpeg = async (p: PageRef, dpi: number): Promise<Blob> => {
    const { w, h } = pagePx(opt.paper, opt.orientation, dpi)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ph = photoOf(p)
    const bmp = ph ? await decodeScaled(ph, 3200) : null
    drawCalendarPage(c.getContext('2d')!, w, h, p, opt, bmp, ph?.color, false)
    bmp?.close()
    return new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Nie udało się narysować strony'))), 'image/jpeg', 0.93))
  }

  const savePdf = async () => {
    try {
      const dir = await pickFolder('Wskaż folder, w którym zapisać kalendarz (PDF)')
      if (!dir) return
      setBusy('Tworzę PDF…')
      const parts: Uint8Array[] = []
      const head = new Uint8Array(4); new DataView(head.buffer).setUint32(0, pages.length, true); parts.push(head)
      for (let i = 0; i < pages.length; i++) {
        reportJob('calendar', i, pages.length)
        setBusy(`Tworzę PDF… strona ${i + 1} z ${pages.length}`)
        const bytes = new Uint8Array(await (await renderJpeg(pages[i], 200)).arrayBuffer())
        const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, bytes.length, true)
        parts.push(len, bytes)
      }
      const total = parts.reduce((s, p) => s + p.length, 0)
      const body = new Uint8Array(total)
      let at = 0
      for (const p of parts) { body.set(p, at); at += p.length }
      const path = await saveCalendarPdf(body.buffer, dir, `Kalendarz_${st.year}`, st.paper, st.orientation === 'landscape')
      say(`Kalendarz zapisany: ${path}. Wydrukuj go w dowolnym programie do PDF albo oddaj do drukarni`, 'ok')
    } catch (e) { say(`Błąd zapisu kalendarza: ${e}`, 'err') } finally { reportJob('calendar', 0, 0, true); setBusy(null) }
  }

  const print = async () => {
    const urls: string[] = []
    try {
      setBusy('Przygotowuję wydruk…')
      const root = document.createElement('div')
      root.id = 'print-root'
      for (let i = 0; i < pages.length; i++) {
        reportJob('calendar', i, pages.length)
        const url = URL.createObjectURL(await renderJpeg(pages[i], 150))
        urls.push(url)
        const img = new Image()
        img.src = url
        img.alt = ''
        await img.decode().catch(() => {})
        root.appendChild(img)
      }
      const style = document.createElement('style')
      style.id = 'print-page-style'
      style.textContent = `@page { size: ${st.paper.toUpperCase()} ${st.orientation}; margin: 0 }`
      document.head.appendChild(style)
      document.body.appendChild(root)
      const cleanup = () => { root.remove(); style.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); window.removeEventListener('afterprint', cleanup) }
      window.addEventListener('afterprint', cleanup)
      window.setTimeout(cleanup, 10 * 60 * 1000)
      reportJob('calendar', 0, 0, true)
      setBusy(null)
      window.print()
    } catch (e) {
      urls.forEach((u) => URL.revokeObjectURL(u))
      say(`Błąd przygotowania wydruku: ${e}`, 'err')
      reportJob('calendar', 0, 0, true)
      setBusy(null)
    }
  }

  const years = [new Date().getFullYear(), new Date().getFullYear() + 1]
  const section = (title: string, body: React.ReactNode) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--muted)', margin: '0 0 6px' }}>{title}</div>
      {body}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[2000] overflow-y-auto" style={{ background: 'var(--bg)' }} role="dialog" aria-modal="true" aria-label="Kalendarz ze zdjęć">
      <button className="ico glass" style={{ position: 'fixed', top: 12, left: 12, zIndex: 2010, width: 'var(--bar-h)', height: 'var(--bar-h)', borderRadius: '50%' }} aria-label="Zamknij kalendarz" onClick={onClose}><X size={22} /></button>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: 'calc(18px + var(--sat)) 20px 60px' }}>
        <div style={{ paddingLeft: 'calc(var(--bar-h) + 12px)', minHeight: 'var(--bar-h)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <h1 style={{ margin: 0, font: '700 22px/1.2 system-ui', display: 'flex', alignItems: 'center', gap: 10 }}><CalendarDays size={24} /> Kalendarz ze zdjęć</h1>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Wybierz rok i zdjęcia na każdy miesiąc. {filled} z {pages.length} stron ma zdjęcie.</div>
          </div>
          <button className="primary" style={{ width: 'auto', padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 8 }} disabled={!!busy} onClick={runAuto} title="Program wybiera najlepsze zdjęcia: pasujące do miesiąca, ostre, ocenione i z twarzami. Wszystko liczy się na tym komputerze.">
            <Sparkles size={18} /> Dobierz zdjęcia automatycznie
          </button>
          <button className="chip" style={{ minHeight: 42 }} disabled={!!busy || filled === 0} onClick={savePdf}><Download size={16} /> Zapisz PDF</button>
          <button className="chip" style={{ minHeight: 42 }} disabled={!!busy || filled === 0} onClick={print}><Printer size={16} /> Drukuj</button>
        </div>
        {busy && <div role="status" style={{ marginTop: 10, paddingLeft: 'calc(var(--bar-h) + 12px)', color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>{busy}</div>}

        <div className="cal-grid" style={{ marginTop: 18 }}>
          <aside className="glass cal-side" style={{ borderRadius: 'var(--r-lg)', padding: 16 }} aria-label="Ustawienia kalendarza">
            {section('Rok', (
              <div className="chips">
                {years.map((y) => <Chip key={y} on={st.year === y} onClick={() => set('year', y)}>{y}{y === years[0] ? ' (obecny)' : ' (następny)'}</Chip>)}
                {!years.includes(st.year) && <Chip on onClick={() => set('year', st.year)}>{st.year}</Chip>}
                <button className="chip" aria-label="Poprzedni rok" onClick={() => set('year', st.year - 1)}>−</button>
                <button className="chip" aria-label="Następny rok" onClick={() => set('year', st.year + 1)}>+</button>
              </div>
            ))}
            {section('Układ strony', (
              <div className="chips">
                <Chip on={st.orientation === 'portrait'} onClick={() => set('orientation', 'portrait')}>Pionowo</Chip>
                <Chip on={st.orientation === 'landscape'} onClick={() => set('orientation', 'landscape')}>Poziomo</Chip>
                <Chip on={st.paper === 'a4'} onClick={() => set('paper', 'a4')}>A4</Chip>
                <Chip on={st.paper === 'a3'} onClick={() => set('paper', 'a3')}>A3</Chip>
              </div>
            ))}
            {section('Styl', (
              <div className="chips">
                {([['classic', 'Klasyczny'], ['minimal', 'Minimalny'], ['dark', 'Ciemny']] as [CalStyle, string][]).map(([v, l]) => <Chip key={v} on={st.style === v} onClick={() => set('style', v)}>{l}</Chip>)}
              </div>
            ))}
            {section('Kolor akcentu', (
              <div className="swatches" role="group" aria-label="Kolor akcentu">
                {ACCENT_CHOICES.map((a) => (
                  <button key={a.name} className={`swatch${st.accent === a.css ? ' on' : ''}`} aria-pressed={st.accent === a.css} aria-label={`Akcent: ${a.name}`} title={a.css === 'auto' ? 'Auto: dopasowany do koloru zdjęcia' : a.name}
                    style={{ background: a.css === 'auto' ? 'conic-gradient(#c0392b, #d9780f, #b8860b, #2f8f4e, #17909b, #2f5fd7, #7e3fc4, #c0392b)' : a.css }} onClick={() => set('accent', a.css)} />
                ))}
              </div>
            ))}
            {section('Tydzień zaczyna się w', (
              <div className="chips">
                <Chip on={st.weekStart === 'mon'} onClick={() => set('weekStart', 'mon')}>Poniedziałek</Chip>
                <Chip on={st.weekStart === 'sun'} onClick={() => set('weekStart', 'sun')}>Niedzielę</Chip>
              </div>
            ))}
            {section('Zawartość', (
              <div className="chips">
                <Chip on={st.holidays} onClick={() => set('holidays', !st.holidays)}>Polskie święta</Chip>
                <Chip on={st.cover} onClick={() => { set('cover', !st.cover); setSel(0) }}>Okładka</Chip>
                <Chip on={st.fit === 'cover'} onClick={() => set('fit', st.fit === 'cover' ? 'contain' : 'cover')} label="Przycinaj zdjęcia do ramki">Wypełnij ramkę</Chip>
              </div>
            ))}
            {st.cover && section('Podpis na okładce', <input type="text" aria-label="Podpis na okładce" placeholder="np. Rodzina Kowalskich" maxLength={80} autoComplete="off" value={st.coverTitle} onChange={(e) => set('coverTitle', e.target.value)} />)}
            {section('Ważne daty (co roku)', (
              <>
                <textarea aria-label="Ważne daty" rows={4} placeholder={'24.05 Urodziny Mamy\n14.08 Rocznica ślubu'} value={st.eventsText} onChange={(e) => set('eventsText', e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Jedna data w linii: dzień.miesiąc i opis. Pojawią się pod kalendarzem miesiąca, a dzień dostanie kropkę.</div>
              </>
            ))}
          </aside>

          <main>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ boxShadow: 'var(--elev-2, 0 12px 40px rgba(0,0,0,.28))', borderRadius: 6, overflow: 'hidden', lineHeight: 0, maxWidth: '100%' }}>
                <PagePreview page={page} opt={opt} photo={photoOf(page)} dpi={100} hints className="cal-preview" />
              </div>
            </div>
            <div className="chips" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button className="primary" style={{ width: 'auto', padding: '0 18px' }} onClick={() => setPicker(true)}>{photoOf(page) ? 'Zmień zdjęcie' : 'Wybierz zdjęcie'}</button>
              {photoOf(page) && <button className="chip" onClick={() => { const n = { ...picks }; delete n[keyOf(page)]; setPicks(n) }}><Trash2 size={15} /> Usuń zdjęcie</button>}
              <span style={{ alignSelf: 'center', color: 'var(--muted)', fontSize: 13 }}>{page.kind === 'cover' ? 'Okładka' : `${MONTHS[page.month - 1]} ${st.year}`}</span>
            </div>
            <div className="cal-strip" role="listbox" aria-label="Strony kalendarza">
              {pages.map((p, i) => (
                <button key={keyOf(p)} className={`cal-mini${i === sel ? ' on' : ''}`} role="option" aria-selected={i === sel} onClick={() => setSel(i)} aria-label={p.kind === 'cover' ? 'Okładka' : MONTHS[p.month - 1]}>
                  <PagePreview page={p} opt={opt} photo={photoOf(p)} dpi={20} />
                  <span>{p.kind === 'cover' ? 'Okładka' : MONTHS_SHORT[p.month - 1]}</span>
                </button>
              ))}
            </div>
          </main>
        </div>
      </div>
      {picker && (
        <PhotoPicker photos={photos} month={page.kind === 'month' ? page.month : null} onClose={() => setPicker(false)}
          onPick={(p) => { setPicks({ ...picks, [keyOf(page)]: p.id }); setPicker(false); if (sel < pages.length - 1) setSel(sel + 1) }} />
      )}
    </div>
  )
}
