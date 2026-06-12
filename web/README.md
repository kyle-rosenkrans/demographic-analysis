# KIPP Demographics — Web App

A browser-based clone of the InSite EFS demographics deck for Miami-Dade + Broward. Zero build step — just a static HTML app that loads pre-computed JSON/GeoJSON from `../data/processed/`.

## Running it (for Kyle)

Open a Terminal, then paste:

```
cd "/Users/kylerosenkrans/Library/Mobile Documents/com~apple~CloudDocs/Claude Code/Demographic Analysis"
python3 web/serve.py 8765
```

Leave that window running. Then open http://localhost:8765/ in **Safari or Chrome**. That's it — no `npm install`, no build.

To share it with a colleague you'd zip the `Demographic Analysis` folder and have them do the same two commands. Python 3 ships with macOS so they don't need to install anything either.

## What's in it

Three sections matching the meeting-edits deck:

1. **Campus Analysis** (slides 2–15) — 8 sites (KIPP Miami North incubation + 7 Broward PLP schools). Drive-time rings at 5 / 10 / 15 min, suitability ranking, demographic comparison table vs the 8-site average (red = below avg, green = above). Click any campus row for its deep-dive card.
2. **School Board Districts** (slides 16–32) — 7 Broward SBDs with per-district suitability score, demographic comparison vs the 7-district average, and a drill-in card that shows each metric's delta vs average.
3. **Demographic Heat Maps** (slides 33–46) — Block-group choropleth (~3,000 BGs across Miami-Dade + Broward) with toggleable metric: K-8 pop, K-4 pop, 5-8 pop, HHI <$50k, SNAP%, Black%, Hispanic%, Minority% (Black+Hispanic), and the composite Suitability score. Hover a BG for details.

Suitability uses the per-variable weights from slide 45. They're editable in the "Suitability Weights" accordion on the Campus tab; edits flow through to districts and heat-map suitability.

## Data sources

All pre-computed JSON/GeoJSON lives in `../data/processed/` (exposed via the `data` symlink):

- US Census Bureau ACS 5-Year 2023 (block-group + tract for SNAP / median income)
- Census TIGERweb (county + block-group boundaries)
- Broward County GIS Hub (School Board District polygons)
- FL DOE 2024-25 Persistently Low-Performing list (target schools)
- OpenStreetMap basemap via CARTO Voyager (free, no API key)

To rebuild the data from scratch run the scripts under `../etl/` in numeric order (01 → 06).

## Known limitations

- **Drive-time rings are great-circle approximations** at an assumed 22 mph urban average (5 min ≈ 1.83 mi, 10 min ≈ 3.67 mi, 15 min ≈ 5.50 mi). Over-counts in dense Broward arterials vs true ESRI isochrones.
- **2025-2030 projections use a DIY model** (ACS 2021→2023 trend extrapolation + FL DOE cohort CAGR). InSite uses ESRI's proprietary Tapestry housing-start model. Directionally similar but per-district variation will differ.
- **SNAP & median HH income at BG level** are apportioned from tract (Census suppresses those at block-group for privacy).
- **Charter operator pattern matching** may miss some schools managed under different legal names. CSUSA is ~15% under-counted vs InSite's figures.
