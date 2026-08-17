import { h, render } from "https://esm.sh/preact@10.22.0";
import { useEffect, useRef, useState } from "https://esm.sh/preact@10.22.0/hooks";
import htm from "https://esm.sh/htm@3.1.1";

// ==== utils.js ====
const fmt = {
  int: (v) => v == null ? "—" : Math.round(v).toLocaleString(),
  pct: (v, d = 1) => v == null ? "—" : (v * 100).toFixed(d) + "%",
  money: (v) => v == null ? "—" : "$" + Math.round(v).toLocaleString(),
  signed: (v, d = 1) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%",
};

// Color ramps (d3-like) — avoiding a d3 dep.
const RAMP_ORANGE = ["#fff7ed","#ffedd5","#fed7aa","#fdba74","#fb923c","#f97316","#ea580c","#c2410c","#9a3412"];
const RAMP_BLUE   = ["#f0f9ff","#e0f2fe","#bae6fd","#7dd3fc","#38bdf8","#0ea5e9","#0284c7","#0369a1","#075985"];
const RAMP_GREEN  = ["#f0fdf4","#dcfce7","#bbf7d0","#86efac","#4ade80","#22c55e","#16a34a","#15803d","#166534"];
const RAMP_RED    = ["#fef2f2","#fee2e2","#fecaca","#fca5a5","#f87171","#ef4444","#dc2626","#b91c1c","#991b1b"];
const RAMP_PURPLE = ["#faf5ff","#f3e8ff","#e9d5ff","#d8b4fe","#c084fc","#a855f7","#9333ea","#7e22ce","#6b21a8"];

// ---- School performance (proficiency) color scale: red → amber → green ----
// Used by the School Performance map layer + the focused-school detail bars so
// the two always agree. pct is "% scoring Level 3+" (0-100).
const PROF_STOPS = [
  [0,  "#b91c1c"], // red-700
  [35, "#f87171"], // red-400
  [50, "#f59e0b"], // amber-500
  [60, "#eab308"], // yellow-500
  [70, "#84cc16"], // lime-500
  [85, "#16a34a"], // green-600
  [100,"#166534"], // green-800
];
const PROF_NULL = "#cbd5e1"; // slate-300 for "no data"

function hex2rgb(h){ return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]; }
function rgb2hex(r){ return "#"+r.map(v=>Math.round(v).toString(16).padStart(2,"0")).join(""); }

// JS color lookup (for legend swatches + detail bars)
function profColor(pct){
  if (pct == null || isNaN(pct)) return PROF_NULL;
  const s = PROF_STOPS;
  if (pct <= s[0][0]) return s[0][1];
  if (pct >= s[s.length-1][0]) return s[s.length-1][1];
  for (let i=0;i<s.length-1;i++){
    const [a,ca]=s[i], [b,cb]=s[i+1];
    if (pct>=a && pct<=b){
      const t=(pct-a)/(b-a), ra=hex2rgb(ca), rb=hex2rgb(cb);
      return rgb2hex([0,1,2].map(k=>ra[k]+t*(rb[k]-ra[k])));
    }
  }
  return PROF_NULL;
}

// MapLibre interpolate expression for the same scale, with a null/no-data case.
function profColorExpr(field){
  const interp = ["interpolate", ["linear"], ["to-number", ["get", field]]];
  for (const [v,c] of PROF_STOPS){ interp.push(v, c); }
  return ["case", ["==", ["get", field], null], PROF_NULL, interp];
}

// Letter-grade → color (A green … F red)
function gradeColor(g){
  return { A:"#15803d", B:"#65a30d", C:"#ca8a04", D:"#ea580c", F:"#b91c1c" }[g] || "#9ca3af";
}

// FL DOE grade year → school-year label. 2026 -> "2025-26".
function schoolYearLabel(y){
  return y ? `${y - 1}-${String(y).slice(2)}` : "—";
}

// Latest grade year a performance record actually carries. Records are stamped
// with data_year by etl/24_parse_school_grades.py; a school absent from the
// newest FL DOE release keeps its prior-year vintage, so read it per-record
// rather than assuming the current year everywhere.
const PERF_LATEST_YEAR_FALLBACK = 2026;
function perfYear(rec){
  return (rec && rec.data_year) || PERF_LATEST_YEAR_FALLBACK;
}

// Given an array of numeric values compute quantile breaks for N buckets
function quantileBreaks(values, n = 9) {
  const v = values.filter(x => x != null && Number.isFinite(x)).slice().sort((a,b)=>a-b);
  if (!v.length) return new Array(n).fill(0);
  const out = [];
  for (let i = 1; i < n; i++) {
    const p = i / n;
    const idx = Math.min(v.length - 1, Math.floor(p * v.length));
    out.push(v[idx]);
  }
  return out;
}

// Build MapLibre step expression from breaks + ramp.
// MapLibre requires strictly-increasing stop values, but quantile breaks
// on sparse fields (e.g. pct_black in mostly-white block groups) can repeat 0.
// Dedupe consecutive equal breaks so the paint expression stays valid.
function stepExpr(field, breaks, ramp) {
  // ["step", ["get", field], color0, break1, color1, break2, color2, ...]
  const exp = ["step", ["coalesce", ["to-number", ["get", field]], -1e9], ramp[0]];
  let prev = -Infinity;
  let ci = 1;
  for (let i = 0; i < breaks.length; i++) {
    const b = breaks[i];
    if (b == null || !Number.isFinite(b)) { ci++; continue; }
    if (b <= prev) { ci++; continue; }            // skip duplicate/regressive stop
    exp.push(b, ramp[Math.min(ci, ramp.length - 1)]);
    prev = b;
    ci++;
  }
  return exp;
}

// ==== suitability.js ====
// Per-variable weighted suitability, mirroring slide 45 of the MEETING EDITS deck.
// Each component's score = (subject_value / max_value_across_cohort) * max_weight, capped at max_weight.
// Total max weights sum to 100.
//
// Components (default max weights from slide 45):
//  pop_total          5
//  pop_growth_5yr     5    (not yet in our data — defaulted to 0 until projections added)
//  pct_hhi_u50       10
//  pct_snap          10
//  pop_k_4_est       20
//  pop_5_8_est       20
//  k_4_growth         5    (0 until projections)
//  5_8_growth         5    (0 until projections)
//  pct_black         12
//  pct_hispanic       8

const DEFAULT_WEIGHTS = {
  pop_total: 5,
  pop_growth_5yr: 5,
  pct_hhi_u50: 10,
  pct_snap: 10,
  pop_k_4_est: 20,
  pop_5_8_est: 20,
  k_4_growth_5yr: 5,
  "5_8_growth_5yr": 5,
  pct_black: 12,
  pct_hispanic: 8,
};

const WEIGHT_LABELS = {
  pop_total: "Population (2025)",
  pop_growth_5yr: "5-Year Growth (2025-2030)",
  pct_hhi_u50: "% HHI Below $50k",
  pct_snap: "% Homes on SNAPS",
  pop_k_4_est: "K-4th Grade Population",
  pop_5_8_est: "5-8th Grade Population",
  k_4_growth_5yr: "K-4th Growth",
  "5_8_growth_5yr": "5-8th Growth",
  pct_black: "Black Population (%) K-8",
  pct_hispanic: "Hispanic Population (%) K-8",
};

// Read a field from a record. The weight-key namespace is the rollup schema;
// BG-level records use a different naming convention for projection fields
// ("pop_total_growth_5yr" vs "pop_growth_5yr"), so map the aliases here.
const BG_ALIAS = {
  pop_growth_5yr:    "pop_total_growth_5yr",
  k_4_growth_5yr:    "pop_k_4_est_growth_5yr",
  "5_8_growth_5yr":  "pop_5_8_est_growth_5yr",
};
function val(rec, key) {
  if (rec[key] != null) return rec[key];
  const alt = BG_ALIAS[key];
  if (alt && rec[alt] != null) return rec[alt];
  return null;
}

// Compute a suitability score for one record, using min-max normalization within the cohort.
// cohortMin defaults to {} (treated as 0), giving the same result as before for all-positive fields.
// For growth fields where every campus is declining (all negative), min-max still gives relative scores.
function score(rec, cohortMax, weights = DEFAULT_WEIGHTS, cohortMin = {}) {
  let total = 0;
  const parts = {};
  for (const k of Object.keys(weights)) {
    const maxW = weights[k];
    if (!maxW) { parts[k] = 0; continue; }
    const mx = cohortMax[k] ?? 0;
    const mn = cohortMin[k] ?? 0;
    const v = val(rec, k) ?? 0;
    if (mx <= mn) { parts[k] = 0; continue; }
    const share = Math.max(0, Math.min(1, (v - mn) / (mx - mn)));
    const pts = share * maxW;
    parts[k] = pts;
    total += pts;
  }
  return { total, parts };
}

