// Testy kolejności twarzy jednej osoby: według pewności, od najstarszych i od najnowszych zdjęć.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/faceSort.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const f = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const fileTime = (y, m, d) => new Date(y, m - 1, d, 12).getTime() / 1000
const cards = [
  { face: 1, taken: '2015:06:01 10:00:00', modified: 0 },
  { face: 2, taken: null, modified: 0 },
  { face: 3, taken: '2009-01-02 08:00:00', modified: 0 },
  { face: 4, taken: null, modified: fileTime(2012, 3, 4) },
  { face: 5, taken: '2021:12:24 18:00:00', modified: 0 },
]

test('od najstarszych i od najnowszych, data z aparatu albo data pliku; bez daty zawsze na końcu', () => {
  assert.deepEqual(f.sortFaces(cards, 'old').map((c) => c.face), [3, 4, 1, 5, 2])
  assert.deepEqual(f.sortFaces(cards, 'new').map((c) => c.face), [5, 1, 4, 3, 2])
})

test('kolejność „najpewniejsze” zostaje taka, jak podał program, a wejście się nie zmienia', () => {
  assert.deepEqual(f.sortFaces(cards, 'best').map((c) => c.face), [1, 2, 3, 4, 5])
  f.sortFaces(cards, 'new')
  assert.deepEqual(cards.map((c) => c.face), [1, 2, 3, 4, 5])
})

test('rok pod twarzą: z aparatu, z pliku albo brak', () => {
  assert.equal(f.faceYear(cards[0]), '2015')
  assert.equal(f.faceYear(cards[3]), '2012')
  assert.equal(f.faceYear(cards[1]), null)
})
