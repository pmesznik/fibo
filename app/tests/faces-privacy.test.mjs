// Testy prywatności rozpoznawania twarzy: nic nie wychodzi do internetu, dane są chronione, funkcja jest opcjonalna.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(root + p, 'utf8')
const src = (n) => read(`src-tauri/src/${n}`)
const faceFiles = ['faces.rs', 'people.rs', 'secure.rs', 'cluster.rs']
// Kod produkcyjny: bez komentarzy i bez modułu testów (testy mogą wypisywać komunikaty).
const noComments = (s) => s.split('#[cfg(test)]')[0].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

// Wszystko, co dotyka sieci w Rust i w kodzie interfejsu osób.
const NET = /\b(reqwest|hyper|ureq|isahc|surf|attohttpc|curl|TcpStream|TcpListener|UdpSocket|std::net|tokio::net|WebSocket|websocket|XMLHttpRequest|fetch\s*\(|navigator\.sendBeacon|https?:\/\/)/

test('moduły twarzy nie mają żadnych odwołań do sieci (kod bez komentarzy)', () => {
  for (const f of faceFiles) {
    const code = noComments(src(f))
    const m = code.match(NET)
    assert.ok(!m, `${f}: znaleziono odwołanie do sieci: ${m && m[0]}`)
  }
})

test('interfejs osób nie wysyła niczego przez sieć', () => {
  const ui = noComments(read('src/People.tsx'))
  assert.ok(!NET.test(ui))
  const api = read('src/api.ts')
  const block = api.slice(api.indexOf('Rozpoznawanie twarzy'))
  assert.ok(!/fetch\s*\(|XMLHttpRequest|WebSocket/.test(block))
})

test('zależności silnika rozpoznawania nie ciągną żadnej biblioteki sieciowej', () => {
  const lock = read('src-tauri/Cargo.lock')
  const pkgs = new Map()
  for (const block of lock.split('[[package]]').slice(1)) {
    const name = block.match(/name = "([^"]+)"/)[1]
    const deps = [...(block.match(/dependencies = \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/"([^"\s]+)/g)].map((m) => m[1])
    pkgs.set(name, deps)
  }
  const reach = (start) => {
    const seen = new Set()
    const walk = (n) => { if (seen.has(n) || !pkgs.has(n)) return; seen.add(n); pkgs.get(n).forEach(walk) }
    walk(start)
    return seen
  }
  const banned = /^(reqwest|hyper|hyper-util|hyper-rustls|hyper-tls|ureq|isahc|surf|attohttpc|curl|curl-sys|rustls|native-tls|openssl|openssl-sys|h2|http|tokio|mio|socket2|tungstenite|tokio-tungstenite|webpki|webpki-roots|rustls-webpki)$/
  for (const crate of ['tract-onnx', 'sha2']) {
    const bad = [...reach(crate)].filter((n) => banned.test(n))
    assert.deepEqual(bad, [], `${crate} ciągnie biblioteki sieciowe: ${bad.join(', ')}`)
  }
})

test('windows-sys służy tylko do szyfrowania (DPAPI), bez funkcji sieciowych', () => {
  const toml = read('src-tauri/Cargo.toml')
  const line = toml.match(/windows-sys\s*=\s*\{[^}]*\}/)[0]
  assert.match(line, /Win32_Security_Cryptography/)
  assert.ok(!/Networking|WinInet|WinHttp|Win32_Web|Sockets/.test(line))
})

test('blok unsafe jest tylko w module szyfrowania', () => {
  const dir = root + 'src-tauri/src/'
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.rs') && x !== 'secure.rs')) {
    assert.ok(!/\bunsafe\s*\{/.test(readFileSync(dir + f, 'utf8')), `${f} nie może zawierać unsafe`)
  }
})

test('funkcja jest domyślnie wyłączona i wymaga świadomego włączenia', () => {
  const people = src('people.rs')
  assert.match(people, /unwrap_or\(false\)/)
  assert.match(people, /Rozpoznawanie twarzy jest wyłączone/)
  const ui = read('src/People.tsx')
  assert.match(ui, /Włącz rozpoznawanie twarzy/)
  assert.match(ui, /nie są nigdzie wysyłane/)
})

