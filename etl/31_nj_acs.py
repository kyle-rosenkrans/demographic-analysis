"""
31_nj_acs.py — ACS 5-Year 2023 block-group demographics for the NJ cities,
plus ward and city rollups. Produces the NJ analogs of acs_*.json /
sbd_rollup.json / county_rollup.json so the web app's heat map, ring tables,
suitability model and comparison tables all work unchanged.

WHY NOT THE CENSUS API: as of 2025 the Census data API rejects every keyless
request ("A valid key must be included with each data API request"), and no
CENSUS_API_KEY is configured here — so etl/04's approach can't run. Instead we
stream the keyless *table-based Summary File* (one .dat per ACS table, national,
pipe-delimited, GEO_ID in the standard `<sumlevel>US<fips>` form). Each file is
17-190 MB, but rows are filtered as they stream so memory stays flat and only
the ~1.4k NJ block groups we care about are retained. The filtered extract is
cached in data/raw/ so re-runs cost nothing.

Variable set and the derive() math are copied from etl/fetch_orange_geo.py so
NJ block groups are directly comparable to the Florida ones.

Tract-level pass: SNAP (B22001) isn't published at block-group level, and
median income (B19013) is noisy there, so — exactly as etl/04b does for FL —
we also keep tract rows and apportion tract SNAP down to block groups by each
BG's share of tract households.

Outputs (data/processed/):
  acs_nj.json            {GEOID: {...derived...}}
  nj_ward_rollup.json    {"<city>-<ward>": {...}, "_average": {...}}  + per-city _average
  nj_city_rollup.json    {"<city>": {...}}
  bg_nj_ward_assignment.json  {GEOID: "<city>-<ward>"}
"""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")
RAW = os.path.join(ROOT, "data", "raw")
os.makedirs(RAW, exist_ok=True)

SF = "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData"
CACHE = os.path.join(RAW, "nj_acs_extract.json")
COUNTIES = ["013", "007", "031"]  # Essex, Camden, Passaic
STATE = "34"

# ACS variable -> our field name (identical to the Florida ETL)
VARS = {
    "B01003_001E": "pop_total",
    "B01001_003E": "pop_male_u5", "B01001_004E": "pop_male_5_9",
    "B01001_005E": "pop_male_10_14", "B01001_006E": "pop_male_15_17",
    "B01001_027E": "pop_female_u5", "B01001_028E": "pop_female_5_9",
    "B01001_029E": "pop_female_10_14", "B01001_030E": "pop_female_15_17",
    "B02001_003E": "pop_black_alone_all_ages", "B03002_012E": "pop_hispanic_all_ages",
    "B19001_001E": "hh_total_for_income", "B19001_002E": "hh_inc_u10k",
    "B19001_003E": "hh_inc_10_15", "B19001_004E": "hh_inc_15_20",
    "B19001_005E": "hh_inc_20_25", "B19001_006E": "hh_inc_25_30",
    "B19001_007E": "hh_inc_30_35", "B19001_008E": "hh_inc_35_40",
    "B19001_009E": "hh_inc_40_45", "B19001_010E": "hh_inc_45_50",
    "B19013_001E": "hh_median_income",
    "B22001_001E": "hh_total_for_snap", "B22001_002E": "hh_snap_recv",
    "B25003_001E": "hh_total_tenure", "B25003_002E": "hh_owner", "B25003_003E": "hh_renter",
    "B11001_001E": "hh_total_type", "B11001_002E": "hh_family",
}


def sf_column(var):
    """B01001_003E -> B01001_E003 (the summary-file column naming)."""
    table, rest = var.split("_")
    return f"{table}_{rest[-1]}{rest[:-1]}"


def tables_needed():
    out = {}
    for var in VARS:
        out.setdefault(var.split("_")[0].lower(), []).append(var)
    return out


def clean(v):
    """Census jam values (-555555555, -666666666, …) and blanks mean 'no data'."""
    if v is None:
        return None
    v = v.strip()
    if v == "" or v == "null":
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    if n < 0:  # counts/medians are never legitimately negative here
        return None
    return int(n) if n == int(n) else n


