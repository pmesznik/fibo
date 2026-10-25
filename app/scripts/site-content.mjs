// Treść strony FIBO (polski i angielski). Generator: scripts/build-site.mjs.
// Zmieniasz teksty tutaj, potem:  node scripts/build-site.mjs   i commit folderu site/.

const kbd = (...k) => k.map((x) => `<kbd>${x}</kbd>`).join(' + ')

export const REPO = 'pmesznik/fibo'

export const PL = {
  lang: 'pl',
  other: { lang: 'en', label: 'English' },
  title: 'FIBO: menedżer i edytor zdjęć na Windows',
  description: 'FIBO porządkuje zdjęcia według dat, tagów i miejsc, ma edytor z efektami, kolaże i wyszukiwanie duplikatów. Wszystko lokalnie, na licencji GPL.',
  tagline: 'Twoje zdjęcia w złotym podziale',
  lead: 'FIBO to menedżer i edytor zdjęć na Windows, inspirowany Picasą 3. Porządkuje zdjęcia według lat, tagów i miejsc na globusie, poprawia je jednym kliknięciem i szuka duplikatów. Wszystko dzieje się na Twoim komputerze.',
  nav: { docs: 'Dokumentacja', features: 'Funkcje', download: 'Pobierz', github: 'Kod na GitHubie', toc: 'Spis treści' },
  dl: {
    button: 'Pobierz FIBO {v} na Windows',
    fallback: 'Pobierz najnowszą wersję',
    meta: 'Windows 10 i 11, 64-bitowy · instalator {size} · {date}',
    metaFallback: 'Windows 10 i 11, 64-bitowy',
    all: 'Wszystkie wersje',
    note: 'Instalator nie jest jeszcze podpisany cyfrowo, więc Windows może ostrzec przy pierwszym uruchomieniu. Szczegóły w sekcji „Instalacja”.',
    name: 'Nazwa pliku zawiera numer wersji, np. FIBO_{v}_x64-setup.exe.',
  },
  featuresTitle: 'Co potrafi FIBO',
  features: [
    { icon: 'Images', t: 'Biblioteka według lat', d: 'Zdjęcia ułożone według daty zrobienia, z nagłówkami lat i miesięcy oraz siatką w oryginalnych proporcjach.' },
    { icon: 'Tag', t: 'Tagi, oceny, ulubione', d: 'Oznaczaj zdjęcia tagami i gwiazdkami, filtruj i szukaj. Bez konta i bez chmury.' },
    { icon: 'Wand2', t: 'Edytor z efektami', d: 'Szybkie poprawki, kadrowanie, krzywe światła i ponad 30 efektów. Oryginał zawsze zostaje bezpieczny.' },
    { icon: 'LayoutDashboard', t: 'Kolaże', d: 'Siatka, mozaika, stos zdjęć lub kontaktówka z zaznaczonych zdjęć, gotowe do wydruku.' },
    { icon: 'MapPin', t: 'Globus ze zdjęciami', d: 'Pinezki w miejscach, gdzie zrobiono zdjęcia. Kliknij pinezkę i zobacz zdjęcia z tego miejsca.' },
    { icon: 'Copy', t: 'Duplikaty', d: 'Znajduje identyczne i podobne zdjęcia, proponuje najlepsze i przenosi resztę do Kosza.' },
  ],
  docsTitle: 'Dokumentacja',
  docs: [
    { id: 'install', t: 'Instalacja', h: `
      <p><strong>Wymagania:</strong> Windows 10 lub 11 (64-bitowy). Środowisko WebView2 jest w Windows 11 i w nowszych Windows 10. Jeśli go brakuje, instalator pobierze je sam, więc wtedy potrzebne jest połączenie z internetem.</p>
      <ol>
        <li>Pobierz plik <code>FIBO_&lt;wersja&gt;_x64-setup.exe</code> ze strony głównej lub z <a href="https://github.com/${REPO}/releases/latest">wydań na GitHubie</a>.</li>
        <li>Uruchom go. Instalacja jest tylko dla Twojego konta i nie wymaga uprawnień administratora.</li>
        <li>FIBO pojawi się w menu Start.</li>
      </ol>
      <div class="note"><strong>Windows ostrzega albo blokuje instalator?</strong> Instalator nie jest jeszcze podpisany certyfikatem, więc:
        <ul>
          <li><strong>SmartScreen</strong> („Windows ochronił Twój komputer”): kliknij <em>Więcej informacji</em>, potem <em>Uruchom mimo to</em>.</li>
          <li><strong>Kontrola aplikacji inteligentnej</strong> (Smart App Control) może zablokować niepodpisany program całkowicie. Wtedy zostaje poczekać na wersję podpisaną albo wyłączyć tę funkcję w Zabezpieczeniach Windows. Pamiętaj, że po wyłączeniu nie da się jej włączyć z powrotem bez przywracania systemu, więc to Twoja decyzja.</li>
        </ul>
      </div>
      <p><strong>Odinstalowanie:</strong> Ustawienia → Aplikacje → FIBO → Odinstaluj. Biblioteka i miniatury zostają w folderze danych (patrz „Dane i prywatność”), więc po ponownej instalacji niczego nie tracisz.</p>` },
    { id: 'start', t: 'Pierwsze kroki', h: `
      <ol>
        <li>Dotknij <strong>+</strong> w prawym górnym rogu i wskaż folder ze zdjęciami. FIBO przeszuka go razem z podfolderami.</li>
        <li>Zdjęcia pojawiają się w trakcie skanowania. Duże biblioteki skanują się partiami, więc widać postęp.</li>
        <li>Dwuklik na zdjęciu otwiera podgląd na cały ekran z edytorem.</li>
      </ol>
      <p>Obsługiwane formaty: JPG, PNG, WebP, GIF, BMP i TIFF. Pliki RAW, HEIC i wideo nie są jeszcze obsługiwane.</p>
      <p><strong>Układ ekranu.</strong> Główny ekran jest czysty: przycisk menu (☰) w lewym górnym rogu, przycisk <strong>+</strong> w prawym i pływający pasek widoków u góry (Biblioteka, Albumy, Ulubione, Ludzie, Mapa). Narzędzia są w menu po lewej: szukanie, szybkie akcje, filtry, tagi, foldery i wygląd.</p>` },
    { id: 'library', t: 'Biblioteka i albumy', h: `
      <ul>
        <li><strong>Grupowanie według daty.</strong> Zdjęcia są ułożone według daty zrobienia (z danych EXIF, a gdy ich brak, z daty pliku). Nagłówki pokazują lata albo miesiące, a chipy „Rok” przewijają do wybranego roku. Przełączasz to w menu → Wygląd → Grupowanie.</li>
        <li><strong>Siatka.</strong> Domyślnie wiersze o równej wysokości, w których każde zdjęcie zachowuje swoje proporcje. Możesz przejść na równe kafelki 4:3 i zmienić rozmiar miniatur w menu → Wygląd.</li>
        <li><strong>Albumy</strong> to foldery ze zdjęciami pogrupowane według roku, od najnowszych. Rok albumu to rok jego najnowszego zdjęcia.</li>
        <li><strong>Ulubione</strong> pokazują zdjęcia oznaczone sercem.</li>
        <li><strong>Zaznaczanie wielu zdjęć:</strong> ${kbd('Ctrl')} + klik dokłada zdjęcie, ${kbd('Shift')} + klik zaznacza zakres. Tryb „Zaznaczanie wielu” w menu zastępuje Ctrl.</li>
        <li><strong>Pokaz slajdów</strong> uruchamiasz z menu albo w podglądzie (spacja).</li>
      </ul>` },
    { id: 'search', t: 'Szukanie i filtry', h: `
      <p>W menu, w polu <em>Szukaj</em>, wpisz fragment nazwy pliku, aparatu albo tagu. W sekcji <em>Filtry</em>:</p>
      <ul>
        <li><strong>Ocena i sortowanie:</strong> minimalna liczba gwiazdek, sortowanie od najnowszych, od najstarszych lub po nazwie (przy sortowaniu po nazwie grupy według dat są wyłączone).</li>
        <li><strong>Tagi:</strong> wybranie kilku tagów pokazuje zdjęcia, które mają wszystkie z nich.</li>
        <li><strong>Foldery:</strong> ogranicza bibliotekę do jednego folderu.</li>
      </ul>
      <p>Aktywne filtry widać jako chipy nad siatką, a kliknięcie chipa usuwa filtr.</p>` },
    { id: 'tags', t: 'Tagi, oceny i ulubione', h: `
      <ul>
        <li><strong>Tagi:</strong> zaznacz jedno lub kilka zdjęć i dotknij ikony tagu na pasku na dole. Wpisz nazwę i zatwierdź Enterem albo wybierz istniejący tag. Tagi zapisują się małymi literami (do 40 znaków). Przy kilku zdjęciach tag częściowo przypisany pokazuje „2/5”. Ten sam edytor tagów jest w podglądzie w zakładce Info.</li>
        <li><strong>Usuwanie tagu ze wszystkich zdjęć:</strong> menu → Tagi → wybierz tag → „Usuń tag”. Program prosi o potwierdzenie, a same zdjęcia zostają.</li>
        <li><strong>Oceny:</strong> od 1 do 5 gwiazdek (klawisze ${kbd('1')}–${kbd('5')}, a ${kbd('0')} zeruje).</li>
        <li><strong>Ulubione:</strong> serce lub klawisz ${kbd('F')}.</li>
      </ul>` },
    { id: 'viewer', t: 'Podgląd zdjęcia', h: `
      <p>Dwuklik na zdjęciu (albo Enter) otwiera je na cały ekran. U góry są nazwa, ocena, ulubione, cofnij i ponów, pokaz slajdów i pełny ekran, a na dole pasek miniatur. Strzałki przy krawędziach przełączają zdjęcia.</p>
      <p>Przycisk różdżki (lub klawisz ${kbd('E')}) otwiera panel edycji. Zakładka <strong>Info</strong> pokazuje nazwę, folder, wymiary, rozmiar, datę zdjęcia, aparat i tagi.</p>` },
    { id: 'editor', t: 'Edytor zdjęć', h: `
      <p>Panel edycji ma cztery zakładki. Zmiany widać na żywo, a cofnąć je można bez ograniczeń w trakcie edycji (${kbd('Ctrl', 'Z')} i ${kbd('Ctrl', 'Y')}).</p>
      <ul>
        <li><strong>Podstawowe:</strong> Szczęśliwy traf, Auto kontrast, Auto kolor i Doświetlenie jednym kliknięciem; obrót i odbicie; prostowanie; usuwanie czerwonych oczu (kliknij środek oka); kadrowanie w proporcjach 1:1, 4:3, 3:2, 16:9 i innych, ze zbliżeniem i przesunięciem.</li>
        <li><strong>Dostrajanie:</strong> doświetlenie, światła, cienie, jasność, kontrast, gamma, temperatura barwowa, nasycenie i wyostrzenie. Dwuklik na suwaku zeruje go.</li>
        <li><strong>Efekty</strong> (ponad 30, część z suwakiem siły): czarno-białe, sepia, ocieplenie, ziarno filmowe, poświata, Orton, miękki fokus, winieta, Lomo, Polaroid, HDR, mapa cieplna, noktowizor, posteryzacja, pikselizacja, szkic ołówkiem, komiks, neon, ramka i inne. Nakładają się w kolejności wyboru.</li>
      </ul>
      <h3>Zapisywanie</h3>
      <ul>
        <li><strong>Zapisz zmiany</strong> nadpisuje plik. Wcześniej FIBO kopiuje oryginał do folderu <code>.originals</code> obok zdjęcia (tylko za pierwszym razem).</li>
        <li><strong>Zapisz jako kopię</strong> tworzy nowy plik z dopiskiem <code>_edit</code>, a oryginał zostaje bez zmian.</li>
        <li><strong>Przywróć oryginał</strong> cofa nadpisanie z kopii w <code>.originals</code>.</li>
        <li>GIF, BMP i TIFF zawsze zapisują się jako kopia JPG. Zapis usuwa dane EXIF z pliku, ale data zdjęcia, aparat i współrzędne GPS zostają w bazie FIBO.</li>
      </ul>` },
    { id: 'collage', t: 'Kolaże', h: `
      <p>Zaznacz co najmniej dwa zdjęcia (do 30) i wybierz <strong>Kolaż</strong> z paska na dole albo z menu.</p>
      <ul>
        <li><strong>Układy:</strong> Siatka, Mozaika (wiersze wypełniające płótno), Stos zdjęć (rozrzucone, w białych ramkach; przycisk „Przemieszaj” losuje nowy układ) i Kontaktówka (z nazwami plików).</li>
        <li><strong>Płótno:</strong> proporcje 16:9, 4:3, 3:2, 1:1, 3:4 lub 9:16, cztery tła, odstęp i zaokrąglenie rogów.</li>
        <li><strong>Zapis:</strong> nowy plik JPG o szerokości 2800 px, <code>kolaz_RRRRMMDD_GGMMSS.jpg</code>, w folderze pierwszego zdjęcia. Oryginały nie są zmieniane.</li>
      </ul>` },
    { id: 'map', t: 'Mapa', h: `
      <p>Zakładka <strong>Mapa</strong> pokazuje globus z pinezkami w miejscach, gdzie zrobiono zdjęcia. Zdjęcia z jednego miejsca łączą się w jedną pinezkę z liczbą, a bliskie pinezki w skupisko. Kliknięcie skupiska przybliża widok, a kliknięcie pinezki otwiera panel z miniaturami. Kliknięcie miniatury otwiera podgląd.</p>
      <ul>
        <li>Pozycje pochodzą z danych GPS w zdjęciach (EXIF). Zdjęcia bez GPS nie pojawiają się na mapie, a licznik w rogu pokazuje, ile ich jest.</li>
        <li>Zdjęcia dodane przed obsługą mapy nie mają zapisanych współrzędnych: wybierz <em>Wczytaj lokalizacje ze zdjęć</em> w zakładce Mapa albo <em>Odśwież dane zdjęć</em> w menu.</li>
        <li>Mapa pobiera kafelki z darmowej usługi OpenFreeMap, więc <strong>wymaga internetu</strong>. Reszta programu działa offline.</li>
      </ul>` },
    { id: 'duplicates', t: 'Duplikaty', h: `
      <p>Menu → <strong>Duplikaty</strong>. Wybierz poziom i dotknij <em>Szukaj duplikatów</em>:</p>
      <ul>
        <li><strong>Identyczne pliki:</strong> ta sama zawartość (taki sam rozmiar i suma kontrolna). Najszybsze i bezpieczne.</li>
        <li><strong>Bardzo podobne:</strong> ten sam kadr po zmniejszeniu, kompresji lub drobnej korekcie.</li>
        <li><strong>Podobne:</strong> także serie ujęć. Mogą trafić się różne zdjęcia, więc sprawdzaj przed usunięciem.</li>
      </ul>
      <p>Wyniki to grupy zdjęć z wymiarami, rozmiarem, folderem i datą. Zdjęcie z koroną <em>Najlepsze</em> (największa rozdzielczość, potem największy plik) zostaje, a pozostałe są domyślnie zaznaczone do usunięcia. W każdej grupie musi zostać co najmniej jedno zdjęcie. <strong>Przenieś do Kosza</strong> pyta o zgodę i przenosi pliki do Kosza Windows, skąd można je przywrócić.</p>` },
    { id: 'data', t: 'Dane i prywatność', h: `
      <ul>
        <li><strong>Zdjęcia nie opuszczają komputera.</strong> FIBO nie ma kont, nie wysyła zdjęć ani statystyk. Jedyne połączenie z internetem to pobieranie kafelków mapy po otwarciu zakładki Mapa (i ewentualne pobranie WebView2 przy instalacji).</li>
        <li>Biblioteka (indeks, oceny, tagi, współrzędne) to baza <code>library.db</code> w folderze <code>%APPDATA%\\pl.local.menedzerzdjec</code>, a miniatury leżą w jego podfolderze <code>thumbs</code>. Kopię zapasową zrobisz, kopiując ten folder. Folder nazywa się tak ze względów technicznych i nie zmienia się przy aktualizacjach.</li>
        <li>Kopie oryginałów po edycji leżą w folderach <code>.originals</code> obok zdjęć.</li>
        <li>Usunięcie programu nie usuwa Twoich zdjęć ani biblioteki.</li>
      </ul>` },
    { id: 'shortcuts', t: 'Skróty klawiszowe', h: `
      <table>
        <thead><tr><th>Klawisze</th><th>Działanie</th></tr></thead>
        <tbody>
          <tr><td>Dwuklik / ${kbd('Enter')}</td><td>Otwórz zdjęcie w podglądzie</td></tr>
          <tr><td>${kbd('←')} ${kbd('→')}</td><td>Poprzednie i następne zdjęcie</td></tr>
          <tr><td>${kbd('Spacja')}</td><td>Pokaz slajdów: start i stop</td></tr>
          <tr><td>${kbd('E')}</td><td>Panel edycji</td></tr>
          <tr><td>${kbd('F')}</td><td>Ulubione</td></tr>
          <tr><td>${kbd('0')}–${kbd('5')}</td><td>Ocena (0 zeruje)</td></tr>
          <tr><td>${kbd('Ctrl', 'Z')} / ${kbd('Ctrl', 'Y')}</td><td>Cofnij / ponów zmianę w edytorze</td></tr>
          <tr><td>${kbd('Ctrl')} + klik / ${kbd('Shift')} + klik</td><td>Dodaj zdjęcie do zaznaczenia / zaznacz zakres</td></tr>
          <tr><td>${kbd('Esc')}</td><td>Zamyka kolejno: tryb czerwonych oczu, panel edycji, pełny ekran, podgląd, menu</td></tr>
        </tbody>
      </table>` },
    { id: 'updates', t: 'Aktualizacje', h: `
      <p>Od wersji 0.2.0 FIBO sam sprawdza, czy na GitHubie jest nowsza wersja:</p>
      <ul>
        <li>Sprawdzenie następuje krótko po uruchomieniu (po cichu, gdy nie ma internetu) oraz na żądanie: menu → <strong>Sprawdź aktualizacje</strong>.</li>
        <li>Gdy jest nowa wersja, FIBO pyta: <em>Pobierz i zainstaluj</em>, <em>Później</em> albo <em>Pomiń tę wersję</em>. W oknie widać opis zmian.</li>
        <li>Po zgodzie FIBO pobiera instalator z paskiem postępu, instaluje go i uruchamia się ponownie. <strong>Zapisz najpierw otwarte edycje zdjęć.</strong></li>
        <li>Aktualizacje są podpisane kluczem autora, a program instaluje tylko te z poprawnym podpisem. Biblioteka, oceny i tagi zostają bez zmian.</li>
        <li>Numer wersji widać w nagłówku menu. Wersję 0.1.0 trzeba zaktualizować raz ręcznie, bo jeszcze nie ma tej funkcji.</li>
      </ul>` },
    { id: 'faq', t: 'Najczęstsze pytania', h: `
      <details><summary>Windows blokuje instalator albo program.</summary><p>Program nie jest jeszcze podpisany cyfrowo. Zobacz sekcję „Instalacja”: SmartScreen da się obejść przyciskiem „Uruchom mimo to”, a Kontrola aplikacji inteligentnej może wymagać wyłączenia albo poczekania na wersję podpisaną.</p></details>
      <details><summary>Mapa jest pusta lub pokazuje błąd.</summary><p>Mapa wymaga internetu. Jeśli jest połączenie, a pinezek brak, wybierz „Wczytaj lokalizacje ze zdjęć”: zdjęcia dodane wcześniej nie mają zapisanych współrzędnych. Zdjęcia bez GPS (np. zrzuty ekranu) nie pojawią się na mapie.</p></details>
      <details><summary>Pionowe zdjęcia mają złe proporcje w siatce.</summary><p>Dotknij „Odśwież dane zdjęć” w menu. To ponownie czyta wymiary z uwzględnieniem obrotu.</p></details>
      <details><summary>Czy edycja psuje oryginały?</summary><p>Nie. Przy nadpisaniu FIBO najpierw kopiuje oryginał do folderu <code>.originals</code>, a „Zapisz jako kopię” w ogóle nie rusza pliku. „Przywróć oryginał” cofa nadpisanie.</p></details>
      <details><summary>Czy usunięte duplikaty da się odzyskać?</summary><p>Tak. Pliki trafiają do Kosza Windows i stamtąd można je przywrócić.</p></details>
      <details><summary>Gdzie jest moja biblioteka?</summary><p>W <code>%APPDATA%\\pl.local.menedzerzdjec</code>. Zobacz „Dane i prywatność”.</p></details>` },
    { id: 'build', t: 'Budowanie ze źródeł', h: `
      <p>Wymagania: Node.js 22, Rust (stable) i Visual Studio Build Tools z C++.</p>
      <pre><code>git clone https://github.com/${REPO}.git
cd fibo/app
npm ci
npx tauri dev      # tryb deweloperski
npx tauri build    # instalator w src-tauri/target/release/bundle/nsis</code></pre>
      <p><strong>Nowa wersja:</strong> <code>node scripts/bump-version.mjs 0.2.0</code> ustawia numer wersji w trzech plikach. Po wypchnięciu tagu <code>v0.2.0</code> GitHub Actions buduje instalator i publikuje wydanie z plikiem <code>FIBO_0.2.0_x64-setup.exe</code>. Strona sama pobiera numer najnowszego wydania.</p>` },
    { id: 'license', t: 'Licencja', h: `
      <p>FIBO jest wolnym oprogramowaniem na licencji <a href="https://github.com/${REPO}/blob/main/LICENSE">GNU GPL w wersji 2 lub nowszej</a>. Możesz go używać, zmieniać i rozpowszechniać na warunkach tej licencji. Program jest dostarczany bez gwarancji. Mapa korzysta z danych © uczestnicy OpenStreetMap i kafelków OpenFreeMap.</p>` },
  ],
  footer: 'FIBO · GPL-2.0-or-later',
}

