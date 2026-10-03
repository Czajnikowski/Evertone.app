#!/usr/bin/env python3
"""Builds the site's pages in every language from src/ into the repository root, where GitHub Pages serves them.

    python3 tools/build.py

Polish, the app's own language, is at the root; every other language in its own folder (en/, de/, …).
Templates are in src/pages; {{name}} is a string from src/i18n/<language>.json or one set here. Site strings
may use {app.*}, the app's own wording from src/i18n/app.json (see sync-app-strings.py), so the site names
the instruments, the notes and "Na ucho" exactly as the app does in that language.
Fails on a missing or unknown string rather than publishing a page with a hole in it.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
SITE = "https://evertone.app/"
EMAIL = "listen@evertone.app"

# Folder, HTML lang, name in its own language, text direction, Open Graph locale. The app's 17 languages.
LANGUAGES = [
    ("pl", "", "pl", "Polski", "ltr", "pl_PL"),
    ("en", "en", "en", "English", "ltr", "en_US"),
    ("de", "de", "de", "Deutsch", "ltr", "de_DE"),
    ("fr", "fr", "fr", "Français", "ltr", "fr_FR"),
    ("es", "es", "es", "Español", "ltr", "es_ES"),
    ("it", "it", "it", "Italiano", "ltr", "it_IT"),
    ("pt-BR", "pt-br", "pt-BR", "Português (Brasil)", "ltr", "pt_BR"),
    ("nl", "nl", "nl", "Nederlands", "ltr", "nl_NL"),
    ("ru", "ru", "ru", "Русский", "ltr", "ru_RU"),
    ("uk", "uk", "uk", "Українська", "ltr", "uk_UA"),
    ("tr", "tr", "tr", "Türkçe", "ltr", "tr_TR"),
    ("ja", "ja", "ja", "日本語", "ltr", "ja_JP"),
    ("ko", "ko", "ko", "한국어", "ltr", "ko_KR"),
    ("zh-Hans", "zh-hans", "zh-Hans", "简体中文", "ltr", "zh_CN"),
    ("zh-Hant", "zh-hant", "zh-Hant", "繁體中文", "ltr", "zh_TW"),
    ("ar", "ar", "ar", "العربية", "rtl", "ar_AR"),
    ("he", "he", "he", "עברית", "rtl", "he_IL"),
]
PAGES = ["index.html", "privacy.html", "support.html"]
SOURCE = "pl"


def load(name):
    return json.loads((SRC / "i18n" / name).read_text())


def url(folder, page):
    path = (folder + "/" if folder else "") + ("" if page == "index.html" else page)
    return SITE + path


def href(from_folder, to_folder, page):
    """Relative link from a page in one language folder to a page in another."""
    up = "../" if from_folder else ""
    target = (to_folder + "/" if to_folder else "") + ("" if page == "index.html" else page)
    return up + target or "./"


def text(value):
    """A string as HTML: quotes escaped so it fits in attributes too, and bare ampersands escaped."""
    value = re.sub(r"&(?![a-zA-Z]+;|#\d+;)", "&amp;", value)
    return value.replace('"', "&quot;")


def main():
    app = load("app.json")
    source = load(f"{SOURCE}.json")
    keys = {k for k in source if not k.startswith("_")}
    templates = {p: (SRC / "pages" / p).read_text() for p in PAGES}
    head = (SRC / "pages" / "_head.html").read_text()
    foot = (SRC / "pages" / "_foot.html").read_text()
    problems = []

    for code, folder, lang, native, direction, og in LANGUAGES:
        try:
            strings = load(f"{code}.json")
        except FileNotFoundError:
            problems.append(f"{code}: no src/i18n/{code}.json")
            continue
        if code not in app:
            problems.append(f"{code}: not in app.json; run sync-app-strings.py")
            continue
        own = {k for k in strings if not k.startswith("_")}
        for k in sorted(keys - own):
            problems.append(f"{code}: missing {k}")
        for k in sorted(own - keys):
            problems.append(f"{code}: unknown {k}")

        app_strings = app[code]

        def fill_app(value):
            return re.sub(r"\{(app\.[A-Za-z]+)\}", lambda m: app_strings[m.group(1)], value)

        values = {k: text(fill_app(v)) for k, v in strings.items() if not k.startswith("_")}
        values.update({k: text(v) for k, v in app_strings.items()})
        values.update({
            "lang": lang,
            "dir": direction,
            "code": code,
            "root": "../" if folder else "",
            "home": "./",
            "nativeName": native,
            "ogLocale": og,
            "email": EMAIL,
            "instruments": text(",".join(app_strings[k] for k in ["app.piano", "app.strings", "app.brass", "app.voice"])),
            "octave5": text(app_strings["app.octave"].replace("{n}", "5")),
        })

        out_dir = ROOT / folder if folder else ROOT
        out_dir.mkdir(exist_ok=True)
        for page in PAGES:
            name = page.removesuffix(".html")
            page_values = dict(values)
            page_values.update({
                "file": page,
                "title": values.get(f"meta.{name}.title", ""),
                "description": values.get(f"meta.{name}.description", ""),
                "canonical": url(folder, page),
            })
            # Messages drops "Evertone — " from a link preview's title as a site name, leaving only the tagline.
            # A colon keeps the name in: "Evertone: dźwięk zawsze pod ręką".
            title = page_values["title"]
            page_values["ogTitle"] = re.sub(r"^Evertone\s+[—–-]\s+", "Evertone: ", title) if title.startswith("Evertone") else "Evertone"
            page_values["alternates"] = "\n".join(
                f'  <link rel="alternate" hreflang="{l}" href="{url(f, page)}">' for _, f, l, *_ in LANGUAGES
            ) + f'\n  <link rel="alternate" hreflang="x-default" href="{url("en", page)}">'
            links = [("support.html", "nav.help"), ("privacy.html", "nav.privacy")] if page != "index.html" else [("support.html", "nav.help")]
            page_values["navLinks"] = "\n".join(
                f'      <a href="{p}"'
                + (' aria-current="page"' if p == page else "")
                + (' class="hide-narrow"' if page != "index.html" and p != page else "")
                + f">{values[k]}</a>"
                for p, k in links
            )
            page_values["languageLinks"] = "\n".join(
                f'          <li><a href="{href(folder, f, page)}" hreflang="{l}" lang="{l}" data-lang="{c}"'
                + (' aria-current="true"' if c == code else "")
                + f">{n}</a></li>"
                for c, f, l, n, *_ in LANGUAGES
            )
            page_values["scripts"] = f'  <script src="{page_values["root"]}assets/watch.js"></script>' if page == "index.html" else ""

            document = head + templates[page] + foot

            def fill(match):
                key = match.group(1)
                if key not in page_values:
                    problems.append(f"{code}/{page}: no value for {{{{{key}}}}}")
                    return ""
                return page_values[key]

            document = re.sub(r"\{\{([A-Za-z0-9_.]+)\}\}", fill, document)
            leftover = re.findall(r"\{[a-z]+\.[A-Za-z.]+\}", document)
            if leftover:
                problems.append(f"{code}/{page}: unfilled {sorted(set(leftover))}")
            (out_dir / page).write_text(document)

    if problems:
        print("\n".join(problems), file=sys.stderr)
        sys.exit(1)
    print(f"Built {len(PAGES)} pages in {len(LANGUAGES)} languages.")


if __name__ == "__main__":
    main()