def wanted_prefixes():
    """Block-group (150) and tract (140) GEO_IDs for our three counties."""
    pre = []
    for c in COUNTIES:
        pre.append(f"1500000US{STATE}{c}")
        pre.append(f"1400000US{STATE}{c}")
    return tuple(pre)


def stream_table(table, vars_wanted, prefixes, store):
    """Stream one .dat, keeping only rows for our geographies."""
    url = f"{SF}/acsdt5y{2023}-{table}.dat"
    cols_wanted = {sf_column(v): VARS[v] for v in vars_wanted}
    req = urllib.request.Request(url, headers={"User-Agent": "kipp-demographics-etl/1.0"})
    kept = 0
    with urllib.request.urlopen(req, timeout=600) as r:
        header = r.readline().decode("utf-8", "replace").rstrip("\n").split("|")
        idx = {}
        for col, field in cols_wanted.items():
            if col not in header:
                sys.exit(f"Column {col} missing from {table}.dat — ACS layout changed.")
            idx[header.index(col)] = field
        for raw in r:
            line = raw.decode("utf-8", "replace")
            # cheap prefix test before the split, since >99% of rows are discarded
            if not line.startswith(prefixes):
                continue
            parts = line.rstrip("\n").split("|")
            geo = parts[0]
            geoid = geo.split("US", 1)[1]
            rec = store.setdefault(geoid, {})
            for i, field in idx.items():
                if i < len(parts):
                    rec[field] = clean(parts[i])
            kept += 1
    print(f"    {table}: kept {kept} rows")


def fetch_extract():
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            d = json.load(f)
        print(f"  using cached extract ({len(d)} geographies) — delete "
              f"{os.path.relpath(CACHE, ROOT)} to re-download")
        return d
    prefixes = wanted_prefixes()
    store = {}
    tabs = tables_needed()
    print(f"  streaming {len(tabs)} ACS tables (~510 MB, filtered on the fly)…")
    for table, vars_wanted in sorted(tabs.items()):
        stream_table(table, vars_wanted, prefixes, store)
    with open(CACHE, "w") as f:
        json.dump(store, f)
    print(f"  cached -> {os.path.relpath(CACHE, ROOT)} ({len(store)} geographies)")
    return store


# ---------- derived fields (identical math to the Florida ETL) ----------
def derive(r):
    g = lambda k: r.get(k) or 0
    under5 = g("pop_male_u5") + g("pop_female_u5")
    age_5_9 = g("pop_male_5_9") + g("pop_female_5_9")
    age_10_14 = g("pop_male_10_14") + g("pop_female_10_14")
    age_15_17 = g("pop_male_15_17") + g("pop_female_15_17")
    k_4 = age_5_9
    g5_8 = round(age_10_14 * 0.8)
    g9_12 = round(age_10_14 * 0.2) + age_15_17
    hh_total = g("hh_total_for_income")
    hh_under_50 = sum(g(f"hh_inc_{b}") for b in
                      ["u10k", "10_15", "15_20", "20_25", "25_30", "30_35", "35_40", "40_45", "45_50"])
    pct_hhi_u50 = (hh_under_50 / hh_total) if hh_total else None
    snap_tot, snap_recv = g("hh_total_for_snap"), g("hh_snap_recv")
    pct_snap = (snap_recv / snap_tot) if snap_tot else None
    ten = g("hh_total_tenure")
    pct_renter = (g("hh_renter") / ten) if ten else None
    typ = g("hh_total_type")
    pct_family = (g("hh_family") / typ) if typ else None
    pop = g("pop_total")
    pct_black = (g("pop_black_alone_all_ages") / pop) if pop else None
    pct_hisp = (g("pop_hispanic_all_ages") / pop) if pop else None
    return {
        "pop_total": pop, "pop_under5": under5, "pop_5_9": age_5_9,
        "pop_10_14": age_10_14, "pop_15_17": age_15_17,
        "pop_k_4_est": k_4, "pop_5_8_est": g5_8, "pop_9_12_est": g9_12,
        "pop_k_8_est": k_4 + g5_8,
        "hh_total": hh_total, "hh_under_50k": hh_under_50, "pct_hhi_u50": pct_hhi_u50,
        "hh_snap_recv": snap_recv, "pct_snap": pct_snap,
        "hh_median_income": r.get("hh_median_income"),
        "hh_median_income_approx": r.get("hh_median_income"),
        "pct_renter": pct_renter, "pct_family": pct_family,
        "pct_black": pct_black, "pct_hispanic": pct_hisp,
    }


