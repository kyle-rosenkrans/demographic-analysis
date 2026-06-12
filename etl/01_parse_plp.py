import pandas as pd, os
src = "/Users/kylerosenkrans/Downloads/PLP25 (2).xlsx"
raw = pd.read_excel(src, sheet_name=0, header=None, dtype=str)
# Find the row containing "District Number"
hdr_idx = None
for i in range(10):
    if any(str(v).strip() == "District Number" for v in raw.iloc[i].tolist()):
        hdr_idx = i; break
print(f"Header row index: {hdr_idx}")
hdr = [str(v).replace("\n"," ").strip() for v in raw.iloc[hdr_idx].tolist()]
df = raw.iloc[hdr_idx+1:].copy()
df.columns = hdr
df = df.dropna(how="all").reset_index(drop=True)
print("Shape:", df.shape)
print("Columns:", hdr)

target = df[df["District Name"].isin(["BROWARD","MIAMI-DADE"])].copy()
print(f"\n{len(target)} PLP schools in Broward + Miami-Dade")
print(target[["District Name","School Number","School Name","Grade 2025","School Type","Title I"]].to_string(index=False))

out_dir = "data/raw"
os.makedirs(out_dir, exist_ok=True)
df.to_csv(f"{out_dir}/fl_plp_2024-25_full.csv", index=False)
target.to_csv(f"{out_dir}/fl_plp_2024-25_miami_broward.csv", index=False)
print(f"\nWrote {out_dir}/fl_plp_2024-25_full.csv  ({len(df)} rows)")
print(f"Wrote {out_dir}/fl_plp_2024-25_miami_broward.csv  ({len(target)} rows)")
