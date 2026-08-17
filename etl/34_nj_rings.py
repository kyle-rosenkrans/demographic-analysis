"""
34_nj_rings.py — 5/10/15-minute drive-time ring demographics around every NJ
school, mirroring etl/16_universal_rings.py so the NJ detail card's ring table
is computed on exactly the same basis as Florida's.

Same approximation as the Florida side (and the same caveat): rings are
great-circle radii at a 22 mph urban average — 5 min = 1.83 mi, 10 = 3.67,
15 = 5.50 — not true isochrones. A block group counts toward a ring when its
centroid falls inside the radius.

Block groups from all three counties (Essex, Camden, Passaic) are considered,
not just those inside city limits, because rings routinely spill past the
municipal boundary.

Output: data/processed/nj_rings.json
  { "<school id>": { "rings": { "5min": {...}, "10min": {...}, "15min": {...} } } }
matching universal_rings.json's schema field-for-field.
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")

RINGS = {"5min": 1.83, "10min": 3.67, "15min": 5.50}
EARTH_MI = 3958.8

SUM_FIELDS = ["pop_total", "pop_k_4_est", "pop_5_8_est", "pop_9_12_est",
              "hh_total", "hh_under_50k", "hh_snap_recv"]


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
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def haversine_mi(lng1, lat1, lng2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_MI * math.asin(math.sqrt(a))


def main():
    with open(os.path.join(PROC, "acs_nj.json")) as f:
        acs = json.load(f)
    with open(os.path.join(PROC, "nj_blockgroups.geojson")) as f:
        bgs = json.load(f)["features"]
    with open(os.path.join(PROC, "nj_schools.geojson")) as f:
        schools = json.load(f)["features"]

    # Precompute BG centroids once — 1.4k BGs x 140 schools x 3 rings otherwise
    # recomputes the same centroids hundreds of thousands of times.
    pts = []
    for f in bgs:
        geoid = f["properties"].get("GEOID")
        rec = acs.get(geoid)
        if not rec:
            continue
        c = centroid(f["geometry"])
        if c:
            pts.append((c[0], c[1], rec))
    print(f"[1/2] {len(pts)} block groups with ACS data available for ring aggregation")

    out = {}
    for feat in schools:
        p = feat["properties"]
        lng, lat = feat["geometry"]["coordinates"]
        rings = {}
        for label, radius in RINGS.items():
            agg = {f: 0 for f in SUM_FIELDS}
            black = hisp = 0.0
            inc_w, inc_hh = 0.0, 0
            n = 0
            for blng, blat, rec in pts:
                # cheap bounding-box reject before the haversine
                if abs(blat - lat) > radius / 69.0:
                    continue
                if haversine_mi(lng, lat, blng, blat) > radius:
                    continue
                n += 1
                for fld in SUM_FIELDS:
                    agg[fld] += rec.get(fld) or 0
                pop = rec.get("pop_total") or 0
                black += (rec.get("pct_black") or 0) * pop
                hisp += (rec.get("pct_hispanic") or 0) * pop
                hh = rec.get("hh_total") or 0
                mi = rec.get("hh_median_income")
                if mi and hh:
                    inc_w += mi * hh
                    inc_hh += hh
            pop = agg["pop_total"]
            pct_black = (black / pop) if pop else None
            pct_hisp = (hisp / pop) if pop else None
            rings[label] = {
                **agg,
                "bg_count": n,
                "radius_miles": radius,
                "pct_black": pct_black,
                "pct_hispanic": pct_hisp,
                "pct_minority": ((pct_black or 0) + (pct_hisp or 0)) if pop else None,
                "pct_hhi_u50": (agg["hh_under_50k"] / agg["hh_total"]) if agg["hh_total"] else None,
                "pct_snap": (agg["hh_snap_recv"] / agg["hh_total"]) if agg["hh_total"] else None,
                "hh_median_income_approx": (inc_w / inc_hh) if inc_hh else None,
                "pop_k_8_est": agg["pop_k_4_est"] + agg["pop_5_8_est"],
            }
        out[p["id"]] = {"rings": rings}

    with open(os.path.join(PROC, "nj_rings.json"), "w") as f:
        json.dump(out, f)
    print(f"[2/2] nj_rings.json: {len(out)} schools")

    # Spot-check one school per city
    seen = set()
    for feat in schools:
        p = feat["properties"]
        if p["city"] in seen:
            continue
        seen.add(p["city"])
        r = out[p["id"]]["rings"]["10min"]
        print(f"    {p['city']:9} {p['name'][:34]:36} 10-min pop={r['pop_total']:>7,} "
              f"K-8={r['pop_k_8_est']:>6,} BGs={r['bg_count']:>3}")
    print("\nDone.")


if __name__ == "__main__":
    main()
