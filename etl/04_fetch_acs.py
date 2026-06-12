"""
Pull ACS 5-year block-group demographics for Broward + Miami-Dade counties
from the Census API (no key required for small volumes; sign up for a free
key at https://api.census.gov/data/key_signup.html and set CENSUS_API_KEY
env var if you hit rate limits).

Vintage: ACS 5-Year 2023 (most recent as of 2026).

Variables we need (reverse-engineered from the InSite deck):
  B01001          Sex by Age (for K-4, 5-8, 9-12, age 4 proxies)
  B02001          Race (Black alone)
  B03002          Hispanic origin crossed with race
  B19001          Household income in past 12 months (bucketed, used for %<$50k)
  B19013          Median household income
  B22001          SNAP in past 12 months
  B25003          Tenure (owner/renter)
  B11001          Household type (family vs non-family)
  B01003          Total population

Outputs:
  data/processed/acs_broward.json          {GEOID: {...metrics...}}
  data/processed/acs_miamidade.json
  data/processed/acs_schema.json           field name -> human label mapping

Age bucket mapping (sex-by-age, both sexes summed):
  K-4   ≈ ages 5-9       B01001_027E + B01001_003E (women 5-9) + (men 5-9)
  5-8   ≈ ages 10-13      uses 10-14 bucket since ACS groups 10-14
  9-12  ≈ ages 14-17      14 is in the 10-14 bucket, 15-17 in 15-17
  Age 4 ≈ under 5 /5 is an approximation (ACS has "Under 5" only)
We approximate grade-bands by proportional allocation of ACS 5-year age buckets.
This matches how InSite likely did it too (ESRI uses the same ACS underneath).
"""
import json, os, urllib.request, urllib.parse, time

API = "https://api.census.gov/data/2023/acs/acs5"
KEY = os.environ.get("CENSUS_API_KEY", "")

# Core variables (estimates only, skip the MOE suffix _M).
VARS = {
    "B01003_001E": "pop_total",

    # B01001 sex by age: we want children ages 5-17 by band.
    # Males:
    "B01001_003E": "pop_male_u5",
    "B01001_004E": "pop_male_5_9",
    "B01001_005E": "pop_male_10_14",
    "B01001_006E": "pop_male_15_17",
    # Females:
    "B01001_027E": "pop_female_u5",
    "B01001_028E": "pop_female_5_9",
    "B01001_029E": "pop_female_10_14",
    "B01001_030E": "pop_female_15_17",

    # Race / ethnicity (Hispanic origin crossed with race) — ages-combined pop
    "B02001_003E": "pop_black_alone_all_ages",
    "B03002_012E": "pop_hispanic_all_ages",

    # HHI bucketed (we'll sum buckets <$50k)
    "B19001_001E": "hh_total_for_income",
    "B19001_002E": "hh_inc_u10k",
    "B19001_003E": "hh_inc_10_15",
    "B19001_004E": "hh_inc_15_20",
    "B19001_005E": "hh_inc_20_25",
    "B19001_006E": "hh_inc_25_30",
    "B19001_007E": "hh_inc_30_35",
    "B19001_008E": "hh_inc_35_40",
    "B19001_009E": "hh_inc_40_45",
    "B19001_010E": "hh_inc_45_50",

    "B19013_001E": "hh_median_income",

    # SNAP
    "B22001_001E": "hh_total_for_snap",
    "B22001_002E": "hh_snap_recv",

    # Tenure
    "B25003_001E": "hh_total_tenure",
    "B25003_002E": "hh_owner",
    "B25003_003E": "hh_renter",

    # Household type
    "B11001_001E": "hh_total_type",
    "B11001_002E": "hh_family",
}

