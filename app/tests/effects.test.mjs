// Testy czystej logiki efektów obrazu (bez przeglądarki): odcień, czerń i biel z filtrem, zostawianie jednego koloru.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/editor/effects.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const px = (r, g, b) => ({ d: new Uint8ClampedArray([r, g, b, 255]), w: 1, h: 1 })
const run = (id, r, g, b, t = 1) => { const img = px(r, g, b); mod.EFFECT_BY_ID.get(id).fn(img, t); return [...img.d].slice(0, 3) }

test('odcień: czerwony 0, zielony 120, niebieski 240, szarość bez odcienia', () => {
  assert.equal(mod.hueOf(255, 0, 0), 0)
  assert.equal(mod.hueOf(0, 255, 0), 120)
  assert.equal(mod.hueOf(0, 0, 255), 240)
  assert.equal(mod.hueOf(100, 100, 100), -1)
})

test('„Tylko czerwony” zostawia czerwień, a zieleń zamienia na szarość', () => {
  const red = run('keepred', 220, 20, 20)
  assert.ok(red[0] > 200 && red[1] < 40, `czerwony: ${red}`)
  const green = run('keepred', 20, 200, 20)
  assert.ok(Math.abs(green[0] - green[1]) < 3 && Math.abs(green[1] - green[2]) < 3, `zielony ma być szary: ${green}`)
})

test('czerń i biel z filtrem czerwonym rozjaśnia czerwień bardziej niż błękit', () => {
  const r = run('bwred', 255, 0, 0)[0]
  const b = run('bwred', 0, 0, 255)[0]
  assert.ok(r > 150 && b < 30, `r=${r} b=${b}`)
  const channels = run('bwgreen', 10, 200, 30)
  assert.equal(channels[0], channels[1])
})

test('wszystkie nowe efekty mają unikalne identyfikatory i etykiety', () => {
  const ids = [...mod.EFFECT_BY_ID.keys()]
  assert.equal(new Set(ids).size, mod.EFFECTS.length)
  for (const id of ['bwred', 'bwyellow', 'bwgreen', 'keepred', 'keepyellow', 'keepgreen', 'keepblue']) assert.ok(ids.includes(id), id)
})

test('retusz zamalowuje ciemną plamę kolorem otoczenia i nie rusza dalekich pikseli', () => {
  const w = 60, h = 60
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < d.length; i += 4) { d[i] = 120; d[i + 1] = 130; d[i + 2] = 140; d[i + 3] = 255 }
  for (let y = 27; y <= 32; y++) for (let x = 27; x <= 32; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 5 }
  mod.healSpot({ d, w, h }, { x: 0.5, y: 0.5, r: 0.08 })
  const c = (30 * w + 30) * 4
  assert.ok(Math.abs(d[c] - 120) < 3 && Math.abs(d[c + 1] - 130) < 3 && Math.abs(d[c + 2] - 140) < 3, `środek plamy: ${[d[c], d[c + 1], d[c + 2]]}`)
  const far = (2 * w + 2) * 4
  assert.equal(d[far], 120)
})

test('retusz przy krawędzi zdjęcia nie wychodzi poza obraz', () => {
  const d = new Uint8ClampedArray(20 * 20 * 4).fill(100)
  assert.doesNotThrow(() => mod.healSpot({ d, w: 20, h: 20 }, { x: 0, y: 0, r: 0.2 }))
  assert.doesNotThrow(() => mod.healSpot({ d, w: 20, h: 20 }, { x: 1, y: 1, r: 0.2 }))
})
