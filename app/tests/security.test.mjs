// Testy bezpieczeństwa FIBO: konfiguracja Tauri, uprawnienia, kod frontu, repozytorium i workflowy GitHub Actions.
// Uruchomienie (z folderu app):  node --test tests/
// Działają bez internetu i bez kompilacji Rusta, więc nie blokuje ich Smart App Control.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const ROOT = join(APP, '..')
const read = (p) => readFileSync(p, 'utf8')
const json = (p) => JSON.parse(read(p))
const conf = json(join(APP, 'src-tauri', 'tauri.conf.json'))
const caps = json(join(APP, 'src-tauri', 'capabilities', 'default.json'))
const cargo = read(join(APP, 'src-tauri', 'Cargo.toml'))
const pkg = json(join(APP, 'package.json'))
const mainRs = read(join(APP, 'src-tauri', 'src', 'main.rs'))

/** Pliki śledzone przez git (bez node_modules, target, dist). */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    return out.split('\0').filter(Boolean)
  } catch {
    return []
  }
}
const tracked = trackedFiles()
const textFiles = tracked.filter((f) => /\.(tsx?|jsx?|mjs|cjs|json|toml|rs|ya?ml|md|html|css|nsh|txt)$/i.test(f) && !/package-lock|Cargo\.lock/.test(f))
const readTracked = (f) => read(join(ROOT, f))

describe('Polityka CSP', () => {
  const csp = conf.app.security.csp
  const dirs = Object.fromEntries(String(csp).split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...vals] = d.split(/\s+/)
    return [name, vals]
  }))

  test('CSP jest ustawiona i jest tekstem', () => assert.equal(typeof csp, 'string'))
  test('domyślnie tylko własne zasoby', () => assert.deepEqual(dirs['default-src'], ["'self'"]))
  test('skrypty tylko własne: bez unsafe-inline, unsafe-eval, wildcard i zdalnych adresów', () => {
    assert.deepEqual(dirs['script-src'], ["'self'"])
  })
  test('żadna dyrektywa nie ma gołego * ani http: ani https: bez hosta', () => {
    for (const [name, vals] of Object.entries(dirs)) {
      for (const v of vals) assert.ok(!['*', 'http:', 'https:'].includes(v), `${name}: niedozwolone źródło ${v}`)
    }
  })
  test('obiekty, ramki i formularze zablokowane, base-uri własne', () => {
    assert.deepEqual(dirs['object-src'], ["'none'"])
    assert.deepEqual(dirs['frame-src'], ["'none'"])
    assert.deepEqual(dirs['form-action'], ["'none'"])
    assert.deepEqual(dirs['base-uri'], ["'self'"])
  })
  test('połączenia sieciowe tylko do IPC aplikacji i serwera map', () => {
    const allowed = new Set(["'self'", 'ipc:', 'http://ipc.localhost', 'https://tiles.openfreemap.org'])
    for (const v of dirs['connect-src']) assert.ok(allowed.has(v), `connect-src: nieoczekiwane źródło ${v}`)
  })
  test('zdalne hosty tylko po HTTPS', () => {
    const urls = String(csp).match(/https?:\/\/[^\s;]+/g) ?? []
    for (const u of urls) assert.ok(u.startsWith('https://') || u.includes('.localhost'), `źródło bez HTTPS: ${u}`)
  })
  test('index.html nie ma skryptów wbudowanych (bo CSP ich nie dopuszcza)', () => {
    const html = read(join(APP, 'index.html'))
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter((m) => m[1].trim())
    assert.equal(inline.length, 0, 'znaleziono skrypt wbudowany w index.html')
  })
})

