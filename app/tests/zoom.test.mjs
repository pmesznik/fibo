// Testy powiększania miniatur (krok, granice) i przewijania przy krawędzi podczas przeciągania zdjęć.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const load = async (rel, strip) => {
  let src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  if (strip) src = strip(src)
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
}
// Z modułu z komponentem bierzemy tylko czystą funkcję (bez Reacta i ikon).
const zoom = await load('../src/Zoom.tsx', (s) => s.slice(s.indexOf('/** Następna wielkość'), s.indexOf('/** Pomniejsz, suwak')))
const drag = await load('../src/pointerDrag.ts')

test('krok powiększania trzyma się granic i siatki kroku', () => {
  assert.equal(zoom.stepZoom(200, 1, 120, 360, 20), 220)
  assert.equal(zoom.stepZoom(200, -1, 120, 360, 20), 180)
  assert.equal(zoom.stepZoom(355, 1, 120, 360, 20), 360, 'nie ponad maksimum')
  assert.equal(zoom.stepZoom(125, -1, 120, 360, 20), 120, 'nie poniżej minimum')
  assert.equal(zoom.stepZoom(150, 1, 90, 240, 15), 165)
})

test('przewijanie przy krawędzi: zero w środku, w górę przy górnej krawędzi, w dół przy dolnej, z limitem prędkości', () => {
  assert.equal(drag.edgeScrollSpeed(400, 80, 800), 0)
  assert.ok(drag.edgeScrollSpeed(100, 80, 800) < 0)
  assert.ok(drag.edgeScrollSpeed(790, 80, 800) > 0)
  assert.equal(drag.edgeScrollSpeed(-500, 80, 800), -28)
  assert.equal(drag.edgeScrollSpeed(5000, 80, 800), 28)
})