// Given a cohort (array of [id, rec]), return {maxes, mins, scored: [{id, rec, score, parts}], avg}
function rankCohort(cohort, weights = DEFAULT_WEIGHTS) {
  const maxes = {}, mins = {};
  for (const k of Object.keys(weights)) {
    let mn = Infinity, mx = -Infinity;
    for (const [,rec] of cohort) {
      const v = val(rec, k);
      if (v != null) {
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
    }
    maxes[k] = mx === -Infinity ? 0 : mx;
    mins[k]  = mn === Infinity  ? 0 : mn;
  }
  const scored = cohort.map(([id, rec]) => {
    const s = score(rec, maxes, weights, mins);
    return { id, rec, score: s.total, parts: s.parts };
  });
  const avg = scored.reduce((a, x) => a + x.score, 0) / (scored.length || 1);
  return { maxes, mins, scored, avg };
}

// ==== region.js ====
// Region configuration — the single place that knows how Florida and New Jersey
// differ. Everything else in the app reads from here so adding a region (or
// changing one) doesn't mean hunting through five files.
//
// The two regions are deliberately NOT symmetric:
//   • Florida is organized by county + school-board district (SBD). NJ districts
//     here are citywide, so the meaningful sub-city unit is the WARD.
//   • The Florida-specific layers (School of Hope eligibility, Persistently
//     Low-Performing) have no NJ analog and are omitted there.
//   • NJ has no statewide A-F letter grade, so the detail card's grade tile and
//     grade trend are Florida-only.
//
// The NJ ETL deliberately emits the same property names as the Florida data
// (`role`, `enrollment_2526`, `ela_math`, `id`, `name`, `city`, `county`), which
// lets the school-point, performance and heat-map layers be shared outright —
// only the source data is swapped when the region changes.

const REGIONS = {
  fl: {
    id: "fl",
    label: "Florida",
    short: "FL",
    eyebrow: "KIPP Miami · Growth & Facilities",
    subLabel: "Broward · Miami-Dade · Orange",
    sourceLine: "ACS 5-Yr 2023 · FL DOE 2025–26",
    statewide: { center: [-81.7, 27.9], zoom: 6.3, label: "Statewide" },
    // Sub-regions shown as the segmented control in the top bar.
    areas: [
      { id: "broward",   label: "Broward",    center: [-80.22, 26.15], zoom: 9.2 },
      { id: "miamidade", label: "Miami-Dade", center: [-80.35, 25.75], zoom: 9.2 },
      { id: "orange",    label: "Orange",     center: [-81.34, 28.51], zoom: 9.2 },
    ],
    data: {
      schools: "universalSchools",
      performance: "schoolPerformance",
      rings: "universalRings",
      enrollment: "enrollBySchool",
      blockGroups: ["bgBroward", "bgMiami", "bgOrange"],
      acs: "acs",
    },
    // Government Boundaries panel: one group per county.
    boundaryGroups: [
      { label: "Broward", items: [
        { flag: "showBrowardSBD",    title: "School Board Districts", caption: "D1–D7" },
        { flag: "showBrowardPlaces", title: "Municipal Boundaries",
          caption: "incorporated city/town limits", countKey: "browardPlaces" },
      ]},
      { label: "Miami-Dade", items: [
        { flag: "showMiamiDadeSBD",    title: "School Board Districts", caption: "D1–D9" },
        { flag: "showMiamiDadePlaces", title: "Municipal Boundaries",
          caption: "incorporated city/town limits", countKey: "mdcPlaces" },
      ]},
      { label: "Orange", items: [
        { flag: "showOrangeSBD",    title: "School Board Districts", caption: "D1–D7" },
        { flag: "showOrangePlaces", title: "Municipal Boundaries",
          caption: "incorporated city/town limits", countKey: "orangePlaces" },
      ]},
    ],
    // Map layer ids owned by this region, hidden when the other region is active.
    ownedLayers: [
      "sbd-brw-fill", "sbd-brw-line", "sbd-mdc-fill", "sbd-mdc-line",
      "sbd-org-fill", "sbd-org-line",
      "places-brw-fill", "places-brw-line", "places-mdc-fill", "places-mdc-line",
      "places-org-fill", "places-org-line",
      "school-dots-underutilized", "school-dots-plp", "plp-radius-fill", "plp-radius-line",
    ],
    hasStateSpecific: true,       // School of Hope + PLP section
    hasLetterGrades: true,
    hasStepUp: true,              // Step Up private schools
    subAreaNoun: "District",      // "District 5" in the analysis panel
    subAreaNounPlural: "Districts",
    analysisTitle: "District Analysis · Charter Ops · Step Up",
    perfCaption: "% scoring Level 3+ (ELA+Math)",
    perfSourceNote: "FL DOE School Grades",
  },

  nj: {
    id: "nj",
    label: "New Jersey",
    short: "NJ",
    eyebrow: "KIPP NJ · Growth & Facilities",
    subLabel: "Newark · Camden · Paterson",
    sourceLine: "ACS 5-Yr 2023 · NJ DOE 2025–26 · NJSLA 2024–25",
    // Framed to hold all three cities at once: Camden (39.94) up to Paterson
    // (40.92), rather than the geographic center of the state.
    statewide: { center: [-74.62, 40.44], zoom: 8.3, label: "All 3 cities" },
    areas: [
      { id: "newark",   label: "Newark",   center: [-74.172, 40.735], zoom: 11.4 },
      { id: "camden",   label: "Camden",   center: [-75.105, 39.938], zoom: 12.0 },
      { id: "paterson", label: "Paterson", center: [-74.163, 40.917], zoom: 12.0 },
    ],
    data: {
      schools: "njSchools",
      performance: "njPerformance",
      rings: "njRings",
      enrollment: "njEnrollment",
      blockGroups: ["njBlockgroups"],
      acs: "acsNj",
    },
    // NJ cities are divided by ward rather than school-board district.
    boundaryGroups: [
      { label: "Newark", items: [
        { flag: "showNewarkWards",  title: "Wards", caption: "5 wards · Central/East/North/South/West" },
        { flag: "showNewarkPlaces", title: "City Boundary", caption: "municipal limits" },
      ]},
      { label: "Camden", items: [
        { flag: "showCamdenWards",  title: "Wards", caption: "4 wards" },
        { flag: "showCamdenPlaces", title: "City Boundary", caption: "municipal limits" },
      ]},
      { label: "Paterson", items: [
        { flag: "showPatersonWards",  title: "Wards", caption: "6 wards" },
        { flag: "showPatersonPlaces", title: "City Boundary", caption: "municipal limits" },
      ]},
    ],
    ownedLayers: [
      "wards-nwk-fill", "wards-nwk-line", "wards-cam-fill", "wards-cam-line",
      "wards-pat-fill", "wards-pat-line",
      "njplaces-nwk-line", "njplaces-cam-line", "njplaces-pat-line",
    ],
    hasStateSpecific: false,
    hasLetterGrades: false,
    hasStepUp: false,
    subAreaNoun: "Ward",
    subAreaNounPlural: "Wards",
    analysisTitle: "Ward Analysis",
    perfCaption: "% meeting/exceeding expectations (NJSLA ELA+Math)",
    perfSourceNote: "NJSLA",
  },
};

const REGION_IDS = ["fl", "nj"];

// city/county id -> the 3-letter tag used in map layer ids
const AREA_TAG = {
  broward: "brw", miamidade: "mdc", orange: "org",
  newark: "nwk", camden: "cam", paterson: "pat",
};

function regionCfg(region) {
  return REGIONS[region] || REGIONS.fl;
}

// Which region does a given area id belong to?
function regionOfArea(areaId) {
  for (const r of REGION_IDS) {
    if (REGIONS[r].areas.some(a => a.id === areaId)) return r;
  }
  return "fl";
}

// Pull the active region's slice of the loaded dataset. Returns the same shape
// for both regions so callers don't branch.
function regionData(data, region) {
  if (!data) return null;
  const d = regionCfg(region).data;
  const bgs = d.blockGroups.map(k => data[k]).filter(Boolean);
  return {
    schools: data[d.schools] || null,
    performance: data[d.performance] || null,
    rings: data[d.rings] || null,
    enrollment: data[d.enrollment] || null,
    blockGroups: bgs,
    acs: data[d.acs] || {},
  };
}

// Performance lookup key. Florida keys on "<district>-<school_num>" (built from
// county + school number); NJ keys performance by the school id directly, so the
// ETL didn't have to invent a parallel key space.
function perfKeyFor(region, props) {
  if (!props) return null;
  if (region === "nj") return props.id || null;
  const num = props.school_num;
  if (!num) return null;
  const d = props.county === "miamidade" ? "13" : props.county === "orange" ? "48" : "06";
  return `${d}-${num}`;
}

// Enrollment-history lookup key, same reasoning as perfKeyFor.
function enrollKeyFor(region, props) {
  if (!props) return null;
  if (region === "nj") return props.id || null;
  if (props.enroll_key) return props.enroll_key;
  if (!props.school_num) return null;
  const d = props.county === "miamidade" ? "13" : props.county === "orange" ? "48" : "06";
  return `${d}-${props.school_num}`;
}

// ==== state.js ====
// Data loader + small reactive store.
// All GeoJSON/JSON lives in ../data/processed (symlinked as ./data/).

async function j(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadAll() {
  // Standalone build bakes all data into globalThis.__DATA so the tool works
  // from a single file:// HTML with no server / no fetch.
  if (typeof globalThis !== "undefined" && globalThis.__DATA) return globalThis.__DATA;
  const [
    schools, sbd, bgBroward, bgMiami, counties,
    acsBroward, acsMiami, campusRollup, sbdRollup, countyRollup, schema, bgAssignment,
    bcpsBoundaries,
  ] = await Promise.all([
    j("./data/schools.geojson"),
    j("./data/broward_sbd.geojson"),
    j("./data/broward_blockgroups.geojson"),
    j("./data/miamidade_blockgroups.geojson"),
    j("./data/counties.geojson"),
    j("./data/acs_broward.json"),
    j("./data/acs_miamidade.json"),
    j("./data/campus_rollup.json"),
    j("./data/sbd_rollup.json"),
    j("./data/county_rollup.json"),
    j("./data/acs_schema.json"),
    j("./data/bg_sbd_assignment.json"),
    j("./data/bcps_boundaries.geojson").catch(() => null),
  ]);
  const [stepupSchools, stepupSbdRollup, campusEnroll, districtEnroll, enrollBySchool, charterOperators,
         mdcSbd, mdcSbdRollup, stepupMdcSbdRollup, mdcBoundaries, mdcSchools, universalSchools, universalRings,
         charterOperatorsMdc, schoolCapacity, plpSchools, schoolPerformance] = await Promise.all([
    j("./data/stepup_schools.geojson").catch(() => null),
    j("./data/stepup_sbd_rollup.json").catch(() => null),
    j("./data/campus_enrollment_5yr.json").catch(() => null),
    j("./data/district_enrollment_5yr.json").catch(() => null),
    j("./data/fldoe_enrollment_by_school.json").catch(() => null),
    j("./data/charter_operators.json").catch(() => null),
    j("./data/miamidade_sbd.geojson").catch(() => null),
    j("./data/miamidade_sbd_rollup.json").catch(() => null),
    j("./data/stepup_mdc_sbd_rollup.json").catch(() => null),
    j("./data/miamidade_boundaries.geojson").catch(() => null),
    j("./data/miamidade_schools.geojson").catch(() => null),
    j("./data/universal_schools.geojson").catch(() => null),
    j("./data/universal_rings.json").catch(() => null),
    j("./data/charter_operators_mdc.json").catch(() => null),
    j("./data/school_capacity.json").catch(() => null),
    j("./data/plp_schools.json").catch(() => null),
    j("./data/school_performance.json").catch(() => null),
  ]);

  // ---------- Orange County (Orlando) — third region ----------
  const [orangeUniversal, orangePerf, acsOrange, bgOrange, orangeRings,
         orangePlp, orangeEnroll, orangeSbd, orangeSbdRollup, orangeCapacity] = await Promise.all([
    j("./data/orange_universal_schools.geojson").catch(() => null),
    j("./data/orange_school_performance.json").catch(() => null),
    j("./data/acs_orange.json").catch(() => null),
    j("./data/orange_blockgroups.geojson").catch(() => null),
    j("./data/orange_rings.json").catch(() => null),
    j("./data/orange_plp.json").catch(() => null),
    j("./data/orange_enrollment_by_school.json").catch(() => null),
    j("./data/orange_sbd.geojson").catch(() => null),
    j("./data/orange_sbd_rollup.json").catch(() => null),
    j("./data/orange_capacity.json").catch(() => null),
  ]);

  // ---------- Municipal boundaries (incorporated places) ----------
  const [browardPlaces, mdcPlaces, orangePlaces] = await Promise.all([
    j("./data/broward_places.geojson").catch(() => null),
    j("./data/miamidade_places.geojson").catch(() => null),
    j("./data/orange_places.geojson").catch(() => null),
  ]);

  // ---------- New Jersey (Newark · Camden · Paterson) ----------
  // NJ cities are divided by ward rather than school-board district, and the
  // NJ ETL emits the same property names as the FL data so the school/heat-map
  // layers can be shared.
  const [njWards, njPlaces, njBlockgroups, acsNj, njWardRollup, njCityRollup,
         bgNjWardAssignment, njSchools, njPerformance, njEnrollment, njRings] = await Promise.all([
    j("./data/nj_wards.geojson").catch(() => null),
    j("./data/nj_places.geojson").catch(() => null),
    j("./data/nj_blockgroups.geojson").catch(() => null),
    j("./data/acs_nj.json").catch(() => null),
    j("./data/nj_ward_rollup.json").catch(() => null),
    j("./data/nj_city_rollup.json").catch(() => null),
    j("./data/bg_nj_ward_assignment.json").catch(() => null),
    j("./data/nj_schools.geojson").catch(() => null),
    j("./data/nj_school_performance.json").catch(() => null),
    j("./data/nj_enrollment.json").catch(() => null),
    j("./data/nj_rings.json").catch(() => null),
  ]);

  // Merge Orange into the combined structures the layers already iterate, so the
  // school-dots / performance / heatmap / rings / PLP code picks it up unchanged.
  const mergedUniversal = universalSchools
    ? { ...universalSchools, features: [...universalSchools.features, ...((orangeUniversal && orangeUniversal.features) || [])] }
    : orangeUniversal;

  return {
    schools, sbd, bgBroward, bgMiami, counties,
    acs: { ...acsBroward, ...acsMiami, ...(acsOrange || {}) },
    acsBroward, acsMiami, acsOrange,
    campusRollup, sbdRollup, countyRollup, schema, bgAssignment,
    bcpsBoundaries,
    stepupSchools, stepupSbdRollup,
    campusEnroll, districtEnroll,
    enrollBySchool: { ...(enrollBySchool || {}), ...(orangeEnroll || {}) },
    charterOperators, charterOperatorsMdc,
    mdcSbd, mdcSbdRollup, stepupMdcSbdRollup, mdcBoundaries, mdcSchools,
    universalSchools: mergedUniversal,
    universalRings: { ...(universalRings || {}), ...(orangeRings || {}) },
    schoolCapacity: { ...(schoolCapacity || {}), ...(orangeCapacity || {}) },
    plpSchools: { ...(plpSchools || {}), ...(orangePlp || {}) },
    schoolPerformance: { ...(schoolPerformance || {}), ...(orangePerf || {}) },
    // Orange-specific layers/sources
    bgOrange, orangeSbd, orangeSbdRollup,
    // Municipal boundaries (incorporated places), per county
    browardPlaces, mdcPlaces, orangePlaces,
    // New Jersey
    njWards, njPlaces, njBlockgroups, acsNj, njWardRollup, njCityRollup,
    bgNjWardAssignment, njSchools, njPerformance, njEnrollment, njRings,
  };
}

// Build the join key the performance dataset uses: "<district>-<school_num>"
// (06 = Broward, 13 = Miami-Dade). Mirrors the enroll_key pattern in campus.js.
function perfKey(props) {
  if (!props) return null;
  const num = props.school_num;
  if (!num) return null;
  const d = props.county === "miamidade" ? "13" : props.county === "orange" ? "48" : "06";
  return `${d}-${num}`;
}

// Small signal-like subscribable store
function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set: (patch) => {
      state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
      subs.forEach(fn => fn(state));
    },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

// ==== app.js ====
// KIPP Demographics — main app bootstrap. Unified single-panel interface.
const html = htm.bind(h);
const store = createStore({
  data:              null,
  region:            "fl",              // "fl" | "nj" — see web/region.js
  county:            "broward",         // active sub-area (FL county / NJ city)
  ring:              "5min",
  focusCampus:       null,
  focusDistrict:     null,
  heatLayer:         "pop_k_8_est",
  weights:           null,
  showHeatMap:       false,
  showPerformance:   false,              // school performance bubbles (proficiency color + sector shape)
  perfMetric:        "ela_math",         // which proficiency drives the bubble color
  showBrowardSBD:    true,               // per-county SBD/boundary map layers
  showMiamiDadeSBD:  true,
  showOrangeSBD:     true,
  showBrowardPlaces:   false,            // per-county municipal (incorporated place) boundaries
  showMiamiDadePlaces: false,
  showOrangePlaces:    false,
  // New Jersey: wards are the sub-city unit, plus the city outline itself
  showNewarkWards:     true,
  showCamdenWards:     true,
  showPatersonWards:   true,
  showNewarkPlaces:    false,
  showCamdenPlaces:    false,
  showPatersonPlaces:  false,
  showStepUp:        false,
  showCharters:      false,
  showPublicSchools: false,
  showUnderutilized: false,
  showPlp:           false,
  showPlpRadius:     true,   // when a PLP school is focused, draw 5-mile radius
  schoolSearch:      "",
});

// Shared helper: pull school-dot + radius + campus-ring layers to the top
// so they're never hidden by the heat map or SBD fill. Called from every
// render path + syncLayerVisibility so layer order is self-healing.
function moveSchoolsOnTop(m) {
  for (const id of [
    "school-dots-underutilized",
    "school-dots-public",
    "school-dots-charter",
    "school-dots-perf",
    "school-dots-plp",
    "plp-radius-fill",
    "plp-radius-line",
    "campus-rings-fill",
    "campus-rings-line",
  ]) {
    if (m.getLayer(id)) m.moveLayer(id);
  }
}

// ---------- Display / theme UI state (persisted separately from app data state) ----------
const UI_KEY = "kipp-demographics-ui";
const UI_DEFAULTS = { ui: "dark", layout: "dock", theme: "miami", density: "comfortable", markers: "solid", rail: "on" };
const TILES = {
  dark: [
    "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  ],
  light: [
    "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  ],
};
function tileSet(mode) { return TILES[mode] || TILES.dark; }
function loadUi() {
  try { return { ...UI_DEFAULTS, ...JSON.parse(localStorage.getItem(UI_KEY) || "{}") }; }
  catch (e) { return { ...UI_DEFAULTS }; }
}
function applyMarkerStyle(m, mode) {
  const hollow = mode === "hollow";
  const rows = [
    ["school-dots-public",        hollow ? 0.16 : 0.82, hollow ? 2 : 1,   hollow ? "#2563eb" : "#ffffff"],
    ["school-dots-charter",       hollow ? 0.16 : 0.9,  hollow ? 2 : 2,   hollow ? "#f59e0b" : "#78350f"],
    ["school-dots-underutilized", hollow ? 0.16 : 0.75, hollow ? 2 : 1.5, hollow ? "#16a34a" : "#ffffff"],
  ];
  for (const [id, op, sw, sc] of rows) {
    if (!m.getLayer(id)) continue;
    m.setPaintProperty(id, "circle-opacity", op);
    m.setPaintProperty(id, "circle-stroke-width", sw);
    if (id !== "school-dots-underutilized") m.setPaintProperty(id, "circle-stroke-color", sc);
  }
}
function applyUi(u) {
  const r = document.documentElement;
  r.dataset.ui = u.ui; r.dataset.layout = u.layout; r.dataset.theme = u.theme;
  r.dataset.density = u.density; r.dataset.markers = u.markers; r.dataset.rail = u.rail;
  try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch (e) {}
  mapReady.then((m) => {
    const s = m.getSource("carto");
    if (s && s.setTiles) s.setTiles(tileSet(u.ui));
    applyMarkerStyle(m, u.markers);
    setTimeout(() => m.resize(), 240);
  });
}

const ACCENTS = [
  { id: "miami",    label: "Miami",    color: "#F9A21A" },
  { id: "newark",   label: "Newark",   color: "#57C0E9" },
  { id: "paterson", label: "Paterson", color: "#EE3C37" },
  { id: "camden",   label: "Camden",   color: "#C3D52E" },
];

// ---------- Map singleton ----------
let map = null;
const mapReady = new Promise(resolve => { window.__mapResolve = resolve; });

function initMap() {
  const initialUi = loadUi();
  map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        carto: {
          type: "raster",
          tiles: tileSet(initialUi.ui),
          tileSize: 256,
          attribution: "© OpenStreetMap © CARTO",
        },
      },
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      layers: [{ id: "carto", type: "raster", source: "carto" }],
    },
    center: [-81.7, 27.9],   // statewide view framing all three regions (Miami-Dade → Orange)
    zoom: 6.3,
    attributionControl: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
  map.on("load", () => {
    window.__map = map;
    applyMarkerStyle(map, initialUi.markers);
    window.__mapResolve(map);
  });
}

function getMap() { return mapReady; }
const getMapIdle = getMap;

// Sync all layer visibility in one place — called whenever show-flags change.
async function syncLayerVisibility(state) {
  const m = await mapReady;

  // Heat map choropleth
  ["bg-heat", "bg-outline"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", state.showHeatMap ? "visible" : "none");
  });

  const region = state.region || "fl";
  const isFL = region === "fl";
  const sbdVis = (vis) => vis ? "visible" : "none";

  // Hide every layer owned by the region that isn't active. Layers shared
  // between regions (school dots, performance, heat map) aren't listed as
  // owned — their *source data* is swapped on region change instead.
  for (const other of REGION_IDS) {
    if (other === region) continue;
    for (const id of regionCfg(other).ownedLayers) {
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", "none");
    }
  }

  // Per-county SBD fill + line (Florida)
  ["sbd-brw-fill", "sbd-brw-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(isFL && state.showBrowardSBD));
  });
  ["sbd-mdc-fill", "sbd-mdc-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(isFL && state.showMiamiDadeSBD));
  });
  ["sbd-org-fill", "sbd-org-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(isFL && state.showOrangeSBD));
  });

  // Per-county municipal (incorporated place) boundary fill + line (Florida)
  ["places-brw-fill", "places-brw-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(isFL && state.showBrowardPlaces));
  });
  ["places-mdc-fill", "places-mdc-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(isFL && state.showMiamiDadePlaces));
  });
  ["places-org-fill", "places-org-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(isFL && state.showOrangePlaces));
  });

  // New Jersey wards + city outlines
  const njWardFlag = { nwk: "showNewarkWards", cam: "showCamdenWards", pat: "showPatersonWards" };
  const njPlaceFlag = { nwk: "showNewarkPlaces", cam: "showCamdenPlaces", pat: "showPatersonPlaces" };
  for (const [tag, flag] of Object.entries(njWardFlag)) {
    [`wards-${tag}-fill`, `wards-${tag}-line`].forEach(id => {
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(!isFL && state[flag]));
    });
  }
  for (const [tag, flag] of Object.entries(njPlaceFlag)) {
    const id = `njplaces-${tag}-line`;
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(!isFL && state[flag]));
  }

  // Per-county District labels (HTML markers tagged with .dataset.sbdCounty)
  (window.__sbdLabelMarkers || []).forEach(lm => {
    const el = lm.getElement();
    const tag = el.dataset.sbdCounty;
    const on = isFL && (tag === "mdc" ? state.showMiamiDadeSBD
      : tag === "org" ? state.showOrangeSBD : state.showBrowardSBD);
    el.style.display = on ? "" : "none";
  });

  // Ward labels (NJ)
  (window.__wardLabelMarkers || []).forEach(lm => {
    const el = lm.getElement();
    const on = !isFL && state[njWardFlag[el.dataset.wardTag]];
    el.style.display = on ? "" : "none";
  });

  // Step Up markers — Florida only (NJ has no equivalent private-school roster).
  (window.__stepupMarkers || []).forEach(mk => {
    mk.getElement().style.display = (isFL && state.showStepUp) ? "" : "none";
  });

  // Campus rings: show only when a school is focused
  const ringVis = state.focusCampus ? "visible" : "none";
  ["campus-rings-fill", "campus-rings-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", ringVis);
  });

  // All-schools bubble layers
  if (m.getLayer("school-dots-charter"))
    m.setLayoutProperty("school-dots-charter", "visibility", state.showCharters ? "visible" : "none");
  if (m.getLayer("school-dots-public"))
    m.setLayoutProperty("school-dots-public", "visibility", state.showPublicSchools ? "visible" : "none");

  // School Performance bubbles (proficiency color + sector shape)
  if (m.getLayer("school-dots-perf"))
    m.setLayoutProperty("school-dots-perf", "visibility", state.showPerformance ? "visible" : "none");

  // Underutilized schools (400+ surplus seats) — Florida only
  if (m.getLayer("school-dots-underutilized"))
    m.setLayoutProperty("school-dots-underutilized", "visibility",
      (isFL && state.showUnderutilized) ? "visible" : "none");

  // Persistently Low-Performing (PLP) schools — FL DOE 2024-25 list, Florida only
  if (m.getLayer("school-dots-plp"))
    m.setLayoutProperty("school-dots-plp", "visibility", (isFL && state.showPlp) ? "visible" : "none");

  // 5-mile radius around focused PLP school (separate from drive-time ring)
  const plpRadiusVis = (isFL && state.showPlpRadius && state.focusCampus
    && state.data?.plpSchools?.[state.focusCampus]) ? "visible" : "none";
  ["plp-radius-fill", "plp-radius-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", plpRadiusVis);
  });

  // Belt-and-suspenders: pull school/ring/radius layers above SBD + heatmap
  moveSchoolsOnTop(m);
}

