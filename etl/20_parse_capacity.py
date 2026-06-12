"""
20_parse_capacity.py
Parse FISH capacity PDFs (FL DOE Level of Service reports) for Broward + Miami-Dade,
join to universal_schools.geojson by name, and emit data/processed/school_capacity.json.

Output fields per school id: school_capacity, cofte, utilization_pct, available_surplus, primary_use
"""
import json, pathlib, re
import pdfplumber

ROOT = pathlib.Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"


def num(s):
    if s is None or s == "": return None
    s = str(s).replace(",", "").strip()
    try: return float(s)
    except ValueError: return None


def parse_pdf(path, county):
    """Extract rows from a FISH PDF. Returns list of dicts."""
    rows = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for tbl in page.extract_tables() or []:
                for r in tbl:
                    if not r or not r[0]: continue
                    name = str(r[0]).strip()
                    if name.upper().startswith("FACILITY NAME"): continue  # header
                    # Flatten multi-line names
                    name = " ".join(name.split())
                    cap = num(r[1])
                    cofte = num(r[8]) if len(r) > 8 else None
                    util = num(r[6]) if len(r) > 6 else None
                    surplus = num(r[9]) if len(r) > 9 else None
                    primary = str(r[7]).replace("\n", " ").strip() if len(r) > 7 and r[7] else ""
                    if cap is None and cofte is None: continue
                    rows.append({
                        "name_pdf": name,
                        "school_capacity": cap,
                        "cofte": cofte,
                        "utilization_pct": util,     # already a percent (e.g. 67 = 67%)
                        "available_surplus": surplus,
                        "primary_use": primary,
                        "county": county,
                    })
    return rows


def normalize(s):
    """Aggressive name-normalization for fuzzy matching."""
    s = s.upper()
    # Common variants
    s = s.replace("ELEMENTARY SCHOOL", "ELEMENTARY")
    s = s.replace("MIDDLE SCHOOL", "MIDDLE")
    s = s.replace("HIGH SCHOOL", "HIGH")
    s = s.replace("SENIOR HIGH", "HIGH")
    s = s.replace("K-8 CENTER", "K-8")
    s = s.replace("K-8 SCHOOL", "K-8")
    s = s.replace(" CENTER", "")
    s = s.replace(" ACADEMY", "")
    s = s.replace(" SCHOOL", "")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def main():
    broward = parse_pdf(RAW / "2526Broward.pdf", "broward")
    dade = parse_pdf(RAW / "2526Dade.pdf", "miamidade")
    print(f"Broward rows: {len(broward)}  Dade rows: {len(dade)}")

    with open(PROC / "universal_schools.geojson") as f:
        univ = json.load(f)

    # Build lookup from normalized name -> list of ids (per county)
    by_norm = {"broward": {}, "miamidade": {}}
    for feat in univ["features"]:
        p = feat["properties"]
        if p.get("role") != "district": continue
        if p.get("status") == "closed": continue
        key = normalize(p.get("name", ""))
        by_norm[p["county"]].setdefault(key, []).append(p["id"])

    matched = {}
    unmatched = []

    for row in broward + dade:
        key = normalize(row["name_pdf"])
        candidates = by_norm[row["county"]].get(key, [])
        if len(candidates) == 1:
            sid = candidates[0]
        elif len(candidates) > 1:
            # Multiple matches → skip (ambiguous)
            unmatched.append((row["county"], row["name_pdf"], f"ambiguous: {candidates}"))
            continue
        else:
            # Try prefix match: PDF name starts with or is contained in universal name
            found = []
            for univ_key, ids in by_norm[row["county"]].items():
                if key and univ_key.startswith(key):
                    found.extend(ids)
                elif key and key.startswith(univ_key) and len(univ_key) > 8:
                    found.extend(ids)
            if len(found) == 1:
                sid = found[0]
            else:
                unmatched.append((row["county"], row["name_pdf"], "no match" if not found else f"ambiguous prefix: {found}"))
                continue
        # Already matched? Keep first
        if sid in matched: continue
        matched[sid] = {
            "school_capacity": row["school_capacity"],
            "cofte": row["cofte"],
            "utilization_pct": row["utilization_pct"],
            "available_surplus": row["available_surplus"],
            "primary_use": row["primary_use"],
        }

    print(f"\nMatched: {len(matched)} / {len(broward) + len(dade)} PDF rows")
    print(f"Unmatched: {len(unmatched)}")
    print("\nFirst 20 unmatched:")
    for u in unmatched[:20]:
        print(f"  [{u[0]}] {u[1]} — {u[2]}")

    # Save
    with open(PROC / "school_capacity.json", "w") as f:
        json.dump(matched, f)
    print(f"\nSaved → school_capacity.json ({len(matched)} schools)")

    # Quick stats on schools with >= 400 surplus
    big = [v for v in matched.values() if v.get("available_surplus") and v["available_surplus"] >= 400]
    print(f"\nSchools with 400+ surplus seats: {len(big)}")
    if big:
        util_buckets = {"red (75-100%)": 0, "yellow (50-74%)": 0, "green (0-49%)": 0}
        for v in big:
            u = v.get("utilization_pct", 0) or 0
            if u >= 75: util_buckets["red (75-100%)"] += 1
            elif u >= 50: util_buckets["yellow (50-74%)"] += 1
            else: util_buckets["green (0-49%)"] += 1
        for k, n in util_buckets.items():
            print(f"  {k}: {n}")


if __name__ == "__main__":
    main()
