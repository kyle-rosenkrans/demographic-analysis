"""
Geocode the 8 target campuses via the Census Geocoder (free, no API key).
Writes data/processed/schools.geojson.

Target schools: KIPP Miami North (incubation site) + 7 Priority Launch Partner schools
from the InSite deck. FL DOE school numbers and district numbers included so we can
later join enrollment data from FL DOE PK-12 data exports.
"""
import json, urllib.parse, urllib.request, time, os

SCHOOLS = [
    # name,                              address,                                         city,           state, zip,    fl_district, fl_sch_num,  role,           fallback_query
    ("KIPP Miami North",                 "3000 NW 110th Street",                          "Miami",        "FL",  "33167", "13", None,   "incubation", "3000 NW 110 St, Miami, FL"),
    ("Charles Drew Elementary",          "1000 NW 31st Ave",                              "Pompano Beach","FL",  "33069", "06", "3221", "plp",        "Charles Drew Elementary School, Pompano Beach, FL"),
    ("Lloyd Estates Elementary",         "3251 NE 9th Ave",                               "Oakland Park", "FL",  "33334", "06", "1091", "plp",        "Lloyd Estates Elementary, Oakland Park, FL"),
    ("Robert C. Markham Elementary",     "1901 SE 6th Ave",                               "Pompano Beach","FL",  "33060", "06", "1671", "plp",        "Robert C Markham Elementary, Pompano Beach, FL"),
    ("Royal Palm Elementary",            "2500 NW 41st St",                               "Lauderdale Lakes","FL","33309","06", "1851", "plp",        "Royal Palm Elementary, Lauderdale Lakes, FL"),
    ("Sunshine Elementary",              "6500 SW 21st St",                               "Miramar",      "FL",  "33023", "06", None,   "target",     "Sunshine Elementary School, Miramar, FL"),
    ("Tedder Elementary",                "701 NE 13th Ave",                               "Pompano Beach","FL",  "33060", "06", "0571", "plp",        "Tedder Elementary, Pompano Beach, FL"),
    ("William Dandy Middle",             "2400 NW 26th St",                               "Fort Lauderdale","FL","33311", "06", None,   "target",     "William Dandy Middle School, Fort Lauderdale, FL"),
]

def geocode_census(addr, city, state, zipcode):
    """Census one-line geocoder — public, no key."""
    url = ("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
           f"?address={urllib.parse.quote(f'{addr}, {city}, {state} {zipcode}')}"
           "&benchmark=Public_AR_Current&format=json")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.load(r)
        matches = data.get("result", {}).get("addressMatches", [])
        if not matches:
            return None
        m = matches[0]
        return {"lat": m["coordinates"]["y"], "lng": m["coordinates"]["x"],
                "matched_address": m["matchedAddress"], "source": "census"}
    except Exception:
        return None

def geocode_nominatim(query):
    """OpenStreetMap Nominatim — free; rate-limited, use sparingly."""
    url = ("https://nominatim.openstreetmap.org/search"
           f"?q={urllib.parse.quote(query)}&format=json&limit=1&countrycodes=us")
    req = urllib.request.Request(url, headers={"User-Agent": "kipp-demographics-etl/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        if not data:
            return None
        m = data[0]
        return {"lat": float(m["lat"]), "lng": float(m["lon"]),
                "matched_address": m.get("display_name", ""), "source": "nominatim"}
    except Exception:
        return None

# Manual fallback coordinates for schools neither geocoder can resolve.
# Looked up via Broward County Public Schools school-finder map.
MANUAL_OVERRIDES = {
    "Royal Palm Elementary": (26.1828, -80.1903, "2500 NW 41st St, Lauderdale Lakes FL (manual)"),
}

def geocode(name, addr, city, state, zipcode, fallback_query):
    if name in MANUAL_OVERRIDES:
        lat, lng, label = MANUAL_OVERRIDES[name]
        return {"lat": lat, "lng": lng, "matched_address": label, "source": "manual"}
    g = geocode_census(addr, city, state, zipcode)
    if g: return g
    return geocode_nominatim(fallback_query)

features = []
for name, addr, city, state, zc, fld, sn, role, fbq in SCHOOLS:
    print(f"Geocoding: {name}...", flush=True)
    g = geocode(name, addr, city, state, zc, fbq)
    if g is None:
        print(f"  ! NO MATCH — will need manual lat/lng for {name}")
        continue
    features.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [g["lng"], g["lat"]]},
        "properties": {
            "name": name, "address": addr, "city": city, "state": state, "zip": zc,
            "matched_address": g["matched_address"], "geocode_source": g["source"],
            "fl_district": fld, "fl_school_number": sn, "role": role,
        }
    })
    print(f"  -> {g['lat']:.5f}, {g['lng']:.5f}  ({g['source']})")
    time.sleep(1.1)  # Nominatim asks for <1 req/sec

fc = {"type": "FeatureCollection", "features": features}
out = "data/processed/schools.geojson"
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(fc, f, indent=2)
print(f"\nWrote {out} — {len(features)} schools")
