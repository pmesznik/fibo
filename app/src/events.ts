/**
 * Wydarzenia i podróże: zdjęcia zrobione blisko siebie w czasie, pogrupowane w gotowe propozycje albumów. Czysta logika bez Tauri,
 * żeby dało się ją testować w Node. Nic nie jest zapisywane, dopóki użytkownik sam nie utworzy albumu.
 */
import type { Photo } from './api'
import { takenSeconds } from './stacks'

export type PhotoEvent = {
  /** Stabilny identyfikator: czas pierwszego zdjęcia. */
  id: string
  /** Numery zdjęć w kolejności czasu. */
  ids: number[]
  /** Pierwszy i ostatni dzień (RRRR-MM-DD). */
  first: string
  last: string
  /** Liczba różnych dni kalendarzowych ze zdjęciami. */
  days: number
  kind: 'event' | 'trip'
  /** Środek położenia zdjęć z GPS, gdy ma je co najmniej połowa zdjęć. */
  place: { lat: number; lon: number } | null
  /** Album, do którego już należy prawie całe wydarzenie (najmniej 80 procent zdjęć), albo null. */
  album: number | null
}

/** Przerwa (w godzinach) między kolejnymi zdjęciami, która kończy wydarzenie. */
export const GAP_HOURS = 20
/** Najmniej zdjęć w wydarzeniu: mniejsze grupy to zwykłe pojedyncze ujęcia. */
export const MIN_PHOTOS = 10
/** Wydarzenie dłuższe niż tyle dni jest dzielone na krótsze (przy częstszych przerwach), żeby codzienne fotografowanie nie dało jednego wydarzenia na lata. */
export const MAX_SPAN_DAYS = 21
const SPLIT_GAP_HOURS = 8

const dayOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10)

type Item = { p: Photo; t: number }

function toEvent(items: Item[]): PhotoEvent {
  const days = new Set(items.map((i) => dayOf(i.t)))
  const withGps = items.filter((i) => i.p.lat != null && i.p.lon != null)
  const place = withGps.length * 2 >= items.length && withGps.length > 0
    ? { lat: withGps.reduce((s, i) => s + (i.p.lat as number), 0) / withGps.length, lon: withGps.reduce((s, i) => s + (i.p.lon as number), 0) / withGps.length }
    : null
  const counts = new Map<number, number>()
  for (const i of items) for (const a of i.p.albums) counts.set(a, (counts.get(a) ?? 0) + 1)
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const album = best && best[1] >= items.length * 0.8 ? best[0] : null
  return {
    id: String(items[0].t), ids: items.map((i) => i.p.id), first: dayOf(items[0].t), last: dayOf(items[items.length - 1].t),
    days: days.size, kind: days.size >= 2 ? 'trip' : 'event', place, album,
  }
}

/** Dzieli zbyt długi ciąg zdjęć na części tam, gdzie przerwa przekracza `SPLIT_GAP_HOURS`. */
function splitLong(items: Item[]): Item[][] {
  const span = (items[items.length - 1].t - items[0].t) / 86400
  if (span <= MAX_SPAN_DAYS) return [items]
  const out: Item[][] = []
  let cur: Item[] = []
  for (const it of items) {
    const last = cur[cur.length - 1]
    if (last && it.t - last.t > SPLIT_GAP_HOURS * 3600) { out.push(cur); cur = [] }
    cur.push(it)
  }
  if (cur.length) out.push(cur)
  return out
}

/** Propozycje wydarzeń z całej biblioteki, od najnowszego. Zdjęcia bez daty i przykładowe (numer ujemny) są pomijane. */
export function findEvents(photos: Photo[]): PhotoEvent[] {
  const items: Item[] = []
  for (const p of photos) {
    if (p.id < 0) continue
    const t = takenSeconds(p.taken)
    if (t !== null) items.push({ p, t })
  }
  items.sort((a, b) => a.t - b.t)
  const clusters: Item[][] = []
  let cur: Item[] = []
  for (const it of items) {
    const last = cur[cur.length - 1]
    if (last && it.t - last.t > GAP_HOURS * 3600) { clusters.push(cur); cur = [] }
    cur.push(it)
  }
  if (cur.length) clusters.push(cur)
  const events: PhotoEvent[] = []
  for (const c of clusters) for (const part of splitLong(c)) if (part.length >= MIN_PHOTOS) events.push(toEvent(part))
  return events.reverse()
}

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']
const parts = (d: string) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) })

/** Opis zakresu dat: „12 lipca 2023”, „12 do 15 lipca 2023”, „28 lipca do 2 sierpnia 2023”, „30 grudnia 2022 do 2 stycznia 2023”. */
export function rangeLabel(first: string, last: string): string {
  const a = parts(first), b = parts(last)
  const one = (x: { y: number; m: number; d: number }, year = true) => `${x.d} ${MONTHS_GEN[x.m - 1]}${year ? ` ${x.y}` : ''}`
  if (first === last) return one(a)
  if (a.y !== b.y) return `${one(a)} do ${one(b)}`
  if (a.m === b.m) return `${a.d} do ${b.d} ${MONTHS_GEN[a.m - 1]} ${a.y}`
  return `${one(a, false)} do ${one(b)}`
}

/** Proponowana nazwa albumu: „Podróż, 12 do 15 lipca 2023” albo „Wydarzenie, 12 lipca 2023”. */
export const suggestName = (e: PhotoEvent) => `${e.kind === 'trip' ? 'Podróż' : 'Wydarzenie'}, ${rangeLabel(e.first, e.last)}`
