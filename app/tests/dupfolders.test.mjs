// Testy duplikatów katalogów: pary katalogów o wspólnych zdjęciach, kolejność od 100% w dół i bezpieczne zaznaczanie kopii.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/dupFolders.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const d = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let id = 0
const ph = (dir, n) => Array.from({ length: n }, () => ({ id: ++id, path: `${dir}\\f${id}.jpg` }))

test('katalogi z tymi samymi zdjęciami to 100%, a katalog z dodatkowym zdjęciem nie jest identyczny', () => {
  id = 0
  const A = ph('C:\\A', 4), B = ph('C:\\B', 4), C = ph('C:\\C', 5), E = ph('C:\\E', 2)
  // Grupy: A_i = B_i = C_i; C ma jeszcze jedno własne zdjęcie.
  const groups = A.map((p, i) => ({ kind: 'exact', ids: [p.id, B[i].id, C[i].id] }))
  const pairs = d.folderPairs(groups, [...A, ...B, ...C, ...E])
  const ab = pairs.find((p) => p.a === 'C:\\A' && p.b === 'C:\\B')
  assert.equal(ab.kind, 'identical'); assert.equal(ab.percent, 100); assert.equal(ab.exact, true)
  const ac = pairs.find((p) => p.a === 'C:\\A' && p.b === 'C:\\C')
  assert.equal(ac.kind, 'subset'); assert.equal(ac.inside, 'a'); assert.ok(ac.percent < 100)
  assert.ok(!pairs.some((p) => p.a === 'C:\\E' || p.b === 'C:\\E'), 'katalog bez duplikatów nie jest na liście')
})

test('kolejność: identyczne na górze, potem jeden w drugim, potem pozostałe od najwyższej zgodności w dół', () => {
  id = 0
  const A = ph('X:\\A', 4), B = ph('X:\\B', 4)              // identyczne
  const P = ph('X:\\P', 2), Q = ph('X:\\Q', 5)              // P w całości w Q
  const M = ph('X:\\M', 4), N = ph('X:\\N', 4)              // 3 wspólne z 5 różnych = 60%
  const groups = [
    ...A.map((p, i) => ({ kind: 'exact', ids: [p.id, B[i].id] })),
    ...P.map((p, i) => ({ kind: 'exact', ids: [p.id, Q[i].id] })),
    ...M.slice(0, 3).map((p, i) => ({ kind: 'exact', ids: [p.id, N[i].id] })),
  ]
  const pairs = d.folderPairs(groups, [...A, ...B, ...P, ...Q, ...M, ...N])
  assert.deepEqual(pairs.map((p) => p.kind), ['identical', 'subset', 'similar'])
  assert.equal(pairs[0].percent, 100)
  assert.equal(pairs[2].percent, 60)
  assert.ok(pairs[1].percent >= 28 && pairs[1].percent < 100)
})

test('słabe pary (jedno wspólne zdjęcie albo mała zgodność) są pomijane, a podobne (nie identyczne pliki) mają exact = false', () => {
  id = 0
  const A = ph('Z:\\A', 10), B = ph('Z:\\B', 10)
  assert.equal(d.folderPairs([{ kind: 'exact', ids: [A[0].id, B[0].id] }], [...A, ...B]).length, 0, 'jedno wspólne zdjęcie')
  const groups = A.slice(0, 3).map((p, i) => ({ kind: 'exact', ids: [p.id, B[i].id] }))
  assert.equal(d.folderPairs(groups, [...A, ...B]).length, 0, '3 z 17 to za mało')
  const C = ph('Z:\\C', 3), D = ph('Z:\\D', 3)
  const sim = d.folderPairs(C.map((p, i) => ({ kind: 'similar', ids: [p.id, D[i].id] })), [...C, ...D])
  assert.equal(sim[0].exact, false); assert.equal(sim[0].kind, 'identical')
})

test('zdjęcia do usunięcia z katalogu to jego kopie, które mają odpowiednik w drugim katalogu', () => {
  id = 0
  const A = ph('Q:\\A', 3), B = ph('Q:\\B', 2), other = ph('Q:\\O', 1)
  const groups = [{ kind: 'exact', ids: [A[0].id, B[0].id] }, { kind: 'exact', ids: [A[1].id, B[1].id, other[0].id] }]
  const photos = [...A, ...B, ...other]
  assert.deepEqual(d.redundantIn('Q:\\A', 'Q:\\B', groups, photos), [A[0].id, A[1].id])
  assert.deepEqual(d.redundantIn('Q:\\B', 'Q:\\A', groups, photos), [B[0].id, B[1].id])
  assert.deepEqual(d.redundantIn('Q:\\O', 'Q:\\B', groups, photos), [other[0].id])
  assert.equal(d.dirOfPath('C:\\x\\y\\a.jpg'), 'C:\\x\\y')
})
