# FIBO a Picasa 3: lista funkcji do odhaczania

Legenda: `[x]` jest w FIBO (wydane lub na `main`), `[ ]` do dodania. Przy pozycjach do dodania: **P** = priorytet (1 najwyższy),
**T** = trudność (S małe, M średnie, L duże). Zasady FIBO: wszystko lokalnie, nic do internetu, oryginały nietknięte.
Pozycje oznaczone 🚫 świadomie pomijamy (wymagają usług w chmurze albo łamią zasadę prywatności).

Lista powstała z pamięci o Picasie 3 i z przeglądu FIBO, więc przy wątpliwej pozycji warto ją potwierdzić przed pracą.

## 1. Biblioteka i porządkowanie
- [x] Foldery z obserwowaniem (nowe zdjęcia dodają się same)
- [x] Widok według lat i dat, siatka z oryginalnymi proporcjami
- [x] Albumy (własne, dodawanie i usuwanie zdjęć)
- [x] Oceny gwiazdkami, ulubione
- [x] Tagi i wyszukiwanie po tagach, wczytywanie tagów i ocen z plików (XMP, EXIF, IPTC)
- [x] Wyszukiwanie duplikatów (identyczne i podobne)
- [x] Ukrywanie zdjęć w bibliotece i przywracanie
- [x] Filtry: ocena, zakres dat, bez tagów, bez lokalizacji, bez oceny
- [x] Sortowanie: data, nazwa, ocena, rozmiar
- [x] Kopia zapasowa i przywracanie biblioteki
- [ ] **Opisy zdjęć (podpisy)**: pole „Opis” przy zdjęciu, szukanie po opisie, zapis do XMP. P1 T S
- [ ] **Taca („Hold”)**: trwały koszyk zaznaczonych zdjęć, do którego dokładasz z różnych folderów, a potem robisz akcję na całości (album, eksport, kolaż). P2 T M
- [ ] **Zmiana daty zdjęcia / przesunięcie dat** (np. zły zegar aparatu): ustaw datę lub przesuń o N godzin dla wielu zdjęć. P1 T M
- [ ] **Własne albumy: kolejność zdjęć** przeciąganiem, opis i data albumu. P3 T M
- [ ] **Albumy inteligentne** (zapisane filtry, np. „5 gwiazdek z 2023”). P3 T M
- [ ] **Wyszukiwanie po kolorze** dominującym. P4 T M
- [ ] **Wyszukiwanie po danych aparatu** (model, obiektyw, ISO, przysłona, czas) i filtr „aparat”. P2 T M
- [ ] **Zaznaczanie podobnych** do wybranego zdjęcia. P4 T M
- [ ] **Statystyki biblioteki** (liczba zdjęć, rozmiar, zdjęcia na rok, najczęstsze aparaty). P4 T S
- [ ] **Blokowanie folderu** przed zmianami z poziomu FIBO (ochrona przed przypadkowym usunięciem). P3 T S
- [ ] **Skróty klawiszowe w bibliotece** (np. 1 do 5 oceny, F ulubione, Del ukrywanie) i ich lista pod F1. P2 T S
- [ ] Obsługa **plików wideo** w bibliotece (miniatura, odtwarzanie, filtr). P3 T L
- [ ] Obsługa **plików RAW** (CR2, NEF, ARW, DNG): miniatura z osadzonego podglądu. P3 T L

## 2. Osoby i miejsca
- [x] Rozpoznawanie twarzy lokalnie, grupowanie w osoby, imiona, łączenie, okładka, pomijanie
- [x] Mapa z globusem, pinezki w kolorach, skupiska, dzień i noc z animacją
- [x] Ręczne ustawianie lokalizacji (klik na mapie albo współrzędne)
- [ ] **Chipy osób w podglądzie zdjęcia** (kto jest na tym zdjęciu) i ręczne przypisanie twarzy do osoby. P1 T M
- [ ] **Twarze, których nie znaleziono**: ręczne zaznaczenie twarzy na zdjęciu. P3 T M
- [ ] **„Zdjęcia osoby A i osoby B razem”** (przecięcie osób). P3 T S
- [ ] **Nazwy miejsc** (miasto, kraj) z lokalnego słownika współrzędnych, szukanie po miejscu. P3 T L
- [ ] **Eksport tras / lokalizacji** do pliku GPX lub KML. P4 T S
- [ ] **Film z twarzy** (pokaz zdjęć jednej osoby). P4 T M

## 3. Edytor: poprawki podstawowe
- [x] Kadrowanie (proporcje), prostowanie, obrót, odbicie
- [x] Czerwone oczy
- [x] Szczęśliwy traf, auto kontrast, auto kolor
- [x] Doświetlenie, światła, cienie, jasność, kontrast, gamma, temperatura barwowa, nasycenie, wyostrzenie
- [x] Tekst na zdjęciu
- [x] Cofnij i ponów, przywrócenie oryginału, porównanie z oryginałem
- [ ] **Neutralny kolor (zakraplacz)**: klik w szary punkt koryguje balans bieli. P2 T S
- [ ] **Retusz** (usuwanie plam i skaz pędzlem). P2 T M
- [ ] **Kadrowanie ręczne z ramką** i gotowe formaty wydruku 10x15, 13x18, A4 oraz obrót ramki. P3 T M
- [ ] **Zastosuj te same zmiany do wielu zdjęć** (kopiuj i wklej edycję, edycja wsadowa). P1 T M
- [ ] **Obrót wielu zdjęć bez utraty jakości** (znacznik orientacji). P2 T S
- [ ] **Poprawka perspektywy** (wyrównanie pionów). P4 T L
- [ ] **Redukcja szumu**. P4 T M
- [ ] **Rozmycie / pogłębienie ostrości w obszarze** (maska radialna). P4 T M
- [ ] **Znak wodny** (tekst lub obraz) przy eksporcie. P2 T M
- [ ] **Rysowanie i strzałki** na zdjęciu. P4 T M

