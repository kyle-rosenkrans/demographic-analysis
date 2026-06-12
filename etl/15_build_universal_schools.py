"""
Build a universal schools GeoJSON covering all public + charter schools in
Broward + Miami-Dade, with consistent properties. This is what powers the
"any school" picker in the Campus Analysis tab.

Inputs:
  data/processed/bcps_boundaries.geojson      (Broward, 201 traditional schools — use centroid)
  data/processed/miamidade_schools.geojson    (MDC, 632 points — already points)
  data/processed/fldoe_enrollment_by_school.json (enrollment history by school_num)
  data/processed/schools.geojson              (original 8 KIPP + PLP sites; keep their coords)

For Broward charters (school_num >= 5000), we use the geocoded coords that
etl/09_geocode_stepup.py left for us (private schools), but those are a
different dataset. For charters we'll rely on the already-geocoded `/schools.geojson`
points if present; else we'll geocode via Census batch in a separate step if
needed. Typically BCPS attendance boundaries exclude charters anyway — charters
are mapped by address in a separate BCPS GIS service we haven't pulled yet.

For v1, Broward charters will be omitted from the universal picker but Broward
traditional + MDC (all) will be fully covered.

Output:
  data/processed/universal_schools.geojson    (FeatureCollection of all schools with
                                               county, name, school_num, role, enrollment_25_26)
"""
import json, os
from statistics import mean

def polygon_centroid(geom):
    pts = []
    def walk(c):
        if isinstance(c[0], (int, float)): pts.append(c)
        else:
            for sub in c: walk(sub)
    walk(geom["coordinates"])
    return [mean(p[0] for p in pts), mean(p[1] for p in pts)] if pts else None

# Load supporting datasets
with open("data/processed/bcps_boundaries.geojson") as f: bcps = json.load(f)
with open("data/processed/miamidade_schools.geojson") as f: mdc_sch = json.load(f)
with open("data/processed/fldoe_enrollment_by_school.json") as f: enroll = json.load(f)
with open("data/processed/schools.geojson") as f: kipp_plp = json.load(f)

# Kyle's 8 pre-geocoded sites — keep their exact lat/lng (more accurate than centroids)
plp_coords = {}
for f in kipp_plp["features"]:
    p = f["properties"]
    key = (p.get("fl_school_number") or "").zfill(4) if p.get("fl_school_number") else None
    if key:
        plp_coords[key] = f["geometry"]["coordinates"]

feats = []

# ---------- Broward: traditional schools from BCPS boundary centroids ----------
print("Broward traditional schools (from BCPS boundary centroids)...")
for f in bcps["features"]:
    p = f["properties"]
    loc_no = p["loc_no"]
    name = p["name"]
    school_type = p["school_type"]
    # Prefer Kyle's pre-geocoded coords if available
    coords = plp_coords.get(loc_no) or polygon_centroid(f["geometry"])
    if not coords: continue
    key = f"06-{loc_no}"
    rec = enroll.get(key, {})
    enroll_25 = (rec.get("years") or {}).get("2526", {}).get("total", 0)
    feats.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": coords},
        "properties": {
            "id":          f"BRW-{loc_no}",
            "county":      "broward",
            "name":        name,
            "school_num":  loc_no,
            "school_type": school_type,
            "role":        "district",
            "enrollment_2526": enroll_25,
        },
    })
brow_trad = len(feats)
print(f"  {brow_trad} schools")

# ---------- Miami-Dade: points already have coords ----------
print("Miami-Dade schools (from MDC GIS points)...")
for f in mdc_sch["features"]:
    p = f["properties"]
    if not f.get("geometry"): continue
    loc_no = p.get("loc_no")
    name = p["name"]
    role = "charter" if p["role"] == "charter" else "district"
    # If this school is in FL DOE enrollment data, fetch enrollment (district #13 = MDC)
    enroll_25 = 0
    if loc_no:
        key = f"13-{loc_no}"
        if key in enroll:
            enroll_25 = (enroll[key].get("years") or {}).get("2526", {}).get("total", 0)
    # fallback to MDC's ENROLLMNT field (may be slightly stale)
    if not enroll_25 and p.get("enrollment"):
        enroll_25 = p["enrollment"]
    feats.append({
        "type": "Feature",
        "geometry": f["geometry"],
        "properties": {
            "id":          f"MDC-{loc_no or p.get('name','').replace(' ','_')[:30]}",
            "county":      "miamidade",
            "name":        name,
            "school_num":  loc_no,
            "school_type": p.get("school_type"),
            "grades":      p.get("grades"),
            "role":        role,
            "address":     p.get("address"),
            "city":        p.get("city"),
            "enrollment_2526": enroll_25,
        },
    })
mdc_n = len(feats) - brow_trad
print(f"  {mdc_n} schools")

# ---------- KIPP Miami North (incubation) ----------
# Pre-existing in schools.geojson, with role="incubation"
for f in kipp_plp["features"]:
    p = f["properties"]
    if p.get("role") != "incubation": continue
    feats.append({
        "type": "Feature",
        "geometry": f["geometry"],
        "properties": {
            "id":          "KIPP-MIAMI-NORTH",
            "county":      "miamidade",
            "name":        p["name"],
            "school_num":  p.get("fl_school_number") or "",
            "school_type": "Incubation",
            "role":        "incubation",
            "address":     p.get("address"),
            "city":        p.get("city"),
            "enrollment_2526": 0,
        },
    })

out = {"type": "FeatureCollection", "features": feats}
with open("data/processed/universal_schools.geojson", "w") as f:
    json.dump(out, f)
print(f"\n-> data/processed/universal_schools.geojson  ({len(feats)} schools)")
print(f"   Broward: {sum(1 for x in feats if x['properties']['county']=='broward')}")
print(f"   MDC:     {sum(1 for x in feats if x['properties']['county']=='miamidade')}")
print(f"   By role:")
roles = {}
for x in feats:
    r = x["properties"]["role"]
    roles[r] = roles.get(r, 0) + 1
for r, c in sorted(roles.items()):
    print(f"     {r}: {c}")
