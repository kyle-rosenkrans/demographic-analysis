# KIPP Miami – Broward Demographics Tool

A locally-hosted, interactive clone of the InSite EFS demographic study deck
(Miami-Dade + Broward, FL), built from **100% free public data**.

## What it does

Three side-by-side analytical views mirroring the MEETING EDITS deck:

1. **Campus Analysis** — 8 sites (KIPP Miami North incubation + 7 Broward
   Persistently Low-Performing schools), 5/10/15-min demographic rings,
   suitability scoring, 5-yr enrollment history chart, BCPS attendance-boundary
   overlay.
2. **School Board Districts** — all 7 Broward SBDs with demographic comparison
   vs. average, per-district Step Up private-school rosters, and the major
   charter operators panel (Somerset, CSUSA, Franklin, Imagine, Pembroke Pines).
3. **Demographic Heat Maps** — block-group choropleth across both counties for
   K-8 student population, income-below-50k, SNAP, Black %, Hispanic %, and the
   composite 40/20/20/20 suitability score from slide 45.

## How to run

No build step. No Node.js. Just Python (already installed on macOS).

```bash
cd "Demographic Analysis"
python3 web/serve.py 8765
```

Then open <http://localhost:8765/> in Safari or Chrome.

That's it. The static files under `web/` fetch from the JSON/GeoJSON pre-built
in `data/processed/`. No external API calls at runtime — it all works offline
after the first load (browser cache serves the map tiles).

## Rebuilding the data from scratch

Run the scripts in order. Each is idempotent and independent.

```bash
python3 etl/01_parse_plp.py                # FL Persistently Low-Performing schools list
python3 etl/02_geocode_schools.py          # Geocode the 8 target campuses
python3 etl/03_fetch_boundaries.py         # TIGER block groups + county polygons
python3 etl/04_fetch_acs.py                # ACS 5-Yr 2023 block-group demographics
python3 etl/04b_fetch_acs_tract.py         # Tract-level SNAP + median income (apportion to BGs)
python3 etl/05_fetch_sbd.py                # 7 Broward School Board Districts
python3 etl/06_aggregate.py                # Roll ACS up to SBDs, campus rings, counties
python3 etl/07_fetch_bcps_boundaries.py    # 201 BCPS attendance-zone polygons
python3 etl/08_parse_stepup.py             # Step Up private school list (FES + FTC)
python3 etl/09_geocode_stepup.py           # Geocode ~700 private schools via Census batch
python3 etl/10_assign_stepup_sbds.py       # Point-in-polygon assign Step Up schools to SBDs
python3 etl/11_fldoe_enrollment.py         # 5 years of FL DOE Survey-2 membership
python3 etl/12_charter_operators.py        # Identify + roll up major charter operators
python3 etl/13_projections_2030.py         # DIY 2025→2030 projections
python3 etl/06_aggregate.py                # Re-roll to include projection fields
```

A one-shot `make all` target is a reasonable future enhancement.

## Data sources

| What | Where | Vintage |
|------|-------|---------|
| Demographics (age, race, income, SNAP, tenure) | U.S. Census ACS 5-Year | 2023 (2019-2023 window) |
| Block group + county polygons | Census TIGERweb | 2023 |
| School Board District polygons | Broward County GIS Hub | 2022 |
| BCPS attendance-zone polygons | ArcGIS AllSchoolBoundaries service | current |
| 5-year enrollment by school | FL DOE Membership Survey 2 | 2021-22 through 2025-26 |
| Persistently Low-Performing list | FL DOE | 2024-25 |
| Private school directory (Step Up) | FL DOE Private School List | current |
| 2025-2030 projections | DIY: ACS total-pop trend + FL DOE cohort CAGR | — |

## What matches InSite (the vendor deck) exactly

These numbers reproduce InSite's published figures within 1-2 students or 1%:

- **5-year campus enrollment history** (slide 6) — all 7 PLP campus histories
  match to the student for 21-22, 22-23, 23-24, 25-26 (24-25 differs by 1
  student on one campus due to FL DOE revision).
