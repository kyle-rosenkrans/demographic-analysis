"""
Assign geocoded Step Up private schools to Broward School Board Districts
via point-in-polygon. Roll up per-SBD counts and compare to InSite slide 21.
"""
import json

def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]; xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi):
            inside = not inside
        j = i
    return inside

def point_in_feature(pt, feature):
    g = feature["geometry"]; t = g["type"]; coords = g["coordinates"]
    if t == "Polygon":
        if not point_in_ring(pt, coords[0]): return False
        for hole in coords[1:]:
            if point_in_ring(pt, hole): return False
        return True
    if t == "MultiPolygon":
        for poly in coords:
            if poly and point_in_ring(pt, poly[0]):
                return True
        return False
    return False

with open("data/processed/stepup_schools.geojson") as f: stepup = json.load(f)
with open("data/processed/broward_sbd.geojson") as f: sbd = json.load(f)

rollup = {str(d): {"n": 0, "k8": 0, "total": 0, "schools": []} for d in range(1,8)}
rollup["miamidade"] = {"n": 0, "k8": 0, "total": 0, "schools": []}

for feat in stepup["features"]:
    pt = tuple(feat["geometry"]["coordinates"])
    p = feat["properties"]
    if p["county"] == "miamidade":
        rollup["miamidade"]["n"] += 1
        rollup["miamidade"]["k8"] += p["enroll_k8"]
        rollup["miamidade"]["total"] += p["enroll_total"]
        feat["properties"]["sbd"] = None
        continue
    # Broward — assign to SBD
    assigned = None
    for sfeat in sbd["features"]:
        d = sfeat["properties"]["district"]
        if point_in_feature(pt, sfeat):
            assigned = d; break
    feat["properties"]["sbd"] = assigned
    if assigned is not None:
        rollup[str(assigned)]["n"] += 1
        rollup[str(assigned)]["k8"] += p["enroll_k8"]
        rollup[str(assigned)]["total"] += p["enroll_total"]

# Save with sbd assignment
with open("data/processed/stepup_schools.geojson","w") as f:
    json.dump(stepup, f)

print("Per-SBD Step Up (private schools) rollup:")
print(f"{'Dist':>6}  {'#':>4}  {'K-8':>7}  {'Total':>7}")
total = {"n":0,"k8":0,"t":0}
for d in ["1","2","3","4","5","6","7"]:
    r = rollup[d]
    print(f"  D{d:>2}   {r['n']:>4}  {r['k8']:>7}  {r['total']:>7}")
    total["n"] += r["n"]; total["k8"] += r["k8"]; total["t"] += r["total"]
print(f"  ----  {total['n']:>4}  {total['k8']:>7}  {total['t']:>7}  (Broward total — InSite: 245 / 29,801 / 48,328)")
print(f"  MDC   {rollup['miamidade']['n']:>4}  {rollup['miamidade']['k8']:>7}  {rollup['miamidade']['total']:>7}")

# Save rollup
with open("data/processed/stepup_sbd_rollup.json","w") as f:
    json.dump(rollup, f, indent=2)
