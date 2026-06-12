"""
Build per-school performance + demographics, keyed to join the web app's
universal_schools / enrollment data.

Inputs (data/raw/):
  fldoe_school_performance_raw.json   REQUIRED. Pulled from FL DOE:
      - School Grades 2024-25  (SchoolGrades25.xlsx): proficiency by subject
        (% Level 3+), letter-grade history, charter flag, % econ-disadvantaged
      - Membership by School by Race/Ethnicity 2025-26 S2 (race composition + total)
      - ELL by School 2025-26 S2 (ELL counts)
  ese_by_school.json                  OPTIONAL. Per-school SpEd/ESE rate
      (e.g., NCES/CRDC export, or a Know Your Schools crosstab converted to JSON).
      Expected shape: { "<district>-<school_num>": <ese_pct float>, ... }
      or a list of {district, school_num, ese_pct}. Missing -> ese_pct = null.

Output (data/processed/):
  school_performance.json
      Dict keyed by "<district>-<school_num>" (e.g. "06-0011" / "13-7121"),
      matching the enroll_key pattern used in web/campus.js so the web app can
      look up performance for any focused school and join it onto the
      universal_schools map features.

Each record:
  {
    "name", "charter" (bool), "title1" (bool), "school_type",
    "ela", "math", "science", "social_studies",   # % scoring Level 3+ (0-100)
    "ela_math",                                    # mean(ela, math), the map color metric
    "pct_tested",
    "grade_2025"... "grade_2022",                  # A-F letter grades
    "ed_pct",                                      # % economically disadvantaged
    "ell_pct", "ell_count",
    "ese_pct",                                     # null until a source is wired in
    "enrollment",                                  # race-file total (all grades)
    "race": { counts + *_pct for white/black/hispanic/asian/pacific/amind/two_plus },
    "race_total"
  }
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW  = os.path.join(ROOT, "data", "raw", "fldoe_school_performance_raw.json")
ESE  = os.path.join(ROOT, "data", "raw", "ese_by_school.json")
OUT  = os.path.join(ROOT, "data", "processed", "school_performance.json")


def mean(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def load_ese():
    """Optional per-school ESE/SpEd. Returns dict keyed '<district>-<school_num>'."""
    if not os.path.exists(ESE):
        return {}
    with open(ESE) as f:
        raw = json.load(f)
    out = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            out[str(k)] = (None if v is None else float(v))
    elif isinstance(raw, list):
        for r in raw:
            d = str(r.get("district", "")).zfill(2)
            s = str(r.get("school_num", "")).zfill(4)
            v = r.get("ese_pct", r.get("ese", None))
            out[f"{d}-{s}"] = (None if v is None else float(v))
    return out


def main():
    if not os.path.exists(RAW):
        sys.exit(f"Missing input: {RAW}\n"
                 f"Drop fldoe_school_performance_raw.json into data/raw/ first.")

    with open(RAW) as f:
        doc = json.load(f)
    schools = doc.get("schools", doc if isinstance(doc, list) else [])
    ese = load_ese()

    out = {}
    n_ese = 0
    for s in schools:
        dist = str(s.get("district", "")).zfill(2)
        snum = str(s.get("school_num", "")).zfill(4)
        if not dist or not snum:
            continue
        key = f"{dist}-{snum}"

        prof = s.get("proficiency", {}) or {}
        ela = prof.get("ela")
        math = prof.get("math")
        sci = prof.get("science")
        ss = prof.get("social_studies")

        race = s.get("race") or {}
        total = s.get("enrollment_race_total") or (sum(v for v in race.values() if v) if race else None)

        race_pct = None
        if race and total:
            race_pct = {k: round(100.0 * (v or 0) / total, 1) for k, v in race.items()}

        ell_count = s.get("ell_count")
        ell_pct = None
        if ell_count is not None and total:
            ell_pct = round(min(100.0, 100.0 * ell_count / total), 1)

        ese_pct = ese.get(key)
        if ese_pct is not None:
            n_ese += 1

        grades = s.get("grades", {}) or {}

        out[key] = {
            "name": s.get("name"),
            "charter": bool(s.get("charter")),
            "title1": bool(s.get("title1")),
            "school_type": s.get("school_type"),
            "ela": ela, "math": math, "science": sci, "social_studies": ss,
            "ela_math": mean([ela, math]),
            "pct_tested": s.get("pct_tested"),
            "grade_2025": grades.get("g2025"),
            "grade_2024": grades.get("g2024"),
            "grade_2023": grades.get("g2023"),
            "grade_2022": grades.get("g2022"),
            "ed_pct": s.get("ed_pct"),
            "ell_count": ell_count,
            "ell_pct": ell_pct,
            "ese_pct": ese_pct,
            "enrollment": total,
            "race_total": total,
            "race": race or None,
            "race_pct": race_pct,
        }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f)

    brw = sum(1 for k in out if k.startswith("06-"))
    mdc = sum(1 for k in out if k.startswith("13-"))
    with_prof = sum(1 for v in out.values() if v["ela_math"] is not None)
    print(f"-> {OUT}")
    print(f"   {len(out)} schools  (Broward {brw} · Miami-Dade {mdc})")
    print(f"   {with_prof} with ELA/Math proficiency · {n_ese} with ESE%")
    if not ese:
        print("   (No ese_by_school.json found — ese_pct is null. Add it later to populate SpEd%.)")


if __name__ == "__main__":
    main()
