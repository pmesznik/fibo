// Testy geometrii edytora: perspektywa, grot strzałki, automatyczne prostowanie horyzontu.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/editor/geom.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const g = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const img = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 } return { d, w, h } }

test('perspektywa: zero nic nie zmienia, a pionowa korekta rozciąga górę (środek zostaje, rogi bez czarnych pasów)', () => {
  const a = img(40, 40, (x) => (x % 8 < 4 ? 40 : 220))
  assert.equal(g.warpPerspective(a, 0, 0), a)
  const out = g.warpPerspective(a, 60, 0)
  assert.equal(out.w, 40); assert.equal(out.h, 40)
  assert.ok(out.d.every((v, i) => i % 4 === 3 ? v === 255 : v >= 30 && v <= 230), 'brak czarnych pikseli z poza obrazu')
  // Środkowy wiersz zmienia się najmniej: w nim skala poziomu wynosi 1 (tylko przybliżenie), a na górze i na dole zmiana jest większa.
  const row = (im, y) => Array.from({ length: 40 }, (_, x) => im.d[(y * 40 + x) * 4])
  const diff = (r1, r2) => r1.reduce((s, v, i) => s + Math.abs(v - r2[i]), 0)
  assert.ok(diff(row(out, 2), row(a, 2)) > diff(row(out, 20), row(a, 20)) * 0.9)
})

test('grot strzałki leży za końcem odcinka, po obu stronach osi', () => {
  const [p, q] = g.arrowHead([0, 0], [100, 0], 20)
  assert.ok(p[0] < 100 && q[0] < 100 && p[0] > 70)
  assert.ok(p[1] * q[1] < 0 && Math.abs(p[1] + q[1]) < 1e-9)
})

test('prostowanie horyzontu: wykrywa nachylenie linii i zwraca kąt naprawczy o przeciwnym znaku', () => {
  const tilt = (deg) => { const m = Math.tan((deg * Math.PI) / 180); return img(320, 240, (x, y) => (y > 120 + m * (x - 160) ? 220 : 40)) }
  const down = g.detectHorizonAngle(tilt(5))   // linia opada w prawo (zgodnie z ruchem wskazówek zegara)
  const up = g.detectHorizonAngle(tilt(-4))
  assert.ok(down !== null && Math.abs(down - -5) < 1, `opadająca w prawo: ${down}`)
  assert.ok(up !== null && Math.abs(up - 4) < 1, `wznosząca się: ${up}`)
  assert.equal(g.detectHorizonAngle(tilt(0)), null, 'równa linia nie wymaga prostowania')
  assert.equal(g.detectHorizonAngle(img(320, 240, () => 128)), null, 'gładki obraz nie ma linii')
  assert.equal(g.detectHorizonAngle(img(10, 10, () => 0)), null)
})
