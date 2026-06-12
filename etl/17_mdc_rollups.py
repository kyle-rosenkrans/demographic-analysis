"""
Compute MDC-specific rollups, parallel to what etl/06_aggregate.py and
etl/10_assign_stepup_sbds.py already do for Broward.

Outputs:
  data/processed/miamidade_sbd_rollup.json       — ACS rollup per MDC SBD
  data/processed/stepup_mdc_sbd_rollup.json       — Step Up private school counts per MDC SBD
  data/processed/bg_mdc_sbd_assignment.json       — GEOID -> mdc_sbd
  data/processed/charter_operators_mdc.json       — major MDC charter operators

Reuses the point-in-polygon / centroid / finalize helpers from 06_aggregate.
"""
import json, math, re
from collections import defaultdict
from statistics import mean

# ---- helpers (duplicated from 06_aggregate so this script is independent) ----
def point_in_ring(pt, ring):
    x, y = pt; inside = False; n = len(ring); j = n - 1
    for i in range(n):
        xi, yi = ring[i]; xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-15) + xi):
            inside = not inside
        j = i
    return inside
def point_in_feature(pt, feat):
    g = feat["geometry"]; t = g["type"]; coords = g["coordinates"]
    if t == "Polygon":
        if not point_in_ring(pt, coords[0]): return False
        for hole in coords[1:]:
            if point_in_ring(pt, hole): return False
        return True
    if t == "MultiPolygon":
        for poly in coords:
            if poly and point_in_ring(pt, poly[0]): return True
        return False
    return False
def centroid(feat):
    g = feat["geometry"]; t = g["type"]; c = g["coordinates"]
    pts = []
    def add(r): pts.extend(r)
    if t == "Polygon":
        for r in c: add(r)
    elif t == "MultiPolygon":
        for poly in c:
            for r in poly: add(r)
    return (mean(p[0] for p in pts), mean(p[1] for p in pts)) if pts else None

SUM_FIELDS = [
    "pop_total","pop_under5","pop_5_9","pop_10_14","pop_15_17",
    "pop_k_4_est","pop_5_8_est","pop_9_12_est",
    "hh_total","hh_under_50k","hh_snap_recv",
    "pop_total_2025","pop_total_2030",
    "pop_k_4_est_2025","pop_k_4_est_2030",
    "pop_5_8_est_2025","pop_5_8_est_2030",
    "pop_9_12_est_2025","pop_9_12_est_2030",
    "pop_black_2025","pop_black_2030",
    "pop_hisp_2025","pop_hisp_2030",
    "hh_under_50k_2025","hh_under_50k_2030",
]
def empty_bucket():
    return {k: 0 for k in SUM_FIELDS} | {
        "pop_black_sum": 0, "pop_hisp_sum": 0,
        "hh_total_for_snap": 0, "hh_total_tenure": 0, "hh_owner": 0, "hh_renter": 0,
        "hh_total_type": 0, "hh_family": 0,
        "median_income_weighted_sum": 0, "median_income_weight": 0, "bg_count": 0,
    }
def accumulate(b, bg):
    for k in SUM_FIELDS: b[k] += (bg.get(k) or 0)
    b["pop_black_sum"] += (bg.get("pop_black_alone_all_ages") or 0)
    b["pop_hisp_sum"]  += (bg.get("pop_hispanic_all_ages") or 0)
    b["hh_total_for_snap"] += (bg.get("hh_total_for_snap") or 0)
    b["hh_total_tenure"]  += (bg.get("hh_total_tenure") or 0)
    b["hh_owner"]  += (bg.get("hh_owner") or 0)
    b["hh_renter"] += (bg.get("hh_renter") or 0)
    b["hh_total_type"] += (bg.get("hh_total_type") or 0)
    b["hh_family"]    += (bg.get("hh_family") or 0)
    mi = bg.get("hh_median_income")
    if mi and mi > 0 and (bg.get("hh_total") or 0) > 0:
        b["median_income_weighted_sum"] += mi * bg["hh_total"]
        b["median_income_weight"]       += bg["hh_total"]
    b["bg_count"] += 1
