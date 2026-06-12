"""
19_dedup_and_close.py
1. Remove duplicate features from universal_schools.geojson (same ID appearing twice).
   For HIVE (MDC-1014), legitimately two campuses → assign MDC-1014B to the satellite.
2. Mark closed schools (had enrollment in 2122/2223 but none in 2324/2425/2526).
3. Update universal_rings.json: copy MDC-1014 ring to MDC-1014B.
"""
import json, math, pathlib

ROOT = pathlib.Path(__file__).parent.parent
PROC = ROOT / "data" / "processed"

with open(PROC / "universal_schools.geojson") as f:
    univ = json.load(f)
with open(PROC / "fldoe_enrollment_by_school.json") as f:
    enroll = json.load(f)
with open(PROC / "universal_rings.json") as f:
    rings = json.load(f)

feats = univ["features"]
print(f"Input: {len(feats)} features")

# ── 1. Identify duplicates by ID ──────────────────────────────────────────────
from collections import defaultdict
id_groups = defaultdict(list)
for i, f in enumerate(feats):
    id_groups[f["properties"]["id"]].append(i)

dupe_ids = {k: v for k, v in id_groups.items() if len(v) > 1}
print(f"IDs with multiple features: {len(dupe_ids)}")
for k, idxs in sorted(dupe_ids.items()):
    names = [feats[i]["properties"].get("name","?") for i in idxs]
    print(f"  {k}: {names}")

# ── 2. Resolve duplicates ──────────────────────────────────────────────────────
def haversine_miles(a, b):
    R = 3958.8
    dlat = math.radians(b[1]-a[1])
    dlng = math.radians(b[0]-a[0])
    x = math.sin(dlat/2)**2 + math.cos(math.radians(a[1]))*math.cos(math.radians(b[1]))*math.sin(dlng/2)**2
    return 2*R*math.asin(math.sqrt(x))

to_remove = set()       # indices to drop
id_renames = {}         # old_id → new_id for satellites

for uid, idxs in dupe_ids.items():
    if uid == "MDC-1014":
        # Two legitimate campuses: primary gets MDC-1014, satellite gets MDC-1014B
        # Primary = the one whose name is shorter / more canonical (no "Advance Learning")
        primary_idx = next((i for i in idxs if "advance" not in feats[i]["properties"].get("name","").lower()), idxs[0])
        for i in idxs:
            if i != primary_idx:
                id_renames[i] = "MDC-1014B"
        print(f"  MDC-1014: kept primary index {primary_idx}, renamed satellite to MDC-1014B")
    else:
        # For all other dupes: keep the first one, drop the rest
        for i in idxs[1:]:
            to_remove.add(i)

print(f"\nRemoving {len(to_remove)} exact-duplicate features")
print(f"Renaming {len(id_renames)} satellite features")

# ── 3. Identify closed schools ────────────────────────────────────────────────
def get_enroll_key(props):
    county = props.get("county", "")
    school_num = props.get("school_num", "")
    if not school_num:
        return None
    prefix = "13" if county == "miamidade" else "06"
    return f"{prefix}-{school_num}"

closed_ids = set()
for feat in feats:
    p = feat["properties"]
    key = p.get("enroll_key") or get_enroll_key(p)
    if not key:
        continue
    e = enroll.get(key)
    if not e or not e.get("years"):
        continue
    yrs = e["years"]
    # Has historical data
    has_history = any(yrs.get(y, {}).get("total", 0) > 0 for y in ["2122", "2223"])
    # Missing all recent years
    has_recent = any(yrs.get(y, {}).get("total", 0) > 0 for y in ["2324", "2425", "2526"])
    if has_history and not has_recent:
        closed_ids.add(p["id"])

print(f"\nClosed schools identified: {len(closed_ids)}")
for cid in sorted(closed_ids):
    feat = next(f for f in feats if f["properties"]["id"] == cid)
    print(f"  {cid}: {feat['properties'].get('name','?')}")

# ── 4. Build cleaned feature list ────────────────────────────────────────────
new_feats = []
for i, feat in enumerate(feats):
    if i in to_remove:
        continue
    p = feat["properties"].copy()
    if i in id_renames:
        p["id"] = id_renames[i]
        p["name"] = p["name"] + " (Campus 2)"  # distinguish in picker
    if p["id"] in closed_ids:
        p["status"] = "closed"
    feat = {**feat, "properties": p}
    new_feats.append(feat)

print(f"\nOutput: {len(new_feats)} features")

univ["features"] = new_feats
with open(PROC / "universal_schools.geojson", "w") as f:
    json.dump(univ, f)
print(f"Saved → universal_schools.geojson")

# ── 5. Update rings: copy MDC-1014 entry to MDC-1014B ─────────────────────────
if "MDC-1014" in rings and "MDC-1014B" not in rings:
    # MDC-1014B is a satellite campus at a different location — ideally we'd recompute.
    # For now copy the primary's rings as an approximation (they're 0.44mi apart).
    rings["MDC-1014B"] = rings["MDC-1014"]
    with open(PROC / "universal_rings.json", "w") as f:
        json.dump(rings, f)
    print("Updated universal_rings.json — MDC-1014B gets MDC-1014 ring (0.44mi apart)")
print("Done.")
