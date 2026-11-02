import { useEffect, useRef, useState } from 'react'
import { readImage, type Photo } from './api'
import { decodeBitmap } from './imageDecode'
import { movedEnough } from './saver'
import { enterFullscreen, leaveFullscreen } from './monitors'

const SLIDE_MS = 8000

/** Pełnoekranowy pokaz zdjęć bez przycisków. Kończy go ruch myszy, klawisz albo kliknięcie. Zdjęcia czyta lokalnie, nic nie wysyła. */
export function ScreenSaver({ photos, onClose }: { photos: Photo[]; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [fade, setFade] = useState(0)
  const started = useRef(Date.now())
  const last = useRef<{ x: number; y: number } | null>(null)
  // Rodzic podaje nową funkcję przy każdym odświeżeniu, a pokaz nie może przez to zaczynać od nowa.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    enterFullscreen()
    return () => { leaveFullscreen() }
  }, [])

  useEffect(() => {
    const end = () => closeRef.current()
    const move = (e: PointerEvent) => {
      if (!last.current) { last.current = { x: e.clientX, y: e.clientY }; return }
      if (movedEnough(e.clientX - last.current.x, e.clientY - last.current.y, Date.now() - started.current)) end()
    }
    const key = () => { if (Date.now() - started.current > 400) end() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', end)
    window.addEventListener('keydown', key)
    window.addEventListener('wheel', end)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', end); window.removeEventListener('keydown', key); window.removeEventListener('wheel', end) }
  }, [])

  useEffect(() => {
    if (!photos.length) { closeRef.current(); return }
    let dead = false
    let i = 0
    let timer = 0
    const draw = (b: ImageBitmap) => {
      const c = canvas.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      c.width = Math.round(window.innerWidth * dpr); c.height = Math.round(window.innerHeight * dpr)
      const g = c.getContext('2d')
      if (!g) return
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height)
      const s = Math.min(c.width / b.width, c.height / b.height)
      const w = b.width * s, h = b.height * s
      g.imageSmoothingQuality = 'high'
      g.drawImage(b, (c.width - w) / 2, (c.height - h) / 2, w, h)
    }
    const show = async () => {
      // Zdjęcia, których nie da się wczytać (skasowane, wideo), są pomijane; po 5 próbach z rzędu wygaszacz się kończy.
      for (let tries = 0; tries < 5 && !dead; tries++) {
        const p = photos[i % photos.length]; i++
        if (p.video || p.id < 0) continue
        try {
          const b = await decodeBitmap(await readImage(p.id), p.name)
          if (dead) return
          setFade(0)
          window.setTimeout(() => { if (dead) return; draw(b); setFade(1) }, 450)
          timer = window.setTimeout(show, SLIDE_MS)
          return
        } catch { /* następne zdjęcie */ }
      }
      if (!dead) closeRef.current()
    }
    show()
    return () => { dead = true; window.clearTimeout(timer) }
  }, [photos])

  return (
    <div role="presentation" aria-label="Wygaszacz ekranu: poruszaj myszą albo naciśnij klawisz, aby wrócić" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', cursor: 'none' }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block', opacity: fade, transition: 'opacity .45s ease' }} />
    </div>
  )
}
