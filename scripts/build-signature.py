"""
Animated handwritten signature for the GitHub profile — clean rebuild.

Fixes over the previous attempt:
  * ORIENTATION: skeleton walk direction is arbitrary, so ~half the strokes
    drew right-to-left (pen going backwards). Every stroke is now normalised
    to draw left-to-right.
  * ORDERING: strokes are ordered by (horizontal band of their leftmost
    point, then top-to-bottom), with the resulting order printed for
    verification instead of assumed.
  * Timing is proportional to cumulative pen travel.

Font: Parisienne (SIL OFL 1.1).
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.morphology import skeletonize

FONT = r"C:\Users\hlaro\AppData\Local\Temp\sig2\Parisienne.ttf"
OUT_DIR = r"G:\github\profile-hlsitechio\assets"
TEXT = "Hubert L.S."
OUT = os.path.join(OUT_DIR, "signature.svg")

ACC_A, ACC_B, ACC_C = "#8a7cc9", "#5a4d9e", "#3d4a85"

# ---------- 1. rasterise --------------------------------------------------
SS = 4
FS = 260 * SS
font = ImageFont.truetype(FONT, FS)
bb = ImageDraw.Draw(Image.new("L", (10, 10))).textbbox((0, 0), TEXT, font=font)
pad = 40 * SS
W = bb[2] - bb[0] + pad * 2
H = bb[3] - bb[1] + pad * 2
img = Image.new("L", (W, H), 0)
ImageDraw.Draw(img).text((pad - bb[0], pad - bb[1]), TEXT, font=font, fill=255)
arr = np.array(img) > 100
print(f"raster {W}x{H}, ink {arr.mean()*100:.1f}%")

# ---------- 2. skeletonize ------------------------------------------------
from scipy import ndimage as ndi

# Close hairline gaps first: raw skeletonization of antialiased raster text
# fragments strokes into specks. A small binary closing reconnects them so we
# trace continuous pen strokes instead of hundreds of dots.
closed = ndi.binary_closing(arr, structure=np.ones((3, 3)), iterations=2)
skel = skeletonize(closed)
Hh, Ww = skel.shape
print(f"skeleton px {skel.sum():,} (after closing)")

# drop specks that survive
lbl, n = ndi.label(skel, structure=np.ones((3, 3)))
sizes = ndi.sum(skel, lbl, range(1, n + 1))
keep = np.zeros_like(skel)
for i, sz in enumerate(sizes, start=1):
    if sz >= 25:                 # ignore sub-25px blobs (real dots are bigger)
        keep |= (lbl == i)
lost = int(skel.sum() - keep.sum())
skel = keep
print(f"components {n} -> kept {int((sizes>=25).sum())}, dropped {lost} speck px")

# ---------- 3. trace into polylines --------------------------------------
def nbrs(y, x):
    out = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                ny, nx = y + dy, x + dx
                if 0 <= ny < Hh and 0 <= nx < Ww and skel[ny, nx]:
                    out.append((ny, nx))
    return out

visited = np.zeros_like(skel, bool)
deg = np.zeros_like(skel, np.uint8)
ys, xs = np.nonzero(skel)
for y, x in zip(ys, xs):
    deg[y, x] = len(nbrs(y, x))

seeds  = [(y, x) for y, x in zip(ys, xs) if deg[y, x] == 1]
seeds += [(y, x) for y, x in zip(ys, xs) if deg[y, x] >= 3]
seeds += [(y, x) for y, x in zip(ys, xs)]

def walk(sy, sx):
    path = [(sy, sx)]
    visited[sy, sx] = True
    cur = (sy, sx)
    while True:
        cand = [n for n in nbrs(*cur) if not visited[n]]
        if not cand:
            break
        if len(path) > 1:
            py, px = path[-2]
            dy, dx = cur[0] - py, cur[1] - px
            cand.sort(key=lambda n: (n[0]-cur[0]-dy)**2 + (n[1]-cur[1]-dx)**2)
        cur = cand[0]
        visited[cur] = True
        path.append(cur)
    return path

polys = []
for sy, sx in seeds:
    if not visited[sy, sx]:
        p = walk(sy, sx)
        if len(p) >= 6:
            polys.append(p)
print(f"traced {len(polys)} raw strokes")

# ---------- 4. scale, orient, order --------------------------------------
allpts = np.array([(x, y) for p in polys for y, x in p], float)
minx, maxx = allpts[:, 0].min(), allpts[:, 0].max()
miny, maxy = allpts[:, 1].min(), allpts[:, 1].max()

VB_W, PADV = 900, 16
sc = (VB_W - 2 * PADV) / (maxx - minx)
VB_H = int((maxy - miny) * sc) + 2 * PADV

def to_svg_pts(p):
    return [(PADV + (x - minx) * sc, PADV + (y - miny) * sc) for y, x in p]

items = []
for p in polys:
    pts = to_svg_pts(p)
    # --- ORIENTATION FIX: ensure the stroke draws left-to-right
    if pts[-1][0] < pts[0][0]:
        pts = pts[::-1]
    arr_pts = np.array(pts)
    ln = float(np.sum(np.linalg.norm(np.diff(arr_pts, axis=0), axis=1)))
    items.append({"pts": pts, "len": ln, "minx": arr_pts[:, 0].min(), "miny": arr_pts[:, 1].min()})

# --- ORDERING FIX: sort, then verify
items.sort(key=lambda it: (round(it["minx"] / 26.0), it["miny"]))

print("\nordered strokes (index, min-x band, min-x, min-y, length):")
for i, it in enumerate(items):
    print(f"  {i:>3}  band {round(it['minx']/26.0):>3}   x {it['minx']:>6.0f}   y {it['miny']:>6.0f}   len {it['len']:>6.0f}")

minxs = [it["minx"] for it in items]
print(f"\nmin-x sequence: {[round(m) for m in minxs]}")
print(f"non-decreasing within jitter: {all(minxs[i] <= minxs[i+1] + 26 for i in range(len(minxs)-1))}")

# ---------- 5. emit -------------------------------------------------------
total = sum(it["len"] for it in items)
DUR = 3.6
acc, strokes = 0.0, []
for it in items:
    frac = acc / total
    acc += it["len"]
    strokes.append((it, frac))

parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{VB_W}" height="{VB_H}" '
    f'viewBox="0 0 {VB_W} {VB_H}" role="img" aria-label="Hubert L.S. — handwritten signature">',
    f'''  <defs>
    <linearGradient id="pen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="{ACC_A}"/>
      <stop offset="50%" stop-color="{ACC_B}"/>
      <stop offset="100%" stop-color="{ACC_C}"/>
    </linearGradient>
  </defs>''',
]

for it, frac in strokes:
    pts = it["pts"]
    step = max(1, len(pts) // 90)
    keep = pts[::step]
    if keep[-1] != pts[-1]:
        keep.append(pts[-1])
    d = "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in keep)
    dash = f"{it['len'] + 2:.0f}"
    begin = frac * DUR
    dur = max(0.18, (it["len"] / total) * DUR)
    parts.append(
        f'  <path d="{d}" fill="none" stroke="url(#pen)" stroke-width="3.4" '
        f'stroke-linecap="round" stroke-linejoin="round" '
        f'stroke-dasharray="{dash}" stroke-dashoffset="{dash}">'
        f'<animate attributeName="stroke-dashoffset" from="{dash}" to="0" '
        f'begin="{begin:.2f}s" dur="{dur:.2f}s" fill="freeze" '
        f'calcMode="spline" keySplines="0.35 0 0.3 1" keyTimes="0;1"/>'
        f'</path>'
    )
parts.append('</svg>')

os.makedirs(OUT_DIR, exist_ok=True)
open(OUT, "w", encoding="utf-8").write("\n".join(parts) + "\n")
print(f"\nwrote {OUT}")
print(f"viewBox 0 0 {VB_W} {VB_H} | {len(strokes)} strokes | travel {total:.0f} | {DUR}s")
