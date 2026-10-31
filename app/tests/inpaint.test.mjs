// Testy usuwania obiektów: wypełnianie zamalowanego obszaru fragmentami z otoczenia.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/editor/inpaint.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const ip = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

/** Wzór: ukośne pasy w kilku kolorach. */
const pattern = (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const s = Math.floor((x + y) / 6) % 3; d[i] = [200, 60, 90][s]; d[i + 1] = [80, 180, 90][s]; d[i + 2] = [60, 70, 210][s]; d[i + 3] = 255 } return { d, w, h } }
const err = (a, b, mask) => { let e = 0, n = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) { for (let c = 0; c < 3; c++) e += Math.abs(a.d[i * 4 + c] - b.d[i * 4 + c]); n += 3 } return e / n }

test('maska z kropli pędzla: koło o zadanym promieniu, poza obrazem i błędne wartości są bezpieczne', () => {
  const m = ip.maskFromDabs([{ x: 0.5, y: 0.5, r: 0.1 }], 100, 50)
  assert.equal(m[25 * 100 + 50], 1)
  assert.equal(m[25 * 100 + 50 + 6], 0, 'r = 0,1 krótszego boku (50) to 5 px')
  assert.ok(m.reduce((a, b) => a + b, 0) > 60 && m.reduce((a, b) => a + b, 0) < 100)
  assert.equal(ip.maskFromDabs([{ x: NaN, y: 0.5, r: 0.1 }, { x: 5, y: 5, r: 0.1 }], 20, 20).reduce((a, b) => a + b, 0), 0)
})

test('wypełnianie odtwarza wzór lepiej niż jednolity kolor, a piksele poza maską nie zmieniają się', () => {
  const orig = pattern(120, 90)
  const work = { d: new Uint8ClampedArray(orig.d), w: orig.w, h: orig.h }
  const mask = new Uint8Array(120 * 90)
  for (let y = 38; y < 54; y++) for (let x = 50; x < 70; x++) mask[y * 120 + x] = 1
  for (let i = 0; i < mask.length; i++) if (mask[i]) { work.d[i * 4] = 0; work.d[i * 4 + 1] = 0; work.d[i * 4 + 2] = 0 }
  const outside = Array.from(work.d)
  const filled = ip.inpaintCore(work, mask)
  assert.ok(filled >= 16 * 20)
  const mean = { d: new Uint8ClampedArray(orig.d.length), w: 120, h: 90 }
  for (let i = 0; i < mask.length; i++) { mean.d[i * 4] = 120; mean.d[i * 4 + 1] = 110; mean.d[i * 4 + 2] = 120 }
  const e = err(work, orig, mask), eMean = err(mean, orig, mask)
  assert.ok(e < eMean * 0.6, `wypełnienie ${e.toFixed(1)} vs jednolity kolor ${eMean.toFixed(1)}`)
  // Daleko od maski nic się nie zmieniło.
  assert.ok(work.d.every((v, i) => { const p = i >> 2; const x = p % 120, y = (p / 120) | 0; return (x >= 46 && x <= 74 && y >= 34 && y <= 58) || v === outside[i] }))
})

test('removeObjects: duży obraz jest wypełniany na zmniejszonej kopii, wynik wraca tylko w maskę; brak kropli nic nie zmienia', () => {
  const big = pattern(1500, 1100)
  const before = new Uint8ClampedArray(big.d)
  assert.equal(ip.removeObjects(big, []), 0)
  assert.deepEqual(Array.from(big.d.slice(0, 400)), Array.from(before.slice(0, 400)))
  const n = ip.removeObjects(big, [{ x: 0.5, y: 0.5, r: 0.04 }, { x: 0.52, y: 0.5, r: 0.04 }])
  assert.ok(n > 3000, `zmieniono ${n} pikseli`)
  let outsideChanged = 0
  for (let y = 0; y < 1100; y += 7) for (let x = 0; x < 1500; x += 7) { const i = (y * 1500 + x) * 4; if (Math.hypot(x - 750, y - 550) > 140 && big.d[i] !== before[i]) outsideChanged++ }
  assert.equal(outsideChanged, 0)
  // Kolory wypełnienia pochodzą z palety wzoru (żadnych czarnych dziur).
  const o = (550 * 1500 + 750) * 4
  assert.ok(big.d[o] + big.d[o + 1] + big.d[o + 2] > 150)
})
