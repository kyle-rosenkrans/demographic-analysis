"""
One-shot Orange County (FL) geo + demographics fetch — STDLIB ONLY (runs on
macOS system Python). Mirrors etl/03 (TIGER boundaries), etl/04 + etl/04b (ACS),
and pulls Orange/OCPS GIS layers. Writes Orange-suffixed files into
data/processed/ in the same schema as the Broward/Miami-Dade equivalents.

Orange County: Census FIPS 12095 · FL DOE district 48 · 7 school board districts.

Outputs:
  orange_blockgroups.geojson   TIGER block groups (props: GEOID,...)
  orange_county.geojson        county polygon (map framing)
  acs_orange.json              {GEOID: {...derived demographics...}}  (+ tract SNAP/income)
  orange_sbd.geojson           7 school board district polygons (props: district)
  orange_schools.geojson       OCPS + charter school points (loc_no,name,sb_district,fac_type,...)
  orange_boundaries.geojson    ES/MS/HS attendance zones merged (props: loc_no,name,school_type)
"""
import json, os, urllib.request, urllib.parse, time

UA = {"User-Agent": "kipp-demographics-etl/1.0"}
OUT = "data/processed"
os.makedirs(OUT, exist_ok=True)

def getjson(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

# ---------------------------------------------------------------- TIGER
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
def tiger(service, layer, where, out_path, fields="*"):
    url = (f"{TIGER}/{service}/MapServer/{layer}/query?"
           f"where={urllib.parse.quote(where)}&outFields={fields}"
           "&f=geojson&outSR=4326&returnGeometry=true")
    d = getjson(url)
    json.dump(d, open(f"{OUT}/{out_path}", "w"))
    print(f"  {out_path}: {len(d.get('features',[]))} features")
    return d

# ---------------------------------------------------------------- ArcGIS hosted
def arcgis_geojson(base, layer, out_path, where="1=1", transform=None):
    feats, offset = [], 0
    while True:
        url = (f"{base}/{layer}/query?where={urllib.parse.quote(where)}"
               "&outFields=*&f=geojson&outSR=4326&returnGeometry=true"
               f"&resultOffset={offset}&resultRecordCount=2000")
        d = getjson(url)
        fs = d.get("features", [])
        feats += fs
        if len(fs) < 2000 or not d.get("properties", {}).get("exceededTransferLimit"):
            # geojson responses don't always echo exceededTransferLimit; stop when short page
            if len(fs) < 2000:
                break
        offset += len(fs)
        if offset > 20000:
            break
    if transform:
        feats = [transform(f) for f in feats if transform(f) is not None]
    fc = {"type": "FeatureCollection", "features": feats}
    json.dump(fc, open(f"{OUT}/{out_path}", "w"))
    print(f"  {out_path}: {len(feats)} features")
    return fc

# ---------------------------------------------------------------- ACS (from etl/04 + 04b)
API = "https://api.census.gov/data/2023/acs/acs5"
KEY = os.environ.get("CENSUS_API_KEY", "")
VARS = {
    "B01003_001E":"pop_total",
    "B01001_003E":"pop_male_u5","B01001_004E":"pop_male_5_9","B01001_005E":"pop_male_10_14","B01001_006E":"pop_male_15_17",
    "B01001_027E":"pop_female_u5","B01001_028E":"pop_female_5_9","B01001_029E":"pop_female_10_14","B01001_030E":"pop_female_15_17",
    "B02001_003E":"pop_black_alone_all_ages","B03002_012E":"pop_hispanic_all_ages",
    "B19001_001E":"hh_total_for_income","B19001_002E":"hh_inc_u10k","B19001_003E":"hh_inc_10_15","B19001_004E":"hh_inc_15_20",
    "B19001_005E":"hh_inc_20_25","B19001_006E":"hh_inc_25_30","B19001_007E":"hh_inc_30_35","B19001_008E":"hh_inc_35_40",
    "B19001_009E":"hh_inc_40_45","B19001_010E":"hh_inc_45_50","B19013_001E":"hh_median_income",
    "B22001_001E":"hh_total_for_snap","B22001_002E":"hh_snap_recv",
    "B25003_001E":"hh_total_tenure","B25003_002E":"hh_owner","B25003_003E":"hh_renter",
    "B11001_001E":"hh_total_type","B11001_002E":"hh_family",
}
def _chunk(seq, n):
    for i in range(0, len(seq), n): yield seq[i:i+n]
def fetch_acs_county(state, county):
    merged = {}
    for group in _chunk(list(VARS.keys()), 40):
        params = {"get":"GEO_ID,NAME,"+",".join(group),"for":"block group:*","in":f"state:{state} county:{county}"}
        if KEY: params["key"]=KEY
        rows = getjson(f"{API}?{urllib.parse.urlencode(params)}", timeout=90)
        hdr = rows[0]; gi = hdr.index("GEO_ID")
        for row in rows[1:]:
            geoid = row[gi].split("US")[-1]
            rec = merged.setdefault(geoid, {})
            for i, col in enumerate(hdr):
                if col in VARS:
                    try: rec[VARS[col]] = int(row[i]) if row[i] not in (None,"","null") else None
                    except ValueError: rec[VARS[col]] = None
        time.sleep(0.4)
    return merged
def derive(r):
    under5=(r.get("pop_male_u5") or 0)+(r.get("pop_female_u5") or 0)
    age_5_9=(r.get("pop_male_5_9") or 0)+(r.get("pop_female_5_9") or 0)
    age_10_14=(r.get("pop_male_10_14") or 0)+(r.get("pop_female_10_14") or 0)
    age_15_17=(r.get("pop_male_15_17") or 0)+(r.get("pop_female_15_17") or 0)
    k_4=age_5_9; g5_8=round(age_10_14*0.8); g9_12=round(age_10_14*0.2)+age_15_17
    hh_total=r.get("hh_total_for_income") or 0
    hh_under_50=sum((r.get(f"hh_inc_{b}") or 0) for b in ["u10k","10_15","15_20","20_25","25_30","30_35","35_40","40_45","45_50"])
    pct_hhi_u50=(hh_under_50/hh_total) if hh_total else None
    hh_snap_total=r.get("hh_total_for_snap") or 0; hh_snap_recv=r.get("hh_snap_recv") or 0
    pct_snap=(hh_snap_recv/hh_snap_total) if hh_snap_total else None
    hh_tenure_total=r.get("hh_total_tenure") or 0
    pct_renter=((r.get("hh_renter") or 0)/hh_tenure_total) if hh_tenure_total else None
    hh_type_total=r.get("hh_total_type") or 0
    pct_family=((r.get("hh_family") or 0)/hh_type_total) if hh_type_total else None
    pop_total=r.get("pop_total") or 0
    pct_black=((r.get("pop_black_alone_all_ages") or 0)/pop_total) if pop_total else None
    pct_hisp=((r.get("pop_hispanic_all_ages") or 0)/pop_total) if pop_total else None
    return {"pop_total":pop_total,"pop_under5":under5,"pop_5_9":age_5_9,"pop_10_14":age_10_14,"pop_15_17":age_15_17,
        "pop_k_4_est":k_4,"pop_5_8_est":g5_8,"pop_9_12_est":g9_12,"hh_total":hh_total,"hh_under_50k":hh_under_50,
        "pct_hhi_u50":pct_hhi_u50,"hh_snap_recv":hh_snap_recv,"pct_snap":pct_snap,"hh_median_income":r.get("hh_median_income"),
        "pct_renter":pct_renter,"pct_family":pct_family,"pct_black":pct_black,"pct_hispanic":pct_hisp}
def fetch_tract_snap_income(state, county, bgs):
    params={"get":"GEO_ID,NAME,B22001_001E,B22001_002E,B19013_001E","for":"tract:*","in":f"state:{state} county:{county}"}
    if KEY: params["key"]=KEY
    rows=getjson(f"{API}?{urllib.parse.urlencode(params)}", timeout=60)
    hdr=rows[0]; gi=hdr.index("GEO_ID")
    td={}
    for row in rows[1:]:
        g=row[gi].split("US")[-1]
        def num(c):
            v=row[hdr.index(c)]
            try: return int(v) if v not in (None,"","null") else None
            except ValueError: return None
        td[g]={"u":num("B22001_001E"),"r":num("B22001_002E"),"mi":num("B19013_001E")}
    tract_hh={}
    for g,bg in bgs.items(): t=g[:11]; tract_hh[t]=tract_hh.get(t,0)+(bg.get("hh_total_for_income") or 0)
    for g,bg in bgs.items():
        t=g[:11]; d=td.get(t,{}); u=d.get("u") or 0; rr=d.get("r") or 0
        bg["pct_snap"]=(rr/u) if u else None
        share=(bg.get("hh_total_for_income") or 0)/tract_hh[t] if tract_hh.get(t) else 0
        bg["hh_total_for_snap"]=int(round(u*share)) if u else 0
        bg["hh_snap_recv"]=int(round(rr*share)) if rr else 0
        if not bg.get("hh_median_income"): bg["hh_median_income"]=d.get("mi")

# ---------------------------------------------------------------- transforms
def t_sbd(f):
    p=f.get("properties",{}) or {}
    d=p.get("DISTRICT")
    try: d=int(str(d).strip())
    except: return None
    return {"type":"Feature","properties":{"district":d,"county":"orange"},"geometry":f.get("geometry")}
def t_school(f):
    p=f.get("properties",{}) or {}
    num=str(p.get("SCHL_NUM") or "").strip()
    if not num: return None
    return {"type":"Feature","properties":{
        "loc_no": num.zfill(4), "loc_no_raw": num, "name": p.get("NAME"),
        "fac_type": p.get("FAC_TYPE"), "school_type": p.get("SCHOOL_TYP") or p.get("FAC_TYPE"),
        "sb_district": p.get("SB_DISTRIC"), "jurisdiction": p.get("JURISDICTI"),
        "address": p.get("ADDRESS"), "city": p.get("CITY"), "zip": p.get("ZIP"),
        "learn_comm": p.get("LEARN_COMM"),
    }, "geometry": f.get("geometry")}
def t_zone(stype):
    def fn(f):
        p=f.get("properties",{}) or {}
        return {"type":"Feature","properties":{
            "loc_no": str(p.get("SCHL_NUM") or "").strip().zfill(4),
            "name": p.get("SCHOOL") or p.get("SCHOOL_1") or p.get("NAME"),
            "school_type": stype}, "geometry": f.get("geometry")}
    return fn

# ---------------------------------------------------------------- run
if __name__ == "__main__":
    print("Orange County (FL 12095 / district 48) fetch")
    print("[1/6] TIGER block groups + county polygon")
    tiger("tigerWMS_ACS2023", 10, "STATE='12' AND COUNTY='095'", "orange_blockgroups.geojson",
          "GEOID,STATE,COUNTY,TRACT,BLKGRP")
    time.sleep(1)
    tiger("tigerWMS_Current", 82, "STATE='12' AND COUNTY='095'", "orange_county.geojson", "GEOID,NAME,STATE,COUNTY")
    time.sleep(1)

    if KEY:
        print("[2/6] ACS block-group demographics")
        raw = fetch_acs_county("12", "095")
        acs = {g: {**rec, **derive(rec)} for g, rec in raw.items()}
        print(f"  {len(acs)} block groups (ACS)")
        print("[3/6] ACS tract SNAP + median income (apportioned)")
        try:
            fetch_tract_snap_income("12", "095", acs)
            for g in acs: acs[g].update(derive(acs[g]))  # recompute with refined snap/income
        except Exception as e:
            print("  tract refine skipped:", e)
        json.dump(acs, open(f"{OUT}/acs_orange.json", "w"))
        print("  acs_orange.json written")
    else:
        print("[2/6] ACS SKIPPED — no CENSUS_API_KEY set. Set it and re-run for demographics.")

    print("[4/6] School Board District polygons (7)")
    arcgis_geojson("https://services8.arcgis.com/KROpZDerJ9MICPIU/arcgis/rest/services/School_Board_Districts/FeatureServer",
                   1, "orange_sbd.geojson", transform=t_sbd)

    print("[5/6] OCPS schools (+charters)")
    arcgis_geojson("https://services1.arcgis.com/OIHmIXKmWvkweUZp/arcgis/rest/services/All_Schools_2526_Online_WFL1/FeatureServer",
                   0, "orange_schools.geojson", transform=t_school)

    print("[6/6] Attendance zones (ES/MS/HS merged)")
    base = "https://services1.arcgis.com/OIHmIXKmWvkweUZp/arcgis/rest/services"
    zones = []
    for svc, st in [("Elementary_School_Zones_2526","ES"),("Middle_School_Zones_2526","MS"),("High_School_Zones_2526","HS")]:
        try:
            fc = arcgis_geojson(f"{base}/{svc}/FeatureServer", 0, f"_tmp_{st}.geojson", transform=t_zone(st))
            zones += fc["features"]
        except Exception as e:
            print(f"  {svc} failed:", e)
    json.dump({"type":"FeatureCollection","features":zones}, open(f"{OUT}/orange_boundaries.geojson","w"))
    for st in ["ES","MS","HS"]:
        p=f"{OUT}/_tmp_{st}.geojson"
        if os.path.exists(p): os.remove(p)
    print(f"  orange_boundaries.geojson: {len(zones)} zones")
    print("\nDONE.")
