# FIBO a Picasa 3: lista funkcji do odhaczania

Legenda: `[x]` jest w FIBO (wydane lub na `main`), `[ ]` do dodania. Przy pozycjach do dodania: **P** = priorytet (1 najwyższy),
**T** = trudność (S małe, M średnie, L duże). Zasady FIBO: wszystko lokalnie, nic do internetu, oryginały nietknięte.
Pozycje oznaczone 🚫 świadomie pomijamy (wymagają usług w chmurze albo łamią zasadę prywatności).

Lista powstała z pamięci o Picasie 3, z przeglądu FIBO i z oficjalnego podręcznika Picasa Getting Started Guide
(https://www.google.com/help/hc/images/picasa_user_guide.pdf). Uzupełnienia z podręcznika są w sekcji 9.

## 1. Biblioteka i porządkowanie
- [x] Foldery z obserwowaniem (nowe zdjęcia dodają się same)
- [x] Widok według lat i dat, siatka z oryginalnymi proporcjami
- [x] Albumy (własne, dodawanie i usuwanie zdjęć), ukrywanie i przywracanie albumów, albumy od najnowszego
- [x] Oceny gwiazdkami, ulubione
- [x] Tagi i wyszukiwanie po tagach, wczytywanie tagów i ocen z plików (XMP, EXIF, IPTC)
- [x] Wyszukiwanie duplikatów (identyczne i podobne)
- [x] Ukrywanie zdjęć w bibliotece i przywracanie
- [x] Filtry: ocena, zakres dat, bez tagów, bez lokalizacji, bez oceny
- [x] Sortowanie: data, nazwa, ocena, rozmiar
- [x] Kopia zapasowa i przywracanie biblioteki
- [x] **Opisy zdjęć (podpisy)**: pole „Opis” przy zdjęciu, szukanie po opisie, zapis do XMP. P1 T S Gotowe: opis w podglądzie i szukanie po opisach. Zapis do XMP jeszcze nie (opis zostaje w bibliotece FIBO).
- [x] **Taca („Hold”)**: trwały koszyk zaznaczonych zdjęć, do którego dokładasz z różnych folderów, a potem robisz akcję na całości (album, eksport, kolaż). P2 T M Gotowe: Dodaj do tacy, pasek Taca (pokaż, zaznacz, wyczyść); akcje przez Zaznacz i menu.
- [x] **Zmiana daty zdjęcia / przesunięcie dat** (np. zły zegar aparatu): ustaw datę lub przesuń o N godzin dla wielu zdjęć. P1 T M Gotowe w bibliotece FIBO (plików nie zmieniamy).
- [x] **Własne albumy: kolejność zdjęć** przeciąganiem. P3 T M Gotowe: w albumie menu → Sortowanie → „Własna kolejność”, potem przeciągnij zdjęcie na inne. (opis, miejsce i data albumu są już gotowe)
- [x] **Albumy inteligentne** (zapisane filtry, np. „5 gwiazdek z 2023”). P3 T M Gotowe (filtry: szukanie, ocena, daty, braki, tagi).
- [x] **Wyszukiwanie po kolorze** dominującym. P4 T M Gotowe: menu → Filtry → Kolor dominujący (12 kolorów liczonych z miniatur).
- [x] **Wyszukiwanie po danych aparatu** (model, obiektyw, ISO, przysłona, czas) i filtr „aparat”. P2 T M Gotowe w polu szukania (bez osobnego filtra „aparat”); starsze zdjęcia po „Odśwież dane zdjęć”.
- [x] **Zaznaczanie podobnych** do wybranego zdjęcia. P4 T M Gotowe: menu zdjęcia → „Zaznacz podobne” (ten sam mechanizm co szukanie duplikatów).
- [x] **Statystyki biblioteki** (liczba zdjęć, rozmiar, zdjęcia na rok, najczęstsze aparaty). P4 T S Gotowe (menu, szybkie akcje).
- [x] **Blokowanie folderu** przed zmianami z poziomu FIBO (ochrona przed przypadkowym usunięciem). P3 T S Gotowe (menu → Foldery); ochrona działa w programie, nie w systemie plików.
- [x] **Skróty klawiszowe w bibliotece** (np. 1 do 5 oceny, F ulubione, Del ukrywanie) i ich lista pod F1. P2 T S Gotowe: 0-5, F, ? lub F1 (Del nie dodany, bo usuwanie ma potwierdzenia).
- [x] Obsługa **plików wideo** w bibliotece (miniatura, odtwarzanie, filtr): MP4, M4V, MOV, WebM i Ogg, o ile okno programu zna kodek (H.264 tak, H.265 zależy od systemu).
- [x] Obsługa **plików RAW** (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 i inne): miniatura z osadzonego podglądu, pełny podgląd z wywołanej matrycy. Gotowe w wersji 0.4.12 (pliki RAW edytujesz jako kopie).

## 2. Osoby i miejsca
- [x] Rozpoznawanie twarzy lokalnie, grupowanie w osoby, imiona, łączenie, okładka, pomijanie
- [x] Mapa z globusem, pinezki w kolorach, skupiska, dzień i noc z animacją
- [x] Ręczne ustawianie lokalizacji (klik na mapie albo współrzędne)
- [x] **Chipy osób w podglądzie zdjęcia** (kto jest na tym zdjęciu) i ręczne przypisanie twarzy do osoby. P1 T M Gotowe: znaczki osób, przejście do zdjęć osoby oraz poprawianie błędnego rozpoznania („To inna osoba”).
- [x] **Twarze, których nie znaleziono**: ręczne zaznaczenie twarzy na zdjęciu. P3 T M Gotowe jako „Dodaj twarz” w podglądzie: ramka rysowana myszą i wybór osoby.
- [x] **„Zdjęcia osoby A i osoby B razem”** (przecięcie osób). P3 T S Gotowe: przycisk „Razem z…” w widoku osoby.
- [x] **Nazwy miejsc** (miasto, kraj) z lokalnego słownika współrzędnych, szukanie po miejscu. P3 T L Gotowe: tabela ok. 27 tys. miejscowości (GeoNames, polskie nazwy) w instalatorze, nazwa w informacjach o zdjęciu, w szukaniu i w sekcji „Miejsca” menu.
- [x] **Eksport tras / lokalizacji** do pliku GPX lub KML. P4 T S Gotowe w oknie eksportu (GPX).
- [x] **Film z twarzy** (pokaz zdjęć jednej osoby). P4 T M Gotowe jako „Pokaz zdjęć” w widoku osoby.

## 3. Edytor: poprawki podstawowe
- [x] Kadrowanie (proporcje), prostowanie, obrót, odbicie
- [x] Czerwone oczy
- [x] Szczęśliwy traf, auto kontrast, auto kolor
- [x] Doświetlenie, światła, cienie, jasność, kontrast, gamma, temperatura barwowa, nasycenie, wyostrzenie
- [x] Tekst na zdjęciu
- [x] Cofnij i ponów, przywrócenie oryginału, porównanie z oryginałem
- [x] **Neutralny kolor (zakraplacz)**: klik w szary punkt koryguje balans bieli. P2 T S Gotowe w edytorze.
- [x] **Retusz** (usuwanie plam i skaz pędzlem). P2 T M Gotowe: kliknięcie plamy zamalowuje ją kolorem z otoczenia.
- [x] **Kadrowanie ręczne z ramką** i gotowe formaty wydruku 10x15, 13x18, A4 oraz obrót ramki. P3 T M Częściowo: gotowe formaty odbitek (9x13, 10x15, 13x18, A4 i inne) oraz „Obróć ramkę”; przeciąganie ramki myszą jeszcze nie.
- [x] **Zastosuj te same zmiany do wielu zdjęć** (kopiuj i wklej edycję, edycja wsadowa). P1 T M Gotowe: kopiuj i wklej edycję, wsadowo jako kopie.
- [x] **Obrót wielu zdjęć bez utraty jakości** (znacznik orientacji). P2 T S Gotowe: menu zdjęcia → „Obróć w prawo/w lewo (bez utraty jakości)” dla JPEG (oryginał trafia do .originals); inne formaty obracasz w edytorze.
- [x] **Poprawka perspektywy** (wyrównanie pionów). P4 T L Gotowe: suwaki „Perspektywa pionowa” i „pozioma” w sekcji „Obrót i odbicie”, bez czarnych rogów (zdjęcie jest lekko przybliżane).
- [x] **Redukcja szumu**. P4 T M Gotowe w Efektach (nie rozmywa krawędzi).
- [x] **Rozmycie / pogłębienie ostrości w obszarze** (maska radialna). P4 T M Gotowe jako „Rozmycie poza środkiem” w Efektach.
- [x] **Znak wodny** (tekst lub obraz) przy eksporcie. P2 T M Gotowe jako logo (PNG, JPEG, WebP): położenie, rozmiar, krycie; dla jednego lub wielu zdjęć przy eksporcie. Znak tekstowy nie zrobiony.
- [x] **Rysowanie i strzałki** na zdjęciu. P4 T M Gotowe: zakładka „Efekty” → „Rysowanie i strzałki” (strzałka, linia, prostokąt, elipsa, pędzel; 6 kolorów, 3 grubości; cofanie ostatniego), zapisywane w edycji nieniszczącej.

## 4. Edytor: efekty
- [x] Czarno-białe, sepia, ocieplenie, podbicie, negatyw, ziarno, zmiękczenie, poświata, Orton, miękki fokus
- [x] Czerń i biel z ogniskiem, winieta, gradientowy odcień, dwutonowy, mapa cieplna, noktowizor, podczerwień
- [x] Mat, cross process, Lomo, lata 60., Polaroid, HDR, posteryzacja, pikselizacja, szkic, komiks, neon, ramka
- [x] **Przechylenie i przesunięcie (tilt-shift)**, miniatura. P4 T M Gotowe w Efektach.
- [x] **Efekt „Kolor selektywny”** (zostaw jeden kolor). P3 T M Gotowe: tylko czerwony, żółty, zielony lub niebieski.
- [x] **Własne zestawy efektów** (zapisz receptę i użyj na innych zdjęciach). P3 T M Gotowe: „Moje zestawy” w Efektach.

## 5. Zapis, eksport, udostępnianie
- [x] Zapis jako kopia lub nadpisanie (oryginał w `.originals`)
- [x] Eksport pomniejszonych kopii (bez EXIF i lokalizacji)
- [x] Przenoszenie, kopiowanie, zmiana nazw (jedna i zbiorczo), Kosz Windows z zabezpieczeniami
- [x] Import z karty pamięci do folderów według daty
- [x] Duplikaty do Kosza
- [x] **Eksport galerii HTML** (strona offline do wysłania znajomym lub wgrania na serwer). P2 T M Gotowe (Eksportuj pomniejszone → Utwórz galerię HTML).
- [x] **Eksport do PDF** (album, arkusz kontaktowy). P2 T M Gotowe: układy 1, 4, 6 na stronie i arkusz kontaktowy 12 (bez podpisów pod zdjęciami).
- [x] **Drukowanie** (układy: pojedyncze, 2x2, arkusz kontaktowy, rozmiar papieru). P2 T M Częściowo przez PDF: układy i arkusz gotowe, własnego okna drukowania nie ma (drukujesz plik PDF).
- [x] **Wysyłka e-mailem**: tylko przygotowanie pomniejszonych kopii do załączenia (bez wysyłania przez FIBO). P3 T S Załatwia to eksport pomniejszony do 1024 px (bez EXIF).
- [x] **Kopia zapasowa zdjęć na dysk zewnętrzny** (kopiowanie nowych i zmienionych plików, bez usuwania). P2 T L Gotowe: menu → Kopia zdjęć na dysk zewnętrzny (układ według obserwowanych folderów, z postępem).
- [ ] **Ustaw jako tapetę** pulpitu. P4 T S Odłożone: wymaga wywołania API Windows (`unsafe`) albo polecenia zewnętrznego, a zasady bezpieczeństwa FIBO tego zabraniają poza modułem szyfrowania.
- [x] **Otwórz w zewnętrznym programie** (np. Photoshop, Paint) i wczytaj zmiany. P3 T S Gotowe: menu zdjęcia → „Otwórz w domyślnym programie” (wczytanie zmian po odświeżeniu biblioteki).
- [ ] 🚫 Albumy internetowe i synchronizacja z chmurą (Picasa Web, Google Photos)
- [ ] 🚫 Zamawianie odbitek online

## 6. Kolaże, pokaz slajdów, film
- [x] Kolaż z zaznaczonych zdjęć
- [x] Pokaz slajdów (spacja)
- [x] Zdjęcia w pełnym ekranie, powiększanie, porównanie
- [x] **Kolaż: tryby** (stos zdjęć, mozaika, arkusz kontaktowy, plakat z wieloma rozmiarami). P3 T M Już były: mozaika, siatka, stos zdjęć i arkusz kontaktowy.
- [x] **Pokaz slajdów: przejścia, czas na zdjęcie, muzyka z pliku, podpisy**. P2 T M Gotowe: płynne przejście, czas slajdu, muzyka z pliku, opisy.
- [x] **Film ze zdjęć** (eksport pokazu slajdów do wideo MP4). P3 T L Gotowe: Eksport → „Film”: czas na zdjęcie, przejście, HD lub Full HD, powolne przybliżenie, opcjonalna muzyka; nagrywanie lokalnie w oknie programu (trwa tyle, ile film), zapis MP4 (WebM, gdy okno nie umie MP4).
- [ ] **Wygaszacz ekranu** ze zdjęć z biblioteki. P4 T M
- [x] **Animowany GIF** z kilku zdjęć. P4 T S Gotowe w oknie eksportu.

## 7. Metadane i pliki
- [x] Podgląd informacji (EXIF: aparat, data, wymiary), tagi w panelu
- [x] Zapis tagów i ocen do plików XMP, odczyt z EXIF XP i IPTC
- [x] **Pełny podgląd EXIF** (przysłona, czas, ISO, ogniskowa, obiektyw, flesz) i kopiowanie wartości. P2 T S Gotowe w panelu Informacje (kopiowanie wartości nie zrobione).
- [x] **Edycja EXIF/IPTC**: autor, prawa autorskie, opis (w XMP, bez ruszania pliku). P3 T M Autor i prawa autorskie gotowe (menu zdjęcia, zapis do XMP); pozostałe pola IPTC nie.
- [x] **Usuwanie metadanych** z wybranych zdjęć (kopie bez GPS) jako osobna akcja. P3 T S Gotowe: Eksport → „Kopie bez metadanych” (pełny rozmiar, jakość 98).
- [x] **Wykrywanie uszkodzonych plików** i raport. P4 T S Gotowe (menu → Sprawdź pliki).

## 8. Wygląd i wygoda
- [x] Motyw jasny, ciemny i systemowy, nowoczesne ikony, wysoki kontrast
- [x] Automatyczne aktualizacje z podpisem, instalator z polskimi tekstami
- [ ] **Wersja angielska interfejsu** (przełącznik języka). P3 T L
- [x] **Suwak wielkości miniatur** z zapamiętaniem oraz tryby wyświetlania (siatka, lista z danymi). P3 T S Częściowo: suwak z zapamiętaniem gotowy, widoku listy nie ma.
- [x] **Pasek stanu z liczbą zaznaczonych i rozmiarem**. P4 T S Gotowe pod tytułem widoku.
- [x] **Przeciąganie zdjęć na foldery**: pasek „Przenieś do folderu” pod paskiem albumów podczas przeciągania; po upuszczeniu program pyta o potwierdzenie i przenosi pliki (z XMP i edycją), pomijając foldery zablokowane.
- [x] **Przeciąganie zdjęć na albumy** w menu bocznym. P3 T M Gotowe jako pasek albumów na dole podczas przeciągania (nie w menu bocznym).
- [x] **Przeciągnij i upuść plików z Eksploratora** do FIBO (dodanie folderu). P3 T M Gotowe: obsługa upuszczania w oknie włączona, a przeciąganie wewnątrz programu przeniesione na własną obsługę myszy (przeciąganie HTML5 wyklucza się z upuszczaniem plików w Windows). Po upuszczeniu program pyta o potwierdzenie; foldery są obserwowane, pojedyncze zdjęcia dodawane bez obserwowania.
- [ ] **Praca z wieloma biblioteka** (profile, np. rodzinna i służbowa). P4 T L

## 9. Uzupełnienie z oficjalnego podręcznika Picasa (Getting Started Guide, 9 stron)
Pozycje, których brakowało na liście powyżej albo które podręcznik opisuje dokładniej.

Biblioteka i foldery:
- [x] **Właściwości folderu i albumu**: tytuł, data, miejsce, opis (dwuklik w nagłówku), wszystko przeszukiwalne. P2 T M Gotowe (ikona informacji przy albumie, menu → Foldery).
- [x] **Zmiana nazwy folderu z poziomu FIBO** (zmienia też folder na dysku, z ostrzeżeniem). P3 T M Gotowe (menu → Foldery).
- [x] **„Pokaż w Eksploratorze”** dla folderu i zdjęcia. P2 T S Gotowe (wtyczka opener z jednym uprawnieniem: pokaż element w katalogu).
- [x] **Menedżer folderów**: dla każdego folderu „obserwuj zawsze”, „skanuj raz”, „usuń z FIBO” (dziś jest tylko obserwuj i przestań obserwować). P2 T S Częściowo: „Dodaj folder jednorazowo” (skanuj raz), obserwuj zawsze i usuń z listy obserwowanych już były.
- [x] **Sortowanie listy folderów** (data utworzenia, nazwa, data zdjęć). P3 T S Gotowe: od najnowszych albo po nazwie.
- [ ] **Przeciąganie zdjęcia na folder** przenosi plik (z potwierdzeniem), a na album dodaje do albumu. P3 T M
- [x] **Wykrywanie karty pamięci i aparatu** przy podłączeniu. P3 T M Gotowe: dysk z folderem DCIM jest wykrywany, a program proponuje import. Wybór nazwy folderu przy imporcie nie jest zrobiony (zdjęcia trafiają do folderów według daty).
- [x] **Opcja skanowania GIF i PNG** w ustawieniach. P4 T S Gotowe: menu → Foldery → „Pomijaj GIF i PNG przy skanowaniu” (domyślnie wyłączone, żeby nie zmieniać dotychczasowego działania).
- [x] **Formaty**: PSD i RAW gotowe (oraz HEIC, AVIF, JPEG XL, TGA, PNM, DDS, HDR, QOI, OpenEXR, ICO, SVG). Filmy MPG, AVI, WMV, MOV jeszcze nie (zob. wideo w sekcji 1).

Widoki i wyszukiwanie:
- [x] **Oś czasu („Timeline”)**: przesuwanie suwakiem po całej bibliotece (miesiące i lata z miniaturami), dziś są tylko skoki do roku. P2 T M Gotowe jako suwak nad zdjęciami (skok do miesiąca lub roku).
- [x] **Szukanie obejmuje opisy, nazwy albumów, miejsce i dane EXIF aparatu** (dziś: nazwa pliku, aparat, tagi). P1 T S Gotowe: opisy, albumy, foldery, aparat, tagi (bez pól EXIF takich jak ISO i obiektyw, zob. wyszukiwanie po danych aparatu).
- [x] **Przycisk „Filmy”** (tylko wideo) i **suwak daty** do szybkiego zawężania wyników. P3 T S
- [x] **Filmstrip w edytorze** (pasek miniatur zdjęć z albumu u góry, zamiast samych strzałek). P3 T S Już był: pasek miniatur w podglądzie.

Edytor, szczegóły z podręcznika:
- [x] **Soft focus i focal B&W z punktem środkowym**: wskazanie środka na zdjęciu, suwaki rozmiaru i ostrości (dziś jeden suwak siły). P2 T M
- [x] **Tint i graduated tint z wyborem koloru** zakraplaczem (dziś kolor jest stały). P2 T M
- [x] **Filtered B&W**: czerń i biel z kolorowym filtrem (czerwony, żółty, zielony…). P3 T S Gotowe: filtry czerwony, żółty, zielony.
- [x] **Jednoprzyciskowe poprawki światła** obok suwaków doświetlenia, świateł i cieni (jak w Picasie). P3 T S Gotowe: przyciski w Jednym kliknięciu i nad suwakami światła.
- [x] **Gotowe rozmiary kadru** z podręcznika (np. 4x6) z przeciąganiem ramki i zmianą proporcji rogami. P3 T M Częściowo: rozmiary gotowe, przeciąganie ramki rogami jeszcze nie.
- [x] **Opis pod zdjęciem w edytorze** z przełącznikiem „pokaż na zdjęciu”, zapis w metadanych, szukanie po opisach (zob. sekcja 1). P1 T S Gotowe w panelu Informacje podglądu; przełącznik „pokaż na zdjęciu” nie zrobiony.
- [ ] **Obrót zdjęcia „w programie”** bez ruszania pliku do czasu zapisu (przyciski w tacy). P4 T S

Taca i wyjście:
- [x] **Taca zdjęć** z przyciskami **Zatrzymaj, Wyczyść, Dodaj do albumu, Gwiazdka, Obróć** oraz akcjami **Drukuj, E-mail, Kolaż, Eksport** na całej zawartości. P2 T M Gotowe: Zatrzymaj zaznaczone, Do albumu, Ulubione, Obróć, Kolaż, Eksport i druk, E-mail.
- [x] **Kolaż: zapis jako tapeta pulpitu lub wygaszacz**, tło ze zdjęcia lub kolor (czarny, biały, szary), efekt filmowej wielokrotnej ekspozycji. P3 T M Gotowe jako tapeta: format „Tapeta (ten ekran)” zapisuje obraz w rozdzielczości ekranu (do 3840 px), tła: biały, czarny, grafit, papier, szary i rozmyte zdjęcie, układ „Wielokrotna ekspozycja”. Ustawienie tapety robi użytkownik w Eksploratorze („Ustaw jako tło pulpitu”), bo FIBO nie wywołuje funkcji systemu. Wygaszacz ekranu: poza zakresem (wymaga pliku .scr zarejestrowanego w systemie).
- [x] **Pokaz slajdów: pokaz opisów, obracanie, ocenianie gwiazdkami i ustawienie czasu slajdu w trakcie pokazu**. P2 T S Gotowe: czas slajdu, opisy i ocenianie (obracanie w pokazie jeszcze nie).
- [x] **Płyta z prezentem → „Paczka prezentowa”**: zapis wybranych zdjęć w wybranym rozmiarze razem z samodzielnym pokazem HTML do folderu lub na pendrive. P3 T M Załatwia to eksport galerii HTML (pomniejszone zdjęcia i samodzielna strona index.html).
- [x] **Wydruk: układy na stronie** (np. 4 zdjęcia 9x13 na A4), przycisk „Przegląd” przed drukiem. P2 T M Gotowe: układy 1, 2, 4, 6, 9 oraz arkusze 12 i 20 na stronie A4 z podglądem strony przed wydrukiem.
- [ ] 🚫 Albumy internetowe, wysyłka na blog (BlogThis!), konto Hello, zamawianie odbitek, wysyłka przez Gmail i Picasa Mail (chmura, konta, dane wychodzą z komputera)
- [ ] 🚫 Przycisk „Wysłane” (Uploaded): dotyczy Picasa Web Albums

## Proponowana kolejność
1. Opisy zdjęć (z szukaniem po opisach, albumach i EXIF), zmiana daty, edycja wsadowa (kopiuj i wklej edycję), chipy osób w podglądzie. To największe braki w codziennej pracy.
2. Znak wodny, eksport galerii HTML i PDF, drukowanie, pokaz slajdów z muzyką i przejściami.
3. Zakraplacz bieli, retusz, szukanie po danych aparatu, skróty klawiszowe, pełny EXIF.
4. Wideo i RAW (duże, ale ważne dla wielu użytkowników), kopia zapasowa zdjęć na dysk zewnętrzny.

## Dodatkowe (z próśb użytkownika)
- [x] **Duplikaty: wybór ważniejszego katalogu**: kolejność katalogów, główne zdjęcie i „Duplikat”, pełne ścieżki, otwarcie w Eksploratorze.
- [x] **Znak wodny z własnym logo** przy eksporcie (jedno lub wiele zdjęć).
- [x] **Rozpoznawanie twarzy v2**: detekcja w większej rozdzielczości (+30-40% twarzy), wektory z odbiciem lustrzanym, ocena jakości twarzy, grupowanie hierarchiczne z zasadą „jedno zdjęcie = jedna osoba”, zakotwiczone osoby (imiona i ręczne poprawki), analiza na wielu wątkach (ok. 3,5 razy szybciej), przyciski „Pogrupuj od nowa” i „Przeanalizuj ponownie”.
- [x] **Łączenie osób v2**: okno z podglądem obu osób (okładka, przykładowe twarze, liczby zdjęć, imię), wybór, która osoba i które imię zostaje, procent podobieństwa, ostrzeżenie, gdy osoby są razem na zdjęciu, oraz podpowiedzi znanych osób („Czy to Anna? 82%”) na kartach osób bez imienia.
- [x] **Twarze zmieniające się z wiekiem**: osoba pamięta wygląd z różnych lat (wzorce rozłożone w czasie), twarz jest porównywana z ujęciami z okolicznych miesięcy, a dołączanie do osób z imieniem odbywa się w kilku przebiegach (osoba „idzie za dzieckiem” rok po roku). Im więcej twarzy ma osoba, tym łagodniejszy próg dołączenia (do 0,39).
- [x] **Poprawianie błędnych przypisań**: okno „Twarze” osoby (zaznacz twarze, przenieś do innej lub nowej osoby, odrzuć), usuwanie całej osoby i przywracanie odrzuconych twarzy.

## 10. Pomysły z nowoczesnych programów (Lightroom, Zdjęcia Google i Apple, digiKam, XnView MP, ACDSee, Immich, PhotoPrism)
Zasady FIBO zostają: wszystko lokalnie, nic do internetu, oryginały nietknięte. Oznaczenia jak wyżej (P = priorytet, T = trudność).

Szukanie i porządkowanie:
- [x] **Szukanie po treści zdjęcia** słowami („plaża”, „pies”, „tort”) lokalnym modelem rozpoznającym obrazy. P2 T L
- [x] **Automatyczne tagi** scen i obiektów z tego samego modelu (do zatwierdzenia przez użytkownika). P3 T L Gotowe: menu → „Podpowiedzi tagów”: pojęcia pasujące do wielu zdjęć, przegląd i odznaczanie zdjęć, suwak ostrożności; tag dostają tylko zatwierdzone zdjęcia.
- [x] **Szukanie tekstu na zdjęciach** (paragony, tablice, dokumenty) lokalnym OCR. P3 T L Gotowe: menu → „Szukaj tekstu na zdjęciach”: modele PaddleOCR PP-OCRv5 (Apache-2.0, ok. 13 MB) w instalatorze, rozpoznawanie jednorazowe i na życzenie w tle (można wstrzymać), polskie znaki; wyszukiwanie bez względu na wielkość liter i polskie znaki.
- [x] **Wspomnienia i „tego dnia”**: zdjęcia z tego samego dnia w poprzednich latach, na starcie programu. P2 T S
- [x] **Automatyczne wydarzenia i podróże** z dat i lokalizacji GPS, jako gotowe albumy do zatwierdzenia. P2 T M
- [x] **Stosy zdjęć seryjnych** i **RAW + JPEG jako jedno zdjęcie**. P2 T M
- [x] **Wybór najlepszego ze zdjęć seryjnych** i wykrywanie zdjęć nieostrych, poruszonych, ciemnych albo z zamkniętymi oczami (do przejrzenia i ukrycia). P3 T L Gotowe z jednym wyjątkiem: menu → „Przegląd jakości zdjęć” (nieostre i poruszone, ciemne, prześwietlone, najlepsze z serii; odrzucanie to flaga, którą można zdjąć). Zamknięte oczy nie są wykrywane (potrzebny byłby osobny model).
- [x] **Flagi „wybierz / odrzuć” i kolorowe etykiety** zapisywane do XMP, szybkie selekcjonowanie klawiaturą. P2 T S
- [x] **Porównanie 2 do 4 zdjęć obok siebie** z jednoczesnym powiększaniem. P2 T M
- [x] **Widok kalendarza** (miesiące z miniaturami). P3 T M Gotowe: menu → Szybkie akcje → „Widok kalendarza”: siatka miesiąca z miniaturą i liczbą zdjęć w dniu, rok i miesiące na górze, kliknięcie dnia pokazuje jego zdjęcia.
- [ ] **Zwierzęta domowe** jako osobna kategoria osób. P4 T L
- [ ] **Prywatny, zablokowany album** (ukryty po haśle). P3 T M
- [x] **Organizator plików**: przenoszenie zdjęć do folderów według daty, ze sprawdzeniem i cofaniem. P3 T M

Edycja:
- [x] **Edycja nieniszcząca**: zapis historii zmian obok zdjęcia (XMP) z możliwością cofnięcia po latach. P2 T L
- [x] **Krzywe, HSL, histogram na żywo**, dehaze, klarowność. P3 T M Gotowe w edytorze, zakładka „Dostrajanie”: histogram na żywo, krzywe (jasność i kanały R, G, B, do 12 punktów, obsługa myszą i klawiaturą), kolor według 8 zakresów barw (barwa, nasycenie, jasność), usuwanie mgły i klarowność; zapisują się w edycji nieniszczącej.
- [ ] **Maski lokalne** (pędzel, gradient liniowy i radialny) z osobnymi korektami. P3 T L
- [x] **Usuwanie obiektów** (wypełnianie tła), automatyczne prostowanie horyzontu. P4 T L Gotowe: „Usuwanie obiektów” w zakładce Podstawy (zamalowujesz obiekt, a program wypełnia go fragmentami otoczenia; działa najlepiej na jednolitym lub powtarzalnym tle) oraz przycisk „Prostuj horyzont automatycznie”.
- [x] **Wywoływanie RAW**: ekspozycja, balans bieli, odzyskiwanie świateł (dziś RAW ma tylko podgląd). P2 T L
- [x] **Korekta obiektywu** (dystorsja, winietowanie, aberracja chromatyczna). P4 T L Gotowe jako ręczne suwaki w zakładce Dostrajanie (bez bazy profili obiektywów).
- [x] **Łączenie zdjęć**: panorama, HDR, stos ostrości. P4 T L Częściowo: HDR (fuzja ekspozycji) i stos ostrości gotowe (menu zdjęcia przy 2 do 9 zaznaczonych, wyrównanie przesunięć, wynik jako nowy JPEG obok pierwszego zdjęcia). Panoramy świadomie pominięte.
- [x] **Znak wodny tekstowy** (dziś tylko logo). P3 T S Gotowe: w eksporcie przełącznik „Logo z pliku” i „Tekst” (do 80 znaków, 4 kolory, położenie, rozmiar, krycie).
- [x] **Konwersja wsadowa formatów** (np. HEIC lub RAW do JPEG, PNG, WebP) z wyborem jakości. P2 T S

Pliki i formaty:
- [x] **Rozpoznawanie wielu rodzajów plików**: HEIC/HEIF, AVIF, JPEG XL, RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 i inne), PSD, TIFF, TGA, PNM, DDS, HDR, QOI, OpenEXR, ICO, SVG. Pliki w tych formatach edytujemy tylko jako kopie.
- [x] **Wideo**: miniatury, odtwarzanie, filtr „Filmy”. Wycinanie fragmentu jeszcze nie. P2 T L
- [ ] **Zdjęcia ruchome** (Live Photos, krótkie klipy przy zdjęciu). P4 T L
- [x] **Natychmiastowe wykrywanie nowych plików** (obserwator folderów zamiast sprawdzania co kilka minut). P3 T M Gotowe: nasłuch systemu (biblioteka notify), po 1,5 s ciszy zwykłe sprawdzenie folderów; własne pliki FIBO (XMP, .fibo.json, .originals) są pomijane. Sprawdzanie co 5 minut i po powrocie do okna zostaje jako zabezpieczenie.
- [x] **Zarządzanie pamięcią podręczną miniatur** (rozmiar, czyszczenie). P3 T S Gotowe: menu → „Pamięć miniatur” (rozmiar, czyszczenie z potwierdzeniem; miniatury zdjęć z zapisaną edycją zostają).
- [x] **Edycja EXIF i IPTC** (autor, prawa autorskie, strefa czasowa). P3 T M Gotowe: menu zdjęcia → „Autor, prawa i opis (IPTC)” (autor, prawa, tytuł, miejscowość, kraj, także w XMP) oraz „Zmień datę” → „Strefa czasowa”. Pliki zdjęć zostają nietknięte.

