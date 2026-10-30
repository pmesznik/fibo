// Testy widoku kalendarza biblioteki: grupowanie zdjęć po dniu, liczniki miesięcy, lata i miesiąc startowy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/dayIndex.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const d = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const photo = (id, taken, modified = 0) => ({ id, taken, modified })

test('dzień bierze się z daty EXIF (z dwukropkami albo myślnikami), a bez niej z daty pliku', () => {
  assert.equal(d.dayKey(photo(1, '2023:07:14 10:00:00')), '2023-07-14')
  assert.equal(d.dayKey(photo(2, '2023-07-14 10:00:00')), '2023-07-14')
  const t = new Date(2020, 4, 3, 12).getTime() / 1000
  assert.equal(d.dayKey(photo(3, null, t)), '2020-05-03')
  assert.equal(d.dayKey(photo(4, 'brak', t)), '2020-05-03')
})

test('zdjęcia są grupowane po dniu, najwcześniejsze pierwsze, a przykładowe (id ujemne) pomijane', () => {
  const idx = d.indexByDay([photo(1, '2023-07-14 18:00:00'), photo(2, '2023-07-14 08:00:00'), photo(3, '2023-07-15 08:00:00'), photo(-4, '2023-07-14 09:00:00')])
  assert.deepEqual(idx.get('2023-07-14').map((p) => p.id), [2, 1])
  assert.equal(idx.size, 2)
})

test('liczniki miesięcy, lata i miesiąc startowy', () => {
  const idx = d.indexByDay([photo(1, '2023-07-14 10:00:00'), photo(2, '2023-07-20 10:00:00'), photo(3, '2021-01-02 10:00:00'), photo(4, '2024-02-29 10:00:00')])
  const c = d.monthCounts(idx, 2023)
  assert.equal(c[6], 2)
  assert.equal(c.reduce((a, b) => a + b, 0), 2)
  assert.deepEqual(d.yearsWithPhotos(idx), [2024, 2021, 2023].sort((a, b) => b - a))
  assert.deepEqual(d.latestMonth(idx), { year: 2024, month: 2 })
  assert.deepEqual(d.latestMonth(new Map(), new Date(2026, 9, 30)), { year: 2026, month: 10 })
  assert.equal(d.keyOf(2024, 2, 9), '2024-02-09')
})
