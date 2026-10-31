// Testy przeglądu jakości: wybór zdjęć z problemami i najlepszego ujęcia z serii.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/quality.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const q = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const p = (id, o = {}) => ({ id, rating: 0, q_sharp: 100, q_mean: 120, q_hi: 0, q_lo: 0, ...o })

test('nieostre: tylko ocenione, poniżej progu, od najgorszych', () => {
  const list = q.problemPhotos([p(1, { q_sharp: 30 }), p(2, { q_sharp: 5 }), p(3, { q_sharp: 80 }), p(4, { q_sharp: null }), p(-5, { q_sharp: 1 })], 'blur', 40)
  assert.deepEqual(list.map((x) => x.id), [2, 1])
})

test('ciemne i prześwietlone: próg średniej jasności i odsetka białych pikseli w procentach', () => {
  const photos = [p(1, { q_mean: 20 }), p(2, { q_mean: 44 }), p(3, { q_mean: 46 }), p(4, { q_hi: 0.4 }), p(5, { q_hi: 0.1 })]
  assert.deepEqual(q.problemPhotos(photos, 'dark', 45).map((x) => x.id), [1, 2])
  assert.deepEqual(q.problemPhotos(photos, 'bright', 25).map((x) => x.id), [4])
})

test('najlepsze z serii: najostrzejsze ujęcie, remis rozstrzyga ocena, pary RAW+JPEG i nieocenione serie są pomijane', () => {
  const photos = [p(1, { q_sharp: 50 }), p(2, { q_sharp: 120 }), p(3, { q_sharp: 120, rating: 4 }), p(4, { q_sharp: null }), p(5, { q_sharp: null }), p(6, { q_sharp: null }), p(7)]
  const burst = { leader: 1, ids: [1, 2, 3], kind: 'burst' }
  const unrated = { leader: 4, ids: [4, 5, 6], kind: 'burst' }
  const pair = { leader: 7, ids: [7], kind: 'pair' }
  const stacks = new Map([[1, burst], [2, burst], [3, burst], [4, unrated], [5, unrated], [6, unrated], [7, pair]])
  const out = q.bestOfBursts(stacks, photos)
  assert.equal(out.length, 1)
  assert.equal(out[0].best.id, 3)
  assert.deepEqual(out[0].others.map((x) => x.id), [1, 2])
})
