#!/usr/bin/env python3
"""Checks translations against the English copy: the same keys, and in each string the same markup
(<em>, <strong>) and the same {app.*} placeholders.

    python3 tools/check-translation.py de fr …   (no arguments: every language)
"""
import json
import re
import sys
from pathlib import Path

I18N = Path(__file__).resolve().parent.parent / "src/i18n"
reference = json.loads((I18N / "en.json").read_text())
keys = set(reference)
codes = sys.argv[1:] or sorted(p.stem for p in I18N.glob("*.json") if p.stem not in ("app", "en"))


def shape(value):
    return sorted(re.findall(r"</?(?:em|strong)>|\{app\.[A-Za-z]+\}", value))


failed = False
for code in codes:
    strings = {k: v for k, v in json.loads((I18N / f"{code}.json").read_text()).items() if not k.startswith("_")}
    problems = [f"missing {k}" for k in sorted(keys - set(strings))]
    problems += [f"unknown {k}" for k in sorted(set(strings) - keys)]
    for k in sorted(keys & set(strings)):
        if shape(strings[k]) != shape(reference[k]):
            problems.append(f"{k}: markup/placeholders {shape(strings[k])} ≠ {shape(reference[k])}")
        if re.search(r"&(?![a-zA-Z]+;|#\d+;)", strings[k]):
            problems.append(f"{k}: bare & (write &amp;)")
    print(f"{code}: " + ("OK" if not problems else "\n  " + "\n  ".join(problems)))
    failed |= bool(problems)
sys.exit(1 if failed else 0)
