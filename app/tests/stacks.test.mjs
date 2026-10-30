// Testy stosów zdjęć: pary RAW + JPEG, serie zdjęć, wybór lidera i zwijanie listy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const read = (f) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8')
const compile = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
// stacks.ts importuje ./marks: podstawiamy je jako moduł z adresem data:, żeby uniknąć plików pośrednich.
const marks = 'data:text/javascript;base64,' + Buffer.from(compile(read('marks.ts'))).toString('base64')
const stacksJs = compile(read('stacks.ts')).replace("from './marks'", `from '${marks}'`)
const s = await import('data:text/javascript;base64,' + Buffer.from(stacksJs).toString('base64'))

let n = 0
const ph = (path, taken, extra = {}) => ({ id: ++n, path, name: path.split(/[\\/]/).pop(), taken, camera: 'A7', rating: 0, favorite: false, flag: 0, ...extra })

test('para RAW + JPEG o tej samej nazwie w jednym folderze tworzy stos z JPEG jako liderem', () => {
  const raw = ph('C:\\F\\IMG_1.ARW', '2024:05:01 10:00:00')
  const jpg = ph('C:\\F\\img_1.jpg', '2024:05:01 10:00:00')
  const other = ph('C:\\F\\IMG_2.jpg', '2024:05:01 12:00:00')
  const st = s.findStacks([raw, jpg, other])
  assert.equal(st.size, 2)
  assert.equal(st.get(raw.id), st.get(jpg.id))
  assert.equal(st.get(raw.id).kind, 'pair')
  assert.deepEqual(st.get(raw.id).ids, [jpg.id, raw.id], 'JPEG przed RAW')
  assert.equal(st.get(raw.id).leader, jpg.id)
  assert.equal(st.has(other.id), false)
})

test('te same nazwy w różnych folderach albo bez pliku RAW nie tworzą pary', () => {
  const a = ph('C:\\A\\IMG_1.jpg', '2024:05:01 10:00:00'), b = ph('C:\\B\\IMG_1.ARW', '2024:05:01 10:00:00')
  assert.equal(s.findStacks([a, b]).size, 0)
  const c = ph('C:\\A\\x.jpg', '2024:05:01 10:00:00'), d = ph('C:\\A\\x.png', '2024:05:01 10:00:00')
  assert.equal(s.findStacks([c, d]).size, 0, 'dwa pliki bez RAW to nie para RAW + JPEG')
})

test('seria: co najmniej trzy ujęcia z przerwą do 2 sekund; lider to najlepiej ocenione', () => {
  const shots = [0, 1, 2, 4].map((sec, i) => ph(`C:\\F\\S${i}.jpg`, `2024:05:01 10:00:0${sec}`, i === 2 ? { rating: 4 } : {}))
  const st = s.findStacks(shots)
  assert.equal(new Set(st.values()).size, 1)
  assert.equal(st.get(shots[0].id).kind, 'burst')
  assert.equal(st.get(shots[0].id).ids.length, 4)
  assert.equal(st.get(shots[0].id).leader, shots[2].id)
})

test('dwa zdjęcia po sobie, zbyt duża przerwa, inny aparat albo inny folder nie tworzą serii', () => {
  const two = [ph('C:\\F\\a.jpg', '2024:05:01 10:00:00'), ph('C:\\F\\b.jpg', '2024:05:01 10:00:01')]
  assert.equal(s.findStacks(two).size, 0)
  const gap = [0, 1, 6].map((x, i) => ph(`C:\\F\\g${i}.jpg`, `2024:05:01 10:00:0${x}`))
  assert.equal(s.findStacks(gap).size, 0, 'przerwa 5 s przerywa serię, zostają dwa zdjęcia')
  const cams = [0, 1, 2].map((x, i) => ph(`C:\\F\\c${i}.jpg`, `2024:05:01 10:00:0${x}`, { camera: i === 1 ? 'iPhone' : 'A7' }))
  assert.equal(s.findStacks(cams).size, 0)
  const dirs = [0, 1, 2].map((x, i) => ph(`C:\\F${i}\\d.jpg`, `2024:05:01 10:00:0${x}`))
  assert.equal(s.findStacks(dirs).size, 0)
  assert.equal(s.findStacks([ph('C:\\F\\n1.jpg', null), ph('C:\\F\\n2.jpg', null), ph('C:\\F\\n3.jpg', 'brak')]).size, 0, 'bez daty nie ma serii')
})

test('para RAW + JPEG liczy się w serii jako jedno ujęcie, a lider wybranego zdjęcia wygrywa z odrzuconym', () => {
  const mk = (i, sec) => [ph(`C:\\F\\P${i}.ARW`, `2024:05:01 10:00:0${sec}`), ph(`C:\\F\\P${i}.jpg`, `2024:05:01 10:00:0${sec}`)]
  const [r0, j0] = mk(0, 0), [r1, j1] = mk(1, 1), [r2, j2] = mk(2, 2)
  j1.flag = 1; j0.flag = -1
  const st = s.findStacks([r0, j0, r1, j1, r2, j2])
  const stack = st.get(r0.id)
  assert.equal(stack.ids.length, 6, 'trzy ujęcia po dwa pliki')
  assert.equal(stack.kind, 'burst')
  assert.equal(stack.leader, j1.id)
})

test('zwijanie: zwinięty stos pokazuje lidera, rozwinięty wszystkie zdjęcia; filtr może zostawić jedno zdjęcie', () => {
  const shots = [0, 1, 2].map((x, i) => ph(`C:\\F\\z${i}.jpg`, `2024:05:01 10:00:0${x}`))
  const solo = ph('C:\\F\\solo.jpg', '2025:01:01 10:00:00')
  const list = [solo, ...shots]
  const st = s.findStacks(list)
  const leader = st.get(shots[0].id).leader
  const closed = s.collapseStacks(list, st, new Set())
  assert.deepEqual(closed.list.map((p) => p.id), [solo.id, leader])
  assert.deepEqual(closed.badges.get(leader), { count: 3, open: false, kind: 'burst', leader: true })
  const open = s.collapseStacks(list, st, new Set([leader]))
  assert.equal(open.list.length, 4)
  assert.equal(open.list[1].id, leader, 'lider pierwszy')
  assert.equal(open.badges.get(shots.find((p) => p.id !== leader).id).leader, false)
  // Filtr zostawił tylko jedno zdjęcie stosu: pokazujemy je zwyczajnie, bez plakietki.
  const one = s.collapseStacks([shots[1]], st, new Set())
  assert.deepEqual(one.list.map((p) => p.id), [shots[1].id])
  assert.equal(one.badges.size, 0)
  // Lider odfiltrowany: stos reprezentuje pierwsze obecne zdjęcie.
  const rest = shots.filter((p) => p.id !== leader)
  const noLeader = s.collapseStacks(rest, st, new Set())
  assert.equal(noLeader.list.length, 1)
  assert.equal(s.stackCount(st), 1)
})
