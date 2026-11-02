/**
 * Zaznaczanie prostokątem: wciśnij przycisk myszy na wolnym miejscu listy (albo na zdjęciu w trybie „Zaznaczanie wielu”) i przeciągnij.
 * Zaznaczają się zdjęcia, których kafelki przecina prostokąt. Przy górnej i dolnej krawędzi lista sama się przewija, więc można zaznaczyć
 * więcej, niż mieści się na ekranie. Ctrl dodaje do dotychczasowego zaznaczenia. Esc przerywa i przywraca poprzednie zaznaczenie.
 */
import { DRAG_THRESHOLD, blockNextClick, edgeScrollSpeed } from './pointerDrag'

/** Kafelek w układzie treści listy (współrzędne niezależne od przewinięcia). */
export type Box = { id: number; x0: number; y0: number; x1: number; y1: number }

/** Numery kafelków, które przecina prostokąt rozpięty między punktami `a` i `b` (w tym samym układzie co kafelki). */
export function hits(boxes: Box[], a: { x: number; y: number }, b: { x: number; y: number }): number[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
  const out: number[] = []
  for (const k of boxes) if (k.x1 > x0 && k.x0 < x1 && k.y1 > y0 && k.y0 < y1) out.push(k.id)
  return out
}

/** Zaznaczenie wynikowe: z Ctrl dotychczasowe plus objęte prostokątem (bez powtórzeń), bez Ctrl tylko objęte. */
export function combine(base: number[], hit: number[], add: boolean): number[] {
  return add ? [...new Set([...base, ...hit])] : hit
}

export function beginMarquee(
  e: { button: number; pointerType: string; clientX: number; clientY: number },
  o: { scroller: HTMLElement; onChange: (ids: number[]) => void; onCancel: () => void; onEnd?: () => void },
) {
  if (e.button !== 0 || e.pointerType === 'touch') return
  const sc = o.scroller
  const toContent = (cx: number, cy: number) => { const r = sc.getBoundingClientRect(); return { x: cx - r.left + sc.scrollLeft, y: cy - r.top + sc.scrollTop } }
  const start = toContent(e.clientX, e.clientY)
  const sx = e.clientX, sy = e.clientY
  let cx = e.clientX, cy = e.clientY
  let active = false
  let boxes: Box[] = []
  let box: HTMLDivElement | null = null
  let raf = 0
  let lastKey = ''

  const measure = () => {
    const r = sc.getBoundingClientRect()
    boxes = [...sc.querySelectorAll<HTMLElement>('[data-pid]')].map((el) => {
      const b = el.getBoundingClientRect()
      const top = b.top - r.top + sc.scrollTop, left = b.left - r.left + sc.scrollLeft
      return { id: Number(el.dataset.pid), x0: left, y0: top, x1: left + b.width, y1: top + b.height }
    })
  }
  const draw = () => {
    const r = sc.getBoundingClientRect()
    const cur = toContent(cx, cy)
    const left = Math.min(start.x, cur.x) - sc.scrollLeft + r.left, top = Math.min(start.y, cur.y) - sc.scrollTop + r.top
    if (box) Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${Math.abs(cur.x - start.x)}px`, height: `${Math.abs(cur.y - start.y)}px` })
    const ids = hits(boxes, start, cur)
    const key = ids.join(',')
    if (key !== lastKey) { lastKey = key; o.onChange(ids) }
  }
  const tick = () => {
    raf = 0
    if (!active) return
    const r = sc.getBoundingClientRect()
    const v = edgeScrollSpeed(cy, r.top + 80, r.bottom)
    if (v !== 0) sc.scrollTop += v
    draw()
    if (v !== 0) raf = requestAnimationFrame(tick)
  }
  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    box?.remove()
    document.body.classList.remove('fibo-dragging')
  }
  function move(ev: PointerEvent) {
    cx = ev.clientX; cy = ev.clientY
    if (!active) {
      if (Math.hypot(cx - sx, cy - sy) < DRAG_THRESHOLD) return
      active = true
      measure()
      box = document.createElement('div')
      box.setAttribute('aria-hidden', 'true')
      box.style.cssText = 'position:fixed;z-index:3000;pointer-events:none;border:1.5px solid var(--accent);background:color-mix(in srgb, var(--accent) 18%, transparent);border-radius:4px'
      document.body.appendChild(box)
      document.body.classList.add('fibo-dragging')
    }
    ev.preventDefault()
    if (!raf) raf = requestAnimationFrame(tick)
  }
  function up() { cleanup(); if (active) { blockNextClick(); o.onEnd?.() } }
  function cancel() { cleanup(); if (active) o.onCancel() }
  function key(ev: KeyboardEvent) { if (ev.key === 'Escape' && active) { ev.stopPropagation(); cleanup(); o.onCancel() } }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, true)
}
