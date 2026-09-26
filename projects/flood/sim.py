"""GPU flash-flood simulation for Calgary (Bow/Elbow confluence).

Local-inertial shallow-water scheme (Bates et al. 2010; de Almeida et al. 2012)
on a LiDAR DTM, driven by rainfall and optional river inflow hydrographs.
Runs on Apple MPS / CUDA / CPU via PyTorch.

    python sim.py --scenario rain      # flash flood: rainfall only
    python sim.py --scenario 2013      # rainfall + Bow/Elbow flood hydrographs (June 2013 magnitude)
"""
import argparse, time
import numpy as np, rasterio, torch

G = 9.81

p = argparse.ArgumentParser()
p.add_argument("--scenario", default="rain", choices=["rain", "2013"])
p.add_argument("--dx", type=float, default=2.0, help="simulation cell size (m)")
p.add_argument("--rain", type=float, default=80.0, help="rainfall rate (mm/h)")
p.add_argument("--rain-hours", type=float, default=1.0)
p.add_argument("--hours", type=float, default=2.0, help="simulated duration (h)")
p.add_argument("--manning", type=float, default=0.035)
p.add_argument("--frames", type=int, default=120)
p.add_argument("--no-buildings", action="store_true")
a = p.parse_args()

dev = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
f = int(round(a.dx))

# ---------------- terrain ----------------
with rasterio.open("data/calgary_dtm.tif") as s:
    dtm = s.read(1).astype(np.float32)
with rasterio.open("data/calgary_dsm.tif") as s:
    dsm = s.read(1).astype(np.float32)
with rasterio.open("data/calgary_rgb.tif") as s:
    rgb = s.read().astype(np.float32)

H1, W1 = dtm.shape
H, W = H1 // f, W1 // f
blk = lambda x: x[: H * f, : W * f].reshape(H, f, W, f).mean((1, 3))
z = blk(dtm)

# Buildings as obstacles: tall (nDSM > 3 m) and not green (excess-green index).
if not a.no_buildings:
    ndsm = blk(dsm - dtm)
    r, g_, b = (blk(c) for c in rgb)
    exg = (2 * g_ - r - b) / (r + g_ + b + 1)
    bld = (ndsm > 3.0) & (exg < 0.05)
    # clean speckle
    from scipy.ndimage import binary_opening
    bld = binary_opening(bld, iterations=1)
    z = np.where(bld, z + np.minimum(ndsm, 10.0), z)
    np.save("data/buildings.npy", bld)
    print(f"buildings: {bld.mean()*100:.1f}% of cells")

# ---------------- river inflows (2013 scenario) ----------------
# Entry segments found from DTM edge profiles (2 m grid indices, rescaled).
s2 = 2.0 / a.dx
inflows = []
if a.scenario == "2013":
    # June 2013 peaks: Bow at Calgary ~1750 m3/s, Elbow at Sifton Blvd ~1240 m3/s.
    # DTM water surface already carries low flow (~100 m3/s), so inject the excess.
    inflows = [
        dict(name="Bow", edge="top", lo=int(748 * s2), hi=int(830 * s2), peak=1650.0),
        dict(name="Elbow", edge="left", lo=int(1058 * s2), hi=int(1103 * s2), peak=1200.0),
    ]


def hydrograph(t, peak):
    """Smooth rise to peak over the first 40% of the run, then hold."""
    T = a.hours * 3600 * 0.4
    return peak * (0.5 - 0.5 * np.cos(np.pi * min(t / T, 1.0)))


# ---------------- state ----------------
zt = torch.tensor(z, device=dev)
h = torch.zeros_like(zt)
qx = torch.zeros((H, W + 1), device=dev)  # face fluxes (m2/s)
qy = torch.zeros((H + 1, W), device=dev)
n2 = a.manning ** 2
dx = a.dx
rain_ms = a.rain / 1000 / 3600

src_masks = []
for s in inflows:
    m = torch.zeros_like(zt)
    if s["edge"] == "top":
        m[1:4, s["lo"]:s["hi"]] = 1
    else:
        m[s["lo"]:s["hi"], 1:4] = 1
    src_masks.append((s, m / (m.sum() * dx * dx)))  # per-cell depth rate per unit Q


def face_flux(q, eta_a, eta_b, z_a, z_b, dt):
    hf = torch.clamp(torch.maximum(eta_a, eta_b) - torch.maximum(z_a, z_b), min=0)
    slope = (eta_b - eta_a) / dx
    qn = (q - G * hf * dt * slope) / (1 + G * dt * n2 * q.abs() / torch.clamp(hf, min=1e-3) ** (7 / 3))
    # limit so a face can't drain more than a quarter of the shallower side's water per step
    lim = hf * dx / (4 * dt)
    qn = torch.clamp(qn, -lim, lim)
    return torch.where(hf > 1e-3, qn, torch.zeros_like(qn))


def step(dt, t):
    global h, qx, qy
    eta = zt + h
    # interior faces
    qx[:, 1:-1] = face_flux(qx[:, 1:-1], eta[:, :-1], eta[:, 1:], zt[:, :-1], zt[:, 1:], dt)
    qy[1:-1, :] = face_flux(qy[1:-1, :], eta[:-1, :], eta[1:, :], zt[:-1, :], zt[1:, :], dt)
    # open boundaries: free outflow at normal depth-ish (critical flow out)
    out = lambda hh: hh * torch.sqrt(G * hh)
    qx[:, 0] = -out(h[:, 0]); qx[:, -1] = out(h[:, -1])
    qy[0, :] = -out(h[0, :]); qy[-1, :] = out(h[-1, :])
    # no outflow through inflow sections
    for s, m in src_masks:
        if s["edge"] == "top":
            qy[0, s["lo"]:s["hi"]] = 0
        else:
            qx[s["lo"]:s["hi"], 0] = 0
    dh = (qx[:, :-1] - qx[:, 1:] + qy[:-1, :] - qy[1:, :]) / dx * dt
    if t < a.rain_hours * 3600:
        dh = dh + rain_ms * dt
    for s, m in src_masks:
        dh = dh + m * hydrograph(t, s["peak"]) * dt
    h = torch.clamp(h + dh, min=0)


T_end = a.hours * 3600
save_t = np.linspace(0, T_end, a.frames + 1)[1:]
frames, times = [], []
t, k, si, t0 = 0.0, 0, 0, time.time()
while t < T_end:
    if k % 10 == 0:
        hmax = max(float(h.max()), 0.05)
        if not np.isfinite(hmax):
            raise RuntimeError(f"unstable at t={t:.1f}s step {k}")
        dt = min(0.5 * dx / np.sqrt(G * (hmax + 1.0)), 2.0)
    step(dt, t)
    t += dt; k += 1
    if si < len(save_t) and t >= save_t[si]:
        frames.append(h.detach().cpu().numpy().astype(np.float16)); times.append(t); si += 1
        wet = float((h > 0.1).float().mean()) * 100
        print(f"t={t/60:6.1f} min  steps={k:6d}  dt={dt:.3f}s  hmax={float(h.max()):.2f} m  wet>10cm={wet:.1f}%  "
              f"[{time.time()-t0:.0f}s wall]", flush=True)

np.savez_compressed(f"data/sim_{a.scenario}.npz", depth=np.stack(frames), times=np.array(times),
                    z=z, dx=a.dx, scenario=a.scenario, rain=a.rain, rain_hours=a.rain_hours)
print("saved", f"data/sim_{a.scenario}.npz")
