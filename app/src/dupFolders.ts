/**
 * Duplikaty katalogów: z grup zduplikowanych zdjęć wyznacza pary katalogów, które zawierają te same zdjęcia.
 * Czysta logika bez Tauri, więc da się ją testować w Node. Niczego nie zmienia na dysku ani w bazie.
 */

export type DupGroupLite = { kind: 'exact' | 'similar'; ids: number[] }
export type PhotoLite = { id: number; path: string }

export type FolderPair = {
  /** Katalog A i B (jako ścieżki) oraz liczba zdjęć w każdym. */
  a: string
  b: string
  countA: number
  countB: number
  /** Ile różnych zdjęć (zawartości) mają oba katalogi wspólnie. */
  shared: number
  /** Zgodność w procentach (0 do 100): wspólne podzielone przez wszystkie różne zdjęcia obu katalogów. */
  percent: number
  /** identical: te same zdjęcia w obu; subset: jeden katalog w całości mieści się w drugim; similar: część wspólna. */
  kind: 'identical' | 'subset' | 'similar'
  /** Przy `subset`: który katalog mieści się w drugim. */
  inside: 'a' | 'b' | null
  /** Wszystkie wspólne zdjęcia to identyczne pliki (a nie tylko bardzo podobne). */
  exact: boolean
}

export const dirOfPath = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

/** Najmniej wspólnych zdjęć, żeby uznać katalogi za powtórzone (jedno wspólne zdjęcie to za mało). */
export const MIN_SHARED = 2
/** Najniższa zgodność pokazywana, gdy żaden katalog nie mieści się w drugim. */
export const MIN_PERCENT = 50
export const MAX_PAIRS = 60

/**
 * Pary katalogów o wspólnych zdjęciach, od najbardziej powtórzonych: najpierw identyczne (100%), potem takie, w których jeden katalog w całości
 * mieści się w drugim, potem pozostałe od najwyższej zgodności w dół. Zdjęcia bez duplikatu liczą się jako unikalne, więc katalog z dodatkowymi
 * zdjęciami nie jest uznany za identyczny.
 */
export function folderPairs(groups: DupGroupLite[], photos: PhotoLite[]): FolderPair[] {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const groupOf = new Map<number, number>()
  const exactGroup = new Set<number>()
  groups.forEach((g, i) => {
    const members = g.ids.filter((id) => byId.has(id))
    if (members.length < 2) return
    members.forEach((id) => groupOf.set(id, i))
    if (g.kind === 'exact') exactGroup.add(i)
  })
  // Zawartość każdego katalogu: zbiór kluczy (numer grupy albo „sam” dla zdjęcia bez duplikatu).
  const keys = new Map<string, Set<string>>()
  const count = new Map<string, number>()
  for (const p of photos) {
    const d = dirOfPath(p.path)
    const k = groupOf.has(p.id) ? `g${groupOf.get(p.id)}` : `s${p.id}`
    if (!keys.has(d)) keys.set(d, new Set())
    keys.get(d)!.add(k)
    count.set(d, (count.get(d) ?? 0) + 1)
  }
  // Katalogi, w których występuje dana grupa.
  const where = new Map<string, string[]>()
  for (const [d, ks] of keys) for (const k of ks) if (k[0] === 'g') where.set(k, [...(where.get(k) ?? []), d])
  const pairShared = new Map<string, { a: string; b: string; keys: string[] }>()
  for (const [k, dirs] of where) {
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
      const [a, b] = dirs[i] < dirs[j] ? [dirs[i], dirs[j]] : [dirs[j], dirs[i]]
      const id = `${a}\u0000${b}`
      const e = pairShared.get(id) ?? { a, b, keys: [] }
      e.keys.push(k)
      pairShared.set(id, e)
    }
  }
  const out: FolderPair[] = []
  for (const { a, b, keys: shared } of pairShared.values()) {
    if (shared.length < MIN_SHARED) continue
    const ka = keys.get(a)!.size, kb = keys.get(b)!.size
    const union = ka + kb - shared.length
    const percent = Math.round((shared.length / union) * 100)
    const aInB = shared.length === ka, bInA = shared.length === kb
    const kind: FolderPair['kind'] = aInB && bInA ? 'identical' : aInB || bInA ? 'subset' : 'similar'
    if (kind === 'similar' && percent < MIN_PERCENT) continue
    out.push({
      a, b, countA: count.get(a) ?? 0, countB: count.get(b) ?? 0, shared: shared.length, percent: kind === 'identical' ? 100 : Math.min(99, percent), kind,
      inside: kind === 'subset' ? (aInB ? 'a' : 'b') : null,
      exact: shared.every((k) => exactGroup.has(Number(k.slice(1)))),
    })
  }
  const tier = (p: FolderPair) => (p.kind === 'identical' ? 0 : p.kind === 'subset' ? 1 : 2)
  out.sort((x, y) => tier(x) - tier(y) || y.percent - x.percent || y.shared - x.shared || x.a.localeCompare(y.a))
  return out.slice(0, MAX_PAIRS)
}

/** Zdjęcia z katalogu `dir`, które mają kopię w drugim katalogu pary (to je można bezpiecznie usunąć z `dir`: oryginały zostają w drugim). */
export function redundantIn(dir: string, other: string, groups: DupGroupLite[], photos: PhotoLite[]): number[] {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const out: number[] = []
  for (const g of groups) {
    const members = g.ids.map((i) => byId.get(i)).filter((p): p is PhotoLite => !!p)
    if (members.length < 2 || !members.some((p) => dirOfPath(p.path) === other)) continue
    const mine = members.filter((p) => dirOfPath(p.path) === dir)
    // Zostaje kopia w drugim katalogu, więc z naszego można usunąć wszystkie jego kopie z tej grupy.
    out.push(...mine.map((p) => p.id))
  }
  return out
}
