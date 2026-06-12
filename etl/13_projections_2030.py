"""
Build 2025-2030 population projections at block-group level.

Approach: DIY trend extrapolation.
  1. Pull ACS 2021 5-yr for same variables we already have in ACS 2023 5-yr.
  2. Compute 2-year growth delta per BG per cohort (2021 -> 2023).
  3. Extrapolate forward: assume the same delta-per-year rate continues
     through 2030 (with 2025 ~= ACS 2023 anchored as "current").
  4. Merge projected values into data/processed/acs_<county>.json.
  5. Re-run 06_aggregate.py to refresh rollups with the new growth fields.

Variables projected:
  pop_total, pop_k_4_est, pop_5_8_est, pop_9_12_est,
  pop_black_alone_all_ages, pop_hispanic_all_ages,
  hh_under_50k (reconstructed from HHI bands), hh_snap_recv (stays flat — tract-level, no good trend)

Output fields (per BG) added:
  pop_total_2030, pop_k_4_2030, pop_5_8_2030, ... growth_pct_total, growth_pct_k4, etc.
"""
import json, os, urllib.request, urllib.parse, time

API_2021 = "https://api.census.gov/data/2021/acs/acs5"
KEY = os.environ.get("CENSUS_API_KEY", "")

# Variables we need from 2021 ACS — same codes as 04_fetch_acs.py
VARS = [
    "B01003_001E",  # pop_total
    "B01001_003E","B01001_027E",                       # M+F u5
    "B01001_004E","B01001_028E",                       # 5-9
    "B01001_005E","B01001_029E",                       # 10-14
    "B01001_006E","B01001_030E",                       # 15-17
    "B02001_003E",                                      # black_alone_all_ages
    "B03002_012E",                                      # hispanic_all_ages
    "B19001_001E",                                      # hh_total_for_income
    "B19001_002E","B19001_003E","B19001_004E","B19001_005E","B19001_006E",
    "B19001_007E","B19001_008E","B19001_009E","B19001_010E",                # HHI <$50k bands
]

def fetch(state, county, var_codes):
    params = {
        "get": "GEO_ID,NAME," + ",".join(var_codes),
        "for": "block group:*",
        "in": f"state:{state} county:{county}",
    }
    if KEY: params["key"] = KEY
    url = f"{API_2021}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=90) as r:
        return json.load(r)

def parse_bg(rows):
    hdr = rows[0]
    out = {}
    geo_idx = hdr.index("GEO_ID")
    for row in rows[1:]:
        geoid = row[geo_idx].split("US")[-1]
        rec = {}
        for i, col in enumerate(hdr):
            if col in VARS:
                try:
                    rec[col] = int(row[i]) if row[i] not in (None, "", "null") else None
                except ValueError:
                    rec[col] = None
        out[geoid] = rec
    return out

def derive_2021(r):
    """Match the 2023 derivation in 04_fetch_acs.py."""
    def g(k): return r.get(k) or 0
    age_5_9   = g("B01001_004E") + g("B01001_028E")
    age_10_14 = g("B01001_005E") + g("B01001_029E")
    age_15_17 = g("B01001_006E") + g("B01001_030E")
    return {
        "pop_total":      g("B01003_001E"),
        "pop_k_4_est":    age_5_9,
        "pop_5_8_est":    round(age_10_14 * 0.8),
        "pop_9_12_est":   round(age_10_14 * 0.2) + age_15_17,
        "pop_black":      g("B02001_003E"),
        "pop_hisp":       g("B03002_012E"),
        "hh_total":       g("B19001_001E"),
        "hh_under_50k":   sum(g(k) for k in [
            "B19001_002E","B19001_003E","B19001_004E","B19001_005E","B19001_006E",
            "B19001_007E","B19001_008E","B19001_009E","B19001_010E"]),
    }

# Convert 2023 ACS record to the same shape
def derive_2023(r):
    return {
        "pop_total":      r.get("pop_total") or 0,
        "pop_k_4_est":    r.get("pop_k_4_est") or 0,
        "pop_5_8_est":    r.get("pop_5_8_est") or 0,
        "pop_9_12_est":   r.get("pop_9_12_est") or 0,
        "pop_black":      r.get("pop_black_alone_all_ages") or 0,
        "pop_hisp":       r.get("pop_hispanic_all_ages") or 0,
        "hh_total":       r.get("hh_total_for_income") or 0,
        "hh_under_50k":   r.get("hh_under_50k") or 0,
    }

# Project forward from 2023 to target year.
# ACS 5-year estimates at BG level are very noisy for small cohorts (K-4, 5-8, race bands),
# so using the raw 2021->2023 delta for each cohort produces absurd results.
# Instead, compute the growth RATE on total population (stable, large sample) and apply
# it uniformly to all cohorts anchored on the 2023 base. This mirrors how ESRI/Claritas
# smooth BG projections — they extrapolate the stable signal, not per-cohort noise.
def project_rate(val_2021, val_2023, target_yr, clip=(0.7, 1.3)):
    """Return a growth multiplier capped to [clip_lo, clip_hi] to avoid absurdities."""
    if val_2021 <= 0: return 1.0
    per_yr_growth = (val_2023 / val_2021) ** (1/2.0)
    years_fwd = target_yr - 2023
    mult = per_yr_growth ** years_fwd
    return max(clip[0], min(clip[1], mult))

