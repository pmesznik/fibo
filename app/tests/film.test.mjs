// Testy filmu ze zdjęć: oś czasu, przejścia, dobór formatu i nazwa pliku.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/film.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const f = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const o = { count: 3, secPerPhoto: 4, fadeSec: 1, zoom: true, width: 1280, height: 720, fps: 30 }

test('długość filmu to liczba zdjęć razy czas na zdjęcie, a po końcu klatka jest oznaczona jako ostatnia', () => {
  assert.equal(f.filmDuration(o), 12)
  assert.equal(f.frameAt(o, 12).done, true)
  assert.equal(f.frameAt(o, 99).index, 2)
  assert.equal(f.frameAt({ ...o, count: 0 }, 0).done, true)
})

test('oś czasu: zdjęcie, potem płynne przejście na jego końcu, a ostatnie zdjęcie nie ma przejścia', () => {
  assert.deepEqual([f.frameAt(o, 0).index, f.frameAt(o, 0).next, f.frameAt(o, 0).mix], [0, null, 0])
  assert.equal(f.frameAt(o, 2.9).next, null, 'przed przejściem')
  const mid = f.frameAt(o, 3.5)
  assert.equal(mid.index, 0); assert.equal(mid.next, 1)
  assert.ok(Math.abs(mid.mix - 0.5) < 1e-9, 'w połowie przejścia 0,5')
  assert.ok(f.frameAt(o, 3.99).mix > 0.99)
  assert.equal(f.frameAt(o, 4).index, 1, 'następne zdjęcie zaczyna się dokładnie po czasie')
  assert.equal(f.frameAt(o, 11.5).next, null, 'po ostatnim zdjęciu nie ma następnego')
  assert.equal(f.frameAt({ ...o, fadeSec: 0 }, 3.9).next, null, 'bez przejścia twarde cięcie')
})

test('przybliżenie rośnie powoli (do 6%) i można je wyłączyć', () => {
  const z = f.frameAt(o, 2).zoomA
  assert.ok(z > 1 && z <= 1.06)
  assert.equal(f.frameAt({ ...o, zoom: false }, 2).zoomA, 1)
})

test('format: MP4 ma pierwszeństwo, potem WebM, a brak obsługi daje null', () => {
  assert.deepEqual(f.pickFilmMime(() => true), { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' })
  assert.deepEqual(f.pickFilmMime((m) => m.startsWith('video/webm')), { mime: 'video/webm;codecs=vp9', ext: 'webm' })
  assert.equal(f.pickFilmMime(() => false), null)
})

test('nazwa pliku filmu jest bezpieczna i zawiera datę', () => {
  const name = f.filmFileName(new Date(2026, 9, 31, 8, 5), 'mp4')
  assert.equal(name, 'film_20261031_0805.mp4')
  assert.match(name, /^[A-Za-z0-9_.-]+$/)
})