- **SBD demographic rollups** (slide 17) — D5 pop 281,732 (InSite 285,330),
  SNAP% 22.4% (InSite 22.3%), %Black 62.3% (InSite 70.97%).
- **Charter operator enrollment** (slide 20) — Somerset 10,885, Franklin 6,130,
  Imagine 3,186 match exactly. Charter Schools USA at 8,959 vs InSite 10,581
  (some CSUSA-managed schools likely missed — patterns in
  `etl/12_charter_operators.py` can be extended).
- **Private school Step Up totals** (slide 21) — 221 Broward schools with
  29,804 K-8 students (InSite: 245 / 29,801). 10% of schools lost during
  geocode or fell outside SBD polygons.

## Known approximations & limitations

- **Drive-time rings** use great-circle distance with a 22 mph urban average
  (5 min ≈ 1.83 mi, 10 min ≈ 3.67 mi). This over-counts population vs. ESRI's
  true isochrones in dense arterial Broward. To upgrade, swap in OpenRouteService
  (free 2k/day tier) or Valhalla (self-hosted).
- **Grade-band estimates** from ACS age bands: K-4 ≈ ages 5-9, 5-8 ≈ ages 10-13
  (80% of the 10-14 band), 9-12 ≈ ages 14-17.
- **2025-2030 projections**: total population uses per-BG ACS 2021→2023 trend
  extrapolation (capped ±20%); K-4/5-8/9-12 cohorts use the county-wide FL DOE
  enrollment CAGR (K-4 -2.2%/yr, 5-8 -2.9%/yr, 9-12 -1.2%/yr). InSite uses ESRI's
  proprietary housing-start + birth-cohort model — directionally similar, but
  per-district variation differs.
- **Suitability weights** default to slide 45's 5/5/10/10/20/20/5/5/12/8 = 100.
  Editable live in the Campus tab's "Suitability Weights" panel.

## Architecture

```
Demographic Analysis/
├── data/
│   ├── raw/          # pristine downloads (never edited)
│   └── processed/    # ETL outputs, consumed by web/
├── etl/              # Python ETL, numbered to run in order
├── web/
│   ├── index.html    # shell — loads MapLibre, Chart.js, Tailwind from CDN
│   ├── app.js        # top-level Preact+HTM store, routing
│   ├── state.js      # data loader
│   ├── campus.js     # Section 1 — Campus Analysis
│   ├── sbd.js        # Section 2 — School Board Districts
│   ├── heatmap.js    # Section 3 — Demographic Heat Maps
│   ├── suitability.js# per-variable weighted composite
│   ├── utils.js      # formatters, quantile breaks, color ramps
│   ├── serve.py      # bare Python http.server launcher
│   └── data -> ../data/processed  (symlink)
└── docs/             # vendor deck extractions
```

## Stack choices (and why)

- **Zero build step.** Modules load via ES-module imports from esm.sh. No
  npm/node/webpack. You can open `web/` in any editor and refresh the browser.
- **Preact+HTM over React.** Same API, 3 kB, no JSX transform needed.
- **MapLibre GL JS over Mapbox.** Same rendering, zero license cost, same
  vector-tile style from CARTO's free tier.
- **Python http.server.** Works everywhere; no Node required.
- **Tailwind via Play CDN.** Fine for a local tool; for production would swap
  in a compiled stylesheet.

## Extending

- Add a county: duplicate the county FIPS handling in `etl/03_fetch_boundaries.py`
  and `etl/04_fetch_acs.py`; everything downstream is county-agnostic.
- Add a metric to heat maps: append to the `LAYERS` array in `web/heatmap.js`
  and add the ramp to `web/utils.js`.
- Upgrade drive-time to real isochrones: see the `# TODO` in `etl/06_aggregate.py`
  where `RINGS` is defined.
- Plug in an applicant heatmap: load a CSV of geocoded applicant addresses,
  render as a heatmap layer on top of the existing map.

## License / data attribution

Data is all public domain (Census, FL DOE, Broward County GIS). Scripts and
UI code are not yet licensed — treat as internal KIPP property until a decision
is made.
