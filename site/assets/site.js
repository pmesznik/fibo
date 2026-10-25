// Strona FIBO: pobiera numer i plik najnowszego wydania z GitHuba, zapamiętuje język, podświetla spis treści.
(() => {
  const body = document.body
  const repo = body.dataset.repo
  const lang = body.dataset.lang
  const fallbackVersion = body.dataset.version

  try { localStorage.setItem('fibo-lang', lang) } catch (e) { /* brak pamięci */ }

  // Przełącznik języka zachowuje miejsce na stronie (#sekcja).
  const sw = document.getElementById('lang-switch')
  const syncSwitch = () => { sw.href = sw.getAttribute('href').split('#')[0] + location.hash }
  syncSwitch(); window.addEventListener('hashchange', syncSwitch)

  const btn = document.getElementById('dl-btn')
  const meta = document.getElementById('dl-meta')
  const name = document.getElementById('dl-name')
  const foot = document.getElementById('foot-version')
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '')

  const showName = (file, v) => {
    name.textContent = fill(name.dataset.tpl, { v })
    if (file) name.textContent += ' → ' + file
  }
  foot.textContent = 'v' + fallbackVersion
  showName('', fallbackVersion)

  fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      const asset = (rel.assets || []).find((a) => /\.exe$/i.test(a.name))
      if (!asset) return
      const v = String(rel.tag_name || '').replace(/^v/i, '')
      btn.href = asset.browser_download_url
      btn.textContent = fill(btn.dataset.label, { v })
      meta.textContent = fill(btn.dataset.meta, {
        size: (asset.size / 1048576).toFixed(1) + ' MB',
        date: new Date(rel.published_at).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
      })
      showName(asset.name, v)
      foot.textContent = 'v' + v
    })
    .catch(() => { /* zostaje link do strony wydań */ })

  // Podświetlenie bieżącej sekcji w spisie treści.
  const links = [...document.querySelectorAll('.toc a')]
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]))
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { links.forEach((l) => l.classList.remove('on')); byId.get(e.target.id)?.classList.add('on') }
      })
    }, { rootMargin: '-20% 0px -70% 0px' })
    byId.forEach((_, id) => { const el = document.getElementById(id); if (el) io.observe(el) })
  }
})()
