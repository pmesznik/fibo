// Generuje stronę FIBO do folderu site/ (polska i angielska wersja z jednego szablonu).
// Uruchomienie (z folderu app):  node scripts/build-site.mjs
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { PL, EN, REPO } from './site-content.mjs'

const root = new URL('../../', import.meta.url)
const at = (rel) => new URL(rel, root)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Ikony ze wspólnego zestawu aplikacji (src/FiboIcons.tsx).
const iconSrc = readFileSync(new URL('../src/FiboIcons.tsx', import.meta.url), 'utf8')
writeFileSync(new URL('./.fibo-icons.mjs', import.meta.url), ts.transpileModule(iconSrc, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const Icons = await import('./.fibo-icons.mjs')
const icon = (name, size = 28) => renderToStaticMarkup(createElement(Icons[name], { size, strokeWidth: 1.8 }))

const version = JSON.parse(readFileSync(at('app/src-tauri/tauri.conf.json'), 'utf8')).version

const page = (L) => {
  const base = `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}`
  const other = L.other.lang
  return `<!doctype html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(L.title)}</title>
<meta name="description" content="${esc(L.description)}">
<meta property="og:title" content="${esc(L.title)}">
<meta property="og:description" content="${esc(L.description)}">
<meta property="og:image" content="${base}/assets/fibo-logo.png">
<link rel="icon" type="image/svg+xml" href="../assets/favicon.svg">
<link rel="alternate" hreflang="${other}" href="../${other}/">
<link rel="stylesheet" href="../assets/site.css">
</head>
<body data-lang="${L.lang}" data-repo="${REPO}" data-version="${version}">
<a class="skip" href="#docs">${esc(L.nav.docs)}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="#top" aria-label="FIBO"><img src="../assets/fibo-ikona.svg" alt="" width="36" height="36"><span>FIBO</span></a>
    <nav aria-label="${esc(L.nav.docs)}">
      <a href="#features">${esc(L.nav.features)}</a>
      <a href="#docs">${esc(L.nav.docs)}</a>
      <a href="https://github.com/${REPO}">${esc(L.nav.github)}</a>
      <a class="lang" id="lang-switch" href="../${other}/" hreflang="${other}" lang="${other}">${esc(L.other.label)}</a>
    </nav>
  </div>
</header>

<main id="top">
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">${esc(L.tagline)}</p>
      <h1>FIBO</h1>
      <p class="lead">${esc(L.lead)}</p>
      <div class="dl-box" id="download">
        <a class="btn primary" id="dl-btn" href="https://github.com/${REPO}/releases/latest"
           data-label="${esc(L.dl.button)}" data-fallback="${esc(L.dl.fallback)}"
           data-meta="${esc(L.dl.meta)}" data-meta-fallback="${esc(L.dl.metaFallback)}">${esc(L.dl.fallback)}</a>
        <p class="meta" id="dl-meta">${esc(L.dl.metaFallback)}</p>
        <p class="meta"><a href="https://github.com/${REPO}/releases">${esc(L.dl.all)}</a> · <a href="https://github.com/${REPO}">${esc(L.nav.github)}</a></p>
        <p class="meta small" id="dl-name" data-tpl="${esc(L.dl.name)}"></p>
        <p class="note small"><a href="#install">${esc(L.dl.note)}</a></p>
      </div>
    </div>
    <div class="hero-art" aria-hidden="true"><img src="../assets/fibo-logo.svg" alt="" width="520"></div>
  </div>
</section>

<section class="wrap" id="features">
  <h2>${esc(L.featuresTitle)}</h2>
  <div class="cards">
    ${L.features.map((f) => `<article class="card"><div class="ico">${icon(f.icon)}</div><h3>${esc(f.t)}</h3><p>${esc(f.d)}</p></article>`).join('\n    ')}
  </div>
</section>

<section class="wrap docs" id="docs">
  <aside class="toc">
    <details open>
      <summary>${esc(L.nav.toc)}</summary>
      <ol>${L.docs.map((d) => `<li><a href="#${d.id}">${esc(d.t)}</a></li>`).join('')}</ol>
    </details>
  </aside>
  <div class="doc-body">
    <h2>${esc(L.docsTitle)}</h2>
    ${L.docs.map((d) => `<section id="${d.id}"><h3 class="sec-title">${esc(d.t)}</h3>${d.h}</section>`).join('\n    ')}
  </div>
</section>
</main>

<footer>
  <div class="wrap">${esc(L.footer)} · <span id="foot-version"></span> · <a href="https://github.com/${REPO}">GitHub</a></div>
</footer>
<script src="../assets/site.js" defer></script>
</body>
</html>
`
}

const out = (rel, content) => {
  const url = at(`site/${rel}`)
  mkdirSync(new URL('./', url), { recursive: true })
  writeFileSync(url, content)
}

out('pl/index.html', page(PL))
out('en/index.html', page(EN))

// Strona główna wybiera język przeglądarki (domyślnie polski) i zostawia linki bez JavaScriptu.
out('index.html', `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FIBO</title><link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<link rel="alternate" hreflang="pl" href="pl/"><link rel="alternate" hreflang="en" href="en/">
<meta http-equiv="refresh" content="3; url=pl/">
<script>
  var saved; try { saved = localStorage.getItem('fibo-lang') } catch (e) {}
  var lang = saved || ((navigator.language || 'pl').toLowerCase().indexOf('pl') === 0 ? 'pl' : 'en');
  location.replace(lang + '/' + location.hash);
</script>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#1e1b4b;color:#fff}a{color:#ffb627}</style>
</head><body><p><a href="pl/">Polski</a> · <a href="en/">English</a></p></body></html>
`)

mkdirSync(at('site/assets/'), { recursive: true })
copyFileSync(at('app/public/brand/fibo-ikona.svg'), at('site/assets/fibo-ikona.svg'))
copyFileSync(at('app/public/brand/fibo-logo.svg'), at('site/assets/fibo-logo.svg'))
copyFileSync(at('app/public/favicon.svg'), at('site/assets/favicon.svg'))
copyFileSync(at('branding/png/logo-kolor-512px.png'), at('site/assets/fibo-logo.png'))
writeFileSync(at('site/.nojekyll'), '')
console.log(`Strona zapisana w site/ (wersja z konfiguracji: ${version}).`)
