#!/usr/bin/env python3
"""Copies the app's own wording into src/i18n/app.json, so the site names things exactly as the app does.

    python3 tools/sync-app-strings.py [path to Localizable.xcstrings]

Without a path it reads the app next to this repo: ../watchOS/Evertone/Localizable.xcstrings.

Run it again whenever the app's string catalog changes, then tools/build.py.
"""
import json
import sys
from pathlib import Path

# Site key -> key in the app's string catalog (its Polish source text).
KEYS = {
    "app.piano": "Fortepian",
    "app.strings": "Smyczki",
    "app.brass": "Blacha",
    "app.voice": "Głos",
    "app.noteNames": "note.names",
    "app.spokenNames": "note.spokenNames",
    "app.atTheEar": "Na ucho",
    "app.octave": "oktawa %lld",
    "app.instrumentLabel": "Instrument: %@",
    "app.chooseInstrument": "Wybierz instrument",
    "app.raiseAndTap": "Przyłóż do ucha i stuknij dwa razy palcami",
    "app.handOnShoulder": "Dłoń na bark, przy szyi",
}

default = Path(__file__).resolve().parent.parent.parent / "watchOS/Evertone/Localizable.xcstrings"
catalog = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else default).read_text())
source = catalog["sourceLanguage"]
strings = catalog["strings"]
out = {}
for site_key, app_key in KEYS.items():
    entry = strings[app_key]
    localizations = entry.get("localizations", {})
    languages = sorted({source, *localizations})
    for language in languages:
        unit = localizations.get(language, {}).get("stringUnit")
        if unit:
            value = unit["value"]
        elif language == source:
            # Keys like note.names keep their Polish text in the code's default value, not the catalog.
            value = {"note.names": "c,cis,d,dis,e,f,fis,g,gis,a,b,h",
                     "note.spokenNames": "c,cis,d,dis,e,f,fis,g,gis,a,b,h"}.get(app_key, app_key)
        else:
            sys.exit(f"{app_key!r} has no {language} translation in the catalog")
        out.setdefault(language, {})[site_key] = value.replace("%lld", "{n}").replace("%@", "{name}")

path = Path(__file__).resolve().parent.parent / "src/i18n/app.json"
path.write_text(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
print(f"{path}: {len(out)} languages, {len(KEYS)} strings each")
