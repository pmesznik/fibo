// Generuje IKONY_FIBO.html: katalog ikon użytych w aplikacji, z nazwami, opisami i miejscem użycia.
// Uruchomienie (z folderu app):  node scripts/icon-catalog.mjs
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, writeFileSync } from 'node:fs'

// Ikony pochodzą z src/FiboIcons.tsx: kompilujemy je kompilatorem TypeScript do pliku tymczasowego i wczytujemy.
import ts from 'typescript'
const iconSrc = readFileSync(new URL('../src/FiboIcons.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(iconSrc, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
writeFileSync(new URL('./.fibo-icons.mjs', import.meta.url), compiled)
const L = await import('./.fibo-icons.mjs')

const logoUri = 'data:image/svg+xml;base64,' + readFileSync(new URL('../public/brand/fibo-ikona.svg', import.meta.url)).toString('base64')

// icon = nazwa w bibliotece Lucide, label = nazwa po polsku, where = gdzie w aplikacji, desc = co robi.
const GROUPS = [
  { title: 'Nawigacja i menu', items: [
    { icon: 'Images', label: 'Biblioteka', where: 'Pasek zakładek (góra)', desc: 'Wszystkie zdjęcia z dodanych folderów, pogrupowane według lat lub miesięcy. Używana też jako ikona pustej biblioteki.' },
    { icon: 'FolderOpen', label: 'Albumy / Foldery', where: 'Pasek zakładek; menu: sekcja Foldery; chip filtra folderu', desc: 'Widok albumów, czyli folderów ze zdjęciami pogrupowanych według roku. Oznacza też filtr po folderze.' },
    { icon: 'Heart', label: 'Ulubione', where: 'Pasek zakładek; pasek zaznaczenia; podgląd', desc: 'Widok zdjęć oznaczonych sercem oraz przycisk dodania zdjęcia do ulubionych (skrót F).' },
    { icon: 'Users', label: 'Ludzie', where: 'Pasek zakładek', desc: 'Przyszłe rozpoznawanie twarzy (funkcje AI). Na razie pokazuje informację „Wkrótce”.' },
    { icon: 'MapPin', label: 'Mapa', where: 'Pasek zakładek', desc: 'Globus ze zdjęciami: pinezka w miejscu zrobienia zdjęcia, kliknięcie pokazuje zdjęcia z tego miejsca.' },
    { icon: 'Plus', label: 'Dodaj folder', where: 'Przycisk w prawym górnym rogu; okno tagów (dodaj tag)', desc: 'Otwiera wybór folderu i skanuje zdjęcia do biblioteki. W oknie tagów zatwierdza nowy tag.' },
    { icon: 'ImageUp', label: 'Dodaj folder (kafel)', where: 'Menu: Szybkie akcje', desc: 'To samo co przycisk +, w formie dużego kafla w menu.' },
    { icon: 'X', label: 'Zamknij / usuń', where: 'Menu, podgląd, kolaż, okna, chipy filtrów, panele', desc: 'Zamyka okno lub panel, odznacza zaznaczenie albo usuwa aktywny filtr (chip). Esc robi to samo.' },
    { icon: 'SlidersHorizontal', label: 'Ocena i sortowanie', where: 'Menu: sekcja Filtry', desc: 'Filtr minimalnej oceny w gwiazdkach i wybór sortowania (najnowsze, najstarsze, nazwa).' },
    { icon: 'Ruler', label: 'Wygląd', where: 'Menu: sekcja Wygląd', desc: 'Układ miniatur (oryginalne proporcje lub równe kafelki), grupowanie według daty i rozmiar miniatur.' },
    { icon: 'Search', label: 'Szukanie', where: 'Chip aktywnego szukania nad siatką', desc: 'Pokazuje wpisaną frazę szukania (nazwa pliku, aparat, tag) i pozwala ją usunąć.' },
    { icon: 'CalendarDays', label: 'Rok', where: 'Nad siatką zdjęć', desc: 'Oznacza rząd chipów z latami: kliknięcie przewija bibliotekę do wybranego roku.' },
  ] },
  { title: 'Zdjęcia: ocena, zaznaczanie, pokazy', items: [
    { icon: 'Star', label: 'Ocena (gwiazdki)', where: 'Pasek zaznaczenia; podgląd; filtr oceny; siatka', desc: 'Ocena zdjęcia od 1 do 5 gwiazdek (klawisze 0-5). Dotknięcie tej samej oceny zeruje ją.' },
    { icon: 'Maximize2', label: 'Otwórz i edytuj', where: 'Pasek zaznaczonego zdjęcia', desc: 'Otwiera zdjęcie w podglądzie na cały ekran z edytorem (to samo co dwuklik).' },
    { icon: 'Play', label: 'Pokaz slajdów', where: 'Menu: Szybkie akcje; podgląd', desc: 'Automatycznie przełącza zdjęcia co kilka sekund (spacja włącza i zatrzymuje).' },
    { icon: 'Pause', label: 'Wstrzymaj pokaz', where: 'Podgląd', desc: 'Zastępuje ikonę Play, gdy pokaz slajdów trwa.' },
    { icon: 'ListChecks', label: 'Zaznaczanie wielu', where: 'Menu: Szybkie akcje', desc: 'Włącza tryb, w którym kliknięcie dodaje i odejmuje zdjęcia od zaznaczenia (bez Ctrl).' },
    { icon: 'Check', label: 'Zaznaczone', where: 'Znacznik w rogu miniatury', desc: 'Pokazuje, że zdjęcie jest w zaznaczeniu przy zaznaczaniu wielu zdjęć.' },
    { icon: 'ChevronLeft', label: 'Poprzednie zdjęcie', where: 'Podgląd (lewa krawędź)', desc: 'Przechodzi do poprzedniego zdjęcia (strzałka w lewo).' },
    { icon: 'ChevronRight', label: 'Następne zdjęcie', where: 'Podgląd (prawa krawędź)', desc: 'Przechodzi do następnego zdjęcia (strzałka w prawo).' },
    { icon: 'Maximize', label: 'Pełny ekran', where: 'Podgląd (górny pasek)', desc: 'Przełącza okno na pełny ekran; Esc kończy.' },
    { icon: 'Info', label: 'Informacje', where: 'Podgląd: zakładka Info', desc: 'Nazwa, folder, wymiary, rozmiar, data zdjęcia, aparat i tagi zdjęcia.' },
  ] },
  { title: 'Edytor zdjęć', items: [
    { icon: 'Wand2', label: 'Edycja / Podstawowe', where: 'Podgląd: przycisk edycji i zakładka Podstawowe', desc: 'Otwiera panel edycji (klawisz E). W panelu: szybkie poprawki, obrót, kadrowanie.' },
    { icon: 'Zap', label: 'Jedno kliknięcie', where: 'Edytor, Podstawowe', desc: 'Automatyczne poprawki: Szczęśliwy traf, Auto kontrast, Auto kolor i Doświetlenie.' },
    { icon: 'Sliders', label: 'Dostrajanie', where: 'Edytor: zakładka Dostrajanie; sekcja Siła efektów', desc: 'Suwaki światła, koloru i ostrości. Dwuklik na suwaku zeruje go.' },
    { icon: 'Sparkles', label: 'Efekty', where: 'Edytor: zakładka Efekty', desc: 'Ponad 30 efektów (czarno-białe, sepia, Lomo, HDR, szkic i inne) nakładanych w kolejności wyboru.' },
    { icon: 'RotateCcw', label: 'Obróć w lewo', where: 'Edytor, Obrót i odbicie', desc: 'Obraca zdjęcie o 90° przeciwnie do ruchu wskazówek zegara.' },
    { icon: 'RotateCw', label: 'Obróć w prawo', where: 'Edytor, sekcja Obrót i odbicie', desc: 'Obraca zdjęcie o 90° zgodnie z ruchem wskazówek zegara. Ikona sekcji Obrót i odbicie.' },
    { icon: 'FlipHorizontal', label: 'Odbij poziomo', where: 'Edytor, Obrót i odbicie', desc: 'Lustrzane odbicie w poziomie.' },
    { icon: 'FlipVertical', label: 'Odbij pionowo', where: 'Edytor, Obrót i odbicie', desc: 'Lustrzane odbicie w pionie.' },
    { icon: 'Eye', label: 'Czerwone oczy', where: 'Edytor, Obrót i odbicie', desc: 'Włącza tryb, w którym klikasz środek oka na zdjęciu, żeby usunąć efekt czerwonych oczu.' },
    { icon: 'Crop', label: 'Kadrowanie', where: 'Edytor, sekcja Kadrowanie', desc: 'Przycięcie do proporcji (1:1, 4:3, 16:9 i inne) ze zbliżeniem i przesunięciem.' },
    { icon: 'Sun', label: 'Światło', where: 'Edytor, Dostrajanie', desc: 'Grupa: doświetlenie, światła, cienie, jasność, kontrast i gamma.' },
    { icon: 'Palette', label: 'Kolor', where: 'Edytor: Dostrajanie i Efekty', desc: 'Grupa: temperatura barwowa i nasycenie oraz efekty kolorystyczne (Kolor i ton).' },
    { icon: 'Aperture', label: 'Ostrość', where: 'Edytor: Dostrajanie i Efekty', desc: 'Wyostrzenie oraz efekty światła i ostrości (poświata, miękki fokus, winieta).' },
    { icon: 'History', label: 'Retro i film / Oryginał', where: 'Edytor: grupa efektów; przycisk Przywróć oryginał', desc: 'Grupa efektów retro (ziarno, Lomo, Polaroid). Przycisk Oryginał przywraca zdjęcie z kopii w folderze .originals.' },
    { icon: 'Pencil', label: 'Kreatywne', where: 'Edytor, Efekty', desc: 'Efekty artystyczne: posteryzacja, pikselizacja, szkic ołówkiem, komiks, neon.' },
    { icon: 'Undo2', label: 'Cofnij', where: 'Podgląd (górny pasek)', desc: 'Cofa ostatnią zmianę w edytorze (Ctrl+Z).' },
    { icon: 'Redo2', label: 'Ponów', where: 'Podgląd (górny pasek)', desc: 'Przywraca cofniętą zmianę (Ctrl+Y).' },
    { icon: 'Save', label: 'Zapisz', where: 'Edytor, dół panelu; Kolaż', desc: 'Zapisuje zmiany. Przy zdjęciu oryginał trafia najpierw do folderu .originals. W kolażu zapisuje nowy plik JPG.' },
    { icon: 'CopyPlus', label: 'Zapisz jako kopię', where: 'Edytor, dół panelu', desc: 'Zapisuje wynik jako nowy plik z dopiskiem _edit, oryginał zostaje bez zmian.' },
    { icon: 'Trash2', label: 'Odrzuć zmiany / Przenieś do Kosza', where: 'Edytor, dół panelu; okno duplikatów', desc: 'W edytorze cofa wszystkie niezapisane zmiany (można je cofnąć przyciskiem Cofnij). W oknie duplikatów przenosi zaznaczone pliki do Kosza Windows po potwierdzeniu.' },
  ] },
  { title: 'Kolaż, tagi i mapa', items: [
    { icon: 'LayoutDashboard', label: 'Kolaż', where: 'Menu: Szybkie akcje; paski zaznaczenia', desc: 'Tworzy kolaż z zaznaczonych zdjęć: siatka, mozaika, stos zdjęć lub kontaktówka.' },
    { icon: 'Shuffle', label: 'Przemieszaj', where: 'Kolaż, układ Stos zdjęć', desc: 'Losuje nowe rozmieszczenie zdjęć w stosie.' },
    { icon: 'Tag', label: 'Tagi', where: 'Pasek zaznaczenia; menu: sekcja Tagi; podgląd: Info', desc: 'Dodawanie i usuwanie tagów oraz filtrowanie biblioteki po tagach.' },
    { icon: 'MapPinOff', label: 'Brak lokalizacji', where: 'Mapa (pusty stan)', desc: 'Informuje, że żadne zdjęcie nie ma zapisanego GPS; obok przycisk wczytania lokalizacji.' },
    { icon: 'RefreshCw', label: 'Odśwież dane zdjęć / lokalizacje', where: 'Menu: Szybkie akcje; Mapa', desc: 'Ponownie czyta z plików współrzędne GPS, wymiary i daty zdjęć. Kręci się podczas pracy.' },
  ] },
  { title: 'Duplikaty', items: [
    { icon: 'Copy', label: 'Duplikaty', where: 'Menu: Szybkie akcje; nagłówek grupy w oknie duplikatów', desc: 'Otwiera szukanie kopii zdjęć: identyczne pliki, bardzo podobne (zmniejszone, przekompresowane) i podobne (serie ujęć).' },
    { icon: 'ScanSearch', label: 'Co szukać', where: 'Okno duplikatów', desc: 'Nagłówek sekcji wyboru poziomu podobieństwa przed uruchomieniem szukania.' },
    { icon: 'Crown', label: 'Najlepsze', where: 'Okno duplikatów, miniatura w grupie', desc: 'Oznacza zdjęcie proponowane do zachowania: największa rozdzielczość, potem największy plik, potem to z datą EXIF.' },
  ] },
]

// Elementy niebędące ikonami z biblioteki.
const CUSTOM = [
  { svg: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M3 6h18M3 12h13M3 18h18"/></svg>', label: 'Menu (hamburger)', where: 'Lewy górny róg', desc: 'Otwiera szufladę z narzędziami: szukanie, szybkie akcje, filtry, tagi, foldery i wygląd. Czerwona kropka oznacza trwające skanowanie.' },
  { svg: `<img src="${logoUri}" width="34" height="34" style="border-radius:9px">`, img: true, label: 'Logo FIBO', where: 'Nagłówek menu; ikona okna i pliku .exe', desc: 'Znak „Złoty podział” z paczki logo: fiolet, róż, koral, bursztyn i morski na granatowym tle.' },
  { svg: '<svg viewBox="0 0 48 60" width="26" height="32"><path d="M24 2C12.4 2 3 11.2 3 22.6 3 38 24 58 24 58s21-20 21-35.4C45 11.2 35.6 2 24 2z" fill="#6d5bf0" stroke="#fff" stroke-width="3"/><circle cx="24" cy="23" r="8" fill="#fff"/></svg>', label: 'Pinezka', where: 'Mapa (globus)', desc: 'Pinezka zdjęć na mapie. Liczba nad pinezką oznacza, ile zdjęć jest w tym miejscu; okrągły znacznik z liczbą to skupisko pinezek.' },
  { svg: '<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="10" fill="#d32f2f"/></svg>', label: 'Czerwona kropka', where: 'Przycisk menu', desc: 'Wskaźnik trwającej pracy: skanowanie folderu.' },
]

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const missing = []
const card = (it) => {
  const Icon = L[it.icon]
  if (!Icon) missing.push(it.icon)
  const svg = Icon ? renderToStaticMarkup(createElement(Icon, { size: 30, strokeWidth: 1.8 })) : '?'
  return `<article class="card" data-s="${esc((it.label + ' ' + it.icon + ' ' + it.where + ' ' + it.desc).toLowerCase())}">
  <div class="ico">${svg}</div>
  <div><h3>${esc(it.label)}</h3><code>${esc(it.icon)}</code>
  <p>${esc(it.desc)}</p><p class="where">Gdzie: ${esc(it.where)}</p></div></article>`
}
const customCard = (it) => `<article class="card" data-s="${esc((it.label + ' ' + it.where + ' ' + it.desc).toLowerCase())}">
  <div class="ico">${it.svg}</div>
  <div><h3>${esc(it.label)}</h3><code>niestandardowa</code><p>${esc(it.desc)}</p><p class="where">Gdzie: ${esc(it.where)}</p></div></article>`

const total = GROUPS.reduce((n, g) => n + g.items.length, 0) + CUSTOM.length
const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ikony FIBO</title>
<style>
:root{--bg:#f3f4f7;--panel:#fff;--text:#1c2430;--muted:#5f6b7c;--line:#dfe3e8;--accent:#6d5bf0;--tonal:color-mix(in srgb,#6d5bf0 13%,#fff)}
@media (prefers-color-scheme:dark){:root{--bg:#13112b;--panel:#1e1b4b;--text:#ecebf7;--muted:#a29fc4;--line:#34306b;--tonal:color-mix(in srgb,#6d5bf0 22%,#1e1b4b)}}
@media (prefers-color-scheme:dark){.fi{fill:#ffb627!important;fill-opacity:.95!important}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,Roboto,"Segoe UI",sans-serif;padding:24px 16px 48px}
main{max-width:1100px;margin:0 auto}h1{font:700 26px/1.2 system-ui;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
input{width:100%;min-height:46px;padding:10px 14px;font-size:16px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);margin-bottom:8px}
h2{font:650 18px/1.2 system-ui;margin:28px 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px}
.card{display:flex;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:14px}
.ico{flex:none;width:56px;height:56px;border-radius:16px;background:var(--tonal);color:var(--accent);display:grid;place-items:center}
h3{margin:0 0 2px;font:650 16px/1.25 system-ui}code{font-size:12px;color:var(--muted)}p{margin:6px 0 0;font-size:14px}.where{color:var(--muted);font-size:12.5px}
.empty{display:none;color:var(--muted);padding:24px 0}
</style></head><body><main>
<h1>Ikony aplikacji FIBO</h1>
<p class="sub">${total} elementów. Ikony: własny zestaw FIBO w stylu logo (plik src/FiboIcons.tsx); nazwy w kodzie są zgodne z biblioteką Lucide. Plik wygenerowano skryptem scripts/icon-catalog.mjs.</p>
<input id="q" type="search" placeholder="Szukaj ikony: nazwa, opis albo miejsce użycia" aria-label="Szukaj ikony">
${GROUPS.map((g) => `<section><h2>${esc(g.title)}</h2><div class="grid">${g.items.map(card).join('\n')}</div></section>`).join('\n')}
<section><h2>Elementy niestandardowe</h2><div class="grid">${CUSTOM.map(customCard).join('\n')}</div></section>
<p class="empty" id="none">Brak ikon pasujących do szukania.</p>
</main>
<script>
const q=document.getElementById('q'),cards=[...document.querySelectorAll('.card')],none=document.getElementById('none');
q.addEventListener('input',()=>{const t=q.value.trim().toLowerCase();let n=0;cards.forEach(c=>{const ok=!t||c.dataset.s.includes(t);c.style.display=ok?'':'none';if(ok)n++});
document.querySelectorAll('section').forEach(s=>{s.style.display=[...s.querySelectorAll('.card')].some(c=>c.style.display!=='none')?'':'none'});none.style.display=n?'none':'block'});
</script></body></html>`

const out = new URL('../../IKONY_FIBO.html', import.meta.url)
writeFileSync(out, html, 'utf8')
console.log(`Zapisano ${out.pathname}; elementów: ${total}; brakujące ikony: ${missing.join(', ') || 'brak'}`)
