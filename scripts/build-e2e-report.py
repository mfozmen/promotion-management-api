"""Render one end-to-end evidence folder as a single PDF.

    python scripts/build-e2e-report.py docs/e2e-evidence/2026-09-14

The evidence is written as Markdown because that is what survives review; the PDF
is the copy a reader outside the repository gets. Regenerating it is the whole
reason this script is committed rather than run once and thrown away.
"""

import io
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, Preformatted, SimpleDocTemplate

BASE = sys.argv[1] if len(sys.argv) > 1 else "docs/e2e-evidence/2026-09-14"
OUT = os.path.join(BASE, "e2e-report-" + os.path.basename(BASE.rstrip("/\\")) + ".pdf")

# The base-14 fonts carry no typographic punctuation, and a missing glyph is a
# black box in the PDF rather than an error here.
SUBS = {
    "—": "-", "–": "-", "‘": "'", "’": "'",
    "“": '"', "”": '"', "…": "...", " ": " ",
    "→": "->", "×": "x", "·": ".", "•": "*",
}

styles = getSampleStyleSheet()
BODY = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9.5, leading=13, spaceAfter=5)
H1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=16, spaceBefore=10,
                    spaceAfter=8, textColor=colors.HexColor("#111111"))
H2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12.5, spaceBefore=10, spaceAfter=5)
H3 = ParagraphStyle("h3", parent=styles["Heading3"], fontSize=10.5, spaceBefore=8, spaceAfter=4)
MONO = ParagraphStyle("mono", parent=styles["Code"], fontSize=8, leading=10)


def plain(text):
    for bad, good in SUBS.items():
        text = text.replace(bad, good)
    return text


def markup(text):
    text = plain(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r'<font face="Courier">\1</font>', text)
    text = re.sub(r"(?<![*\w])\*([^*]+?)\*(?!\*)", r"<i>\1</i>", text)
    return re.sub(r"\[(.+?)\]\((.+?)\)", r"\1", text)


def render(name, story):
    lines = io.open(os.path.join(BASE, name), encoding="utf-8").read().split("\n")
    code, buffered = False, []
    for line in lines:
        if line.startswith("```"):
            code = not code
            if not code and buffered:
                story.append(Preformatted(plain("\n".join(buffered)), MONO))
                buffered = []
            continue
        if code:
            buffered.append(line)
            continue
        text = line.rstrip()
        if not text:
            continue
        if text.startswith("# "):
            story.append(Paragraph(markup(text[2:]), H1))
        elif text.startswith("## "):
            story.append(Paragraph(markup(text[3:]), H2))
        elif text.startswith("### "):
            story.append(Paragraph(markup(text[4:]), H3))
        elif text.startswith("|"):
            cells = [c.strip() for c in text.strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells):
                continue
            story.append(Paragraph(markup(" | ".join(c for c in cells if c)), BODY))
        elif text.startswith("> "):
            story.append(Paragraph("<i>" + markup(text[2:]) + "</i>", BODY))
        elif re.match(r"^[-*] ", text):
            story.append(Paragraph("* " + markup(text[2:]), BODY))
        else:
            story.append(Paragraph(markup(text), BODY))


def main():
    names = ["00-report.md"] + sorted(f for f in os.listdir(BASE) if re.match(r"0[1-9]-", f))
    story = []
    for index, name in enumerate(names):
        if index:
            story.append(PageBreak())
        render(name, story)
    SimpleDocTemplate(
        OUT, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title="ModaCo Promotion Management API - end-to-end test report",
    ).build(story)
    print("written", OUT, os.path.getsize(OUT), "bytes")


main()
