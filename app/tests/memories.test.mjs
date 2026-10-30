// Testy wspomnień „tego dnia”: dopasowanie dnia roku, rok przestępny, pomijanie zdjęć bez daty i przykładowych.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/memories.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const mem = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const photo = (id, taken) => ({ id, taken })

test('zdjęcia z tego samego dnia w poprzednich latach są grupowane po roku, od najnowszego', () => {
  const photos = [
    photo(1, '2023-10-30 12:00:00'), photo(2, '2023:10:30 09:00:00'), photo(3, '2021-10-30 08:00:00'),
    photo(4, '2023-10-29 12:00:00'), photo(5, '2023-11-30 12:00:00'), photo(6, '2026-10-30 12:00:00'),
  ]
  const r = mem.memoriesFor(photos, new Date(2026, 9, 30))
  assert.deepEqual(r, [{ year: 2023, ids: [1, 2] }, { year: 2021, ids: [3] }])
})

test('zdjęcia bez daty, z błędną datą, przykładowe i z przyszłości są pomijane', () => {
  const photos = [photo(1, null), photo(2, 'brak'), photo(3, '2024-13-40 00:00:00'), photo(-4, '2020-10-30 12:00:00'), photo(5, '2027-10-30 12:00:00'), photo(6, '1850-10-30 12:00:00')]
  assert.deepEqual(mem.memoriesFor(photos, new Date(2026, 9, 30)), [])
})

test('29 lutego wypada 28 lutego w roku, który nie jest przestępny, a w przestępnym zostaje 29 lutego', () => {
  const photos = [photo(1, '2020-02-29 12:00:00'), photo(2, '2021-02-28 12:00:00')]
  assert.deepEqual(mem.memoriesFor(photos, new Date(2027, 1, 28)).map((m) => m.ids), [[2], [1]])
  assert.deepEqual(mem.memoriesFor(photos, new Date(2028, 1, 29)).map((m) => m.ids), [[1]])
  assert.deepEqual(mem.memoriesFor(photos, new Date(2028, 1, 28)).map((m) => m.ids), [[2]])
})

test('etykiety: dzień po polsku i odmiana „lat temu”', () => {
  assert.equal(mem.dayLabel(new Date(2026, 9, 30)), '30 października')
  assert.equal(mem.dayLabel(new Date(2026, 4, 1)), '1 maja')
  const now = new Date(2026, 9, 30)
  assert.equal(mem.yearsAgo(now, 2025), '1 rok temu')
  assert.equal(mem.yearsAgo(now, 2023), '3 lata temu')
  assert.equal(mem.yearsAgo(now, 2021), '5 lat temu')
  assert.equal(mem.yearsAgo(now, 2014), '12 lat temu')
  assert.equal(mem.yearsAgo(now, 2004), '22 lata temu')
  assert.equal(mem.dayKey(new Date(2026, 0, 5)), '2026-01-05')
})
