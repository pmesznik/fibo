// Schowek edycji i zastosowanie tej samej edycji do wielu zdjęć (jak „Kopiuj i wklej zmiany”).
import { readImage, saveEdit, type Photo } from '../api'
import { EMPTY_EDIT, isEdited, renderEdit, type EditState } from './effects'

/** Przenoszone są korekty, efekty i napisy. Kadrowanie, obrót i poprawki oczu dotyczą konkretnego zdjęcia, więc nie są kopiowane. */
export type EditClip = Pick<EditState, 'adj' | 'fx' | 'texts'>

let clip: EditClip | null = null

export const hasClip = () => clip !== null
export const getClip = () => clip

export function copyEdit(s: EditState): boolean {
  const c: EditClip = { adj: s.adj, fx: s.fx, texts: s.texts }
  if (!isEdited({ ...EMPTY_EDIT, ...c })) return false
  clip = JSON.parse(JSON.stringify(c)) as EditClip
  return true
}

const extOf = (name: string) => {
  const n = name.toLowerCase()
  return n.endsWith('.png') ? 'png' : n.endsWith('.webp') ? 'webp' : n.endsWith('.jpg') || n.endsWith('.jpeg') ? 'jpg' : 'jpg'
}

/** Nakłada schowek na każde zdjęcie i zapisuje wynik jako kopię obok oryginału (oryginały nie są zmieniane). */
export async function pasteEditToPhotos(
  photos: Photo[],
  onProgress: (done: number, total: number) => void,
): Promise<{ done: number; errors: string[] }> {
  const c = clip
  if (!c) throw new Error('Schowek edycji jest pusty')
  const errors: string[] = []
  let done = 0
  for (const p of photos) {
    try {
      const bitmap = await createImageBitmap(new Blob([await readImage(p.id)]))
      const ext = extOf(p.name)
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      const out = renderEdit(bitmap, { ...EMPTY_EDIT, ...JSON.parse(JSON.stringify(c)) }, 100000)
      bitmap.close()
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, mime, 0.95))
      if (!blob) throw new Error('nie udało się zakodować obrazu')
      await saveEdit(p.id, await blob.arrayBuffer(), 'copy', ext as 'jpg' | 'png' | 'webp')
      done++
    } catch (e) {
      errors.push(`${p.name}: ${e}`)
    }
    onProgress(done + errors.length, photos.length)
  }
  return { done, errors }
}