// ---------- App shell ----------
function App() {
  const [state, setState] = useState(store.get());
  const [ui, setUi] = useState(loadUi());
  const [menu, setMenu] = useState(false);
  const isFirstCounty = useRef(true);

  useEffect(() => store.subscribe(setState), []);
  useEffect(() => {
    loadAll().then(d => store.set({ data: d }));
  }, []);
  useEffect(() => {
    if (!map && document.getElementById("map")) initMap();
  });
  useEffect(() => { applyUi(ui); }, [ui]);

  // Layer visibility sync
  useEffect(() => {
    if (state.data) syncLayerVisibility(state);
  }, [state.data, state.region, state.showHeatMap, state.showBrowardSBD, state.showMiamiDadeSBD,
      state.focusCampus, state.showCharters, state.showPublicSchools,
      state.showUnderutilized, state.showPlp, state.showPlpRadius, state.showStepUp,
      state.showPerformance, state.showOrangeSBD,
      state.showBrowardPlaces, state.showMiamiDadePlaces, state.showOrangePlaces,
      state.showNewarkWards, state.showCamdenWards, state.showPatersonWards,
      state.showNewarkPlaces, state.showCamdenPlaces, state.showPatersonPlaces]);

  // Fly to the active sub-area when it changes (skip first render)
  useEffect(() => {
    if (!state.data) return;
    if (isFirstCounty.current) { isFirstCounty.current = false; return; }
    const cfg = regionCfg(state.region);
    const area = cfg.areas.find(a => a.id === state.county) || cfg.areas[0];
    mapReady.then(m => m.flyTo({ center: area.center, zoom: area.zoom || 9.2, duration: 700 }));
  }, [state.county, state.region]);

  if (!state.data) {
    return html`<div class="shell" style="align-items:center;justify-content:center">
      <div style="text-align:center">
        <div style="width:32px;height:32px;border-radius:50%;border:4px solid var(--accent);border-top-color:transparent;margin:0 auto 12px;animation:spin 0.8s linear infinite"></div>
        <div style="font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-500)">Loading demographics…</div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  }

  return html`<${Shell} state=${state} store=${store} ui=${ui} setUi=${setUi} menu=${menu} setMenu=${setMenu} />`;
}

function Shell({ state, store, ui, setUi, menu, setMenu }) {
  return html`
    <div class="shell">
      ${TopBar({ state, store, ui, setUi, menu, setMenu })}
      <div class="workspace" onClick=${() => menu && setMenu(false)}>
        <main class="stage">
          <div id="map" class="absolute inset-0"></div>
        </main>
        <aside class="rail scrollbar-thin">
          <${SchoolPanel}    state=${state} store=${store} />
          <${LayersPanel}    state=${state} store=${store} />
          <${DistrictPanel}  state=${state} store=${store} />
        </aside>
        <div class="railtoggle">
          <button class="mapbtn" onClick=${() => setUi({ ...ui, rail: ui.rail === "on" ? "off" : "on" })}>
            ${ui.rail === "on" ? "Hide panel" : "Panel"}
          </button>
        </div>
        ${state.showHeatMap ? html`<div id="heatmap-legend" class="legend"></div>` : null}
        ${state.showPerformance ? PerfLegend({ region: state.region }) : null}
      </div>
    </div>
  `;
}

// Legend for the School Performance layer: proficiency color ramp + shape key.
function PerfLegend({ region }) {
  const gradient = `linear-gradient(to right, ${PROF_STOPS.map(([v,c]) => `${c} ${v}%`).join(", ")})`;
  return html`
    <div class="legend perf">
      <div class="lgtitle" style="font-weight:600;margin-bottom:3px">School Performance</div>
      <div style="color:var(--ink-500);margin-bottom:5px">${regionCfg(region).perfCaption}</div>
      <div style="height:9px;border-radius:3px;background:${gradient}"></div>
      <div style="display:flex;justify-content:space-between;color:var(--ink-400);margin-top:2px"><span>0%</span><span>50%</span><span>100%</span></div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid var(--hair)">
        <span style="display:flex;align-items:center;gap:4px">
          <svg width="13" height="13"><circle cx="6.5" cy="6.5" r="5" fill="#94a3b8" stroke="#fff"></circle></svg>
          <span>District</span>
        </span>
        <span style="display:flex;align-items:center;gap:4px">
          <svg width="13" height="13"><polygon points="6.5,1 12,12 1,12" fill="#94a3b8" stroke="#fff"></polygon></svg>
          <span>Charter</span>
        </span>
      </div>
      <div style="color:var(--ink-400);margin-top:4px">Size = enrollment</div>
    </div>
  `;
}

function TopBar({ state, store, ui, setUi, menu, setMenu }) {
  const set = (patch) => setUi({ ...ui, ...patch });
  const opts = (key, list) => html`
    <div class="opts">
      ${list.map(([v, label]) => html`<button class="seg ${ui[key] === v ? "on" : ""}" onClick=${() => set({ [key]: v })}>${label}</button>`)}
    </div>`;
  const cfg = regionCfg(state.region);
  // Switching region resets the sub-area and any focused school/sub-area,
  // since those ids only exist within one region.
  const switchRegion = (rid) => {
    if (rid === state.region) return;
    const next = regionCfg(rid);
    store.set({ region: rid, county: next.areas[0].id, focusDistrict: null, focusCampus: null,
                schoolSearch: "" });
    mapReady.then(m => m.flyTo({ ...next.statewide, duration: 800 }));
  };
  return html`
    <header class="topbar">
      <div class="brand">
        <div class="mark">K</div>
        <div class="bar"></div>
        <div>
          <div class="eyebrow">${cfg.eyebrow}</div>
          <div class="title">Demographic Analysis</div>
        </div>
      </div>
      <div class="segset" title="Switch state">
        ${REGION_IDS.map(rid => html`
          <button class="seg ${state.region === rid ? "on" : ""}"
            onClick=${() => switchRegion(rid)}>${REGIONS[rid].short}</button>`)}
      </div>
      <div class="segset">
        ${cfg.areas.map(a => html`
          <button class="seg ${state.county === a.id ? "on" : ""}"
            onClick=${() => store.set({ county: a.id, focusDistrict: null })}>${a.label}</button>`)}
      </div>
      <button class="ghost" onClick=${() => mapReady.then(m => m.flyTo({ ...cfg.statewide, duration: 800 }))}>${cfg.statewide.label}</button>
      <div style="margin-left:auto;display:flex;align-items:center;gap:14px">
        <div class="topmeta">${cfg.sourceLine}</div>
        <button class="ghost ${menu ? "hot" : ""}" onClick=${(e) => { e.stopPropagation(); setMenu(!menu); }}>Display</button>
      </div>
      ${menu ? html`
        <div class="menu" onClick=${e => e.stopPropagation()}>
          <div class="row"><span>Basemap</span>${opts("ui", [["dark", "Dark"], ["light", "Light"]])}</div>
          <div class="row"><span>Panel layout</span>${opts("layout", [["dock", "Docked"], ["float", "Floating"]])}</div>
          <div class="row"><span>Density</span>${opts("density", [["comfortable", "Comfortable"], ["compact", "Compact"]])}</div>
          <div class="row"><span>Markers</span>${opts("markers", [["solid", "Solid"], ["hollow", "Hollow"]])}</div>
          <div class="row"><span>Accent</span>
            <div class="swatchrow">
              ${ACCENTS.map(a => html`<div class="swatch ${ui.theme === a.id ? "on" : ""}" title=${a.label}
                style="background:${a.color}" onClick=${() => set({ theme: a.id })}></div>`)}
            </div>
          </div>
        </div>` : null}
    </header>
  `;
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  window.__store = store;
  render(h(App), document.getElementById("app"));
});

// ==== campus.js ====
// Campus / School panel — universal school picker + detail card.
// Always shows KIPP Miami North anchor. No curated 8-school cohort.

const RING_MILES = { "5min": 1.83, "10min": 3.67, "15min": 5.50 };

// Florida stores county as a slug ("broward"); the NJ data already carries the
// proper county name ("Essex"), so anything unrecognized passes through.
const COUNTY_LABELS = { broward: "Broward", miamidade: "Miami-Dade", orange: "Orange" };
function countyLabel(county) {
  if (!county) return "";
  return COUNTY_LABELS[county] || county;
}
const COUNTY_ABBR = { broward: "BRW", miamidade: "MDC", orange: "ORG" };
function countyAbbr(county) {
  if (!county) return "";
  return COUNTY_ABBR[county] || String(county).slice(0, 3).toUpperCase();
}

// KIPP Miami North anchor — always on map
const KIPP_NORTH = {
  id: "KIPP-MIAMI-NORTH",
  name: "KIPP Miami North",
  coords: [-80.2468097, 25.8672524],
};

// Great-circle polygon (64 pts)
function circleRing(lng, lat, miles, n = 64) {
  const R = 3958.8, d = miles / R;
  const lat1 = lat * Math.PI / 180, lng1 = lng * Math.PI / 180;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const brng = (i / n) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(brng));
    const lng2 = lng1 + Math.atan2(Math.sin(brng)*Math.sin(d)*Math.cos(lat1),
                                    Math.cos(d) - Math.sin(lat1)*Math.sin(lat2));
    pts.push([lng2*180/Math.PI, lat2*180/Math.PI]);
  }
  return pts;
}

function makeMarkerEl(color, size = 18, border = 2.5) {
  const el = document.createElement("div");
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};
    border:${border}px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;`;
  return el;
}

// ---------- All-schools bubble layers (persistent) ----------
// One GeoJSON source + two circle layers (charter + district public) sized by enrollment.
// Click to focus a campus; hover for name+enrollment. Visibility managed by syncLayerVisibility.
// The source data is swapped when the region changes (FL and NJ school
// properties share names by design), so the layers, paint and popups are built
// once and reused for both.
async function ensureSchoolDotLayers(map, data, region) {
  const rd = regionData(data, region);
  if (!rd?.schools) return;

  const feats = rd.schools.features.filter(f => {
    const p = f.properties;
    return p.status !== "closed" && p.role !== "incubation";
  });
  const fc = { type: "FeatureCollection", features: feats };

  if (map.getSource("all-schools-src")) {
    map.getSource("all-schools-src").setData(fc);
    return;
  }
  map.addSource("all-schools-src", { type: "geojson", data: fc });

  // Radius interpolated from enrollment (0 → small, 3000 → large)
  const radiusExpr = ["interpolate", ["linear"],
    ["to-number", ["coalesce", ["get", "enrollment_2526"], 0]],
    0, 3,
    200, 5,
    500, 7.5,
    1000, 10.5,
    2000, 14,
    3000, 17,
  ];

  // District / public schools — SOLID BLUE circle, thin border
  map.addLayer({
    id: "school-dots-public",
    type: "circle",
    source: "all-schools-src",
    filter: ["==", ["get", "role"], "district"],
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": "#2563eb",        // blue-600 (saturated)
      "circle-opacity": 0.82,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Charter schools — AMBER/GOLD circle, THICK white border (chunky look, different from KIPP orange)
  map.addLayer({
    id: "school-dots-charter",
    type: "circle",
    source: "all-schools-src",
    filter: ["==", ["get", "role"], "charter"],
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": "#f59e0b",        // amber-500 (distinct from KIPP orange-600)
      "circle-opacity": 0.9,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#78350f", // amber-900 ring for visual punch
    },
  });

  // Shared hover popup + click-to-focus
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  for (const layerId of ["school-dots-public", "school-dots-charter"]) {
    map.on("mousemove", layerId, e => {
      const vis = map.getLayoutProperty(layerId, "visibility");
      if (!vis || vis === "none") return;
      const f = e.features?.[0]; if (!f) return;
      const p = f.properties;
      const enrollNum = parseFloat(p.enrollment_2526);
      const enrollStr = !isNaN(enrollNum) && enrollNum > 0
        ? `${Math.round(enrollNum).toLocaleString()} students (2025-26)` : "";
      const countyStr = countyLabel(p.county);
      const typeStr = p.role === "charter" ? "Charter" : "Public";
      popup.setLngLat(e.lngLat)
        .setHTML(`<div style="font-size:12px;line-height:1.4">
          <strong>${p.name}</strong><br>
          <span style="color:#6b7280">${typeStr} · ${p.city || ""} · ${countyStr}</span>
          ${enrollStr ? `<br><span style="color:#374151">${enrollStr}</span>` : ""}
        </div>`)
        .addTo(map);
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      popup.remove();
      map.getCanvas().style.cursor = "";
    });
    map.on("click", layerId, e => {
      const f = e.features?.[0]; if (!f) return;
      window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
    });
  }
}

// ---------- School of Hope eligible layer (FL DOE FISH capacity) ----------
// A facility is SOH-eligible if it meets EITHER criterion (per FL statute):
//   1. Facility Utilization Rate ≤ 75%, OR
//   2. Surplus of at least 400 student stations.
// Bubble sized by surplus seats, colored red/yellow/green by utilization %.
async function ensureUnderutilizedLayer(map, data) {
  if (!data?.universalSchools || !data?.schoolCapacity) return;
  if (map.getSource("underutilized-src")) return; // idempotent

  const cap = data.schoolCapacity;
  const feats = [];
  for (const f of data.universalSchools.features) {
    const p = f.properties;
    const c = cap[p.id];
    if (!c) continue;
    const util = c.utilization_pct;
    const surplus = c.available_surplus;
    const utilOk = util != null && util <= 75;
    const surpOk = surplus != null && surplus >= 400;
    if (!utilOk && !surpOk) continue;       // not SOH-eligible
    const sohCriterion = (utilOk && surpOk) ? "both" : (utilOk ? "utilization" : "surplus");
    feats.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        ...p,
        school_capacity: c.school_capacity,
        cofte: c.cofte,
        utilization_pct: util,
        available_surplus: surplus,
        primary_use: c.primary_use,
        soh_eligible: true,
        soh_criterion: sohCriterion,
      },
    });
  }
  console.log(`[SOH] ${feats.length} schools eligible (util<=75 OR surplus>=400)`);

  map.addSource("underutilized-src", {
    type: "geojson",
    data: { type: "FeatureCollection", features: feats },
  });

  // Radius scaled to surplus. Includes smaller schools (<400 surplus) that qualify via util.
  const radiusExpr = ["interpolate", ["linear"],
    ["to-number", ["coalesce", ["get", "available_surplus"], 0]],
    0, 4,
    200, 5.5,
    400, 7,
    800, 10,
    1500, 14,
    2500, 19,
    4000, 25,
  ];

  // Color bands per SOH utilization thresholds:
  //   76-100% → red  (only eligible via surplus criterion)
  //   50-75%  → yellow
  //   0-49%   → green
  const colorExpr = ["case",
    [">=", ["to-number", ["get", "utilization_pct"]], 76], "#dc2626",   // red-600
    [">=", ["to-number", ["get", "utilization_pct"]], 50], "#eab308",   // yellow-500
    "#16a34a",                                                           // green-600
  ];

  map.addLayer({
    id: "school-dots-underutilized",
    type: "circle",
    source: "underutilized-src",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": colorExpr,
      "circle-opacity": 0.75,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Hover + click
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map.on("mousemove", "school-dots-underutilized", e => {
    const vis = map.getLayoutProperty("school-dots-underutilized", "visibility");
    if (!vis || vis === "none") return;
    const f = e.features?.[0]; if (!f) return;
    const p = f.properties;
    const util = parseFloat(p.utilization_pct);
    const surplus = parseFloat(p.available_surplus);
    const capVal = parseFloat(p.school_capacity);
    const cofte = parseFloat(p.cofte);
    const crit = p.soh_criterion;
    const critLabel = crit === "both" ? "Both criteria"
      : crit === "utilization" ? "Utilization ≤ 75%"
      : "Surplus ≥ 400 seats";
    popup.setLngLat(e.lngLat)
      .setHTML(`<div style="font-size:12px;line-height:1.4;min-width:220px">
        <strong>${p.name}</strong><br>
        <span style="color:#6b7280">${p.primary_use || "District Public"} · ${p.city || ""}</span>
        <div style="margin-top:4px;padding:4px 6px;background:#ecfdf5;border:1px solid #86efac;border-radius:4px">
          <div style="font-weight:600;color:#065f46;font-size:11px">✓ School of Hope Eligible</div>
          <div style="color:#047857;font-size:10px">Qualifies via: ${critLabel}</div>
        </div>
        <div style="margin-top:4px;padding-top:4px;border-top:1px solid #e5e7eb">
          <div>Capacity: <b>${Math.round(capVal).toLocaleString()}</b> · FTE: ${Math.round(cofte).toLocaleString()}</div>
          <div>Surplus: <b>${Math.round(surplus).toLocaleString()}</b> seats</div>
          <div>Utilization: <b>${util.toFixed(0)}%</b></div>
        </div>
      </div>`)
      .addTo(map);
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "school-dots-underutilized", () => {
    popup.remove();
    map.getCanvas().style.cursor = "";
  });
  map.on("click", "school-dots-underutilized", e => {
    const f = e.features?.[0]; if (!f) return;
    window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
  });
}

// ---------- Persistently Low-Performing layer (FL DOE 2024-25) ----------
// Hollow red-rimmed circles sized by enrollment; click to focus.
// When a PLP school is focused, a 5-mile radius ring is drawn around it so you
// can see what other sites lie within the catchment.
async function ensurePlpLayer(map, data) {
  if (!data?.universalSchools || !data?.plpSchools) return;
  if (map.getSource("plp-src")) return; // idempotent

  const plp = data.plpSchools;
  const feats = [];
  for (const f of data.universalSchools.features) {
    const p = f.properties;
    const rec = plp[p.id];
    if (!rec) continue;
    feats.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        ...p,
        plp_list_year: rec.list_year,
        plp_grade_2025: rec.grade_2025,
        plp_grade_2024: rec.grade_2024,
        plp_grade_2023: rec.grade_2023,
        plp_charter:    !!rec.charter,
        plp_title1:     !!rec.title1,
        plp_econ_pct:   rec.econ_disadv_pct,
      },
    });
  }
  console.log(`[PLP] ${feats.length} schools on FL DOE 2024-25 PLP list`);

  map.addSource("plp-src", {
    type: "geojson",
    data: { type: "FeatureCollection", features: feats },
  });

  const radiusExpr = ["interpolate", ["linear"],
    ["to-number", ["coalesce", ["get", "enrollment_2526"], 0]],
    0, 5,
    200, 6.5,
    500, 8.5,
    1000, 11,
    2000, 14,
    3000, 17,
  ];

  // Hollow red warning marker — pale fill with heavy red ring
  map.addLayer({
    id: "school-dots-plp",
    type: "circle",
    source: "plp-src",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": "#fee2e2",          // red-100 pale fill
      "circle-opacity": 0.85,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#b91c1c",   // red-700
    },
  });

  // 5-mile radius: empty source + fill + dashed line. Populated on focus.
  map.addSource("plp-radius", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "plp-radius-fill",
    type: "fill",
    source: "plp-radius",
    layout: { visibility: "none" },
    paint: { "fill-color": "#dc2626", "fill-opacity": 0.06 },
  });
  map.addLayer({
    id: "plp-radius-line",
    type: "line",
    source: "plp-radius",
    layout: { visibility: "none" },
    paint: { "line-color": "#b91c1c", "line-width": 1.8, "line-dasharray": [3, 2] },
  });

  // Hover popup
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map.on("mousemove", "school-dots-plp", e => {
    const vis = map.getLayoutProperty("school-dots-plp", "visibility");
    if (!vis || vis === "none") return;
    const f = e.features?.[0]; if (!f) return;
    const p = f.properties;
    const enrollNum = parseFloat(p.enrollment_2526);
    const enrollStr = !isNaN(enrollNum) && enrollNum > 0
      ? `${Math.round(enrollNum).toLocaleString()} students (2025-26)` : "";
    const countyStr = countyLabel(p.county);
    popup.setLngLat(e.lngLat)
      .setHTML(`<div style="font-size:12px;line-height:1.4;min-width:220px">
        <strong>${p.name}</strong><br>
        <span style="color:#6b7280">${p.school_type || "District"} · ${countyStr}</span>
        <div style="margin-top:4px;padding:4px 6px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px">
          <div style="font-weight:600;color:#991b1b;font-size:11px">⚠ Persistently Low-Performing</div>
          <div style="color:#b91c1c;font-size:10px">FL DOE 2024-25 list · Grades: '23 ${p.plp_grade_2023 || "—"} · '24 ${p.plp_grade_2024 || "—"} · '25 ${p.plp_grade_2025 || "—"}</div>
        </div>
        ${enrollStr ? `<div style="margin-top:4px;color:#374151">${enrollStr}</div>` : ""}
      </div>`)
      .addTo(map);
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "school-dots-plp", () => {
    popup.remove();
    map.getCanvas().style.cursor = "";
  });
  map.on("click", "school-dots-plp", e => {
    const f = e.features?.[0]; if (!f) return;
    window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
  });
}

