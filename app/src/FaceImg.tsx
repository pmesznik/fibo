import { useEffect, useState } from 'react'
import { faceBlob } from './api'

export function FaceImg({ id, size = 120 }: { id: number; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null, dead = false
    faceBlob(id).then((b) => { if (dead) return; url = URL.createObjectURL(b); setSrc(url) }).catch(() => {})
    return () => { dead = true; if (url) URL.revokeObjectURL(url) }
  }, [id])
  return src ? <img src={src} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null
}
