"""
Fetch tract-level ACS tables that aren't published at block-group level:
  B22001  - SNAP receipt (suppressed at BG for privacy)
  B19013  - Median HH income (also BG-sparse)

Then apportion tract values down to each block group inside the tract,
weighted by household count (from BG-level B19001_001E we already have).
Merges the result back into acs_<county>.json.
"""
import json, os, urllib.request, urllib.parse, time

API = "https://api.census.gov/data/2023/acs/acs5"
KEY = os.environ.get("CENSUS_API_KEY", "")

def fetch_tract(state, county, varlist):
    params = {
        "get": "GEO_ID,NAME," + ",".join(varlist),
        "for": "tract:*",
        "in": f"state:{state} county:{county}",
    }
    if KEY: params["key"] = KEY
    url = f"{API}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)

TRACT_VARS = [
    "B22001_001E",  # total hh for SNAP universe
    "B22001_002E",  # receiving SNAP
    "B19013_001E",  # median hh income (tract-level reliable)
]

for county_fips, label in [("011", "broward"), ("086", "miamidade")]:
    print(f"Tract-level ACS for {label}...")
    rows = fetch_tract("12", county_fips, TRACT_VARS)
    hdr = rows[0]
    gi = hdr.index("GEO_ID")
    tract_data = {}
    for row in rows[1:]:
        geoid = row[gi].split("US")[-1]  # 11-digit tract GEOID
        def num(col):
            v = row[hdr.index(col)]
            try: return int(v) if v not in (None, "", "null") else None
            except ValueError: return None
        tract_data[geoid] = {
            "hh_snap_universe": num("B22001_001E"),
            "hh_snap_recv":     num("B22001_002E"),
            "hh_median_income": num("B19013_001E"),
        }

    # Apportion down to BGs: for each BG, look up its tract (first 11 chars of 12-char BG GEOID)
    # and assign pct_snap = snap_recv/universe; set hh_snap counts proportional to BG HH share of tract.
    bg_path = f"data/processed/acs_{label}.json"
    with open(bg_path) as f: bgs = json.load(f)

    # group BGs by tract and sum HHs
    tract_hh_total = {}
    for geoid, bg in bgs.items():
        t = geoid[:11]
        tract_hh_total[t] = tract_hh_total.get(t, 0) + (bg.get("hh_total_for_income") or 0)

    for geoid, bg in bgs.items():
        t = geoid[:11]
        td = tract_data.get(t, {})
        snap_u = td.get("hh_snap_universe") or 0
        snap_r = td.get("hh_snap_recv") or 0
        pct_snap = (snap_r / snap_u) if snap_u else None

        bg_hh = bg.get("hh_total_for_income") or 0
        share = (bg_hh / tract_hh_total[t]) if tract_hh_total.get(t) else 0
        bg["hh_total_for_snap"] = int(round(snap_u * share)) if snap_u else 0
        bg["hh_snap_recv"]     = int(round(snap_r * share)) if snap_r else 0
        bg["pct_snap"]         = pct_snap
        if not bg.get("hh_median_income"):
            bg["hh_median_income"] = td.get("hh_median_income")

    with open(bg_path, "w") as f:
        json.dump(bgs, f)
    print(f"  -> merged into {bg_path}")
    time.sleep(0.4)

print("Done.")
