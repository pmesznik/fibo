// Testy czystej logiki efektów obrazu (bez przeglądarki): odcień, czerń i biel z filtrem, zostawianie jednego koloru.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/editor/effects.ts', import.meta.url)), 'utf8')
const opts = { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
const dataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
// effects.ts importuje ./tone, więc najpierw wczytujemy tone.ts i podstawiamy jego adres.
const toneUrl = dataUrl(ts.transpileModule(readFileSync(fileURLToPath(new URL('../src/editor/tone.ts', import.meta.url)), 'utf8'), opts).outputText)
const inpaintUrl = dataUrl(ts.transpileModule(readFileSync(fileURLToPath(new URL('../src/editor/inpaint.ts', import.meta.url)), 'utf8'), opts).outputText)
const geomUrl = dataUrl(ts.transpileModule(readFileSync(fileURLToPath(new URL('../src/editor/geom.ts', import.meta.url)), 'utf8'), opts).outputText)
const js = ts.transpileModule(src, opts).outputText.replace("'./tone'", JSON.stringify(toneUrl)).replace("'./geom'", JSON.stringify(geomUrl)).replace("'./inpaint'", JSON.stringify(inpaintUrl))
const mod = await import(dataUrl(js))

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

/** Obraz w skali szarości z funkcji (x, y) → jasność. */
const gray = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const v = f(x, y); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 } return { d, w, h } }
const at = (img, x, y) => img.d[(y * img.w + x) * 4]

test('redukcja szumu wygładza drobny szum, a krawędź zostaje ostra', () => {
  // Lewa połowa ciemna z szumem ±6, prawa jasna z szumem ±6, między nimi ostra krawędź.
  const noise = (x, y) => ((x * 7 + y * 13) % 5) * 3 - 6
  const img = gray(40, 20, (x, y) => (x < 20 ? 60 : 200) + noise(x, y))
  const variance = (im, x0, x1) => { let s = 0, n = 0; for (let y = 4; y < 16; y++) for (let x = x0; x < x1; x++) { const v = at(im, x, y); s += v; n++ } const m = s / n; let q = 0; for (let y = 4; y < 16; y++) for (let x = x0; x < x1; x++) q += (at(im, x, y) - m) ** 2; return q / n }
  const before = variance(img, 4, 16)
  const out = gray(40, 20, (x, y) => at(img, x, y))
  mod.EFFECT_BY_ID.get('denoise').fn(out, 1)
  assert.ok(variance(out, 4, 16) < before * 0.6, `szum maleje: ${before} -> ${variance(out, 4, 16)}`)
  assert.ok(at(out, 25, 10) - at(out, 14, 10) > 110, 'krawędź zostaje wyraźna')
})

test('rozmycie poza środkiem zostawia środek bez zmian, a brzegi rozmywa', () => {
  const img = gray(60, 60, (x, y) => ((x + y) % 2 === 0 ? 0 : 255))
  const copy = gray(60, 60, (x, y) => at(img, x, y))
  mod.EFFECT_BY_ID.get('radialblur').fn(copy, 1)
  assert.equal(at(copy, 30, 30), at(img, 30, 30), 'środek bez zmian')
  assert.ok(Math.abs(at(copy, 1, 1) - 127) < Math.abs(at(img, 1, 1) - 127), 'brzeg jest bardziej szary, czyli rozmyty')
})

test('przechylenie i przesunięcie zostawia pas środkowy ostry', () => {
  const img = gray(40, 40, (x) => (x % 2 === 0 ? 0 : 255))
  const copy = gray(40, 40, (x, y) => at(img, x, y))
  mod.EFFECT_BY_ID.get('tiltshift').fn(copy, 1)
  assert.equal(at(copy, 10, 20), at(img, 10, 20), 'środek bez zmian')
  assert.notEqual(at(copy, 10, 1), at(img, 10, 1), 'góra jest rozmyta')
})

/** Obraz w x h z jednolitym kolorem i opcjonalnym jaśniejszym środkiem, do sprawdzania masek radialnych. */
const flat = (w, h, fill) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255 } return { d, w, h } }
const pixelAt = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2]] }

test('odcień z wyboru koloru: jasność zostaje, barwa idzie w stronę wybranego koloru', () => {
  const a = run('tint', 200, 200, 200)
  assert.ok(a[0] > a[2], `domyślny ciepły odcień: ${a}`)
  const img = px(180, 180, 180)
  mod.EFFECT_BY_ID.get('tint').fn(img, 1, { color: '#3060ff' })
  const [r, g, b] = [...img.d]
  assert.ok(b > r && b > g, `niebieski odcień: ${[r, g, b]}`)
  const lum = (x, y, z) => 0.299 * x + 0.587 * y + 0.114 * z
  assert.ok(Math.abs(lum(r, g, b) - 180 * 0.9 - 180 * 0.1) < 30, 'jasność w przybliżeniu zachowana')
  // Zły zapis koloru nie psuje efektu.
  const bad = px(100, 100, 100); mod.EFFECT_BY_ID.get('tint').fn(bad, 1, { color: 'nie-kolor' })
  assert.ok([...bad.d].every((v) => Number.isFinite(v)))
  assert.deepEqual(mod.parseColor('#ff0080', [1, 2, 3]), [255, 0, 128])
  assert.deepEqual(mod.parseColor('ff0080', [1, 2, 3]), [1, 2, 3])
})

test('czerń i biel z ogniskiem: ognisko zostaje w kolorze tam, gdzie wskazano środek, a rozmiar je powiększa', () => {
  const make = () => flat(40, 20, [220, 40, 40])
  const left = make(); mod.EFFECT_BY_ID.get('focalbw').fn(left, 1, { cx: 0.1, cy: 0.5 })
  assert.ok(pixelAt(left, 3, 10)[0] - pixelAt(left, 3, 10)[1] > 120, 'przy środku w lewej części lewy brzeg jest kolorowy')
  const farRight = pixelAt(left, 38, 10)
  assert.ok(Math.abs(farRight[0] - farRight[1]) < 40, `prawy brzeg jest szary: ${farRight}`)
  const small = make(); mod.EFFECT_BY_ID.get('focalbw').fn(small, 1, { size: 0.4 })
  const big = make(); mod.EFFECT_BY_ID.get('focalbw').fn(big, 1, { size: 2 })
  const sat = (p) => p[0] - p[1]
  assert.ok(sat(pixelAt(big, 30, 10)) > sat(pixelAt(small, 30, 10)), 'większe ognisko zostawia więcej koloru')
  // Bez ustawień wynik jest taki sam jak dawniej: środek kadru zostaje kolorowy, rogi szare.
  const def = make(); mod.EFFECT_BY_ID.get('focalbw').fn(def, 1)
  assert.ok(sat(pixelAt(def, 20, 10)) > 150 && sat(pixelAt(def, 0, 0)) < sat(pixelAt(def, 20, 10)))
})

test('efekty z opcjami wymieniają je w opts, a pozostałe ich nie mają', () => {
  const by = (id) => mod.EFFECT_BY_ID.get(id)
  for (const id of ['softfocus', 'focalbw', 'radialblur', 'vignette']) assert.deepEqual(by(id).opts, ['center', 'size'], id)
  for (const id of ['tint', 'gradtint']) assert.deepEqual(by(id).opts, ['color'], id)
  assert.equal(by('sepia').opts, undefined)
})
