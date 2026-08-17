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

export const REGIONS = {
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

export const REGION_IDS = ["fl", "nj"];

// city/county id -> the 3-letter tag used in map layer ids
export const AREA_TAG = {
  broward: "brw", miamidade: "mdc", orange: "org",
  newark: "nwk", camden: "cam", paterson: "pat",
};

export function regionCfg(region) {
  return REGIONS[region] || REGIONS.fl;
}

// Which region does a given area id belong to?
export function regionOfArea(areaId) {
  for (const r of REGION_IDS) {
    if (REGIONS[r].areas.some(a => a.id === areaId)) return r;
  }
  return "fl";
}

// Pull the active region's slice of the loaded dataset. Returns the same shape
// for both regions so callers don't branch.
export function regionData(data, region) {
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
export function perfKeyFor(region, props) {
  if (!props) return null;
  if (region === "nj") return props.id || null;
  const num = props.school_num;
  if (!num) return null;
  const d = props.county === "miamidade" ? "13" : props.county === "orange" ? "48" : "06";
  return `${d}-${num}`;
}

// Enrollment-history lookup key, same reasoning as perfKeyFor.
export function enrollKeyFor(region, props) {
  if (!props) return null;
  if (region === "nj") return props.id || null;
  if (props.enroll_key) return props.enroll_key;
  if (!props.school_num) return null;
  const d = props.county === "miamidade" ? "13" : props.county === "orange" ? "48" : "06";
  return `${d}-${props.school_num}`;
}
