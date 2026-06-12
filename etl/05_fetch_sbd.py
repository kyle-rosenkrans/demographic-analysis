"""
Fetch the 7 Broward County School Board District polygons from Broward County GIS.
Public, no auth required.
"""
import json, os, urllib.request

URL = ("https://bcgishub.broward.org/hbm/rest/services/SOE/"
       "SchoolBoardMunicpalDistricts2022/FeatureServer/17/query"
       "?where=1%3D1&outFields=*&f=geojson&outSR=4326")

print(f"Fetching Broward SBD polygons...")
req = urllib.request.Request(URL, headers={"User-Agent": "kipp-demographics-etl/1.0"})
with urllib.request.urlopen(req, timeout=60) as r:
    data = json.load(r)

# Normalize: make sure each feature has a 'district' property as int 1-7
for feat in data.get("features", []):
    props = feat.setdefault("properties", {})
    if "DISTRICT" in props:
        try:
            props["district"] = int(props["DISTRICT"])
        except (ValueError, TypeError):
            pass

out = "data/processed/broward_sbd.geojson"
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(data, f)
print(f"  -> {out}  ({len(data.get('features', []))} districts)")
for feat in data.get("features", []):
    p = feat["properties"]
    print(f"     District {p.get('district')}: {p.get('SHORTNAME') or p.get('LONGNAME')}")
