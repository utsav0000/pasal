# Extracts PASAL wordmark + tagline outlines from DM Sans (OFL) as font-independent SVG path data.
import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

def outline(src, text, wght, tracking_em):
    inst = instantiateVariableFont(TTFont(src), {"wght": wght, "opsz": 14})
    gs = inst.getGlyphSet(); cmap = inst.getBestCmap(); upm = inst['head'].unitsPerEm
    hmtx = inst['hmtx']
    x = 0; parts = []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        parts.append(pen.getCommands())
        x += hmtx[g][0] + tracking_em * upm
    return {"d": " ".join(p for p in parts if p), "width": x - tracking_em * upm, "cap": inst['OS/2'].sCapHeight, "x": inst['OS/2'].sxHeight, "upm": upm}

src = sys.argv[1]
json.dump({
  "word": outline(src, "PASAL", 760, -0.04),
  "tagline": outline(src, "Everything Finds a Buyer.", 500, -0.01),
}, open(sys.argv[2], "w"))
print("ok")
