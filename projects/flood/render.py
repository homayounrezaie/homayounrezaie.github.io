"""Oblique 3D flood animation: GPU ray-marched heightfield (DTM + buildings/trees + water)
draped with aerial imagery, water coloured by depth.

    python render.py data/sim_2013.npz out/calgary_2013.mp4
"""
import sys, math
import numpy as np, rasterio, torch, torch.nn.functional as F, cv2
from PIL import Image, ImageDraw, ImageFont

sim_path, out_path = sys.argv[1], sys.argv[2]
OUT_W, OUT_H = int(sys.argv[3]) if len(sys.argv) > 3 else 1920, int(sys.argv[4]) if len(sys.argv) > 4 else 1080
only = float(sys.argv[5]) if len(sys.argv) > 5 else None  # render a single frame (debug)
dev = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"

# ---------------- data ----------------
dtm = rasterio.open("data/calgary_dtm.tif").read(1).astype(np.float32)
dsm = rasterio.open("data/calgary_dsm.tif").read(1).astype(np.float32)
rgb = rasterio.open("data/calgary_rgb.tif").read().astype(np.float32) / 255
S = np.load(sim_path, allow_pickle=True)
depth, times, sdx = S["depth"].astype(np.float32), S["times"], float(S["dx"])
scenario = str(S["scenario"])
NF = len(depth)
H1, W1 = dtm.shape
VEX = 1.6  # vertical exaggeration of the bare terrain
base = dtm.min()

ndsm = np.clip(dsm - dtm, 0, 250)
ndsm[ndsm < 1.0] = 0
ground = (dtm - base) * VEX
surf = ground + ndsm

T = lambda a: torch.tensor(a, device=dev)[None, None]
surf_t, ground_t = T(surf), T(ground)
rgb_t = torch.tensor(rgb, device=dev)[None]
# normals for shading (on the non-water surface)
gy, gx = np.gradient(surf)
nrm = np.stack([-gx, gy, np.ones_like(surf)], 0)  # rows go south -> flip y
nrm /= np.linalg.norm(nrm, axis=0, keepdims=True)
nrm_t = torch.tensor(nrm, device=dev)[None]
bld_or_tree = T((ndsm > 0).astype(np.float32))

# water depth upsampled to 1 m grid extent: sim grid covers (Hs*sdx, Ws*sdx) metres
Hs, Ws = depth.shape[1:]
sy, sx = Hs * sdx / H1, Ws * sdx / W1  # fraction of the 1 m grid covered by sim grid


def sample(img, X, Y):
    """Bilinear sample img [1,C,H,W] at metric coords X (east, 0..W1), Y (south, 0..H1)."""
    g = torch.stack([(X / (W1 - 1) * 2 - 1).clamp(-1, 1), (Y / (H1 - 1) * 2 - 1).clamp(-1, 1)], -1)[None]
    return F.grid_sample(img, g, mode="bilinear", padding_mode="zeros", align_corners=True)[0]


def sample_water(w, X, Y):
    g = torch.stack([X / (W1 * sx) * 2 - 1, Y / (H1 * sy) * 2 - 1], -1)[None]
    return F.grid_sample(w, g, mode="bilinear", padding_mode="zeros", align_corners=False)[0, 0]


# ---------------- camera ----------------
def camera(fi):
    u = fi / max(NF - 1, 1)
    # slow orbit from the south-west towards south-east, gently pushing in
    az = math.radians(205 - 40 * u)           # direction camera sits, measured from north, clockwise
    dist = 3300 - 700 * u
    elev = math.radians(38 + 4 * u)
    tx, ty = 2150.0, 1650.0                  # target (x east, y south) ~ Stampede / confluence
    tz = 30.0
    cx = tx + dist * math.cos(elev) * math.sin(az)
    cy = ty - dist * math.cos(elev) * math.cos(az)
    cz = tz + dist * math.sin(elev)
    return np.array([cx, cy, cz]), np.array([tx, ty, tz])


FOV = math.radians(42)
yy, xx = torch.meshgrid(torch.arange(OUT_H, device=dev, dtype=torch.float32),
                        torch.arange(OUT_W, device=dev, dtype=torch.float32), indexing="ij")
aspect = OUT_W / OUT_H
px = (2 * (xx + 0.5) / OUT_W - 1) * math.tan(FOV / 2) * aspect
py = (1 - 2 * (yy + 0.5) / OUT_H) * math.tan(FOV / 2)

# world axes: X east, Y south (row direction), Z up. Use right-handed frame with Y' = -Y (north).
def rays(cam, tgt):
    c = [float(cam[0]), float(cam[1]), float(cam[2])]
    _c = np.array([cam[0], -cam[1], cam[2]]); t = np.array([tgt[0], -tgt[1], tgt[2]])
    f = t - _c; f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    d = [float(f[i]) + px * float(r[i]) + py * float(u[i]) for i in range(3)]
    n = torch.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    return c, [d[0] / n, -d[1] / n, d[2] / n]  # back to Y-south