// ---------- School Performance layer (FL DOE school grades + proficiency) ----------
// One MapLibre symbol layer whose icons encode three things at once:
//   • SHAPE  — circle = district, triangle = charter
//   • COLOR  — % scoring Level 3+ (ELA+Math), red → green
//   • SIZE   — enrollment
// Shapes are generated as signed-distance-field (SDF) images so icon-color can
// recolor them per-feature.
function makeShapeSdf(size, drawMask) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const cx = c.getContext("2d");
  cx.clearRect(0, 0, size, size);
  cx.fillStyle = "#fff";
  drawMask(cx, size);
  const img = cx.getImageData(0, 0, size, size).data;
  const inside = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) inside[i] = img[i * 4 + 3] > 127 ? 1 : 0;

  const data = new Uint8ClampedArray(size * size * 4);
  const spread = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const isIn = inside[idx];
      let best = 1e9;
      for (let yy = 0; yy < size; yy++) {
        for (let xx = 0; xx < size; xx++) {
          if (inside[yy * size + xx] !== isIn) {
            const dx = xx - x, dy = yy - y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < best) best = d;
          }
        }
      }
      const signed = isIn ? best : -best;
      const a = Math.max(0, Math.min(255, Math.round(255 * (0.75 + signed / spread))));
      data[idx * 4] = 255; data[idx * 4 + 1] = 255; data[idx * 4 + 2] = 255;
      data[idx * 4 + 3] = a;
    }
  }
  return { width: size, height: size, data };
}

function ensurePerfIcons(map) {
  const S = 48;
  if (!map.hasImage("perf-circ")) {
    map.addImage("perf-circ", makeShapeSdf(S, (cx, s) => {
      cx.beginPath(); cx.arc(s / 2, s / 2, s * 0.40, 0, 2 * Math.PI); cx.fill();
    }), { sdf: true });
  }
  if (!map.hasImage("perf-tri")) {
    map.addImage("perf-tri", makeShapeSdf(S, (cx, s) => {
      const m = s * 0.12, h = s - 2 * m;
      cx.beginPath();
      cx.moveTo(s / 2, m);                 // top
      cx.lineTo(s - m, m + h);             // bottom-right
      cx.lineTo(m, m + h);                 // bottom-left
      cx.closePath(); cx.fill();
    }), { sdf: true });
  }
}

async function ensurePerformanceLayer(map, data, region) {
  const rd = regionData(data, region);
  if (!rd?.schools || !rd?.performance) return;

  ensurePerfIcons(map);

  const perf = rd.performance;
  const feats = [];
  for (const f of rd.schools.features) {
    const p = f.properties;
    if (p.status === "closed" || p.role === "incubation") continue;
    const rec = perf[perfKeyFor(region, p)];
    if (!rec) continue;                       // only schools we have performance for
    const enroll = (p.enrollment_2526 && +p.enrollment_2526 > 0)
      ? +p.enrollment_2526 : (rec.enrollment || 0);
    feats.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: p.id, name: p.name, role: p.role, county: p.county,
        enrollment: enroll,
        ela_math: rec.ela_math, ela: rec.ela, math: rec.math,
        grade: rec[`grade_${perfYear(rec)}`] || "",
      },
    });
  }
  const fc = { type: "FeatureCollection", features: feats };
  console.log(`[PERF:${region}] ${feats.length} schools with performance data`);

  if (map.getSource("perf-src")) {
    map.getSource("perf-src").setData(fc);
    return;
  }
  map.addSource("perf-src", { type: "geojson", data: fc });

  const sizeExpr = ["interpolate", ["linear"], ["to-number", ["coalesce", ["get", "enrollment"], 0]],
    0, 0.17, 200, 0.26, 500, 0.36, 1000, 0.50, 2000, 0.66, 3500, 0.86];

  map.addLayer({
    id: "school-dots-perf",
    type: "symbol",
    source: "perf-src",
    layout: {
      visibility: "none",
      "icon-image": ["match", ["get", "role"], "charter", "perf-tri", "perf-circ"],
      "icon-size": sizeExpr,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": profColorExpr("ela_math"),
      "icon-opacity": 0.95,
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1.1,
    },
  });

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map.on("mousemove", "school-dots-perf", e => {
    const vis = map.getLayoutProperty("school-dots-perf", "visibility");
    if (!vis || vis === "none") return;
    const f = e.features?.[0]; if (!f) return;
    const p = f.properties;
    const pf = (v) => (v == null || v === "" || isNaN(+v)) ? "—" : `${Math.round(+v)}%`;
    const enrollNum = parseFloat(p.enrollment);
    const enrollStr = !isNaN(enrollNum) && enrollNum > 0 ? `${Math.round(enrollNum).toLocaleString()} students` : "";
    const countyStr = countyLabel(p.county);
    const typeStr = p.role === "charter" ? "Charter" : "District";
    const gradeBadge = p.grade
      ? `<span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:3px;color:#fff;font-weight:700;font-size:10px;background:${gradeColor(p.grade)}">${p.grade}</span>`
      : "";
    popup.setLngLat(e.lngLat)
      .setHTML(`<div style="font-size:12px;line-height:1.45;min-width:210px">
        <div style="display:flex;align-items:center;gap:6px"><strong>${p.name}</strong> ${gradeBadge}</div>
        <span style="color:#6b7280">${typeStr} · ${countyStr}</span>
        <div style="margin-top:4px;display:grid;grid-template-columns:auto auto;gap:1px 10px">
          <span style="color:#374151">ELA: <b>${pf(p.ela)}</b></span>
          <span style="color:#374151">Math: <b>${pf(p.math)}</b></span>
          <span style="color:#374151">ELA+Math: <b>${pf(p.ela_math)}</b></span>
        </div>
        ${enrollStr ? `<div style="margin-top:3px;color:#6b7280">${enrollStr}</div>` : ""}
      </div>`)
      .addTo(map);
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "school-dots-perf", () => { popup.remove(); map.getCanvas().style.cursor = ""; });
  map.on("click", "school-dots-perf", e => {
    const f = e.features?.[0]; if (!f) return;
    window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
  });
}

