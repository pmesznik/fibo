// Testy drzewa kopii: rozpoznanie folderu-kopii razem z podfolderami, wybór oryginału, foldery chronione
// i najważniejsze: zaznaczenie do Kosza nigdy nie obejmuje ostatniej kopii zdjęcia ani zdjęć z chronionych folderów.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/dupTree.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const d = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let id = 0
const photo = (dir, name, extra = {}) => ({ id: ++id, path: `${dir}\\${name ?? `f${id}.jpg`}`, size: 1000, width: 4000, height: 3000, taken: '2019-01-01', ...extra })
/** Tworzy n zdjęć w folderze i ich kopie w podanych folderach; zwraca zdjęcia i grupy. */
function copies(dirs, n, kind = 'exact') {
  const photos = [], groups = []
  for (let i = 0; i < n; i++) {
    const g = dirs.map((dd) => photo(dd, `IMG_${i}.jpg`))
    photos.push(...g); groups.push({ kind, ids: g.map((p) => p.id) })
  }
  return { photos, groups }
}

test('cały skopiowany folder z podfolderami to jedna para, a nazwa „Kopia” wskazuje kopię', () => {
  id = 0
  const lato = copies(['C:\\Zdjecia\\2019\\Lato', 'D:\\Kopia\\2019\\Lato'], 3)
  const zima = copies(['C:\\Zdjecia\\2019\\Zima', 'D:\\Kopia\\2019\\Zima'], 2)
  const own = [photo('C:\\Zdjecia\\2020', 'a.jpg'), photo('D:\\Inne', 'b.jpg')]
  const photos = [...lato.photos, ...zima.photos, ...own], groups = [...lato.groups, ...zima.groups]
  const rel = d.copyRelations(groups, photos)
  assert.equal(rel.length, 1, 'podfoldery Lato i Zima nie są osobnymi parami')
  const r = rel[0]
  // D:\Kopia w całości (tylko 2019) powtarza się w C:\Zdjecia, który ma jeszcze 2020: para podnosi się do D:\Kopia i C:\Zdjecia.
  assert.equal(r.copy, 'D:\\Kopia'); assert.equal(r.original, 'C:\\Zdjecia')
  assert.equal(r.withSub, true); assert.equal(r.kind, 'subset'); assert.equal(r.shared, 5); assert.equal(r.exact, true)
  assert.equal(r.bytes, 5000); assert.equal(r.sure, true)
})

test('identyczne foldery: oryginał rozpoznany po nazwie, po nazwach plików, a bez wskazówek kierunek jest niepewny', () => {
  id = 0
  let x = copies(['E:\\Backup\\Wakacje', 'E:\\Foto\\Wakacje'], 3)
  let r = d.copyRelations(x.groups, x.photos)[0]
  assert.equal(r.kind, 'identical'); assert.equal(r.copy, 'E:\\Backup', 'para podnosi się do folderów, które zawierają tylko te zdjęcia'); assert.ok(r.sure)

  id = 0
  const a = [photo('F:\\A', 'x.jpg'), photo('F:\\A', 'y.jpg')], b = [photo('F:\\B', 'x (1).jpg'), photo('F:\\B', 'y - Kopia.jpg')]
  r = d.copyRelations([{ kind: 'exact', ids: [a[0].id, b[0].id] }, { kind: 'exact', ids: [a[1].id, b[1].id] }], [...a, ...b])[0]
  assert.equal(r.copy, 'F:\\B'); assert.ok(r.sure)

  id = 0
  x = copies(['G:\\Jeden', 'G:\\Dwa'], 2)
  r = d.copyRelations(x.groups, x.photos)[0]
  assert.equal(r.sure, false, 'bez wskazówek program nie udaje, że wie')
})

test('folder chroniony jest zawsze oryginałem, a para z chronioną kopią jest zablokowana', () => {
  id = 0
  const x = copies(['C:\\Kopia zdjec', 'C:\\Archiwum rodzinne'], 3)
  let r = d.copyRelations(x.groups, x.photos, ['C:\\Kopia zdjec'])[0]
  assert.equal(r.original, 'C:\\Kopia zdjec', 'ochrona wygrywa z nazwą')
  assert.equal(r.blocked, false)
  r = d.copyRelations(x.groups, x.photos, ['C:\\Kopia zdjec', 'C:\\Archiwum rodzinne'])[0]
  assert.equal(r.blocked, true)
  // Zamiana kierunku przez użytkownika.
  const free = d.copyRelations(x.groups, x.photos)[0]
  const sw = d.copyRelations(x.groups, x.photos, [], new Set([d.relationKey(free)]))[0]
  assert.equal(sw.copy, free.original); assert.equal(sw.original, free.copy)
})

