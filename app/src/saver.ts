/** Wygaszacz w programie: po kilku minutach bez ruchu FIBO pokazuje zdjęcia na pełnym ekranie, a ruch myszy albo klawisz go kończy. */

/** Czas bezczynności w minutach; 0 to wyłączony. */
export const SAVER_CHOICES = [0, 5, 10, 20] as const

export function nextSaver(minutes: number): number {
  const i = (SAVER_CHOICES as readonly number[]).indexOf(minutes)
  return SAVER_CHOICES[(i + 1) % SAVER_CHOICES.length]
}

export function saverLabel(minutes: number): string {
  return minutes > 0 ? `Wygaszacz: po ${minutes} min` : 'Wygaszacz: wyłączony'
}

/** Czy włączyć wygaszacz: funkcja włączona, bezczynność dość długa, nic innego nie jest otwarte i są zdjęcia do pokazania. */
export function shouldStartSaver(o: { minutes: number; idleMs: number; busy: boolean; photos: number }): boolean {
  return o.minutes > 0 && !o.busy && o.photos > 0 && o.idleMs >= o.minutes * 60_000
}

/** Mieszanie bez zmiany wejścia (Fisher-Yates); `rnd` zwraca liczbę z [0, 1). */
export function shuffled<T>(list: readonly T[], rnd: () => number = Math.random): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Czy ruch myszy ma zakończyć wygaszacz: drobne drgnięcie tuż po starcie jest ignorowane. */
export function movedEnough(dx: number, dy: number, sinceStartMs: number): boolean {
  return sinceStartMs > 800 && Math.hypot(dx, dy) > 12
}
