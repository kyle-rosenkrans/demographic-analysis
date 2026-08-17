"""
32_nj_schools_performance.py — NJ school points + 2024-25 NJSLA performance.

Reads the already-parsed NJSLA data from the sibling "NJSLA Explorer" project
rather than re-parsing 12 raw xlsx files, since that project's ETL already
normalizes subgroup names, geocodes every school, and (importantly) tags each
charter with the city it *physically* sits in — NJ DOE files bucket all charters
under a fake county "Charters", so physical city can't be read off the state
file directly.

NJSLA "2025" = the Spring 2025 administration = the **2024-25 school year**,
which is what we want.

KNOWN SOURCE LIMITATION (not a bug here): NJ DOE reports each charter as ONE
record per charter district. For multi-campus networks — TEAM Academy (7325),
North Star (7320), KIPP: Cooper Norcross (1799), Mastery Camden (1802) — that
single record is a network-wide aggregate sitting at the network's listed
address, not a campus. Crucially there is NO field that distinguishes those
from genuinely single-campus charters (Robert Treat, Roseville, …): both appear
as one district with one school code, in the assessment file *and* in the SPR
directory. So we deliberately do not tag individual schools as "network" — that
would mislabel the single-campus ones. Instead `tested_3_8` is carried through
(an implausibly large count for one campus is the tell) and the UI states the
reporting practice once. Per-campus charter results would require scraping
per-school NJ School Performance Reports.

Two further basis differences from Florida, surfaced in the UI:
  - Proficiency is % meeting/exceeding expectations (NJSLA levels 4-5) for
    grades 3-8, vs Florida's % scoring Level 3+.
  - Student demographics are shares of *tested* students (grades 3-8), because
    that's the only breakdown in the assessment file — Florida's come from a
    whole-school membership survey.
  - NJ has no statewide A-F school letter grade, so no grade/trend fields.
    Unlike Florida, NJ *does* publish students-with-disabilities, so ese_pct
    is populated here where the FL card shows "n/a".

Outputs (data/processed/):
  nj_schools.geojson           props: id,name,city,county,role,school_num,district_code,
                                      district_name,enrollment_2526,status,network_aggregate
  nj_school_performance.json   keyed by the same id as the geojson features
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")
NJSLA = os.path.join(os.path.dirname(ROOT), "NJSLA Explorer", "data", "processed")

CITY_KEY = {"Newark": "newark", "Camden": "camden", "Paterson": "paterson"}
CITY_PREFIX = {"newark": "NWK", "camden": "CAM", "paterson": "PAT"}
CITY_COUNTY = {"newark": "Essex", "camden": "Camden", "paterson": "Passaic"}

RACE_MAP = {
    "African American": "black", "Hispanic": "hispanic", "White": "white",
    "Asian": "asian", "American Indian": "amind", "Native Hawaiian": "pacific",
    "Other": "two_plus",
}
SUBGROUP_MAP = {
    "Economically Disadvantaged": "ed",
    "English Language Learners": "ell",
    "Students With Disabilities": "ese",
}


def load(name, base=NJSLA):
    path = os.path.join(base, name)
    if not os.path.exists(path):
        sys.exit(f"Missing {path}\n(Expected the NJSLA Explorer project alongside this one.)")
    with open(path) as f:
        return json.load(f)


def mean(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def weighted(pairs):
    """[(pct, weight)] -> weighted mean, ignoring rows with no weight."""
    num = den = 0.0
    for pct, w in pairs:
        if pct is None or not w:
            continue
        num += pct * w
        den += w
    return round(num / den, 1) if den else None


def main():
    meta = load("school_meta.json")
    coords = load("coords.json")
    directory = load("directory.json")
    recs = load("2025_long.json")["records"]

    # ---- which school keys are in our three cities ----
    targets = {}
    for k, m in meta.items():
        city = CITY_KEY.get(m.get("city"))
        if city:
            targets[k] = city
    print(f"[1/4] {len(targets)} schools in Newark/Camden/Paterson (per physical city)")

    # ---- gather NJSLA rows per school ----
    # per_school[key][subject][grade] = {'All Students': (prof, valid), subgroup: valid, ...}
    agg = {}
    names, dinfo = {}, {}
    for r in recs:
        if r.get("level") != "SCHOOL":
            continue
        key = f"{r['district_code']}|{r['school_code']}"
        if key not in targets:
            continue
        names[key] = r.get("school_name")
        dinfo[key] = (r.get("district_code"), r.get("district_name"))
        a = agg.setdefault(key, {"ELA": [], "Math": [], "race": {}, "sub": {}, "valid_total": 0})
        subj = r.get("subject")
        sgc, sg = r.get("subgroup_cat"), r.get("subgroup")
        valid = r.get("valid") or 0
        if sgc == "Total" and subj in ("ELA", "Math"):
            a[subj].append((r.get("prof"), valid))
            # Denominator for demographic shares: use ELA totals (one row per grade)
            if subj == "ELA":
                a["valid_total"] += valid
        elif sgc == "Race/Ethnicity" and subj == "ELA":
            f = RACE_MAP.get(sg)
            if f:
                a["race"][f] = a["race"].get(f, 0) + valid
        elif sgc == "Subgroup" and subj == "ELA":
            f = SUBGROUP_MAP.get(sg)
            if f:
                a["sub"][f] = a["sub"].get(f, 0) + valid

    print(f"[2/4] {len(agg)} of those have 2024-25 NJSLA grades 3-8 results")

    # ---- build features + performance records ----
    feats, perf = [], {}
    counts = {"newark": [0, 0], "camden": [0, 0], "paterson": [0, 0]}  # [district, charter]
    for key, city in sorted(targets.items()):
        dcode, scode = key.split("|")
        is_charter = bool(directory.get(key, {}).get("is_charter"))
        sid = f"{CITY_PREFIX[city]}-{dcode}{scode}"
        c = coords.get(key)
        if not c:
            continue
        a = agg.get(key)
        role = "charter" if is_charter else "district"
        counts[city][1 if is_charter else 0] += 1

        ela = weighted(a["ELA"]) if a else None
        math = weighted(a["Math"]) if a else None
        tested = (a or {}).get("valid_total") or None

        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(c[0], 6), round(c[1], 6)]},
            "properties": {
                "id": sid,
                "name": names.get(key) or directory.get(key, {}).get("name") or key,
                "city": city,
                "county": CITY_COUNTY[city],
                "role": role,
                "school_num": scode,
                "district_code": dcode,
                "district_name": (dinfo.get(key) or (None, None))[1],
                "gradespan": directory.get(key, {}).get("gradespan"),
                "status": "open",
                # Filled in by 33_nj_enrollment.py when real enrollment is available;
                # tested-count is a floor so bubbles still size sensibly meanwhile.
                "enrollment_2526": None,
                "tested_3_8": tested,
            },
        })

        if not a:
            continue
        total = a["valid_total"] or 0
        race = {k: v for k, v in a["race"].items() if v}
        race_pct = ({k: round(100.0 * v / total, 1) for k, v in race.items()} if total else None)
        pct = lambda f: (round(100.0 * a["sub"][f] / total, 1)
                         if total and a["sub"].get(f) is not None else None)
        perf[sid] = {
            "name": names.get(key),
            "charter": is_charter,
            "school_type": directory.get(key, {}).get("type"),
            "gradespan": directory.get(key, {}).get("gradespan"),
            "ela": ela, "math": math,
            "science": None, "social_studies": None,   # NJSLA science is a separate file/grades
            "ela_math": mean([ela, math]),
            "pct_tested": None,          # 'registered to test' isn't in the parsed extract
            "ed_pct": pct("ed"),
            "ell_pct": pct("ell"),
            "ese_pct": pct("ese"),       # NJ publishes this; FL does not
            "enrollment": total,         # tested students, grades 3-8
            "tested_3_8": total,
            "race_total": total,
            "race": race or None,
            "race_pct": race_pct,
            "data_year": 2025,           # NJSLA spring 2025 = 2024-25
            "assessment": "NJSLA",
        }

    os.makedirs(PROC, exist_ok=True)
    with open(os.path.join(PROC, "nj_schools.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    with open(os.path.join(PROC, "nj_school_performance.json"), "w") as f:
        json.dump(perf, f)

    print(f"[3/4] nj_schools.geojson: {len(feats)} schools")
    for city, (d, ch) in counts.items():
        print(f"       {city:9} district={d:3}  charter={ch}")
    print(f"[4/4] nj_school_performance.json: {len(perf)} schools with NJSLA results")
    withprof = sum(1 for v in perf.values() if v["ela_math"] is not None)
    print(f"       {withprof} with ELA+Math proficiency")
    big = sorted(((v.get("tested_3_8") or 0, v["name"]) for v in perf.values()
                  if v.get("charter")), reverse=True)[:5]
    print("       largest charter records by students tested (likely network aggregates):")
    for n, nm in big:
        print(f"         {n:>6}  {nm}")
    print("\nDone.")


if __name__ == "__main__":
    main()
