// Data loader + small reactive store.
// All GeoJSON/JSON lives in ../data/processed (symlinked as ./data/).

async function j(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export async function loadAll() {
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
  };
}

// Build the join key the performance dataset uses: "<district>-<school_num>"
// (06 = Broward, 13 = Miami-Dade). Mirrors the enroll_key pattern in campus.js.
export function perfKey(props) {
  if (!props) return null;
  const num = props.school_num;
  if (!num) return null;
  const d = props.county === "miamidade" ? "13" : props.county === "orange" ? "48" : "06";
  return `${d}-${num}`;
}

// Small signal-like subscribable store
export function createStore(initial) {
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
