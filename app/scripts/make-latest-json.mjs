// Tworzy latest.json dla mechanizmu aktualizacji FIBO (używa go wtyczka Tauri updater).
// Wywoływany w GitHub Actions po budowaniu:  node scripts/make-latest-json.mjs <repo> <wyjście.json>
// Notatki wydania bierze ze zmiennej NOTES (może być pusta).
import { readFileSync, writeFileSync } from 'node:fs'

const [repo, outPath] = process.argv.slice(2)
if (!repo || !outPath) {
  console.error('Użycie: node scripts/make-latest-json.mjs <wlasciciel/repo> <plik-wyjsciowy.json>')
  process.exit(1)
}

const version = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).version
const file = `FIBO_${version}_x64-setup.exe`
const sigPath = new URL(`../src-tauri/target/release/bundle/nsis/${file}.sig`, import.meta.url)
const signature = readFileSync(sigPath, 'utf8').trim()

const latest = {
  version,
  notes: (process.env.NOTES ?? '').trim(),
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${repo}/releases/download/v${version}/${file}`,
    },
  },
}

writeFileSync(outPath, JSON.stringify(latest, null, 2))
console.log(`latest.json: wersja ${version}, plik ${file}`)