export const EN = {
  lang: 'en',
  other: { lang: 'pl', label: 'Polski' },
  title: 'FIBO: photo manager and editor for Windows',
  description: 'FIBO organizes photos by date, tags and place, with an editor, effects, collages and duplicate finder. Everything stays on your computer. Free software under the GPL.',
  tagline: 'Your photos in the golden ratio',
  lead: 'FIBO is a photo manager and editor for Windows, inspired by Picasa 3. It organizes photos by year, tag and place on a globe, fixes them in one click and finds duplicates. Everything happens on your own computer.',
  nav: { docs: 'Documentation', features: 'Features', download: 'Download', github: 'Source on GitHub', toc: 'Contents' },
  dl: {
    button: 'Download FIBO {v} for Windows',
    fallback: 'Download the latest version',
    meta: 'Windows 10 and 11, 64-bit · {size} installer · {date}',
    metaFallback: 'Windows 10 and 11, 64-bit',
    all: 'All versions',
    note: 'The installer is not code-signed yet, so Windows may warn you on first launch. See “Installation” for details.',
    name: 'The file name includes the version number, e.g. FIBO_{v}_x64-setup.exe.',
  },
  featuresTitle: 'What FIBO does',
  features: [
    { icon: 'Images', t: 'Library by year', d: 'Photos laid out by the date they were taken, with year and month headings and a grid that keeps original proportions.' },
    { icon: 'Tag', t: 'Tags, ratings, favorites', d: 'Label photos with tags and stars, filter and search. No account, no cloud.' },
    { icon: 'Wand2', t: 'Editor with effects', d: 'Quick fixes, cropping, light curves and over 30 effects. Your original always stays safe.' },
    { icon: 'LayoutDashboard', t: 'Collages', d: 'Grid, mosaic, photo pile or contact sheet from selected photos, ready to print.' },
    { icon: 'MapPin', t: 'Globe of photos', d: 'Pins where your photos were taken. Click a pin to see the photos from that place.' },
    { icon: 'Copy', t: 'Duplicates', d: 'Finds identical and similar photos, suggests the best one and moves the rest to the Recycle Bin.' },
  ],
  docsTitle: 'Documentation',
  docs: [
    { id: 'install', t: 'Installation', h: `
      <p><strong>Requirements:</strong> Windows 10 or 11 (64-bit). WebView2 ships with Windows 11 and recent Windows 10. If it is missing, the installer downloads it, so an internet connection is needed in that case.</p>
      <ol>
        <li>Download <code>FIBO_&lt;version&gt;_x64-setup.exe</code> from the home page or from the <a href="https://github.com/${REPO}/releases/latest">GitHub releases</a>.</li>
        <li>Run it. It installs for your user account only and needs no administrator rights.</li>
        <li>FIBO appears in the Start menu.</li>
      </ol>
      <div class="note"><strong>Windows warns or blocks the installer?</strong> The installer is not yet signed with a certificate, so:
        <ul>
          <li><strong>SmartScreen</strong> (“Windows protected your PC”): click <em>More info</em>, then <em>Run anyway</em>.</li>
          <li><strong>Smart App Control</strong> can block an unsigned program entirely. Then you can wait for a signed version or turn the feature off in Windows Security. Note that once turned off it cannot be turned back on without resetting Windows, so that is your call.</li>
        </ul>
      </div>
      <p><strong>Uninstall:</strong> Settings → Apps → FIBO → Uninstall. Your library and thumbnails stay in the data folder (see “Data and privacy”), so reinstalling loses nothing.</p>` },
    { id: 'start', t: 'Getting started', h: `
      <ol>
        <li>Click <strong>+</strong> in the top right corner and choose a folder with photos. FIBO scans it with all subfolders.</li>
        <li>Photos appear while scanning. Large libraries are scanned in batches, so you can see progress.</li>
        <li>Double-click a photo to open it full screen with the editor.</li>
      </ol>
      <p>Supported formats: JPG, PNG, WebP, GIF, BMP and TIFF. RAW, HEIC and video files are not supported yet.</p>
      <p><strong>Screen layout.</strong> The main screen is kept clean: the menu button (☰) top left, the <strong>+</strong> button top right and a floating view bar at the top (Library, Albums, Favorites, People, Map). Tools live in the menu on the left: search, quick actions, filters, tags, folders and appearance.</p>` },
    { id: 'library', t: 'Library and albums', h: `
      <ul>
        <li><strong>Grouping by date.</strong> Photos are ordered by the date taken (from EXIF data, or the file date if missing). Headings show years or months, and the “Year” chips scroll to a chosen year. Switch it in the menu → Appearance → Grouping.</li>
        <li><strong>Grid.</strong> By default, rows of equal height where every photo keeps its own proportions. You can switch to equal 4:3 tiles and change the thumbnail size in the menu → Appearance.</li>
        <li><strong>Albums</strong> are folders with photos grouped by year, newest first. An album’s year is the year of its newest photo.</li>
        <li><strong>Favorites</strong> shows photos marked with a heart.</li>
        <li><strong>Selecting many photos:</strong> ${kbd('Ctrl')} + click adds a photo, ${kbd('Shift')} + click selects a range. “Select many” mode in the menu replaces Ctrl.</li>
        <li><strong>Slideshow</strong> starts from the menu or in the viewer (space).</li>
      </ul>` },
    { id: 'search', t: 'Search and filters', h: `
      <p>In the menu, type part of a file name, camera or tag into <em>Search</em>. Under <em>Filters</em>:</p>
      <ul>
        <li><strong>Rating and sorting:</strong> minimum number of stars; sort newest first, oldest first or by name (date grouping is off when sorting by name).</li>
        <li><strong>Tags:</strong> selecting several tags shows photos that have all of them.</li>
        <li><strong>Folders:</strong> limits the library to one folder.</li>
      </ul>
      <p>Active filters appear as chips above the grid; clicking a chip removes the filter.</p>` },
    { id: 'tags', t: 'Tags, ratings and favorites', h: `
      <ul>
        <li><strong>Tags:</strong> select one or more photos and click the tag icon on the bottom bar. Type a name and press Enter, or pick an existing tag. Tags are stored in lowercase (up to 40 characters). With several photos, a partly applied tag shows “2/5”. The same tag editor is in the viewer’s Info tab.</li>
        <li><strong>Removing a tag from all photos:</strong> menu → Tags → pick the tag → “Remove tag”. The app asks for confirmation, and the photos themselves stay.</li>
        <li><strong>Ratings:</strong> 1 to 5 stars (keys ${kbd('1')}–${kbd('5')}, ${kbd('0')} clears).</li>
        <li><strong>Favorites:</strong> the heart or the ${kbd('F')} key.</li>
      </ul>` },
    { id: 'viewer', t: 'Photo viewer', h: `
      <p>Double-click a photo (or press Enter) to open it full screen. The top bar has the name, rating, favorite, undo and redo, slideshow and full screen; the bottom has a thumbnail strip. Arrows at the edges switch photos.</p>
      <p>The wand button (or the ${kbd('E')} key) opens the edit panel. The <strong>Info</strong> tab shows name, folder, dimensions, size, date taken, camera and tags.</p>` },
    { id: 'editor', t: 'Photo editor', h: `
      <p>The edit panel has four tabs. Changes show live, and you can undo without limits while editing (${kbd('Ctrl', 'Z')} and ${kbd('Ctrl', 'Y')}).</p>
      <ul>
        <li><strong>Basics:</strong> I’m Feeling Lucky, Auto Contrast, Auto Color and Fill Light in one click; rotate and flip; straighten; red-eye removal (click the center of the eye); cropping at 1:1, 4:3, 3:2, 16:9 and more, with zoom and pan.</li>
        <li><strong>Tuning:</strong> fill light, highlights, shadows, brightness, contrast, gamma, color temperature, saturation and sharpen. Double-click a slider to reset it.</li>
        <li><strong>Effects</strong> (over 30, some with a strength slider): black and white, sepia, warmify, film grain, glow, Orton, soft focus, vignette, Lomo, Polaroid, HDR, heat map, night vision, posterize, pixelate, pencil sketch, comic, neon, border and more. They stack in the order you pick them.</li>
      </ul>
      <h3>Saving</h3>
      <ul>
        <li><strong>Save changes</strong> overwrites the file. Before that FIBO copies the original to a <code>.originals</code> folder next to the photo (only the first time).</li>
        <li><strong>Save as copy</strong> creates a new file with <code>_edit</code> appended and leaves the original untouched.</li>
        <li><strong>Restore original</strong> undoes an overwrite from the copy in <code>.originals</code>.</li>
        <li>GIF, BMP and TIFF are always saved as a JPG copy. Saving removes EXIF data from the file, but the date taken, camera and GPS position stay in FIBO’s database.</li>
      </ul>` },
    { id: 'collage', t: 'Collages', h: `
      <p>Select at least two photos (up to 30) and choose <strong>Collage</strong> from the bottom bar or the menu.</p>
      <ul>
        <li><strong>Layouts:</strong> Grid, Mosaic (rows that fill the canvas), Photo pile (scattered, in white frames; “Shuffle” rolls a new arrangement) and Contact sheet (with file names).</li>
        <li><strong>Canvas:</strong> 16:9, 4:3, 3:2, 1:1, 3:4 or 9:16, four backgrounds, spacing and corner rounding.</li>
        <li><strong>Saving:</strong> a new 2800 px wide JPG, <code>kolaz_YYYYMMDD_HHMMSS.jpg</code>, in the first photo’s folder. Originals are never changed.</li>
      </ul>` },
    { id: 'map', t: 'Map', h: `
      <p>The <strong>Map</strong> tab shows a globe with pins where your photos were taken. Photos from one place share a pin with a count, and nearby pins form a cluster. Click a cluster to zoom in, or a pin to open a panel with thumbnails. Click a thumbnail to open the viewer.</p>
      <ul>
        <li>Positions come from the GPS data in your photos (EXIF). Photos without GPS do not appear, and the counter in the corner shows how many there are.</li>
        <li>Photos added before map support have no stored coordinates: choose <em>Load locations from photos</em> in the Map tab or <em>Refresh photo data</em> in the menu.</li>
        <li>The map downloads tiles from the free OpenFreeMap service, so it <strong>needs internet</strong>. The rest of the app works offline.</li>
      </ul>` },
    { id: 'duplicates', t: 'Duplicates', h: `
      <p>Menu → <strong>Duplicates</strong>. Pick a level and click <em>Find duplicates</em>:</p>
      <ul>
        <li><strong>Identical files:</strong> same content (same size and checksum). Fastest and safe.</li>
        <li><strong>Very similar:</strong> the same shot after resizing, recompression or a small edit.</li>
        <li><strong>Similar:</strong> also bursts of shots. Different photos can show up, so check before deleting.</li>
      </ul>
      <p>Results are groups of photos with dimensions, size, folder and date. The photo with the crown <em>Best</em> (highest resolution, then largest file) stays, and the others are pre-selected for removal. At least one photo always stays in each group. <strong>Move to Recycle Bin</strong> asks for confirmation and moves files to the Windows Recycle Bin, from where you can restore them.</p>` },
    { id: 'data', t: 'Data and privacy', h: `
      <ul>
        <li><strong>Your photos never leave your computer.</strong> FIBO has no accounts and sends no photos or statistics. The only internet use is downloading map tiles when you open the Map tab (and possibly downloading WebView2 during installation).</li>
        <li>The library (index, ratings, tags, coordinates) is the <code>library.db</code> database in <code>%APPDATA%\\pl.local.menedzerzdjec</code>, and thumbnails are in its <code>thumbs</code> subfolder. Back it up by copying that folder. The folder has that name for technical reasons and does not change across updates.</li>
        <li>Copies of originals after editing are in <code>.originals</code> folders next to your photos.</li>
        <li>Uninstalling does not delete your photos or your library.</li>
      </ul>` },
    { id: 'shortcuts', t: 'Keyboard shortcuts', h: `
      <table>
        <thead><tr><th>Keys</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td>Double-click / ${kbd('Enter')}</td><td>Open photo in viewer</td></tr>
          <tr><td>${kbd('←')} ${kbd('→')}</td><td>Previous and next photo</td></tr>
          <tr><td>${kbd('Space')}</td><td>Slideshow: start and stop</td></tr>
          <tr><td>${kbd('E')}</td><td>Edit panel</td></tr>
          <tr><td>${kbd('F')}</td><td>Favorite</td></tr>
          <tr><td>${kbd('0')}–${kbd('5')}</td><td>Rating (0 clears)</td></tr>
          <tr><td>${kbd('Ctrl', 'Z')} / ${kbd('Ctrl', 'Y')}</td><td>Undo / redo an editor change</td></tr>
          <tr><td>${kbd('Ctrl')} + click / ${kbd('Shift')} + click</td><td>Add photo to selection / select a range</td></tr>
          <tr><td>${kbd('Esc')}</td><td>Closes in turn: red-eye mode, edit panel, full screen, viewer, menu</td></tr>
        </tbody>
      </table>` },
    { id: 'updates', t: 'Updates', h: `
      <p>Starting with version 0.2.0, FIBO checks GitHub for a newer version by itself:</p>
      <ul>
        <li>The check runs shortly after launch (silently when offline) and on demand: menu → <strong>Check for updates</strong>.</li>
        <li>When a new version exists, FIBO asks: <em>Download and install</em>, <em>Later</em> or <em>Skip this version</em>. The release notes are shown in the dialog.</li>
        <li>If you agree, FIBO downloads the installer with a progress bar, installs it and restarts. <strong>Save any open photo edits first.</strong></li>
        <li>Updates are signed with the author’s key, and the app installs only updates with a valid signature. Your library, ratings and tags are untouched.</li>
        <li>The version number is shown in the menu header. Version 0.1.0 must be updated by hand once, because it does not have this feature yet.</li>
      </ul>` },
    { id: 'faq', t: 'FAQ', h: `
      <details><summary>Windows blocks the installer or the program.</summary><p>The program is not signed yet. See “Installation”: SmartScreen can be bypassed with “Run anyway”, while Smart App Control may require turning it off or waiting for a signed version.</p></details>
      <details><summary>The map is empty or shows an error.</summary><p>The map needs internet. If you are online but there are no pins, choose “Load locations from photos”: photos added earlier have no stored coordinates. Photos without GPS (such as screenshots) do not appear on the map.</p></details>
      <details><summary>Portrait photos have the wrong proportions in the grid.</summary><p>Click “Refresh photo data” in the menu. It re-reads the dimensions taking rotation into account.</p></details>
      <details><summary>Does editing damage my originals?</summary><p>No. When overwriting, FIBO first copies the original to the <code>.originals</code> folder, and “Save as copy” does not touch the file at all. “Restore original” undoes an overwrite.</p></details>
      <details><summary>Can I get deleted duplicates back?</summary><p>Yes. Files go to the Windows Recycle Bin, from where you can restore them.</p></details>
      <details><summary>Where is my library?</summary><p>In <code>%APPDATA%\\pl.local.menedzerzdjec</code>. See “Data and privacy”.</p></details>` },
    { id: 'build', t: 'Building from source', h: `
      <p>Requirements: Node.js 22, Rust (stable) and Visual Studio Build Tools with C++.</p>
      <pre><code>git clone https://github.com/${REPO}.git
cd fibo/app
npm ci
npx tauri dev      # development mode
npx tauri build    # installer in src-tauri/target/release/bundle/nsis</code></pre>
      <p><strong>New version:</strong> <code>node scripts/bump-version.mjs 0.2.0</code> sets the version number in three files. After pushing the tag <code>v0.2.0</code>, GitHub Actions builds the installer and publishes a release with the file <code>FIBO_0.2.0_x64-setup.exe</code>. This site fetches the latest release number by itself.</p>` },
    { id: 'license', t: 'License', h: `
      <p>FIBO is free software under the <a href="https://github.com/${REPO}/blob/main/LICENSE">GNU GPL version 2 or later</a>. You may use, change and redistribute it under the terms of that license. The program comes with no warranty. The map uses data © OpenStreetMap contributors and OpenFreeMap tiles.</p>` },
  ],
  footer: 'FIBO · GPL-2.0-or-later',
}
