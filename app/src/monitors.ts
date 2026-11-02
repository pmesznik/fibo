/**
 * Pokaz slajdów na innym monitorze: okno programu przeskakuje na kolejny monitor i przechodzi na pełny ekran.
 * Część wyliczająca (który monitor jest który) nie zależy od Tauri, więc da się ją przetestować osobno.
 */

export type MonitorBox = { position: { x: number; y: number }; size: { width: number; height: number } }

/** Numer monitoru, na którym leży punkt (np. środek okna); gdy punkt leży poza wszystkimi, pierwszy monitor. */
export function monitorAt(list: MonitorBox[], p: { x: number; y: number }): number {
  const i = list.findIndex((m) => p.x >= m.position.x && p.x < m.position.x + m.size.width && p.y >= m.position.y && p.y < m.position.y + m.size.height)
  return i < 0 ? 0 : i
}

/** Kolejny monitor po kolei, z powrotem do pierwszego po ostatnim. */
export function nextMonitor(count: number, current: number): number {
  return count <= 0 ? 0 : (current + 1) % count
}

/** Ile monitorów widzi system (0 w podglądzie bez programu). */
export async function monitorCount(): Promise<number> {
  try {
    if (!('__TAURI_INTERNALS__' in window)) return 0
    const w = await import('@tauri-apps/api/window')
    return (await w.availableMonitors()).length
  } catch { return 0 }
}

/** Przenosi okno na kolejny monitor i włącza pełny ekran. Zwraca numer monitoru (od 0) i liczbę monitorów. */
export async function sendToNextMonitor(): Promise<{ index: number; count: number } | null> {
  const w = await import('@tauri-apps/api/window')
  const win = w.getCurrentWindow()
  const list = await w.availableMonitors()
  if (list.length < 2) return null
  const pos = await win.outerPosition()
  const size = await win.outerSize()
  const index = nextMonitor(list.length, monitorAt(list, { x: pos.x + size.width / 2, y: pos.y + size.height / 2 }))
  const m = list[index]
  if (await win.isFullscreen()) await win.setFullscreen(false)
  await win.setPosition(new w.PhysicalPosition(m.position.x + 60, m.position.y + 60))
  await win.setFullscreen(true)
  return { index, count: list.length }
}

/** Wychodzi z pełnego ekranu ustawionego przez program (okno zostaje na monitorze, na którym jest). */
export async function leaveFullscreen(): Promise<void> {
  try {
    const w = await import('@tauri-apps/api/window')
    await w.getCurrentWindow().setFullscreen(false)
  } catch { /* podgląd bez programu */ }
}
