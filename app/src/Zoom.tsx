import { useEffect, useRef } from 'react'
import { ZoomIn, ZoomOut } from './FiboIcons'

/** Następna wielkość miniatur o krok w górę albo w dół, w granicach i zaokrąglona do kroku. */
export function stepZoom(v: number, dir: 1 | -1, min: number, max: number, step: number): number {
  const n = Math.round((v + dir * step) / step) * step
  return Math.min(max, Math.max(min, n))
}

/** Pomniejsz, suwak i powiększ: wielkość miniatur zdjęć albo twarzy. Ctrl + kółko myszy robi to samo (zob. `useCtrlWheelZoom`). */
export function ZoomControl({ value, min, max, step, onChange, what }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void; what: string
}) {
  return (
    <div role="group" aria-label={`Wielkość ${what}`} title={`Wielkość ${what} (także Ctrl + kółko myszy)`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>
      <button className="ico" aria-label={`Pomniejsz ${what}`} disabled={value <= min} onClick={() => onChange(stepZoom(value, -1, min, max, step))}><ZoomOut size={18} /></button>
      <input type="range" aria-label={`Wielkość ${what}`} min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: 110 }} />
      <button className="ico" aria-label={`Powiększ ${what}`} disabled={value >= max} onClick={() => onChange(stepZoom(value, 1, min, max, step))}><ZoomIn size={18} /></button>
    </div>
  )
}

/** Ctrl + kółko myszy nad przewijaną listą zmienia wielkość miniatur (zamiast powiększać całe okno). */
export function useCtrlWheelZoom(active: boolean, onStep: (dir: 1 | -1) => void) {
  const cb = useRef(onStep)
  cb.current = onStep
  useEffect(() => {
    if (!active) return
    const main = document.querySelector('main')
    if (!main) return
    let last = 0
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const now = Date.now()
      if (now - last < 90) return
      last = now
      cb.current(e.deltaY < 0 ? 1 : -1)
    }
    main.addEventListener('wheel', wheel, { passive: false })
    return () => main.removeEventListener('wheel', wheel)
  }, [active])
}