def apportion_tract_snap(bgs, tracts):
    """BG-level SNAP isn't published; spread tract SNAP by BG household share."""
    tract_hh = {}
    for geoid, bg in bgs.items():
        t = geoid[:11]
        tract_hh[t] = tract_hh.get(t, 0) + (bg.get("hh_total_for_income") or 0)
    fixed = 0
    for geoid, bg in bgs.items():
        t = geoid[:11]
        tr = tracts.get(t)
        if not tr:
            continue
        u = tr.get("hh_total_for_snap") or 0
        rr = tr.get("hh_snap_recv") or 0
        share = ((bg.get("hh_total_for_income") or 0) / tract_hh[t]) if tract_hh.get(t) else 0
        bg["hh_total_for_snap"] = int(round(u * share))
        bg["hh_snap_recv"] = int(round(rr * share))
        if not bg.get("hh_median_income"):
            bg["hh_median_income"] = tr.get("hh_median_income")
        fixed += 1
    print(f"  apportioned tract SNAP/income onto {fixed} block groups")


# ---------- point-in-polygon (same helper style as etl/23) ----------
def point_in_ring(x, y, ring):
    inside = False
    n = len(ring); j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def point_in_geom(lng, lat, geom):
    t, c = geom.get("type"), geom.get("coordinates")
    def in_rings(rings):
        if not rings or not point_in_ring(lng, lat, rings[0]):
            return False
        return not any(point_in_ring(lng, lat, h) for h in rings[1:])
    if t == "Polygon":
        return in_rings(c)
    if t == "MultiPolygon":
        return any(in_rings(p) for p in c)
    return False


def centroid(geom):
    pts = []
    def walk(c):
        if c and isinstance(c[0], (int, float)):
            pts.append(c)
        else:
            for x in c:
                walk(x)
    walk(geom["coordinates"])
    if not pts:
        return None
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]


SUM_FIELDS = ["pop_total", "pop_under5", "pop_5_9", "pop_10_14", "pop_15_17",
              "pop_k_4_est", "pop_5_8_est", "pop_9_12_est", "pop_k_8_est",
              "hh_total", "hh_under_50k", "hh_snap_recv"]


def rollup(members, acs):
    """Sum counts, then recompute rates from the sums (never average rates)."""
    out = {f: 0 for f in SUM_FIELDS}
    black = hisp = renter = family = 0
    ten = typ = snap_tot = 0
    inc_weighted, inc_hh = 0.0, 0
    n = 0
    for geoid in members:
        r = acs.get(geoid)
        if not r:
            continue
        n += 1
        for f in SUM_FIELDS:
            out[f] += r.get(f) or 0
        pop = r.get("pop_total") or 0
        black += (r.get("pct_black") or 0) * pop
        hisp += (r.get("pct_hispanic") or 0) * pop
        # tenure/type denominators aren't kept post-derive; approximate with hh_total
        hh = r.get("hh_total") or 0
        ten += hh; typ += hh
        renter += (r.get("pct_renter") or 0) * hh
        family += (r.get("pct_family") or 0) * hh
        snap_tot += hh
        mi = r.get("hh_median_income")
        if mi:
            inc_weighted += mi * hh
            inc_hh += hh
    pop = out["pop_total"]
    out["bg_count"] = n
    out["pct_hhi_u50"] = (out["hh_under_50k"] / out["hh_total"]) if out["hh_total"] else None
    out["pct_snap"] = (out["hh_snap_recv"] / snap_tot) if snap_tot else None
    out["pct_black"] = (black / pop) if pop else None
    out["pct_hispanic"] = (hisp / pop) if pop else None
    out["pct_renter"] = (renter / ten) if ten else None
    out["pct_family"] = (family / typ) if typ else None
    out["hh_median_income_approx"] = (inc_weighted / inc_hh) if inc_hh else None
    return out


