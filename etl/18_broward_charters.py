"""
18_broward_charters.py
Pull Broward charter school points from AllBrowardSchoolsMaster2025V1 ArcGIS service,
match with FL DOE enrollment data, and merge into universal_schools.geojson.
"""
import json, pathlib, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).parent.parent
PROC = ROOT / "data" / "processed"

# ── 1. Fetch charter schools from ArcGIS service ─────────────────────────────
BASE = ("https://services8.arcgis.com/5jTkDtZWfVtsH4TI/arcgis/rest/services/"
        "AllBrowardSchoolsMaster2025V1/FeatureServer/0/query")
params = {
    "where": "USER_CHARTER_SCHL_STAT='R'",
    "outFields": ("USER_SCHOOL,USER_SCHOOL_NAME_LONG,USER_LATITUDE,USER_LONGITUDE,"
                  "USER_SchlType,USER_PHYSICAL_ADDRESS,USER_PHYSICAL_CITY,USER_PHYSICAL_ZIP"),
    "resultRecordCount": "300",
    "f": "json",
}
url = BASE + "?" + urllib.parse.urlencode(params)
with urllib.request.urlopen(url, timeout=30) as resp:
    data = json.load(resp)

features_raw = data.get("features", [])
print(f"GIS service returned {len(features_raw)} active Broward charter schools")

# Build lookup: school_num (int) → {name, lat, lng, city, address, schltype}
gis_map = {}
skipped_no_coords = 0
for f in features_raw:
    a = f["attributes"]
    num = a.get("USER_SCHOOL")
    lat = a.get("USER_LATITUDE")
    lng = a.get("USER_LONGITUDE")
    if num is None or lat is None or lng is None:
        skipped_no_coords += 1
        continue
    if lat == 0 or lng == 0:
        skipped_no_coords += 1
        continue
    gis_map[int(num)] = {
        "name": (a.get("USER_SCHOOL_NAME_LONG") or "").title(),
        "lat": float(lat),
        "lng": float(lng),
        "address": a.get("USER_PHYSICAL_ADDRESS", ""),
        "city": (a.get("USER_PHYSICAL_CITY") or "").title(),
        "zip": str(a.get("USER_PHYSICAL_ZIP", "") or ""),
        "schltype": a.get("USER_SchlType", ""),
    }
print(f"  {len(gis_map)} with valid coordinates ({skipped_no_coords} missing coords)")

# ── 2. Load FL DOE enrollment data ───────────────────────────────────────────
with open(PROC / "fldoe_enrollment_by_school.json") as f:
    enrollment = json.load(f)

# Charter keys: "06-NNNN" where NNNN >= 5000
enroll_map = {}
for k, v in enrollment.items():
    if k.startswith("06-"):
        try:
            n = int(k.split("-", 1)[1])
            if n >= 5000:
                enroll_map[n] = {"key": k, **v}
        except ValueError:
            pass
print(f"FL DOE enrollment: {len(enroll_map)} Broward charter schools")

# ── 3. Load existing universal_schools.geojson ───────────────────────────────
with open(PROC / "universal_schools.geojson") as f:
    univ = json.load(f)

existing_ids = {feat["properties"]["id"] for feat in univ["features"]}
print(f"Existing universal_schools.geojson: {len(univ['features'])} features")

# ── 4. Build new features for Broward charters ───────────────────────────────
added = 0
no_enroll = 0
new_features = []

for school_num, info in sorted(gis_map.items()):
    uid = f"BRW-{school_num}"
    if uid in existing_ids:
        continue  # already present (shouldn't happen but be safe)

    e = enroll_map.get(school_num, {})
    latest_k8 = 0
    latest_k12 = 0
    if e.get("years"):
        latest_yr = sorted(e["years"].keys())[-1]
        latest_k8  = e["years"][latest_yr].get("k8",  0) or 0
        latest_k12 = e["years"][latest_yr].get("total", 0) or 0

    # Determine level from schltype
    st = info["schltype"].lower()
    if "elementary" in st and "secondary" not in st and "middle" not in st:
        level = "ES"
    elif "middle" in st or "jr" in st:
        level = "MS"
    elif "high" in st or "senior" in st:
        level = "HS"
    elif "combination" in st or "secondary" in st:
        level = "K8"
    else:
        level = "K8"

    feat = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [info["lng"], info["lat"]]},
        "properties": {
            "id": uid,
            "loc_no": str(school_num),
            "name": info["name"] or e.get("name", f"Charter School {school_num}"),
            "county": "Broward",
            "type": "charter",
            "level": level,
            "city": info["city"],
            "address": info["address"],
            "enrollment_k8": int(latest_k8),
            "enrollment_k12": int(latest_k12),
            "enroll_key": e.get("key", f"06-{school_num}"),
        }
    }
    new_features.append(feat)
    added += 1
    if not e:
        no_enroll += 1

print(f"\nNew Broward charter features to add: {added}")
print(f"  of which have FL DOE enrollment data: {added - no_enroll}")
print(f"  of which have no enrollment match:    {no_enroll}")

# ── 5. Merge and save ─────────────────────────────────────────────────────────
univ["features"].extend(new_features)
print(f"\nTotal features after merge: {len(univ['features'])}")

with open(PROC / "universal_schools.geojson", "w") as f:
    json.dump(univ, f)
print(f"Saved → {PROC / 'universal_schools.geojson'}")
