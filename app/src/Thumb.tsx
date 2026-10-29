import { useEffect, useRef, useState } from 'react'
import { inTauri, putThumbnail, readImage, thumbnailBlob, type Photo } from './api'
import { makeThumbBlob } from './imageDecode'

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
    let url: string | null = null
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const show = (b: Blob) => { if (cancelled) return; url = URL.createObjectURL(b); setSrc(url) }
      thumbnailBlob(photo.id).then(show).catch(async () => {
        // Program nie ma dekodera dla AVIF i SVG: miniaturę robi okno aplikacji i zapisuje ją w pamięci podręcznej, żeby nie robić jej za każdym razem.
        if (!/\.(avif|svg)$/i.test(photo.name)) return
        try {
          const made = await makeThumbBlob(await readImage(photo.id), photo.name)
          show(made.blob)
          putThumbnail(photo.id, await made.blob.arrayBuffer(), made.width, made.height).catch(() => {})
        } catch { /* zostaje kolorowy zastępnik */ }
      })
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => { cancelled = true; io.disconnect(); if (url) URL.revokeObjectURL(url) }
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
