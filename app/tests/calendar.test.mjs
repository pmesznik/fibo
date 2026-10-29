// Testy logiki kalendarza: Wielkanoc i polskie święta, siatka miesiąca, ważne daty użytkownika oraz inteligentny dobór zdjęć.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(fileURLToPath(new URL('../src/calendarData.ts', import.meta.url)), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const cal = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

test('Wielkanoc wypada w znanych datach', () => {
  assert.deepEqual(cal.easter(2024), [3, 31])
  assert.deepEqual(cal.easter(2025), [4, 20])
  assert.deepEqual(cal.easter(2026), [4, 5])
  assert.deepEqual(cal.easter(2027), [3, 28])
  assert.deepEqual(cal.easter(2038), [4, 25])
})

test('polskie święta ruchome liczą się od Wielkanocy', () => {
  const h = cal.polishHolidays(2026)
  const on = (m, d) => h.find((x) => x.month === m && x.day === d)?.name
  assert.equal(on(4, 5), 'Wielkanoc')
  assert.equal(on(4, 6), 'Poniedziałek Wielkanocny')
  assert.equal(on(5, 24), 'Zielone Świątki')
  assert.equal(on(6, 4), 'Boże Ciało')
  assert.equal(on(11, 11), 'Święto Niepodległości')
  assert.equal(on(12, 24), 'Wigilia')
  assert.equal(cal.polishHolidays(2024).some((x) => x.name === 'Wigilia'), false, 'Wigilia jest wolna dopiero od 2025')
  const sorted = h.every((x, i) => i === 0 || h[i - 1].month < x.month || (h[i - 1].month === x.month && h[i - 1].day < x.day))
  assert.ok(sorted, 'lista jest posortowana')
})

test('siatka miesiąca: luty 2028 (rok przestępny) zaczyna się od wtorku', () => {
  const mon = cal.monthGrid(2028, 2, 'mon')
  assert.deepEqual(mon[0], [null, 1, 2, 3, 4, 5, 6])
  assert.equal(mon.flat().filter((d) => d !== null).length, 29)
  assert.ok(mon.every((w) => w.length === 7))
  const sun = cal.monthGrid(2028, 2, 'sun')
  assert.deepEqual(sun[0], [null, null, 1, 2, 3, 4, 5])
  assert.deepEqual(cal.dayNames('mon')[6], 'Nd')
  assert.deepEqual(cal.dayNames('sun')[0], 'Nd')
  assert.ok(cal.isSundayCol(6, 'mon') && cal.isSundayCol(0, 'sun') && cal.isSaturdayCol(5, 'mon') && cal.isSaturdayCol(6, 'sun'))
  // Luty 2027 zaczyna się w poniedziałek i ma 28 dni, czyli dokładnie 4 tygodnie; luty 2026 zaczyna się w niedzielę i potrzebuje 5.
  assert.equal(cal.monthGrid(2027, 2, 'mon').length, 4)
  assert.equal(cal.monthGrid(2026, 2, 'mon').length, 5)
  assert.equal(cal.monthGrid(2026, 8, 'mon').length, 6)
})

test('ważne daty: poprawne linie są czytane, błędne pomijane', () => {
  const ev = cal.parseEvents('24.05 Urodziny Mamy\n3/12.2019 Rocznica\nzła linia\n31.04 nie ma takiego dnia\n29.02 Dzień przestępny\n  1-1  Nowy rok  \n13.13 zły miesiąc')
  assert.deepEqual(ev.map((e) => [e.month, e.day, e.label]), [[5, 24, 'Urodziny Mamy'], [12, 3, 'Rocznica'], [2, 29, 'Dzień przestępny'], [1, 1, 'Nowy rok']])
  assert.equal(cal.parseEvents('').length, 0)
  const notes = cal.dayNotes(5, cal.polishHolidays(2026), ev)
  assert.deepEqual(notes.get(1).holiday, ['Święto Pracy'])
  assert.deepEqual(notes.get(24).event, ['Urodziny Mamy'])
  assert.deepEqual(notes.get(24).holiday, ['Zielone Świątki'])
})

const photo = (id, taken, extra = {}) => ({ id, path: `C:\\Z\\f${id % 3}\\${id}.jpg`, name: `${id}.jpg`, size: 1, modified: 1, taken, width: 4000, height: 3000, camera: null, rating: 0, favorite: false, tags: [], lat: null, lon: null, albums: [], ...extra })

test('inteligentny dobór: zdjęcia pasują do miesiąca, bez powtórek, ostrzejsze wygrywają', async () => {
  const photos = []
  let id = 1
  for (let m = 1; m <= 12; m++) for (let k = 0; k < 4; k++) photos.push(photo(id++, `2025-${String(m).padStart(2, '0')}-${String(10 + k).padStart(2, '0')} 12:00:00`, { rating: k === 2 ? 4 : 1 }))
  // Zdjęcie z marca, które jest nieostre, ma przegrać z ostrym o tej samej ocenie.
  const march = photos.filter((p) => p.taken.startsWith('2025-03'))
  const sharp = async (pid) => (pid === march[2].id ? 5 : pid === march[3].id ? 1 : 3)
  const progress = []
  const picks = await cal.autoPick(photos, 2026, 'portrait', new Map(), sharp, (d, t) => progress.push([d, t]))
  assert.equal(Object.keys(picks).length, 13, 'okładka i 12 miesięcy')
  assert.equal(new Set(Object.values(picks)).size, 13, 'żadne zdjęcie się nie powtarza')
  for (let m = 1; m <= 12; m++) {
    const p = photos.find((x) => x.id === picks[m])
    assert.ok(p.taken.startsWith(`2025-${String(m).padStart(2, '0')}`), `miesiąc ${m}: ${p.taken}`)
  }
  assert.equal(picks[3], march[2].id, 'wysoka ocena i ostrość wygrywają w marcu')
  assert.deepEqual(progress[progress.length - 1], [13, 13])
})

