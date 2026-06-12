"""
Fetch BCPS school attendance boundaries from Broward County GIS.

Source: AllSchoolBoundaries feature service, owned by ABARD_BCGIS.
  https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/AllSchoolBoundaries/FeatureServer/8

201 polygons: 135 elementary, 39 middle, 27 high.
Fields: LOC_NO (matches FL DOE school_number), NAME, SCHOOLTYPE.

Output:
  data/processed/bcps_boundaries.geojson  — all 201 attendance zones
"""
import json, os, urllib.request, urllib.parse

URL = ("https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/"
       "AllSchoolBoundaries/FeatureServer/8/query")

params = {
    "where": "1=1",
    "outFields": "LOC_NO,NAME,SCHOOLTYPE",
    "outSR": "4326",
    "f": "geojson",
}
url = f"{URL}?{urllib.parse.urlencode(params)}"

print("Fetching BCPS attendance boundaries...")
req = urllib.request.Request(url, headers={"User-Agent": "kipp-demographics-etl/1.0"})
with urllib.request.urlopen(req, timeout=90) as r:
    data = json.load(r)

# Normalize properties: lowercase keys, strip whitespace
for f in data.get("features", []):
    p = f.get("properties", {})
    f["properties"] = {
        "loc_no":      (p.get("LOC_NO") or "").strip(),
        "name":        (p.get("NAME") or "").strip().title(),
        "school_type": p.get("SCHOOLTYPE") or "",
    }

out = "data/processed/bcps_boundaries.geojson"
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(data, f)

n = len(data.get("features", []))
types = {}
for f in data.get("features", []):
    t = f["properties"]["school_type"]
    types[t] = types.get(t, 0) + 1
print(f"  -> {out}  ({n} features)")
for t, c in sorted(types.items()):
    print(f"     {t}: {c}")

# Sanity check: make sure our 7 PLP schools match by LOC_NO
plp_ids = ["3221", "1091", "1671", "1851", "0571"]  # Drew, Lloyd, Markham, Royal Palm, Tedder (Sunshine/Dandy missing LOC_NO)
locs = {f["properties"]["loc_no"] for f in data["features"]}
for pid in plp_ids:
    if pid in locs:
        name = next(f["properties"]["name"] for f in data["features"] if f["properties"]["loc_no"] == pid)
        print(f"  ✓ PLP {pid} matched: {name}")
    else:
        print(f"  ✗ PLP {pid} NOT in boundary set")
