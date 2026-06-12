"""
Parse the FL DOE Private School List (supplied as an HTML table .xls).

Input:
  data/raw/PrivateSchoolList.xls  (copy of /Users/kylerosenkrans/Downloads/PrivateSchoolList.xls)

Filter:
  - District = BROWARD or DADE
  - FES Educational Options Participant OR FTC Participant = "Yes"
    (these are the two big Step Up For Students scholarship programs)

Output:
  data/processed/stepup_schools.json  — list of matching schools with address + enrollment
  data/raw/stepup_broward_miami.csv    — flat CSV for spot-checking
"""
import json, os, shutil
import pandas as pd

SRC = "/Users/kylerosenkrans/Downloads/PrivateSchoolList.xls"
os.makedirs("data/raw", exist_ok=True)
RAW = "data/raw/PrivateSchoolList.xls"
if not os.path.exists(RAW) or os.path.getmtime(RAW) < os.path.getmtime(SRC):
    shutil.copy(SRC, RAW)

df = pd.read_html(RAW)[0]
print(f"Source rows: {len(df)}")

# Filter
keep = df["District"].isin(["BROWARD", "DADE"])
df = df[keep].copy()
print(f"After county filter: {len(df)} (Broward+Miami-Dade)")

participates = (df["FES Educational Options Participant"] == "Yes") | (df["FTC Participant"] == "Yes")
df = df[participates].copy()
print(f"After Step Up filter (FES or FTC participant): {len(df)}")

# Grade-band totals
grade_cols_k4   = ["Kindergarten","Grade 1","Grade 2","Grade 3","Grade 4"]
grade_cols_58   = ["Grade 5","Grade 6","Grade 7","Grade 8"]
grade_cols_912  = ["Grade 9","Grade 10","Grade 11","Grade 12"]
for col in grade_cols_k4 + grade_cols_58 + grade_cols_912 + ["Pre-K"]:
    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

df["enroll_pk"]   = df["Pre-K"]
df["enroll_k4"]   = df[grade_cols_k4].sum(axis=1)
df["enroll_58"]   = df[grade_cols_58].sum(axis=1)
df["enroll_912"]  = df[grade_cols_912].sum(axis=1)
df["enroll_k8"]   = df["enroll_k4"] + df["enroll_58"]
df["enroll_total"]= df["enroll_pk"] + df["enroll_k8"] + df["enroll_912"]

# Compact output
out_rows = []
for _, r in df.iterrows():
    out_rows.append({
        "school_code": int(r["School Code"]) if pd.notna(r["School Code"]) else None,
        "name":        str(r["School Name"]).strip().title(),
        "county":      "broward" if r["District"] == "BROWARD" else "miamidade",
        "address":     str(r["Address 1"]).strip() if pd.notna(r["Address 1"]) else "",
        "city":        str(r["City"]).strip().title() if pd.notna(r["City"]) else "",
        "state":       r["State"],
        "zip":         str(r["Zip"]).strip() if pd.notna(r["Zip"]) else "",
        "grade_levels":str(r["Grade Levels"]).strip() if pd.notna(r["Grade Levels"]) else "",
        "enroll_pk":    int(r["enroll_pk"]),
        "enroll_k4":    int(r["enroll_k4"]),
        "enroll_58":    int(r["enroll_58"]),
        "enroll_912":   int(r["enroll_912"]),
        "enroll_k8":    int(r["enroll_k8"]),
        "enroll_total": int(r["enroll_total"]),
        "non_profit":  r.get("Non-Profit") == "Yes",
        "religious":   r.get("Religious") == "Yes",
        "denomination":str(r.get("Denomination")).strip() if pd.notna(r.get("Denomination")) else None,
    })

out = "data/processed/stepup_schools.json"
with open(out, "w") as f:
    json.dump(out_rows, f)
print(f"  -> {out}  ({len(out_rows)} schools)")

# Quick summaries
by_county = df.groupby("District").agg(n=("School Name","count"), k8=("enroll_k8","sum"), total=("enroll_total","sum"))
print("\nBy county:")
print(by_county)
