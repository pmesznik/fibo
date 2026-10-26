import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapLibre, setWorkerUrl, type CanvasSource, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPinOff, Pause, Play, RefreshCw, Sun, X } from './FiboIcons'
import type { Photo } from './api'
import { Thumb } from './Thumb'
import { MERCATOR_LAT, drawNight } from './daynight'

// Vite przepakowuje bibliotekę i gubi ścieżkę do workera, więc podajemy ją wprost.
setWorkerUrl(workerUrl)

// Mapa jest zawsze "dzienna"; noc rysujemy na niej osobną warstwą, zgodnie z aktualnym położeniem Słońca.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

type Place = { key: string; lat: number; lon: number; photos: Photo[] }
type Mode = 'live' | 'manual' | 'anim'

const pinSvg = (color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="60" viewBox="0 0 48 60"><path d="M24 2C12.4 2 3 11.2 3 22.6 3 38 24 58 24 58s21-20 21-35.4C45 11.2 35.6 2 24 2z" fill="${color}" stroke="#fff" stroke-width="3"/><circle cx="24" cy="23" r="8" fill="#fff"/></svg>`,
  )}`

const MINUTES_PER_SECOND = 60 // animacja doby: godzina na sekundę, doba w 24 sekundy
const RANGE = 720             // suwak: od -12 do +12 godzin względem teraz

const offsetLabel = (min: number) => {
  const m = Math.round(Math.abs(min))
  if (m < 1) return 'teraz'
  const h = Math.floor(m / 60), r = m % 60
  return `${min < 0 ? '−' : '+'}${h ? `${h} h ` : ''}${r ? `${r} min` : ''}`.trim() + ' od teraz'
}

/** Globus ze zdjęciami: pinezka stoi tam, gdzie zrobiono zdjęcie, a kliknięcie pokazuje zdjęcia z tego miejsca. Pokazuje też, gdzie jest dzień, a gdzie noc. */
export function MapView({ photos, total, refreshing, onRefresh, onOpen }: {
  photos: Photo[]            // zdjęcia z widoku (po filtrach)
  total: number              // wszystkie zdjęcia w bibliotece
  refreshing: boolean
  onRefresh: () => void
  onOpen: (id: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibre | null>(null)
  const readyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Place | null>(null)

  // Dzień i noc: tryb (na żywo, ręczny, animacja doby) i przesunięcie w minutach względem teraz.
  const nightCanvas = useRef<HTMLCanvasElement | null>(null)
  const modeRef = useRef<Mode>('live')
  const offsetRef = useRef(0)
  const [mode, setModeState] = useState<Mode>('live')
  const [offset, setOffset] = useState(0)
  const [clock, setClock] = useState(() => new Date())
  const setMode = (m: Mode) => { modeRef.current = m; setModeState(m) }
  const simDate = () => new Date(Date.now() + offsetRef.current * 60000)

  /** Odrysowuje noc dla danej chwili i każe mapie odświeżyć warstwę. */
  const paint = (date: Date, keepPlaying = false) => {
    const c = nightCanvas.current
    if (!c) return
    drawNight(c, date)
    const src = mapRef.current?.getSource('night') as CanvasSource | undefined
    if (!src) return
    src.play()
    if (!keepPlaying) window.setTimeout(() => { if (modeRef.current !== 'anim') src.pause() }, 160)
  }

  // Zdjęcia z tego samego miejsca (do ~10 m) tworzą jedną pinezkę.
  const places = useMemo(() => {
    const m = new Map<string, Place>()
    for (const p of photos) {
      if (p.lat == null || p.lon == null) continue
      const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`
      const cur = m.get(key)
      if (cur) cur.photos.push(p); else m.set(key, { key, lat: p.lat, lon: p.lon, photos: [p] })
    }
    return [...m.values()]
  }, [photos])
  const placesRef = useRef(places)
  placesRef.current = places
  const geoPhotos = useMemo(() => places.reduce((n, p) => n + p.photos.length, 0), [places])

  const toGeoJson = (list: Place[]): FeatureCollection => ({
    type: 'FeatureCollection',
    features: list.map((pl) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pl.lon, pl.lat] },
      properties: { key: pl.key, n: pl.photos.length },
    })),
  })

  // Utworzenie mapy (raz).
  useEffect(() => {
    if (!box.current) return
    const accentNow = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6d5bf0'
    const first = placesRef.current
    const center: [number, number] = first.length
      ? [first.reduce((a, p) => a + p.lon, 0) / first.length, first.reduce((a, p) => a + p.lat, 0) / first.length]
      : [15, 35]

    nightCanvas.current = document.createElement('canvas')
    const map = new MapLibre({
      container: box.current,
      style: STYLE,
      center, zoom: first.length ? 1.9 : 1.4,
      attributionControl: { compact: true },
      maxPitch: 60,
    })
    mapRef.current = map

    map.on('error', (e) => {
      // Błąd przed załadowaniem stylu oznacza zwykle brak internetu (kafelki są pobierane z sieci).
      if (!readyRef.current) setError(String(e.error?.message ?? 'Nie można wczytać mapy'))
    })

    let handlersAdded = false
    const install = async () => {
      if (map.getSource('photos')) return
      readyRef.current = true
      setError(null)
      map.setProjection({ type: 'globe' })

      // Warstwa nocy leży pod napisami mapy, więc nazwy miejsc zostają czytelne także po ciemnej stronie.
      if (nightCanvas.current && !map.getSource('night')) {
        map.addSource('night', {
          type: 'canvas', canvas: nightCanvas.current, animate: false,
          coordinates: [[-180, MERCATOR_LAT], [180, MERCATOR_LAT], [180, -MERCATOR_LAT], [-180, -MERCATOR_LAT]],
        })
        const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
        map.addLayer({ id: 'night', type: 'raster', source: 'night', paint: { 'raster-fade-duration': 0 } }, firstSymbol)
        paint(simDate())
      }

      const accent = accentNow()
      const img = new Image(48, 60)
      img.src = pinSvg(accent)
      await img.decode()
      if (map.getSource('photos')) return
      if (map.hasImage('pin')) map.removeImage('pin')
      map.addImage('pin', img, { pixelRatio: 2 })

      map.addSource('photos', {
        type: 'geojson', data: toGeoJson(placesRef.current),
        cluster: true, clusterRadius: 48, clusterMaxZoom: 13,
        clusterProperties: { sum: ['+', ['get', 'n']] },
      })
      const font = ['Noto Sans Regular']
      map.addLayer({
        id: 'clusters', type: 'circle', source: 'photos', filter: ['has', 'point_count'],
        paint: {
          'circle-color': accent, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3,
          'circle-radius': ['step', ['get', 'sum'], 18, 10, 22, 50, 27, 200, 33],
        },
      })
      map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'photos', filter: ['has', 'point_count'],
        layout: { 'text-field': ['to-string', ['get', 'sum']], 'text-font': font, 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': '#fff' },
      })
      map.addLayer({
        id: 'pins', type: 'symbol', source: 'photos', filter: ['!', ['has', 'point_count']],
        layout: { 'icon-image': 'pin', 'icon-anchor': 'bottom', 'icon-allow-overlap': true },
      })
      map.addLayer({
        id: 'pin-count', type: 'symbol', source: 'photos', filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'n'], 1]],
        layout: { 'text-field': ['to-string', ['get', 'n']], 'text-font': font, 'text-size': 11, 'text-offset': [0, -1.5], 'text-allow-overlap': true },
        paint: { 'text-color': accent },
      })

      if (handlersAdded) return
      handlersAdded = true
      map.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
        if (!f) return
        const src = map.getSource('photos') as GeoJSONSource
        const zoom = await src.getClusterExpansionZoom(f.properties!.cluster_id)
        map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: zoom + 0.5 })
      })
      map.on('click', 'pins', (e: MapLayerMouseEvent) => {
        const key = e.features?.[0]?.properties?.key
        const place = placesRef.current.find((p) => p.key === key)
        if (place) setPicked(place)
      })
      for (const layer of ['clusters', 'pins']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }
    }
    map.on('style.load', () => { install() })

    return () => {
      readyRef.current = false
      map.remove()
      mapRef.current = null
      nightCanvas.current = null
    }
  }, [])

  // Na żywo: noc odświeża się co 20 sekund, więc granica dnia i nocy płynnie wędruje razem z zegarem.
  useEffect(() => {
    if (mode !== 'live') return
    offsetRef.current = 0
    setOffset(0)
    const tick = () => { const d = new Date(); setClock(d); paint(d) }
    tick()
    const every = window.setInterval(tick, 20000)
    return () => window.clearInterval(every)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Animacja doby: czas biegnie godzinę na sekundę w pętli od -12 h do +12 h względem teraz.
  useEffect(() => {
    if (mode !== 'anim') return
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    let lastUi = 0
    const step = (now: number) => {
      offsetRef.current += (now - last) * (MINUTES_PER_SECOND / 1000)
      last = now
      if (offsetRef.current > RANGE) offsetRef.current -= 2 * RANGE
      if (now - lastDraw > 33) {
        lastDraw = now
        const d = simDate()
        paint(d, true)
        if (now - lastUi > 100) { lastUi = now; setOffset(offsetRef.current); setClock(d) }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      ;(mapRef.current?.getSource('night') as CanvasSource | undefined)?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const onSlide = (v: number) => {
    setMode('manual')
    offsetRef.current = v
    setOffset(v)
    const d = simDate()
    setClock(d)
    paint(d)
  }

  // Odświeżenie pinezek po zmianie zdjęć lub filtrów.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    ;(map.getSource('photos') as GeoJSONSource | undefined)?.setData(toGeoJson(places))
    setPicked((cur) => (cur ? places.find((p) => p.key === cur.key) ?? null : null))
  }, [places])

  // Esc zamyka panel zdjęć.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicked(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const missing = total - geoPhotos
  const clockText = clock.toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1 }}>
      <div ref={box} aria-label="Globus ze zdjęciami, z podziałem na dzień i noc" style={{ position: 'absolute', inset: 0 }} />

      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><div className="glass" style={{ width: 'min(92vw,380px)', borderRadius: 'var(--r-lg)', padding: 24, textAlign: 'center', color: 'var(--muted)', pointerEvents: 'auto' }}>
          <div>
            <p style={{ margin: '0 0 6px', fontWeight: 650, color: 'var(--text)', fontSize: 16 }}>Nie można wczytać mapy</p>
            <p style={{ margin: 0, fontSize: 13.5 }}>Mapa pobiera kafelki z internetu. Sprawdź połączenie i wróć do tej zakładki.</p>
          </div></div>
        </div>
      )}

      {!error && geoPhotos === 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(110px + var(--sab))', display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><div className="glass" style={{ width: 'min(92vw,400px)', borderRadius: 'var(--r-lg)', padding: 20, textAlign: 'center', color: 'var(--muted)', pointerEvents: 'auto' }}>
          <div>
            <MapPinOff size={28} strokeWidth={1.5} style={{ margin: '0 auto 8px' }} />
            <p style={{ margin: '0 0 12px', fontSize: 14 }}>
              {total === 0 ? 'Brak zdjęć. Dodaj folder przyciskiem + w prawym górnym rogu.'
                : 'Żadne zdjęcie nie ma zapisanej lokalizacji GPS. Jeśli dodałeś je przed obsługą mapy, wczytaj lokalizacje ponownie.'}
            </p>
            {total > 0 && (
              <button className="primary" disabled={refreshing} onClick={onRefresh}>
                <span className="inline-flex items-center gap-2"><RefreshCw size={16} /> {refreshing ? 'Wczytywanie…' : 'Wczytaj lokalizacje ze zdjęć'}</span>
              </button>
            )}
          </div></div>
        </div>
      )}

      {geoPhotos > 0 && (
        <div className="glass" style={{ position: 'absolute', left: 12, bottom: 'calc(12px + var(--sab))', padding: '8px 14px', borderRadius: 'var(--r-lg)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span><b>{geoPhotos}</b> na mapie{missing > 0 ? `, ${missing} bez lokalizacji` : ''}</span>
          {missing > 0 && (
            <button className="bare" disabled={refreshing} onClick={onRefresh} aria-label="Wczytaj lokalizacje ponownie" title="Wczytaj lokalizacje ponownie"
              style={{ color: 'var(--accent)', display: 'inline-flex' }}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /></button>
          )}
        </div>
      )}

      {/* Dzień i noc: czas na mapie, suwak godziny, powrót do teraz i animacja doby. */}
      <div className="glass" role="group" aria-label="Dzień i noc na mapie"
        style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(12px + var(--sab))', width: 'min(94vw, 560px)', padding: '8px 12px', borderRadius: 'var(--r-lg)', display: 'flex', alignItems: 'center', gap: 8, zIndex: 5 }}>
        <span aria-hidden style={{ color: 'var(--accent)', display: 'inline-flex' }}><Sun size={20} /></span>
        <div style={{ minWidth: 0, flex: '0 0 auto', lineHeight: 1.2 }}>
          <div style={{ fontWeight: 650, fontSize: 13.5 }} aria-live="off">{clockText}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{mode === 'live' ? 'teraz, czas lokalny' : offsetLabel(offset)}</div>
        </div>
        <input type="range" min={-RANGE} max={RANGE} step={5} value={Math.round(offset)} aria-label="Godzina na mapie względem teraz"
          onChange={(e) => onSlide(+e.target.value)} style={{ flex: 1, minWidth: 80 }} />
        <button className="ico" aria-label={mode === 'anim' ? 'Zatrzymaj animację doby' : 'Animacja doby'} title={mode === 'anim' ? 'Zatrzymaj animację' : 'Animacja doby: godzina na sekundę'}
          aria-pressed={mode === 'anim'} onClick={() => setMode(mode === 'anim' ? 'manual' : 'anim')} style={{ color: mode === 'anim' ? 'var(--accent)' : undefined }}>
          {mode === 'anim' ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="chip" disabled={mode === 'live'} onClick={() => setMode('live')} aria-label="Pokaż aktualny dzień i noc">Teraz</button>
      </div>

      {picked && (
        <aside className="sheet glass" aria-label="Zdjęcia z tego miejsca" style={{ zIndex: 1200 }}>
          <div className="dr-head" style={{ paddingBottom: 0 }}>
            <span style={{ fontSize: 18 }}>{picked.photos.length} {picked.photos.length === 1 ? 'zdjęcie' : picked.photos.length < 5 ? 'zdjęcia' : 'zdjęć'}</span>
            <button className="ico" aria-label="Zamknij panel" onClick={() => setPicked(null)}><X size={22} /></button>
          </div>
          <div style={{ padding: '2px 16px 8px', color: 'var(--muted)', fontSize: 12.5 }}>{picked.lat.toFixed(4)}°, {picked.lon.toFixed(4)}°</div>
          <div className="sheet-body" style={{ padding: '4px 12px 12px' }}>
            <div className="grid grid-cols-2 gap-2">
              {picked.photos.map((p) => (
                <button key={p.id} className="bare relative aspect-square overflow-hidden" aria-label={`Otwórz ${p.name}`}
                  onClick={() => onOpen(p.id)} style={{ borderRadius: 'var(--r-md)', boxShadow: 'var(--elev-1)' }}>
                  <Thumb photo={p} />
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
