import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
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
  caption?: string | null
  exif?: string | null
  author?: string | null
  copyright?: string | null
  /** Kolor dominujący: numer 0 do 11 (zob. COLORS w App.tsx), null gdy jeszcze nie policzono. */
  color?: number | null
  /** Flaga selekcji: 1 wybrane, -1 odrzucone, 0 brak. */
  flag?: number
  /** Etykieta kolorowa: 1 czerwona, 2 żółta, 3 zielona, 4 niebieska, 0 brak. */
  label?: number
  /** Film (odtwarzany przez okno aplikacji), a nie zdjęcie. */
  video?: boolean
  /** Czas trwania filmu w sekundach. */
  duration?: number | null
}

/** Adres odtwarzania filmu z biblioteki: protokół programu zwraca bajty tylko dla filmów z biblioteki i tylko po numerze. */
export const videoUrl = (id: number) => `http://fibo-video.localhost/${id}`

/** Czas trwania jako „0:42” albo „1:05:09”. */
export function durationLabel(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return ''
  const s = Math.round(sec)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export type Album = { id: number; name: string; count: number; hidden: boolean }
export type RescanReport = { added: number; removed: number; roots: number }
export type MoveReport = { done: number; errors: string[] }

export const rescanRoots = () => invoke<RescanReport>('rescan_roots')
export const listRoots = () => invoke<string[]>('list_roots')
export const removeRoot = (path: string) => invoke('remove_root', { path })

export const listAlbums = () => invoke<Album[]>('list_albums')
export const createAlbum = (name: string) => invoke<Album>('create_album', { name })
export const renameAlbum = (id: number, name: string) => invoke('rename_album', { id, name })
export const setAlbumHidden = (id: number, hidden: boolean) => invoke('set_album_hidden', { id, hidden })
export const listAlbumOrder = (albumId: number) => invoke<number[]>('list_album_order', { albumId })
export const setAlbumOrder = (albumId: number, ids: number[]) => invoke('set_album_order', { albumId, ids })
export const deleteAlbum = (id: number) => invoke('delete_album', { id })
export const addToAlbum = (albumId: number, ids: number[]) => invoke('add_to_album', { albumId, ids })
export const removeFromAlbum = (albumId: number, ids: number[]) => invoke('remove_from_album', { albumId, ids })

/** Zmienia nazwę pliku (rozszerzenie zostaje); zwraca nową nazwę z rozszerzeniem. */
export const renamePhoto = (id: number, newStem: string) => invoke<string>('rename_photo', { id, newStem })
export const movePhotos = (ids: number[], dest: string, copy: boolean) => invoke<MoveReport>('move_photos', { ids, dest, copy })

export const inTauri = '__TAURI_INTERNALS__' in window

export const listPhotos = () => invoke<Photo[]>('list_photos')
export const scanFolder = (path: string, watch = true) => invoke<number>('scan_folder', { path, watch })
export const setRating = (id: number, rating: number) => invoke('set_rating', { id, rating })
export type ClipStatus = { models_ok: boolean; running: boolean; indexed: number; total: number; concepts: number }
export type ClipResult = { ids: number[]; scores: number[]; matched: string[]; unknown: string[]; indexed: number }
export const clipStatus = () => invoke<ClipStatus>('clip_status')
export const clipStart = () => invoke<boolean>('clip_start')
export const clipStop = () => invoke('clip_stop')
export const clipSearch = (query: string) => invoke<ClipResult>('clip_search', { query })
export const setFlag = (ids: number[], flag: number) => invoke('set_flag', { ids, flag })
export const setLabel = (ids: number[], label: number) => invoke('set_label', { ids, label })
export const setFavorite = (id: number, favorite: boolean) => invoke('set_favorite', { id, favorite })

export type DupGroup = { kind: 'exact' | 'similar'; ids: number[] }
/** maxDistance: null = tylko identyczne pliki; liczba = także podobne (odległość hashy 0-64, sensownie 4-10). */
export const findDuplicates = (maxDistance: number | null) => invoke<DupGroup[]>('find_duplicates', { maxDistance })
export const setLocation = (ids: number[], lat: number | null, lon: number | null) => invoke<number>('set_location', { ids, lat, lon })
export const renameBatch = (ids: number[], prefix: string, withDate: boolean, start: number) => invoke<MoveReport>('rename_batch', { ids, prefix, withDate, start })
export type PhotoImportReport = { copied: number; skipped: number; errors: string[] }
export const importPhotos = (src: string, dest: string) => invoke<PhotoImportReport>('import_photos', { src, dest })
export type PhotoBackupReport = { copied: number; skipped: number; errors: string[] }
export const backupPhotos = (dest: string) => invoke<PhotoBackupReport>('backup_photos', { dest })
export const backupLibrary = (dest: string) => invoke<string>('backup_library', { dest })
export const restoreLibrary = (file: string) => invoke<number>('restore_library', { file })
export const photoExif = (id: number) => invoke<[string, string][]>('photo_exif', { id })
export const setCaption = (id: number, caption: string) => invoke('set_caption', { id, caption })
export const setDate = (ids: number[], date: string) => invoke<number>('set_date', { ids, date })
export const shiftDates = (ids: number[], minutes: number) => invoke<number>('shift_dates', { ids, minutes })
export type PhotoPerson = { id: number; name: string | null; face: number }
export const reassignPersonFaces = (photoId: number, from: number, to: number | null) => invoke<number>('reassign_person_faces', { photoId, from, to })
export const photoPeople = (id: number) => invoke<PhotoPerson[]>('photo_people', { id })
export type GalleryReport = { folder: string; done: number; errors: string[] }
export const exportGallery = (ids: number[], dest: string, title: string, maxSide: number, quality: number) =>
  invoke<GalleryReport>('export_gallery', { ids, dest, title, maxSide, quality })
export const renameFolder = (old: string, newName: string) => invoke<string>('rename_folder', { old, newName })
export type Prop = { kind: 'album' | 'folder'; key: string; description: string; place: string; date: string }
export const listProps = () => invoke<Prop[]>('list_props')
export const setProps = (kind: string, key: string, description: string, place: string, date: string) => invoke('set_props', { kind, key, description, place, date })
export const readAudio = (path: string) => invoke<ArrayBuffer>('read_audio', { path })
export type Watermark = { path: string; position: string; sizePct: number; opacity: number }
/** Pokazuje plik lub folder w Eksploratorze Windows (zaznacza go w oknie folderu). */
export const openPhotoExternal = (id: number) => invoke('open_photo_external', { id })
export const revealInExplorer = (path: string) => revealItemInDir(path)
export const listLocked = () => invoke<string[]>('list_locked')
export const setFolderLocked = (path: string, locked: boolean) => invoke('set_folder_locked', { path, locked })
export const exportGpx = (ids: number[], dest: string) => invoke<[string, number]>('export_gpx', { ids, dest })
export const exportGif = (ids: number[], dest: string, maxSide: number, delayMs: number) => invoke<string>('export_gif', { ids, dest, maxSide, delayMs })
export const exportPdf = (ids: number[], dest: string, cols: number, rows: number, maxSide: number, quality: number) => invoke<[string, number]>('export_pdf', { ids, dest, cols, rows, maxSide, quality })
export type BrokenFile = { id: number; path: string; error: string }
export const checkFiles = (deep: boolean) => invoke<BrokenFile[]>('check_files', { deep })
export type SmartAlbum = { id: number; name: string; filters: string }
export const listSmart = () => invoke<SmartAlbum[]>('list_smart')
export const saveSmart = (name: string, filters: string) => invoke('save_smart', { name, filters })
export const deleteSmart = (id: number) => invoke('delete_smart', { id })
export const exportPhotos = (ids: number[], dest: string, maxSide: number, quality: number, watermark: Watermark | null = null, format: 'jpg' | 'png' | 'webp' = 'jpg') => invoke<MoveReport>('export_photos', { ids, dest, maxSide, quality, watermark, format })
export const trashPhotos = (ids: number[], confirm?: string) => invoke<number>('trash_photos', { ids, confirm })
export const hidePhotos = (ids: number[]) => invoke<number>('hide_photos', { ids })
export const hiddenCount = () => invoke<number>('hidden_count')
export const restoreHidden = () => invoke<number>('restore_hidden')

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

/** Zapisuje miniaturę zrobioną w oknie aplikacji (formaty bez dekodera w programie: AVIF, SVG) razem z rozmiarem zdjęcia. */
export const putThumbnail = (id: number, bytes: ArrayBuffer, width: number, height: number) =>
  invoke('put_thumbnail', bytes, { headers: { id: String(id), width: String(width), height: String(height) } })

export type RotateReport = { done: number; skipped: number; errors: string[] }
/** Obrót o 90° bez utraty jakości (zmiana znacznika orientacji w JPEG; inne formaty są pomijane). */
export const rotatePhotos = (ids: number[], clockwise: boolean) => invoke<RotateReport>('rotate_photos', { ids, clockwise })
export const getSkipGifPng = () => invoke<boolean>('get_skip_gif_png')
export const setSkipGifPng = (skip: boolean) => invoke('set_skip_gif_png', { skip })
/** Dyski wyglądające na kartę pamięci aparatu (zawierają folder DCIM), jeszcze nieobserwowane przez FIBO. */
export const detectCards = () => invoke<string[]>('detect_cards')

export const setCredits = (ids: number[], author: string, copyright: string) => invoke<number>('set_credits', { ids, author, copyright })
export const indexColors = () => invoke<{ done: number }>('index_colors')

/** Dla zdjęć z twarzami: [numer zdjęcia, liczba twarzy, jakość najlepszej twarzy]. */
export const photoFaceStats = () => invoke<[number, number, number][]>('photo_face_stats')
/** Zapisuje kalendarz jako PDF: `body` to strony JPEG w ramkach (liczba, potem długość i bajty każdej). Zwraca ścieżkę pliku. */
export const saveCalendarPdf = (body: ArrayBuffer, dest: string, name: string, paper: string, landscape: boolean) =>
  invoke<string>('save_calendar_pdf', body, { headers: { dest: encodeURIComponent(dest), name, size: paper, landscape: landscape ? '1' : '0' } })

export type RawParams = { exposure: number; temp: number; tint: number; highlights: number }
export const RAW_NEUTRAL: RawParams = { exposure: 0, temp: 0, tint: 0, highlights: 0 }
/** Czy plik jest zdjęciem RAW aparatu (po rozszerzeniu): tylko takie można wywołać od nowa z surowych danych. */
export const isRawName = (name: string) => /\.(3fr|ari|arw|bay|cap|cr2|cr3|crw|dcr|dcs|dng|erf|fff|gpr|iiq|k25|kdc|mdc|mef|mos|mrw|nef|nrw|orf|pef|ptx|raf|raw|rw2|rwl|sr2|srf|srw|x3f)$/i.test(name)
/** Wywołuje zdjęcie RAW z własną ekspozycją i balansem bieli; zwraca JPEG jako źródło dla edytora. */
export const developRaw = (id: number, params: RawParams) => invoke<ArrayBuffer>('develop_raw', { id, params })

export const readImage = (id: number) => invoke<ArrayBuffer>('read_image', { id })

/** Miniatura jako Blob (bajty przez IPC); wywołujący tworzy i zwalnia adres blob:. */
export async function thumbnailBlob(id: number) {
  return new Blob([await invoke<ArrayBuffer>('thumbnail_data', { id })], { type: 'image/jpeg' })
}
export async function faceBlob(id: number) {
  return new Blob([await invoke<ArrayBuffer>('face_crop', { id })], { type: 'image/jpeg' })
}

// ---- Rozpoznawanie twarzy (wszystko lokalnie) ----
export type FacesStatus = { enabled: boolean; models_ok: boolean; running: boolean; photos: number; scanned: number; faces: number; people: number; unassigned: number; rejected: number }
export type FacesProgress = { done: number; total: number; faces: number; finished: boolean; grouping?: boolean; stopped?: boolean; skipped?: number; error: string | null }
export type Person = { id: number; name: string | null; count: number; photos: number; cover: number | null; ignored: boolean; unsure: number }
/** Twarz w widoku osoby: `unsure` = program nie jest pewien przypisania (czeka na potwierdzenie). */
export type FaceCard = { face: number; photo: number; unsure: boolean }
export const personFaceCards = (id: number) => invoke<FaceCard[]>('person_face_cards', { id })
export const confirmFaces = (ids: number[]) => invoke<number>('confirm_faces', { ids })
export const facesStatus = () => invoke<FacesStatus>('faces_status')
export const setFacesEnabled = (on: boolean) => invoke('set_faces_enabled', { on })
export const facesStart = () => invoke<boolean>('faces_start')
export const facesStop = () => invoke('faces_stop')
export const facesRegroup = () => invoke<boolean>('faces_regroup')
export const facesReanalyze = () => invoke<boolean>('faces_reanalyze')
export const facesDeleteAll = () => invoke('faces_delete_all')
export const listPeople = () => invoke<Person[]>('list_people')
export const personPhotos = (id: number) => invoke<number[]>('person_photos', { id })
export const personFaces = (id: number) => invoke<number[]>('person_faces', { id })
export const setPersonCover = (id: number, face: number) => invoke('set_person_cover', { id, face })
export const renamePerson = (id: number, name: string) => invoke('rename_person', { id, name })
export const mergePeople = (from: number, into: number, name: string | null = null) => invoke('merge_people', { from, into, name })
/** Podpowiedź łączenia: `id` i `other` to osoby, `score` podobieństwo (0-1), `conflict` = występują razem na jednym zdjęciu. */
export type MergeSuggestion = { id: number; other: number; score: number; conflict: boolean }
export const mergeSuggestions = (id: number | null) => invoke<MergeSuggestion[]>('merge_suggestions', { id })
/** „To nie ta osoba”: twarze osoby na wskazanych zdjęciach przestają do niej należeć (i nie wrócą przy grupowaniu). */
export const rejectPersonInPhotos = (person: number, photos: number[]) => invoke<number>('reject_person_in_photos', { person, photos })
/** Przenosi twarze osoby na wskazanych zdjęciach do innej osoby albo (to = null) do nowej. */
export const movePersonFaces = (person: number, photos: number[], to: number | null) => invoke<number>('move_person_faces', { person, photos, to })
export const moveFaces = (ids: number[], to: number | null) => invoke<number>('move_faces', { ids, to })
export const rejectFaces = (ids: number[]) => invoke<number>('reject_faces', { ids })
export const deletePerson = (id: number) => invoke<number>('delete_person', { id })
export const restoreRejectedFaces = () => invoke<number>('restore_rejected_faces')
export const ignorePerson = (id: number, ignored: boolean) => invoke('ignore_person', { id, ignored })

export async function pickFile(title: string, extensions: string[], filterName = 'Kopia biblioteki FIBO') {
  const f = await open({ directory: false, multiple: false, title, filters: [{ name: filterName, extensions }] })
  return typeof f === 'string' ? f : null
}

export async function pickFolder(title = 'Wybierz folder ze zdjęciami') {
  const dir = await open({ directory: true, multiple: false, title })
  return typeof dir === 'string' ? dir : null
}
