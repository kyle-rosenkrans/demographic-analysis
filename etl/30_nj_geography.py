"""
30_nj_geography.py — New Jersey geography for the NJ side of the tool.

NJ cities are organized by WARD rather than by school-board district (the NJ
districts here are citywide), so wards are the NJ analog of Florida's SBDs.

Sources (all open, no key):
  - Ward boundaries: NJOGIS "Ward_Boundaries_for_New_Jersey" (Govt_admin_ward).
    Newark has 5 *named* wards (Central/East/North/South/West); Camden (4) and
    Paterson (6) use numbered wards. Note MUN_NAME is "Newark City" etc., and
    "East Newark Borough" is a different municipality in Hudson County that a
    naive LIKE '%NEWARK%' would wrongly pull in — matched exactly instead.
  - Municipal boundaries: Census TIGERweb incorporated places, same layer and
    schema used for the Florida municipal layer (etl/23), so the web layer code
    is shared.
  - Block groups: Census TIGERweb, for Essex (013), Camden (007), Passaic (031).

Outputs (data/processed/):
  nj_wards.geojson        props: city, ward, ward_label
  nj_places.geojson       props: name, geoid, city   (same shape as *_places)
  nj_blockgroups.geojson  props: GEOID, ...
  nj_cities.geojson       city polygons for map framing / BG assignment
"""
import json, os, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")
os.makedirs(PROC, exist_ok=True)

UA = {"User-Agent": "kipp-demographics-etl/1.0"}
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
NJOGIS = "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services"

# city key -> (NJOGIS MUN_NAME, county name, TIGER place code, label)
CITIES = {
    "newark":   ("Newark City",   "Essex",   "51000", "Newark"),
    "camden":   ("Camden City",   "Camden",  "10000", "Camden"),
    "paterson": ("Paterson City", "Passaic", "57000", "Paterson"),
}
# NJ = state 34. Counties containing our cities.
COUNTY_FIPS = {"newark": "013", "camden": "007", "paterson": "031"}


def getjson(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def tiger(service, layer, where, fields="*"):
    url = (f"{TIGER}/{service}/MapServer/{layer}/query?"
           f"where={urllib.parse.quote(where)}&outFields={urllib.parse.quote(fields)}"
           "&f=geojson&outSR=4326&returnGeometry=true")
    return getjson(url)


def arcgis(base, layer, where, fields="*"):
    """NJOGIS hosted FeatureServer -> GeoJSON in WGS84."""
    url = (f"{base}/{layer}/query?where={urllib.parse.quote(where)}"
           f"&outFields={urllib.parse.quote(fields)}&f=geojson&outSR=4326&returnGeometry=true")
    return getjson(url)


def write(name, features):
    path = os.path.join(PROC, name)
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    print(f"  {name}: {len(features)} features")


def main():
    print("[1/4] Ward boundaries (NJOGIS)")
    mun_names = ", ".join(f"'{v[0]}'" for v in CITIES.values())
    fc = arcgis(f"{NJOGIS}/Ward_Boundaries_for_New_Jersey/FeatureServer", 0,
                f"MUN_NAME IN ({mun_names})", "MUN_NAME,COUNTY,WARD_CODE,WARD_KEY")
    by_mun = {v[0]: k for k, v in CITIES.items()}
    wards = []
    for f in fc.get("features", []):
        p = f.get("properties", {}) or {}
        city = by_mun.get(p.get("MUN_NAME"))
        if not city:
            continue
        raw = str(p.get("WARD_CODE") or "").strip()
        # Newark's wards are named, Camden/Paterson's are zero-padded numbers.
        # Keep a stable `ward` key for joins plus a display label.
        ward = raw.lstrip("0") or raw
        label = ward if not ward.isdigit() else f"Ward {int(ward)}"
        wards.append({
            "type": "Feature",
            "properties": {"city": city, "ward": ward, "ward_label": label},
            "geometry": f.get("geometry"),
        })
    wards.sort(key=lambda f: (f["properties"]["city"], f["properties"]["ward"]))
    write("nj_wards.geojson", wards)
    for city in CITIES:
        got = [f["properties"]["ward"] for f in wards if f["properties"]["city"] == city]
        print(f"     {city}: {len(got)} wards -> {got}")
    time.sleep(1)

    print("[2/4] Municipal boundaries (TIGER incorporated places)")
    place_where = " OR ".join(f"(STATE='34' AND PLACE='{v[2]}')" for v in CITIES.values())
    fc = tiger("tigerWMS_Current", 28, place_where,
               "GEOID,STATE,PLACE,BASENAME,NAME,INTPTLAT,INTPTLON")
    by_place = {v[2]: k for k, v in CITIES.items()}
    places = []
    for f in fc.get("features", []):
        p = f.get("properties", {}) or {}
        city = by_place.get(str(p.get("PLACE") or ""))
        places.append({
            "type": "Feature",
            "properties": {"name": p.get("BASENAME") or p.get("NAME"),
                           "geoid": p.get("GEOID"), "city": city},
            "geometry": f.get("geometry"),
        })
    write("nj_places.geojson", places)
    # Same geometry doubles as the city framing/assignment polygons.
    write("nj_cities.geojson", places)
    time.sleep(1)

    print("[3/4] Block groups (TIGER, Essex + Camden + Passaic)")
    bg_where = " OR ".join(f"(STATE='34' AND COUNTY='{c}')" for c in sorted(set(COUNTY_FIPS.values())))
    fc = tiger("tigerWMS_ACS2023", 10, bg_where, "GEOID,STATE,COUNTY,TRACT,BLKGRP")
    bgs = fc.get("features", [])
    write("nj_blockgroups.geojson", bgs)

    print("[4/4] Summary")
    print(f"  wards={len(wards)}  places={len(places)}  blockgroups={len(bgs)}")
    print("\nDone.")


if __name__ == "__main__":
    main()
