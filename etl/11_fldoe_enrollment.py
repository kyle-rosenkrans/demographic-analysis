"""
Parse five years of FL DOE Survey-2 membership files (2021-22 through 2025-26)
and produce per-campus 5-year enrollment histories for each of our 7 PLP schools,
plus a raw dump keyed by (year, district_num, school_num) for later rollups.

Input:  data/raw/fldoe_membership/{YY YY}MembBySchoolByGrade.xlsx
Output: data/processed/fldoe_enrollment_by_school.json   — {schoolNum: {yr: {PK,KG,1..12,total}}}
        data/processed/campus_enrollment_5yr.json        — {campusName: {yr: total, …, 5yr_pct_change}}
        data/processed/district_enrollment_5yr.json      — Broward county totals by grade-band & year
"""
import pandas as pd, json, os

YEARS = ["2122","2223","2324","2425","2526"]
DIR = "data/raw/fldoe_membership"

def read_school_sheet(path):
    # Read raw, find the header row, then slice.
    raw = pd.read_excel(path, sheet_name="School", header=None)
    hdr_row = None
    for i in range(min(8, len(raw))):
        vals = [str(v).strip() for v in raw.iloc[i].tolist()]
        if vals[0] == "District #":
            hdr_row = i; break
    if hdr_row is None:
        # Some years ship the file WITHOUT any header row at all (data starts at row 0)
        hdr_row = -1
    if hdr_row >= 0:
        df = raw.iloc[hdr_row+1:].copy()
        df.columns = [str(c).strip() for c in raw.iloc[hdr_row].tolist()]
    else:
        df = raw.copy()
        df.columns = ["District #","District","School #","School","PK","KG",1,2,3,4,5,6,7,8,9,10,11,12][:len(df.columns)]
    df = df.rename(columns={"District #":"district_num","District":"district","School #":"school_num","School":"school_name"})
    # Drop any residual title/junk rows where district_num isn't parseable
    df["district_num"] = pd.to_numeric(df["district_num"], errors="coerce")
    df = df[df["district_num"].notna()].copy()
    df["district_num"] = df["district_num"].astype(int)
    grade_cols = ["PK","KG","1","2","3","4","5","6","7","8","9","10","11","12"]
    # Grade columns may be either strings or ints depending on header parsing
    for g in grade_cols:
        if g in df.columns:
            df[g] = pd.to_numeric(df[g], errors="coerce").fillna(0).astype(int)
        else:
            # Try integer-valued column name as fallback
            try:
                gi = int(g)
                if gi in df.columns:
                    df[g] = pd.to_numeric(df[gi], errors="coerce").fillna(0).astype(int)
            except ValueError:
                pass
    df["school_num"] = df["school_num"].apply(
        lambda x: str(int(float(x))).zfill(4) if pd.notna(x) and str(x).replace(".","",1).isdigit() else None
    )
    return df, grade_cols

by_school = {}            # {schoolNum (str): {year: {grade: n}}}
broward_by_year = {}      # {year: {"PK":x,"KG":x,...,"total":x}}

