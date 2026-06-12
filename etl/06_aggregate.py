"""
Aggregate ACS block-group data into:
  1. School Board District rollups (Broward)
  2. Drive-time rings around target schools (5/10/15 min)
  3. County rollups (for reference)

Since we're staying dependency-light, we implement point-in-polygon with a
pure-Python ray casting algorithm and use great-circle distance for drive-time
approximation (assume avg urban speed of 22 mph for conservative rings — close
to what ESRI's isochrones yield on Broward arterials).

Outputs:
  data/processed/sbd_rollup.json           {"1": {demographics...}, ...}
  data/processed/campus_rollup.json        {"Royal Palm Elementary": {"5min": {...}, ...}}
  data/processed/county_rollup.json        {"broward": {...}, "miamidade": {...}}
"""
import json, math, os
from collections import defaultdict

# ---------- geometry utilities ----------

def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersect = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi)
        if intersect:
            inside = not inside
        j = i
    return inside

def point_in_feature(pt, feature):
    """Supports Polygon and MultiPolygon."""
    g = feature.get("geometry") or {}
    t = g.get("type")
    coords = g.get("coordinates") or []
    if t == "Polygon":
        if not coords: return False
        outer = coords[0]
        if not point_in_ring(pt, outer): return False
        for hole in coords[1:]:
            if point_in_ring(pt, hole): return False
        return True
    if t == "MultiPolygon":
        for poly in coords:
            if not poly: continue
            outer = poly[0]
            if point_in_ring(pt, outer):
                for hole in poly[1:]:
                    if point_in_ring(pt, hole):
                        break
                else:
                    return True
        return False
    return False

def centroid(feature):
    g = feature["geometry"]; t = g["type"]; c = g["coordinates"]
    pts = []
    def add_ring(r): pts.extend(r)
    if t == "Polygon":
        for r in c: add_ring(r)
    elif t == "MultiPolygon":
        for poly in c:
            for r in poly: add_ring(r)
    if not pts: return None
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return (sum(xs)/len(xs), sum(ys)/len(ys))

def haversine_miles(a, b):
    R = 3958.8
    lat1, lng1 = math.radians(a[1]), math.radians(a[0])
    lat2, lng2 = math.radians(b[1]), math.radians(b[0])
    dlat = lat2 - lat1; dlng = lng2 - lng1
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2
    return 2 * R * math.asin(math.sqrt(h))

# ---------- demographic rollup ----------

SUM_FIELDS = [
    "pop_total", "pop_under5", "pop_5_9", "pop_10_14", "pop_15_17",
    "pop_k_4_est", "pop_5_8_est", "pop_9_12_est",
    "hh_total", "hh_under_50k", "hh_snap_recv",
    # 2025 + 2030 projections (from etl/13_projections_2030.py)
    "pop_total_2025", "pop_total_2030",
    "pop_k_4_est_2025", "pop_k_4_est_2030",
    "pop_5_8_est_2025", "pop_5_8_est_2030",
    "pop_9_12_est_2025", "pop_9_12_est_2030",
    "pop_black_2025", "pop_black_2030",
    "pop_hisp_2025", "pop_hisp_2030",
    "hh_under_50k_2025", "hh_under_50k_2030",
]

def empty_bucket():
    return {k: 0 for k in SUM_FIELDS} | {
        "pop_black_sum": 0, "pop_hisp_sum": 0,
        "hh_total_for_snap": 0, "hh_total_tenure": 0, "hh_owner": 0, "hh_renter": 0,
        "hh_total_type": 0, "hh_family": 0,
        "median_income_weighted_sum": 0, "median_income_weight": 0,
        "bg_count": 0,
    }

