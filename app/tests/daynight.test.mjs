// Testy obliczeń Słońca używanych do rysowania dnia i nocy na mapie.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/daynight.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const deg = (r) => (r * 180) / Math.PI

test('deklinacja w przesilenie letnie to ok. +23,4°', () => {
  assert.ok(Math.abs(deg(mod.sunPosition(new Date('2026-06-21T12:00:00Z')).dec) - 23.44) < 0.1)
})

test('deklinacja w równonoc jest bliska 0°', () => {
  assert.ok(Math.abs(deg(mod.sunPosition(new Date('2026-03-20T15:46:00Z')).dec)) < 0.2)
})

test('w południe UTC Słońce jest nad okolicą południka zerowego', () => {
  assert.ok(Math.abs(mod.sunPosition(new Date('2026-03-20T12:00:00Z')).lon) < 4)
})

test('Warszawa: dzień w południe, noc o północy (21 czerwca)', () => {
  assert.ok(mod.sunAltitudeDeg(52.23, 21.01, new Date('2026-06-21T10:00:00Z')) > 40)
  assert.ok(mod.sunAltitudeDeg(52.23, 21.01, new Date('2026-06-21T23:00:00Z')) < 0)
})

test('przezroczystość nocy rośnie monotonicznie od dnia do pełnej nocy', () => {
  let prev = -1
  for (let a = 30; a >= -30; a--) {
    const v = mod.nightAlpha(Math.sin((a * Math.PI) / 180))
    assert.ok(v >= prev - 1e-9)
    prev = v
  }
  assert.equal(mod.nightAlpha(Math.sin((30 * Math.PI) / 180)), 0)
  assert.ok(Math.abs(mod.nightAlpha(Math.sin((-30 * Math.PI) / 180)) - 0.68) < 1e-9)
})
