"""
Fetch boundary geometries needed for the app from the Census TIGERweb REST API
(free, no key). Outputs GeoJSON into data/processed/.

  - Broward County block groups (primary demographic unit)
  - Broward County SBDs — SCHOOL DISTRICT ELEMENTARY (Broward has one unified district;
    the "school board districts" in the InSite deck are SCHOOL_BOARD voting districts
    maintained by Broward County GIS, not Census geography. We fetch the county as
    one polygon here; the 7 SBD polygons require a separate Broward GIS fetch.)
  - Miami-Dade block groups (for future expansion)

Census TIGER FIPS:
  - FL state = 12
  - Broward county = 011
  - Miami-Dade county = 086
"""
import json, urllib.parse, urllib.request, os, time

TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"

def fetch_layer(service, layer_id, where, out_path, out_fields="*"):
    """Query the TIGERweb REST endpoint and save as GeoJSON."""
    url = (f"{TIGER}/{service}/MapServer/{layer_id}/query?"
           f"where={urllib.parse.quote(where)}"
           f"&outFields={out_fields}"
           "&f=geojson&outSR=4326&returnGeometry=true")
    print(f"Fetching {service}/{layer_id} where {where} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "kipp-demographics-etl/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(data, f)
    print(f"  -> {out_path}  ({len(data.get('features', []))} features)")
    return data

# Broward block groups (STATE/COUNTY are string fields — must be quoted)
fetch_layer(
    "tigerWMS_ACS2023",
    10,
    "STATE='12' AND COUNTY='011'",
    "data/processed/broward_blockgroups.geojson",
    "GEOID,STATE,COUNTY,TRACT,BLKGRP",
)
time.sleep(1)

# Miami-Dade block groups
fetch_layer(
    "tigerWMS_ACS2023",
    10,
    "STATE='12' AND COUNTY='086'",
    "data/processed/miamidade_blockgroups.geojson",
    "GEOID,STATE,COUNTY,TRACT,BLKGRP",
)
time.sleep(1)

# County polygons — for map framing only
fetch_layer(
    "tigerWMS_Current",
    82,  # Counties
    "STATE='12' AND (COUNTY='011' OR COUNTY='086')",
    "data/processed/counties.geojson",
    "GEOID,NAME,STATE,COUNTY",
)

print("\nDone.")
