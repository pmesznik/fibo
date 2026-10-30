# Bezpieczeństwo FIBO

## Zgłaszanie błędów bezpieczeństwa
Znalazłeś lukę? Nie publikuj jej od razu jako zwykłego zgłoszenia. Użyj zakładki **Security → Report a vulnerability**
w repozytorium https://github.com/pmesznik/fibo (jeśli jest niedostępna, otwórz zgłoszenie bez szczegółów ataku
i poproś o kontakt). Najnowsza wydana wersja jest jedyną wspieraną.

## Jak FIBO chroni dane użytkownika
- **Wszystko lokalnie.** Zdjęcia, biblioteka, tagi i oceny zostają na komputerze. Jedyny ruch sieciowy to kafelki mapy
  (`tiles.openfreemap.org`, po otwarciu zakładki Mapa albo okna „Lokalizacja”; adres kafelka zdradza serwerowi oglądany
  obszar, a połączenie jego adres IP), sprawdzanie aktualizacji (`github.com`, po uruchomieniu i co jakiś czas podczas pracy)
  i ewentualne pobranie WebView2 przy instalacji.
- **Polityka CSP** w oknie programu: skrypty tylko własne, połączenia tylko do IPC aplikacji i serwera map,
  brak ramek, obiektów i formularzy.
- **Brak protokołu zasobów (`asset:`):** miniatury i wycinki twarzy trafiają do okna jako bajty przez IPC, więc okno nie ma dostępu do plików na dysku.
- **Odtwarzanie filmów** idzie przez własny, wąski protokół `fibo-video` (w Windows `http://fibo-video.localhost/<numer>`): zwraca bajty pliku
  wyłącznie dla zdjęcia z biblioteki oznaczonego jako film, po numerze, dla znanych rozszerzeń (mp4, m4v, mov, webm, ogv) i w kawałkach do 8 MB
  (żądania Range). Okno nie dostaje ścieżek ani dostępu do dowolnych plików. Odtwarzanie i miniatury filmów robi dekoder okna (WebView2), program
  niczego sam nie dekoduje i nie uruchamia zewnętrznych programów.
- **Minimalne uprawnienia okna:** `core`, okno wyboru folderu, aktualizacje i restart. Brak wtyczek plików, powłoki i HTTP.
- **Aktualizacje podpisane** kluczem autora (minisign). Program instaluje wyłącznie aktualizację z poprawnym podpisem,
  pobraną po HTTPS z wydań tego repozytorium. Klucz prywatny jest tylko u autora i jako sekret GitHub Actions,
  dostępny wyłącznie w kroku podpisującym gotowy instalator (kod zależności budowania go nie widzi).
- **Pliki użytkownika:** przed pierwszą zmianą zdjęcia (edycja, obrót) powstaje sprawdzona kopia w `.originals`,
  a zapis idzie przez plik tymczasowy, więc przerwanie nie uszkodzi zdjęcia. Metadane trafiają do osobnych plików `.xmp`,
  cudzych plików XMP FIBO nie nadpisuje. Usuwanie plików idzie do Kosza Windows, a miniatury usuniętych zdjęć są kasowane z folderu danych.
- **Kopia zdjęć na dysk** nie usuwa niczego, ale zmienione zdjęcie zastępuje starszą kopię tego samego pliku. Foldery o tej samej nazwie
  z różnych dysków trafiają do osobnych folderów (z literą dysku w nazwie).
- **Kopia biblioteki** (plik .db) zawiera tagi, oceny, albumy, ścieżki i opisy zdjęć, a nie zawiera osób ani danych twarzy.
  Kopia bezpieczeństwa, którą program robi przed przywróceniem, leży w folderze danych programu, zawiera też osoby i jest tylko jedna (najnowsza).