Udostępnianie i wygoda:
- [ ] **Udostępnianie w sieci domowej** z kodem QR, tylko na żądanie i bez internetu. P4 T L
- [x] **Fotoksiążka** (układ stron do PDF). P4 T L Gotowe: menu → Szybkie akcje → „Fotoksiążka (PDF)”: 4 układy (1, 2, 4 zdjęcia na stronie albo mieszany), A4, A5 lub kwadrat, marginesy, tło, numery stron, strona tytułowa, podgląd stron; do 120 zdjęć i 80 stron.
- [ ] **Wersja angielska i inne języki interfejsu**. P3 T L
- [ ] **Pokaz slajdów na kilku monitorach** i sterowanie z pilota. P4 T S
- [x] **Widok twarzy osoby jak w Picasie**: kafelki to wycinki twarzy, niepewne przypisania mają pomarańczowy znak „?” oraz przyciski „to ta osoba” i „to nie ta osoba”, całe zdjęcie otwiera się po kliknięciu twarzy, a na karcie osoby widać liczbę twarzy do potwierdzenia.
- [x] **Okna postępu przy każdej dłuższej operacji** (z paskiem, prędkością, czasem do końca i wykresem): dodawanie zdjęć, rozpoznawanie twarzy, szukanie duplikatów, kopia zdjęć, eksport, galeria HTML, PDF, GIF, import z karty, sprawdzanie plików, odświeżanie danych, zapis XMP, obracanie, kolory i wklejanie edycji. Kilka operacji naraz daje kilka okien.
- [x] **Oś czasu przy prawej krawędzi** (pionowy suwak z latami i dymkiem, wysokość odcinków zależy od liczby zdjęć); w menu Wygląd można wybrać pasek na górze albo wyłączyć. Jednolite przyciski u góry (menu, zakładki, Dodaj folder), grupowane menu zdjęcia w dwóch kolumnach, zwarty wybór koloru.
- [x] **Kalendarz ze zdjęć** (menu → Szybkie akcje → Kalendarz): rok obecny lub następny, okładka i zdjęcie na każdy miesiąc (ręcznie albo „Dobierz zdjęcia automatycznie”: lokalny wybór według pory roku, oceny, ostrości, twarzy i różnorodności), trzy style, A4 lub A3, pionowo lub poziomo, polskie święta liczone od Wielkanocy, własne ważne daty, kolor akcentu dobierany do zdjęcia. Zapis do PDF i druk prosto z programu.

