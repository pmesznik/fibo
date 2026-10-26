# Bezpieczeństwo FIBO

## Zgłaszanie błędów bezpieczeństwa
Znalazłeś lukę? Nie publikuj jej od razu jako zwykłego zgłoszenia. Użyj zakładki **Security → Report a vulnerability**
w repozytorium https://github.com/pmesznik/fibo (jeśli jest niedostępna, otwórz zgłoszenie bez szczegółów ataku
i poproś o kontakt). Najnowsza wydana wersja jest jedyną wspieraną.

## Jak FIBO chroni dane użytkownika
- **Wszystko lokalnie.** Zdjęcia, biblioteka, tagi i oceny zostają na komputerze. Jedyny ruch sieciowy to kafelki mapy
  (`tiles.openfreemap.org`, tylko po otwarciu zakładki Mapa), sprawdzanie aktualizacji (`github.com`) i ewentualne
  pobranie WebView2 przy instalacji.
- **Polityka CSP** w oknie programu: skrypty tylko własne, połączenia tylko do IPC aplikacji i serwera map,
  brak ramek, obiektów i formularzy.
- **Protokół zasobów** (`asset:`) ma zakres tylko folderu miniatur w danych aplikacji, nie całego dysku.
- **Minimalne uprawnienia okna:** `core`, okno wyboru folderu, aktualizacje i restart. Brak wtyczek plików, powłoki i HTTP.
- **Aktualizacje podpisane** kluczem autora (minisign). Program instaluje wyłącznie aktualizację z poprawnym podpisem,
  pobraną po HTTPS z wydań tego repozytorium. Klucz prywatny jest tylko u autora i jako sekret GitHub Actions,
  dostępny wyłącznie w kroku podpisującym gotowy instalator (kod zależności budowania go nie widzi).
- **Pliki użytkownika:** zdjęcia nie są modyfikowane (edycja ma kopię w `.originals`, a metadane trafiają do
  osobnych plików `.xmp`). Cudzych plików XMP FIBO nie nadpisuje. Usuwanie plików idzie do Kosza Windows.
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
  Wektory twarzy są w bazie zaszyfrowane kluczem konta Windows (DPAPI), imiona nie trafiają do zdjęć ani XMP, nic nie
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