test('częściowe pokrycie nie jest kopią, a folder z własnymi zdjęciami nie jest uznany za kopię całości', () => {
  id = 0
  const x = copies(['H:\\A', 'H:\\B'], 3)
  const ownA = photo('H:\\A', 'tylko-a.jpg'), ownB = photo('H:\\B', 'tylko-b.jpg')
  assert.equal(d.copyRelations(x.groups, [...x.photos, ownA, ownB]).length, 0)
  const sub = d.copyRelations(x.groups, [...x.photos, ownA])
  assert.equal(sub.length, 1); assert.equal(sub[0].copy, 'H:\\B'); assert.equal(sub[0].kind, 'subset')
})

test('zaznaczanie kopii z folderu: tylko zdjęcia, które mają odpowiednik poza nim, i nigdy z chronionych', () => {
  id = 0
  const x = copies(['K:\\Org', 'K:\\Kopia'], 3)
  const only = photo('K:\\Kopia', 'jedyne.jpg')
  const photos = [...x.photos, only]
  const m = d.marksForCopy('K:\\Kopia', true, x.groups, photos)
  assert.equal(m.size, 3)
  assert.ok(!m.has(only.id), 'zdjęcie bez kopii nie jest zaznaczane')
  for (const [del, keep] of m) {
    assert.ok(photos.find((p) => p.id === del).path.startsWith('K:\\Kopia\\'))
    assert.ok(photos.find((p) => p.id === keep).path.startsWith('K:\\Org\\'))
  }
  assert.equal(d.marksForCopy('K:\\Kopia', true, x.groups, photos, ['K:\\Kopia']).size, 0)
})

test('w grupie podobnych zdjęć nie zaznaczamy wersji większej niż ta, która zostaje', () => {
  id = 0
  const big = photo('L:\\A', 'duze.jpg', { width: 6000, height: 4000, size: 9000 })
  const small = photo('L:\\B', 'male.jpg', { width: 1200, height: 800, size: 300 })
  const g = [{ kind: 'similar', ids: [big.id, small.id] }]
  let m = d.planMarks(g, [big, small])
  assert.deepEqual([...m], [[small.id, big.id]])
  // Gdy duże leży w kopii (L:\B chroniony nie jest, ale chroniony jest folder małego), duże nie trafia do Kosza za małe.
  m = d.planMarks(g, [big, small], ['L:\\B'])
  assert.equal(m.size, 0)
})

test('wskazówki w nazwach: folderów i plików', () => {
  assert.ok(d.copyHint('C:\\Users\\Ola\\Pictures\\Kopia zapasowa\\2019'))
  assert.ok(d.copyHint('D:\\Backup 2020'))
  assert.ok(d.copyHint('D:\\Zdjecia (2)'))
  assert.ok(d.copyHint('C:\\Users\\Ola\\Downloads'))
  assert.equal(d.copyHint('C:\\Zdjecia\\Boldog\\Holandia'), null)
  assert.equal(d.copyHint('C:\\Zdjecia\\Stokrotki'), null, '„stare” tylko jako osobne słowo')
  assert.ok(d.fileCopyHint('C:\\a\\IMG_1 (1).jpg'))
  assert.ok(d.fileCopyHint('C:\\a\\IMG_1 - Kopia.jpg'))
  assert.ok(d.fileCopyHint('C:\\a\\Kopia IMG_1.jpg'))
  assert.equal(d.fileCopyHint('C:\\a\\IMG_12.jpg'), false)
  assert.equal(d.fileCopyHint('C:\\a\\DSC00123.JPG'), false)
})

