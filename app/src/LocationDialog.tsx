import { useEffect, useRef, useState } from 'react'
import { useEscape } from './ui'
import { Map as MapLibre, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { X, MapPin, MapPinOff } from './FiboIcons'
import { setLocation } from './api'
import './MapView' // ustawia ścieżkę workera mapy

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

/** Ręczne ustawienie lokalizacji zdjęć: kliknij miejsce na mapie albo wpisz współrzędne. Zmienia tylko bibliotekę FIBO, nie pliki zdjęć. */
export function LocationDialog({ ids, initial, onClose, onSaved, say }: {
  ids: number[]
  initial: { lat: number; lon: number } | null
  onClose: () => void
  onSaved: () => void
  say: (m: string, kind?: 'ok' | 'err') => void
}) {
  useEscape(onClose)
  const box = useRef<HTMLDivElement>(null)
  const markerRef = useRef<Marker | null>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(initial)
  const [lat, setLat] = useState(initial ? String(initial.lat) : '')
  const [lon, setLon] = useState(initial ? String(initial.lon) : '')
  const [busy, setBusy] = useState(false)

  const place = (p: { lat: number; lon: number }, fly = false) => {
    const r = { lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 }
    setPos(r); setLat(String(r.lat)); setLon(String(r.lon))
    const map = mapRef.current
    if (!map) return
    if (!markerRef.current) markerRef.current = new Marker({ color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6d5bf0' }).setLngLat([r.lon, r.lat]).addTo(map)
    else markerRef.current.setLngLat([r.lon, r.lat])
    if (fly) map.easeTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 8) })
  }

  useEffect(() => {
    if (!box.current) return
    const map = new MapLibre({
      container: box.current, style: STYLE,
      center: initial ? [initial.lon, initial.lat] : [15, 35], zoom: initial ? 8 : 2, attributionControl: { compact: true },
    })
    mapRef.current = map
    map.on('click', (e) => place({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    map.on('load', () => { if (initial) place(initial) })
    return () => { markerRef.current?.remove(); markerRef.current = null; map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const typed = () => {
    const a = parseFloat(lat.replace(',', '.')), b = parseFloat(lon.replace(',', '.'))
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lon: b } : null
  }
  const save = async (clear: boolean) => {
    const p = clear ? null : typed()
    if (!clear && !p) return say('Podaj prawidłowe współrzędne (szerokość od -90 do 90, długość od -180 do 180)', 'err')
    setBusy(true)
    try {
      await setLocation(ids, p ? p.lat : null, p ? p.lon : null)
      say(clear ? 'Usunięto lokalizację' : 'Ustawiono lokalizację', 'ok')
      onSaved(); onClose()
    } catch (e) { say(`Błąd: ${e}`, 'err') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-[1700]" style={{ background: 'rgba(0,0,0,.45)' }} onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[1800] flex max-h-[92vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col" style={{ borderRadius: 'var(--r-lg)' }} role="dialog" aria-label="Ustaw lokalizację zdjęć">
        <div className="dr-head" style={{ paddingBottom: 0 }}>
          <span>Lokalizacja: {ids.length} {ids.length === 1 ? 'zdjęcie' : 'zdjęć'}</span>
          <button className="ico" aria-label="Zamknij" onClick={onClose}><X size={22} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px', overflowY: 'auto' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>Kliknij miejsce na mapie albo wpisz współrzędne. Zmiana dotyczy tylko biblioteki FIBO, plików zdjęć nie zmieniamy. Mapa wymaga internetu.</p>
          <div ref={box} aria-label="Mapa do wyboru miejsca" style={{ height: 300, borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--tonal)' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}><label htmlFor="loc-lat" style={{ marginTop: 0 }}>Szerokość</label>
              <input id="loc-lat" type="text" inputMode="decimal" value={lat} onChange={(e) => { setLat(e.target.value) }} onBlur={() => { const p = typed(); if (p) place(p, true) }} /></div>
            <div style={{ flex: 1 }}><label htmlFor="loc-lon" style={{ marginTop: 0 }}>Długość</label>
              <input id="loc-lon" type="text" inputMode="decimal" value={lon} onChange={(e) => { setLon(e.target.value) }} onBlur={() => { const p = typed(); if (p) place(p, true) }} /></div>
          </div>
          <button className="primary" style={{ marginTop: 12 }} disabled={busy || !pos} onClick={() => save(false)}>
            <span className="inline-flex items-center gap-2"><MapPin size={17} /> Ustaw tę lokalizację</span>
          </button>
          <button className="wide" disabled={busy} onClick={() => save(true)}><MapPinOff size={17} /> Usuń lokalizację zdjęć</button>
        </div>
      </div>
    </>
  )
}