def project_cohort(val_2023, mult):
    return max(0, int(round(val_2023 * mult)))

for county_fips, label in [("011", "broward"), ("086", "miamidade")]:
    print(f"Fetching ACS 2021 for {label} ...")
    rows = []
    for chunk_start in range(0, len(VARS), 40):
        chunk = VARS[chunk_start:chunk_start+40]
        r = fetch("12", county_fips, chunk)
        # Merge
        if not rows:
            rows = r
        else:
            # map second chunk onto first
            hdr2 = r[0]; geo_idx = hdr2.index("GEO_ID")
            idx_map = {row[geo_idx]: row for row in r[1:]}
            out_hdr = rows[0] + [c for c in hdr2 if c not in rows[0]]
            new = [out_hdr]
            for rr in rows[1:]:
                key = rr[rows[0].index("GEO_ID")]
                extra = idx_map.get(key, [])
                new_row = rr + [extra[hdr2.index(c)] if extra and c in hdr2 else None for c in out_hdr if c not in rows[0]]
                new.append(new_row)
            rows = new
        time.sleep(0.3)
    data_2021 = parse_bg(rows)
    print(f"  fetched {len(data_2021)} BGs")

    # Load 2023 ACS we already have
    acs_path = f"data/processed/acs_{label}.json"
    with open(acs_path) as f:
        acs_2023 = json.load(f)

    # Load county-level FL DOE enrollment trend to drive cohort-specific projections.
    # ACS BG cohort estimates are too noisy; FL DOE counts actual students and shows
    # a reliable county-wide trend (K-4 declining ~2.2%/yr, 5-8 declining ~2.9%/yr).
    fldoe_rates = None
    if os.path.exists("data/processed/district_enrollment_5yr.json"):
        with open("data/processed/district_enrollment_5yr.json") as f:
            trend = json.load(f)
        def cagr(k):
            a, b = trend["2122"][k], trend["2526"][k]
            return (b/a)**(1/4.0) - 1 if a > 0 else 0
        fldoe_rates = {
            "k_4":  cagr("k4"),
            "5_8":  cagr("5_8"),
            "9_12": cagr("9_12"),
        }
        print(f"  FL DOE cohort CAGRs: K-4={fldoe_rates['k_4']*100:+.2f}%/yr, 5-8={fldoe_rates['5_8']*100:+.2f}%/yr, 9-12={fldoe_rates['9_12']*100:+.2f}%/yr")

    def cohort_mult(cagr_per_yr, years_fwd):
        return max(0.5, min(1.5, (1 + cagr_per_yr) ** years_fwd))

    # Project each BG to 2025 and 2030
    matched = 0; skipped = 0
    for geoid, rec in acs_2023.items():
        if geoid not in data_2021:
            skipped += 1; continue
        matched += 1
        d21 = derive_2021(data_2021[geoid])
        d23 = derive_2023(rec)
        # Total-pop + race + income: ACS trend (capped)
        pop_mult_25 = project_rate(d21["pop_total"], d23["pop_total"], 2025, clip=(0.93, 1.08))
        pop_mult_30 = project_rate(d21["pop_total"], d23["pop_total"], 2030, clip=(0.8, 1.2))
        # Cohort-specific: FL DOE trend, applied uniformly county-wide
        k4_mult_25 = cohort_mult(fldoe_rates["k_4"],  2025-2023) if fldoe_rates else pop_mult_25
        k4_mult_30 = cohort_mult(fldoe_rates["k_4"],  2030-2023) if fldoe_rates else pop_mult_30
        s8_mult_25 = cohort_mult(fldoe_rates["5_8"],  2025-2023) if fldoe_rates else pop_mult_25
        s8_mult_30 = cohort_mult(fldoe_rates["5_8"],  2030-2023) if fldoe_rates else pop_mult_30
        g9_mult_25 = cohort_mult(fldoe_rates["9_12"], 2025-2023) if fldoe_rates else pop_mult_25
        g9_mult_30 = cohort_mult(fldoe_rates["9_12"], 2030-2023) if fldoe_rates else pop_mult_30
        MULTS = {
            "pop_total":      (pop_mult_25, pop_mult_30),
            "pop_k_4_est":    (k4_mult_25,  k4_mult_30),
            "pop_5_8_est":    (s8_mult_25,  s8_mult_30),
            "pop_9_12_est":   (g9_mult_25,  g9_mult_30),
            "pop_black":      (pop_mult_25, pop_mult_30),
            "pop_hisp":       (pop_mult_25, pop_mult_30),
            "hh_under_50k":   (pop_mult_25, pop_mult_30),
        }
        for key, (m25, m30) in MULTS.items():
            v23 = d23[key]
            v25 = project_cohort(v23, m25)
            v30 = project_cohort(v23, m30)
            rec[f"{key}_2025"] = v25
            rec[f"{key}_2030"] = v30
            rec[f"{key}_growth_5yr"] = (v30 - v25) / v25 if v25 > 0 else None

    with open(acs_path, "w") as f:
        json.dump(acs_2023, f)
    print(f"  matched {matched}, skipped {skipped}; wrote projections to {acs_path}")

print("\nDone. Re-run etl/06_aggregate.py to refresh rollups with projection fields.")
