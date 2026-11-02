// Testy wyboru monitoru dla pokazu slajdów: który monitor zawiera punkt i który jest następny.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/monitors.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const m = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const box = (x, y, width, height) => ({ position: { x, y }, size: { width, height } })
// Główny 1920x1080 i drugi po lewej (ujemne współrzędne), jak w Windows.
const two = [box(0, 0, 1920, 1080), box(-1280, 0, 1280, 1024)]

test('punkt trafia na monitor, na którym leży, także przy ujemnych współrzędnych', () => {
  assert.equal(m.monitorAt(two, { x: 500, y: 300 }), 0)
  assert.equal(m.monitorAt(two, { x: -400, y: 300 }), 1)
  assert.equal(m.monitorAt(two, { x: 1920, y: 10 }), 0, 'poza wszystkimi: pierwszy monitor')
})

test('kolejny monitor idzie po kolei i wraca do pierwszego', () => {
  assert.equal(m.nextMonitor(2, 0), 1)
  assert.equal(m.nextMonitor(2, 1), 0)
  assert.equal(m.nextMonitor(3, 2), 0)
  assert.equal(m.nextMonitor(0, 0), 0)
})
