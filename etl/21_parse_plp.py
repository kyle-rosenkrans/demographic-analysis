"""
21_parse_plp.py
Parse FL DOE 2024-25 Persistently Low-Performing Schools list (PLP25.xlsx)
for Broward (district 06) + Miami-Dade (district 13), match each row to a
universal_schools.geojson id by (county, school_num), and emit
data/processed/plp_schools.json keyed by school id.

Output (per school id):
  list_year            : "2024-25"
  grade_2025 … 2018    : school letter grades (string or null)
  school_type_code     : 1=Elementary 2=Middle 3=High 4=Combination
  charter              : bool
  alt_ese              : bool
  title1               : bool
  econ_disadv_pct      : number (0-100)
  grade3_ela_bottom10  : bool   (Grade 3 ELA Bottom 10% 2 of last 3 yrs)
  grade4_math_bottom10 : bool
"""
import json, pathlib, pandas as pd

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"


def yn(v):
    if v is None: return None
    s = str(v).strip().upper()
    if s in ("YES", "Y", "TRUE", "1"): return True
    if s in ("NO", "N", "FALSE", "0"): return False
    return None


def clean(v):
    if v is None: return None
    s = str(v).strip()
    if not s or s.upper() in ("NAN", "NA", "NONE", ""): return None
    return s


def main():
    # Copy source file into data/raw if not already there (user's download lives in ~/Downloads)
    src_xlsx = RAW / "PLP25.xlsx"
    if not src_xlsx.exists():
        # Fallback: try Downloads
        dl = pathlib.Path.home() / "Downloads" / "PLP25 (3).xlsx"
        if dl.exists():
            src_xlsx = dl
        else:
            raise FileNotFoundError(f"PLP25.xlsx not found at {src_xlsx} or {dl}")

    df = pd.read_excel(src_xlsx, sheet_name="Persistently Low-Performing", header=4)
    df.columns = [str(c).strip() for c in df.columns]
    df["District Number"] = df["District Number"].astype(str).str.split(".").str[0].str.zfill(2)
    df["School Number"]   = df["School Number"].astype(str).str.split(".").str[0].str.zfill(4)
    sub = df[df["District Number"].isin(["06", "13"])].copy()
    print(f"Broward + Dade PLP rows: {len(sub)}")

    with open(PROC / "universal_schools.geojson") as f:
        univ = json.load(f)

    idx = {}
    for feat in univ["features"]:
        pr = feat["properties"]
        if pr.get("role") != "district": continue
        num = str(pr.get("school_num", "")).zfill(4)
        idx[(pr["county"], num)] = pr["id"]

    g3_col = [c for c in df.columns if c.startswith("Grade 3 ELA")][0]
    g4_col = [c for c in df.columns if c.startswith("Grade 4 Math")][0]

    out = {}
    unmatched = []
    for _, row in sub.iterrows():
        county = "broward" if row["District Number"] == "06" else "miamidade"
        num = row["School Number"]
        sid = idx.get((county, num))
        if not sid:
            unmatched.append((county, num, row["School Name"]))
            continue
        try:
            econ = float(row["Percent of Economically Disadvantaged Students"])
        except (ValueError, TypeError):
            econ = None
        out[sid] = {
            "list_year": "2024-25",
            "pdoe_name": clean(row["School Name"]),
            "grade_2025": clean(row["Grade 2025"]),
            "grade_2024": clean(row["Grade 2024"]),
            "grade_2023": clean(row["Grade 2023"]),
            "grade_2022": clean(row["Grade 2022"]),
            "grade_2021": clean(row["Grade 2021"]),
            "grade_2019": clean(row["Grade 2019"]),
            "grade_2018": clean(row["Grade 2018"]),
            "school_type_code": clean(row["School Type"]),
            "charter": yn(row["Charter School"]),
            "alt_ese": yn(row["Alternative/ESE Center School"]),
            "title1": yn(row["Title I"]),
            "econ_disadv_pct": econ,
            "grade3_ela_bottom10": yn(row[g3_col]),
            "grade4_math_bottom10": yn(row[g4_col]),
        }

    print(f"Matched: {len(out)}/{len(sub)}")
    if unmatched:
        print("Unmatched:")
        for u in unmatched: print(" ", u)

    with open(PROC / "plp_schools.json", "w") as f:
        json.dump(out, f, indent=2)
    print(f"Saved → plp_schools.json ({len(out)} schools)")


if __name__ == "__main__":
    main()
