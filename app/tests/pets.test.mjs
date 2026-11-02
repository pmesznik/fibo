// Testy podziału zdjęć na psy i koty na podstawie wyników szukania po treści.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/pets.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const p = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('zdjęcie trafia do psów albo kotów, wyższy wynik wygrywa', () => {
  const dog = { ids: [1, 2, 3], scores: [0.30, 0.27, 0.22] }
  const cat = { ids: [2, 3, 4], scores: [0.24, 0.28, 0.31] }
  const r = p.splitPets(dog, cat, 0.25)
  assert.deepEqual(r.dogs, [1, 2], 'pies: 1 (0,30) i 2 (0,27 wobec 0,24 kota)')
  assert.deepEqual(r.cats, [4, 3], 'kot: 4 (0,31) i 3 (0,28 wobec 0,22 psa), od najpewniejszego')
})

test('poniżej progu zdjęcie nie jest zwierzęciem', () => {
  const r = p.splitPets({ ids: [1], scores: [0.2] }, { ids: [2], scores: [0.24] }, 0.25)
  assert.deepEqual(r, { dogs: [], cats: [] })
})

test('niemal remis psa i kota nie trafia do żadnej grupy', () => {
  const r = p.splitPets({ ids: [1], scores: [0.300] }, { ids: [1], scores: [0.305] }, 0.25)
  assert.deepEqual(r, { dogs: [], cats: [] })
})

test('imię zwierzaka jako tag: spacje są porządkowane, puste imię to brak tagu', () => {
  assert.equal(p.petTag('  Burek   Mały '), 'Burek Mały')
  assert.equal(p.petTag('   '), null)
  assert.equal(p.petTag('x'.repeat(60))?.length, 40)
})
