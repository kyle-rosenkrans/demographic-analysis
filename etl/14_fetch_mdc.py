"""
Pull six Miami-Dade public-school datasets from Miami-Dade County's ArcGIS
Open Data hub (gis-mdc.opendata.arcgis.com) and normalize to the same shape
as Broward's.

Feature services (owner: 8Pc9XBTAsYuxx9Ny / Miami-Dade GIS):
  SchoolSite                     (public district schools, point)
  CharterSchool                  (charter schools, point)
  ElementaryAttendanceBoundary   (ES zones, polygon)
  MiddleAttendanceBoundary       (MS zones, polygon)
  HighAttendanceBoundary         (HS zones, polygon)
  SchoolBoardDistrict            (9 SBDs, polygon)

Outputs:
  data/processed/miamidade_schools.geojson           — combined points (public + charter)
  data/processed/miamidade_boundaries.geojson        — combined polygons (ES+MS+HS)
  data/processed/miamidade_sbd.geojson               — 9 School Board Districts
"""
import json, os, urllib.request, urllib.parse

BASE = "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services"
HEADERS = {"User-Agent": "kipp-demographics-etl/1.0"}

def fetch_geojson(service):
    url = f"{BASE}/{service}/FeatureServer/0/query?" + urllib.parse.urlencode({
        "where": "1=1", "outFields": "*", "outSR": "4326", "f": "geojson",
    })
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

os.makedirs("data/processed", exist_ok=True)

# ---------- Schools (public + charter) ----------
print("Fetching MDC public schools...")
public = fetch_geojson("SchoolSite_gdb")
print(f"  {len(public.get('features', []))} public schools")
print("Fetching MDC charter schools...")
charters = fetch_geojson("CharterSchool_gdb")
print(f"  {len(charters.get('features', []))} charter schools")

schools_feats = []
for f in public.get("features", []):
    p = f.get("properties", {})
    f["properties"] = {
        "source":       "mdcps_public",
        "loc_no":       str(p.get("ID")).strip().zfill(4) if p.get("ID") not in (None, "") else None,
        "name":         (p.get("NAME") or "").strip().title(),
        "campus":       (p.get("CAMPUS") or "").strip().title(),
        "address":      (p.get("ADDRESS") or "").strip(),
        "city":         (p.get("CITY") or "").strip().title(),
        "zip":          str(p.get("ZIPCODE") or "").strip(),
        "school_type":  (p.get("TYPE") or "").strip(),
        "grades":       (p.get("GRADES") or "").strip(),
        "capacity":     p.get("CAPACITY"),
        "enrollment":   p.get("ENROLLMNT"),
        "role":         "district",
    }
    schools_feats.append(f)
for f in charters.get("features", []):
    p = f.get("properties", {})
    f["properties"] = {
        "source":       "mdcps_charter",
        "loc_no":       str(p.get("ID")).strip().zfill(4) if p.get("ID") not in (None, "") else None,
        "name":         (p.get("NAME") or "").strip().title(),
        "campus":       (p.get("CAMPUS") or "").strip().title(),
        "address":      (p.get("ADDRESS") or "").strip(),
        "city":         (p.get("CITY") or "").strip().title(),
        "zip":          str(p.get("ZIPCODE") or "").strip(),
        "school_type":  "Charter",
        "grades":       (p.get("GRADE") or "").strip(),
        "capacity":     p.get("CAPACITY"),
        "enrollment":   p.get("ENROLLMNT"),
        "role":         "charter",
    }
    schools_feats.append(f)

schools_out = {"type": "FeatureCollection", "features": schools_feats}
with open("data/processed/miamidade_schools.geojson", "w") as f:
    json.dump(schools_out, f)
print(f"  -> data/processed/miamidade_schools.geojson  ({len(schools_feats)} total)")

# ---------- Attendance boundaries (ES + MS + HS) ----------
bound_feats = []
for svc, level in [("ElementaryAttendanceBoundary_gdb", "Elementary"),
                   ("MiddleAttendanceBoundary_gdb",     "Middle"),
                   ("HighAttendanceBoundary_gdb",       "High")]:
    print(f"Fetching MDC {level} attendance boundaries...")
    fc = fetch_geojson(svc)
    for f in fc.get("features", []):
        p = f.get("properties", {})
        raw_id = p.get("ID")
        loc_no = str(raw_id).strip().zfill(4) if raw_id not in (None, "") else None
        f["properties"] = {
            "loc_no":      loc_no,
            "name":        (p.get("NAME") or p.get("DISPLAYNAME") or "").strip().title(),
            "school_type": f"{level} School",
            "grades":      (p.get("GRADES") or "").strip(),
            "region":      (p.get("REGION") or "").strip(),
        }
        bound_feats.append(f)
    print(f"  {len(fc.get('features', []))} {level} zones")

bound_out = {"type": "FeatureCollection", "features": bound_feats}
with open("data/processed/miamidade_boundaries.geojson", "w") as f:
    json.dump(bound_out, f)
print(f"  -> data/processed/miamidade_boundaries.geojson  ({len(bound_feats)} features)")

# ---------- School Board Districts (9) ----------
print("Fetching MDC School Board Districts...")
sbd = fetch_geojson("SchoolBoardDistrict_gdb")
for f in sbd.get("features", []):
    p = f.get("properties", {})
    try:
        d = int((p.get("ID") or "").strip())
    except (ValueError, TypeError):
        d = None
    f["properties"] = {
        "district": d,
        "board_member": (p.get("BRDMBR") or "").strip().title(),
    }
with open("data/processed/miamidade_sbd.geojson", "w") as f:
    json.dump(sbd, f)
n = len(sbd.get("features", []))
print(f"  -> data/processed/miamidade_sbd.geojson  ({n} districts)")
for f in sbd.get("features", []):
    print(f"     District {f['properties']['district']}: {f['properties']['board_member']}")
