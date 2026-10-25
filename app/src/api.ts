import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export type Photo = {
  id: number
  path: string
  name: string
  size: number
  modified: number
  taken: string | null
  width: number | null
  height: number | null
  camera: string | null
  rating: number
  favorite: boolean
  tags: string[]
  lat: number | null
  lon: number | null
}

export const inTauri = '__TAURI_INTERNALS__' in window

export const listPhotos = () => invoke<Photo[]>('list_photos')
export const scanFolder = (path: string) => invoke<number>('scan_folder', { path })
export const setRating = (id: number, rating: number) => invoke('set_rating', { id, rating })
export const setFavorite = (id: number, favorite: boolean) => invoke('set_favorite', { id, favorite })

export type DupGroup = { kind: 'exact' | 'similar'; ids: number[] }
/** maxDistance: null = tylko identyczne pliki; liczba = także podobne (odległość hashy 0-64, sensownie 4-10). */
export const findDuplicates = (maxDistance: number | null) => invoke<DupGroup[]>('find_duplicates', { maxDistance })
export const trashPhotos = (ids: number[]) => invoke<number>('trash_photos', { ids })

export const refreshLibrary = () => invoke<number>('refresh_library')
export const addTag = (ids: number[], tag: string) => invoke<string>('add_tag', { ids, tag })
export const removeTag = (ids: number[], tag: string) => invoke('remove_tag', { ids, tag })
export const deleteTag = (tag: string) => invoke('delete_tag', { tag })

export const hasOriginal = (id: number) => invoke<boolean>('has_original', { id })
export const restoreOriginal = (id: number) => invoke<number>('restore_original', { id })

/** Zapisuje wyedytowany obraz; zwraca id zdjęcia w bibliotece (nowe przy kopii). */
export const saveEdit = (id: number, bytes: ArrayBuffer, mode: 'overwrite' | 'copy', ext: 'jpg' | 'png' | 'webp') =>
  invoke<number>('save_edit', bytes, { headers: { id: String(id), mode, ext } })

export const saveCollage = (id: number, bytes: ArrayBuffer, name: string) =>
  invoke<number>('save_collage', bytes, { headers: { id: String(id), name } })

export const readImage = (id: number) => invoke<ArrayBuffer>('read_image', { id })
export const imageUrl = (path: string) => convertFileSrc(path)

export async function thumbnailUrl(id: number) {
  return convertFileSrc(await invoke<string>('thumbnail', { id }))
}

export async function pickFolder() {
  const dir = await open({ directory: true, multiple: false, title: 'Wybierz folder ze zdjęciami' })
  return typeof dir === 'string' ? dir : null
}
