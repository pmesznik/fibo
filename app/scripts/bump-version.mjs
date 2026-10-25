// Podnosi numer wersji FIBO w jednym miejscu: package.json, tauri.conf.json i Cargo.toml.
// Użycie (z folderu app):  node scripts/bump-version.mjs 0.2.0
// Numer trafia do nazwy instalatora (FIBO_<wersja>_x64-setup.exe), na stronę i do wydania na GitHubie.
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Podaj wersję w formacie X.Y.Z, np.: node scripts/bump-version.mjs 0.2.0')
  process.exit(1)
}

const edit = (rel, fn) => {
  const url = new URL(rel, import.meta.url)
  const before = readFileSync(url, 'utf8')
  const after = fn(before)
  if (after === before) console.log(`bez zmian: ${rel}`)
  else { writeFileSync(url, after); console.log(`zaktualizowano: ${rel}`) }
}

edit('../package.json', (t) => t.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`))
edit('../src-tauri/tauri.conf.json', (t) => t.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`))
edit('../src-tauri/Cargo.toml', (t) => t.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`))

console.log(`\nWersja ${version}. Dalej:\n  git add -A && git commit -m "Wersja ${version}"\n  git tag v${version} && git push && git push --tags\nTag v${version} uruchamia budowanie i publikuje wydanie z plikiem FIBO_${version}_x64-setup.exe.`)
