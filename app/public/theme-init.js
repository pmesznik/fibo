// Zapamiętany motyw ustawiamy przed pierwszym rysowaniem, żeby okno nie migało.
// Osobny plik zamiast skryptu w HTML, bo polityka CSP (script-src 'self') nie dopuszcza skryptów wbudowanych.
try {
  var t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t)
} catch (e) { /* brak dostępu do pamięci */ }
