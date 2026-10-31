/**
 * Przeciąganie myszą wewnątrz programu (zdjęcia na album i folder, zmiana kolejności, łączenie osób).
 * Zastępuje przeciąganie HTML5, które nie działa, gdy okno przyjmuje pliki upuszczane z Eksploratora (to wyklucza się w systemie Windows).
 * Cel upuszczenia oznacza się atrybutem `data-drop="klucz"`, a źródło wywołuje `beginPointerDrag` w `onPointerDown`.
 */

export type PointerDrag = {
  /** Podpis przy kursorze podczas przeciągania. */
  label: string
  /** Wywołane, gdy ruch przekroczy próg i przeciąganie naprawdę się zaczyna. */
  onStart: () => void
  /** Cel pod kursorem (jego klucz z `data-drop`) albo null, gdy kursor jest poza celami. */
  onHover: (key: string | null) => void
  /** Puszczenie przycisku nad celem. */
  onDrop: (key: string) => void
  /** Koniec przeciągania (po upuszczeniu, anulowaniu klawiszem Esc albo puszczeniu poza celem). */
  onEnd: () => void
}

/** Ruch mniejszy niż tyle pikseli to zwykłe kliknięcie, a nie przeciąganie. */
export const DRAG_THRESHOLD = 6

let blockClickUntil = 0

/** Tuż po przeciąganiu przeglądarka wysyła jeszcze „click” na źródle. Kafelek sprawdza to i nie reaguje na takie kliknięcie. */
export const dragJustEnded = () => Date.now() < blockClickUntil

/** Klucz celu upuszczenia w punkcie ekranu (z pominięciem podpisu przy kursorze). */
function targetAt(x: number, y: number, ghost: HTMLElement | null): string | null {
  if (ghost) ghost.style.display = 'none'
  const el = document.elementFromPoint(x, y)
  if (ghost) ghost.style.display = ''
  return el?.closest('[data-drop]')?.getAttribute('data-drop') ?? null
}

export function beginPointerDrag(e: { button: number; pointerType: string; clientX: number; clientY: number }, d: PointerDrag) {
  // Dotyk przewija listę, więc przeciąganie dotyczy myszy i rysika.
  if (e.button !== 0 || e.pointerType === 'touch') return
  const sx = e.clientX, sy = e.clientY
  let active = false
  let ghost: HTMLElement | null = null
  let hover: string | null = null

  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    ghost?.remove()
    document.body.classList.remove('fibo-dragging')
  }
  const finish = (drop: boolean) => {
    cleanup()
    if (!active) return
    blockClickUntil = Date.now() + 80
    if (drop && hover !== null) d.onDrop(hover)
    d.onEnd()
  }
  function move(ev: PointerEvent) {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return
      active = true
      d.onStart()
      ghost = document.createElement('div')
      ghost.textContent = d.label
      ghost.setAttribute('aria-hidden', 'true')
      ghost.style.cssText = 'position:fixed;z-index:3000;pointer-events:none;padding:6px 12px;border-radius:999px;background:var(--accent);color:#fff;font:600 13px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
      document.body.appendChild(ghost)
      document.body.classList.add('fibo-dragging')
    }
    if (ghost) { ghost.style.left = `${ev.clientX + 14}px`; ghost.style.top = `${ev.clientY + 14}px` }
    const k = targetAt(ev.clientX, ev.clientY, ghost)
    if (k !== hover) { hover = k; d.onHover(k) }
  }
  function up() { finish(true) }
  function cancel() { finish(false) }
  function key(ev: KeyboardEvent) { if (ev.key === 'Escape' && active) { ev.stopPropagation(); finish(false) } }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, true)
}
