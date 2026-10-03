# evertone.app

Strona aplikacji [Evertone](https://evertone.app) na Apple Watch, w 17 językach aplikacji. Statyczny HTML/CSS/JS,
publikowany przez GitHub Pages z gałęzi `gh-pages` (zob. „Publikacja”). Domena jest w pliku `CNAME`.

Strony HTML są generowane. Nie edytuj ich ręcznie, zmieniaj `src/` i przebuduj:

```
python3 tools/sync-app-strings.py   # gdy zmienią się teksty w aplikacji (czyta ../watchOS)
python3 tools/check-translation.py                                             # po zmianie tłumaczeń
python3 tools/build.py
```

- `src/pages/` to szablony: `index.html`, `privacy.html` (Privacy Policy URL), `support.html` (Support URL)
  oraz wspólne `_head.html` i `_foot.html`.
- `src/i18n/<język>.json` to teksty strony; `pl.json` jest źródłem, `en.json` wzorcem dla sprawdzarki.
  `{app.*}` to słowa z aplikacji (instrumenty, nazwy nut, „Na ucho”) z `src/i18n/app.json`,
  więc strona nazywa rzeczy tak samo jak aplikacja w każdym języku.
- Polski jest w katalogu głównym, pozostałe języki w podkatalogach (`en/`, `de/`, …, `zh-hant/`); arabski i hebrajski
  od prawej do lewej. Polska strona przy pierwszej wizycie przechodzi na język przeglądarki (`assets/lang.js`),
  a wybór z menu języków jest zapamiętywany.
- `assets/base.css` to układ, a `assets/style.css` styl i kolory w wersji jasnej i ciemnej.
  Obie uwzględniają zwiększony kontrast, ograniczenie ruchu i wymuszone kolory systemu.
- `assets/theme.js`: tryb jasny lub ciemny idzie za systemem; przycisk w nagłówku przełącza system → jasny → ciemny.
- `assets/watch.js`: grywalny zegarek na stronie głównej (Web Audio), z nazwami nut i etykietami VoiceOver z aplikacji.
- Bez zewnętrznych skryptów, czcionek i analityki: strona obiecuje, że niczego nie śledzi.
- `assets/og-image.png` to obrazek podglądu linku (Wiadomości, Slack itd.), 1200×630 z ikoną aplikacji; rysuje go `python3 tools/og-image.py`.
- Adres kontaktowy (`EMAIL`) jest w `tools/build.py`.

Podgląd lokalny: `python3 -m http.server`, potem http://localhost:8000.

## Publikacja

`.github/workflows/site.yml` buduje stronę przy każdym pushu i wrzuca ją na gałąź `gh-pages`, z której serwuje
GitHub Pages:

- gałąź domyślna trafia do katalogu głównego, czyli na https://evertone.app/;
- każda inna gałąź dostaje podgląd pod https://evertone.app/preview/<gałąź>/ (`/` zamienione na `-`, z `noindex`),
  podlinkowany w pull requeście jako deployment; usunięcie gałęzi usuwa podgląd.

Teksty aplikacji workflow bierze z `main` w Evertone.watchOS (przy ręcznym uruchomieniu można wybrać gałąź).
To repozytorium jest prywatne, więc potrzebny jest sekret `WATCHOS_TOKEN`: token fine-grained z odczytem zawartości
Evertone.watchOS. Bez niego build używa zapisanego `src/i18n/app.json`.
