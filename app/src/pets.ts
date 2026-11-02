/** Zwierzęta domowe: podział wyników szukania „pies” i „kot” na psy i koty. Zdjęcie trafia tylko do jednej z grup. */

export type Hits = { ids: number[]; scores: number[] }

/**
 * Zdjęcie jest psem albo kotem, gdy wynik tego zwierzęcia sięga progu. Gdy sięga go oba, wygrywa wyższy wynik,
 * a przy niemal remisie (różnica poniżej `margin`) zdjęcie nie trafia do żadnej grupy, bo program nie jest pewien.
 */
export function splitPets(dog: Hits, cat: Hits, min: number, margin = 0.01): { dogs: number[]; cats: number[] } {
  const score = (h: Hits) => new Map(h.ids.map((id, i) => [id, h.scores[i] ?? 0] as const))
  const d = score(dog), c = score(cat)
  const dogs: number[] = [], cats: number[] = []
  for (const [id, ds] of d) {
    const cs = c.get(id) ?? -Infinity
    if (ds >= min && ds - cs >= margin) dogs.push(id)
  }
  for (const [id, cs] of c) {
    const ds = d.get(id) ?? -Infinity
    if (cs >= min && cs - ds >= margin) cats.push(id)
  }
  const rank = (ids: number[], m: Map<number, number>) => ids.sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0))
  return { dogs: rank(dogs, d), cats: rank(cats, c) }
}

/** Tag z imienia: bez spacji na brzegach i podwójnych spacji; puste imię to brak tagu. */
export function petTag(name: string): string | null {
  const t = name.trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, 40) : null
}