- **Eksport galerii HTML** zawiera pomniejszone zdjęcia bez EXIF (bez współrzędnych), a także nazwy plików, opisy i daty zdjęć.
- **Nazwy plików** przy zmianie nazwy są walidowane: znaki niedozwolone w Windows, nazwy urządzeń
  (CON, NUL, COM1-9, LPT1-9, także z indeksem górnym), znaki sterujące i niewidoczne znaki zmiany kierunku tekstu.
  Przenoszenie i kopiowanie nigdy nie nadpisuje istniejącego pliku.
- **Zepsute lub złośliwe pliki:** parsery JPEG, IPTC i XMP mają limity (768 KB nagłówka JPEG, 1 MB pliku XMP,
  200 tagów na plik), a obrazy dekodowane są z limitami biblioteki `image` (bomba dekompresyjna kończy się błędem).
- **SQL:** wszystkie zapytania z danymi użytkownika używają parametrów.
- **Usuwanie zdjęć:** „Usuń z biblioteki” tylko ukrywa zdjęcia (pliki zostają). „Przenieś do Kosza” działa wyłącznie
  na zdjęciach znanych bibliotece, odrzuca foldery, dowiązania i pliki inne niż zdjęcia, nie usuwa całych folderów,
  a od 20 zdjęć (i dla całego folderu) backend wymaga słowa potwierdzenia.
- **Rozpoznawanie twarzy (opcjonalne, domyślnie wyłączone):** działa wyłącznie lokalnie. Modele (YuNet, SFace) są dołączone
  do instalatora, a przy budowaniu sprawdzana jest ich suma SHA256 (przypięta w kodzie). Moduły twarzy nie zawierają
  kodu sieciowego, a ich zależności nie ciągną bibliotek sieciowych (testy sprawdzają kod i `Cargo.lock`).
  Wektory twarzy są w bazie zaszyfrowane kluczem konta Windows (DPAPI), a małe wycinki twarzy (128 px, do okna Osoby) leżą jako zwykłe pliki w folderze danych programu i znikają po usunięciu danych twarzy, imiona nie trafiają do zdjęć ani XMP, nic nie
  jest logowane, a jedno polecenie usuwa wszystkie dane twarzy. Wycinki twarzy (miniatury) leżą w folderze danych
  aplikacji obok miniatur zdjęć i są usuwane razem z danymi twarzy.

## Testy bezpieczeństwa
Uruchamiane automatycznie w GitHub Actions przy każdej zmianie (`Testy FIBO`) oraz co tydzień dla zależności
(`Audyt zaleznosci FIBO`). Lokalnie:

```bash
cd app
node --test "tests/*.test.mjs"           # konfiguracja, uprawnienia, kod frontu, repozytorium, workflowy, interfejs
cd src-tauri && cargo test   # parsery, pliki, albumy, XMP, odporność na zepsute dane, współbieżność
npm audit                    # zależności npm
```

Zakres: CSP i uprawnienia Tauri, łańcuch aktualizacji, sekrety w repozytorium, wzorce niebezpiecznego kodu
we froncie, bezpieczeństwo workflowów, fuzzing parserów (losowe i uszkodzone dane), wrogie tagi i nazwy,
ataki przez ścieżki, bomby w obrazach, wyścigi zapisów, dostępność i standard designu interfejsu.

Testy prywatności twarzy: `app/tests/faces-privacy.test.mjs`.

## Znane ograniczenia
- Rozpoznawanie twarzy nie jest nieomylne: różne osoby mogą trafić do jednej grupy lub jedna osoba do dwóch. Grupy można łączyć ręcznie.
- Instalator nie jest podpisany certyfikatem Windows (SmartScreen i Smart App Control mogą go blokować).
- Style okna dopuszczają `style-src 'unsafe-inline'` (biblioteki interfejsu ustawiają style w atrybutach).
- Mapa ładuje styl i kafelki z zewnętrznego serwera (OpenFreeMap); to jedyne źródło zewnętrznych danych w interfejsie.