SKY_TOP, SKY_BOT = np.array([0.55, 0.68, 0.82]), np.array([0.86, 0.90, 0.94])

# depth colour ramp (shallow cyan -> deep navy), like the reference animation
RAMP = np.array([[0.00, 0.60, 0.90, 0.97],
                 [0.30, 0.25, 0.70, 0.95],
                 [1.00, 0.10, 0.40, 0.85],
                 [2.50, 0.07, 0.20, 0.62],
                 [5.00, 0.05, 0.10, 0.40]], np.float32)
ramp_t = torch.tensor(RAMP, device=dev)


def water_color(dep):
    out = []
    for c in range(1, 4):
        v = torch.zeros_like(dep)
        for i in range(len(RAMP) - 1):
            d0, d1 = ramp_t[i, 0], ramp_t[i + 1, 0]
            w = ((dep - d0) / (d1 - d0)).clamp(0, 1)
            m = (dep >= d0) & ((dep < d1) | (i == len(RAMP) - 2))
            v = torch.where(m, ramp_t[i, c] * (1 - w) + ramp_t[i + 1, c] * w, v)
        out.append(v)
    return torch.stack(out, 0)


LIGHT = torch.tensor([-0.45, 0.35, 0.82], device=dev); LIGHT = LIGHT / LIGHT.norm()


@torch.no_grad()
def render(fi):
    cam, tgt = camera(fi)
    o, d = rays(cam, tgt)
    i0 = min(int(fi), NF - 1); i1 = min(i0 + 1, NF - 1); w = fi - i0  # blend between saved sim frames
    wat = torch.tensor(depth[i0] * (1 - w) + depth[i1] * w, device=dev)[None, None]
    wat = torch.where(wat > 0.03, wat, torch.zeros_like(wat))
    zmax = float(surf.max()) + 12
    # start where ray crosses zmax, march to z=0
    t0 = ((o[2] - zmax) / (-d[2])).clamp(min=0)
    t1 = (o[2] / (-d[2])).clamp(min=0)
    step = 3.0
    nsteps = int(float((t1 - t0).max()) / step) + 2
    t = t0.clone()
    hit = torch.zeros_like(t, dtype=torch.bool)
    th = t1.clone()
    for k in range(nsteps):
        tt = t0 + k * step
        X, Y, Z = o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt
        # visible surface: buildings/trees, or the water surface on the ground if higher
        hh = torch.maximum(sample(surf_t, X, Y)[0], sample(ground_t, X, Y)[0] + sample_water(wat, X, Y))
        new = (~hit) & (Z <= hh)
        th = torch.where(new, tt, th)
        hit = hit | new
        if k % 16 == 0 and bool(hit.all()):
            break
    # bisection refine between th-step and th
    lo, hi = (th - step).clamp(min=0), th
    for _ in range(6):
        mid = (lo + hi) / 2
        X, Y, Z = o[0] + d[0] * mid, o[1] + d[1] * mid, o[2] + d[2] * mid
        hh = torch.maximum(sample(surf_t, X, Y)[0], sample(ground_t, X, Y)[0] + sample_water(wat, X, Y))
        below = Z <= hh
        hi = torch.where(below, mid, hi); lo = torch.where(below, lo, mid)
    tt = hi
    X, Y, Z = o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt
    inside = (X >= 0) & (X <= W1 - 1) & (Y >= 0) & (Y <= H1 - 1) & hit

    col = sample(rgb_t, X, Y)
    n = sample(nrm_t, X, Y)
    lam = (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]).clamp(0, 1)
    col = col * (0.55 + 0.55 * lam)
    # walls of buildings: steep normals -> neutral facade colour
    steep = (n[2] < 0.45).float() * sample(bld_or_tree, X, Y)[0]
    facade = torch.stack([torch.full_like(lam, v) for v in (0.72, 0.71, 0.69)]) * (0.45 + 0.6 * lam)
    col = col * (1 - steep) + facade * steep

    dep = sample_water(wat, X, Y)
    gnd = sample(ground_t, X, Y)[0]
    onwater = (dep > 0.03) & (Z <= gnd + dep + 0.5) & (sample(surf_t, X, Y)[0] - gnd < dep + 0.3)
    wc = water_color(dep)
    alpha = (0.55 + 0.35 * (dep / 1.5).clamp(0, 1)) * (dep / 0.15).clamp(0, 1)
    # simple sky reflection / fresnel on water
    fres = (1 - (-d[2]).clamp(0, 1)) ** 3 * 0.35
    wc = wc * (1 - fres) + torch.tensor([0.80, 0.88, 0.95], device=dev)[:, None, None] * fres
    col = torch.where(onwater[None], col * (1 - alpha) + wc * alpha, col)

    # sky + distance haze
    v = (yy / OUT_H)[None]
    sky = torch.tensor(SKY_TOP, device=dev, dtype=torch.float32)[:, None, None] * (1 - v) + \
          torch.tensor(SKY_BOT, device=dev, dtype=torch.float32)[:, None, None] * v
    haze = (1 - torch.exp(-tt / 9000))[None] * 0.55
    col = col * (1 - haze) + sky * haze
    col = torch.where(inside[None], col, sky)
    img = (col.clamp(0, 1) * 255).byte().permute(1, 2, 0).cpu().numpy()
    return img


