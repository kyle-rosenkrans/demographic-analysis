"""
18b_rings_incremental.py
Compute rings ONLY for schools in universal_schools.geojson that don't yet
have an entry in universal_rings.json. Merges and saves.
"""
import json, math
from statistics import mean

def haversine_miles(a, b):
    R = 3958.8
    lat1, lng1 = math.radians(a[1]), math.radians(a[0])
    lat2, lng2 = math.radians(b[1]), math.radians(b[0])
    dlat = lat2 - lat1; dlng = lng2 - lng1
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2
    return 2 * R * math.asin(math.sqrt(h))

def centroid(feature):
    g = feature["geometry"]; t = g["type"]; c = g["coordinates"]
    pts = []
    if t == "Polygon":
        for r in c: pts.extend(r)
    elif t == "MultiPolygon":
        for poly in c:
            for r in poly: pts.extend(r)
    if not pts: return None
    return (mean(p[0] for p in pts), mean(p[1] for p in pts))

RINGS = [("5min", 1.83), ("10min", 3.67), ("15min", 5.50)]
SUM_FIELDS = [
    "pop_total","pop_k_4_est","pop_5_8_est","pop_9_12_est",
    "hh_total","hh_under_50k","hh_snap_recv",
]

def empty_bucket():
    return {k: 0 for k in SUM_FIELDS} | {
        "pop_black_sum": 0, "pop_hisp_sum": 0,
        "hh_total_for_snap": 0,
        "median_income_weighted_sum": 0, "median_income_weight": 0, "bg_count": 0,
    }
def accumulate(b, bg):
    for k in SUM_FIELDS: b[k] += (bg.get(k) or 0)
    b["pop_black_sum"]    += (bg.get("pop_black_alone_all_ages") or 0)
    b["pop_hisp_sum"]     += (bg.get("pop_hispanic_all_ages") or 0)
    b["hh_total_for_snap"]+= (bg.get("hh_total_for_snap") or 0)
    mi = bg.get("hh_median_income")
    if mi and mi > 0 and (bg.get("hh_total") or 0) > 0:
        b["median_income_weighted_sum"] += mi * bg["hh_total"]
        b["median_income_weight"]       += bg["hh_total"]
    b["bg_count"] += 1

def finalize(b, mi_radius):
    out = {k: b[k] for k in SUM_FIELDS}
    out["bg_count"] = b["bg_count"]
    out["radius_miles"] = mi_radius
    pop = b["pop_total"] or 0
    out["pct_black"]    = (b["pop_black_sum"] / pop) if pop else None
    out["pct_hispanic"] = (b["pop_hisp_sum"]  / pop) if pop else None
    out["pct_minority"] = ((b["pop_black_sum"] + b["pop_hisp_sum"]) / pop) if pop else None
    out["pct_hhi_u50"]  = (b["hh_under_50k"] / b["hh_total"]) if b["hh_total"] else None
    out["pct_snap"]     = (b["hh_snap_recv"] / b["hh_total_for_snap"]) if b["hh_total_for_snap"] else None
    out["hh_median_income_approx"] = (
        (b["median_income_weighted_sum"] / b["median_income_weight"])
        if b["median_income_weight"] else None
    )
    out["pop_k_8_est"] = (out["pop_k_4_est"] or 0) + (out["pop_5_8_est"] or 0)
    return out

# ── Load data ─────────────────────────────────────────────────────────────────
print("Loading data files...")
with open("data/processed/universal_schools.geojson") as f: schools = json.load(f)
with open("data/processed/universal_rings.json") as f: existing_rings = json.load(f)
with open("data/processed/broward_blockgroups.geojson") as f: bg_brow = json.load(f)
with open("data/processed/miamidade_blockgroups.geojson") as f: bg_mia = json.load(f)
with open("data/processed/acs_broward.json") as f: acs_brow = json.load(f)
with open("data/processed/acs_miamidade.json") as f: acs_mia = json.load(f)
all_acs = {**acs_brow, **acs_mia}

# Only process schools missing from rings
new_schools = [s for s in schools["features"] if s["properties"]["id"] not in existing_rings]
print(f"Schools already in rings: {len(existing_rings)}")
print(f"New schools to process:   {len(new_schools)}")

if not new_schools:
    print("Nothing to do.")
    exit(0)

# Pre-compute BG centroids
print("Pre-computing BG centroids...")
bg_centroids = {}
for src in (bg_brow, bg_mia):
    for feat in src["features"]:
        g = feat["properties"].get("GEOID")
        c = centroid(feat)
        if g and c: bg_centroids[g] = c

# Compute rings for new schools only
print(f"Computing rings for {len(new_schools)} new schools...")
MAX_RADIUS = max(m for _, m in RINGS) + 0.2
added = 0
skipped = 0

for i, sch in enumerate(new_schools):
    sid = sch["properties"]["id"]
    coord = sch["geometry"]["coordinates"]
    near = [(geoid, c, haversine_miles(c, coord)) for geoid, c in bg_centroids.items()
            if haversine_miles(c, coord) <= MAX_RADIUS]
    if not near:
        skipped += 1
        continue
    entry = {"rings": {}}
    for name, radius in RINGS:
        bucket = empty_bucket()
        for geoid, c, d in near:
            if d <= radius:
                rec = all_acs.get(geoid)
                if rec: accumulate(bucket, rec)
        entry["rings"][name] = finalize(bucket, radius)
    existing_rings[sid] = entry
    added += 1
    if (i+1) % 50 == 0:
        print(f"  {i+1}/{len(new_schools)} ...")

print(f"\nAdded rings for {added} schools ({skipped} skipped — outside BG coverage)")
print(f"Total rings: {len(existing_rings)}")

with open("data/processed/universal_rings.json", "w") as f:
    json.dump(existing_rings, f)
print("Saved → data/processed/universal_rings.json")