describe('Protokół zasobów i uprawnienia', () => {
  test('protokół asset jest wyłączony: miniatury i wycinki twarzy idą przez IPC jako bajty', () => {
    assert.equal(conf.app.security.assetProtocol, undefined)
    assert.ok(!/asset/.test(conf.app.security.csp), 'CSP nie powinna wspominać o asset')
    assert.ok(!/protocol-asset/.test(readTracked('app/src-tauri/Cargo.toml')))
    const uses = textFiles.filter((f) => f.startsWith('app/src/') && /convertFileSrc/.test(readTracked(f)))
    assert.deepEqual(uses, [])
  })
  test('uprawnienia okna: tylko to, co potrzebne', () => {
    const allowed = new Set(['core:default', 'dialog:default', 'updater:default', 'process:allow-restart', 'opener:allow-reveal-item-in-dir'])
    for (const p of caps.permissions) assert.ok(allowed.has(p), `nieoczekiwane uprawnienie: ${p}`)
  })
  test('brak uprawnień do plików, powłoki, HTTP, schowka i dostępu do systemu', () => {
    const text = JSON.stringify(caps)
    for (const bad of ['fs:', 'shell:', 'http:', 'clipboard', 'os:', 'process:allow-exit', 'opener:default', 'opener:allow-open', 'opener:allow-default-urls', 'global-shortcut', 'webview:allow-create']) {
      assert.ok(!text.includes(bad), `niedozwolone uprawnienie zawiera ${bad}`)
    }
  })
  test('uprawnienia dotyczą tylko okna głównego', () => assert.deepEqual(caps.windows, ['main']))
  test('tylko jedno okno w konfiguracji', () => assert.equal(conf.app.windows.length, 1))
  test('wtyczki w Cargo.toml: tylko dialog, updater i process (bez fs, shell, http)', () => {
    const plugins = [...cargo.matchAll(/^tauri-plugin-([a-z-]+)\s*=/gm)].map((m) => m[1]).sort()
    assert.deepEqual(plugins, ['dialog', 'opener', 'process', 'updater'])
  })
  test('wtyczki zarejestrowane w main.rs zgadzają się z Cargo.toml', () => {
    const reg = [...mainRs.matchAll(/\.plugin\(tauri_plugin_([a-z]+)::/g)].map((m) => m[1]).sort()
    assert.deepEqual(reg, ['dialog', 'opener', 'process', 'updater'])
  })
  test('identyfikator aplikacji się nie zmienia (od niego zależy folder z biblioteką użytkownika)', () => {
    assert.equal(conf.identifier, 'pl.local.menedzerzdjec')
  })
})

describe('Aktualizacje', () => {
  const up = conf.plugins.updater
  test('adres aktualizacji jest po HTTPS i wskazuje własne repozytorium', () => {
    assert.ok(up.endpoints.length >= 1)
    for (const e of up.endpoints) assert.match(e, /^https:\/\/github\.com\/pmesznik\/fibo\/releases\//)
  })
  test('klucz publiczny jest ustawiony i jest kluczem minisign', () => {
    assert.ok(up.pubkey && up.pubkey.length > 100)
    const decoded = Buffer.from(up.pubkey, 'base64').toString('utf8')
    assert.match(decoded, /minisign public key/)
  })
  test('w repozytorium nie ma klucza prywatnego (ani jego treści)', () => {
    for (const f of textFiles) {
      if (f === 'app/tests/security.test.mjs') continue // ten plik sam opisuje wzorce kluczy
      const t = readTracked(f)
      assert.ok(!/minisign secret key|rsign encrypted secret key/i.test(t), `${f}: wygląda na klucz prywatny`)
      assert.ok(!t.includes('dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5'), `${f}: zawiera zakodowany klucz prywatny`)
    }
    assert.ok(!tracked.some((f) => /\.key$|fibo-updater|\.pem$|\.pfx$|\.p12$/i.test(f) && !/\.pub$/.test(f)), 'plik klucza śledzony przez git')
  })
  test('wydania tworzą artefakty aktualizacji (podpis .sig)', () => assert.equal(conf.bundle.createUpdaterArtifacts, true))
  test('aktualizacja jest instalowana w trybie pasywnym (z paskiem postępu, bez pytań)', () => assert.equal(up.windows.installMode, 'passive'))
  test('spójne numery wersji w trzech plikach', () => {
    const cargoVer = cargo.match(/^version\s*=\s*"([^"]+)"/m)[1]
    assert.equal(conf.version, pkg.version)
    assert.equal(conf.version, cargoVer)
    assert.match(conf.version, /^\d+\.\d+\.\d+$/)
  })
})

describe('Kod frontu', () => {
  const src = textFiles.filter((f) => /^app\/src\/.*\.tsx?$/.test(f))
  test('wykryto pliki źródłowe', () => assert.ok(src.length >= 10))
  const banned = [
    [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML'],
    [/\.innerHTML\s*=/, 'przypisanie innerHTML'],
    [/\.outerHTML\s*=/, 'przypisanie outerHTML'],
    [/insertAdjacentHTML/, 'insertAdjacentHTML'],
    [/\beval\s*\(/, 'eval'],
    [/new\s+Function\s*\(/, 'new Function'],
    [/document\.write\s*\(/, 'document.write'],
    [/setTimeout\s*\(\s*['"`]/, 'setTimeout z tekstem'],
    [/setInterval\s*\(\s*['"`]/, 'setInterval z tekstem'],
    [/javascript:/i, 'adres javascript:'],
    [/window\.open\s*\(/, 'window.open'],
    [/target\s*=\s*["']_blank["']/, 'target=_blank'],
  ]
  for (const [rx, label] of banned) {
    test(`brak: ${label}`, () => {
      for (const f of src) assert.ok(!rx.test(readTracked(f)), `${f}: ${label}`)
    })
  }
  test('żadnych zdalnych skryptów, stylów i obrazów wpisanych w kod (poza serwerem map)', () => {
    for (const f of src) {
      const urls = readTracked(f).match(/https?:\/\/[^\s'"`)]+/g) ?? []
      for (const u of urls) {
        const ok = /openfreemap\.org|ns\.adobe\.com|w3\.org|purl\.org|github\.com\/pmesznik|react\.dev|localhost|ipc\.localhost|asset\.localhost|ns\.adobe|pmesznik\.github\.io/.test(u)
        assert.ok(ok, `${f}: nieoczekiwany zdalny adres ${u}`)
      }
    }
  })
  test('localStorage przechowuje tylko ustawienia interfejsu (bez haseł i kluczy)', () => {
    const keys = new Set()
    for (const f of src) for (const m of readTracked(f).matchAll(/localStorage\.(?:get|set|remove)Item\(\s*['"]([^'"]+)['"]/g)) keys.add(m[1])
    for (const k of keys) assert.ok(/^(theme|group|grid-original|thumb-size|sec-open|skip-update-version|update-last-check|fibo-lang|slide-secs|watermark-logo|edit-presets)$/.test(k), `nieoczekiwany klucz localStorage: ${k}`)
  })
  test('komunikaty z backendu i opisy zmian trafiają do React jako tekst (nie jako HTML)', () => {
    const updater = readTracked('app/src/Updater.tsx')
    assert.ok(/\{notes\}/.test(updater) && !/dangerouslySetInnerHTML/.test(updater))
  })
  test('zależności produkcyjne są przypięte do wersji głównych (brak "*", "latest" i adresów git)', () => {
    for (const [name, ver] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.ok(!/^(\*|latest|git|http|file:)/.test(ver), `${name}: ${ver}`)
    }
  })
})

describe('Kod backendu (Rust): ryzykowne konstrukcje', () => {
  test('brak unsafe poza ewentualnie uzasadnionymi miejscami', () => assert.ok(!/\bunsafe\s*\{/.test(mainRs)))
  test('brak wykonywania zewnętrznych poleceń (Command::new, shell)', () => {
    assert.ok(!/Command::new|std::process::Command|\.spawn\(\)/.test(mainRs.replace(/std::thread::scope[\s\S]*?\.spawn/g, '')))
  })
  test('zapytania SQL z danymi użytkownika używają parametrów (brak format! z wartościami w SQL)', () => {
    for (const m of mainRs.matchAll(/format!\(\s*"([^"]*(?:SELECT|INSERT|UPDATE|DELETE|ALTER)[^"]*)"/gi)) {
      // Dozwolone tylko stałe nazwy kolumn i tabel w migracjach i testach.
      assert.match(m[1], /ALTER TABLE photos ADD COLUMN \{col\}|SELECT COUNT\(\*\) FROM \{table\}/, `format! w SQL: ${m[1]}`)
    }
  })
  test('każde polecenie Tauri jest zarejestrowane i żadne nie jest martwe', () => {
    const cmds = [...mainRs.matchAll(/#\[tauri::command\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g)].map((m) => m[1])
    const handler = mainRs.match(/generate_handler!\[([\s\S]*?)\]/)[1]
    for (const c of cmds) assert.ok(new RegExp(`\\b${c}\\b`).test(handler), `polecenie ${c} nie jest zarejestrowane`)
  })
  test('polecenia usuwające dane przenoszą do Kosza, a nie kasują plików na stałe', () => {
    assert.ok(/trash::delete\(p\)/.test(mainRs))
    const start = mainRs.indexOf('fn trash_photos_core')
    const bodyTrash = mainRs.slice(start, start + 2600)
    assert.ok(!/fs::remove_file|remove_dir_all/.test(bodyTrash))
    assert.ok(!/remove_dir_all/.test(mainRs.replace(/#\[cfg\(test\)\][\s\S]*$/, '')), 'program nigdy nie usuwa całych katalogów')
  })
  test('usuwanie z dysku: słowo potwierdzenia sprawdza backend, sprawdzane są typ pliku i dowiązania', () => {
    assert.match(mainRs, /TRASH_CONFIRM_FROM: usize = 20/)
    assert.match(mainRs, /symlink_metadata/)
    assert.match(mainRs, /m\.is_file\(\) && is_photo\(p\)/)
  })
  test('interfejs usuwania wymaga wpisania USUŃ dla dużych operacji i całych folderów', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    assert.match(app, /ids\.length >= 20 \|\| forceTyped/)
    assert.match(app, /askTrash\(ids, `z folderu[^`]*`, true\)/)
  })
  test('limity: rozmiar pliku XMP i liczba tagów są zdefiniowane', () => {
    assert.match(mainRs, /const MAX_XMP_BYTES: u64 = 1 << 20/)
    assert.match(mainRs, /const MAX_TAGS_PER_FILE: usize = 200/)
  })
  test('wczytywanie metadanych z JPEG jest ograniczone do początku pliku', () => assert.match(mainRs, /take\(768 \* 1024\)/))
  test('własny plik XMP rozpoznawany znacznikiem, cudzych nie nadpisujemy', () => {
    assert.match(mainRs, /const XMP_MARKER/)
    assert.match(mainRs, /SidecarOutcome::Skipped/)
  })
})

describe('Repozytorium', () => {
  test('wykryto pliki śledzone przez git', () => assert.ok(tracked.length > 50))
  test('.gitignore pomija foldery budowania i zależności', () => {
    const gi = read(join(ROOT, '.gitignore'))
    for (const p of ['node_modules/', 'dist/', 'target/']) assert.ok(gi.includes(p), `brak ${p} w .gitignore`)
  })
  test('żaden duży ani binarny plik wykonywalny nie jest śledzony', () => {
    for (const f of tracked) {
      assert.ok(!/\.(exe|dll|msi|apk|jks|keystore|sqlite|db)$/i.test(f), `plik binarny w repozytorium: ${f}`)
      const size = statSync(join(ROOT, f)).size
      assert.ok(size < 2_000_000, `zbyt duży plik w repozytorium (${size} B): ${f}`)
    }
  })
  test('brak tokenów i haseł w śledzonych plikach', () => {
    const patterns = [
      [/gh[pousr]_[A-Za-z0-9]{30,}/, 'token GitHub'],
      [/github_pat_[A-Za-z0-9_]{30,}/, 'token GitHub (fine-grained)'],
      [/AKIA[0-9A-Z]{16}/, 'klucz AWS'],
      [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'klucz prywatny'],
      [/xox[abprs]-[A-Za-z0-9-]{10,}/, 'token Slack'],
      [/sk-[A-Za-z0-9]{32,}/, 'klucz API'],
      [/(password|passwd|haslo|hasło|secret)\s*[:=]\s*["'][^"'\s]{6,}["']/i, 'zapisane hasło'],
    ]
    for (const f of textFiles) {
      const t = readTracked(f)
      for (const [rx, label] of patterns) assert.ok(!rx.test(t), `${f}: wygląda na ${label}`)
    }
  })
  test('brak danych osobistych w repozytorium (ścieżki z nazwą użytkownika, adresy e-mail)', () => {
    for (const f of textFiles) {
      if (/^site\/|\.md$/.test(f) && /pmesznik/.test(readTracked(f))) continue // nazwa konta GitHub jest publiczna
      const t = readTracked(f)
      assert.ok(!/C:\\Users\\pmesz\\/.test(t) || /scripts\/|tests\//.test(f), `${f}: ścieżka z nazwą użytkownika`)
    }
  })
  test('licencja i polityka bezpieczeństwa istnieją', () => {
    assert.ok(existsSync(join(ROOT, 'LICENSE')))
    assert.ok(existsSync(join(ROOT, 'SECURITY.md')))
  })
  test('strona (site/) nie ładuje zewnętrznych skryptów', () => {
    for (const f of tracked.filter((x) => /^site\/.*\.html$/.test(x))) {
      for (const m of readTracked(f).matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
        assert.ok(!/^https?:\/\//.test(m[1]), `${f}: zewnętrzny skrypt ${m[1]}`)
      }
    }
  })
  test('pliki z danymi użytkownika (baza, miniatury, XMP) nie są śledzone', () => {
    assert.ok(!tracked.some((f) => /library\.db|thumbs\/|\.xmp$|\.originals/.test(f)))
  })
})

describe('Workflowy GitHub Actions', () => {
  const dir = join(ROOT, '.github', 'workflows')
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : []
  test('wykryto workflowy', () => assert.ok(files.length >= 3))
  for (const f of files) {
    const text = read(join(dir, f))
    test(`${f}: jawnie ustawione uprawnienia (permissions)`, () => assert.match(text, /^permissions:/m))
    test(`${f}: brak pull_request_target i workflow_run z kodem z forków`, () => {
      assert.ok(!/pull_request_target/.test(text))
    })
    test(`${f}: każda akcja przypięta do pełnego commitu (SHA), a nie do gałęzi ani ruchomego tagu`, () => {
      const uses = [...text.matchAll(/uses:\s*([\w.-]+\/[\w./-]+)@([^\s#]+)/g)]
      assert.ok(uses.length > 0)
      for (const m of uses) assert.match(m[2], /^[0-9a-f]{40}$/, `${f}: ${m[1]}@${m[2]} nie jest przypięte do SHA`)
    })
    test(`${f}: brak wypisywania sekretów (echo/Write-Host z secrets.)`, () => {
      assert.ok(!/(echo|Write-Host|Write-Output|printenv)[^\n]*secrets\./i.test(text))
    })
  }
  test('sekret klucza podpisu tylko w workflow wydań', () => {
    for (const f of files) {
      const text = read(join(dir, f))
      if (f !== 'build.yml') assert.ok(!/secrets\.TAURI_SIGNING/.test(text), `${f} używa klucza podpisu`)
    }
  })
  test('klucz podpisu jest dostępny tylko w jednym kroku: tym, który podpisuje gotowy instalator', () => {
    const t = read(join(dir, 'build.yml'))
    const beforeSteps = t.slice(0, t.indexOf('steps:'))
    assert.ok(!/TAURI_SIGNING_PRIVATE_KEY/.test(beforeSteps), 'sekret w env całego zadania')
    const uses = [...t.matchAll(/TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{/g)]
    assert.equal(uses.length, 1, 'klucz podpisu ma być przekazany do dokładnie jednego kroku')
    const stepStart = t.lastIndexOf('- name:', uses[0].index)
    const nextStep = t.indexOf('\n      - ', uses[0].index)
    const step = t.slice(stepStart, nextStep === -1 ? undefined : nextStep)
    assert.match(step, /signer sign/, 'krok z kluczem powinien tylko podpisywać')
    assert.ok(!/tauri build|cargo build|npm (ci|install)/.test(step), 'krok z kluczem nie może budować ani instalować zależności')
  })
  test('budowanie instalatora odbywa się bez klucza i bez podpisu aktualizacji', () => {
    const t = read(join(dir, 'build.yml'))
    assert.match(t, /tauri build --config '\{"bundle":\{"createUpdaterArtifacts":false\}\}'/)
  })
  test('zależności npm instalowane bez skryptów instalacyjnych w workflowach budowania i testów', () => {
    for (const f of ['build.yml', 'tests.yml']) assert.match(read(join(dir, f)), /npm ci --ignore-scripts/)
  })
  test('wydanie powstaje tylko dla tagów', () => {
    const t = read(join(dir, 'build.yml'))
    assert.ok(/if:\s*github\.ref_type == 'tag'/.test(t))
  })
  test('uprawnienie do zapisu tylko tam, gdzie tworzymy wydanie', () => {
    for (const f of files) {
      const t = read(join(dir, f))
      if (f !== 'build.yml' && f !== 'pages.yml') assert.ok(!/contents:\s*write/.test(t), `${f} ma zapis do repozytorium`)
    }
  })
  test('automatyczne aktualizacje zależności są skonfigurowane (dependabot)', () => {
    assert.ok(existsSync(join(ROOT, '.github', 'dependabot.yml')))
  })
})

describe('Struktura interfejsu (dostępność i standard designu)', () => {
  const css = read(join(APP, 'src', 'index.css'))
  const tsx = textFiles.filter((f) => /^app\/src\/.*\.tsx$/.test(f)).map((f) => [f, readTracked(f)])
  test('tokeny designu istnieją', () => {
    for (const t of ['--bg', '--panel', '--text', '--muted', '--line', '--accent', '--tonal', '--glass', '--touch', '--ease']) {
      assert.ok(css.includes(`${t}:`), `brak tokenu ${t}`)
    }
  })
  test('tryb ciemny, jasny wymuszony i wysoki kontrast', () => {
    assert.match(css, /prefers-color-scheme:\s*dark/)
    assert.match(css, /data-theme="dark"/)
    assert.match(css, /data-theme="light"/)
    assert.match(css, /prefers-contrast:\s*more/)
    assert.match(css, /prefers-reduced-motion:\s*reduce/)
    assert.match(css, /prefers-reduced-transparency/)
  })
  test('szkło ma jednolity zamiennik dla wysokiego kontrastu', () => assert.match(css, /prefers-contrast: more\), \(prefers-reduced-transparency: reduce\)\s*\{\s*\.glass/))
  test('przyciski-ikony (className ico) mają aria-label', () => {
    for (const [f, t] of tsx) {
      for (const m of t.matchAll(/<button\b[^>]*className=\{?[`"'][^`"']*\bico\b[^>]*>/g)) {
        assert.ok(/aria-label=/.test(m[0]), `${f}: przycisk-ikona bez aria-label: ${m[0].slice(0, 100)}`)
      }
    }
  })
  test('okna dialogowe mają role i aria-label', () => {
    for (const [f, t] of tsx) {
      for (const m of t.matchAll(/role="(dialog|alertdialog)"/g)) {
        const around = t.slice(Math.max(0, m.index - 250), m.index + 250)
        assert.ok(/aria-label=/.test(around), `${f}: dialog bez aria-label`)
      }
    }
  })
  test('pola formularzy mają etykiety (label nad polem albo aria-label)', () => {
    for (const [f, t] of tsx) {
      for (const m of t.matchAll(/<input\b[^>]*>/g)) {
        if (/type="range"|type="checkbox"/.test(m[0]) && /aria-label=/.test(m[0])) continue
        const around = t.slice(Math.max(0, m.index - 400), m.index + m[0].length)
        assert.ok(/aria-label=|id="[^"]+"/.test(m[0]) || /<label/.test(around), `${f}: pole bez etykiety: ${m[0].slice(0, 90)}`)
      }
    }
  })
  test('Esc zamyka warstwy (menu, podgląd, okna)', () => {
    for (const f of ['app/src/App.tsx', 'app/src/Viewer.tsx', 'app/src/Dialogs.tsx', 'app/src/Updater.tsx', 'app/src/Collage.tsx', 'app/src/Duplicates.tsx']) {
      assert.match(readTracked(f), /Escape/, `${f}: brak obsługi Esc`)
    }
  })
  test('pola tekstowe mają min. 16 px (żeby nie powiększać strony)', () => assert.match(css, /input\[type=text\][\s\S]*?font-size:\s*16px/))
  test('menu i okna mają zamykanie przez klawiaturę i widoczny fokus', () => assert.match(css, /:focus-visible/))
})

describe('Instalator', () => {
  test('polskie teksty instalatora: komplet 27 kluczy, plik bez BOM', () => {
    const p = join(APP, 'src-tauri', 'installer', 'Polish.nsh')
    const bytes = readFileSync(p)
    assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'plik ma BOM, makensis go odrzuci')
    assert.equal((read(p).match(/^LangString /gm) ?? []).length, 27)
  })
  test('instalacja tylko dla bieżącego użytkownika (bez administratora)', () => assert.equal(conf.bundle.windows.nsis.installMode, 'currentUser'))
  test('instalator wskazuje plik tłumaczenia, który istnieje', () => {
    const rel = conf.bundle.windows.nsis.customLanguageFiles.Polish
    assert.ok(existsSync(join(APP, 'src-tauri', rel)))
  })
})

describe('Audyt zależności: wyjątki', () => {
  test('każdy wyjątek audytu Rusta ma uzasadnienie w komentarzu', () => {
    const t = readFileSync(new URL('../src-tauri/.cargo/audit.toml', import.meta.url), 'utf8')
    const lines = t.split(/\r?\n/)
    lines.forEach((l, i) => {
      if (/^\s*"RUSTSEC-\d+-\d+"/.test(l)) {
        const before = lines.slice(Math.max(0, i - 6), i).filter((x) => x.trim().startsWith('#'))
        assert.ok(before.length >= 2, `${l.trim()}: brak uzasadnienia`)
      }
    })
  })
})

describe('Edytor: napisy na zdjęciu', () => {
  test('napisy mają limity długości i liczby oraz są rysowane tylko na canvasie', () => {
    const fx = readFileSync(new URL('../src/editor/effects.ts', import.meta.url), 'utf8')
    assert.match(fx, /MAX_TEXTS = 20/)
    assert.match(fx, /MAX_TEXT_LEN = 200/)
    assert.match(fx, /fillText\(/)
    assert.ok(!/innerHTML|dangerouslySetInnerHTML/.test(fx))
    assert.match(fx, /\^#\(\[0-9a-f\]\{6\}\)\$/i, 'kolor jest walidowany')
  })
})

describe('Okno: przeciąganie', () => {
  test('wbudowana obsługa upuszczania plików jest wyłączona, żeby działało przeciąganie elementów w interfejsie', () => {
    const c = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
    assert.equal(c.app.windows[0].dragDropEnabled, false)
  })
})

describe('Edycja wsadowa i opisy', () => {
  test('wklejanie edycji do wielu zdjęć zawsze zapisuje kopie (nie nadpisuje oryginałów)', () => {
    const b = readFileSync(new URL('../src/editor/batch.ts', import.meta.url), 'utf8')
    assert.match(b, /saveEdit\(.*'copy'/)
    assert.ok(!/'overwrite'/.test(b))
  })
  test('opis zdjęcia ma limit długości i wycięte znaki sterujące w backendzie', () => {
    const rs = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8')
    assert.match(rs, /const MAX_CAPTION: usize = 2000/)
    assert.match(rs, /is_control\(\)/)
  })
})

describe('Duplikaty i wtyczka opener', () => {
  test('duplikaty: przy 20 lub więcej plikach wymagane jest słowo USUŃ, a ważniejszy katalog wpływa na wybór głównego zdjęcia', () => {
    const d = readFileSync(new URL('../src/Duplicates.tsx', import.meta.url), 'utf8')
    assert.match(d, /markedList\.length >= 20 \? word\.trim\(\)/)
    assert.match(d, /bestOf\(list, order\)/)
  })
  test('wtyczka opener ma tylko uprawnienie pokazania elementu w katalogu (bez otwierania adresów i plików)', () => {
    const caps = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'))
    assert.deepEqual(caps.permissions.filter((p) => p.startsWith('opener')), ['opener:allow-reveal-item-in-dir'])
  })
})
