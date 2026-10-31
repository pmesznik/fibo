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
      <p>Obsługiwane formaty: JPG, PNG, WebP, GIF, BMP, TIFF, ICO, AVIF, SVG, HEIC i HEIF (zdjęcia z iPhone'a), JPEG XL, PSD (Photoshop), TGA, PNM, DDS, HDR, QOI i OpenEXR, a także pliki RAW aparatów (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 i wiele innych). Wszystko jest odczytywane na tym komputerze. Pliki w formatach innych niż JPG, PNG i WebP edytujesz zawsze jako kopię, a oryginał zostaje nietknięty. Zdjęcia RAW możesz w edytorze wywołać od nowa z surowych danych matrycy (ekspozycja, balans bieli, miękkie odzyskiwanie świateł). Filmy MP4, MOV, WebM i Ogg są w bibliotece z miniaturą i odtwarzaczem (kodeki dekoduje okno programu, więc film H.265 zależy od zainstalowanego rozszerzenia Windows); nie da się ich edytować.</p>
      <p><strong>Układ ekranu.</strong> Główny ekran jest czysty: przycisk menu (☰) w lewym górnym rogu, przycisk <strong>+</strong> w prawym i pływający pasek widoków u góry (Biblioteka, Albumy, Ulubione, Osoby, Mapa). Narzędzia są w menu po lewej: szukanie, szybkie akcje, filtry, tagi, foldery i wygląd.</p>` },
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
    { id: 'xmp', t: 'Metadane w plikach (XMP)', h: `
      <p>Tagi, oceny i ulubione zapisują się nie tylko w bibliotece FIBO, ale też w plikach XMP obok zdjęć (np. <code>foto.jpg.xmp</code>). Dzięki temu nie giną razem z bazą, a inne programy (digiKam, Lightroom, darktable) mogą je odczytać. Same zdjęcia nie są zmieniane.</p>
      <ul>
        <li><strong>Zapis automatyczny</strong> jest domyślnie włączony. Wyłączysz go w menu → <em>Metadane w plikach</em>. Tam też jest przycisk <em>Zapisz wszystko do plików XMP</em>.</li>
        <li><strong>Pliki XMP innych programów</strong> zostają nietknięte: FIBO rozpoznaje je po braku własnego znacznika i pomija.</li>
        <li><strong>Wczytywanie:</strong> przy dodawaniu zdjęć FIBO bierze tagi i oceny, które zdjęcia już mają: z Eksploratora Windows („Tagi” i „Oceny”), z XMP i IPTC w plikach JPEG (tak zapisywała Picasa) oraz z plików <code>.xmp</code> obok zdjęć. Dla zdjęć już obecnych w bibliotece służy przycisk <em>Wczytaj tagi i oceny z plików</em>. Wczytywanie tylko uzupełnia: nie nadpisuje ocen i nie usuwa tagów.</li>
        <li>Tag, który zdjęcie już ma, nie jest dodawany drugi raz.</li>
      </ul>` },
    { id: 'albums', t: 'Własne albumy', h: `
      <p>Albumy w zakładce <strong>Albumy → Moje albumy</strong> nie zależą od folderów: to Twoje zbiory zdjęć, a jedno zdjęcie może być w wielu albumach. Pliki zostają na swoim miejscu.</p>
      <ul>
        <li>Nowy album: przycisk <em>Nowy album</em> albo prawy przycisk myszy na zaznaczonych zdjęciach → <em>Dodaj do albumu…</em> → <em>Nowy album…</em>.</li>
        <li>Wejście w album pokazuje jego zdjęcia w bibliotece. Prawy przycisk → <em>Usuń z tego albumu</em> wyjmuje zdjęcia z albumu (nie z dysku).</li>
        <li>Przy albumie są przyciski zmiany nazwy i usunięcia. Usunięcie albumu nie usuwa zdjęć. Nazwy albumów nie powtarzają się (wielkość liter nie ma znaczenia).</li>
      </ul>` },
    { id: 'watch', t: 'Obserwowane foldery', h: `
      <p>Folder dodany przyciskiem <em>Dodaj folder</em> jest od tej chwili obserwowany. FIBO sprawdza go <strong>po uruchomieniu, po powrocie do okna (najwyżej raz na 30 sekund) i co 5 minut</strong>:</p>
      <ul>
        <li>nowe zdjęcia dodają się same, razem z tagami i ocenami zapisanymi w pliku (pokazuje się powiadomienie),</li>
        <li>zdjęcia, których pliki zniknęły z dysku, znikają z biblioteki. Jeśli cały folder jest niedostępny (np. odłączony dysk), nic nie jest usuwane,</li>
        <li>niezmienione pliki są pomijane, więc sprawdzanie dużej biblioteki jest szybkie.</li>
      </ul>
      <p>Listę obserwowanych folderów widać w menu → <em>Obserwowane foldery</em>. Kliknięcie folderu (po potwierdzeniu) przestaje go obserwować, a zdjęcia zostają w bibliotece. Przycisk <em>Sprawdź nowe zdjęcia teraz</em> robi sprawdzenie od razu.</p>` },
    { id: 'files', t: 'Operacje na plikach', h: `
      <p>Kliknij prawym przyciskiem myszy zdjęcie lub zaznaczenie. Menu działa na wszystkich zaznaczonych zdjęciach:</p>
      <ul>
        <li><strong>Ocena</strong> (gwiazdki), <strong>ulubione</strong>, <strong>Tagi…</strong>, <strong>Dodaj do albumu…</strong>, <strong>Kolaż</strong> (od dwóch zdjęć), <strong>Zaznacz wszystkie</strong>.</li>
        <li><strong>Zmień nazwę pliku…</strong> (jedno zdjęcie): rozszerzenie zostaje, plik XMP zmienia nazwę razem ze zdjęciem. FIBO odrzuca nazwy ze znakami niedozwolonymi w Windows (<code>\\ / : * ? " &lt; &gt; |</code>), zarezerwowane (CON, NUL, COM1…) i nie nadpisuje istniejącego pliku.</li>
        <li><strong>Przenieś do folderu…</strong> i <strong>Kopiuj do folderu…</strong>: nic nie jest nadpisywane, przy zajętej nazwie FIBO dopisuje <code>_1</code>, <code>_2</code>. Plik XMP idzie razem ze zdjęciem. Przenoszenie między dyskami kopiuje, sprawdza rozmiar i dopiero wtedy usuwa źródło.</li>
        <li><strong>Właściwości albumu i folderu</strong>: przy albumie (ikona informacji) i w menu → Foldery można ustawić datę, miejsce i opis. Widać je pod tytułem albumu lub folderu, a szukanie obejmuje te pola. Zapisują się tylko w bibliotece FIBO.</li>
        <li><strong>Galeria HTML</strong> (menu prawym przyciskiem → Eksportuj pomniejszone… → Utwórz galerię HTML): tworzy folder z plikiem <em>index.html</em>, zdjęciami i miniaturami. Strona ma powiększanie, opisy i działa offline, bez żadnych zasobów z internetu. Zdjęcia w galerii nie mają danych EXIF (także lokalizacji).</li>
        <li><strong>Zmień nazwę folderu…</strong> (menu → Foldery, po wybraniu folderu): zmienia nazwę folderu na dysku i poprawia ścieżki zdjęć w bibliotece. Lista folderów może być sortowana od najnowszych albo po nazwie.</li>
        <li><strong>Taca zdjęć</strong>: prawym przyciskiem <em>Dodaj do tacy</em> zbiera zdjęcia z różnych folderów i albumów. Pasek <em>Taca</em> w lewym dolnym rogu pozwala je pokazać, zaznaczyć wszystkie naraz (i wtedy użyć menu: album, eksport, kolaż, nazwy, data) albo wyczyścić tacę.</li>
        <li><strong>Oś czasu</strong>: suwak nad zdjęciami przenosi do wybranego miesiąca lub roku (przy większej liczbie grup).</li>
        <li><strong>Muzyka w pokazie slajdów</strong>: ikona iskier w podglądzie pozwala wybrać plik muzyczny (mp3, m4a, aac, ogg, wav, flac, do 80 MB). Gra w pętli tylko podczas pokazu, a zdjęcia zmieniają się płynnym przejściem. Plik jest czytany lokalnie, nic nie jest wysyłane.</li>
        <li><strong>Pokaz slajdów</strong>: przycisk z liczbą sekund zmienia czas jednego slajdu (2, 4, 7 lub 12 s), a opis zdjęcia (jeśli jest) pojawia się na dole podczas pokazu. Klawisze 0-5 oceniają zdjęcie w trakcie pokazu.</li>
        <li><strong>Neutralny kolor (zakraplacz)</strong> w edytorze: kliknij na zdjęciu miejsce, które powinno być szare lub białe, a FIBO wyrówna balans bieli. Korektę można usunąć przyciskiem pod ikonami.</li>
        <li><strong>Dane EXIF</strong> (podgląd → Informacje): aparat, obiektyw, czas naświetlania, przysłona, ISO, ogniskowa, lampa i inne pola z pliku.</li>
        <li><strong>Statystyki i skróty klawiszowe</strong> (menu → szybkie akcje): liczby zdjęć według lat, aparatów, tagów i lokalizacji oraz lista skrótów. W bibliotece klawisze 0-5 ustawiają ocenę, F ulubione, a ? lub F1 pokazuje pomoc.</li>
        <li><strong>Szukanie po danych aparatu</strong>: pole szukania znajduje też zdjęcia po modelu aparatu, obiektywie, ISO, przysłonie, czasie naświetlania i ogniskowej (np. „ISO 400”, „RF24”, „f/2.8”). Dla zdjęć dodanych wcześniej wybierz <em>Odśwież dane zdjęć</em> w menu.</li>
        <li><strong>Opis zdjęcia</strong> (podgląd → Informacje): pole „Opis zdjęcia” zapisuje się po opuszczeniu pola. Szukanie obejmuje teraz opisy, nazwy albumów, nazwy folderów, aparat, tagi i nazwy plików.</li>
        <li><strong>Zmień datę…</strong> (menu prawym przyciskiem): ustaw dokładną datę i godzinę albo przesuń daty zaznaczonych zdjęć o dni, godziny i minuty (np. gdy aparat miał zły zegar). Zmiana dotyczy biblioteki FIBO, a plików zdjęć nie zmieniamy.</li>
        <li><strong>Kopiuj i wklej edycję</strong>: w edytorze „Kopiuj edycję” zapamiętuje korekty, efekty i napisy (bez kadrowania i obrotu), a „Wklej edycję” nakłada je na inne zdjęcie. W bibliotece <em>Wklej edycję do zaznaczonych…</em> robi to dla wielu zdjęć naraz i zapisuje wyniki jako kopie obok oryginałów.</li>
        <li><strong>Osoby w podglądzie</strong>: na zdjęciu widać znaczki rozpoznanych osób, a kliknięcie znaczka pokazuje wszystkie zdjęcia tej osoby.</li>
        <li><strong>Szukanie po treści zdjęć</strong> (menu → Szybkie akcje): wpisujesz, co jest na zdjęciu („pies na plaży”, „tort”, „góry”), a program pokazuje najlepiej pasujące zdjęcia. Działa lokalnie, na modelu CLIP dołączonym do instalatora, i zna ok. 130 pojęć po polsku i angielsku. Zdjęcia indeksuje się jednorazowo, na życzenie, w tle (około 0,2 s na zdjęcie).</li>
        <li><strong>Przeciąganie na foldery</strong>: gdy przeciągasz zdjęcia, na dole obok albumów pojawia się pasek folderów. Upuszczenie na folder pyta o potwierdzenie i przenosi pliki na dysku (razem z XMP i edycją). Foldery zablokowane przed zmianami nie są celem, a zajęta nazwa dostaje _1, _2.</li>
        <li><strong>Nazwy miejsc</strong>: zdjęcia ze współrzędnymi GPS dostają nazwę najbliższej miejscowości (np. „Warszawa, Polska”). Nazwa jest w informacjach o zdjęciu, w szukaniu i w sekcji <em>Miejsca</em> w menu. Działa bez internetu, na tabeli ok. 27 tysięcy miejscowości dołączonej do instalatora (dane GeoNames, CC BY 4.0). Zdjęcie dalej niż 30 km od jakiejkolwiek większej miejscowości nie dostaje nazwy.</li>
        <li><strong>Widok kalendarza</strong> (menu → Szybkie akcje): miesiąc w siatce, w każdym dniu miniatura pierwszego zdjęcia i liczba zdjęć. Strzałki, lista lat i skróty miesięcy pozwalają skakać po czasie, a kliknięcie dnia pokazuje jego zdjęcia. Daty biorą się z EXIF, a gdy ich brak, z daty pliku.</li>
        <li><strong>Znak wodny z tekstu</strong>: w eksporcie obok logo z pliku możesz wpisać tekst (np. „© Jan Kowalski 2026”), wybrać kolor, położenie, rozmiar i krycie. Tekst jest rysowany lokalnie i nakładany tylko na kopie, oryginały się nie zmieniają.</li>
        <li><strong>Pamięć miniatur</strong> (menu): pokazuje, ile miejsca zajmują miniatury, i czyści je jednym przyciskiem po potwierdzeniu. Zdjęć to nie rusza, a miniatury powstają od nowa. Miniatury zdjęć z zapisaną edycją zostają.</li>
        <li><strong>Dane IPTC i strefa czasowa</strong>: w menu zdjęcia <em>Autor, prawa i opis (IPTC)</em> zapisuje autora, prawa, tytuł, miejscowość i kraj (także w pliku XMP obok zdjęcia), a miejscowość i kraj mają pierwszeństwo przed nazwą z GPS. W <em>Zmień datę</em> tryb <em>Strefa czasowa</em> przelicza daty, gdy zegar aparatu szedł według innej strefy. Pliki zdjęć nie są zmieniane.</li>
        <li><strong>Upuszczanie z Eksploratora</strong>: przeciągnij zdjęcia albo foldery na okno FIBO, a program zapyta, czy dodać je do biblioteki. Foldery stają się obserwowane, pojedyncze zdjęcia są dodawane bez obserwowania, a pliki nie są kopiowane ani zmieniane.</li>
        <li><strong>Natychmiastowe wykrywanie nowych plików</strong>: gdy w obserwowanym folderze pojawi się, zniknie albo zmieni się zdjęcie, FIBO zauważa to po chwili ciszy, bez czekania na sprawdzanie co kilka minut. Pliki tworzone przez sam program (XMP i inne) nie wywołują sprawdzania.</li>
        <li><strong>Przegląd jakości zdjęć</strong> (menu → Szybkie akcje): program liczy lokalnie ostrość i jasność zdjęć (z miniatur, w tle) i pokazuje zdjęcia nieostre albo poruszone, ciemne i prześwietlone, od najgorszych, z suwakiem progu. Zaznaczone możesz oznaczyć jako odrzucone (pliki zostają, flagę zdejmiesz w każdej chwili). Zakładka <em>Najlepsze z serii</em> wskazuje najostrzejsze ujęcie każdej serii i jednym kliknięciem oznacza je jako wybrane. Zamknięte oczy nie są wykrywane.</li>
        <li><strong>Podpowiedzi tagów</strong> (menu → Szybkie akcje): na zaindeksowanych zdjęciach (jak w szukaniu po treści) program znajduje pojęcia, które pasują do wielu zdjęć, np. „plaża”, „pies”, „tort”. Przeglądasz miniatury, odznaczasz pomyłki i zatwierdzasz: tag dostają tylko zdjęcia, które zostawisz zaznaczone. Suwak ostrożności ustala, jak pewne muszą być podpowiedzi. Wszystko lokalnie.</li>
        <li><strong>Szukanie tekstu na zdjęciach</strong> (menu → Szybkie akcje): program czyta napisy na zdjęciach (paragony, tablice, dokumenty, znaki) lokalnie, małymi modelami PaddleOCR dołączonymi do instalatora (ok. 13 MB, licencja Apache-2.0), z polskimi znakami. Rozpoznawanie robisz raz, na życzenie, w tle (około 1 do 2 sekund na zdjęcie, można wstrzymać i wznowić). Potem wpisujesz słowa, a program pokazuje zdjęcia z takim tekstem, bez względu na wielkość liter i polskie znaki. Tekst zostaje w bibliotece na tym komputerze.</li>
        <li><strong>Krzywe, kolor HSL, mgła i klarowność</strong>: w edytorze, w zakładce <em>Dostrajanie</em>, widzisz histogram na żywo, rysujesz krzywe tonalne (jasność oraz osobno czerwień, zieleń i błękit; punkty dodajesz kliknięciem, przesuwasz myszą lub strzałkami, usuwasz dwuklikiem albo klawiszem Delete), zmieniasz barwę, nasycenie i jasność osobno dla ośmiu zakresów kolorów oraz usuwasz mgłę i dodajesz klarowność (kontrast lokalny). Wszystko zapisuje się w edycji nieniszczącej, a oryginał zostaje bez zmian.</li>
        <li><strong>Perspektywa, rysowanie i strzałki</strong>: w edytorze suwaki <em>Perspektywa pionowa</em> i <em>pozioma</em> prostują zbiegające się linie (np. budynki robione od dołu), a przycisk <em>Prostuj horyzont automatycznie</em> szuka dominującej poziomej linii i obraca zdjęcie. W zakładce <em>Efekty</em> sekcja <em>Rysowanie i strzałki</em> pozwala narysować strzałkę, linię, prostokąt, elipsę albo odręczną kreskę w wybranym kolorze i grubości. Wszystko zapisuje się w edycji nieniszczącej.</li>
        <li><strong>Usuwanie obiektów</strong>: w zakładce <em>Podstawy</em> zamalowujesz niechciany obiekt (osobę w tle, kabel, śmieć), a program wypełnia to miejsce fragmentami otoczenia, lokalnie i bez sieci. Działa najlepiej na jednolitym lub powtarzalnym tle (niebo, trawa, ściana); bardzo duże obiekty na złożonym tle mogą wymagać poprawek. <strong>Korekta obiektywu</strong> w zakładce <em>Dostrajanie</em>: ręczne suwaki dystorsji, winietowania i aberracji chromatycznej.</li>
        <li><strong>Łączenie zdjęć: HDR i stos ostrości</strong>: zaznacz od 2 do 9 zdjęć tej samej sceny i wybierz w menu <em>Połącz w HDR</em> (ujęcia o różnej ekspozycji dają zdjęcie z detalami w cieniach i światłach) albo <em>Połącz w stos ostrości</em> (ujęcia z ostrością w różnych miejscach dają zdjęcie ostre wszędzie). Program wyrównuje niewielkie przesunięcia (nie wyrównuje obrotu i zmiany skali), a wynik zapisuje jako nowy plik JPEG obok pierwszego zdjęcia (do 2800 px dłuższego boku). Oryginały zostają. Panoramy nie są obsługiwane.</li>
        <li><strong>Film ze zdjęć</strong>: w oknie eksportu zakładka <em>Film</em> robi z zaznaczonych zdjęć film MP4 z płynnymi przejściami, powolnym przybliżeniem i opcjonalną muzyką (HD albo Full HD, 2 do 8 sekund na zdjęcie). Film jest nagrywany lokalnie w oknie programu, więc trwa tyle, ile sam film, i zostawiasz okno na wierzchu. Można przerwać w każdej chwili.</li>
        <li><strong>Fotoksiążka (PDF)</strong> (menu → Szybkie akcje): z zaznaczonych albo widocznych zdjęć powstaje wielostronicowy PDF do wydruku lub drukarni. Wybierasz układ (jedno, dwa, cztery zdjęcia na stronie albo mieszany), papier (A4, A5, kwadrat 21 cm), marginesy, tło, numery stron i stronę tytułową z tytułem. Podgląd pierwszych stron widzisz od razu, a strony powstają w 200 dpi lokalnie.</li>
        <li><strong>Porządkowanie według daty</strong>: z menu „Porządkuj według daty” przenosisz zaznaczone lub widoczne zdjęcia do folderów RRRR, RRRR/MM albo RRRR/RRRR-MM-DD. Najpierw zobaczysz plan i nic się nie zmienia na dysku, pliki nigdy nie są nadpisywane, zablokowane foldery są pomijane, a całe porządkowanie cofniesz jednym kliknięciem (razem z plikami XMP, edycją i kopią oryginału).</li>
        <li><strong>Edycja nieniszcząca</strong>: w edytorze „Zapisz edycję (oryginał bez zmian)” zapisuje zmiany jako przepis (w bazie, w historii 20 ostatnich wersji i w pliku <code>zdjęcie.jpg.fibo.json</code> obok zdjęcia, gdy zapis metadanych jest włączony). Plik zdjęcia się nie zmienia, miniatura w bibliotece pokazuje edytowaną wersję, a edycję możesz później zmienić, cofnąć albo przywrócić z historii.</li>
        <li><strong>Kopia zapasowa biblioteki</strong> (menu): zapisuje dane biblioteki (tagi, oceny, albumy, ulubione, foldery) do pliku .db, a <em>Przywróć z kopii</em> wczytuje je z powrotem. Przed przywróceniem FIBO zapisuje kopię bezpieczeństwa obecnej biblioteki. Same zdjęcia, osoby i dane twarzy nie są w kopii.</li>
        <li><strong>Sortowanie</strong> zdjęć: od najnowszych, od najstarszych, po nazwie, po ocenie albo po rozmiarze pliku.</li>
        <li><strong>Zakres dat i braki</strong> (menu → Filtry): ogranicz widok do zdjęć z wybranych dat albo pokaż tylko zdjęcia bez tagów, bez lokalizacji lub bez oceny, żeby łatwo uzupełnić dane. Aktywne filtry widać jako znaczki nad zdjęciami.</li>
        <li><strong>Importuj z karty</strong> (menu, szybkie akcje): wskaż kartę pamięci lub folder, a potem folder biblioteki. FIBO kopiuje zdjęcia do podfolderów <em>RRRR/RRRR-MM-DD</em> według daty wykonania (z pliku, a bez niej według daty pliku) i dodaje je do biblioteki. Zdjęcia już zaimportowane są pomijane, nic nie jest nadpisywane, a karta zostaje nietknięta.</li>
        <li><strong>Zmień nazwy zaznaczonych…</strong> nadaje wielu zdjęciom nazwy według szablonu: data zdjęcia, własna nazwa i kolejny numer, np. <em>2024-07-01_Wakacje_001.jpg</em>. Przed zmianą widać podgląd. Pliki XMP idą za zdjęciami, a istniejące pliki nie są nadpisywane.</li>
        <li><strong>Ustaw lokalizację…</strong> pozwala wskazać miejsce zrobienia zaznaczonych zdjęć: kliknij je na mapie albo wpisz współrzędne. Zdjęcia pojawią się na globusie w zakładce Mapa. Lokalizacja jest zapisywana tylko w bibliotece FIBO, plików zdjęć nie zmieniamy, a ręczna lokalizacja ma pierwszeństwo przed GPS z pliku.</li>
        <li><strong>Retusz plam</strong> w edytorze: ikona różdżki, potem kliknij pyłek, plamę lub skazę. FIBO zamaluje ją kolorem z otoczenia (rozmiar pędzla ustawiasz suwakiem). Poprawki można cofnąć albo usunąć wszystkie naraz.</li>
        <li><strong>Albumy inteligentne</strong>: w bibliotece ustaw filtry (szukanie, ocena, zakres dat, braki, tagi) i kliknij <em>Zapisz jako album inteligentny</em>. W zakładce Albumy kliknięcie albumu ustawia te filtry. Zawartość liczy się na bieżąco, więc nowe pasujące zdjęcia pojawiają się same. Album inteligentny nie kopiuje zdjęć i można go w każdej chwili usunąć.</li>
        <li><strong>Sprawdź pliki</strong> (menu, szybkie akcje): znajduje zdjęcia z biblioteki, których pliku nie ma, które są puste albo uszkodzone (szybko po nagłówkach albo dokładnie, z wykrywaniem uciętych JPEG). Niczego nie zmienia; wynik można ukryć w bibliotece. <strong>Dodaj folder jednorazowo</strong> wczytuje zdjęcia bez obserwowania folderu (nowe pliki nie będą dodawane same).</li>
        <li><strong>PDF do druku</strong> (okno <em>Eksportuj pomniejszone…</em>): zaznaczone zdjęcia trafiają na strony A4 w układzie 1, 4 lub 6 na stronie albo jako arkusz kontaktowy (12). Plik PDF otworzysz w dowolnym programie, wydrukujesz lub wyślesz. FIBO nie ma własnego okna drukowania. PDF jest tworzony lokalnie, a zdjęcia w nim nie mają danych EXIF.</li>
        <li><strong>Animowany GIF i lokalizacje GPX</strong> (okno <em>Eksportuj pomniejszone…</em>): z 2 do 60 zaznaczonych zdjęć powstaje animowany GIF (klatka 0,5, 1 lub 2 s), a lokalizacje zdjęć można zapisać jako plik GPX (punkty z nazwą, datą i opisem) dla map i aplikacji do tras.</li>
        <li><strong>Blokowanie folderu</strong> (menu → Foldery, po wybraniu folderu): zablokowany folder (z podfolderami) jest chroniony. FIBO nie zmieni nazwy, nie przeniesie, nie usunie, nie nadpisze edycją ani nie przywróci oryginału jego zdjęć. Kopiowanie i eksport działają nadal. Ochrona działa w programie, a nie w systemie plików, więc inne programy nadal mogą zmieniać pliki.</li>
        <li><strong>Pokaż w Eksploratorze</strong>: w menu prawym przyciskiem (jedno zdjęcie) i w menu → Foldery otwiera okno Eksploratora Windows z zaznaczonym plikiem lub folderem. To jedyna rzecz, jaką ta funkcja robi: nie otwiera adresów w internecie.</li>
        <li><strong>Osoby razem</strong>: po wejściu w osobę przycisk <em>Razem z…</em> pokazuje tylko zdjęcia, na których są obie osoby. Podczas zaznaczania zdjęć pod tytułem widać liczbę zaznaczonych i ich rozmiar.</li>
        <li><strong>Moje zestawy</strong> (edytor → Efekty): zapisz bieżące korekty, efekty i napisy pod własną nazwą i stosuj jednym kliknięciem na innych zdjęciach. Dochodzą też nowe efekty: czerń i biel z filtrem czerwonym, żółtym lub zielonym oraz „tylko jeden kolor” (czerwony, żółty, zielony, niebieski).</li>
        <li><strong>Znak wodny z własnym logo</strong> (okno <em>Eksportuj pomniejszone…</em>): wybierz logo (PNG z przezroczystością, JPEG lub WebP), położenie w jednym z dziewięciu miejsc, rozmiar i krycie. Znak trafia na wszystkie eksportowane kopie, więc działa dla jednego zdjęcia i dla wielu naraz. Oryginały zostają bez zmian, a ustawienia logo są zapamiętywane.</li>
        <li><strong>Eksportuj pomniejszone…</strong> zapisuje kopie zaznaczonych zdjęć w wybranym folderze: w rozmiarze 1024, 1600, 2048 px lub oryginalnym, jako JPEG o wybranej jakości. Kopie nie mają danych EXIF, więc nie zdradzają lokalizacji, a oryginały zostają nietknięte.</li>
        <li><strong>Usuń z biblioteki (pliki zostają)…</strong> ukrywa zdjęcia w FIBO, a pliki na dysku zostają nietknięte. Ukryte zdjęcia wrócą po wybraniu <em>Przywróć ukryte zdjęcia</em> w menu (sekcja Foldery) albo po ponownym dodaniu folderu.</li>
        <li><strong>Przenieś do Kosza…</strong> pyta o zgodę i przenosi pliki do Kosza Windows, skąd można je przywrócić. Od 20 zdjęć, a także dla zdjęć z całego folderu, trzeba wpisać słowo <em>USUŃ</em>. FIBO usuwa tylko zdjęcia, które zna, nigdy cały folder.</li>
      </ul>` },
    { id: 'viewer', t: 'Podgląd zdjęcia', h: `
      <p>Dwuklik na zdjęciu (albo Enter) otwiera je na cały ekran. U góry są nazwa, ocena, ulubione, cofnij i ponów, pokaz slajdów, powiększanie, porównanie z oryginałem i pełny ekran, a na dole pasek miniatur. Strzałki przy krawędziach przełączają zdjęcia.</p>
      <p><strong>Powiększanie:</strong> kółko myszy przybliża w miejscu kursora, przeciągnięcie przesuwa obraz, dwuklik przełącza między dopasowaniem do okna a powiększeniem 100% (klawisze ${kbd('+')}, ${kbd('-')} i ${kbd('Z')}). <strong>Przed i po:</strong> przytrzymaj przycisk porównania albo klawisz ${kbd('B')}, żeby zobaczyć oryginał bez zmian.</p>
      <p>Przycisk różdżki (lub klawisz ${kbd('E')}) otwiera panel edycji. Zakładka <strong>Info</strong> pokazuje nazwę, folder, wymiary, rozmiar, datę zdjęcia, aparat i tagi.</p>` },
    { id: 'editor', t: 'Edytor zdjęć', h: `
      <p>Panel edycji ma cztery zakładki. Zmiany widać na żywo, a cofnąć je można bez ograniczeń w trakcie edycji (${kbd('Ctrl', 'Z')} i ${kbd('Ctrl', 'Y')}).</p>
      <ul>
        <li><strong>Podstawowe:</strong> Szczęśliwy traf, Auto kontrast, Auto kolor i Doświetlenie jednym kliknięciem; obrót i odbicie; prostowanie; usuwanie czerwonych oczu (kliknij środek oka); kadrowanie w proporcjach 1:1, 4:3, 3:2, 16:9 i innych, ze zbliżeniem i przesunięciem.</li>
        <li><strong>Dostrajanie:</strong> doświetlenie, światła, cienie, jasność, kontrast, gamma, temperatura barwowa, nasycenie i wyostrzenie. Dwuklik na suwaku zeruje go.</li>
        <li><strong>Tekst na zdjęciu</strong> (zakładka Efekty): wpisz napis i dodaj go, potem ustaw rozmiar, położenie poziome i pionowe, kolor oraz pogrubienie. Można dodać kilka napisów. Napis jest wypalany w zapisanym zdjęciu (zapis jako kopia zostawia oryginał nietknięty), a przed zapisem można go cofnąć.</li>
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
      <p>Zakładka <strong>Mapa</strong> pokazuje globus z pinezkami w miejscach, gdzie zrobiono zdjęcia. Pinezki mają różne kolory w różnych okolicach. Zdjęcia z jednego miejsca łączą się w jedną pinezkę z liczbą, a bliskie pinezki w większą pinezkę ze skupiskiem. Kliknięcie skupiska przybliża widok, a kliknięcie pinezki otwiera panel z miniaturami. Kliknięcie miniatury otwiera podgląd.</p>
      <p>Mapa pokazuje, gdzie w tej chwili jest dzień, a gdzie noc, razem ze smugą zmierzchu. Na dole jest zegar, suwak czasu (±12 godzin), przycisk <strong>Teraz</strong> i przycisk <strong>animacji doby</strong>, który w kilkanaście sekund przesuwa cały dzień. Pozycja Słońca jest liczona na komputerze.</p>
      <ul>
        <li>Pozycje pochodzą z danych GPS w zdjęciach (EXIF). Zdjęcia bez GPS nie pojawiają się na mapie, a licznik w rogu pokazuje, ile ich jest.</li>
        <li>Zdjęcia dodane przed obsługą mapy nie mają zapisanych współrzędnych: wybierz <em>Wczytaj lokalizacje ze zdjęć</em> w zakładce Mapa albo <em>Odśwież dane zdjęć</em> w menu.</li>
        <li>Mapa pobiera kafelki z darmowej usługi OpenFreeMap, więc <strong>wymaga internetu</strong>. Reszta programu działa offline.</li>
      </ul>` },
    { id: 'people', t: 'Osoby (rozpoznawanie twarzy)', h: `
      <p>Zakładka <strong>Osoby</strong> grupuje zdjęcia według osób. Funkcja jest <strong>domyślnie wyłączona</strong>: włączasz ją przyciskiem <em>Włącz rozpoznawanie twarzy</em> po przeczytaniu informacji o prywatności. Analiza działa w tle (można ją wstrzymać i wznowić), a nowe zdjęcia są dopisywane same.</p>
      <ul>
        <li><strong>Nic nie wychodzi z komputera.</strong> Twarze są wykrywane i porównywane lokalnie (modele YuNet i SFace, dołączone do instalatora, bez pobierania w trakcie działania). Moduł nie ma żadnego kodu sieciowego, a testy to sprawdzają.</li>
        <li><strong>Wektory twarzy są zaszyfrowane</strong> kluczem Twojego konta Windows (DPAPI). Skopiowana baza FIBO ich nie ujawni. Małe wycinki twarzy do okna Osoby leżą w folderze danych programu jako zwykłe pliki i znikają po usunięciu danych twarzy.</li>
        <li><strong>Imiona zostają w bazie FIBO</strong> i nie trafiają do plików zdjęć ani XMP.</li>
        <li>Przy osobie możesz <em>nadać imię</em>, <em>wybrać okładkę</em> (twarz pokazywaną na liście: przycisk <em>Zmień okładkę</em> przy osobie albo <em>Okładka</em> przy znaczku osoby w podglądzie zdjęcia), <em>połączyć</em> ją z inną (gdy ta sama osoba trafiła do dwóch grup): przeciągnij jedną osobę na drugą i kliknij <em>Zatwierdź</em> albo <em>pominąć</em>. Kliknięcie osoby pokazuje jej zdjęcia.</li>
        <li><strong>Dokładność i szybkość.</strong> Zdjęcia są analizowane na kilku wątkach naraz, a twarze szukane w większej rozdzielczości, więc znajdują się także małe twarze w tle (około 40% więcej niż wcześniej na zdjęciach testowych). Wektor twarzy jest uśredniany z jej odbiciem lustrzanym, a każda twarz dostaje ocenę jakości (ostrość, rozmiar, ustawienie głowy). Słabe twarze nie zakładają osób, tylko dołączają do pewnych albo zostają bez grupy.</li>
        <li><strong>Stosy twarzy do potwierdzenia.</strong> W widoku osoby podobne twarze z kilku zdjęć (np. seria ujęć) są ułożone w stos z liczbą ×N. Stos potwierdzasz albo odpinasz jednym kliknięciem, albo rozwijasz i oceniasz twarze osobno. Do stosu trafiają tylko bardzo podobne twarze z różnych zdjęć. Wstrzymane rozpoznawanie twarzy i indeksowanie po treści wznowisz przyciskiem <em>Wznów</em> prosto w okienku postępu.</li>
        <li><strong>Twarze, których program nie znalazł.</strong> W podglądzie zdjęcia przycisk <em>Dodaj twarz</em> pozwala zaznaczyć twarz ramką i wskazać osobę (istniejącą albo nową). Dotyczy tylko tego jednego zdjęcia, nie uruchamia analizy biblioteki. Taka twarz jest traktowana jak poprawiona ręcznie: grupowanie jej nie rusza, a ponowna analiza jej nie usuwa.</li>
        <li><strong>Precyzja grupowania.</strong> Dwie twarze z jednego zdjęcia nigdy nie trafiają do jednej osoby (rozdziela to np. rodzeństwo na wspólnych zdjęciach). Grupowanie jest hierarchiczne, więc nie zależy od kolejności zdjęć. Osoby z imieniem i twarze poprawione ręcznie są zakotwiczone: automatyczne grupowanie ich nie rusza, a nowe pasujące twarze mogą do nich dołączać. Przyciski <em>Pogrupuj od nowa</em> i <em>Przeanalizuj ponownie</em> w zakładce Osoby odświeżają wynik bez utraty imion.</li>
        <li><strong>Usuń dane twarzy</strong> kasuje osoby, wektory i wycinki twarzy oraz wyłącza funkcję. Zdjęcia nie są ruszane.</li>
      </ul>` },
    { id: 'duplicates', t: 'Duplikaty', h: `
      <p>Menu → <strong>Duplikaty</strong>. Wybierz poziom i dotknij <em>Szukaj duplikatów</em>:</p>
      <ul>
        <li><strong>Identyczne pliki:</strong> ta sama zawartość (taki sam rozmiar i suma kontrolna). Najszybsze i bezpieczne.</li>
        <li><strong>Bardzo podobne:</strong> ten sam kadr po zmniejszeniu, kompresji lub drobnej korekcie.</li>
        <li><strong>Podobne:</strong> także serie ujęć. Mogą trafić się różne zdjęcia, więc sprawdzaj przed usunięciem.</li>
      </ul>
      <p>Wyniki to grupy zdjęć z wymiarami, rozmiarem, folderem i datą. Przed usuwaniem możesz wskazać <em>który katalog jest ważniejszy</em>: kliknij katalogi w kolejności ważności (u góry widać ich pełne ścieżki, z przyciskiem otwarcia w Eksploratorze). Zdjęcie z ważniejszego katalogu jest wtedy <em>Głównym</em>, a jego kopie z innych katalogów są oznaczone jako <em>Duplikat</em>. Przy 20 lub więcej plikach do Kosza trzeba wpisać słowo USUŃ. Zdjęcie z koroną <em>Najlepsze</em> (największa rozdzielczość, potem największy plik) zostaje, a pozostałe są domyślnie zaznaczone do usunięcia. W każdej grupie musi zostać co najmniej jedno zdjęcie. <strong>Przenieś do Kosza</strong> pyta o zgodę i przenosi pliki do Kosza Windows, skąd można je przywrócić.</p>` },
    { id: 'data', t: 'Dane i prywatność', h: `
      <ul>
        <li><strong>Zdjęcia nie opuszczają komputera.</strong> FIBO nie ma kont, nie wysyła zdjęć ani statystyk. Program łączy się z internetem tylko w trzech sytuacjach: po kafelki mapy (po otwarciu zakładki Mapa albo okna wyboru lokalizacji; serwer map widzi wtedy oglądany obszar i Twój adres IP), po informację o nowej wersji z GitHuba (po uruchomieniu i co jakiś czas podczas pracy, bez żadnych danych o Tobie) oraz przy instalacji, gdy trzeba pobrać WebView2.</li>
        <li>Biblioteka (indeks, oceny, tagi, współrzędne) to baza <code>library.db</code> w folderze <code>%APPDATA%\\pl.local.menedzerzdjec</code>, a miniatury leżą w jego podfolderze <code>thumbs</code>. Kopię zapasową zrobisz, kopiując ten folder. Folder nazywa się tak ze względów technicznych i nie zmienia się przy aktualizacjach.</li>
        <li>Kopie oryginałów po edycji leżą w folderach <code>.originals</code> obok zdjęć, a tagi, oceny i ulubione dodatkowo w plikach <code>.xmp</code> obok zdjęć (można to wyłączyć w menu).</li>
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
          <tr><td>${kbd('+')} ${kbd('-')} / kółko myszy</td><td>Powiększ i pomniejsz zdjęcie w podglądzie</td></tr>
          <tr><td>${kbd('Z')} / dwuklik na zdjęciu</td><td>Dopasuj do okna ↔ powiększenie 100%</td></tr>
          <tr><td>przytrzymaj ${kbd('B')}</td><td>Pokaż oryginał bez zmian (przed i po)</td></tr>
          <tr><td>prawy przycisk myszy</td><td>Menu akcji dla zaznaczonych zdjęć</td></tr>
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
        <li>Sprawdzenie następuje <strong>automatycznie raz na dobę</strong> (krótko po uruchomieniu, a gdy program jest otwarty długo, co godzinę sprawdza, czy minęła doba; po cichu, gdy nie ma internetu) oraz na żądanie: menu → <strong>Sprawdź aktualizacje</strong>. Ręczne sprawdzenie zawsze pokazuje wynik w oknie: jest nowa wersja, masz najnowszą albo błąd.</li>
        <li>Gdy jest nowa wersja, FIBO pyta: <em>Pobierz i zainstaluj</em>, <em>Później</em> (zapyta ponownie następnego dnia) albo <em>Pomiń tę wersję</em>. W oknie widać opis zmian.</li>
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
      <p>FIBO jest wolnym oprogramowaniem na licencji <a href="https://github.com/${REPO}/blob/main/LICENSE">GNU GPL w wersji 2 lub nowszej</a>. Możesz go używać, zmieniać i rozpowszechniać na warunkach tej licencji. Program jest dostarczany bez gwarancji. Mapa korzysta z danych © uczestnicy OpenStreetMap i kafelków OpenFreeMap. Pełna lista składników innych autorów (w tym modeli twarzy) i ich licencji jest w pliku <a href="https://github.com/${REPO}/blob/main/app/src-tauri/THIRD_PARTY_NOTICES.md">THIRD_PARTY_NOTICES.md</a>, dołączonym też do instalatora.</p>` },
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
      <p>Supported formats: JPG, PNG, WebP, GIF, BMP, TIFF, ICO, AVIF, SVG, HEIC and HEIF (iPhone photos), JPEG XL, PSD (Photoshop), TGA, PNM, DDS, HDR, QOI and OpenEXR, plus camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 and many more). Everything is read on this computer. Camera RAW photos can be re-developed from the sensor data in the editor (exposure, white balance, soft highlight recovery). Files in formats other than JPG, PNG and WebP are always edited as a copy, and the original stays untouched. MP4, MOV, WebM and Ogg videos appear in the library with a thumbnail and a player (the codecs are decoded by the app window, so H.265 depends on the Windows extension you have installed); they cannot be edited.</p>
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
    { id: 'xmp', t: 'Metadata in files (XMP)', h: `
      <p>Tags, ratings and favorites are stored not only in the FIBO library but also in XMP files next to your photos (for example <code>photo.jpg.xmp</code>). They do not vanish with the database, and other programs (digiKam, Lightroom, darktable) can read them. The photos themselves are not modified.</p>
      <ul>
        <li><strong>Automatic saving</strong> is on by default. Turn it off in the menu → <em>Metadata in files</em>, which also has a <em>Save everything to XMP files</em> button.</li>
        <li><strong>XMP files from other programs</strong> are left untouched: FIBO recognises them by the missing FIBO marker and skips them.</li>
        <li><strong>Reading:</strong> when adding photos, FIBO picks up the tags and ratings they already have: from Windows Explorer (“Tags” and “Rating”), from XMP and IPTC in JPEG files (the way Picasa stored them) and from <code>.xmp</code> files next to the photos. For photos already in the library use <em>Load tags and ratings from files</em>. Reading only adds: it never overwrites ratings or removes tags.</li>
        <li>A tag the photo already has is not added a second time.</li>
      </ul>` },
    { id: 'albums', t: 'Your own albums', h: `
      <p>Albums in <strong>Albums → My albums</strong> do not depend on folders: they are your own collections, and one photo can be in many albums. Files stay where they are.</p>
      <ul>
        <li>New album: the <em>New album</em> button, or right-click selected photos → <em>Add to album…</em> → <em>New album…</em>.</li>
        <li>Opening an album shows its photos in the library. Right-click → <em>Remove from this album</em> takes photos out of the album (not off the disk).</li>
        <li>Each album has rename and delete buttons. Deleting an album does not delete photos. Album names are unique (case does not matter).</li>
      </ul>` },
    { id: 'watch', t: 'Watched folders', h: `
      <p>A folder added with <em>Add folder</em> is watched from then on. FIBO checks it <strong>after launch, when you return to the window (at most once per 30 seconds) and every 5 minutes</strong>:</p>
      <ul>
        <li>new photos are added automatically, together with tags and ratings stored in the file (a notification appears),</li>
        <li>photos whose files vanished from the disk disappear from the library. If a whole folder is unavailable (for example an unplugged drive), nothing is removed,</li>
        <li>unchanged files are skipped, so checking a large library is fast.</li>
      </ul>
      <p>The list of watched folders is in the menu → <em>Watched folders</em>. Clicking a folder (after confirmation) stops watching it, and its photos stay in the library. <em>Check for new photos now</em> checks immediately.</p>` },
    { id: 'files', t: 'File operations', h: `
      <p>Right-click a photo or a selection. The menu acts on all selected photos:</p>
      <ul>
        <li><strong>Rating</strong> (stars), <strong>favorite</strong>, <strong>Tags…</strong>, <strong>Add to album…</strong>, <strong>Collage</strong> (from two photos), <strong>Select all</strong>.</li>
        <li><strong>Rename file…</strong> (one photo): the extension stays and the XMP file is renamed with the photo. FIBO rejects names with characters Windows does not allow (<code>\\ / : * ? " &lt; &gt; |</code>), reserved names (CON, NUL, COM1…) and never overwrites an existing file.</li>
        <li><strong>Move to folder…</strong> and <strong>Copy to folder…</strong>: nothing is overwritten, and when a name is taken FIBO appends <code>_1</code>, <code>_2</code>. The XMP file goes with the photo. Moving across drives copies, checks the size and only then removes the source.</li>
        <li><strong>Album and folder properties</strong>: next to an album (info icon) and in menu → Folders you can set a date, place and description. They show under the album or folder title and search covers them. They are stored only in the FIBO library.</li>
        <li><strong>HTML gallery</strong> (right-click menu → Export resized… → Create HTML gallery): creates a folder with an <em>index.html</em> page, photos and thumbnails. The page has zoom and captions and works offline, with no resources from the internet. Photos in the gallery carry no EXIF data (location included).</li>
        <li><strong>Rename folder…</strong> (menu → Folders, after choosing a folder): renames the folder on disk and fixes the photo paths in the library. The folder list can be sorted newest first or by name.</li>
        <li><strong>Photo tray</strong>: right-click <em>Add to tray</em> collects photos from different folders and albums. The <em>Tray</em> bar in the lower-left corner lets you show them, select them all at once (then use the menu: album, export, collage, names, date) or clear the tray.</li>
        <li><strong>Timeline</strong>: the slider above the photos jumps to a chosen month or year (when there are enough groups).</li>
        <li><strong>Slideshow music</strong>: the sparkles icon in the viewer lets you pick a music file (mp3, m4a, aac, ogg, wav, flac, up to 80 MB). It loops only during the show, and photos change with a smooth fade. The file is read locally and nothing is uploaded.</li>
        <li><strong>Slideshow</strong>: the button with seconds changes the time of one slide (2, 4, 7 or 12 s), and the photo caption (if any) shows at the bottom during the show. Keys 0-5 rate the photo while it plays.</li>
        <li><strong>Neutral colour (dropper)</strong> in the editor: click a spot on the photo that should be grey or white and FIBO corrects the white balance. Remove the correction with the button under the icons.</li>
        <li><strong>EXIF data</strong> (viewer → Info): camera, lens, exposure time, aperture, ISO, focal length, flash and other fields from the file.</li>
        <li><strong>Statistics and keyboard shortcuts</strong> (menu → quick actions): counts by year, camera, tags and location, plus a shortcut list. In the library keys 0-5 set the rating, F toggles favourite, and ? or F1 opens help.</li>
        <li><strong>Search by camera data</strong>: the search box also finds photos by camera model, lens, ISO, aperture, exposure time and focal length (for example “ISO 400”, “RF24”, “f/2.8”). For photos added earlier choose <em>Refresh photo data</em> in the menu.</li>
        <li><strong>Photo caption</strong> (viewer → Info): the “Photo caption” field saves when you leave it. Search now covers captions, album names, folder names, camera, tags and file names.</li>
        <li><strong>Change date…</strong> (right-click menu): set an exact date and time, or shift the dates of the selected photos by days, hours and minutes (for example when the camera clock was wrong). The change applies to the FIBO library; photo files are not modified.</li>
        <li><strong>Copy and paste edit</strong>: in the editor “Copy edit” remembers adjustments, effects and captions (not crop or rotation) and “Paste edit” applies them to another photo. In the library <em>Paste edit to selected…</em> does it for many photos at once and saves the results as copies next to the originals.</li>
        <li><strong>People in the viewer</strong>: recognized people show as chips on the photo, and clicking a chip shows all photos of that person.</li>
        <li><strong>Search by photo content</strong> (menu → Quick actions): type what is in the picture ("dog on the beach", "cake", "mountains") and the app shows the best matches. It runs locally on a CLIP model shipped in the installer and knows about 130 concepts in Polish and English. Photos are indexed once, on request, in the background (about 0.2 s per photo).</li>
        <li><strong>Drag to folders</strong>: while you drag photos, a folder bar appears at the bottom next to albums. Dropping on a folder asks for confirmation and moves the files on disk (with XMP and edits). Folders locked against changes are not targets, and a taken name gets _1, _2.</li>
        <li><strong>Place names</strong>: photos with GPS coordinates get the name of the nearest town (for example "Warsaw, Poland"). The name shows in photo info, in search and in the <em>Places</em> section of the menu. It works offline, on a table of about 27,000 towns shipped in the installer (GeoNames data, CC BY 4.0). A photo more than 30 km from any larger town gets no name.</li>
        <li><strong>Calendar view</strong> (menu → Quick actions): a month grid with the first photo of each day and the photo count. Arrows, a year list and month shortcuts let you jump through time, and clicking a day shows its photos. Dates come from EXIF, or the file date when missing.</li>
        <li><strong>Text watermark</strong>: in export, next to the logo file you can type text (for example "© Jane Smith 2026"), pick a colour, position, size and opacity. The text is drawn locally and applied only to copies, originals never change.</li>
        <li><strong>Thumbnail cache</strong> (menu): shows how much space thumbnails use and clears them with one button after confirmation. Photos are untouched and thumbnails are rebuilt. Thumbnails of photos with a saved edit are kept.</li>
        <li><strong>IPTC data and time zone</strong>: <em>Author, rights and description (IPTC)</em> in the photo menu stores author, rights, title, city and country (also in the XMP file next to the photo), and city and country override the GPS place name. In <em>Change date</em> the <em>Time zone</em> mode converts dates when the camera clock followed a different zone. Photo files are never changed.</li>
        <li><strong>Drop from Explorer</strong>: drag photos or folders onto the FIBO window and the app asks whether to add them to the library. Folders become watched, single photos are added without watching, and files are never copied or changed.</li>
        <li><strong>Instant detection of new files</strong>: when a photo appears, disappears or changes in a watched folder, FIBO notices after a short quiet moment instead of waiting for the periodic check. Files written by the app itself (XMP and others) do not trigger a check.</li>
        <li><strong>Quality review</strong> (menu → Quick actions): the app measures sharpness and brightness locally (from thumbnails, in the background) and lists blurry or shaky, dark and overexposed photos, worst first, with a threshold slider. You can mark selected ones as rejected (files stay, and the flag can be removed any time). The <em>Best of burst</em> tab points to the sharpest shot of each burst and marks it as picked in one click. Closed eyes are not detected.</li>
        <li><strong>Tag suggestions</strong> (menu → Quick actions): on indexed photos (as in content search) the app finds concepts that fit many photos, such as "beach", "dog", "cake". You review thumbnails, untick mistakes and approve: only photos you leave ticked get the tag. A caution slider sets how sure suggestions must be. Everything runs locally.</li>
        <li><strong>Search text in photos</strong> (menu → Quick actions): the app reads text in photos (receipts, signs, documents) locally with small PaddleOCR models shipped in the installer (about 13 MB, Apache-2.0), including Polish characters. You run recognition once, on request, in the background (about 1 to 2 seconds per photo, pausable). Then you type words and the app shows photos containing them, ignoring case and Polish diacritics. The text stays in the library on this computer.</li>
        <li><strong>Curves, HSL colour, haze and clarity</strong>: in the editor's <em>Fine-tune</em> tab you get a live histogram, tone curves (luminance plus separate red, green and blue; add points by clicking, move them with the mouse or arrow keys, remove them with a double-click or Delete), hue, saturation and luminance for eight colour ranges, plus dehaze and clarity (local contrast). Everything is saved in the non-destructive edit and the original is untouched.</li>
        <li><strong>Perspective, drawing and arrows</strong>: in the editor, <em>Vertical perspective</em> and <em>Horizontal perspective</em> sliders straighten converging lines (for example buildings shot from below), and <em>Straighten horizon automatically</em> finds the dominant horizontal line and rotates the photo. In the <em>Effects</em> tab, <em>Drawing and arrows</em> lets you draw an arrow, line, rectangle, ellipse or freehand stroke in a chosen colour and thickness. All of it is saved in the non-destructive edit.</li>
        <li><strong>Object removal</strong>: in the <em>Basics</em> tab you paint over an unwanted object (a person in the background, a cable, litter) and the app fills the spot with patches from the surroundings, locally and offline. It works best on plain or repetitive backgrounds (sky, grass, a wall); very large objects on busy backgrounds may need touch-ups. <strong>Lens correction</strong> in the <em>Fine-tune</em> tab: manual sliders for distortion, vignetting and chromatic aberration.</li>
        <li><strong>Merging photos: HDR and focus stacking</strong>: select 2 to 9 photos of the same scene and choose <em>Merge to HDR</em> (shots at different exposures give a photo with detail in shadows and highlights) or <em>Merge into focus stack</em> (shots focused at different spots give a photo sharp throughout). The app aligns small shifts (it does not correct rotation or scale) and saves the result as a new JPEG next to the first photo (up to 2800 px on the long side). Originals stay untouched. Panoramas are not supported.</li>
        <li><strong>Film from photos</strong>: the <em>Film</em> tab in the export window turns selected photos into an MP4 with smooth transitions, a slow zoom and optional music (HD or Full HD, 2 to 8 seconds per photo). The film is recorded locally inside the app window, so it takes as long as the film itself and you keep the window in front. You can cancel any time.</li>
        <li><strong>Photo book (PDF)</strong> (menu → Quick actions): selected or visible photos become a multi-page PDF for printing or a print shop. You pick the layout (one, two, four photos per page or mixed), paper (A4, A5, 21 cm square), margins, background, page numbers and a title page. You see a preview of the first pages immediately, and pages are rendered locally at 200 dpi.</li>
        <li><strong>Organize by date</strong>: "Organize by date" in the menu moves selected or visible photos into YEAR, YEAR/MONTH or YEAR/YEAR-MM-DD folders. You see the plan first and nothing changes on disk, files are never overwritten, locked folders are skipped, and the whole run can be undone in one click (with XMP files, edits and original backups).</li>
        <li><strong>Non-destructive editing</strong>: in the editor, "Save edit (original untouched)" stores your changes as a recipe (in the database, in a history of the last 20 versions, and in a <code>photo.jpg.fibo.json</code> file next to the photo when metadata saving is on). The photo file never changes, the library thumbnail shows the edited look, and you can change, undo or restore the edit from history later.</li>
        <li><strong>Library backup</strong> (menu): saves your library data (tags, ratings, albums, favourites, folders) to a .db file, and <em>Restore from backup</em> loads it back. Before restoring, FIBO saves a safety copy of the current library. Photos themselves, people and face data are not in the backup.</li>
        <li><strong>Sorting</strong>: newest, oldest, by name, by rating or by file size.</li>
        <li><strong>Date range and gaps</strong> (menu → Filters): limit the view to photos from chosen dates, or show only photos without tags, without location or without a rating so you can fill in the gaps. Active filters appear as chips above the photos.</li>
        <li><strong>Import from card</strong> (menu, quick actions): pick a memory card or folder, then a library folder. FIBO copies photos into <em>YYYY/YYYY-MM-DD</em> subfolders by capture date (from the file, or the file date when missing) and adds them to the library. Photos already imported are skipped, nothing is overwritten, and the card is left untouched.</li>
        <li><strong>Rename selected…</strong> gives many photos names from a template: photo date, your own name and a running number, e.g. <em>2024-07-01_Holiday_001.jpg</em>. You see a preview first. XMP files follow the photos and existing files are never overwritten.</li>
        <li><strong>Set location…</strong> lets you mark where the selected photos were taken: click the place on the map or type coordinates. The photos then show up on the globe in the Map tab. The location is stored only in the FIBO library (photo files are not changed) and a manual location takes precedence over the GPS in the file.</li>
        <li><strong>Spot retouch</strong> in the editor: the wand icon, then click a speck, blotch or blemish. FIBO paints it over with the colour of its surroundings (set the brush size with the slider). Fixes can be undone or all removed at once.</li>
        <li><strong>Smart albums</strong>: in the library set filters (search, rating, date range, gaps, tags) and click <em>Save as smart album</em>. In the Albums tab clicking the album sets those filters. The contents are computed live, so new matching photos appear on their own. A smart album copies no photos and can be deleted at any time.</li>
        <li><strong>Check files</strong> (menu, quick actions): finds library photos whose file is missing, empty or damaged (fast by headers, or thorough with truncated JPEG detection). It changes nothing; the result can be hidden in the library. <strong>Add folder once</strong> loads photos without watching the folder (new files will not be added automatically).</li>
        <li><strong>PDF for printing</strong> (<em>Export resized…</em> window): selected photos go onto A4 pages as 1, 4 or 6 per page or as a contact sheet (12). Open the PDF in any program, print or send it. FIBO has no print dialog of its own. The PDF is built locally and the photos in it carry no EXIF data.</li>
        <li><strong>Animated GIF and GPX locations</strong> (<em>Export resized…</em> window): 2 to 60 selected photos become an animated GIF (frame 0.5, 1 or 2 s), and photo locations can be saved as a GPX file (waypoints with name, date and caption) for maps and route apps.</li>
        <li><strong>Folder lock</strong> (menu → Folders, after choosing a folder): a locked folder (with subfolders) is protected. FIBO will not rename, move, delete, overwrite by editing or restore originals of its photos. Copying and exporting still work. The protection applies inside the app, not at file-system level, so other programs can still change the files.</li>
        <li><strong>Show in Explorer</strong>: in the right-click menu (one photo) and in menu → Folders it opens a Windows Explorer window with the file or folder selected. That is all this feature does: it does not open internet addresses.</li>
        <li><strong>People together</strong>: after opening a person, the <em>Together with…</em> button shows only photos that contain both people. While selecting photos, the count and size of the selection show under the title.</li>
        <li><strong>My presets</strong> (editor → Effects): save the current adjustments, effects and captions under your own name and apply them with one click on other photos. There are also new effects: black and white with a red, yellow or green filter, and “one colour only” (red, yellow, green, blue).</li>
        <li><strong>Watermark with your own logo</strong> (<em>Export resized…</em> window): pick a logo (PNG with transparency, JPEG or WebP), one of nine positions, size and opacity. The mark goes on every exported copy, so it works for one photo or many at once. Originals are untouched and the logo settings are remembered.</li>
        <li><strong>Export resized…</strong> saves copies of the selected photos to a folder you pick: 1024, 1600, 2048 px or original size, as JPEG at the quality you choose. Copies carry no EXIF data, so they do not reveal location, and originals are untouched.</li>
        <li><strong>Remove from library (files stay)…</strong> hides photos in FIBO and leaves the files on disk untouched. Bring them back with <em>Restore hidden photos</em> in the menu (Folders section) or by adding the folder again.</li>
        <li><strong>Move to Recycle Bin…</strong> asks for confirmation and moves the files to the Windows Recycle Bin, from where you can restore them. For 20 or more photos, and for all photos of a folder, you must type <em>USUŃ</em>. FIBO only deletes photos it knows about, never a whole folder.</li>
      </ul>` },
    { id: 'viewer', t: 'Photo viewer', h: `
      <p>Double-click a photo (or press Enter) to open it full screen. The top bar has the name, rating, favorite, undo and redo, slideshow, zoom, compare with original and full screen; the bottom has a thumbnail strip. Arrows at the edges switch photos.</p>
      <p><strong>Zooming:</strong> the mouse wheel zooms at the cursor, dragging pans the image, and double-click toggles between fit-to-window and 100% (keys ${kbd('+')}, ${kbd('-')} and ${kbd('Z')}). <strong>Before and after:</strong> hold the compare button or the ${kbd('B')} key to see the untouched original.</p>
      <p>The wand button (or the ${kbd('E')} key) opens the edit panel. The <strong>Info</strong> tab shows name, folder, dimensions, size, date taken, camera and tags.</p>` },
    { id: 'editor', t: 'Photo editor', h: `
      <p>The edit panel has four tabs. Changes show live, and you can undo without limits while editing (${kbd('Ctrl', 'Z')} and ${kbd('Ctrl', 'Y')}).</p>
      <ul>
        <li><strong>Basics:</strong> I’m Feeling Lucky, Auto Contrast, Auto Color and Fill Light in one click; rotate and flip; straighten; red-eye removal (click the center of the eye); cropping at 1:1, 4:3, 3:2, 16:9 and more, with zoom and pan.</li>
        <li><strong>Tuning:</strong> fill light, highlights, shadows, brightness, contrast, gamma, color temperature, saturation and sharpen. Double-click a slider to reset it.</li>
        <li><strong>Text on photo</strong> (Effects tab): type a caption and add it, then set size, horizontal and vertical position, colour and bold. You can add several captions. The text is burned into the saved photo (saving as a copy leaves the original untouched) and can be undone before saving.</li>
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
      <p>The <strong>Map</strong> tab shows a globe with pins where your photos were taken. Pins have different colours in different areas. Photos from one place share a pin with a count, and nearby pins form a larger cluster pin. Click a cluster to zoom in, or a pin to open a panel with thumbnails. Click a thumbnail to open the viewer.</p>
      <p>The map shows where it is day and where it is night right now, with a smooth twilight band. At the bottom are a clock, a time slider (±12 hours), a <strong>Now</strong> button and a <strong>day animation</strong> button that sweeps a whole day in a few seconds. The Sun's position is computed on your computer.</p>
      <ul>
        <li>Positions come from the GPS data in your photos (EXIF). Photos without GPS do not appear, and the counter in the corner shows how many there are.</li>
        <li>Photos added before map support have no stored coordinates: choose <em>Load locations from photos</em> in the Map tab or <em>Refresh photo data</em> in the menu.</li>
        <li>The map downloads tiles from the free OpenFreeMap service, so it <strong>needs internet</strong>. The rest of the app works offline.</li>
      </ul>` },
    { id: 'people', t: 'People (face recognition)', h: `
      <p>The <strong>People</strong> tab groups photos by person. The feature is <strong>off by default</strong>: you turn it on with <em>Turn on face recognition</em> after reading the privacy notice. Analysis runs in the background (you can pause and resume it) and new photos are added automatically.</p>
      <ul>
        <li><strong>Nothing leaves your computer.</strong> Faces are detected and compared locally (YuNet and SFace models shipped inside the installer, nothing is downloaded while the app runs). The module has no network code, and tests verify it.</li>
        <li><strong>Face vectors are encrypted</strong> with your Windows account key (DPAPI). A copied FIBO database does not reveal them.</li>
        <li><strong>Names stay in the FIBO database</strong> and never go into photo files or XMP.</li>
        <li>For each person you can <em>name</em>, <em>pick a cover</em> (the face shown in the list: the <em>Change cover</em> button on the person, or <em>Cover</em> next to the person chip in the viewer), <em>merge</em> (when one person ended up in two groups): drag one person onto another and click <em>Confirm</em> or <em>ignore</em> them. Click a person to see their photos.</li>
        <li><strong>Accuracy and speed.</strong> Photos are analysed on several threads at once and faces are searched at a higher resolution, so small background faces are found too (about 40% more than before on test photos). A face vector is averaged with its mirror image, and every face gets a quality score (sharpness, size, head pose). Weak faces do not create people: they join confident ones or stay ungrouped.</li>
        <li><strong>Stacks of faces to confirm.</strong> In a person's view, very similar faces from several photos (for example a burst) are grouped into a stack with a ×N badge. Confirm or unpin the whole stack in one click, or expand it and judge faces one by one. Only highly similar faces from different photos are stacked. Paused face recognition and content indexing can be resumed with <em>Resume</em> right in the progress window.</li>
        <li><strong>Faces the program missed.</strong> In the photo viewer, <em>Add face</em> lets you draw a box around a face and pick the person (existing or new). It affects only that one photo and does not start library analysis. Such a face is treated as manually corrected: grouping leaves it alone and re-analysis does not remove it.</li>
        <li><strong>Grouping precision.</strong> Two faces from one photo never end up in one person (this separates siblings in group photos). Grouping is hierarchical, so it does not depend on photo order. Named people and manually corrected faces are anchored: automatic grouping leaves them alone, and new matching faces may join them. The <em>Regroup</em> and <em>Re-analyse</em> buttons in the People tab refresh the result without losing names.</li>
        <li><strong>Delete face data</strong> removes people, vectors and face crops and turns the feature off. Your photos are untouched.</li>
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
        <li><strong>Your photos never leave your computer.</strong> FIBO has no accounts and sends no photos or statistics. The program goes online in only three situations: for map tiles (when you open the Map tab or the location picker; the map server then sees the area you are viewing and your IP address), to check GitHub for a new version (after start and from time to time while it runs, with no data about you), and during installation when WebView2 has to be downloaded.</li>
        <li>The library (index, ratings, tags, coordinates) is the <code>library.db</code> database in <code>%APPDATA%\\pl.local.menedzerzdjec</code>, and thumbnails are in its <code>thumbs</code> subfolder. Back it up by copying that folder. The folder has that name for technical reasons and does not change across updates.</li>
        <li>Copies of originals after editing are in <code>.originals</code> folders next to your photos, and tags, ratings and favorites are also in <code>.xmp</code> files next to the photos (this can be turned off in the menu).</li>
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
          <tr><td>${kbd('+')} ${kbd('-')} / mouse wheel</td><td>Zoom the photo in and out in the viewer</td></tr>
          <tr><td>${kbd('Z')} / double-click the photo</td><td>Fit to window ↔ 100% zoom</td></tr>
          <tr><td>hold ${kbd('B')}</td><td>Show the untouched original (before and after)</td></tr>
          <tr><td>right mouse button</td><td>Action menu for the selected photos</td></tr>
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
        <li>The check runs <strong>automatically once a day</strong> (shortly after launch, and when the app stays open for long it checks hourly whether a day has passed; silently when offline) and on demand: menu → <strong>Check for updates</strong>. A manual check always shows its result in a dialog: a new version, you are up to date, or an error.</li>
        <li>When a new version exists, FIBO asks: <em>Download and install</em>, <em>Later</em> (it will ask again the next day) or <em>Skip this version</em>. The release notes are shown in the dialog.</li>
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
      <p>FIBO is free software under the <a href="https://github.com/${REPO}/blob/main/LICENSE">GNU GPL version 2 or later</a>. You may use, change and redistribute it under the terms of that license. The program comes with no warranty. The map uses data © OpenStreetMap contributors and OpenFreeMap tiles. The full list of third-party components (including the face models) and their licenses is in <a href="https://github.com/${REPO}/blob/main/app/src-tauri/THIRD_PARTY_NOTICES.md">THIRD_PARTY_NOTICES.md</a>, which is also shipped with the installer.</p>` },
  ],
  footer: 'FIBO · GPL-2.0-or-later',
}