test('inteligentny dobór: twarze podnoszą wynik, a gdy brakuje zdjęć, miesiące zostają puste', async () => {
  const photos = [photo(1, '2025-06-01 10:00:00'), photo(2, '2025-06-02 10:00:00')]
  const faces = new Map([[2, { faces: 2, quality: 0.9 }]])
  const picks = await cal.autoPick(photos, 2026, 'portrait', faces, async () => 1)
  assert.equal(picks[6], 2, 'zdjęcie z twarzami wygrywa')
  assert.ok(Object.keys(picks).length <= 2)
  assert.deepEqual(await cal.autoPick([], 2026, 'portrait', new Map(), async () => 1), {})
  // Zdjęcia z ujemnym numerem (przykładowe) są pomijane.
  assert.deepEqual(await cal.autoPick([photo(-1, '2025-01-01 10:00:00')], 2026, 'portrait', new Map(), async () => 1), {})
})

/** Niezależny algorytm Wielkanocy (Gauss, z wyjątkami), poprawny dla lat 1900 do 2099. */
function gaussEaster(y) {
  const a = y % 19, b = y % 4, c = y % 7, k = Math.floor(y / 100)
  const p = Math.floor((13 + 8 * k) / 25), q = Math.floor(k / 4)
  const M = (15 - p + k - q) % 30, N = (4 + k - q) % 7
  const d = (19 * a + M) % 30, e = (2 * b + 4 * c + 6 * d + N) % 7
  let days = 22 + d + e
  let month = 3
  if (days > 31) { month = 4; days -= 31 }
  if (month === 4 && days === 26) days = 19
  if (month === 4 && days === 25 && d === 28 && e === 6 && a > 10) days = 18
  return [month, days]
}

test('Wielkanoc zgadza się z drugim, niezależnym algorytmem w latach 1990 do 2099', () => {
  for (let y = 1990; y <= 2099; y++) assert.deepEqual(cal.easter(y), gaussEaster(y), `rok ${y}`)
})

test('rok 2034: święta wypadają we właściwe dni tygodnia i daty', () => {
  assert.deepEqual(cal.easter(2034), [4, 9], 'Wielkanoc 2034 to 9 kwietnia')
  const h = cal.polishHolidays(2034)
  const dateOf = (name) => { const x = h.find((v) => v.name === name); return `${x.day}.${String(x.month).padStart(2, '0')}` }
  assert.equal(dateOf('Wielkanoc'), '9.04')
  assert.equal(dateOf('Poniedziałek Wielkanocny'), '10.04')
  assert.equal(dateOf('Zielone Świątki'), '28.05')
  assert.equal(dateOf('Boże Ciało'), '8.06')
  assert.equal(h.length, 14, '13 stałych i ruchomych świąt oraz Wigilia')
  const dow = (m, d) => new Date(Date.UTC(2034, m - 1, d)).getUTCDay() // 0 = niedziela
  assert.equal(dow(1, 1), 0, '1 stycznia 2034 to niedziela')
  assert.equal(dow(4, 9), 0, 'Wielkanoc zawsze w niedzielę')
  assert.equal(dow(4, 10), 1, 'Poniedziałek Wielkanocny w poniedziałek')
  assert.equal(dow(5, 28), 0, 'Zielone Świątki w niedzielę')
  assert.equal(dow(6, 8), 4, 'Boże Ciało w czwartek')
  assert.equal(dow(12, 25), 1, 'Boże Narodzenie 2034 w poniedziałek')
})

test('rok 2034: każdy dzień każdego miesiąca stoi w kolumnie właściwego dnia tygodnia', () => {
  for (const start of ['mon', 'sun']) {
    for (let month = 1; month <= 12; month++) {
      const grid = cal.monthGrid(2034, month, start)
      const days = grid.flat().filter((d) => d !== null)
      assert.equal(days.length, new Date(Date.UTC(2034, month, 0)).getUTCDate(), `liczba dni w miesiącu ${month}`)
      assert.deepEqual(days, Array.from({ length: days.length }, (_, i) => i + 1), 'kolejność dni 1, 2, 3...')
      grid.forEach((week) => week.forEach((d, col) => {
        if (d === null) return
        const real = new Date(Date.UTC(2034, month - 1, d)).getUTCDay() // 0 = niedziela
        const expected = start === 'mon' ? (real + 6) % 7 : real
        assert.equal(col, expected, `${d}.${month}.2034 (${start})`)
      }))
    }
  }
})

test('lata przestępne: 2032 i 2036 mają 29 lutego, 2100 nie', () => {
  assert.equal(cal.daysInMonth(2032, 2), 29)
  assert.equal(cal.daysInMonth(2034, 2), 28)
  assert.equal(cal.daysInMonth(2036, 2), 29)
  assert.equal(cal.daysInMonth(2100, 2), 28)
  assert.equal(cal.monthGrid(2036, 2, 'mon').flat().filter((d) => d !== null).length, 29)
})
