// Testy fotoksiążki: podział na strony, układ pól na stronie i wpisywanie zdjęć w pola.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/bookLayout.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const b = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('podział na strony: suma zawsze równa liczbie zdjęć, reszta ląduje na ostatniej stronie', () => {
  for (const style of ['one', 'two', 'four', 'mixed']) for (const n of [0, 1, 2, 5, 7, 13, 40, 119]) {
    const p = b.paginate(n, style)
    assert.equal(p.reduce((a, c) => a + c, 0), n, `${style} ${n}`)
    assert.ok(p.every((c) => c >= 1 && c <= 4))
  }
  assert.deepEqual(b.paginate(5, 'two'), [2, 2, 1])
  assert.deepEqual(b.paginate(6, 'mixed'), [1, 3, 2])
  assert.deepEqual(b.paginate(3, 'one'), [1, 1, 1])
  assert.equal(b.bookPages(5, 'two', true), 4)
})

const inside = (r, W, H, m) => r.x >= m - 1e-9 && r.y >= m - 1e-9 && r.x + r.w <= W - m + 1e-9 && r.y + r.h <= H - m + 1e-9 && r.w > 0 && r.h > 0
const overlap = (a, c) => a.x < c.x + c.w - 1e-9 && c.x < a.x + a.w - 1e-9 && a.y < c.y + c.h - 1e-9 && c.y < a.y + a.h - 1e-9

test('układ pól: wszystkie w obrębie marginesów, bez nakładania, z odstępem, dla stron pionowych i poziomych', () => {
  for (const [W, H] of [[595, 842], [842, 595], [595, 595]]) for (const count of [1, 2, 3, 4]) {
    const cells = b.cellsFor(count, W, H, 30, 10)
    assert.equal(cells.length, count)
    cells.forEach((c) => assert.ok(inside(c, W, H, 30), `${W}x${H} ${count}`))
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(!overlap(cells[i], cells[j]), `nakładanie ${W}x${H} ${count}`)
  }
  assert.deepEqual(b.cellsFor(5, 100, 100, 5, 2), [])
  const two = b.cellsFor(2, 595, 842, 30, 10)
  assert.ok(Math.abs(two[1].y - (two[0].y + two[0].h) - 10) < 1e-9, 'odstęp między polami')
})

test('wpisywanie zdjęcia w pole: cover wypełnia pole bez zniekształceń, contain pokazuje całe zdjęcie wyśrodkowane', () => {
  const cell = { x: 10, y: 20, w: 200, h: 100 }
  const c = b.fitPhoto(400, 400, cell, 'cover')
  assert.deepEqual(c.dst, cell)
  assert.ok(Math.abs(c.src.w / c.src.h - 2) < 1e-9, 'proporcje wycinka jak pola')
  assert.ok(c.src.x >= 0 && c.src.y >= 0 && c.src.x + c.src.w <= 400 + 1e-9 && c.src.y + c.src.h <= 400 + 1e-9)
  const k = b.fitPhoto(400, 400, cell, 'contain')
  assert.deepEqual(k.src, { x: 0, y: 0, w: 400, h: 400 })
  assert.ok(Math.abs(k.dst.w - 100) < 1e-9 && Math.abs(k.dst.h - 100) < 1e-9)
  assert.ok(Math.abs(k.dst.x - 60) < 1e-9 && Math.abs(k.dst.y - 20) < 1e-9, 'wyśrodkowane w polu')
})
