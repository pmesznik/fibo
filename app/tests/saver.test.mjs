// Testy wygaszacza w programie: wybór czasu, warunki startu, mieszanie i ignorowanie drobnych drgnięć myszy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/saver.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const s = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('czas wygaszacza przechodzi po kolei i wraca do wyłączonego', () => {
  assert.equal(s.nextSaver(0), 5)
  assert.equal(s.nextSaver(5), 10)
  assert.equal(s.nextSaver(20), 0)
  assert.equal(s.nextSaver(7), 0, 'nieznana wartość wraca do wyłączonego')
  assert.equal(s.saverLabel(0), 'Wygaszacz: wyłączony')
  assert.equal(s.saverLabel(10), 'Wygaszacz: po 10 min')
})

test('wygaszacz startuje tylko po bezczynności, gdy nic nie jest otwarte i są zdjęcia', () => {
  const base = { minutes: 5, idleMs: 5 * 60_000, busy: false, photos: 3 }
  assert.equal(s.shouldStartSaver(base), true)
  assert.equal(s.shouldStartSaver({ ...base, idleMs: 5 * 60_000 - 1 }), false)
  assert.equal(s.shouldStartSaver({ ...base, minutes: 0 }), false)
  assert.equal(s.shouldStartSaver({ ...base, busy: true }), false)
  assert.equal(s.shouldStartSaver({ ...base, photos: 0 }), false)
})

test('mieszanie zachowuje elementy i nie zmienia wejścia', () => {
  const input = [1, 2, 3, 4, 5, 6]
  let n = 0
  const out = s.shuffled(input, () => (n++ % 7) / 7)
  assert.deepEqual([...out].sort(), input)
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6])
})

test('drobne drgnięcie myszy i ruch tuż po starcie nie kończą wygaszacza', () => {
  assert.equal(s.movedEnough(30, 0, 100), false, 'zaraz po starcie')
  assert.equal(s.movedEnough(3, 4, 5000), false, 'drgnięcie')
  assert.equal(s.movedEnough(20, 0, 5000), true)
})
