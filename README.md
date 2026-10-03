# evertone.app

Strona aplikacji [Evertone](https://evertone.app) na Apple Watch, w 17 językach aplikacji. Statyczny HTML/CSS/JS,
publikowany przez GitHub Pages z gałęzi `main` (katalog główny). Domena jest w pliku `CNAME`.

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
- `assets/watch.js`: grywalny zegarek na stronie głównej, odwzorowujący ekran aplikacji: oktawy 3–8 przewijane w bok,
  pociągnięcie w górę wraca do ostatniej nuty, przytrzymanie gra „na ucho”, koronka ustawia głośność, a lista
  instrumentów i strój (415–466 Hz) otwierają się pod nazwą instrumentu. Nazwy nut i etykiety VoiceOver pochodzą z aplikacji.
- `assets/synth.js`: syntezator aplikacji (`watchOS/SynthKit`) przepisany na AudioWorklet, więc strona brzmi jak aplikacja.
  Zmiany w SynthKit trzeba przenieść tu ręcznie. AudioWorklet wymaga HTTPS albo localhost.
- Dłoń przy zegarku to emoji 🤏 z [Twemoji](https://github.com/jdecked/twemoji) (CC-BY 4.0), a ucho to „hearing” z Material Symbols (Apache 2.0).
- Bez zewnętrznych skryptów, czcionek i analityki: strona obiecuje, że niczego nie śledzi.
- Adres kontaktowy (`EMAIL`) jest w `tools/build.py`.

Podgląd lokalny: `python3 -m http.server`, potem http://localhost:8000.
