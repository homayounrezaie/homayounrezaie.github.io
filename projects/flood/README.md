# Calgary flash-flood simulation

Same idea as project 04 (Flash Flood Simulation) on homayounrezaie.github.io: GPU flood routing on a LiDAR DTM, rendered as an oblique 3D animation.
Area: 4 × 3 km around the Bow / Elbow confluence (Downtown, Stampede, Mission, Victoria Park, East Village, Inglewood).

## Layout
```
sim.py, render.py   simulation and renderer (run from this folder)
videos/             clips shown on the website (tracked)
data/               DTM/DSM/imagery inputs and sim_*.npz results (git-ignored, ~900 MB)
out/                render outputs (git-ignored); copy finished clips into videos/
```

## Data
| Layer | Source |
|---|---|
| DTM + DSM, 1 m | NRCan HRDEM — `NRCAN-Calgary_West_utm11_2020-1m` (STAC `hrdem-lidar`, EPSG:3979) |
| Imagery | Esri World Imagery tiles (z17), reprojected to the DTM grid |

Files in `data/`: `calgary_dtm.tif`, `calgary_dsm.tif`, `calgary_rgb.tif`.

## Model (`sim.py`)
Local-inertial shallow-water equations (Bates et al. 2010 / de Almeida et al. 2012) in PyTorch (MPS/CUDA/CPU).
- Rainfall applied uniformly; optional river inflow hydrographs at the Bow (top edge) and Elbow (left edge).
- Manning n = 0.035; buildings are obstacles (nDSM > 3 m and not vegetation).
- Free outflow on all edges; no infiltration or storm sewers.
- The LiDAR water surface already carries base flow, so inflows are *excess* over base flow.

```
python sim.py --scenario rain --dx 2 --rain 80 --rain-hours 1 --hours 1.5 --frames 120
python sim.py --scenario 2013 --dx 3 --rain 5  --rain-hours 3 --hours 3   --frames 150
```

## Render (`render.py`)
GPU ray-marched heightfield (DTM × 1.6 + buildings/trees from nDSM + water surface), imagery draped, water coloured by depth.
```
python render.py data/sim_2013.npz out/calgary_flood_2013.mp4          # 1920×1080
python render.py data/sim_2013.npz out/frame.png 960 540 60             # single frame
```

## Caveats
Approximate "what-if" tool, not a hazard map. No infiltration, sewers, bridges or the post-2013 flood barriers;
river inflow uses a simple smooth rise to peak; results depend on DTM resolution (2–3 m simulation grid).
Official reference: City of Calgary / Government of Alberta flood hazard maps.