def average_of(records):
    """Unweighted mean across rollups, for the '_average' comparison column."""
    if not records:
        return {}
    keys = set()
    for r in records:
        keys |= set(r.keys())
    avg = {}
    for k in keys:
        vals = [r[k] for r in records if isinstance(r.get(k), (int, float))]
        avg[k] = (sum(vals) / len(vals)) if vals else None
    return avg


def main():
    print("[1/4] ACS extract")
    raw = fetch_extract()
    bgs = {g: r for g, r in raw.items() if len(g) == 12}
    tracts = {g: r for g, r in raw.items() if len(g) == 11}
    print(f"  {len(bgs)} block groups, {len(tracts)} tracts")

    print("[2/4] Derive + apportion")
    apportion_tract_snap(bgs, tracts)
    acs = {g: {**r, **derive(r)} for g, r in bgs.items()}
    with_pop = sum(1 for r in acs.values() if (r.get("pop_total") or 0) > 0)
    print(f"  acs_nj.json: {len(acs)} block groups ({with_pop} with population)")
    with open(os.path.join(PROC, "acs_nj.json"), "w") as f:
        json.dump(acs, f)

    print("[3/4] Assign block groups to wards")
    with open(os.path.join(PROC, "nj_wards.geojson")) as f:
        wards = json.load(f)["features"]
    with open(os.path.join(PROC, "nj_blockgroups.geojson")) as f:
        bg_feats = json.load(f)["features"]

    assignment = {}
    for f in bg_feats:
        geoid = f["properties"].get("GEOID")
        if not geoid or geoid not in acs:
            continue
        c = centroid(f["geometry"])
        if not c:
            continue
        for w in wards:
            if point_in_geom(c[0], c[1], w["geometry"]):
                p = w["properties"]
                assignment[geoid] = f"{p['city']}-{p['ward']}"
                break
    print(f"  {len(assignment)} block groups fall inside a ward "
          f"(of {len(bg_feats)} in the 3 counties — the rest are outside the city limits)")
    with open(os.path.join(PROC, "bg_nj_ward_assignment.json"), "w") as f:
        json.dump(assignment, f)

    print("[4/4] Ward + city rollups")
    members = {}
    for geoid, key in assignment.items():
        members.setdefault(key, []).append(geoid)
    ward_rollup = {k: rollup(v, acs) for k, v in sorted(members.items())}

    city_members = {}
    for geoid, key in assignment.items():
        city_members.setdefault(key.split("-")[0], []).append(geoid)
    city_rollup = {k: rollup(v, acs) for k, v in sorted(city_members.items())}

    # Per-city average across that city's wards, plus a global average, so the
    # comparison table can show "vs average" the way the FL SBD table does.
    for city in city_members:
        recs = [v for k, v in ward_rollup.items() if k.startswith(city + "-")]
        ward_rollup[f"_average_{city}"] = average_of(recs)
    ward_rollup["_average"] = average_of(
        [v for k, v in ward_rollup.items() if not k.startswith("_average")])

    with open(os.path.join(PROC, "nj_ward_rollup.json"), "w") as f:
        json.dump(ward_rollup, f)
    with open(os.path.join(PROC, "nj_city_rollup.json"), "w") as f:
        json.dump(city_rollup, f)

    for k, v in city_rollup.items():
        print(f"  {k:9} pop={v['pop_total']:>7,}  K-8={v['pop_k_8_est']:>6,}  "
              f"SNAP={(v['pct_snap'] or 0)*100:4.1f}%  <50k={(v['pct_hhi_u50'] or 0)*100:4.1f}%  "
              f"BGs={v['bg_count']}")
    print("\nDone.")


if __name__ == "__main__":
    main()