test('wektory twarzy są szyfrowane przed zapisem w bazie', () => {
  const people = src('people.rs')
  const insert = people.indexOf('INSERT INTO faces')
  assert.ok(insert > 0)
  assert.ok(people.lastIndexOf('seal_embedding(', insert) > 0 && people.lastIndexOf('seal_embedding(', insert) < insert)
  assert.match(src('secure.rs'), /CryptProtectData/)
})

test('imiona osób nie trafiają do plików XMP ani do zdjęć', () => {
  const main = src('main.rs')
  assert.ok(!/people::|rename_person|FROM people/.test(main.slice(main.indexOf('fn build_xmp'), main.indexOf('fn build_xmp') + 4000)))
  assert.ok(!/xmp|XMP|sidecar/i.test(noComments(src('people.rs'))), 'moduł osób nie może dotykać plików XMP')
})

test('program nie zapisuje do logów imion, wektorów ani ścieżek twarzy', () => {
  for (const f of faceFiles) assert.ok(!/\b(println|eprintln|dbg|print|eprint)!|log::|tracing::/.test(noComments(src(f))), `${f}: logowanie`)
})

test('jedno polecenie usuwa wszystkie dane twarzy i jest zarejestrowane', () => {
  const people = src('people.rs')
  assert.match(people, /DELETE FROM faces; DELETE FROM people; DELETE FROM face_scan/)
  assert.match(src('main.rs'), /people::faces_delete_all/)
  assert.match(read('src/People.tsx'), /Usuń dane twarzy/)
})

test('zdjęcie usunięte z biblioteki traci też swoje twarze', () => {
  const main = src('main.rs')
  const f = main.slice(main.indexOf('fn forget_photo'), main.indexOf('fn forget_photo') + 300)
  assert.match(f, /people::forget_faces/)
})

test('modele: sumy SHA256 w skrypcie pobierania i w kodzie są takie same, a model jest sprawdzany przed użyciem', () => {
  const script = read('scripts/fetch-models.mjs')
  const people = src('people.rs')
  for (const [name, re] of [['YUNET', /yunet\.onnx'.*?sha256: '([0-9a-f]{64})'/], ['SFACE', /sface\.onnx'.*?sha256: '([0-9a-f]{64})'/]]) {
    const inScript = script.match(re)[1]
    const inRust = people.match(new RegExp(`${name}_SHA256: &str = "([0-9a-f]{64})"`))[1]
    assert.equal(inScript, inRust, `${name}: różne sumy`)
  }
  assert.match(people, /niewłaściwą sumę kontrolną/)
})

test('modele są dołączone do instalatora jako zasoby, a CSP nie zyskała nowych adresów', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
  assert.deepEqual(conf.bundle.resources, ['models/yunet.onnx', 'models/sface.onnx', 'THIRD_PARTY_NOTICES.md'])
  const connect = conf.app.security.csp.match(/connect-src ([^;]+)/)[1].split(/\s+/)
  assert.deepEqual(connect, ['\'self\'', 'ipc:', 'http://ipc.localhost', 'https://tiles.openfreemap.org'])
})

test('pobieranie modeli dzieje się tylko podczas budowania i weryfikuje sumę', () => {
  const script = read('scripts/fetch-models.mjs')
  assert.match(script, /sha\(buf\) !== m\.sha256/)
  for (const wf of ['build.yml', 'tests.yml']) {
    assert.match(read(`../.github/workflows/${wf}`), /fetch-models\.mjs/, `${wf} musi pobrać modele przed budowaniem`)
  }
})

test('prawdziwe pliki modeli (jeśli są) mają przypięte sumy', () => {
  for (const [file, hash] of [['yunet.onnx', '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'], ['sface.onnx', '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79']]) {
    let buf
    try { buf = readFileSync(root + 'src-tauri/models/' + file) } catch { continue }
    assert.equal(createHash('sha256').update(buf).digest('hex'), hash)
  }
})

test('pliki modeli nie są śledzone w git (są pobierane przy budowaniu)', () => {
  assert.match(readFileSync(root + '../.gitignore', 'utf8'), /models\/\*\.onnx/)
})
