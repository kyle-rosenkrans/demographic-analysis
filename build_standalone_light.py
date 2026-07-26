#!/usr/bin/env python3
"""
Build a LIGHT single-file HTML (< 25 MB) for uploading where size is capped.
Same tool as build_standalone.py, but:
  - drops the unused attendance-boundary geojsons (not rendered by any layer)
  - simplifies all polygon/line geometry (Douglas-Peucker + 5-decimal rounding),
    which mostly shrinks the block-group choropleth geometry with no visible
    change at the zoom levels the tool uses
CDN libraries (MapLibre, Chart.js, Tailwind) still load from the web, as before.

Run:  python3 build_standalone_light.py
Out:  KIPP Demographics (light).html
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(ROOT, "data", "processed")
WEB  = os.path.join(ROOT, "web")
OUT  = os.path.join(ROOT, "KIPP Demographics (light).html")

EPS = 0.0004  # ~44 m Douglas-Peucker tolerance
PREC = 5      # coordinate decimals (~1 m)

FILES = {
    "schools": "schools.geojson", "sbd": "broward_sbd.geojson",
    "bgBroward": "broward_blockgroups.geojson", "bgMiami": "miamidade_blockgroups.geojson",
    "counties": "counties.geojson", "acsBroward": "acs_broward.json", "acsMiami": "acs_miamidade.json",
    "campusRollup": "campus_rollup.json", "sbdRollup": "sbd_rollup.json", "countyRollup": "county_rollup.json",
    "schema": "acs_schema.json", "bgAssignment": "bg_sbd_assignment.json",
    "stepupSchools": "stepup_schools.geojson", "stepupSbdRollup": "stepup_sbd_rollup.json",
    "campusEnroll": "campus_enrollment_5yr.json", "districtEnroll": "district_enrollment_5yr.json",
    "enrollBySchool": "fldoe_enrollment_by_school.json", "charterOperators": "charter_operators.json",
    "charterOperatorsMdc": "charter_operators_mdc.json", "mdcSbd": "miamidade_sbd.geojson",
    "mdcSbdRollup": "miamidade_sbd_rollup.json", "stepupMdcSbdRollup": "stepup_mdc_sbd_rollup.json",
    "mdcSchools": "miamidade_schools.geojson", "universalSchools": "universal_schools.geojson",
    "universalRings": "universal_rings.json", "schoolCapacity": "school_capacity.json",
    "plpSchools": "plp_schools.json", "schoolPerformance": "school_performance.json",
    "browardPlaces": "broward_places.geojson", "mdcPlaces": "miamidade_places.geojson",
}
OG = {
    "u": "orange_universal_schools.geojson", "perf": "orange_school_performance.json",
    "acs": "acs_orange.json", "bg": "orange_blockgroups.geojson", "rings": "orange_rings.json",
    "plp": "orange_plp.json", "enroll": "orange_enrollment_by_school.json",
    "sbd": "orange_sbd.geojson", "sbdroll": "orange_sbd_rollup.json", "cap": "orange_capacity.json",
    "places": "orange_places.geojson",
}


def load(fn):
    p = os.path.join(PROC, fn)
    if not os.path.exists(p):
        print("   (missing)", fn); return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _rdp(pts, eps):
    n = len(pts)
    if n < 3:
        return pts[:]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        ax, ay = pts[s]; bx, by = pts[e]
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        idx, dmax = -1, -1.0
        for i in range(s + 1, e):
            px, py = pts[i]
            if d2 == 0:
                dist = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / d2
                t = 0.0 if t < 0 else 1.0 if t > 1 else t
                qx, qy = ax + t * dx, ay + t * dy
                dist = ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5
            if dist > dmax:
                dmax, idx = dist, i
        if dmax > eps and idx != -1:
            keep[idx] = True
            stack.append((s, idx)); stack.append((idx, e))
    return [pts[i] for i in range(n) if keep[i]]


def _round(pts):
    return [[round(x, PREC), round(y, PREC)] for x, y in pts]


def _ring(r):
    if len(r) <= 4:
        return _round(r)
    s = _rdp(r, EPS)
    if len(s) < 4:
        s = _rdp(r, EPS / 3) or r
    if s[0] != s[-1]:
        s = s + [s[0]]
    return _round(s)


def thin_geom(g):
    if not g:
        return g
    t = g.get("type")
    c = g.get("coordinates")
    if t == "Point":
        g["coordinates"] = [round(c[0], PREC), round(c[1], PREC)]
    elif t == "MultiPoint":
        g["coordinates"] = _round(c)
    elif t == "LineString":
        g["coordinates"] = _round(_rdp(c, EPS))
    elif t == "MultiLineString":
        g["coordinates"] = [_round(_rdp(line, EPS)) for line in c]
    elif t == "Polygon":
        g["coordinates"] = [_ring(r) for r in c]
    elif t == "MultiPolygon":
        g["coordinates"] = [[_ring(r) for r in poly] for poly in c]
    return g


def thin_fc(fc):
    if isinstance(fc, dict) and fc.get("type") == "FeatureCollection":
        for f in fc.get("features", []):
            if f.get("geometry"):
                thin_geom(f["geometry"])
    return fc


def main():
    bundle_path = os.path.join(WEB, "app.bundle.js")
    if not os.path.exists(bundle_path):
        sys.exit("Missing web/app.bundle.js")

    print("Reading + thinning data...")
    data = {}
    for key, fn in FILES.items():
        d = load(fn)
        if d is not None:
            data[key] = thin_fc(d) if fn.endswith(".geojson") else d
    data["acs"] = {**(data.get("acsBroward") or {}), **(data.get("acsMiami") or {})}

    og = {k: load(fn) for k, fn in OG.items()}
    if og.get("acs"):
        data["acs"].update(og["acs"]); data["acsOrange"] = og["acs"]
    if og.get("u"):
        thin_fc(og["u"])
        if data.get("universalSchools"):
            data["universalSchools"]["features"] += og["u"]["features"]
        else:
            data["universalSchools"] = og["u"]
    for src, key in [("perf", "schoolPerformance"), ("rings", "universalRings"),
                     ("plp", "plpSchools"), ("enroll", "enrollBySchool"), ("cap", "schoolCapacity")]:
        if og.get(src):
            data.setdefault(key, {})
            if data[key] is None: data[key] = {}
            data[key].update(og[src])
    if og.get("bg"): data["bgOrange"] = thin_fc(og["bg"])
    if og.get("sbd"): data["orangeSbd"] = thin_fc(og["sbd"])
    if og.get("sbdroll"): data["orangeSbdRollup"] = og["sbdroll"]
    if og.get("places"): data["orangePlaces"] = thin_fc(og["places"])

    with open(bundle_path, encoding="utf-8") as f:
        bundle = f.read()

    with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
        shell = f.read()
    html_attrs_m = re.search(r"<html\s+([^>]*)>", shell)
    head_m = re.search(r"<head>(.*?)</head>", shell, re.DOTALL)
    if not html_attrs_m or not head_m:
        sys.exit("Couldn't find <html ...> / <head>...</head> in web/index.html")
    html_attrs = html_attrs_m.group(1).strip()
    head_inner = head_m.group(1)
    head_inner = re.sub(r'\n?<script type="module" src="\./app\.js"></script>\n?', "\n", head_inner)
    head_inner = head_inner.replace(
        "<title>KIPP Demographics — Broward · Miami-Dade · Orange</title>",
        "<title>KIPP Demographics — Broward · Miami-Dade · Orange (light)</title>",
    )

    data_json = json.dumps(data, separators=(",", ":"), allow_nan=False, default=str).replace("</", "<\\/")

    html = f"""<!DOCTYPE html>
<html {html_attrs}>
<head>{head_inner}</head>
<body>
<div id="app"></div>
<script src="https://unpkg.com/maplibre-gl@4.5.0/dist/maplibre-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script id="baked-data" type="application/json">{data_json}</script>
<script>window.__DATA=JSON.parse(document.getElementById("baked-data").textContent);</script>
<script type="module">
{bundle}
</script>
</body></html>
"""
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"\n[OK]  {OUT}\n   {mb:.1f} MB")


if __name__ == "__main__":
    main()