# Census API caps GET variable count around 50, so we chunk.
def chunk(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def fetch_chunk(var_codes, state, county):
    params = {
        "get": "GEO_ID,NAME," + ",".join(var_codes),
        "for": "block group:*",
        "in":  f"state:{state} county:{county}",
    }
    if KEY:
        params["key"] = KEY
    url = f"{API}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=90) as r:
        return json.load(r)

def fetch_county(state, county):
    all_codes = list(VARS.keys())
    merged = {}
    for group in chunk(all_codes, 40):
        print(f"  fetching {len(group)} vars for {state}/{county}...", flush=True)
        rows = fetch_chunk(group, state, county)
        hdr = rows[0]
        geo_idx = hdr.index("GEO_ID")
        for row in rows[1:]:
            # GEO_ID looks like "1500000US120110001011" — strip prefix to get GEOID
            geoid = row[geo_idx].split("US")[-1]
            rec = merged.setdefault(geoid, {})
            for i, col in enumerate(hdr):
                if col in VARS:
                    try:
                        rec[VARS[col]] = int(row[i]) if row[i] not in (None, "", "null") else None
                    except ValueError:
                        rec[VARS[col]] = None
        time.sleep(0.4)
    return merged

def derive(record):
    """Compute the fields InSite ultimately shows."""
    r = record
    # Age cohorts (using ACS 5-year bands; note InSite uses K-4, 5-8, 9-12)
    under5 = (r.get("pop_male_u5") or 0) + (r.get("pop_female_u5") or 0)
    age_5_9 = (r.get("pop_male_5_9") or 0) + (r.get("pop_female_5_9") or 0)
    age_10_14 = (r.get("pop_male_10_14") or 0) + (r.get("pop_female_10_14") or 0)
    age_15_17 = (r.get("pop_male_15_17") or 0) + (r.get("pop_female_15_17") or 0)

    # Grade bucket approximations (proportional allocation within ACS bands)
    # K-4 ≈ ages 5-9  (5 yrs out of 5 in the band -> full band)
    # 5-8 ≈ ages 10-13 (4 yrs out of 5 in 10-14 band)
    # 9-12 ≈ ages 14-17 (1/5 of 10-14 + full 15-17)
    k_4  = age_5_9
    g5_8 = round(age_10_14 * 0.8)
    g9_12= round(age_10_14 * 0.2) + age_15_17

    # % HHI <$50k
    hh_total = r.get("hh_total_for_income") or 0
    hh_under_50 = sum((r.get(f"hh_inc_{b}") or 0) for b in
        ["u10k","10_15","15_20","20_25","25_30","30_35","35_40","40_45","45_50"])
    pct_hhi_u50 = (hh_under_50 / hh_total) if hh_total else None

    # % HH on SNAP
    hh_snap_total = r.get("hh_total_for_snap") or 0
    hh_snap_recv  = r.get("hh_snap_recv") or 0
    pct_snap = (hh_snap_recv / hh_snap_total) if hh_snap_total else None

    # % renter
    hh_tenure_total = r.get("hh_total_tenure") or 0
    pct_renter = ((r.get("hh_renter") or 0) / hh_tenure_total) if hh_tenure_total else None

    # % family households
    hh_type_total = r.get("hh_total_type") or 0
    pct_family = ((r.get("hh_family") or 0) / hh_type_total) if hh_type_total else None

    # K-8 race/ethnicity (approximated: assume block group's race dist for ages 5-13 ≈ overall)
    pop_total = r.get("pop_total") or 0
    black_all = r.get("pop_black_alone_all_ages") or 0
    hisp_all  = r.get("pop_hispanic_all_ages") or 0
    pct_black = (black_all / pop_total) if pop_total else None
    pct_hisp  = (hisp_all  / pop_total) if pop_total else None

    return {
        "pop_total": pop_total,
        "pop_under5": under5, "pop_5_9": age_5_9, "pop_10_14": age_10_14, "pop_15_17": age_15_17,
        "pop_k_4_est": k_4, "pop_5_8_est": g5_8, "pop_9_12_est": g9_12,
        "hh_total": hh_total, "hh_under_50k": hh_under_50, "pct_hhi_u50": pct_hhi_u50,
        "hh_snap_recv": hh_snap_recv, "pct_snap": pct_snap,
        "hh_median_income": r.get("hh_median_income"),
        "pct_renter": pct_renter, "pct_family": pct_family,
        "pct_black": pct_black, "pct_hispanic": pct_hisp,
    }

def run(county_fips, label):
    print(f"Fetching ACS for {label} (FL {county_fips}) ...")
    raw = fetch_county("12", county_fips)
    out = {geoid: {**rec, **derive(rec)} for geoid, rec in raw.items()}
    path = f"data/processed/acs_{label}.json"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"  -> {path}  ({len(out)} block groups)")

if __name__ == "__main__":
    run("011", "broward")
    run("086", "miamidade")

    # Save schema for the frontend to read labels.
    schema = {
        "variables": VARS,
        "derived": {
            "pop_total":        "Total population (2023 ACS 5-yr)",
            "pop_k_4_est":      "K-4 student population (est, ages 5-9)",
            "pop_5_8_est":      "5-8 student population (est, ages 10-13)",
            "pop_9_12_est":     "9-12 student population (est, ages 14-17)",
            "pct_hhi_u50":      "% households with HHI below $50k",
            "pct_snap":         "% households receiving SNAP",
            "hh_median_income": "Median household income",
            "pct_black":        "% Black alone (all ages)",
            "pct_hispanic":     "% Hispanic/Latino (all ages)",
            "pct_renter":       "% renter households",
            "pct_family":       "% family households",
        },
        "notes": [
            "Source: U.S. Census Bureau, American Community Survey 5-Year Estimates, 2023 vintage.",
            "Grade-band counts are approximations from ACS age bands (K-4 ≈ ages 5-9, 5-8 ≈ ages 10-13, 9-12 ≈ ages 14-17).",
            "K-8 race/ethnicity percentages use the overall block-group share, same approximation used by most vendors including ESRI Business Analyst.",
        ],
    }
    with open("data/processed/acs_schema.json", "w") as f:
        json.dump(schema, f, indent=2)
    print("Wrote data/processed/acs_schema.json")
