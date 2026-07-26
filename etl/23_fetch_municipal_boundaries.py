"""
Fetch incorporated municipal boundaries (city/town/village limits) for
Broward, Miami-Dade, and Orange counties from the Census TIGERweb REST API
(free, no key) — layer 28 "Incorporated Places".

Places aren't a sub-county Census geography (a place has no COUNTY field —
it's independent of county lines), so we fetch every incorporated place in
Florida once, then assign each to one of our three counties by testing its
Census-standard internal point (INTPTLAT/INTPTLON — guaranteed to fall
inside the place's own polygon) against the county boundary polygons we
already have in data/processed/{counties,orange_county}.geojson. This is
the same point-in-polygon assignment pattern used elsewhere in this ETL
(e.g. etl/10_assign_stepup_sbds.py for Step Up schools -> SBDs).

Outputs (props: name, geoid, county):
  data/processed/broward_places.geojson
  data/processed/miamidade_places.geojson
  data/processed/orange_places.geojson
"""
import json, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROC = os.path.join(ROOT, "data", "processed")
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
UA = {"User-Agent": "kipp-demographics-etl/1.0"}


def tiger_geojson(service, layer, where, fields="*"):
    url = (f"{TIGER}/{service}/MapServer/{layer}/query?"
           f"where={urllib.parse.quote(where)}&outFields={urllib.parse.quote(fields)}"
           "&f=geojson&outSR=4326&returnGeometry=true")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            x_intersect = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < x_intersect:
                inside = not inside
        j = i
    return inside


def point_in_geometry(lng, lat, geometry):
    t = geometry.get("type")
    coords = geometry.get("coordinates")

    def in_rings(rings):
        if not rings or not point_in_ring(lng, lat, rings[0]):
            return False
        return not any(point_in_ring(lng, lat, hole) for hole in rings[1:])

    if t == "Polygon":
        return in_rings(coords)
    if t == "MultiPolygon":
        return any(in_rings(poly) for poly in coords)
    return False


def load_county_polygon(path):
    with open(os.path.join(PROC, path)) as f:
        fc = json.load(f)
    # Counties may be split into multiple TIGER features (rare slivers); any match counts.
    return [f["geometry"] for f in fc["features"]]


def main():
    print("[1/2] Fetching all Florida incorporated places (TIGERweb layer 28)...")
    fc = tiger_geojson(
        "tigerWMS_Current", 28, "STATE='12'",
        "GEOID,STATE,PLACE,BASENAME,NAME,LSADC,FUNCSTAT,INTPTLAT,INTPTLON",
    )
    all_places = fc.get("features", [])
    print(f"  {len(all_places)} incorporated places statewide")

    counties = load_county_polygon("counties.geojson")     # Broward + Miami-Dade
    broward_geoms = [g for g in counties]  # both counties share one file; split below by containment test only
    orange_geoms = load_county_polygon("orange_county.geojson")

    # counties.geojson mixes Broward + Miami-Dade — test against each feature's own
    # properties instead of a merged blob so we assign to the right one.
    with open(os.path.join(PROC, "counties.geojson")) as f:
        counties_fc = json.load(f)
    broward_geom = next(f["geometry"] for f in counties_fc["features"] if f["properties"]["COUNTY"] == "011")
    miamidade_geom = next(f["geometry"] for f in counties_fc["features"] if f["properties"]["COUNTY"] == "086")
    orange_geom = orange_geoms[0]

    buckets = {"broward": [], "miamidade": [], "orange": []}
    for f in all_places:
        p = f.get("properties", {}) or {}
        try:
            lat = float(p.get("INTPTLAT"))
            lng = float(p.get("INTPTLON"))
        except (TypeError, ValueError):
            continue
        name = p.get("BASENAME") or p.get("NAME")
        geoid = p.get("GEOID")
        feature = {
            "type": "Feature",
            "properties": {"name": name, "geoid": geoid},
            "geometry": f.get("geometry"),
        }
        if point_in_geometry(lng, lat, broward_geom):
            feature["properties"]["county"] = "broward"
            buckets["broward"].append(feature)
        elif point_in_geometry(lng, lat, miamidade_geom):
            feature["properties"]["county"] = "miamidade"
            buckets["miamidade"].append(feature)
        elif point_in_geometry(lng, lat, orange_geom):
            feature["properties"]["county"] = "orange"
            buckets["orange"].append(feature)

    print("[2/2] Writing per-county files...")
    for key, out_name in [("broward", "broward_places.geojson"),
                          ("miamidade", "miamidade_places.geojson"),
                          ("orange", "orange_places.geojson")]:
        feats = sorted(buckets[key], key=lambda f: f["properties"]["name"] or "")
        out_path = os.path.join(PROC, out_name)
        with open(out_path, "w") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f)
        print(f"  {out_name}: {len(feats)} municipalities")

    print("\nDone.")


if __name__ == "__main__":
    main()
