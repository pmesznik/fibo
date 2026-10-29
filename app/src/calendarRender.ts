/**
 * Rysowanie stron kalendarza na płótnie (canvas). Ten sam kod służy do podglądu, miniatur, zapisu PDF i druku, więc to, co widać
 * w programie, jest dokładnie tym, co trafia na papier.
 */
import { MONTHS, dayNames, dayNotes, isSaturdayCol, isSundayCol, monthGrid, polishHolidays, type CalEvent, type WeekStart } from './calendarData'

export type CalStyle = 'classic' | 'minimal' | 'dark'
export type Paper = 'a4' | 'a3'
export type Orient = 'portrait' | 'landscape'
export type PageRef = { kind: 'cover' } | { kind: 'month'; month: number }

export type CalOptions = {
  year: number
  weekStart: WeekStart
  orientation: Orient
  paper: Paper
  style: CalStyle
  holidays: boolean
  events: CalEvent[]
  /** `cover` przycina zdjęcie do ramki, `contain` pokazuje je w całości. */
  fit: 'cover' | 'contain'
  /** Kolor akcentu (CSS) albo 'auto': dobierany do dominującego koloru zdjęcia danej strony. */
  accent: string
  coverTitle: string
}

const SERIF = 'Georgia, "Times New Roman", serif'
const SANS = '"Segoe UI", system-ui, -apple-system, sans-serif'

/** Akcenty dobrane do kolorów dominujących zdjęć (numery jak w color.rs): ciemniejsze odcienie, żeby cyfry były czytelne na białym papierze. */
const BUCKET_ACCENT = ['#c0392b', '#d9780f', '#b8860b', '#2f8f4e', '#17909b', '#2f5fd7', '#7e3fc4', '#d1578f', '#8a5a2b', '#4a5568', '#4a5568', '#374151']

export const ACCENT_CHOICES: { name: string; css: string }[] = [
  { name: 'Auto', css: 'auto' }, { name: 'Czerwień', css: '#c0392b' }, { name: 'Pomarańcz', css: '#d9780f' }, { name: 'Zieleń', css: '#2f8f4e' },
  { name: 'Błękit', css: '#2f5fd7' }, { name: 'Fiolet', css: '#7e3fc4' }, { name: 'Grafit', css: '#374151' },
]

export const accentFor = (opt: CalOptions, colorBucket: number | null | undefined): string =>
  opt.accent !== 'auto' ? opt.accent : colorBucket != null ? BUCKET_ACCENT[colorBucket] ?? '#2f5fd7' : '#2f5fd7'

/** Rozmiar strony w pikselach przy zadanej gęstości (A4 to 210x297 mm, A3 to 297x420 mm). */
export function pagePx(paper: Paper, orientation: Orient, dpi: number): { w: number; h: number } {
  const [mw, mh] = paper === 'a4' ? [210, 297] : [297, 420]
  const [w, h] = orientation === 'portrait' ? [mw, mh] : [mh, mw]
  return { w: Math.round((w / 25.4) * dpi), h: Math.round((h / 25.4) * dpi) }
}

type Rect = { x: number; y: number; w: number; h: number }
type Theme = { bg: string; ink: string; muted: string; line: string }
const THEMES: Record<CalStyle, Theme> = {
  classic: { bg: '#ffffff', ink: '#1f2430', muted: '#8a90a0', line: '#e4e7ee' },
  minimal: { bg: '#faf8f4', ink: '#26272b', muted: '#9a9aa2', line: '#e6e2d9' },
  dark: { bg: '#15171c', ink: '#f1f2f5', muted: '#8b91a1', line: '#2c303a' },
}

function layout(w: number, h: number, opt: CalOptions, cover: boolean): { photo: Rect; text: Rect } {
  const m = w * (opt.orientation === 'portrait' ? 0.055 : 0.04)
  const full = opt.style === 'minimal'
  if (opt.orientation === 'portrait') {
    const ph = cover ? 0.76 : 0.46
    if (full) return { photo: { x: 0, y: 0, w, h: h * (ph + 0.06) }, text: { x: m, y: h * (ph + 0.06) + h * 0.035, w: w - 2 * m, h: h * (1 - ph - 0.06) - h * 0.035 - m } }
    return { photo: { x: m, y: m, w: w - 2 * m, h: h * ph }, text: { x: m, y: m + h * ph + h * 0.03, w: w - 2 * m, h: h - (m + h * ph + h * 0.03) - m } }
  }
  const pw = cover ? 0.62 : 0.56
  if (full) return { photo: { x: 0, y: 0, w: w * pw, h }, text: { x: w * pw + m, y: m, w: w * (1 - pw) - 2 * m, h: h - 2 * m } }
  return { photo: { x: m, y: m, w: w * pw - m, h: h - 2 * m }, text: { x: w * pw + m, y: m, w: w * (1 - pw) - 2 * m, h: h - 2 * m } }
}

function roundedPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath()
  if (radius > 0 && 'roundRect' in ctx) (ctx as CanvasRenderingContext2D).roundRect(r.x, r.y, r.w, r.h, radius)
  else ctx.rect(r.x, r.y, r.w, r.h)
}

function drawPhoto(ctx: CanvasRenderingContext2D, bmp: ImageBitmap, r: Rect, radius: number, fit: 'cover' | 'contain', theme: Theme, accent: string) {
  ctx.save()
  roundedPath(ctx, r, radius)
  ctx.clip()
  if (fit === 'cover') {
    const k = Math.max(r.w / bmp.width, r.h / bmp.height)
    const dw = bmp.width * k, dh = bmp.height * k
    // Pionowe kadrowanie z lekkim przesunięciem ku górze, bo na zdjęciach twarze są zwykle w górnej połowie.
    ctx.drawImage(bmp, r.x - (dw - r.w) / 2, r.y - (dh - r.h) * 0.35, dw, dh)
  } else {
    ctx.fillStyle = theme.bg === '#15171c' ? '#0f1115' : `${accent}14`
    ctx.fillRect(r.x, r.y, r.w, r.h)
    const k = Math.min(r.w / bmp.width, r.h / bmp.height)
    const dw = bmp.width * k, dh = bmp.height * k
    ctx.drawImage(bmp, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh)
  }
  ctx.restore()
}

