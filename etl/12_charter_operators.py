"""
Identify Broward charter schools (school# >= 5000) and tag major operators
(Somerset, CSUSA, Franklin, Imagine, Pembroke Pines). Roll up 5-year enrollment
and market-share per operator. Mirrors InSite slide 20.
"""
import json, re

YEARS = ["2122","2223","2324","2425","2526"]
OPERATORS = [
    ("Somerset Academy",       [r"somerset"]),
    # CSUSA also manages Coral Springs Charter and North Broward Academy of Excellence.
    ("Charter Schools USA",    [r"\brenaissance charter\b",
                                r"coral springs charter",
                                r"north broward academy"]),
    ("Franklin Academy",       [r"franklin academy"]),
    ("Imagine Schools",        [r"\bimagine\b"]),
    ("Pembroke Pines Charter", [r"pembroke pines charter", r"city/pembroke pines"]),
]

with open("data/processed/fldoe_enrollment_by_school.json") as f:
    d = json.load(f)

# Composite keys are "DD-SSSS". Broward charters: district 06 + school_num >= 5000
def is_broward_charter(key):
    if not key.startswith("06-"): return False
    try:
        return int(key.split("-", 1)[1]) >= 5000
    except ValueError:
        return False

charters = {sn: rec for sn, rec in d.items() if is_broward_charter(sn)}
print(f"Broward charter schools found: {len(charters)}")

# Tag each with its operator (or 'other')
def find_op(name):
    low = name.lower()
    for op, pats in OPERATORS:
        for p in pats:
            if re.search(p, low):
                return op
    return "Other / Independent"

for sn, rec in charters.items():
    rec["operator"] = find_op(rec["name"])

# Rollup by operator and year
op_year = {op: {y: 0 for y in YEARS} for op, _ in OPERATORS}
op_year["Other / Independent"] = {y: 0 for y in YEARS}
op_counts = {op: 0 for op in op_year}
for rec in charters.values():
    op = rec["operator"]
    op_counts[op] += 1
    for y in YEARS:
        op_year[op][y] += rec["years"].get(y, {}).get("total", 0)

# District charter totals
charter_totals = {y: sum(op_year[op][y] for op in op_year) for y in YEARS}

# Compute market share within charters
report = {"operators": {}, "totals": charter_totals}
for op, counts in op_year.items():
    delta_n = counts[YEARS[-1]] - counts[YEARS[0]]
    delta_pct = (delta_n / counts[YEARS[0]]) if counts[YEARS[0]] else None
    shares = {y: counts[y] / charter_totals[y] if charter_totals[y] else 0 for y in YEARS}
    report["operators"][op] = {
        "n_schools": op_counts[op],
        "enrollment": counts,
        "market_share": shares,
        "change_5yr_n": delta_n,
        "change_5yr_pct": delta_pct,
    }

# Console report
print(f"\n{'Operator':28s} | {'N':>3s} | " + " | ".join(f"{y[:2]}-{y[2:]}" for y in YEARS) + f" | {'Δ':>7s}  {'Share':>6s}")
print("-"*110)
for op in list(op_year.keys()):
    r = report["operators"][op]
    e = r["enrollment"]
    print(f"{op:28s} | {r['n_schools']:>3d} | " + " | ".join(f"{e[y]:>5,d}" for y in YEARS) +
          f" | {r['change_5yr_n']:>+6,d}  {r['market_share'][YEARS[-1]]*100:>5.1f}%")
print("-"*110)
tot = charter_totals
print(f"{'TOTAL CHARTER':28s} |     | " + " | ".join(f"{tot[y]:>5,d}" for y in YEARS))

with open("data/processed/charter_operators.json","w") as f:
    json.dump(report, f, indent=2)
print("\n-> data/processed/charter_operators.json")

# Also save per-school charter list with operator tag for the map
out_schools = []
for sn, rec in charters.items():
    out_schools.append({
        "school_num": sn,
        "name": rec["name"],
        "operator": rec["operator"],
        "enrollment": rec["years"].get("2526",{}).get("total", 0),
    })
with open("data/processed/charter_schools.json","w") as f:
    json.dump(out_schools, f, indent=2)
