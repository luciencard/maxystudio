"""Bulles « say » et « think » au style MaxyGame dans scratch-render (contour encre complet, coins droits, queue anguleuse,
texte gras foncé). À relancer si scratch-render est remplacé. Usage : python tools/patch-bubbles.py <scratch-render.min.js> ..."""
import sys
from pathlib import Path

PAIRS = [
    ("""  STROKE_WIDTH: 4,""", """  STROKE_WIDTH: 3,"""),
    ("""  CORNER_RADIUS: 16,""", """  CORNER_RADIUS: 6,"""),
    ("""  FONT: 'Helvetica',""", """  FONT: '"Segoe UI", "Atkinson Hyperlegible", Arial',"""),
    ("""    BUBBLE_FILL: 'white',
    BUBBLE_STROKE: 'rgba(0, 0, 0, 0.15)',
    TEXT_FILL: '#575E75'""", """    BUBBLE_FILL: '#ffffff',
    BUBBLE_STROKE: '#16182a',
    TEXT_FILL: '#16182a'"""),
    # Queue de la bulle « say » : un triangle net au lieu de la courbe de Scratch
    ("""        ctx.bezierCurveTo(0, 4, 4, 8, 4, 10);
        ctx.arcTo(4, 12, 2, 12, 2);
        ctx.bezierCurveTo(-1, 12, -11, 8, -16, 0);
        ctx.closePath();""", """        ctx.lineTo(4, 12);
        ctx.lineTo(-12, 0);
        ctx.closePath();"""),
    # Remplir puis tracer : tout le contour reste visible
    ("""      ctx.lineWidth = BubbleStyle.STROKE_WIDTH;
      ctx.stroke();
      ctx.fill();""", """      ctx.lineWidth = BubbleStyle.STROKE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.fill();
      ctx.stroke();"""),
]


def patch(path):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    if "BUBBLE_STROKE: '#16182a'" in s:
        print(path, ': déjà appliqué')
        return
    for a, b in PAIRS:
        assert s.count(a) == 1, (path, a[:50], s.count(a))
        s = s.replace(a, b)
    # Texte en gras, aussi pour la mesure des lignes (sinon le texte gras déborderait)
    n = s.count('"".concat(BubbleStyle.FONT_SIZE, "px ")')
    s = s.replace('"".concat(BubbleStyle.FONT_SIZE, "px ")', '"700 ".concat(BubbleStyle.FONT_SIZE, "px ")')
    p.write_text(s, encoding='utf-8')
    print(path, ': appliqué,', n, 'police(s) en gras')


if __name__ == '__main__':
    for f in sys.argv[1:]:
        patch(f)