test('drzewo: zwija łańcuchy pojedynczych folderów i pokazuje role', () => {
  id = 0
  const x = copies(['C:\\Users\\Ola\\Pictures\\2019', 'D:\\Kopia\\2019'], 2)
  const rel = d.copyRelations(x.groups, x.photos)
  let t = d.dupTree(x.groups, x.photos, rel)
  assert.deepEqual(t.map((n) => n.label), ['C:\\Users\\Ola\\Pictures', 'D:\\Kopia'])
  t = d.dupTree(x.groups, x.photos, rel, [], new Set(['D:\\Kopia']))
  assert.ok(t.some((n) => n.path === 'D:\\Kopia\\2019' && n.depth === 1))
  assert.ok(t.some((n) => n.role === 'copy') && t.some((n) => n.role === 'original'))
})

test('ścieżki: wnętrze folderu bez rozróżniania liter i bez fałszywych dopasowań prefiksu', () => {
  assert.ok(d.isInside('C:\\Foto\\a.jpg', 'c:\\foto'))
  assert.ok(d.isInside('C:/Foto/2019/a.jpg', 'C:\\Foto'))
  assert.equal(d.isInside('C:\\Foto2\\a.jpg', 'C:\\Foto'), false)
  assert.deepEqual(d.ancestors('C:\\A\\B'), ['C:\\A\\B', 'C:\\A', 'C:'])
})

test('losowe biblioteki: w każdej grupie zostaje co najmniej jedno zdjęcie, a „zostaje” nigdy nie jest zaznaczone', () => {
  let seed = 7
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const dirs = ['C:\\A', 'C:\\A\\X', 'C:\\B', 'D:\\Kopia', 'D:\\Kopia\\X', 'E:\\Pobrane', 'E:\\Foto (2)']
  for (let round = 0; round < 300; round++) {
    id = 0
    const photos = [], groups = []
    const ng = 1 + rnd(12)
    for (let g = 0; g < ng; g++) {
      const k = 2 + rnd(4), ids = []
      for (let i = 0; i < k; i++) {
        const p = photo(dirs[rnd(dirs.length)], undefined, { width: 1000 + rnd(3) * 1000, height: 1000, size: 100 + rnd(5) })
        photos.push(p); ids.push(p.id)
      }
      groups.push({ kind: rnd(3) ? 'exact' : 'similar', ids })
    }
    for (let i = rnd(5); i > 0; i--) photos.push(photo(dirs[rnd(dirs.length)]))
    const prot = rnd(2) ? [dirs[rnd(dirs.length)]] : []
    const rel = d.copyRelations(groups, photos, prot)
    const plans = [d.planMarks(groups, photos, prot, rel), ...rel.map((r) => d.marksForCopy(r.copy, r.withSub, groups, photos, prot))]
    for (const m of plans) {
      for (const g of groups) assert.ok(g.ids.some((i) => !m.has(i)), 'grupa nie może zniknąć cała')
      for (const [del, keep] of m) {
        assert.ok(!m.has(keep), 'zdjęcie, które zostaje, nie może być zaznaczone')
        assert.notEqual(del, keep)
        const g = groups.find((x) => x.ids.includes(del))
        assert.ok(g.ids.includes(keep), 'zostaje kopia z tej samej grupy')
        assert.ok(!prot.some((pd) => d.isInside(photos.find((p) => p.id === del).path, pd)), 'nic z chronionych')
      }
    }
  }
})

test('duża biblioteka (120 tysięcy zdjęć) liczy się w kilka sekund', () => {
  id = 0
  const photos = [], groups = []
  for (let y = 2010; y < 2020; y++) for (let m = 1; m <= 12; m++) for (let i = 0; i < 500; i++) {
    const org = photo(`C:\\Zdjecia\\${y}\\${m}`, `IMG_${i}.jpg`)
    photos.push(org)
    if (y < 2015) { const c = photo(`D:\\Kopia\\${y}\\${m}`, `IMG_${i}.jpg`); photos.push(c); groups.push({ kind: 'exact', ids: [org.id, c.id] }) }
  }
  for (let i = 0; i < 5000; i++) { const p = photo('E:\\Pobrane', `x${i}.jpg`); photos.push(p); groups[i * 5].ids.push(p.id) }
  const t0 = performance.now()
  const rel = d.copyRelations(groups, photos)
  const marks = d.planMarks(groups, photos, [], rel)
  const tree = d.dupTree(groups, photos, rel, [], new Set(['D:\\Kopia']))
  const ms = performance.now() - t0
  assert.ok(ms < 6000, `trwało ${Math.round(ms)} ms`)
  const kopia = rel.find((r) => r.copy === 'D:\\Kopia')
  assert.ok(kopia && kopia.withSub && kopia.original === 'C:\\Zdjecia', JSON.stringify(rel.slice(0, 3).map((r) => [r.copy, r.original])))
  assert.ok(marks.size >= 30000 && tree.length > 2)
  console.log(`  120 tys. zdjęć: ${Math.round(ms)} ms, ${rel.length} par, ${marks.size} do Kosza`)
  assert.ok(rel.some((r) => r.kind === 'scattered' && r.copy === 'E:\\Pobrane'), 'Pobrane ma kopie rozrzucone po miesiącach')
})