// ---------- Map rendering ----------
async function renderSchoolLayers(state) {
  const map = await getMapIdle();
  const { data, ring, focusCampus } = state;
  const region = state.region || "fl";
  if (!data) return;
  const rd = regionData(data, region);

  // School + performance sources swap data by region; the Florida-only layers
  // are built once and simply hidden when NJ is active.
  await ensureSchoolDotLayers(map, data, region);
  await ensurePerformanceLayer(map, data, region);
  if (region === "fl") {
    await ensureUnderutilizedLayer(map, data);
    await ensurePlpLayer(map, data);
  }

  // Clear previous school markers
  (window.__schoolMarkers || []).forEach(m => m.remove());
  window.__schoolMarkers = [];

  // ── KIPP North — always-visible orange anchor marker (Florida only) ──
  if (region === "fl") {
    const kippEl = makeMarkerEl("#ea580c");
    kippEl.title = KIPP_NORTH.name;
    kippEl.addEventListener("click", () => window.__store?.set({ focusCampus: KIPP_NORTH.id }));
    const kippM = new maplibregl.Marker({ element: kippEl })
      .setLngLat(KIPP_NORTH.coords)
      .setPopup(new maplibregl.Popup({ offset: 14 }).setText(KIPP_NORTH.name))
      .addTo(map);
    window.__schoolMarkers.push(kippM);
  }

  // ── Drive ring + focused school marker ──
  ["campus-rings-fill","campus-rings-line"].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource("campus-rings")) map.removeSource("campus-rings");

  if (focusCampus) {
    let lng, lat, schoolName;
    if (focusCampus === KIPP_NORTH.id) {
      [lng, lat] = KIPP_NORTH.coords; schoolName = KIPP_NORTH.name;
    } else if (rd?.schools) {
      const f = rd.schools.features.find(s => s.properties.id === focusCampus);
      if (f) { [lng, lat] = f.geometry.coordinates; schoolName = f.properties.name; }
    }

    if (lng != null) {
      // 5-mile PLP radius — update the persistent source. Visibility is
      // controlled by syncLayerVisibility based on focus + showPlpRadius.
      const isPlp = data.plpSchools && data.plpSchools[focusCampus];
      if (map.getSource("plp-radius")) {
        map.getSource("plp-radius").setData(isPlp ? {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {},
            geometry: { type: "Polygon", coordinates: [circleRing(lng, lat, 5)] } }],
        } : { type: "FeatureCollection", features: [] });
      }

      const ringFC = {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {},
          geometry: { type: "Polygon", coordinates: [circleRing(lng, lat, RING_MILES[ring])] } }],
      };
      map.addSource("campus-rings", { type: "geojson", data: ringFC });
      map.addLayer({ id: "campus-rings-fill", type: "fill", source: "campus-rings",
        paint: { "fill-color": "#f97316", "fill-opacity": 0.09 } });
      map.addLayer({ id: "campus-rings-line", type: "line", source: "campus-rings",
        paint: { "line-color": "#c2410c", "line-width": 1.5, "line-dasharray": [2,1] } });

      // Red pin for the selected school (skip KIPP which already has orange)
      if (focusCampus !== KIPP_NORTH.id) {
        const el = makeMarkerEl("#ef4444", 22, 3);
        el.title = schoolName || "";
        const m = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup({ offset: 18 }).setText(schoolName || ""))
          .addTo(map);
        window.__schoolMarkers.push(m);
      }
      map.flyTo({ center: [lng, lat], zoom: 12, duration: 700 });
    }
  }

  // Keep school bubbles + campus rings on top regardless of which layer was
  // enabled first (heat map vs. school layers).
  for (const id of [
    "school-dots-underutilized",
    "school-dots-public",
    "school-dots-charter",
    "school-dots-perf",
    "school-dots-plp",
    "plp-radius-fill",
    "plp-radius-line",
    "campus-rings-fill",
    "campus-rings-line",
  ]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

// ---------- SchoolPanel component ----------
function SchoolPanel({ state, store }) {
  useEffect(() => { renderSchoolLayers(state); },
    [state.data, state.ring, state.focusCampus, state.county, state.region,
     state.showCharters, state.showPublicSchools, state.showUnderutilized,
     state.showPlp, state.showPlpRadius]);

  const { data, focusCampus } = state;
  if (!data) return null;

  if (focusCampus) {
    return html`<${SchoolDetail} schoolId=${focusCampus} data=${data} store=${store} state=${state} />`;
  }

  return html`
    <div>
      <${UniversalSchoolPicker} data=${data} state=${state} store=${store} />
      <div class="pb-3 flex items-center gap-2 flex-wrap" style="padding-left:var(--pad);padding-right:var(--pad)">
        <span class="grp">Drive-time ring</span>
        <div class="segrow">
          ${["5min","10min","15min"].map(r => html`
            <button onClick=${() => store.set({ ring: r })}
              class="seg ${state.ring===r ? "on" : ""}"
            >${r.replace("min"," min")}</button>
          `)}
        </div>
      </div>
    </div>
  `;
}

function UniversalSchoolPicker({ data, state, store }) {
  const region = state.region || "fl";
  const cfg = regionCfg(region);
  // Include all schools; show closed ones grayed with a badge rather than hiding them
  const allSchools = regionData(data, region)?.schools?.features || [];
  const activeCount = allSchools.filter(f => f.properties.status !== "closed").length;
  const q = (state.schoolSearch || "").trim().toLowerCase();
  const matches = !q ? [] : allSchools
    .filter(s => {
      const p = s.properties;
      return `${p.name} ${p.city || ""} ${p.school_num || ""}`.toLowerCase().includes(q);
    })
    .slice(0, 12);

  return html`
    <div class="searchwrap">
      <div class="lbl">
        Search <span style="color:var(--ink-700);font-weight:600">${activeCount.toLocaleString()}</span> schools — ${cfg.subLabel}
      </div>
      <input
        type="search"
        placeholder="School name or city…"
        value=${state.schoolSearch || ""}
        onInput=${e => store.set({ schoolSearch: e.target.value })}
        class="fld"
      />
      ${matches.length ? html`
        <div class="results">
          ${matches.map(s => {
            const p = s.properties;
            const isClosed = p.status === "closed";
            const isPlp = data.plpSchools && data.plpSchools[p.id];
            const dot = isClosed ? "#94a3b8" : p.role === "charter" ? "#f59e0b" : p.role === "incubation" ? "#F9A21A" : "#57C0E9";
            return html`
              <div onClick=${() => store.set({ focusCampus: p.id, schoolSearch: "" })}
                   class="${isClosed ? "opacity-50" : ""}">
                <span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0;display:inline-block"></span>
                <span class="flex-1 truncate">${p.name}</span>
                ${isPlp ? html`<span class="pill bg-red-50 text-red-700 border border-red-200 flex-shrink-0 text-[10px]">PLP</span>` : null}
                ${isClosed ? html`<span class="pill bg-red-50 text-red-600 flex-shrink-0 text-[10px]">closed</span>` : null}
                <span class="text-ink-400 flex-shrink-0">${p.city || ""}</span>
                <span class="pill bg-ink-100 text-ink-600 flex-shrink-0">${countyAbbr(p.county)}</span>
                ${p.enrollment_2526 && !isClosed ? html`<span class="text-ink-400 font-mono flex-shrink-0">${fmt.int(p.enrollment_2526)}</span>` : null}
              </div>
            `;
          })}
        </div>
      ` : q ? html`<div class="mt-1 text-xs text-ink-400 px-1">No matches.</div>` : null}
    </div>
  `;
}

function SchoolDetail({ schoolId, data, store, state }) {
  const region = state.region || "fl";
  const cfg = regionCfg(region);
  const rd = regionData(data, region);
  const sch = schoolId === KIPP_NORTH.id
    ? { properties: { id: KIPP_NORTH.id, name: KIPP_NORTH.name, county: "miamidade",
                       school_type: "Incubation Site", address: "3000 NW 110th Street", city: "Miami" },
        geometry: { coordinates: KIPP_NORTH.coords } }
    : (rd?.schools?.features || []).find(f => f.properties.id === schoolId);

  if (!sch) return html`
    <div class="p-4 text-xs text-ink-500">
      School not found. <button onClick=${() => store.set({ focusCampus: null })} class="text-kipp-600 underline">← Back</button>
    </div>`;

  const p = sch.properties;
  const rings = rd?.rings?.[schoolId]?.rings;
  // Facility capacity / PLP are Florida-only datasets.
  const cap = region === "fl" ? data.schoolCapacity?.[schoolId] : null;
  const plp = region === "fl" ? data.plpSchools?.[schoolId] : null;
  const perf = rd?.performance?.[perfKeyFor(region, p)];
  const enrollKey = enrollKeyFor(region, p);
  const enroll = enrollKey && rd?.enrollment ? rd.enrollment[enrollKey] : null;
  const enroll5yr = enroll ? (() => {
    const yrs = ["2122","2223","2324","2425","2526"];
    const totals = yrs.map(y => enroll.years?.[y]?.total ?? null);
    const first = totals.find(v => v != null), last = [...totals].reverse().find(v => v != null);
    return { years: enroll.years || {}, change_5yr_n: first!=null&&last!=null ? last-first : null,
             change_5yr_pct: first ? (last-first)/first : null };
  })() : null;

  const ring = state.ring || "5min";

  return html`
    <div class="space-y-3" style="padding:var(--pad)">
      <button onClick=${() => store.set({ focusCampus: null })}
              class="text-xs text-kipp-600 hover:underline">← Back to search</button>
      <div>
        <div class="text-[11px] uppercase tracking-wide text-ink-500">
          ${countyLabel(p.county)} · ${p.school_type || p.role || ""}
        </div>
        <h2 class="text-base font-semibold text-ink-900 leading-tight">${p.name}</h2>
        <div class="text-xs text-ink-500">${[p.address, p.city && p.city.charAt(0).toUpperCase() + p.city.slice(1)].filter(Boolean).join(", ")}
          ${p.school_num ? html` · <span class="font-mono">#${p.school_num}</span>` : null}
        </div>
        <div class="flex flex-wrap gap-1.5 mt-1.5">
          ${plp ? html`
            <span class="pill bg-red-50 text-red-700 border border-red-200 text-[10px]"
                  title="FL DOE 2024-25 Persistently Low-Performing list">
              ⚠ PLP 24-25
            </span>
          ` : null}
        </div>
      </div>

      ${plp ? html`
        <div class="bg-red-50 border border-red-200 rounded-md p-2.5 space-y-1.5">
          <div class="flex items-baseline justify-between">
            <div class="text-[11px] font-semibold text-red-800">⚠ Persistently Low-Performing · 2024-25</div>
            <span class="text-[10px] text-red-600">FL DOE list</span>
          </div>
          <div class="text-[11px] text-red-900">
            <div class="flex gap-3 flex-wrap">
              <div>School grades:
                <span class="font-mono">'23 <b>${plp.grade_2023 || "—"}</b></span>
                <span class="font-mono">· '24 <b>${plp.grade_2024 || "—"}</b></span>
                <span class="font-mono">· '25 <b>${plp.grade_2025 || "—"}</b></span>
              </div>
            </div>
            <div class="mt-1 flex gap-3 flex-wrap text-[10px] text-red-800">
              ${plp.grade3_ela_bottom10 ? html`<span>G3 ELA bottom 10%</span>` : null}
              ${plp.grade4_math_bottom10 ? html`<span>G4 Math bottom 10%</span>` : null}
              ${plp.title1 ? html`<span>Title I</span>` : null}
              ${plp.econ_disadv_pct != null ? html`<span>${plp.econ_disadv_pct.toFixed(0)}% econ-disadv</span>` : null}
            </div>
          </div>
          <div class="text-[10px] text-red-700 pt-1 border-t border-red-200">
            5-mile radius drawn on map. Toggle under Map Layers ▸ PLP radius.
          </div>
        </div>
      ` : null}

      <div class="flex items-center gap-2 flex-wrap">
        <span class="grp">Ring</span>
        <div class="segrow">
          ${["5min","10min","15min"].map(r => html`
            <button onClick=${() => store.set({ ring: r })}
              class="seg ${ring===r ? "on" : ""}"
            >${r.replace("min"," min")}</button>
          `)}
        </div>
      </div>

      ${perf ? html`<${PerformanceBlock} perf=${perf} region=${region} />` : null}

      ${enroll5yr ? html`<${EnrollmentChart} enroll=${enroll5yr} region=${region} />` : null}

      ${cap ? (() => {
        const util = cap.utilization_pct;
        const surplus = cap.available_surplus;
        const utilOk = util != null && util <= 75;
        const surpOk = surplus != null && surplus >= 400;
        const sohEligible = utilOk || surpOk;
        const crit = sohEligible
          ? (utilOk && surpOk ? "Both criteria met"
             : utilOk ? "Utilization ≤ 75%" : "Surplus ≥ 400 seats")
          : null;
        return html`
        <div class="bg-ink-50 rounded-md p-2.5 space-y-1.5">
          <div class="flex items-baseline justify-between">
            <div class="text-[11px] font-medium text-ink-700">Facility Capacity (FL DOE FISH 2025-26)</div>
            ${sohEligible ? html`
              <span class="pill bg-green-50 text-green-700 border border-green-200 text-[10px]" title="Qualifies via: ${crit}">
                ✓ SOH Eligible
              </span>
            ` : html`<span class="pill bg-ink-100 text-ink-500 text-[10px]">Not SOH eligible</span>`}
          </div>
          <div class="grid grid-cols-3 gap-2 text-[11px]">
            <div><div class="text-ink-500">Capacity</div><div class="font-semibold text-ink-900">${fmt.int(cap.school_capacity)}</div></div>
            <div><div class="text-ink-500">Enrolled (FTE)</div><div class="font-semibold text-ink-900">${fmt.int(cap.cofte)}</div></div>
            <div><div class="text-ink-500">Surplus</div>
              <div class="font-semibold ${surpOk ? "text-green-700" : "text-ink-900"}">${fmt.int(surplus)}</div>
            </div>
          </div>
          <div class="text-[11px] text-ink-600">
            Utilization: <b class=${util >= 76 ? "text-red-600" : util >= 50 ? "text-yellow-700" : "text-green-700"}>${(util || 0).toFixed(0)}%</b>
            ${cap.primary_use ? html` · <span class="text-ink-500">${cap.primary_use}</span>` : null}
          </div>
          ${sohEligible ? html`
            <div class="text-[10px] text-green-700 leading-snug pt-1 border-t border-ink-100">
              Qualifies via: <b>${crit}</b>. SOH rule: facility eligible if utilization ≤ 75% <i>or</i> surplus ≥ 400 stations.
            </div>
          ` : null}
        </div>
      `; })() : null}

      ${rings ? html`
        <table class="data">
          <thead><tr><th>Demographics (ACS)</th><th class="num">5 Min</th><th class="num">10 Min</th><th class="num">15 Min</th></tr></thead>
          <tbody>
            ${[
              ["Population (2025)",    "pop_total",               fmt.int],
              ["% HHI Below $50k",    "pct_hhi_u50",             fmt.pct],
              ["% Homes on SNAP",     "pct_snap",                fmt.pct],
              ["K-4 Grade Pop",       "pop_k_4_est",             fmt.int],
              ["5-8 Grade Pop",       "pop_5_8_est",             fmt.int],
              ["9-12 Grade Pop",      "pop_9_12_est",            fmt.int],
              ["Black Pop % K-8",     "pct_black",               fmt.pct],
              ["Hispanic Pop % K-8",  "pct_hispanic",            fmt.pct],
              ["Median HH Income",    "hh_median_income_approx", fmt.money],
            ].map(([label, k, f]) => html`
              <tr>
                <td>${label}</td>
                <td class="num">${f(rings["5min"]?.[k])}</td>
                <td class="num">${f(rings["10min"]?.[k])}</td>
                <td class="num">${f(rings["15min"]?.[k])}</td>
              </tr>`)}
          </tbody>
        </table>
      ` : html`<div class="text-xs text-ink-500 italic">No precomputed ring data for this school.</div>`}

      <div class="text-[11px] text-ink-500 leading-relaxed">
        Drive-time rings: great-circle approx at 22 mph. ACS 5-Yr 2023.${enroll5yr
          ? (region === "nj" ? " Enrollment: NJ DOE Fall Enrollment." : " Enrollment: FL DOE Survey 2.") : ""}
      </div>
    </div>
  `;
}

// Performance + demographics card shown when a school is focused.
function PerformanceBlock({ perf, region }) {
  const cfg = regionCfg(region || "fl");
  const pf = (v) => (v == null || isNaN(+v)) ? "—" : `${Math.round(+v)}%`;
  const pf1 = (v) => (v == null || isNaN(+v)) ? "—" : `${(+v).toFixed(1)}%`;

  const SUBJECTS = [
    ["ELA", perf.ela], ["Math", perf.math], ["Science", perf.science], ["Soc. Studies", perf.social_studies],
  ];
  const dy = perfYear(perf);
  const latestGrade = perf[`grade_${dy}`];
  const grades = [dy - 2, dy - 1, dy].map(y => [`'${String(y).slice(2)}`, perf[`grade_${y}`]]);
  const rp = perf.race_pct || {};
  const RACE = [
    ["Black", rp.black, "#7e22ce"],
    ["Hispanic", rp.hispanic, "#2563eb"],
    ["White", rp.white, "#9ca3af"],
    ["Asian", rp.asian, "#0891b2"],
    ["Other / 2+", (rp.pacific || 0) + (rp.amind || 0) + (rp.two_plus || 0), "#f59e0b"],
  ].filter(r => r[1] != null && r[1] > 0);

  const lowTested = perf.pct_tested != null && +perf.pct_tested < 95;

  return html`
    <div class="bg-ink-50 rounded-md p-2.5 space-y-2.5">
      <div class="flex items-baseline justify-between">
        <div class="text-[11px] font-semibold text-ink-700">Performance & Demographics</div>
        <span class="text-[10px] text-ink-500">${cfg.hasLetterGrades
          ? `FL DOE ${schoolYearLabel(dy)}` : `NJSLA ${schoolYearLabel(dy)}`}</span>
      </div>

      <!-- Letter grade + trend — Florida only; NJ issues no statewide A-F grade -->
      ${!cfg.hasLetterGrades ? null : html`
      <div class="flex items-center gap-2.5">
        <div style="width:34px;height:34px;border-radius:6px;background:${gradeColor(latestGrade)};
                    color:#fff;font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${latestGrade || "—"}
        </div>
        <div class="flex-1">
          <div class="text-[10px] text-ink-500 mb-0.5">School grade trend</div>
          <div class="flex gap-1">
            ${grades.map(([yr, g]) => html`
              <span class="flex items-center gap-1">
                <span style="width:14px;height:14px;border-radius:3px;background:${gradeColor(g)};color:#fff;
                             font-weight:700;font-size:9px;display:flex;align-items:center;justify-content:center">${g || "–"}</span>
                <span class="text-[10px] text-ink-500">${yr}</span>
              </span>
            `)}
          </div>
        </div>
      </div>`}

      <!-- Proficiency by subject -->
      <div>
        <div class="text-[10px] text-ink-500 mb-1">${cfg.hasLetterGrades
          ? "Proficiency — % scoring Level 3+"
          : "Proficiency — % meeting/exceeding expectations (grades 3-8)"}</div>
        <div class="space-y-1">
          ${SUBJECTS.map(([label, v]) => html`
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-ink-700 w-[68px] flex-shrink-0">${label}</span>
              <div style="flex:1;height:11px;background:#e5e7eb;border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${v == null ? 0 : Math.max(0, Math.min(100, +v))}%;
                            background:${profColor(v == null ? null : +v)};border-radius:3px"></div>
              </div>
              <span class="text-[11px] font-medium text-ink-800 w-[34px] text-right flex-shrink-0">${pf(v)}</span>
            </div>
          `)}
        </div>
        ${lowTested ? html`
          <div class="text-[10px] text-amber-700 mt-1">⚠ ${pf(perf.pct_tested)} tested — proficiency may be less representative.</div>
        ` : null}
      </div>

      <!-- Student demographics -->
      <div class="grid grid-cols-3 gap-2 pt-1 border-t border-ink-100">
        <div title=${perf.ed_basis || ""}>
          <div class="text-[10px] text-ink-500">${cfg.hasLetterGrades ? "Econ. Disadv." : "Free/Red. Lunch"}</div>
          <div class="text-sm font-semibold text-ink-900">${pf1(perf.ed_pct)}</div>
        </div>
        <div><div class="text-[10px] text-ink-500">${cfg.hasLetterGrades ? "ELL" : "Multilingual"}</div><div class="text-sm font-semibold text-ink-900">${pf1(perf.ell_pct)}</div></div>
        <div title=${cfg.hasLetterGrades
          ? "Per-school ESE not published by FL DOE in a downloadable file (Know Your Schools portal only)."
          : "NJ publishes students-with-disabilities among grades 3-8 test-takers."}>
          <div class="text-[10px] text-ink-500">${cfg.hasLetterGrades ? "ESE / SpEd" : "SpEd (tested)"}</div>
          <div class="text-sm font-semibold ${perf.ese_pct == null ? "text-ink-400" : "text-ink-900"}">${perf.ese_pct == null ? "n/a" : pf1(perf.ese_pct)}</div>
        </div>
      </div>

      <!-- Racial composition -->
      ${RACE.length ? html`
        <div>
          <div class="text-[10px] text-ink-500 mb-1">Racial composition ${perf.enrollment ? html`<span class="text-ink-400">· ${fmt.int(perf.enrollment)} students</span>` : null}</div>
          <div style="display:flex;height:13px;border-radius:3px;overflow:hidden">
            ${RACE.map(([, v, c]) => html`<div style="width:${v}%;background:${c}" title="${Math.round(v)}%"></div>`)}
          </div>
          <div class="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1">
            ${RACE.map(([label, v, c]) => html`
              <span class="flex items-center gap-1 text-[10px] text-ink-600">
                <span style="width:8px;height:8px;border-radius:2px;background:${c};display:inline-block"></span>
                ${label} ${Math.round(v)}%
              </span>
            `)}
          </div>
        </div>
      ` : null}

      <div class="text-[10px] text-ink-400 leading-snug pt-1 border-t border-ink-100">
        ${cfg.hasLetterGrades ? html`
          Proficiency & grades: FL DOE School Grades ${schoolYearLabel(dy)}. Race/ELL: FL DOE Membership 2025-26 Survey 2.
          ESE not available per-school from FL DOE downloads.
        ` : html`
          Proficiency: NJSLA ${schoolYearLabel(dy)}, grades 3-8 ELA + Math, % meeting/exceeding expectations
          (valid-score weighted). Race, Free/Reduced Lunch and Multilingual: NJ DOE Fall Enrollment 2025-26
          (whole school). SpEd is the share of grades 3-8 test-takers. NJ DOE reports each charter as one
          record per district, so multi-campus networks appear as a single network-level aggregate.
        `}
      </div>
    </div>
  `;
}

function EnrollmentChart({ enroll, region }) {
  const src = region === "nj" ? "NJ DOE Fall Enrollment" : "FL DOE Survey 2";
  const YEARS = ["2122","2223","2324","2425","2526"];
  const LABELS = ["'21-'22","'22-'23","'23-'24","'24-'25","'25-'26"];
  const totals = YEARS.map(y => enroll.years?.[y]?.total ?? null);
  const valid = totals.filter(v => v != null);
  if (!valid.length) return null;
  const mx = Math.max(...valid), mn = Math.min(...valid);
  const range = mx - mn || 1;
  const chg = enroll.change_5yr_n;
  const chgPct = enroll.change_5yr_pct;
  const chgCls = chg > 0 ? "text-green-700" : chg < 0 ? "text-red-700" : "text-ink-500";
  return html`
    <div class="bg-ink-50 rounded-md p-2.5">
      <div class="flex items-baseline justify-between mb-1.5">
        <div class="text-[11px] font-medium text-ink-700">Historical Enrollment (${src})</div>
        ${chg != null ? html`
          <div class="text-[11px] ${chgCls}">5-yr: ${chg >= 0 ? "+" : ""}${fmt.int(chg)} (${chgPct != null ? (chgPct*100).toFixed(1) : "?"}%)</div>
        ` : null}
      </div>
      <div style="position:relative;height:60px;display:flex;align-items:flex-end;gap:4px">
        ${totals.map((v, i) => {
          if (v == null) return html`<div style="flex:1"></div>`;
          const h = 10 + ((v - mn) / range) * 46;
          return html`
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
              <div style="font-size:9px;color:#6b7280;line-height:1">${fmt.int(v)}</div>
              <div style="width:100%;height:${h}px;background:#f97316;border-radius:2px 2px 0 0"></div>
            </div>`;
        })}
      </div>
      <div style="display:flex;gap:4px;margin-top:3px">
        ${LABELS.map(l => html`<div style="flex:1;font-size:9px;text-align:center;color:#9ca3af">${l}</div>`)}
      </div>
    </div>
  `;
}

// ==== heatmap.js ====
// Layers Panel — heat map choropleth + all map layer toggles + suitability weights.
// Rendered as a collapsible section in the unified sidebar.

const METRICS = [
  { id: "pop_k_8_est",  label: "K-8 Student Pop",    ramp: RAMP_ORANGE, kind: "count" },
  { id: "pop_k_4_est",  label: "K-4 Student Pop",    ramp: RAMP_ORANGE, kind: "count" },
  { id: "pop_5_8_est",  label: "5-8 Student Pop",    ramp: RAMP_ORANGE, kind: "count" },
  { id: "pct_hhi_u50",  label: "% HHI Below $50k",   ramp: RAMP_RED,    kind: "pct" },
  { id: "pct_snap",     label: "% on SNAP",          ramp: RAMP_RED,    kind: "pct" },
  { id: "pct_black",    label: "% Black (K-8 proxy)",ramp: RAMP_PURPLE, kind: "pct" },
  { id: "pct_hispanic", label: "% Hispanic (K-8)",   ramp: RAMP_BLUE,   kind: "pct" },
  { id: "pct_minority", label: "% Minority (B+H)",   ramp: RAMP_GREEN,  kind: "pct" },
  { id: "suitability",  label: "Suitability Score",  ramp: RAMP_ORANGE, kind: "pct" },
];

// Build a combined FC of block-groups with ACS joined, for the active region.
function joinedBGs(data, region) {
  const rd = regionData(data, region);
  const feats = [];
  for (const src of rd.blockGroups) {
    if (!src) continue;
    for (const f of src.features) {
      const g = f.properties?.GEOID;
      const rec = rd.acs[g];
      if (!rec) continue;
      const merged = { ...f.properties, ...rec };
      merged.pop_k_8_est = (rec.pop_k_4_est || 0) + (rec.pop_5_8_est || 0);
      merged.pct_minority = merged.pop_total > 0
        ? ((rec.pop_black_alone_all_ages||0) + (rec.pop_hispanic_all_ages||0)) / merged.pop_total
        : null;
      feats.push({ ...f, properties: merged });
    }
  }
  return { type: "FeatureCollection", features: feats };
}

function addSuitability(fc, weights) {
  const keys = Object.keys(weights);
  const maxes = {}, mins = {};
  for (const k of keys) {
    let mn=Infinity, mx=-Infinity;
    for (const f of fc.features) {
      const v = val(f.properties, k);
      if (v != null) { if (v>mx) mx=v; if (v<mn) mn=v; }
    }
    maxes[k] = mx === -Infinity ? 0 : mx;
    mins[k]  = mn === Infinity  ? 0 : mn;
  }
  for (const f of fc.features) {
    f.properties.suitability = score(f.properties, maxes, weights, mins).total;
  }
}

let BG_FC = null;
let BG_REGION = null;   // which region BG_FC was built for
let CURRENT_LAYER = null;
let CURRENT_BREAKS = null;

// ---------- Map rendering ----------
async function renderHeatLayers(state) {
  const map = await getMapIdle();
  const { data, heatLayer, showHeatMap } = state;
  const region = state.region || "fl";
  if (!data) return;

  // Rebuild the joined block groups when the region changes — the heat map
  // shares one `bg` source between regions and swaps its data.
  if (!BG_FC || BG_REGION !== region) {
    BG_FC = joinedBGs(data, region);
    BG_REGION = region;
    addSuitability(BG_FC, state.weights || DEFAULT_WEIGHTS);
  } else if (heatLayer === "suitability") {
    addSuitability(BG_FC, state.weights || DEFAULT_WEIGHTS);
    if (map.getSource("bg")) map.getSource("bg").setData(BG_FC);
  }

  if (!map.getSource("bg")) {
    map.addSource("bg", { type: "geojson", data: BG_FC });
  }
  map.getSource("bg").setData(BG_FC);

  const cfg = METRICS.find(m => m.id === heatLayer) || METRICS[0];
  const vals = BG_FC.features.map(f => f.properties[cfg.id]).filter(v => v != null);
  const breaks = quantileBreaks(vals, 9);
  CURRENT_LAYER = cfg;
  CURRENT_BREAKS = breaks;

  if (!map.getLayer("bg-heat")) {
    map.addLayer({
      id: "bg-heat", type: "fill", source: "bg",
      paint: { "fill-color": stepExpr(cfg.id, breaks, cfg.ramp), "fill-opacity": 0.78 },
    }, map.getLayer("sbd-fill") ? "sbd-fill" : undefined);
    map.addLayer({
      id: "bg-outline", type: "line", source: "bg",
      paint: { "line-color": "#ffffff", "line-width": 0.15 },
    });
    // Hover popup
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on("mousemove", "bg-heat", e => {
      if (!map.getLayoutProperty("bg-heat","visibility") || map.getLayoutProperty("bg-heat","visibility") === "none") return;
      const f = e.features[0], p = f.properties;
      const v = p[CURRENT_LAYER.id];
      const vstr = v == null ? "—"
        : CURRENT_LAYER.kind === "pct"
          ? (CURRENT_LAYER.id === "suitability" ? parseFloat(v).toFixed(1)+"%" : fmt.pct(parseFloat(v)))
          : fmt.int(parseFloat(v));
      popup.setLngLat(e.lngLat)
        .setHTML(`<div><strong>BG ${p.GEOID}</strong><br>${CURRENT_LAYER.label}: <b>${vstr}</b><br>
          Pop: ${fmt.int(parseFloat(p.pop_total))} · HHI&lt;$50k: ${fmt.pct(parseFloat(p.pct_hhi_u50))}</div>`)
        .addTo(map);
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "bg-heat", () => { popup.remove(); map.getCanvas().style.cursor = ""; });
  } else {
    map.setPaintProperty("bg-heat", "fill-color", stepExpr(cfg.id, breaks, cfg.ramp));
  }

  // Keep school bubbles + campus rings above the heat map so they stay readable.
  for (const id of [
    "school-dots-underutilized",
    "school-dots-public",
    "school-dots-charter",
    "school-dots-plp",
    "plp-radius-fill",
    "plp-radius-line",
    "campus-rings-fill",
    "campus-rings-line",
  ]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }

  // Visibility is managed by app.js syncLayerVisibility — don't touch it here.
  // Just update the legend DOM if heat map is on.
  if (showHeatMap) updateLegendDOM(cfg, breaks);
}

function updateLegendDOM(cfg, breaks) {
  const el = document.getElementById("heatmap-legend");
  if (!el) return;
  const swatches = cfg.ramp.map((c, i) => {
    const lo = i === 0 ? "min" : formatBreak(breaks[i-1], cfg.kind);
    const hi = i === cfg.ramp.length-1 ? "max" : formatBreak(breaks[i], cfg.kind);
    return `<div style="display:flex;align-items:center;gap:6px;line-height:1.3">
      <span style="width:14px;height:9px;background:${c};display:inline-block;border-radius:2px;flex-shrink:0"></span>
      <span style="color:#6b7280">${lo} – ${hi}</span>
    </div>`;
  }).join("");
  el.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${cfg.label}</div>${swatches}`;
}
function formatBreak(v, kind) {
  if (v == null) return "—";
  if (kind === "pct") return (v*100).toFixed(0)+"%";
  return Math.round(v).toLocaleString();
}

// ---------- LayersPanel component ----------
function LayersPanel({ state, store }) {
  useEffect(() => {
    if (state.showHeatMap) renderHeatLayers(state);
  }, [state.data, state.heatLayer, state.weights, state.showHeatMap, state.region]);

  // Re-run legend update whenever heat map is shown
  useEffect(() => {
    if (state.showHeatMap && CURRENT_LAYER && CURRENT_BREAKS) {
      updateLegendDOM(CURRENT_LAYER, CURRENT_BREAKS);
    }
  }, [state.showHeatMap, state.region]);

  const { data } = state;
  if (!data) return null;
  const region = state.region || "fl";
  const cfg = regionCfg(region);
  const rd = regionData(data, region);

  const weights = state.weights || { ...DEFAULT_WEIGHTS };
  const total = Object.values(weights).reduce((a,b) => a+(b||0), 0);

  const live = (rd.schools?.features || []).filter(f =>
    f.properties.status !== "closed" && f.properties.role !== "incubation");
  const counts = {
    district: live.filter(f => f.properties.role === "district").length,
    charter: live.filter(f => f.properties.role === "charter").length,
    stepup: data.stepupSchools?.features.length || 0,
    plp: Object.keys(data.plpSchools || {}).length,
    perf: rd.performance ? live.filter(f => rd.performance[perfKeyFor(region, f.properties)]).length : 0,
    browardPlaces: data.browardPlaces?.features.length || 0,
    mdcPlaces: data.mdcPlaces?.features.length || 0,
    orangePlaces: data.orangePlaces?.features.length || 0,
  };

  return html`
    <!-- ============ General ============ -->
    <details open>
      <summary class="sec-head"><span>General</span><span class="chev">›</span></summary>
      <div style="padding:var(--pad)" class="space-y-2.5">

        <!-- Heat Map -->
        <div class="space-y-1.5">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showHeatMap}
                   onChange=${e => store.set({ showHeatMap: e.target.checked })} />
            <span class="lyr">Demographic Heat Map<i>block-group choropleth · ACS 5-yr 2023</i></span>
          </label>
          ${state.showHeatMap ? html`
            <div class="flex flex-wrap gap-1" style="padding-left:20px">
              ${METRICS.map(m => html`
                <button
                  onClick=${() => store.set({ heatLayer: m.id })}
                  class="chip ${state.heatLayer === m.id ? "on" : ""}"
                >${m.label}</button>
              `)}
            </div>
            ${state.heatLayer === "suitability" ? html`
              <div class="text-[11px] text-ink-500" style="padding-left:20px">Suitability: weighted composite (100-pt scale). Edit weights below.</div>
            ` : null}
          ` : null}
        </div>

        <!-- School Performance bubbles -->
        <div class="space-y-1">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showPerformance}
                   onChange=${e => store.set({ showPerformance: e.target.checked })} />
            <span style="display:inline-flex;gap:2px;align-items:center;flex-shrink:0">
              <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#16a34a" stroke="#fff"></circle></svg>
              <svg width="12" height="12"><polygon points="6,1 11,11 1,11" fill="#dc2626" stroke="#fff"></polygon></svg>
            </span>
            <span class="lyr">School Performance<i>${cfg.perfSourceNote} · color = proficiency · shape = sector</i></span>
            <span class="cnt">${counts.perf}</span>
          </label>
          ${state.showPerformance ? html`
            <div class="text-[10px] text-ink-500 leading-snug" style="padding-left:20px">
              Color = ${cfg.perfCaption}, <span style="color:var(--neg);font-weight:600">red</span> → <span style="color:var(--pos);font-weight:600">green</span>.
              Size = enrollment. <b>○</b> district · <b>▲</b> charter. Click a school for full detail.
            </div>
          ` : null}
        </div>

      </div>
    </details>

    <!-- ============ Government Boundaries ============ -->
    <details open>
      <summary class="sec-head"><span>Government Boundaries</span><span class="chev">›</span></summary>
      <div style="padding:var(--pad)" class="space-y-2.5">

        ${cfg.boundaryGroups.map(group => html`
          <div class="space-y-1">
            <div class="grp">${group.label}</div>
            ${group.items.map(item => html`
              <label class="flex items-center gap-2 cursor-pointer" style="padding-left:8px">
                <input type="checkbox" checked=${!!state[item.flag]}
                       onChange=${e => store.set({ [item.flag]: e.target.checked })} />
                <span class="lyr">${item.title}<i>${item.caption}</i></span>
                ${item.countKey ? html`<span class="cnt">${counts[item.countKey]}</span>` : null}
              </label>
            `)}
          </div>
        `)}

      </div>
    </details>

    <!-- ============ School Points ============ -->
    <details open>
      <summary class="sec-head"><span>School Points</span><span class="chev">›</span></summary>
      <div style="padding:var(--pad)" class="space-y-2.5">

        <!-- District/public schools — BLUE circle -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showPublicSchools}
                 onChange=${e => store.set({ showPublicSchools: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:50%;background:#2563eb;border:1px solid #fff;box-shadow:0 0 0 1px #2563eb;display:inline-block;flex-shrink:0"></span>
          <span class="lyr">District Schools<i>size = enrollment</i></span>
          <span class="cnt">${counts.district}</span>
        </label>

        <!-- Charter schools — AMBER circle with dark ring -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showCharters}
                 onChange=${e => store.set({ showCharters: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:50%;background:#f59e0b;border:2px solid #78350f;display:inline-block;flex-shrink:0"></span>
          <span class="lyr">Charter Schools<i>size = enrollment</i></span>
          <span class="cnt">${counts.charter}</span>
        </label>

        <!-- Step Up private — PURPLE rounded-square (Florida only; NJ has no
             comparable statewide private-school roster yet) -->
        ${cfg.hasStepUp ? html`
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showStepUp}
                 onChange=${e => store.set({ showStepUp: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:18%;background:#9333ea;border:1.5px solid #581c87;display:inline-block;flex-shrink:0"></span>
          <span class="lyr">Private Schools<i>size = K-8 enrollment</i></span>
          <span class="cnt">${counts.stepup}</span>
        </label>` : html`
        <div class="text-[10px] text-ink-400 leading-snug">
          Private schools: no comparable NJ statewide roster wired up yet.
        </div>`}

      </div>
    </details>

    ${!cfg.hasStateSpecific ? null : html`
    <!-- ============ Florida-Specific ============ -->
    <details open>
      <summary class="sec-head"><span>Florida-Specific</span><span class="chev">›</span></summary>
      <div style="padding:var(--pad)" class="space-y-2.5">

        <!-- School of Hope eligible facilities (FL DOE FISH capacity) -->
        <div class="space-y-1">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showUnderutilized}
                   onChange=${e => store.set({ showUnderutilized: e.target.checked })} />
            <span style="display:inline-flex;gap:1px;flex-shrink:0">
              <span style="width:9px;height:9px;border-radius:50%;background:#16a34a;border:1px solid #fff"></span>
              <span style="width:9px;height:9px;border-radius:50%;background:#eab308;border:1px solid #fff"></span>
              <span style="width:9px;height:9px;border-radius:50%;background:#dc2626;border:1px solid #fff"></span>
            </span>
            <span class="lyr">School of Hope Eligible Facilities<i>utilization ≤ 75% or 400+ surplus seats</i></span>
          </label>
          ${state.showUnderutilized ? html`
            <div class="text-[10px] text-ink-500 leading-snug space-y-0.5" style="padding-left:20px">
              <div>Eligible if utilization <b>≤ 75%</b> <i>or</i> surplus <b>≥ 400</b> seats (FL statute).</div>
              <div>Size = surplus seats · Color by utilization:
                <span style="color:var(--pos);font-weight:600">green</span> 0–49% ·
                <span style="color:var(--warn);font-weight:600">yellow</span> 50–75% ·
                <span style="color:var(--neg);font-weight:600">red</span> 76–100%
              </div>
              <div class="text-ink-400">Source: FL DOE FISH Level of Service 2025-26.</div>
            </div>
          ` : null}
        </div>

        <!-- Persistently Low-Performing (FL DOE 2024-25) -->
        <div class="space-y-1">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showPlp}
                   onChange=${e => store.set({ showPlp: e.target.checked })} />
            <span style="width:11px;height:11px;border-radius:50%;background:#fee2e2;border:2.5px solid #b91c1c;display:inline-block;flex-shrink:0"></span>
            <span class="lyr">Persistently Low-Performing Schools<i>FL DOE 2024-25 list</i></span>
            <span class="cnt">${counts.plp}</span>
          </label>
          ${state.showPlp ? html`
            <div class="text-[10px] text-ink-500 leading-snug" style="padding-left:20px">
              FL DOE 2024-25 list · ${counts.plp} schools across Broward, Miami-Dade + Orange.
              Click any PLP school for campus analysis; a 5-mile radius will draw around it.
            </div>
          ` : null}
          <label class="flex items-center gap-2 cursor-pointer" style="padding-left:20px">
            <input type="checkbox" checked=${state.showPlpRadius}
                   onChange=${e => store.set({ showPlpRadius: e.target.checked })} />
            <span class="text-[11px] text-ink-600">5-mile radius around focused school</span>
          </label>
        </div>

      </div>
    </details>`}

    <!-- ============ Suitability weights (unlisted in the new hierarchy — kept as its own section) ============ -->
    <details>
      <summary class="sec-head">
        <span>Suitability weights · total = ${total.toFixed(0)}</span>
        <span class="chev">›</span>
      </summary>
      <div style="padding:var(--pad)" class="space-y-1">
        ${Object.keys(DEFAULT_WEIGHTS).map(k => html`
          <div class="flex items-center gap-2">
            <label class="text-[11px] text-ink-700 flex-1">${WEIGHT_LABELS[k]}</label>
            <input type="number" min="0" max="50" step="1"
              value=${weights[k] ?? 0}
              onInput=${e => {
                const v = parseFloat(e.target.value) || 0;
                store.set({ weights: { ...weights, [k]: v } });
              }}
              class="num-fld"
            />
          </div>
        `)}
        <button class="mt-1 text-[11px] text-kipp-600 hover:underline"
                onClick=${() => store.set({ weights: null })}>Reset to defaults</button>
      </div>
    </details>
  `;
}

// ==== sbd.js ====
// District Panel — SBD choropleth + per-district detail.
// Rendered as a collapsible section in the unified sidebar.

const DISTRICT_COLORS = {
  1: "#f97316", 2: "#0ea5e9", 3: "#22c55e", 4: "#a855f7",
  5: "#ef4444", 6: "#eab308", 7: "#14b8a6",
  8: "#ec4899", 9: "#3b82f6",
};

function polygonCentroid(geom) {
  const pts = [];
  const walk = c => { if (typeof c[0] === "number") pts.push(c); else c.forEach(walk); };
  walk(geom.coordinates);
  if (!pts.length) return null;
  return [pts.reduce((s,p)=>s+p[0],0)/pts.length, pts.reduce((s,p)=>s+p[1],0)/pts.length];
}

function fitBounds(map, feature) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const walk = c => {
    if (typeof c[0]==="number") { if(c[0]<minX)minX=c[0];if(c[0]>maxX)maxX=c[0];if(c[1]<minY)minY=c[1];if(c[1]>maxY)maxY=c[1]; }
    else c.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  map.fitBounds([[minX,minY],[maxX,maxY]], { padding:40, duration:700 });
}

// ---------- Map rendering ----------
// Builds SBD layers for one county. The per-county flag is applied via
// setLayoutProperty inside app.js::syncLayerVisibility so we just always
// render the source + layer if data exists.
function fillColorExpr() {
  return ["case",
    ["==",["get","district"],1], DISTRICT_COLORS[1],
    ["==",["get","district"],2], DISTRICT_COLORS[2],
    ["==",["get","district"],3], DISTRICT_COLORS[3],
    ["==",["get","district"],4], DISTRICT_COLORS[4],
    ["==",["get","district"],5], DISTRICT_COLORS[5],
    ["==",["get","district"],6], DISTRICT_COLORS[6],
    ["==",["get","district"],7], DISTRICT_COLORS[7],
    ["==",["get","district"],8], DISTRICT_COLORS[8],
    ["==",["get","district"],9], DISTRICT_COLORS[9],
    "#ccc"
  ];
}

function buildSbdFC(sbdSrc, countyTag) {
  return {
    type: "FeatureCollection",
    features: sbdSrc.features.map(f => ({
      type: "Feature",
      properties: { district: Number(f.properties.district), county: countyTag },
      geometry: JSON.parse(JSON.stringify(f.geometry)),
    })),
  };
}

function ensureSbdLayer(map, tag, sbdSrc, focusDistrict, focusCounty) {
  if (!sbdSrc) return;
  const srcId = `sbd-${tag}`;
  const fillId = `sbd-${tag}-fill`;
  const lineId = `sbd-${tag}-line`;

  // Safari tiling workaround — recreate layer each render so focus opacity
  // updates cleanly. Source is stable so we only add it once.
  [fillId, lineId].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (!map.getSource(srcId)) {
    map.addSource(srcId, { type: "geojson", data: buildSbdFC(sbdSrc, tag) });
  }

  const isFocusCounty = focusCounty === tag;
  map.addLayer({
    id: fillId, type: "fill", source: srcId,
    paint: {
      "fill-color": fillColorExpr(),
      "fill-opacity": ["case",
        ["==",["get","district"], (isFocusCounty ? focusDistrict : null) || -1], 0.55, 0.22],
    },
  });
  map.addLayer({
    id: lineId, type: "line", source: srcId,
    paint: { "line-color": "#374151", "line-width": 1.5 },
  });

  // Click handler — bind once per layer
  if (!map[`__sbdClick_${tag}`]) {
    map.on("click", fillId, e => {
      const d = e.features[0].properties.district;
      window.__store?.set({
        focusDistrict: Number(d),
        county: tag === "mdc" ? "miamidade" : tag === "org" ? "orange" : "broward",
      });
    });
    map.on("mouseenter", fillId, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", fillId, () => map.getCanvas().style.cursor = "");
    map[`__sbdClick_${tag}`] = true;
  }
}

// ---------- New Jersey wards (the NJ analog of Florida's SBDs) ----------
// Ward polygons per city, colored from the same palette as the FL districts so
// the two regions read alike. Newark's wards are named (Central/East/...), so
// the fill expression matches on the ward string rather than a number.
// Sub-area display labels. Florida districts are numbered ("District 5"); NJ
// wards are either compass names (Newark -> "West Ward") or numbers
// (Camden/Paterson -> "Ward 3"). The matrix table needs a very short form, and
// since each column also carries a color swatch, an initial/number is enough.
function areaLabel(region, id, noun = "District") {
  if (region !== "nj") return `${noun} ${id}`;
  return isNaN(+id) ? `${id} Ward` : `Ward ${id}`;
}
function areaShort(region, id) {
  if (region !== "nj") return `D${id}`;
  return isNaN(+id) ? String(id).charAt(0) : `W${id}`;
}

const WARD_COLORS = ["#f97316", "#0ea5e9", "#22c55e", "#a855f7", "#ef4444", "#eab308", "#14b8a6"];

function wardFillExpr(wards) {
  const expr = ["case"];
  wards.forEach((w, i) => {
    expr.push(["==", ["get", "ward"], w], WARD_COLORS[i % WARD_COLORS.length]);
  });
  expr.push("#94a3b8");
  return expr;
}

function ensureWardLayer(map, tag, city, wardsSrc, focusDistrict, focusCity) {
  if (!wardsSrc) return;
  const feats = wardsSrc.features.filter(f => f.properties.city === city);
  if (!feats.length) return;
  const srcId = `wards-${tag}`;
  const fillId = `wards-${tag}-fill`;
  const lineId = `wards-${tag}-line`;
  const wardList = feats.map(f => f.properties.ward);

  // Recreated each render so the focus highlight updates, mirroring ensureSbdLayer.
  [fillId, lineId].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (!map.getSource(srcId)) {
    map.addSource(srcId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: feats.map(f => ({
        type: "Feature",
        properties: { ...f.properties },
        geometry: JSON.parse(JSON.stringify(f.geometry)),
      }))},
    });
  }

  const focused = (focusCity === city && focusDistrict != null) ? String(focusDistrict) : "__no_ward__";
  map.addLayer({
    id: fillId, type: "fill", source: srcId,
    layout: { visibility: "none" },
    paint: {
      "fill-color": wardFillExpr(wardList),
      "fill-opacity": ["case", ["==", ["get", "ward"], focused], 0.55, 0.22],
    },
  });
  map.addLayer({
    id: lineId, type: "line", source: srcId,
    layout: { visibility: "none" },
    paint: { "line-color": "#374151", "line-width": 1.5 },
  });

  if (!map[`__wardClick_${tag}`]) {
    map.on("click", fillId, e => {
      const f = e.features?.[0]; if (!f) return;
      window.__store?.set({ focusDistrict: f.properties.ward, county: f.properties.city });
    });
    map.on("mouseenter", fillId, () => map.getCanvas().style.cursor = "pointer");
    map.on("mouseleave", fillId, () => map.getCanvas().style.cursor = "");
    map[`__wardClick_${tag}`] = true;
  }
}

// NJ city outline — single polygon per city, styled like the FL municipal layer.
function ensureNjPlaceLayer(map, tag, city, placesSrc) {
  if (!placesSrc) return;
  const srcId = `njplaces-${tag}`;
  const lineId = `njplaces-${tag}-line`;
  if (map.getSource(srcId)) return;
  const feats = placesSrc.features.filter(f => f.properties.city === city);
  if (!feats.length) return;
  map.addSource(srcId, { type: "geojson", data: { type: "FeatureCollection", features: feats } });
  map.addLayer({
    id: lineId, type: "line", source: srcId,
    layout: { visibility: "none" },
    paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0.9, "line-dasharray": [3, 2] },
  });
}

// ---------- Municipal boundaries (incorporated places), per county ----------
// Unlike SBDs these have no per-district focus state to refresh, so the
// source + layers are created once and left alone (idempotent).
function buildPlacesFC(placesSrc, countyTag) {
  return {
    type: "FeatureCollection",
    features: placesSrc.features.map(f => ({
      type: "Feature",
      properties: { name: f.properties.name, county: countyTag },
      geometry: JSON.parse(JSON.stringify(f.geometry)),
    })),
  };
}

function ensurePlacesLayer(map, tag, placesSrc) {
  if (!placesSrc) return;
  const srcId = `places-${tag}`;
  const fillId = `places-${tag}-fill`;
  const lineId = `places-${tag}-line`;
  if (map.getSource(srcId)) return; // already initialized

  map.addSource(srcId, { type: "geojson", data: buildPlacesFC(placesSrc, tag) });
  map.addLayer({
    id: fillId, type: "fill", source: srcId,
    layout: { visibility: "none" },
    paint: { "fill-color": "#ffffff", "fill-opacity": 0.02 },
  });
  map.addLayer({
    id: lineId, type: "line", source: srcId,
    layout: { visibility: "none" },
    // White + a dark halo-ish width keeps this legible whether it's sitting on the
    // plain dark basemap or on top of a saturated SBD fill color.
    paint: { "line-color": "#ffffff", "line-width": 1.4, "line-opacity": 0.85, "line-dasharray": [2, 1.5] },
  });

  // Hover popup with the municipality name. No click handler here — the SBD
  // fill sits underneath and already owns click-to-focus-district; stacking
  // a second click behavior on the same point would fight it.
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map.on("mousemove", fillId, e => {
    const vis = map.getLayoutProperty(fillId, "visibility");
    if (!vis || vis === "none") return;
    const f = e.features?.[0]; if (!f) return;
    popup.setLngLat(e.lngLat)
      .setHTML(`<div style="font-size:12px"><strong>${f.properties.name}</strong></div>`)
      .addTo(map);
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", fillId, () => { popup.remove(); map.getCanvas().style.cursor = ""; });
}

async function renderSBDLayers(state) {
  const map = await getMapIdle();
  const { data, focusDistrict, county, showStepUp } = state;
  if (!data) return;

  // Clear Step Up markers (re-added below, filtered by per-county flags)
  (window.__stepupMarkers || []).forEach(m => m.remove());
  window.__stepupMarkers = [];

  const region = state.region || "fl";

  if (region === "fl") {
    ensureSbdLayer(map, "brw", data.sbd,    focusDistrict, county === "broward"   ? "brw" : null);
    ensureSbdLayer(map, "mdc", data.mdcSbd, focusDistrict, county === "miamidade" ? "mdc" : null);
    ensureSbdLayer(map, "org", data.orangeSbd, focusDistrict, county === "orange" ? "org" : null);

    ensurePlacesLayer(map, "brw", data.browardPlaces);
    ensurePlacesLayer(map, "mdc", data.mdcPlaces);
    ensurePlacesLayer(map, "org", data.orangePlaces);
  } else {
    for (const city of ["newark", "camden", "paterson"]) {
      const tag = AREA_TAG[city];
      ensureWardLayer(map, tag, city, data.njWards, focusDistrict, county);
      ensureNjPlaceLayer(map, tag, city, data.njPlaces);
    }
  }

  // District labels — recreated from whichever counties have layers. Visibility
  // toggled in app.js syncLayerVisibility based on per-county flags.
  (window.__sbdLabelMarkers || []).forEach(m => m.remove());
  window.__sbdLabelMarkers = [];
  for (const [tag, src] of [["brw", data.sbd], ["mdc", data.mdcSbd], ["org", data.orangeSbd]]) {
    if (!src) continue;
    for (const f of src.features) {
      const d = Number(f.properties.district);
      const c = polygonCentroid(f.geometry);
      if (!c) continue;
      const el = document.createElement("div");
      el.textContent = "D" + d;
      el.dataset.sbdCounty = tag;
      el.style.cssText = `font:700 18px system-ui,sans-serif;color:#111827;
        text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;pointer-events:none;user-select:none;`;
      window.__sbdLabelMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map));
    }
  }

  // Ward labels (NJ). Newark's are names, so they get the plain label rather
  // than a "D#" prefix.
  (window.__wardLabelMarkers || []).forEach(m => m.remove());
  window.__wardLabelMarkers = [];
  if (data.njWards) {
    for (const f of data.njWards.features) {
      const c = polygonCentroid(f.geometry);
      if (!c) continue;
      const el = document.createElement("div");
      el.textContent = f.properties.ward_label || f.properties.ward;
      el.dataset.wardTag = AREA_TAG[f.properties.city];
      el.style.cssText = `font:700 13px var(--font-brand),system-ui,sans-serif;color:#111827;
        text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;pointer-events:none;user-select:none;
        white-space:nowrap;display:none;`;
      window.__wardLabelMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map));
    }
  }

  // Step Up markers — tagged with county so syncLayerVisibility can toggle per-county
  if (showStepUp && data.stepupSchools) {
    for (const f of data.stepupSchools.features) {
      const k8 = f.properties.enroll_k8 || 0;
      const r = Math.max(4, Math.min(24, Math.sqrt(k8) * 0.6));
      const c = f.properties.county;
      const tag = (c === "miami-dade" || c === "miamidade") ? "mdc" : "brw";
      const el = document.createElement("div");
      el.dataset.stepupCounty = tag;
      el.style.cssText = `width:${r*2}px;height:${r*2}px;border-radius:18%;background:rgba(147,51,234,0.75);
        border:1.5px solid #581c87;pointer-events:auto;cursor:pointer;`;
      el.title = `${f.properties.name} — K-8: ${k8}`;
      const popup = new maplibregl.Popup({ offset: r+4 })
        .setHTML(`<div><strong>${f.properties.name}</strong><br>
          ${f.properties.city}, FL ${f.properties.zip}<br>
          K-8: <b>${k8}</b> · Total: ${f.properties.enroll_total || 0}<br>
          Grades: ${f.properties.grade_levels || ""}</div>`);
      const m = new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).setPopup(popup).addTo(map);
      (window.__stepupMarkers = window.__stepupMarkers || []).push(m);
    }
  }

  // Fly to focused district (respects current sidebar county)
  if (focusDistrict) {
    const sbdSrc = county === "miamidade" ? data.mdcSbd : data.sbd;
    const feat = sbdSrc?.features.find(f => Number(f.properties.district) === focusDistrict);
    if (feat) fitBounds(map, feat);
  }

  // Municipal boundaries read as a finer overlay above the SBD fill, but
  // still below school points/rings — pull them up every render since the
  // SBD fill/line layers above get removed + re-added each time (Safari
  // tiling workaround) and would otherwise climb back on top.
  for (const id of ["places-brw-fill", "places-brw-line", "places-mdc-fill", "places-mdc-line",
                     "places-org-fill", "places-org-line",
                     "njplaces-nwk-line", "njplaces-cam-line", "njplaces-pat-line"]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }

  // Keep schools on top — sbd layers just got re-added
  moveSchoolsOnTop(map);
}

// ---------- DistrictPanel component ----------
function DistrictPanel({ state, store }) {
  useEffect(() => { renderSBDLayers(state); },
    [state.data, state.focusDistrict, state.showStepUp, state.county, state.region,
     state.showBrowardSBD, state.showMiamiDadeSBD, state.showOrangeSBD,
     state.showNewarkWards, state.showCamdenWards, state.showPatersonWards]);

  const { data, focusDistrict, county } = state;
  if (!data) return null;
  const region = state.region || "fl";
  const cfg = regionCfg(region);

  let rollupSrc, stepupRollup, charterOps, districtIds;
  if (region === "nj") {
    // Ward rollups are keyed "<city>-<ward>"; reduce to this city's wards so the
    // shared tables below can treat them exactly like FL district numbers.
    const all = data.njWardRollup || {};
    const prefix = county + "-";
    rollupSrc = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(prefix)) rollupSrc[k.slice(prefix.length)] = v;
    }
    rollupSrc._average = all[`_average_${county}`] || all._average || {};
    districtIds = Object.keys(rollupSrc).filter(k => k !== "_average").sort();
    stepupRollup = null;
    charterOps = null;
    if (!districtIds.length) return null;
  } else {
    const isMiami = county === "miamidade";
    const isOrange = county === "orange";
    rollupSrc = isOrange ? data.orangeSbdRollup : isMiami ? data.mdcSbdRollup : data.sbdRollup;
    stepupRollup = isOrange ? null : isMiami ? data.stepupMdcSbdRollup : data.stepupSbdRollup;
    charterOps = isOrange ? null : isMiami ? data.charterOperatorsMdc : data.charterOperators;
    districtIds = isMiami ? [1,2,3,4,5,6,7,8,9] : [1,2,3,4,5,6,7];
  }
  if (!rollupSrc) return null;
  // Color lookup: FL districts are numbered 1-9; NJ wards may be names, so fall
  // back to position in the ward list.
  const colorOf = (id) => DISTRICT_COLORS[id]
    || WARD_COLORS[Math.max(0, districtIds.indexOf(id)) % WARD_COLORS.length];
  const noun = cfg.subAreaNoun;

  const cohort = Object.entries(rollupSrc).filter(([k]) => k !== "_average");
  const ranked = rankCohort(cohort, state.weights || DEFAULT_WEIGHTS);
  const sortedDist = ranked.scored.slice().sort((a,b) => b.score - a.score);

  return html`
    <details>
      <summary class="sec-head"><span>${cfg.analysisTitle}</span><span class="chev">›</span></summary>

      <!-- Sub-area selector for sidebar content (map shows whatever layers are toggled) -->
      <div style="padding:9px var(--pad);border-bottom:1px solid var(--hair)" class="flex items-center gap-2">
        <span class="grp" style="margin:0">Show data for</span>
        <div class="segrow">
          ${cfg.areas.map(c => html`
            <button
              onClick=${() => store.set({ county: c.id, focusDistrict: null })}
              class="seg ${state.county === c.id ? "on" : ""}"
            >${c.label}</button>
          `)}
        </div>
      </div>

      ${focusDistrict ? html`
        <${DistrictDetail}
          district=${focusDistrict} data=${data} store=${store} state=${state}
          rollupSrc=${rollupSrc} stepupRollup=${stepupRollup} county=${county}
          noun=${noun} colorOf=${colorOf} districtIds=${districtIds}
        />
      ` : html`
        <div class="p-3 space-y-3">

          <!-- Suitability ranking -->
          <table class="data">
            <thead><tr><th>Rank</th><th>${noun}</th><th class="num">Suitability</th></tr></thead>
            <tbody>
              ${sortedDist.map((s, i) => html`
                <tr onClick=${() => store.set({ focusDistrict: region === "nj" ? s.id : Number(s.id) })}
                    class="cursor-pointer hover:bg-kipp-50">
                  <td class="num text-ink-500">${i+1}</td>
                  <td>
                    <span style="display:inline-block;width:8px;height:8px;background:${colorOf(s.id)};border-radius:2px;margin-right:5px"></span>
                    ${areaLabel(region, s.id, noun)}
                  </td>
                  <td class="num font-semibold">${fmt.pct(s.score/100, 1)}</td>
                </tr>
              `)}
            </tbody>
          </table>

          <!-- Demographic comparison table (scrollable) -->
          <div class="overflow-x-auto text-[11px]">
            <${SBDTable} sbdRollup=${rollupSrc} districtIds=${districtIds} colorOf=${colorOf} region=${region} />
          </div>

          ${charterOps ? html`<${CharterOperatorsPanel} data=${charterOps} />` : null}

          ${data.stepupSchools && stepupRollup ? html`
            <div class="bg-white rounded-md border border-ink-100 overflow-hidden">
              <div class="px-3 py-2 text-xs font-medium text-ink-700 border-b border-ink-100 bg-ink-100/50 flex items-center justify-between">
                <span>Step Up Private Schools (FES/FTC)</span>
                <label class="text-[11px] text-ink-500 flex items-center gap-1 cursor-pointer font-normal">
                  <input type="checkbox" checked=${state.showStepUp}
                         onChange=${e => store.set({ showStepUp: e.target.checked })} />
                  Map
                </label>
              </div>
              <table class="data">
                <thead><tr><th>District</th><th class="num">#</th><th class="num">K-8</th><th class="num">Total</th></tr></thead>
                <tbody>
                  ${districtIds.map(d => {
                    const r = stepupRollup[String(d)] || { n:0, k8:0, total:0 };
                    return html`<tr>
                      <td>D${d}</td>
                      <td class="num">${r.n}</td>
                      <td class="num">${fmt.int(r.k8)}</td>
                      <td class="num">${fmt.int(r.total)}</td>
                    </tr>`;
                  })}
                </tbody>
              </table>
            </div>
          ` : null}

          <${DistrictTakeaways} sortedDist=${sortedDist} data=${data} county=${county} noun=${noun} region=${region} />
        </div>
      `}
    </details>
  `;
}