def accumulate(bucket, bg):
    for k in SUM_FIELDS:
        bucket[k] += (bg.get(k) or 0)
    # raw ACS variables (pre-derivation) also needed for accurate race/tenure %s
    bucket["pop_black_sum"] += (bg.get("pop_black_alone_all_ages") or 0)
    bucket["pop_hisp_sum"]  += (bg.get("pop_hispanic_all_ages") or 0)
    bucket["hh_total_for_snap"] += (bg.get("hh_total_for_snap") or 0)
    bucket["hh_total_tenure"] += (bg.get("hh_total_tenure") or 0)
    bucket["hh_owner"] += (bg.get("hh_owner") or 0)
    bucket["hh_renter"] += (bg.get("hh_renter") or 0)
    bucket["hh_total_type"] += (bg.get("hh_total_type") or 0)
    bucket["hh_family"]    += (bg.get("hh_family") or 0)
    # Median income: weight by HH count (imperfect but standard approximation)
    mi = bg.get("hh_median_income")
    if mi and mi > 0 and (bg.get("hh_total") or 0) > 0:
        bucket["median_income_weighted_sum"] += mi * bg["hh_total"]
        bucket["median_income_weight"]       += bg["hh_total"]
    bucket["bg_count"] += 1

def finalize(b):
    """Convert accumulator into reporting metrics."""
    out = {k: b[k] for k in SUM_FIELDS}
    out["bg_count"] = b["bg_count"]
    pop = b["pop_total"] or 0
    out["pct_black"]    = (b["pop_black_sum"] / pop) if pop else None
    out["pct_hispanic"] = (b["pop_hisp_sum"]  / pop) if pop else None
    out["pct_minority"] = ((b["pop_black_sum"] + b["pop_hisp_sum"]) / pop) if pop else None
    out["pct_hhi_u50"]  = (b["hh_under_50k"] / b["hh_total"]) if b["hh_total"] else None
    out["pct_snap"]     = (b["hh_snap_recv"] / b["hh_total_for_snap"]) if b["hh_total_for_snap"] else None
    out["pct_renter"]   = (b["hh_renter"]    / b["hh_total_tenure"]) if b["hh_total_tenure"] else None
    out["pct_family"]   = (b["hh_family"]    / b["hh_total_type"])   if b["hh_total_type"] else None
    out["hh_median_income_approx"] = ( (b["median_income_weighted_sum"] / b["median_income_weight"])
                                       if b["median_income_weight"] else None )
    # K-8 split
    k8 = (out["pop_k_4_est"] or 0) + (out["pop_5_8_est"] or 0)
    out["pop_k_8_est"] = k8

    # 5-year growth (2025 -> 2030) as percentage
    def growth(base_key):
        v25 = out.get(f"{base_key}_2025") or 0
        v30 = out.get(f"{base_key}_2030") or 0
        return ((v30 - v25) / v25) if v25 else None
    out["pop_growth_5yr"]    = growth("pop_total")
    out["k_4_growth_5yr"]    = growth("pop_k_4_est")
    out["5_8_growth_5yr"]    = growth("pop_5_8_est")
    out["9_12_growth_5yr"]   = growth("pop_9_12_est")
    out["black_growth_5yr"]  = growth("pop_black")
    out["hisp_growth_5yr"]   = growth("pop_hisp")
    out["hhi_u50_growth_5yr"]= growth("hh_under_50k")
    return out

# ---------- load data ----------
print("Loading...")
with open("data/processed/broward_blockgroups.geojson") as f: bg_broward = json.load(f)
with open("data/processed/miamidade_blockgroups.geojson") as f: bg_miami = json.load(f)
with open("data/processed/broward_sbd.geojson") as f:          sbd = json.load(f)
with open("data/processed/schools.geojson") as f:              schools = json.load(f)
with open("data/processed/acs_broward.json") as f:             acs_broward = json.load(f)
with open("data/processed/acs_miamidade.json") as f:           acs_miami   = json.load(f)

# Pre-compute block-group centroids
print("Computing BG centroids...")
bg_centroids = {}  # GEOID -> (lng, lat)
for src in (bg_broward, bg_miami):
    for feat in src["features"]:
        geoid = feat["properties"].get("GEOID")
        c = centroid(feat)
        if geoid and c:
            bg_centroids[geoid] = c

# ---------- 1. SBD rollup ----------
print("Rolling up to School Board Districts...")
sbd_buckets = defaultdict(empty_bucket)
sbd_bg_assignment = defaultdict(list)

for feat in sbd["features"]:
    d = feat["properties"]["district"]
    # iterate all Broward BGs and test containment by centroid
    for geoid, acs in acs_broward.items():
        c = bg_centroids.get(geoid)
        if not c: continue
        if point_in_feature(c, feat):
            accumulate(sbd_buckets[d], acs)
            sbd_bg_assignment[d].append(geoid)