def finalize(b):
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
    out["pop_k_8_est"] = (out["pop_k_4_est"] or 0) + (out["pop_5_8_est"] or 0)
    def g(k):
        v25 = out.get(f"{k}_2025") or 0; v30 = out.get(f"{k}_2030") or 0
        return ((v30 - v25) / v25) if v25 else None
    out["pop_growth_5yr"]    = g("pop_total")
    out["k_4_growth_5yr"]    = g("pop_k_4_est")
    out["5_8_growth_5yr"]    = g("pop_5_8_est")
    out["9_12_growth_5yr"]   = g("pop_9_12_est")
    out["black_growth_5yr"]  = g("pop_black")
    out["hisp_growth_5yr"]   = g("pop_hisp")
    out["hhi_u50_growth_5yr"]= g("hh_under_50k")
    return out

# ---- load ----
print("Loading...")
with open("data/processed/miamidade_blockgroups.geojson") as f: bg = json.load(f)
with open("data/processed/miamidade_sbd.geojson") as f: sbd = json.load(f)
with open("data/processed/acs_miamidade.json") as f: acs = json.load(f)

print("BG centroids...")
bg_cent = {feat["properties"]["GEOID"]: centroid(feat)
           for feat in bg["features"] if centroid(feat)}

# ---- MDC SBD rollup ----
print("Rolling up to MDC SBDs...")
buckets = defaultdict(empty_bucket)
assignment = defaultdict(list)
for feat in sbd["features"]:
    d = feat["properties"]["district"]
    if d is None: continue
    for geoid, rec in acs.items():
        c = bg_cent.get(geoid)
        if not c: continue
        if point_in_feature(c, feat):
            accumulate(buckets[d], rec)
            assignment[d].append(geoid)
rollup = {str(d): finalize(b) for d, b in buckets.items()}
# Average
avg = {}
keys = list(next(iter(rollup.values())).keys())
for k in keys:
    vals = [rollup[d].get(k) for d in rollup if rollup[d].get(k) is not None]
    if vals and isinstance(vals[0], (int, float)):
        avg[k] = sum(vals)/len(vals)
    else:
        avg[k] = None
rollup["_average"] = avg
with open("data/processed/miamidade_sbd_rollup.json","w") as f:
    json.dump(rollup, f, indent=2)

def pct(v): return f"{v:.1%}" if v is not None else " n/a"
def num(v): return f"{v:>8,}" if v is not None else "   n/a"
print(f"  -> miamidade_sbd_rollup.json  ({len([k for k in rollup if k!='_average'])} districts)")
for d in sorted(rollup):
    if d == "_average": continue
    r = rollup[d]
    print(f"     D{d}: pop={num(r['pop_total'])}  K-8≈{num(r['pop_k_8_est'])}  "
          f"%<$50k={pct(r['pct_hhi_u50'])}  %SNAP={pct(r['pct_snap'])}  "
          f"%Black={pct(r['pct_black'])}  %Hisp={pct(r['pct_hispanic'])}")
with open("data/processed/bg_mdc_sbd_assignment.json","w") as f:
    json.dump({str(d): gs for d, gs in assignment.items()}, f)

# ---- Step Up MDC → MDC SBDs ----
print("\nAssigning Step Up (MDC) to MDC SBDs...")
with open("data/processed/stepup_schools.geojson") as f: stepup = json.load(f)
mdc_stepup_rollup = {str(d): {"n":0, "k8":0, "total":0, "schools":[]} for d in range(1,10)}
for feat in stepup["features"]:
    p = feat["properties"]
    if p["county"] != "miamidade": continue
    pt = tuple(feat["geometry"]["coordinates"])
    assigned = None
    for sfeat in sbd["features"]:
        d = sfeat["properties"]["district"]
        if d is not None and point_in_feature(pt, sfeat):
            assigned = d; break
    feat["properties"]["mdc_sbd"] = assigned
    if assigned is not None:
        mdc_stepup_rollup[str(assigned)]["n"] += 1
        mdc_stepup_rollup[str(assigned)]["k8"] += p["enroll_k8"]
        mdc_stepup_rollup[str(assigned)]["total"] += p["enroll_total"]