function DistrictDetail({ district, data, store, state, rollupSrc, stepupRollup, county,
                          noun = "District", colorOf, districtIds }) {
  const region = state?.region || "fl";
  const src = rollupSrc || data.sbdRollup;
  const rec = src[String(district)];
  const avg = src._average || {};
  // Step Up is Florida-only, so NJ never populates this table.
  const sbdKey = county === "miamidade" ? "mdc_sbd" : "sbd";
  const stepupSchools = region !== "fl" ? [] : (data.stepupSchools?.features || [])
    .filter(f => f.properties[sbdKey] === district)
    .sort((a,b) => (b.properties.enroll_total||0) - (a.properties.enroll_total||0));
  const swatch = (colorOf ? colorOf(district) : DISTRICT_COLORS[district]);
  const fullLabel = areaLabel(region, district, noun);
  const shortLabel = areaShort(region, district);
  const rows = [
    ["Population (2025)",    "pop_total",               fmt.int],
    ["% HHI Below $50k",    "pct_hhi_u50",             fmt.pct],
    ["% Homes on SNAP",     "pct_snap",                fmt.pct],
    ["K-4 Grade Pop",       "pop_k_4_est",             fmt.int],
    ["5-8 Grade Pop",       "pop_5_8_est",             fmt.int],
    ["9-12 Grade Pop",      "pop_9_12_est",            fmt.int],
    ["Black Pop % K-8",     "pct_black",               fmt.pct],
    ["Hispanic Pop % K-8",  "pct_hispanic",            fmt.pct],
    ["Median HH Income",    "hh_median_income_approx", fmt.money],
    ["% Renter HH",         "pct_renter",              fmt.pct],
  ];
  return html`
    <div class="p-4 space-y-3">
      <button onClick=${() => store.set({ focusDistrict: null })}
              class="text-xs text-kipp-600 hover:underline">← All ${noun.toLowerCase()}s</button>
      <div class="flex items-center gap-2">
        <span style="display:inline-block;width:14px;height:14px;background:${swatch};border-radius:3px"></span>
        <h2 class="text-base font-semibold text-ink-900">${fullLabel}</h2>
        <span class="text-xs text-ink-500">${region === "nj"
          ? (county.charAt(0).toUpperCase() + county.slice(1))
          : `${county === "miamidade" ? "Miami-Dade" : county === "orange" ? "Orange" : "Broward"} SBD`}</span>
      </div>
      <table class="data">
        <thead><tr><th>Demographic</th><th class="num">${shortLabel}</th><th class="num">Avg</th><th class="num">+/−</th></tr></thead>
        <tbody>
          ${rows.map(([label, k, f]) => {
            const v = rec?.[k], a = avg[k];
            const delta = v!=null&&a!=null ? v-a : null;
            return html`<tr>
              <td>${label}</td>
              <td class="num">${f(v)}</td>
              <td class="num text-ink-500">${f(a)}</td>
              <td class="num ${delta!=null ? (delta>0?"text-green-700":"text-red-700") : ""}">
                ${delta==null ? "—" : (k.startsWith("pct") ? fmt.signed(delta) : (delta>=0?"+":"")+fmt.int(delta))}
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
      <div class="text-[11px] text-ink-500">${rec?.bg_count||0} Census block groups.</div>

      ${stepupSchools.length ? html`
        <div class="border border-ink-100 rounded-md overflow-hidden">
          <div class="px-3 py-2 text-xs font-medium text-ink-700 bg-ink-50 border-b border-ink-100">
            Step Up in ${shortLabel} · ${stepupSchools.length} schools
          </div>
          <div class="max-h-[260px] overflow-y-auto scrollbar-thin">
            <table class="data">
              <thead><tr><th>School</th><th>Grades</th><th class="num">K-8</th><th class="num">Tot</th></tr></thead>
              <tbody>
                ${stepupSchools.slice(0,40).map(f => html`<tr>
                  <td>${f.properties.name}</td>
                  <td class="text-ink-500">${f.properties.grade_levels||""}</td>
                  <td class="num">${fmt.int(f.properties.enroll_k8)}</td>
                  <td class="num">${fmt.int(f.properties.enroll_total)}</td>
                </tr>`)}
                ${stepupSchools.length>40 ? html`<tr><td colspan="4" class="text-[11px] text-ink-400 italic">…${stepupSchools.length-40} more</td></tr>` : null}
              </tbody>
            </table>
          </div>
        </div>
      ` : null}
    </div>
  `;
}

function SBDTable({ sbdRollup, districtIds, colorOf, region }) {
  const ids = districtIds || [1,2,3,4,5,6,7];
  const color = colorOf || (d => DISTRICT_COLORS[d]);
  const head = (d) => areaShort(region || "fl", d);
  const avg = sbdRollup._average || {};
  const rows = [
    ["Population",  "pop_total",   fmt.int],
    ["% HHI<$50k",  "pct_hhi_u50", fmt.pct],
    ["% SNAP",      "pct_snap",    fmt.pct],
    ["K-4 Pop",     "pop_k_4_est", fmt.int],
    ["5-8 Pop",     "pop_5_8_est", fmt.int],
    ["% Black",     "pct_black",   fmt.pct],
    ["% Hispanic",  "pct_hispanic",fmt.pct],
    ["Med. Income", "hh_median_income_approx", fmt.money],
  ];
  return html`
    <table class="data">
      <thead>
        <tr>
          <th></th>
          ${ids.map(d => html`<th class="num" style="padding:2px 5px">
            <span style="display:inline-block;width:7px;height:7px;background:${color(d)};border-radius:2px;margin-right:2px;vertical-align:middle"></span>${head(d)}
          </th>`)}
          <th class="num" style="padding:2px 5px">Avg</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(([label, k, f]) => html`
          <tr>
            <td style="padding:2px 5px;white-space:nowrap">${label}</td>
            ${ids.map(d => {
              const r = sbdRollup[String(d)] || {};
              const v = r[k], a = avg[k];
              const cls = v!=null&&a!=null ? (v>a?"text-green-700 bg-green-50":"text-red-700 bg-red-50") : "";
              return html`<td class="num ${cls}" style="padding:2px 5px">${f(v)}</td>`;
            })}
            <td class="num text-ink-500" style="padding:2px 5px">${f(avg[k])}</td>
          </tr>`)}
      </tbody>
    </table>
  `;
}

function CharterOperatorsPanel({ data }) {
  const YEARS = ["2122","2223","2324","2425","2526"];
  const ops = Object.entries(data.operators).sort((a,b)=>b[1].enrollment["2526"]-a[1].enrollment["2526"]);
  return html`
    <div class="border border-ink-100 rounded-md overflow-hidden">
      <div class="px-3 py-2 text-xs font-medium text-ink-700 bg-ink-50 border-b border-ink-100">
        Major Charter Operators
      </div>
      <div class="overflow-x-auto">
        <table class="data">
          <thead><tr>
            <th>Operator</th><th class="num">#</th>
            ${YEARS.map(y => html`<th class="num">${"'"+y.slice(0,2)}</th>`)}
            <th class="num">5yr Δ</th><th class="num">Shr</th>
          </tr></thead>
          <tbody>
            ${ops.map(([op, r]) => html`
              <tr>
                <td>${op}</td><td class="num">${r.n_schools}</td>
                ${YEARS.map(y => html`<td class="num">${fmt.int(r.enrollment[y])}</td>`)}
                <td class="num ${r.change_5yr_n>0?"text-green-700":r.change_5yr_n<0?"text-red-700":""} font-semibold">
                  ${r.change_5yr_n>=0?"+":""}${fmt.int(r.change_5yr_n)}
                </td>
                <td class="num">${fmt.pct(r.market_share["2526"])}</td>
              </tr>`)}
            <tr class="font-semibold bg-ink-100/30">
              <td>TOTAL</td><td></td>
              ${YEARS.map(y => html`<td class="num">${fmt.int(data.totals[y])}</td>`)}
              <td></td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function DistrictTakeaways({ sortedDist, data, county, noun = "District", region = "fl" }) {
  const top = sortedDist[0], bottom = sortedDist[sortedDist.length-1];
  return html`
    <details class="border border-ink-100 rounded-md overflow-hidden" open>
      <summary class="px-3 py-2 text-xs font-medium text-ink-700 bg-ink-50 border-b border-ink-100 cursor-pointer">
        Takeaways
      </summary>
      <div class="p-3 space-y-1.5 text-xs leading-relaxed text-ink-700">
        <div><strong>Best suitability:</strong>
          <span class="pill ml-1" style="background:#dcfce7;color:#166534">${areaLabel(region, top.id, noun)}</span>
          <span class="text-ink-500">(${fmt.pct(top.score/100)},
            ${Math.round(top.score - sortedDist[1].score)} pts ahead of ${sortedDist[1].id})</span>
        </div>
        <div><strong>Weakest:</strong>
          <span class="pill ml-1" style="background:#fee2e2;color:#991b1b">${areaLabel(region, bottom.id, noun)}</span>
          <span class="text-ink-500">(${fmt.pct(bottom.score/100)})</span>
        </div>
      </div>
    </details>
  `;
}