# ---------------- overlay ----------------
def font(sz, bold=False):
    for p in ["/System/Library/Fonts/HelveticaNeue.ttc", "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(p, sz, index=1 if bold else 0)
        except Exception:
            pass
    return ImageFont.load_default()


def overlay(img, fi):
    im = Image.fromarray(img).convert("RGBA")
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0)); dr = ImageDraw.Draw(lay)
    s = OUT_W / 1920
    tmin = np.interp(fi, np.arange(NF), times) / 60
    title = "Calgary · Bow & Elbow confluence"
    sub = ("Rainfall 80 mm/h for 1 h (what-if)" if scenario == "rain"
           else "River flood: Bow +1650 m³/s, Elbow +1200 m³/s (June 2013 magnitude)")
    pad = int(28 * s)
    dr.rounded_rectangle([pad, pad, pad + int(860 * s), pad + int(118 * s)], radius=int(14 * s), fill=(10, 18, 34, 170))
    dr.text((pad + int(22 * s), pad + int(14 * s)), title, font=font(int(38 * s), True), fill=(255, 255, 255, 255))
    dr.text((pad + int(22 * s), pad + int(64 * s)), sub, font=font(int(25 * s)), fill=(200, 220, 240, 255))
    # clock
    hh, mm = int(tmin // 60), int(tmin % 60)
    clock = f"T + {hh}:{mm:02d}"
    dr.rounded_rectangle([OUT_W - pad - int(230 * s), pad, OUT_W - pad, pad + int(80 * s)], radius=int(14 * s), fill=(10, 18, 34, 170))
    dr.text((OUT_W - pad - int(208 * s), pad + int(12 * s)), clock, font=font(int(46 * s), True), fill=(255, 255, 255, 255))
    # legend
    lw, lh = int(420 * s), int(20 * s)
    lx, ly = OUT_W - pad - lw - int(24 * s), OUT_H - pad - int(90 * s)
    dr.rounded_rectangle([lx - int(24 * s), ly - int(46 * s), OUT_W - pad, OUT_H - pad], radius=int(14 * s), fill=(10, 18, 34, 170))
    dr.text((lx, ly - int(38 * s)), "Water depth (m)", font=font(int(24 * s), True), fill=(255, 255, 255, 255))
    ds = torch.linspace(0.03, 3.0, lw, device=dev)
    cs = (water_color(ds).T.cpu().numpy() * 255).astype(np.uint8)
    for i in range(lw):
        dr.line([(lx + i, ly), (lx + i, ly + lh)], fill=tuple(int(v) for v in cs[i]) + (255,))
    for v, lab in [(0.03, "0"), (1.0, "1"), (2.0, "2"), (3.0, "≥3")]:
        x = lx + int((v - 0.03) / (3.0 - 0.03) * (lw - 1))
        dr.text((x - int(8 * s), ly + lh + int(6 * s)), lab, font=font(int(20 * s)), fill=(220, 230, 240, 255))
    dr.rounded_rectangle([pad, OUT_H - pad - int(38 * s), pad + int(900 * s), OUT_H - pad], radius=int(10 * s), fill=(10, 18, 34, 150))
    dr.text((pad + int(14 * s), OUT_H - pad - int(30 * s)), "LiDAR DTM: NRCan HRDEM 2020 · Imagery: Esri World Imagery · GPU local-inertial SWE",
            font=font(int(18 * s)), fill=(255, 255, 255, 200))
    return np.array(Image.alpha_composite(im, lay).convert("RGB"))


if only is not None:
    img = overlay(render(only), only)
    Image.fromarray(img).save(out_path)
    sys.exit()

FPS, SECONDS, HOLD_S = 24, 20, 2
vw = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"avc1"), FPS, (OUT_W, OUT_H))
n_anim = FPS * (SECONDS - HOLD_S)
seq = [i * (NF - 1) / (n_anim - 1) for i in range(n_anim)] + [float(NF - 1)] * (FPS * HOLD_S)
cache = {}
import time
t0 = time.time()
for j, fi in enumerate(seq):
    if fi not in cache:
        cache = {fi: overlay(render(fi), fi)}
    vw.write(cv2.cvtColor(cache[fi], cv2.COLOR_RGB2BGR))
    if j % 10 == 0:
        print(f"frame {j}/{len(seq)}  [{time.time()-t0:.0f}s]", flush=True)
vw.release()
print("wrote", out_path)
