// Testy flag selekcji i etykiet kolorowych: przełączanie klawiszem i filtr.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/marks.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const m = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('klawisz ustawia wartość, a powtórzony na tych samych zdjęciach ją zdejmuje', () => {
  assert.equal(m.nextMark([0, 0], 1), 1)
  assert.equal(m.nextMark([1, 1, 1], 1), 0, 'wszystkie już wybrane: zdejmujemy')
  assert.equal(m.nextMark([1, 0, 1], 1), 1, 'część wybrana: dopełniamy')
  assert.equal(m.nextMark([-1], 1), 1, 'z odrzuconego na wybrane')
  assert.equal(m.nextMark([1, -1], 0), 0, 'U zawsze czyści')
  assert.equal(m.nextMark([], 2), 2)
})

test('filtr flagi: wybrane, odrzucone i „bez odrzuconych”; brak pola to brak flagi', () => {
  const ph = [{ flag: 1 }, { flag: -1 }, { flag: 0 }, {}]
  const f = (filter) => ph.filter((p) => m.passesFlag(p, filter)).length
  assert.deepEqual([f(''), f('pick'), f('reject'), f('keep')], [4, 1, 1, 3])
})

test('etykiety mają cztery kolory i klawisze od 6 do 9, w kolejności zgodnej z XMP', () => {
  assert.deepEqual(m.LABELS.map((l) => l.key), ['6', '7', '8', '9'])
  assert.deepEqual(m.LABELS.map((l) => l.name), ['czerwona', 'żółta', 'zielona', 'niebieska'])
  assert.equal(m.labelOf({}), 0)
})