for yr in YEARS:
    path = os.path.join(DIR, f"{yr}MembBySchoolByGrade.xlsx")
    df, grade_cols = read_school_sheet(path)
    # Keep Broward (district #6) AND Miami-Dade (district #13)
    brow = df[df["district_num"].isin([6, 13])]
    # Per-school — use composite key (district-school) to avoid collisions across counties
    for _, r in brow.iterrows():
        sn = r["school_num"]
        if not sn: continue
        dist = int(r["district_num"])
        key = f"{dist:02d}-{sn}"
        rec = by_school.setdefault(key, {"name": str(r["school_name"]).strip().title(),
                                         "district_num": dist,
                                         "school_num": sn,
                                         "years": {}})
        yr_data = {g: int(r[g]) for g in grade_cols if g in df.columns}
        yr_data["k4"]  = sum(yr_data.get(g, 0) for g in ["KG","1","2","3","4"])
        yr_data["5_8"] = sum(yr_data.get(g, 0) for g in ["5","6","7","8"])
        yr_data["9_12"]= sum(yr_data.get(g, 0) for g in ["9","10","11","12"])
        yr_data["k12"] = yr_data["k4"] + yr_data["5_8"] + yr_data["9_12"]
        yr_data["k8"]  = yr_data["k4"] + yr_data["5_8"]
        yr_data["total"] = yr_data.get("PK", 0) + yr_data["k12"]
        rec["years"][yr] = yr_data
    # County totals — Broward only (the legacy field). MDC totals tracked below.
    brow_only = brow[brow["district_num"] == 6]
    county_totals = {g: int(brow_only[g].sum()) for g in grade_cols if g in brow.columns}
    county_totals["k4"]  = sum(county_totals.get(g,0) for g in ["KG","1","2","3","4"])
    county_totals["5_8"] = sum(county_totals.get(g,0) for g in ["5","6","7","8"])
    county_totals["9_12"]= sum(county_totals.get(g,0) for g in ["9","10","11","12"])
    county_totals["k8"]  = county_totals["k4"] + county_totals["5_8"]
    county_totals["k12"] = county_totals["k4"] + county_totals["5_8"] + county_totals["9_12"]
    county_totals["total"] = county_totals.get("PK",0) + county_totals["k12"]
    broward_by_year[yr] = county_totals
    print(f"{yr}: {len(brow_only)} Broward / {len(brow) - len(brow_only)} MDC; Broward PK-12 total = {county_totals['total']:,}")

with open("data/processed/fldoe_enrollment_by_school.json","w") as f:
    json.dump(by_school, f)
with open("data/processed/district_enrollment_5yr.json","w") as f:
    json.dump(broward_by_year, f, indent=2)

# Per-PLP-campus history + 5-year change
PLP_CODES = {
    "Charles Drew Elementary":          "06-3221",
    "Lloyd Estates Elementary":         "06-1091",
    "Robert C. Markham Elementary":     "06-1671",
    "Royal Palm Elementary":            "06-1851",
    "Sunshine Elementary":              "06-1171",
    "Tedder Elementary":                "06-0571",
    "William Dandy Middle":             "06-1071",
}
campus_hist = {}
print("\nPer-campus 5-year history:")
print(f"{'Campus':36s} {'21-22':>8s} {'22-23':>8s} {'23-24':>8s} {'24-25':>8s} {'25-26':>8s}  {'5yr Δ':>8s}")
for name, code in PLP_CODES.items():
    rec = by_school.get(code)
    if not rec:
        print(f"{name:36s} NOT FOUND (code {code})")
        continue
    row = {"code": code, "years": {}}
    totals = []
    for yr in YEARS:
        y = rec["years"].get(yr, {})
        # InSite slide 6 uses total including PK (matches FL DOE published school totals)
        t = y.get("total", 0)
        row["years"][yr] = {"total": t, "k12": y.get("k12",0), "k4": y.get("k4",0), "5_8": y.get("5_8",0), "9_12": y.get("9_12",0), "PK": y.get("PK",0)}
        totals.append(t)
    chg_n = totals[-1] - totals[0]
    chg_p = (chg_n / totals[0]) if totals[0] else None
    row["change_5yr_n"] = chg_n
    row["change_5yr_pct"] = chg_p
    campus_hist[name] = row
    print(f"{name:36s} {totals[0]:>8,d} {totals[1]:>8,d} {totals[2]:>8,d} {totals[3]:>8,d} {totals[4]:>8,d}   {chg_n:>+5,d} ({chg_p*100:+.1f}%)")

with open("data/processed/campus_enrollment_5yr.json","w") as f:
    json.dump(campus_hist, f, indent=2)

# Broward totals by year
print("\nBroward county 5-yr enrollment history (all schools, PK + K-12):")
for yr in YEARS:
    t = broward_by_year[yr]
    print(f"  {yr[:2]}-{yr[2:]}: PK={t.get('PK',0):>6,d}  K-4={t['k4']:>7,d}  5-8={t['5_8']:>7,d}  9-12={t['9_12']:>7,d}  TOTAL={t['total']:>7,d}")