sbd_rollup = {str(d): finalize(b) for d, b in sbd_buckets.items()}
# Compute "average" for comparison lines in the UI
avg = {}
keys = [k for k in next(iter(sbd_rollup.values())).keys()]
for k in keys:
    vals = [sbd_rollup[d].get(k) for d in sbd_rollup if sbd_rollup[d].get(k) is not None]
    if vals and isinstance(vals[0], (int, float)):
        avg[k] = sum(vals) / len(vals)
    else:
        avg[k] = None
sbd_rollup["_average"] = avg

with open("data/processed/sbd_rollup.json", "w") as f:
    json.dump(sbd_rollup, f, indent=2)
print(f"  -> data/processed/sbd_rollup.json  ({len([k for k in sbd_rollup if k!='_average'])} districts)")
def pct(v): return f"{v:.1%}" if v is not None else "  n/a"
def num(v): return f"{v:>8,}" if v is not None else "  n/a  "
for d in sorted(sbd_rollup):
    if d == "_average": continue
    r = sbd_rollup[d]
    print(f"     D{d}: pop={num(r['pop_total'])}  K-8≈{num(r['pop_k_8_est'])}  "
          f"%<$50k={pct(r['pct_hhi_u50'])}  %SNAP={pct(r['pct_snap'])}  "
          f"%Black={pct(r['pct_black'])}  %Hisp={pct(r['pct_hispanic'])}")

# Persist the BG→SBD assignment — app uses it for heatmap filtering later
with open("data/processed/bg_sbd_assignment.json", "w") as f:
    json.dump({d: gs for d, gs in sbd_bg_assignment.items()}, f)

# ---------- 2. Campus drive-time rings ----------
print("\nRolling up campus drive-time rings (great-circle approximation)...")
# 22 mph avg urban speed -> 5 min ≈ 1.83 mi, 10 min ≈ 3.67 mi, 15 min ≈ 5.50 mi
RINGS = [("5min", 1.83), ("10min", 3.67), ("15min", 5.50)]

campus_rollup = {}
# Combine both counties' ACS for campus rings (catchments can cross county lines)
all_acs = {**acs_broward, **acs_miami}

for sch in schools["features"]:
    name = sch["properties"]["name"]
    lng, lat = sch["geometry"]["coordinates"]
    entry = {"coordinates": [lng, lat], "rings": {}}
    for ring_name, miles in RINGS:
        bucket = empty_bucket()
        for geoid, acs in all_acs.items():
            c = bg_centroids.get(geoid)
            if not c: continue
            if haversine_miles(c, (lng, lat)) <= miles:
                accumulate(bucket, acs)
        entry["rings"][ring_name] = finalize(bucket)
        entry["rings"][ring_name]["radius_miles"] = miles
    campus_rollup[name] = entry
    r5 = entry["rings"]["5min"]
    print(f"  {name:35s} 5min: pop={num(r5['pop_total'])}  K-8≈{num(r5['pop_k_8_est'])}  "
          f"%<$50k={pct(r5['pct_hhi_u50'])}  %Black={pct(r5['pct_black'])}")

with open("data/processed/campus_rollup.json", "w") as f:
    json.dump(campus_rollup, f, indent=2)
print(f"  -> data/processed/campus_rollup.json  ({len(campus_rollup)} campuses)")

# ---------- 3. County rollups ----------
print("\nCounty rollups...")
county_rollup = {}
for label, acs in [("broward", acs_broward), ("miamidade", acs_miami)]:
    b = empty_bucket()
    for bg in acs.values():
        accumulate(b, bg)
    county_rollup[label] = finalize(b)

with open("data/processed/county_rollup.json", "w") as f:
    json.dump(county_rollup, f, indent=2)
for k, v in county_rollup.items():
    print(f"  {k}: pop={num(v['pop_total'])}  K-8≈{num(v['pop_k_8_est'])}  "
          f"%<$50k={pct(v['pct_hhi_u50'])}  %SNAP={pct(v['pct_snap'])}  "
          f"%Black={pct(v['pct_black'])}  %Hisp={pct(v['pct_hispanic'])}")

print("\n✓ All aggregations complete.")
