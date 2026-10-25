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
  albums: number[]
}

export type Album = { id: number; name: string; count: number }
export type RescanReport = { added: number; removed: number; roots: number }
export type MoveReport = { done: number; errors: string[] }

export const rescanRoots = () => invoke<RescanReport>('rescan_roots')
export const listRoots = () => invoke<string[]>('list_roots')
export const removeRoot = (path: string) => invoke('remove_root', { path })

export const listAlbums = () => invoke<Album[]>('list_albums')
export const createAlbum = (name: string) => invoke<Album>('create_album', { name })
export const renameAlbum = (id: number, name: string) => invoke('rename_album', { id, name })
export const deleteAlbum = (id: number) => invoke('delete_album', { id })
export const addToAlbum = (albumId: number, ids: number[]) => invoke('add_to_album', { albumId, ids })
export const removeFromAlbum = (albumId: number, ids: number[]) => invoke('remove_from_album', { albumId, ids })

/** Zmienia nazwę pliku (rozszerzenie zostaje); zwraca nową nazwę z rozszerzeniem. */
export const renamePhoto = (id: number, newStem: string) => invoke<string>('rename_photo', { id, newStem })
export const movePhotos = (ids: number[], dest: string, copy: boolean) => invoke<MoveReport>('move_photos', { ids, dest, copy })

export const inTauri = '__TAURI_INTERNALS__' in window

export const listPhotos = () => invoke<Photo[]>('list_photos')
export const scanFolder = (path: string) => invoke<number>('scan_folder', { path })
export const setRating = (id: number, rating: number) => invoke('set_rating', { id, rating })
export const setFavorite = (id: number, favorite: boolean) => invoke('set_favorite', { id, favorite })

export type DupGroup = { kind: 'exact' | 'similar'; ids: number[] }
/** maxDistance: null = tylko identyczne pliki; liczba = także podobne (odległość hashy 0-64, sensownie 4-10). */
export const findDuplicates = (maxDistance: number | null) => invoke<DupGroup[]>('find_duplicates', { maxDistance })
export const trashPhotos = (ids: number[]) => invoke<number>('trash_photos', { ids })

export type SidecarReport = { written: number; removed: number; skipped: number; unchanged: number; failed: number }
export type ImportReport = { files: number; changed: number }
export const getSidecarEnabled = () => invoke<boolean>('get_sidecar_enabled')
export const setSidecarEnabled = (enabled: boolean) => invoke('set_sidecar_enabled', { enabled })
export const exportSidecars = () => invoke<SidecarReport>('export_sidecars')
export const importSidecars = () => invoke<ImportReport>('import_sidecars')

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

export async function pickFolder(title = 'Wybierz folder ze zdjęciami') {
  const dir = await open({ directory: true, multiple: false, title })
  return typeof dir === 'string' ? dir : null
}
