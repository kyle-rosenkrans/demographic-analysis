#!/usr/bin/env python3
"""
Build a single self-contained HTML file for the KIPP Miami / Broward demographics
tool — no server, no separate data files. Double-click the output to use it.

It bakes every data file the app loads into one <script> (window.__DATA), inlines
the pre-bundled app code (web/app.bundle.js), and keeps the CDN libraries
(MapLibre, Chart.js, Tailwind) as normal https <script> tags (those work from a
local file as long as you're online).

Run on your Mac (where the iCloud data files are readable):
    python3 build_standalone.py
Output:
    KIPP Demographics (standalone).html   (in this folder)

If you change anything under web/*.js you must re-bundle app.bundle.js with
esbuild before rebuilding; otherwise just re-run this to refresh the baked data.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(ROOT, "data", "processed")
WEB  = os.path.join(ROOT, "web")
OUT  = os.path.join(ROOT, "KIPP Demographics (standalone).html")

# Map each window.__DATA key -> source file. Mirrors loadAll() in web/state.js.
FILES = {
    "schools": "schools.geojson",
    "sbd": "broward_sbd.geojson",
    "bgBroward": "broward_blockgroups.geojson",
    "bgMiami": "miamidade_blockgroups.geojson",
    "counties": "counties.geojson",
    "acsBroward": "acs_broward.json",
    "acsMiami": "acs_miamidade.json",
    "campusRollup": "campus_rollup.json",
    "sbdRollup": "sbd_rollup.json",
    "countyRollup": "county_rollup.json",
    "schema": "acs_schema.json",
    "bgAssignment": "bg_sbd_assignment.json",
    "bcpsBoundaries": "bcps_boundaries.geojson",
    "stepupSchools": "stepup_schools.geojson",
    "stepupSbdRollup": "stepup_sbd_rollup.json",
    "campusEnroll": "campus_enrollment_5yr.json",
    "districtEnroll": "district_enrollment_5yr.json",
    "enrollBySchool": "fldoe_enrollment_by_school.json",
    "charterOperators": "charter_operators.json",
    "charterOperatorsMdc": "charter_operators_mdc.json",
    "mdcSbd": "miamidade_sbd.geojson",
    "mdcSbdRollup": "miamidade_sbd_rollup.json",
    "stepupMdcSbdRollup": "stepup_mdc_sbd_rollup.json",
    "mdcBoundaries": "miamidade_boundaries.geojson",
    "mdcSchools": "miamidade_schools.geojson",
    "universalSchools": "universal_schools.geojson",
    "universalRings": "universal_rings.json",
    "schoolCapacity": "school_capacity.json",
    "plpSchools": "plp_schools.json",
    "schoolPerformance": "school_performance.json",
}


def load(fn):
    path = os.path.join(PROC, fn)
    if not os.path.exists(path):
        print(f"   (missing, skipped) {fn}")
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    bundle_path = os.path.join(WEB, "app.bundle.js")
    if not os.path.exists(bundle_path):
        sys.exit("Missing web/app.bundle.js — re-bundle the app first (esbuild).")

    print("Reading data files…")
    data = {}
    for key, fn in FILES.items():
        d = load(fn)
        if d is not None:
            data[key] = d
            print(f"   {key}")
    # acs = merged block-group lookups (matches state.js)
    data["acs"] = {**(data.get("acsBroward") or {}), **(data.get("acsMiami") or {})}

    # ---- Orange County (third region) — mirror the merge in state.js loadAll ----
    OG = {
        "u": "orange_universal_schools.geojson", "perf": "orange_school_performance.json",
        "acs": "acs_orange.json", "bg": "orange_blockgroups.geojson", "rings": "orange_rings.json",
        "plp": "orange_plp.json", "enroll": "orange_enrollment_by_school.json",
        "sbd": "orange_sbd.geojson", "sbdroll": "orange_sbd_rollup.json", "cap": "orange_capacity.json",
    }
    og = {k: load(fn) for k, fn in OG.items()}
    if og.get("acs"):
        data["acs"].update(og["acs"]); data["acsOrange"] = og["acs"]
    if og.get("u"):
        if data.get("universalSchools"):
            data["universalSchools"]["features"] = data["universalSchools"]["features"] + og["u"]["features"]
        else:
            data["universalSchools"] = og["u"]
    for src, key in [("perf", "schoolPerformance"), ("rings", "universalRings"),
                     ("plp", "plpSchools"), ("enroll", "enrollBySchool"), ("cap", "schoolCapacity")]:
        if og.get(src):
            data.setdefault(key, {})
            if data[key] is None: data[key] = {}
            data[key].update(og[src])
    if og.get("bg"): data["bgOrange"] = og["bg"]
    if og.get("sbd"): data["orangeSbd"] = og["sbd"]
    if og.get("sbdroll"): data["orangeSbdRollup"] = og["sbdroll"]
    if og.get("bound"): data["orangeBoundaries"] = og["bound"]
    print("   + Orange merged (schools, performance, acs, rings, plp, enroll, sbd, boundaries)")

    print("Reading bundled app…")
    with open(bundle_path, encoding="utf-8") as f:
        bundle = f.read()

    data_json = json.dumps(data, separators=(",", ":"), allow_nan=False, default=str)
    # </script> can't appear literally inside an inline script
    data_json = data_json.replace("</", "<\\/")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>KIPP Demographics — Broward · Miami-Dade · Orange</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.5.0/dist/maplibre-gl.css" />
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {{ theme: {{ extend: {{ colors: {{
    kipp: {{ 50:'#fff7ed',100:'#ffedd5',500:'#f97316',600:'#ea580c',700:'#c2410c',900:'#7c2d12' }},
    ink: {{ 900:'#111827',700:'#374151',500:'#6b7280',300:'#d1d5db',100:'#f3f4f6' }} }} }} }} }};
</script>
<style>
  html, body, #app {{ height: 100%; margin: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; background:#f9fafb; color:#111827; }}
  .maplibregl-popup-content {{ font-size: 12px; line-height: 1.35; padding: 8px 10px; }}
  table.data {{ font-size: 12px; width: 100%; border-collapse: collapse; }}
  table.data th, table.data td {{ padding: 4px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; white-space: nowrap; }}
  table.data th {{ color: #6b7280; font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }}
  table.data td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .scrollbar-thin::-webkit-scrollbar {{ width: 6px; height: 6px; }}
  .scrollbar-thin::-webkit-scrollbar-thumb {{ background: #d1d5db; border-radius: 3px; }}
  .pill {{ display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 500; }}
</style>
</head>
<body>
<div id="app"></div>
<script src="https://unpkg.com/maplibre-gl@4.5.0/dist/maplibre-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script id="baked-data" type="application/json">{data_json}</script>
<script>window.__DATA = JSON.parse(document.getElementById("baked-data").textContent);</script>
<script type="module">
{bundle}
</script>
</body>
</html>
"""
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"\n✓  {OUT}")
    print(f"   {mb:.1f} MB — double-click it to open the tool (no server needed).")
    print("   (Requires an internet connection the first time it loads, for the map + chart libraries.)")


if __name__ == "__main__":
    main()