# Save updated stepup geojson with mdc_sbd tags
with open("data/processed/stepup_schools.geojson","w") as f:
    json.dump(stepup, f)
with open("data/processed/stepup_mdc_sbd_rollup.json","w") as f:
    json.dump(mdc_stepup_rollup, f, indent=2)
print("Per-MDC-SBD Step Up:")
print(f"{'Dist':>6} {'#':>4} {'K-8':>7} {'Total':>7}")
for d in ["1","2","3","4","5","6","7","8","9"]:
    r = mdc_stepup_rollup[d]
    print(f"  D{d:>2}   {r['n']:>4} {r['k8']:>7} {r['total']:>7}")

# ---- MDC Charter Operators ----
# MDC numbering doesn't follow Broward's ">=5000 means charter" convention.
# Use the canonical charter list from Miami-Dade GIS (`role=="charter"` in
# miamidade_schools.geojson) to identify charters, then lookup their FL DOE
# enrollment by composite (13, loc_no) key.
print("\nMDC charter operators (canonical list from MDC GIS)...")
with open("data/processed/fldoe_enrollment_by_school.json") as f: enroll_all = json.load(f)
with open("data/processed/miamidade_schools.geojson") as f: mdc_sch_fc = json.load(f)
charter_locs = set()
for f in mdc_sch_fc["features"]:
    if f["properties"].get("role") == "charter" and f["properties"].get("loc_no"):
        charter_locs.add(f["properties"]["loc_no"])
mdc_enroll = {k: r for k, r in enroll_all.items()
              if k.startswith("13-") and k.split("-",1)[1] in charter_locs}
print(f"  MDC charter schools found with enrollment: {len(mdc_enroll)} / {len(charter_locs)} in GIS")
YEARS = ["2122","2223","2324","2425","2526"]

# MDC charter operator patterns
MDC_OPS = [
    ("Somerset Academy",         [r"somerset"]),
    ("Academica / Mater",        [r"\bmater\b", r"bridgeprep", r"doral academy"]),
    ("Charter Schools USA",      [r"\brenaissance charter\b"]),
    ("Mavericks / Pinecrest",    [r"pinecrest"]),
    ("International Studies",    [r"international studies"]),
]
def find_op(name):
    low = name.lower()
    for op, pats in MDC_OPS:
        for p in pats:
            if re.search(p, low):
                return op
    return "Other / Independent"

op_year = {op: {y: 0 for y in YEARS} for op, _ in MDC_OPS}
op_year["Other / Independent"] = {y: 0 for y in YEARS}
op_counts = {op: 0 for op in op_year}
for sn, rec in mdc_enroll.items():
    op = find_op(rec["name"])
    rec["operator"] = op
    op_counts[op] += 1
    for y in YEARS:
        op_year[op][y] += rec["years"].get(y, {}).get("total", 0)
totals = {y: sum(op_year[op][y] for op in op_year) for y in YEARS}
report = {"operators": {}, "totals": totals}
for op, counts in op_year.items():
    dn = counts[YEARS[-1]] - counts[YEARS[0]]
    dp = (dn / counts[YEARS[0]]) if counts[YEARS[0]] else None
    shares = {y: counts[y]/totals[y] if totals[y] else 0 for y in YEARS}
    report["operators"][op] = {
        "n_schools": op_counts[op],
        "enrollment": counts,
        "market_share": shares,
        "change_5yr_n": dn,
        "change_5yr_pct": dp,
    }
print(f"{'Operator':28s} | {'N':>3s} | " + " | ".join(y for y in YEARS) + f" | {'Share':>6s}")
for op in op_year:
    r = report["operators"][op]
    e = r["enrollment"]
    print(f"{op:28s} | {r['n_schools']:>3d} | " + " | ".join(f"{e[y]:>5,d}" for y in YEARS) + f" | {r['market_share'][YEARS[-1]]*100:>5.1f}%")
print(f"{'TOTAL':28s} |     | " + " | ".join(f"{totals[y]:>5,d}" for y in YEARS))
with open("data/processed/charter_operators_mdc.json","w") as f:
    json.dump(report, f, indent=2)
print("-> data/processed/charter_operators_mdc.json")
