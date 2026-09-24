#!/usr/bin/env python3
"""Build the static, subset Noto Sans SC fonts used by the DingTalk AI handbook.

    /data/tmp/ubuntu/venv-fonts/bin/python docs/enterprise/handbook/subset-fonts.py

Pins the wght axis of the variable font at each weight the handbook uses,
keeps only the characters found in dingtalk-ai-handbook.html plus printable
ASCII and common punctuation, and writes fonts/NotoSansSC-<weight>.subset.woff2.
Static subsets let Chromium embed compact TrueType fonts in the PDF instead of
per-glyph vector programs. Re-run after editing the handbook text.

Needs fontTools and brotli (for WOFF2), e.g. in /data/tmp/ubuntu/venv-fonts.
Noto Sans SC is licensed under the SIL Open Font License 1.1; see fonts/OFL.txt.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
HTML = HERE / "dingtalk-ai-handbook.html"
OUT_DIR = HERE / "fonts"
SOURCE_FONT = Path("/data/tmp/ubuntu/fonts/NotoSansSC.ttf")

# Every font-weight the handbook CSS uses. The script fails if the HTML asks
# for a weight that is not listed here.
WEIGHTS = (400, 600, 700)

# Always kept, so small copy edits rarely need a rebuild.
ASCII = "".join(chr(code) for code in range(0x20, 0x7F))
PUNCTUATION = (
    "，。、；：？！“”‘’「」『』《》〈〉（）［］【】〔〕—–…·・～￥％＋－＝／＼｜"
    "→←↑↓×÷°•✓※\u3000"
)


def used_weights(html: str) -> set[int]:
    """font-weight values outside @font-face rules."""
    without_faces = re.sub(r"@font-face\s*\{[^}]*\}", "", html)
    return {int(value) for value in re.findall(r"font-weight:\s*(\d{3})\b", without_faces)}


def text_characters(html: str) -> set[str]:
    """Every printable character in the file, plus the always-kept sets."""
    chars = {char for char in html if char.isprintable() or char == "\u3000"}
    chars.update(ASCII)
    chars.update(PUNCTUATION)
    return chars


def subset_variable(chars: set[str]) -> tuple[bytes, list[str]]:
    """Cut the variable font down to the kept characters (all weights still available)."""
    font = TTFont(SOURCE_FONT, recalcTimestamp=False)
    cmap = font.getBestCmap()
    missing = sorted(char for char in chars if ord(char) not in cmap and not char.isspace())

    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.hinting = False

    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes={ord(char) for char in chars})
    subsetter.subset(font)

    buffer = io.BytesIO()
    font.save(buffer)
    return buffer.getvalue(), missing


def instantiate(variable: bytes, weight: int) -> Path:
    """Pin wght at one value and write it as WOFF2."""
    font = TTFont(io.BytesIO(variable), recalcTimestamp=False)
    static = instancer.instantiateVariableFont(font, {"wght": weight}, updateFontNames=True)
    static.flavor = "woff2"
    out = OUT_DIR / f"NotoSansSC-{weight}.subset.woff2"
    static.save(out)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.parse_args()

    if not SOURCE_FONT.exists():
        print(f"Source font not found: {SOURCE_FONT}", file=sys.stderr)
        return 1

    html = HTML.read_text(encoding="utf-8")
    unknown = used_weights(html) - set(WEIGHTS)
    if unknown:
        print(f"HTML uses weights without a subset font: {sorted(unknown)}", file=sys.stderr)
        return 1

    chars = text_characters(html)
    variable, missing = subset_variable(chars)
    if missing:
        print(f"Characters missing from the source font: {''.join(missing)!r}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(exist_ok=True)
    for weight in WEIGHTS:
        out = instantiate(variable, weight)
        print(f"{out.relative_to(HERE)}: {out.stat().st_size} bytes")
    print(f"{len(chars)} characters kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())