function placeholder(ctx: CanvasRenderingContext2D, r: Rect, radius: number, accent: string, text: string) {
  ctx.save()
  roundedPath(ctx, r, radius)
  ctx.fillStyle = `${accent}1c`
  ctx.fill()
  ctx.setLineDash([r.w * 0.012, r.w * 0.012])
  ctx.lineWidth = Math.max(2, r.w * 0.003)
  ctx.strokeStyle = `${accent}77`
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = accent
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.max(14, r.w * 0.035)}px ${SANS}`
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2)
  ctx.restore()
}

/** Zawija tekst do szerokości `maxW` i zwraca linie. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w } else cur = t
  }
  if (cur) lines.push(cur)
  return lines
}

function drawMonth(ctx: CanvasRenderingContext2D, r: Rect, month: number, opt: CalOptions, theme: Theme, accent: string) {
  const cellW = r.w / 7
  const holidays = opt.holidays ? polishHolidays(opt.year).filter((h) => h.month === month) : []
  const events = opt.events.filter((e) => e.month === month)
  const notes = dayNotes(month, holidays, events)
  const grid = monthGrid(opt.year, month, opt.weekStart)

  // Tytuł: nazwa miesiąca z lewej, rok z prawej, pod spodem cienka linia w kolorze akcentu.
  const titleSize = Math.min(cellW * 0.78, r.h * 0.11)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = theme.ink
  ctx.textAlign = 'left'
  ctx.font = `${opt.style === 'minimal' ? '300' : '400'} ${titleSize}px ${SERIF}`
  ctx.fillText(opt.style === 'minimal' ? MONTHS[month - 1].toUpperCase() : MONTHS[month - 1], r.x, r.y + titleSize)
  ctx.textAlign = 'right'
  ctx.fillStyle = accent
  ctx.font = `300 ${titleSize}px ${SERIF}`
  ctx.fillText(String(opt.year), r.x + r.w, r.y + titleSize)
  const lineY = r.y + titleSize * 1.28
  ctx.fillStyle = accent
  ctx.fillRect(r.x, lineY, r.w, Math.max(2, cellW * 0.018))

  // Notatki pod siatką (święta i ważne daty): najpierw liczymy ich wysokość, żeby siatka zajęła resztę.
  const noteSize = Math.max(11, cellW * 0.15)
  ctx.font = `500 ${noteSize}px ${SANS}`
  const items: { text: string; color: string }[] = []
  ;[...notes.entries()].sort((a, b) => a[0] - b[0]).forEach(([d, n]) => {
    n.holiday.forEach((t) => items.push({ text: `${d} ${t}`, color: accent }))
    n.event.forEach((t) => items.push({ text: `${d} ${t}`, color: theme.ink }))
  })
  const noteLines: { text: string; color: string }[] = []
  let line = ''
  let lineColor = theme.ink
  for (const it of items) {
    const t = line ? `${line}   ·   ${it.text}` : it.text
    if (ctx.measureText(t).width > r.w && line) { noteLines.push({ text: line, color: lineColor }); line = it.text; lineColor = it.color } else { line = t; lineColor = line === it.text ? it.color : lineColor }
  }
  if (line) noteLines.push({ text: line, color: lineColor })
  const shownNotes = noteLines.slice(0, 5)
  const notesH = shownNotes.length ? shownNotes.length * noteSize * 1.55 + noteSize * 0.8 : 0

  const dowSize = cellW * 0.19
  const dowY = lineY + cellW * 0.42
  const gridTop = dowY + cellW * 0.22
  const rowH = Math.min(cellW * 1.0, (r.y + r.h - notesH - gridTop) / 6)

  // Nagłówki dni tygodnia.
  ctx.textAlign = 'center'
  ctx.font = `600 ${dowSize}px ${SANS}`
  dayNames(opt.weekStart).forEach((n, c) => {
    ctx.fillStyle = isSundayCol(c, opt.weekStart) ? accent : theme.muted
    ctx.fillText(n.toUpperCase(), r.x + c * cellW + cellW / 2, dowY)
  })
  // Delikatne linie poziome między tygodniami.
  ctx.fillStyle = theme.line
  for (let row = 0; row <= grid.length; row++) ctx.fillRect(r.x, gridTop + row * rowH, r.w, Math.max(1, cellW * 0.006))

  const numSize = Math.min(cellW * 0.4, rowH * 0.42)
  grid.forEach((week, row) => {
    week.forEach((day, c) => {
      if (day === null) return
      const n = notes.get(day)
      const red = isSundayCol(c, opt.weekStart) || !!n?.holiday.length
      const cx = r.x + c * cellW + cellW / 2
      const cy = gridTop + row * rowH + rowH * 0.5
      ctx.fillStyle = red ? accent : isSaturdayCol(c, opt.weekStart) ? theme.ink : theme.ink
      ctx.font = `${red ? '700' : '400'} ${numSize}px ${SANS}`
      ctx.textBaseline = 'middle'
      ctx.fillText(String(day), cx, n?.event.length ? cy - rowH * 0.06 : cy)
      if (n?.event.length) {
        // Ważna data: kropka pod numerem.
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(cx, cy + numSize * 0.78, Math.max(2, cellW * 0.04), 0, Math.PI * 2)
        ctx.fill()
      }
    })
  })

  // Notatki.
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `500 ${noteSize}px ${SANS}`
  shownNotes.forEach((l, i) => {
    ctx.fillStyle = l.color
    ctx.fillText(l.text, r.x, r.y + r.h - notesH + noteSize * 1.4 + i * noteSize * 1.55)
  })
}

function drawCover(ctx: CanvasRenderingContext2D, r: Rect, opt: CalOptions, theme: Theme, accent: string, w: number) {
  const portrait = opt.orientation === 'portrait'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = portrait ? 'left' : 'left'
  const small = r.w * (portrait ? 0.035 : 0.07)
  ctx.fillStyle = accent
  ctx.font = `600 ${small}px ${SANS}`
  const label = 'KALENDARZ'
  const gap = small * 0.35
  let x = r.x
  const y0 = portrait ? r.y + small * 1.2 : r.y + r.h * 0.34
  for (const ch of label) { ctx.fillText(ch, x, y0); x += ctx.measureText(ch).width + gap }
  let big = Math.min(r.w * (portrait ? 0.3 : 0.5), w * 0.2)
  ctx.fillStyle = theme.ink
  ctx.font = `300 ${big}px ${SERIF}`
  // Rok ma się zmieścić w szerokości kolumny także na wąskiej, poziomej stronie.
  const fitW = ctx.measureText(String(opt.year)).width
  if (fitW > r.w) { big *= (r.w / fitW) * 0.98; ctx.font = `300 ${big}px ${SERIF}` }
  ctx.fillText(String(opt.year), r.x, y0 + big * 1.05)
  if (opt.coverTitle.trim()) {
    ctx.fillStyle = theme.muted
    ctx.font = `400 ${small * 1.25}px ${SERIF}`
    const lines = wrap(ctx, opt.coverTitle.trim(), r.w)
    lines.slice(0, 3).forEach((t, i) => ctx.fillText(t, r.x, y0 + big * 1.05 + small * 2.2 + i * small * 1.7))
  }
}

/**
 * Rysuje jedną stronę kalendarza (okładkę albo miesiąc) na płótnie o rozmiarze `w` x `h`.
 * `showHints` dodaje do pustej ramki napis „Dodaj zdjęcie” (tylko w podglądzie, nigdy w pliku i na wydruku).
 */
export function drawCalendarPage(ctx: CanvasRenderingContext2D, w: number, h: number, page: PageRef, opt: CalOptions, photo: ImageBitmap | null, colorBucket: number | null | undefined, showHints = false) {
  const theme = THEMES[opt.style]
  const accent = accentFor(opt, colorBucket)
  ctx.save()
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, w, h)
  const cover = page.kind === 'cover'
  const { photo: pr, text } = layout(w, h, opt, cover)
  const radius = opt.style === 'minimal' ? 0 : w * 0.01
  if (photo) drawPhoto(ctx, photo, pr, radius, opt.fit, theme, accent)
  else if (showHints) placeholder(ctx, pr, radius, accent, 'Dodaj zdjęcie')
  else { ctx.fillStyle = `${accent}22`; roundedPath(ctx, pr, radius); ctx.fill() }
  if (page.kind === 'cover') drawCover(ctx, text, opt, theme, accent, w)
  else drawMonth(ctx, text, page.month, opt, theme, accent)
  ctx.restore()
}
