"""
Geocode Step Up schools using the Census batch geocoder (free, 10k addresses per call).
Input:  data/processed/stepup_schools.json
Output: data/processed/stepup_schools.geojson (with lng/lat), data/processed/stepup_geocode_cache.json
"""
import json, os, csv, io, urllib.request, urllib.parse, time

BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
CHUNK = 500  # Census recommends <=10000; 500 keeps response fast & retries cheap

CACHE = "data/processed/stepup_geocode_cache.json"
cache = {}
if os.path.exists(CACHE):
    with open(CACHE) as f: cache = json.load(f)

with open("data/processed/stepup_schools.json") as f:
    schools = json.load(f)
print(f"{len(schools)} schools, {len(cache)} already cached")

todo = []
for i, s in enumerate(schools):
    key = f"{s.get('address','')}|{s.get('city','')}|{s.get('state','')}|{s.get('zip','')}"
    if key in cache: continue
    todo.append((i, key, s))

print(f"{len(todo)} to geocode")

def census_batch(addresses):
    """addresses: list of (id, street, city, state, zip). Returns dict id -> (lng, lat) or None."""
    buf = io.StringIO()
    w = csv.writer(buf)
    for idx, street, city, state, zipc in addresses:
        w.writerow([idx, street, city, state, zipc])
    body = buf.getvalue().encode()
    # Multipart form upload
    boundary = "----kipp-" + str(int(time.time()))
    lines = []
    lines.append(f"--{boundary}")
    lines.append('Content-Disposition: form-data; name="addressFile"; filename="addr.csv"')
    lines.append("Content-Type: text/csv")
    lines.append("")
    lines.append(body.decode())
    lines.append(f"--{boundary}")
    lines.append('Content-Disposition: form-data; name="benchmark"')
    lines.append("")
    lines.append("Public_AR_Current")
    lines.append(f"--{boundary}--")
    data = "\r\n".join(lines).encode("utf-8")
    req = urllib.request.Request(BATCH_URL, data=data, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        text = r.read().decode()
    out = {}
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if not row: continue
        idx = row[0]
        match = row[2] if len(row) > 2 else ""
        if match == "Match" and len(row) > 5:
            # row[5] is "lng,lat"
            try:
                lng, lat = row[5].split(",")
                out[idx] = (float(lng), float(lat))
            except Exception:
                out[idx] = None
        else:
            out[idx] = None
    return out

# Chunk and send
for i in range(0, len(todo), CHUNK):
    chunk = todo[i:i+CHUNK]
    batch_rows = []
    for idx, key, s in chunk:
        batch_rows.append((str(idx), s["address"], s["city"], s["state"], s["zip"]))
    print(f"batch {i}..{i+len(chunk)}")
    try:
        results = census_batch(batch_rows)
    except Exception as e:
        print(f"  batch failed: {e}")
        continue
    for idx_str, latlng in results.items():
        idx = int(idx_str)
        key = f"{schools[idx].get('address','')}|{schools[idx].get('city','')}|{schools[idx].get('state','')}|{schools[idx].get('zip','')}"
        cache[key] = latlng
    # flush cache every batch
    with open(CACHE, "w") as f:
        json.dump(cache, f)
    time.sleep(0.5)

# Build GeoJSON
features = []
hits = 0
for s in schools:
    key = f"{s.get('address','')}|{s.get('city','')}|{s.get('state','')}|{s.get('zip','')}"
    c = cache.get(key)
    if not c: continue
    hits += 1
    features.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": list(c)},
        "properties": s,
    })
out = "data/processed/stepup_schools.geojson"
with open(out, "w") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f)
print(f"Geocoded {hits}/{len(schools)} -> {out}")
