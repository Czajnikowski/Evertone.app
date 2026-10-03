#!/usr/bin/env python3
"""Copies the app's own wording into src/i18n/app.json, so the site names things exactly as the app does.

    python3 tools/sync-app-strings.py [path to Localizable.xcstrings]

Without a path it reads the app next to this repo: ../watchOS/Evertone/Localizable.xcstrings.

Run it again whenever the app's string catalog changes, then tools/build.py.
"""
import json
import sys
from pathlib import Path

# Site key -> key in the app's string catalog.
KEYS = {
    "app.piano": "instrument.piano",
    "app.strings": "instrument.strings",
    "app.brass": "instrument.brass",
    "app.voice": "instrument.voice",
    "app.noteNames": "note.names",
    "app.spokenNames": "note.spokenNames",
    "app.atTheEar": "ear.title",
    "app.octave": "pads.octave",
    "app.instrumentLabel": "instrument.label",
    "app.chooseInstrument": "instrument.choose",
    "app.raiseAndTap": "ear.raiseAndTap",
    "app.handOnShoulder": "ear.handOnShoulder",
    "app.tuning": "pitch.title",
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
        else:
            sys.exit(f"{app_key!r} has no {language} translation in the catalog")
        out.setdefault(language, {})[site_key] = value.replace("%lld", "{n}").replace("%@", "{name}")

path = Path(__file__).resolve().parent.parent / "src/i18n/app.json"
path.write_text(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
print(f"{path}: {len(out)} languages, {len(KEYS)} strings each")