## 4. Edytor: efekty
- [x] Czarno-białe, sepia, ocieplenie, podbicie, negatyw, ziarno, zmiękczenie, poświata, Orton, miękki fokus
- [x] Czerń i biel z ogniskiem, winieta, gradientowy odcień, dwutonowy, mapa cieplna, noktowizor, podczerwień
- [x] Mat, cross process, Lomo, lata 60., Polaroid, HDR, posteryzacja, pikselizacja, szkic, komiks, neon, ramka
- [ ] **Przechylenie i przesunięcie (tilt-shift)**, miniatura. P4 T M
- [ ] **Efekt „Kolor selektywny”** (zostaw jeden kolor). P3 T M
- [ ] **Własne zestawy efektów** (zapisz receptę i użyj na innych zdjęciach). P3 T M

## 5. Zapis, eksport, udostępnianie
- [x] Zapis jako kopia lub nadpisanie (oryginał w `.originals`)
- [x] Eksport pomniejszonych kopii (bez EXIF i lokalizacji)
- [x] Przenoszenie, kopiowanie, zmiana nazw (jedna i zbiorczo), Kosz Windows z zabezpieczeniami
- [x] Import z karty pamięci do folderów według daty
- [x] Duplikaty do Kosza
- [ ] **Eksport galerii HTML** (strona offline do wysłania znajomym lub wgrania na serwer). P2 T M
- [ ] **Eksport do PDF** (album, arkusz kontaktowy). P2 T M
- [ ] **Drukowanie** (układy: pojedyncze, 2x2, arkusz kontaktowy, rozmiar papieru). P2 T M
- [ ] **Wysyłka e-mailem**: tylko przygotowanie pomniejszonych kopii do załączenia (bez wysyłania przez FIBO). P3 T S
- [ ] **Kopia zapasowa zdjęć na dysk zewnętrzny** (kopiowanie nowych i zmienionych plików, bez usuwania). P2 T L
- [ ] **Ustaw jako tapetę** pulpitu. P4 T S
- [ ] **Otwórz w zewnętrznym programie** (np. Photoshop, Paint) i wczytaj zmiany. P3 T S
- [ ] 🚫 Albumy internetowe i synchronizacja z chmurą (Picasa Web, Google Photos)
- [ ] 🚫 Zamawianie odbitek online

## 6. Kolaże, pokaz slajdów, film
- [x] Kolaż z zaznaczonych zdjęć
- [x] Pokaz slajdów (spacja)
- [x] Zdjęcia w pełnym ekranie, powiększanie, porównanie
- [ ] **Kolaż: tryby** (stos zdjęć, mozaika, arkusz kontaktowy, plakat z wieloma rozmiarami). P3 T M
- [ ] **Pokaz slajdów: przejścia, czas na zdjęcie, muzyka z pliku, podpisy**. P2 T M
- [ ] **Film ze zdjęć** (eksport pokazu slajdów do wideo MP4). P3 T L
- [ ] **Wygaszacz ekranu** ze zdjęć z biblioteki. P4 T M
- [ ] **Animowany GIF** z kilku zdjęć. P4 T S

## 7. Metadane i pliki
- [x] Podgląd informacji (EXIF: aparat, data, wymiary), tagi w panelu
- [x] Zapis tagów i ocen do plików XMP, odczyt z EXIF XP i IPTC
- [ ] **Pełny podgląd EXIF** (przysłona, czas, ISO, ogniskowa, obiektyw, flesz) i kopiowanie wartości. P2 T S
- [ ] **Edycja EXIF/IPTC**: autor, prawa autorskie, opis (w XMP, bez ruszania pliku). P3 T M
- [ ] **Usuwanie metadanych** z wybranych zdjęć (kopie bez GPS) jako osobna akcja. P3 T S
- [ ] **Wykrywanie uszkodzonych plików** i raport. P4 T S

## 8. Wygląd i wygoda
- [x] Motyw jasny, ciemny i systemowy, nowoczesne ikony, wysoki kontrast
- [x] Automatyczne aktualizacje z podpisem, instalator z polskimi tekstami
- [ ] **Wersja angielska interfejsu** (przełącznik języka). P3 T L
- [ ] **Suwak wielkości miniatur** z zapamiętaniem oraz tryby wyświetlania (siatka, lista z danymi). P3 T S
- [ ] **Pasek stanu z liczbą zaznaczonych i rozmiarem**. P4 T S
- [ ] **Przeciąganie zdjęć na albumy** w menu bocznym. P3 T M
- [ ] **Przeciągnij i upuść plików z Eksploratora** do FIBO (dodanie folderu). P3 T M, uwaga: wymaga ponownego włączenia obsługi upuszczania w oknie
- [ ] **Praca z wieloma biblioteka** (profile, np. rodzinna i służbowa). P4 T L

## Proponowana kolejność
1. Opisy zdjęć, zmiana daty, edycja wsadowa (kopiuj i wklej edycję), chipy osób w podglądzie. To największe braki w codziennej pracy.
2. Znak wodny, eksport galerii HTML i PDF, drukowanie, pokaz slajdów z muzyką i przejściami.
3. Zakraplacz bieli, retusz, szukanie po danych aparatu, skróty klawiszowe, pełny EXIF.
4. Wideo i RAW (duże, ale ważne dla wielu użytkowników), kopia zapasowa zdjęć na dysk zewnętrzny.
