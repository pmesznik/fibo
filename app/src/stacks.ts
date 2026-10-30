/**
 * Stosy zdjęć: para RAW + JPEG tego samego ujęcia oraz seria zdjęć zrobionych jedno po drugim (seria, bracketing, zdjęcia ciągłe).
 * Czysta logika bez Tauri, żeby dało się ją testować w Node. Nic nie zmienia na dysku ani w bazie: stos to tylko sposób wyświetlania.
 */
import type { Photo } from './api'
import { flagOf } from './marks'

export type Stack = {
  /** Numer lidera (zdjęcia pokazywanego, gdy stos jest zwinięty). */
  leader: number
  /** Wszystkie zdjęcia stosu w kolejności czasu (przy parach: JPEG przed RAW). */
  ids: number[]
  kind: 'pair' | 'burst'
}

const RAW_EXT = new Set(['arw', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'orf', 'raf', 'rw2', 'dng', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'mef', 'mos', 'raw', 'kdc', 'dcr', 'rwl', 'srf', 'sr2'])
/** Największa przerwa (w sekundach) między kolejnymi zdjęciami jednej serii. */
export const BURST_GAP_SECONDS = 2
/** Najmniej ujęć w serii: dwa zdjęcia po sobie to jeszcze nie seria. */
export const BURST_MIN = 3

const split = (path: string) => {
  const slash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  return { folder: path.slice(0, slash + 1).toLowerCase(), stem: (dot > 0 ? name.slice(0, dot) : name).toLowerCase(), ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '' }
}

/** Czas wykonania zdjęcia w sekundach (z EXIF „RRRR:MM:DD GG:MM:SS” albo „RRRR-MM-DD…”), null gdy brak. */
export function takenSeconds(taken: string | null | undefined): number | null {
  const m = taken?.match(/^(\d{4})[-:](\d{2})[-:](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(t) ? t / 1000 : null
}

/** Im wyższy wynik, tym lepiej nadaje się zdjęcie na lidera stosu: wybrane, dobrze ocenione, ulubione; odrzucone na końcu. */
const score = (p: Photo) => (flagOf(p) === 1 ? 100 : flagOf(p) === -1 ? -100 : 0) + (p.rating || 0) * 10 + (p.favorite ? 5 : 0)

/**
 * Znajduje stosy w całej bibliotece. Wynik: numer zdjęcia -> jego stos (każde zdjęcie jest w co najwyżej jednym stosie).
 * 1. Para: ta sama nazwa (bez rozszerzenia) w tym samym folderze, w tym co najmniej jeden plik RAW i jeden inny format.
 * 2. Seria: kolejne zdjęcia tego samego aparatu w tym samym folderze, między którymi mija najwyżej `BURST_GAP_SECONDS` sekund, od `BURST_MIN` ujęć.
 *    Para RAW + JPEG liczy się w serii jako jedno ujęcie.
 */
export function findStacks(photos: Photo[]): Map<number, Stack> {
  const real = photos.filter((p) => p.id >= 0)
  const parts = new Map(real.map((p) => [p.id, split(p.path)]))

  // Jednostki: para RAW + JPEG albo pojedyncze zdjęcie.
  type Unit = { members: Photo[]; time: number | null; folder: string; camera: string; pair: boolean }
  const byName = new Map<string, Photo[]>()
  for (const p of real) {
    const s = parts.get(p.id)!
    const key = `${s.folder}\u0000${s.stem}`
    byName.set(key, [...(byName.get(key) ?? []), p])
  }
  const units: Unit[] = []
  for (const group of byName.values()) {
    const raws = group.filter((p) => RAW_EXT.has(parts.get(p.id)!.ext))
    const pair = raws.length > 0 && raws.length < group.length
    if (pair || group.length === 1) {
      // Przy parze JPEG (lub inny gotowy format) idzie przed RAW.
      const members = pair ? [...group.filter((p) => !raws.includes(p)), ...raws] : group
      const lead = members[0]
      units.push({ members, time: takenSeconds(lead.taken), folder: parts.get(lead.id)!.folder, camera: lead.camera ?? '', pair })
    } else {
      // Kilka plików o tej samej nazwie, ale bez pary RAW + inny format (np. kopie): zostają osobno.
      for (const p of group) units.push({ members: [p], time: takenSeconds(p.taken), folder: parts.get(p.id)!.folder, camera: p.camera ?? '', pair: false })
    }
  }

  const out = new Map<number, Stack>()
  const add = (members: Photo[], kind: Stack['kind']) => {
    const ordered = members
    const leader = [...ordered].sort((a, b) => score(b) - score(a))[0]
    const stack: Stack = { leader: leader.id, ids: ordered.map((p) => p.id), kind }
    for (const p of ordered) out.set(p.id, stack)
  }

  // Serie: kolejne jednostki z tego samego folderu i aparatu, uporządkowane w czasie.
  const timed = units.filter((u) => u.time !== null).sort((a, b) => a.folder.localeCompare(b.folder) || a.camera.localeCompare(b.camera) || a.time! - b.time!)
  let run: Unit[] = []
  const flush = () => {
    if (run.length >= BURST_MIN) add(run.flatMap((u) => u.members), 'burst')
    run = []
  }
  for (const u of timed) {
    const last = run[run.length - 1]
    if (last && (last.folder !== u.folder || last.camera !== u.camera || u.time! - last.time! > BURST_GAP_SECONDS)) flush()
    run.push(u)
  }
  flush()

  // Pary, które nie weszły do serii, są osobnymi stosami.
  for (const u of units) {
    if (u.pair && !out.has(u.members[0].id)) add(u.members, 'pair')
  }
  return out
}

export type StackBadge = { count: number; open: boolean; kind: Stack['kind']; leader: boolean }

/**
 * Lista do wyświetlenia: zwinięty stos pokazuje tylko lidera (albo pierwsze obecne zdjęcie, gdy lidera odfiltrowano), rozwinięty wszystkie
 * obecne zdjęcia stosu w miejscu pierwszego z nich. `visible` to lista po filtrach i sortowaniu, więc stos może mieć w niej mniej członków niż w bibliotece.
 */
export function collapseStacks(visible: Photo[], stacks: Map<number, Stack>, open: Set<number>): { list: Photo[]; badges: Map<number, StackBadge> } {
  const present = new Map<Stack, Photo[]>()
  for (const p of visible) {
    const s = stacks.get(p.id)
    if (s) present.set(s, [...(present.get(s) ?? []), p])
  }
  const list: Photo[] = []
  const badges = new Map<number, StackBadge>()
  const done = new Set<Stack>()
  for (const p of visible) {
    const s = stacks.get(p.id)
    if (!s) { list.push(p); continue }
    const members = present.get(s)!
    if (members.length < 2) { list.push(p); continue } // po filtrach został jeden: nie ma czego zwijać
    if (done.has(s)) continue
    done.add(s)
    const isOpen = open.has(s.leader)
    const leader = members.find((m) => m.id === s.leader) ?? members[0]
    const shown = isOpen ? [leader, ...members.filter((m) => m !== leader)] : [leader]
    for (const m of shown) list.push(m)
    badges.set(leader.id, { count: members.length, open: isOpen, kind: s.kind, leader: true })
    if (isOpen) for (const m of shown) if (m !== leader) badges.set(m.id, { count: members.length, open: true, kind: s.kind, leader: false })
  }
  return { list, badges }
}

/** Liczba różnych stosów. */
export const stackCount = (stacks: Map<number, Stack>) => new Set(stacks.values()).size
