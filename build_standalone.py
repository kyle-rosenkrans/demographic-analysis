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

If you change anything under web/*.js, regenerate web/app.bundle.js first
(python3 build_bundle.py — a plain concatenator, no esbuild/node needed for
this project's module graph), then re-run this to refresh the baked data.

The <html ...> tag attributes and the whole <head>...</head> block (design
tokens, Tailwind config, fonts) are read live from web/index.html rather than
duplicated here, so the standalone build always matches the dev version.
"""
import json, os, re, sys

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
    "browardPlaces": "broward_places.geojson",
    "mdcPlaces": "miamidade_places.geojson",
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
        "places": "orange_places.geojson",
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
    if og.get("places"): data["orangePlaces"] = og["places"]
    print("   + Orange merged (schools, performance, acs, rings, plp, enroll, sbd, boundaries, places)")

    print("Reading bundled app…")
    with open(bundle_path, encoding="utf-8") as f:
        bundle = f.read()

    print("Reading web/index.html for <html> attrs + <head>…")
    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        shell = f.read()
    html_attrs_m = re.search(r"<html\s+([^>]*)>", shell)
    head_m = re.search(r"<head>(.*?)</head>", shell, re.DOTALL)
    if not html_attrs_m or not head_m:
        sys.exit("Couldn't find <html ...> / <head>...</head> in web/index.html")
    html_attrs = html_attrs_m.group(1).strip()
    head_inner = head_m.group(1)
    # Drop the module script tag — the standalone build inlines the bundle instead.
    head_inner = re.sub(r'\n?<script type="module" src="\./app\.js"></script>\n?', "\n", head_inner)
    head_inner = head_inner.replace(
        "<title>KIPP Demographics — Broward · Miami-Dade · Orange</title>",
        "<title>KIPP Demographics — Broward · Miami-Dade · Orange (standalone)</title>",
    )

    data_json = json.dumps(data, separators=(",", ":"), allow_nan=False, default=str)
    # </script> can't appear literally inside an inline script
    data_json = data_json.replace("</", "<\\/")

    html = f"""<!DOCTYPE html>
<html {html_attrs}>
<head>{head_inner}</head>
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
