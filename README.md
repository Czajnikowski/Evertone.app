# evertone.app

Strona aplikacji [Evertone](https://evertone.app) na Apple Watch. Statyczny HTML/CSS/JS, bez kroku budowania,
publikowany przez GitHub Pages z gałęzi `main` (katalog główny). Domena jest w pliku `CNAME`.

- `index.html`, `privacy.html`, `support.html` to wersja polska, a `en/` angielska.
  `privacy.html` i `support.html` to adresy Privacy Policy i Support w App Store Connect.
- `assets/base.css` to układ, a `assets/style.css` styl i kolory w wersji jasnej i ciemnej.
- `assets/theme.js`: tryb jasny lub ciemny idzie za systemem; przycisk w nagłówku przełącza system → jasny → ciemny.
- `assets/watch.js`: grywalny zegarek na stronie głównej (Web Audio).
- Bez zewnętrznych skryptów, czcionek i analityki: strona obiecuje, że niczego nie śledzi.

Podgląd lokalny: `python3 -m http.server`, potem http://localhost:8000.
