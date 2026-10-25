# FIBO

Menedżer i edytor zdjęć na Windows, inspirowany Picasą 3. Zbudowany w Tauri (Rust) i React.

## Funkcje
- Biblioteka zdjęć grupowana według lat i miesięcy, siatka z oryginalnymi proporcjami
- Oceny, ulubione, tagi i wyszukiwanie
- Edytor z efektami i korektami (zapis z kopią oryginału w folderze `.originals`)
- Kolaże: siatka, mozaika, stos zdjęć, kontaktówka
- Globus ze zdjęciami (pinezki z GPS)
- Wyszukiwanie duplikatów (identyczne i podobne), usuwanie przez Kosz Windows

## Budowanie
Wymagania: Node.js 22, Rust (stable), Visual Studio Build Tools z C++.

```bash
cd app
npm ci
npx tauri dev      # tryb deweloperski
npx tauri build    # instalator NSIS w app/src-tauri/target/release/bundle/nsis
```

Instalator budowany jest też w GitHub Actions (zakładka Actions, workflow „Build FIBO (Windows)”).

## Licencja
GPL-2.0-or-later. Ikony i logo: własny zestaw FIBO.