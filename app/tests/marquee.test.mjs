// Testy zaznaczania prostokątem: które kafelki przecina prostokąt i jak łączy się to z dotychczasowym zaznaczeniem.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Bierzemy tylko czyste funkcje (bez importu modułu przeciągania, który działa na oknie przeglądarki).
let src = readFileSync(fileURLToPath(new URL('../src/marquee.ts', import.meta.url)), 'utf8')
src = src.slice(src.indexOf('/** Kafelek w układzie'), src.indexOf('export function beginMarquee'))
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const m = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

// Siatka 3 kolumny po 100 px z odstępem 10 px, dwa rzędy.
const boxes = []
for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) boxes.push({ id: r * 3 + c + 1, x0: c * 110, y0: r * 110, x1: c * 110 + 100, y1: r * 110 + 100 })

test('prostokąt zaznacza kafelki, które przecina, w dowolnym kierunku przeciągania', () => {
  assert.deepEqual(m.hits(boxes, { x: 50, y: 50 }, { x: 160, y: 60 }), [1, 2])
  assert.deepEqual(m.hits(boxes, { x: 160, y: 160 }, { x: 50, y: 50 }), [1, 2, 4, 5], 'od prawego dołu do lewej góry')
  assert.deepEqual(m.hits(boxes, { x: 102, y: 0 }, { x: 108, y: 210 }), [], 'sam odstęp między kafelkami')
})

test('z Ctrl prostokąt dodaje do zaznaczenia, bez Ctrl je zastępuje', () => {
  assert.deepEqual(m.combine([7, 1], [1, 2], true), [7, 1, 2])
  assert.deepEqual(m.combine([7, 1], [1, 2], false), [1, 2])
})
