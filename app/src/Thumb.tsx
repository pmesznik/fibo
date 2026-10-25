import { useEffect, useRef, useState } from 'react'
import { inTauri, thumbnailUrl, type Photo } from './api'

/** Miniatura ładowana dopiero, gdy kafel pojawi się na ekranie. */
export function Thumb({ photo, fit = 'cover' }: { photo: Photo; fit?: 'cover' | 'contain' }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    setSrc(null)
    if (!inTauri || photo.id < 0) return
    const el = ref.current
    if (!el) return
    let cancelled = false
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      thumbnailUrl(photo.id).then((u) => !cancelled && setSrc(u)).catch(() => {})
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => { cancelled = true; io.disconnect() }
  }, [photo.id, photo.modified])

  const hue = Math.abs(photo.id * 37) % 360
  return (
    <div
      ref={ref}
      className="absolute inset-0"
      style={src ? undefined : { background: `linear-gradient(135deg, hsl(${hue} 60% 38%), hsl(${(hue + 50) % 360} 65% 22%))` }}
    >
      {src && <img src={src} alt={photo.name} className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} draggable={false} />}
    </div>
  )
}
