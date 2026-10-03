#!/usr/bin/env python3
"""Draws the link preview image, assets/og-image.png, from the app icon.

    python3 tools/og-image.py [path/to/AppIcon.png]

Without a path it reads the app next to this repo: ../watchOS/Evertone/Assets.xcassets/AppIcon.appiconset/AppIcon.png.
Messages, Slack and the rest show a link's og:image as a wide card, about 1.91:1, and crop a square image to fit,
which cut the pads off the icon. So the icon sits whole in the middle of a 1200×630 card, on the black its own
background fades to, with its left and right edges faded into that black so no seam shows. Needs Pillow.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 1200, 630
FADE = 60  # px at each side of the icon blended into the background

default = ROOT.parent / "watchOS/Evertone/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
icon = Image.open(sys.argv[1] if len(sys.argv) > 1 else default).convert("RGB")
icon = icon.resize((HEIGHT, HEIGHT), Image.LANCZOS)

mask = Image.new("L", icon.size, 255)
for x in range(FADE):
    alpha = round(255 * x / FADE)
    for column in (x, HEIGHT - 1 - x):
        mask.paste(alpha, (column, 0, column + 1, HEIGHT))

card = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
card.paste(icon, ((WIDTH - HEIGHT) // 2, 0), mask)
card.save(ROOT / "assets/og-image.png", optimize=True)
