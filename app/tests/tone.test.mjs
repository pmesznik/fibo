// Testy zaawansowanych korekt tonalnych: krzywe, HSL, usuwanie mgły, klarowność, histogram.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/editor/tone.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const t = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y); const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255 } return { d, w, h } }
const px = (im, x, y) => Array.from(im.d.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 3))

test('krzywa bez punktów jest tożsamością, a krzywa S jest monotoniczna i przechodzi przez punkty', () => {
  const id = t.curveLut([])
  assert.ok(id.every((v, i) => v === i))
  const s = t.curveLut([[64, 40], [192, 215]])
  assert.equal(s[64], 40); assert.equal(s[192], 215); assert.equal(s[0], 0); assert.equal(s[255], 255)
  for (let i = 1; i < 256; i++) assert.ok(s[i] >= s[i - 1], `monotoniczność w ${i}`)
  assert.ok(s[128] > 120 && s[128] < 136, `środek prawie bez zmian: ${s[128]}`)
})

test('krzywe: punkty ze starego pliku są poprawiane, a krzywa kanału działa tylko na swój kanał', () => {
  assert.deepEqual(t.cleanPoints([[300, -5], [10, 10], [10, 20], ['x', 1], [1], null]), [[10, 20], [255, 0]])
  assert.equal(t.cleanPoints(Array.from({ length: 40 }, (_, i) => [i * 6, i * 6])).length, t.MAX_CURVE_POINTS)
  const a = img(2, 1, () => [100, 100, 100])
  t.applyCurves(a, { rgb: [], r: [[100, 180]], g: [], b: [] })
  assert.deepEqual(px(a, 0, 0), [180, 100, 100])
  const b = img(2, 1, () => [100, 100, 100])
  t.applyCurves(b, t.EMPTY_CURVES)
  assert.deepEqual(px(b, 0, 0), [100, 100, 100])
})

test('HSL: wagi zakresów sumują się do 1, zmiana czerwieni rusza czerwień, a zieleń i szarość zostają', () => {
  for (const h of [0, 15, 59, 120, 200, 281, 330, 359]) assert.ok(Math.abs(t.bandWeights(h).reduce((a, b) => a + b, 0) - 1) < 1e-9, `suma wag dla ${h}`)
  const im = img(3, 1, (x) => [[220, 40, 40], [40, 200, 60], [128, 128, 128]][x])
  const hsl = t.cleanHsl({}); hsl.sat[0] = -100
  t.applyHsl(im, hsl)
  const red = px(im, 0, 0)
  assert.ok(Math.max(...red) - Math.min(...red) < 120, `czerwień straciła nasycenie: ${red}`)
  assert.deepEqual(px(im, 1, 0), [40, 200, 60])
  assert.deepEqual(px(im, 2, 0), [128, 128, 128])
  assert.deepEqual(t.cleanHsl({ hue: [999, 'x'], sat: null }).hue.slice(0, 3), [100, 0, 0])
  assert.ok(t.hslIsIdentity(t.EMPTY_HSL))
})

test('usuwanie mgły zwiększa kontrast zamglonego obrazu, 0 nic nie zmienia, a ujemna wartość dodaje mgłę', () => {
  const make = () => img(60, 60, (x) => (x < 30 ? [150, 160, 170] : [190, 195, 200]))
  const spread = (im) => px(im, 50, 30)[0] - px(im, 5, 30)[0]
  const base = make(); const none = make(); t.applyDehaze(none, 0)
  assert.deepEqual(Array.from(none.d), Array.from(base.d))
  const clear = make(); t.applyDehaze(clear, 80)
  assert.ok(spread(clear) > spread(base), `kontrast ${spread(clear)} > ${spread(base)}`)
  const hazy = make(); t.applyDehaze(hazy, -80)
  assert.ok(spread(hazy) < spread(base))
})

test('klarowność wzmacnia lokalny kontrast w średnich tonach, a nie w czerni i bieli', () => {
  const mid = img(80, 80, (x) => (x % 8 < 4 ? [110, 110, 110] : [146, 146, 146]))
  const before = px(mid, 5, 40)[0] - px(mid, 1, 40)[0]
  t.applyClarity(mid, 80)
  assert.ok(px(mid, 5, 40)[0] - px(mid, 1, 40)[0] > before, 'różnica w średnich tonach rośnie')
  const white = img(80, 80, (x) => (x % 8 < 4 ? [250, 250, 250] : [255, 255, 255]))
  t.applyClarity(white, 80)
  assert.ok(px(white, 5, 40)[0] <= 255 && px(white, 1, 40)[0] >= 245)
})

test('histogram liczy piksele w przedziałach', () => {
  const im = img(4, 1, (x) => (x < 3 ? [10, 20, 30] : [255, 255, 255]))
  const h = t.histogram(im)
  assert.equal(h.r[10], 3); assert.equal(h.g[20], 3); assert.equal(h.b[30], 3); assert.equal(h.l[255], 1)
  assert.equal(h.r.reduce((a, b) => a + b, 0), 4)
})
