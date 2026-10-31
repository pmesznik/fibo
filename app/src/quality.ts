/**
 * Przegląd jakości: wybór zdjęć z problemami (nieostre, ciemne, prześwietlone) i najlepszego ujęcia z serii.
 * Czysta logika bez Tauri, więc da się ją testować w Node. Liczby (ostrość, jasność) liczy backend (quality.rs).
 */
import type { Photo } from './api'
import type { Stack } from './stacks'

export type Problem = 'blur' | 'dark' | 'bright'

/** Domyślne progi (użytkownik zmienia je suwakiem): ostrość poniżej, średnia jasność poniżej, odsetek białych pikseli (w procentach) powyżej. */
export const DEFAULT_BLUR = 40
export const DEFAULT_DARK = 45
export const DEFAULT_BRIGHT = 25

/** Zdjęcia z danym problemem, od najgorszych. Zdjęcia bez oceny są pomijane. */
export function problemPhotos(photos: Photo[], kind: Problem, limit: number): Photo[] {
  const rated = photos.filter((p) => p.id >= 0 && p.q_sharp != null)
  if (kind === 'blur') return rated.filter((p) => (p.q_sharp as number) < limit).sort((a, b) => (a.q_sharp as number) - (b.q_sharp as number))
  if (kind === 'dark') return rated.filter((p) => (p.q_mean ?? 255) < limit).sort((a, b) => (a.q_mean ?? 255) - (b.q_mean ?? 255))
  return rated.filter((p) => (p.q_hi ?? 0) * 100 > limit).sort((a, b) => (b.q_hi ?? 0) - (a.q_hi ?? 0))
}

export type BurstBest = { best: Photo; others: Photo[] }

/**
 * Najlepsze ujęcie każdej serii: z najwyższą ostrością (przy remisie to, które ma lepszą ocenę, a potem wcześniejsze).
 * Serie bez ocenionych ujęć są pomijane; pary RAW + JPEG to nie serie.
 */
export function bestOfBursts(stacks: Map<number, Stack>, photos: Photo[]): BurstBest[] {
  const byId = new Map(photos.map((p) => [p.id, p]))
  const seen = new Set<Stack>()
  const out: BurstBest[] = []
  for (const st of stacks.values()) {
    if (st.kind !== 'burst' || seen.has(st)) continue
    seen.add(st)
    const members = st.ids.map((i) => byId.get(i)).filter((p): p is Photo => !!p)
    const rated = members.filter((p) => p.q_sharp != null)
    if (rated.length === 0) continue
    const best = rated.reduce((a, b) => ((b.q_sharp as number) > (a.q_sharp as number) || ((b.q_sharp as number) === (a.q_sharp as number) && b.rating > a.rating) ? b : a))
    out.push({ best, others: members.filter((p) => p.id !== best.id) })
  }
  return out
}
