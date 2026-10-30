// Testy wydarzeń i podróży: dzielenie według przerw w czasie, minimalna liczba zdjęć, GPS, istniejące albumy i nazwy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const read = (f) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8')
const compile = (src) => ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const b64 = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const marks = b64(compile(read('marks.ts')))
const stacks = b64(compile(read('stacks.ts')).replace("from './marks'", `from '${marks}'`))
const ev = await import(b64(compile(read('events.ts')).replace("from './stacks'", `from '${stacks}'`)))

let n = 0
const pad = (x) => String(x).padStart(2, '0')
/** Zdjęcia co 10 minut od podanej godziny danego dnia. */
const day = (date, count, from = 10, extra = {}, step = 10) =>
  Array.from({ length: count }, (_, i) => { const m = from * 60 + i * step; return { id: ++n, taken: `${date} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`, albums: [], lat: null, lon: null, ...extra } })

test('dzień ze zdjęciami to wydarzenie, a kilka dni z rzędu to podróż; mało zdjęć nie tworzy wydarzenia', () => {
  // Kolejne dni zajmują całe dni (przerwy nocne krótsze niż 20 godzin), jak w prawdziwej podróży.
  const photos = [...day('2023-07-12', 12, 18), ...day('2023-07-13', 15, 8, {}, 60), ...day('2023-07-14', 11, 8), ...day('2023-09-01', 12), ...day('2023-10-05', 4)]
  const e = ev.findEvents(photos)
  assert.equal(e.length, 2, 'wrzesień i lipiec; cztery zdjęcia z października pomijamy')
  assert.equal(e[0].kind, 'event', 'najnowsze pierwsze')
  assert.equal(e[0].first, '2023-09-01')
  assert.equal(e[1].kind, 'trip')
  assert.equal(e[1].days, 3)
  assert.equal(e[1].ids.length, 38)
  assert.equal(ev.suggestName(e[1]), 'Podróż, 12 do 14 lipca 2023')
  assert.equal(ev.suggestName(e[0]), 'Wydarzenie, 1 września 2023')
})

test('przerwa dłuższa niż 20 godzin kończy wydarzenie, krótsza je podtrzymuje (noc w podróży)', () => {
  const evening = day('2023-07-12', 12, 18)
  const morning = day('2023-07-13', 12, 8)
  assert.equal(ev.findEvents([...evening, ...morning]).length, 1, 'przerwa nocna to mniej niż 20 godzin')
  const skip = day('2023-07-15', 12, 10)
  assert.equal(ev.findEvents([...evening, ...skip]).length, 2, 'dwa dni przerwy rozdzielają')
})

test('GPS: środek położenia tylko gdy co najmniej połowa zdjęć ma współrzędne', () => {
  const some = day('2023-07-12', 12).map((p, i) => (i < 7 ? { ...p, lat: 50 + i * 0.01, lon: 20 } : p))
  const e = ev.findEvents(some)[0]
  assert.ok(e.place && Math.abs(e.place.lat - 50.03) < 1e-9 && e.place.lon === 20)
  const few = day('2023-08-12', 12).map((p, i) => (i < 3 ? { ...p, lat: 50, lon: 20 } : p))
  assert.equal(ev.findEvents(few)[0].place, null)
})

test('wydarzenie, którego prawie całość jest w jednym albumie, wskazuje ten album', () => {
  const mostly = day('2023-07-12', 12).map((p, i) => ({ ...p, albums: i < 10 ? [5] : [] }))
  assert.equal(ev.findEvents(mostly)[0].album, 5)
  const partly = day('2023-08-12', 12).map((p, i) => ({ ...p, albums: i < 5 ? [5] : [] }))
  assert.equal(ev.findEvents(partly)[0].album, null)
})

test('codzienne fotografowanie przez miesiące nie daje jednego wydarzenia na lata', () => {
  const photos = []
  for (let d = 1; d <= 60; d++) photos.push(...day(new Date(Date.UTC(2023, 0, d)).toISOString().slice(0, 10), 3, 9).map((p, i) => ({ ...p, taken: p.taken.replace(/:00$/, ':00') })))
  const e = ev.findEvents(photos)
  assert.ok(e.length === 0 || e.every((x) => x.ids.length >= 10), 'żadnych śmieciowych grup')
  const span = (x) => (Date.parse(x.last) - Date.parse(x.first)) / 86400000
  assert.ok(e.every((x) => span(x) <= 21 + 1), 'długi ciąg jest dzielony na części')
})

test('zdjęcia bez daty i przykładowe są pomijane; etykiety zakresów dat', () => {
  const bad = [...day('2023-07-12', 12).map((p) => ({ ...p, taken: null })), ...day('2023-07-12', 12).map((p) => ({ ...p, id: -p.id }))]
  assert.deepEqual(ev.findEvents(bad), [])
  assert.equal(ev.rangeLabel('2023-07-28', '2023-08-02'), '28 lipca do 2 sierpnia 2023')
  assert.equal(ev.rangeLabel('2022-12-30', '2023-01-02'), '30 grudnia 2022 do 2 stycznia 2023')
  assert.equal(ev.rangeLabel('2023-07-12', '2023-07-12'), '12 lipca 2023')
})