test('folder z kopiami rozrzuconymi po bibliotece (np. Pobrane) jest rozpoznany, a oryginał nie', () => {
  id = 0
  const a = copies(['M:\\Foto\\2019', 'M:\\Pobrane'], 3), b = copies(['M:\\Foto\\2020', 'M:\\Pobrane'], 2)
  const own = [photo('M:\\Foto\\2019', 'jedyne.jpg'), photo('M:\\Foto\\2020', 'jedyne2.jpg')]
  const photos = [...a.photos, ...b.photos, ...own]
  const groups = [...a.groups, ...b.groups]
  const rel = d.copyRelations(groups, photos)
  const sc = rel.find((r) => r.kind === 'scattered')
  assert.ok(sc, JSON.stringify(rel))
  assert.equal(sc.copy, 'M:\\Pobrane'); assert.equal(sc.elsewhere, 2); assert.equal(sc.shared, 5)
  assert.ok(!rel.some((r) => r.copy.startsWith('M:\\Foto')), 'folderów z własnymi zdjęciami nie uznajemy za kopię')
})

test('łączenie zaznaczeń i ręczne zaznaczanie nigdy nie usuwa ostatniej kopii', () => {
  id = 0
  // A i B mają się nawzajem: zaznaczenie „kopii z A” i „kopii z B” razem usunęłoby wszystko.
  const x = copies(['N:\\A', 'N:\\B'], 4)
  const fromA = d.marksForCopy('N:\\A', true, x.groups, x.photos), fromB = d.marksForCopy('N:\\B', true, x.groups, x.photos)
  const { marks, skipped } = d.mergeMarks(fromA, fromB)
  assert.equal(skipped, 4)
  for (const g of x.groups) assert.ok(g.ids.some((i) => !marks.has(i)))
  // Ręcznie: ostatniej kopii nie da się zaznaczyć, a zaznaczenie zdjęcia „zostaje” przenosi rolę na inne.
  id = 0
  const y = copies(['P:\\1', 'P:\\2', 'P:\\3'], 1)
  const [p1, p2, p3] = y.photos
  let m = new Map([[p2.id, p1.id]])
  m = d.markOne(m, y.photos, p1.id)
  assert.ok(m && m.get(p1.id) === p3.id && m.get(p2.id) === p3.id)
  assert.equal(d.markOne(m, y.photos, p3.id), null, 'ostatnia kopia')
  assert.equal(d.markOne(new Map(), y.photos, p1.id, ['P:\\1']), null, 'chroniony folder')
})

test('losowo: łączenie wszystkich podpowiedzi naraz zostawia kopię każdego zdjęcia', () => {
  let seed = 99
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  const dirs = ['C:\\A', 'C:\\A\\X', 'C:\\B', 'D:\\Kopia', 'D:\\Kopia\\X', 'E:\\Pobrane']
  for (let round = 0; round < 300; round++) {
    id = 0
    const photos = [], groups = []
    for (let g = 1 + rnd(10); g > 0; g--) {
      const ids = []
      for (let k = 2 + rnd(3); k > 0; k--) { const p = photo(dirs[rnd(dirs.length)]); photos.push(p); ids.push(p.id) }
      groups.push({ kind: 'exact', ids })
    }
    const rel = d.copyRelations(groups, photos)
    let m = d.planMarks(groups, photos, [], rel)
    for (const r of rel) m = d.mergeMarks(m, d.marksForCopy(r.copy, r.withSub, groups, photos)).marks
    for (const g of groups) assert.ok(g.ids.some((i) => !m.has(i)), `runda ${round}`)
    for (const [, keep] of m) assert.ok(!m.has(keep))
  }
})
