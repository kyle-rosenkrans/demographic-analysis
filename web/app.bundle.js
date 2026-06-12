// app.js
import { h as h4, render } from "https://esm.sh/preact@10.22.0";
import { useEffect as useEffect4, useRef, useState } from "https://esm.sh/preact@10.22.0/hooks";
import htm4 from "https://esm.sh/htm@3.1.1";

// state.js
async function j(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function loadAll() {
  if (typeof globalThis !== "undefined" && globalThis.__DATA) return globalThis.__DATA;
  const [
    schools,
    sbd,
    bgBroward,
    bgMiami,
    counties,
    acsBroward,
    acsMiami,
    campusRollup,
    sbdRollup,
    countyRollup,
    schema,
    bgAssignment,
    bcpsBoundaries
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
    j("./data/bcps_boundaries.geojson").catch(() => null)
  ]);
  const [
    stepupSchools,
    stepupSbdRollup,
    campusEnroll,
    districtEnroll,
    enrollBySchool,
    charterOperators,
    mdcSbd,
    mdcSbdRollup,
    stepupMdcSbdRollup,
    mdcBoundaries,
    mdcSchools,
    universalSchools,
    universalRings,
    charterOperatorsMdc,
    schoolCapacity,
    plpSchools,
    schoolPerformance
  ] = await Promise.all([
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
    j("./data/school_performance.json").catch(() => null)
  ]);
  const [
    orangeUniversal,
    orangePerf,
    acsOrange,
    bgOrange,
    orangeRings,
    orangePlp,
    orangeEnroll,
    orangeSbd,
    orangeSbdRollup,
    orangeCapacity
  ] = await Promise.all([
    j("./data/orange_universal_schools.geojson").catch(() => null),
    j("./data/orange_school_performance.json").catch(() => null),
    j("./data/acs_orange.json").catch(() => null),
    j("./data/orange_blockgroups.geojson").catch(() => null),
    j("./data/orange_rings.json").catch(() => null),
    j("./data/orange_plp.json").catch(() => null),
    j("./data/orange_enrollment_by_school.json").catch(() => null),
    j("./data/orange_sbd.geojson").catch(() => null),
    j("./data/orange_sbd_rollup.json").catch(() => null),
    j("./data/orange_capacity.json").catch(() => null)
  ]);
  const mergedUniversal = universalSchools ? { ...universalSchools, features: [...universalSchools.features, ...orangeUniversal && orangeUniversal.features || []] } : orangeUniversal;
  return {
    schools,
    sbd,
    bgBroward,
    bgMiami,
    counties,
    acs: { ...acsBroward, ...acsMiami, ...acsOrange || {} },
    acsBroward,
    acsMiami,
    acsOrange,
    campusRollup,
    sbdRollup,
    countyRollup,
    schema,
    bgAssignment,
    bcpsBoundaries,
    stepupSchools,
    stepupSbdRollup,
    campusEnroll,
    districtEnroll,
    enrollBySchool: { ...enrollBySchool || {}, ...orangeEnroll || {} },
    charterOperators,
    charterOperatorsMdc,
    mdcSbd,
    mdcSbdRollup,
    stepupMdcSbdRollup,
    mdcBoundaries,
    mdcSchools,
    universalSchools: mergedUniversal,
    universalRings: { ...universalRings || {}, ...orangeRings || {} },
    schoolCapacity: { ...schoolCapacity || {}, ...orangeCapacity || {} },
    plpSchools: { ...plpSchools || {}, ...orangePlp || {} },
    schoolPerformance: { ...schoolPerformance || {}, ...orangePerf || {} },
    // Orange-specific layers/sources
    bgOrange,
    orangeSbd,
    orangeSbdRollup
  };
}
function perfKey(props) {
  if (!props) return null;
  const num = props.school_num;
  if (!num) return null;
  const d = props.county === "miamidade" ? "13" : props.county === "orange" ? "48" : "06";
  return `${d}-${num}`;
}
function createStore(initial) {
  let state = initial;
  const subs = /* @__PURE__ */ new Set();
  return {
    get: () => state,
    set: (patch) => {
      state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
      subs.forEach((fn) => fn(state));
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}

// utils.js
var fmt = {
  int: (v) => v == null ? "—" : Math.round(v).toLocaleString(),
  pct: (v, d = 1) => v == null ? "—" : (v * 100).toFixed(d) + "%",
  money: (v) => v == null ? "—" : "$" + Math.round(v).toLocaleString(),
  signed: (v, d = 1) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%"
};
var RAMP_ORANGE = ["#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412"];
var RAMP_BLUE = ["#f0f9ff", "#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985"];
var RAMP_GREEN = ["#f0fdf4", "#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534"];
var RAMP_RED = ["#fef2f2", "#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b"];
var RAMP_PURPLE = ["#faf5ff", "#f3e8ff", "#e9d5ff", "#d8b4fe", "#c084fc", "#a855f7", "#9333ea", "#7e22ce", "#6b21a8"];
var PROF_STOPS = [
  [0, "#b91c1c"],
  // red-700
  [35, "#f87171"],
  // red-400
  [50, "#f59e0b"],
  // amber-500
  [60, "#eab308"],
  // yellow-500
  [70, "#84cc16"],
  // lime-500
  [85, "#16a34a"],
  // green-600
  [100, "#166534"]
  // green-800
];
var PROF_NULL = "#cbd5e1";
function hex2rgb(h5) {
  return [parseInt(h5.slice(1, 3), 16), parseInt(h5.slice(3, 5), 16), parseInt(h5.slice(5, 7), 16)];
}
function rgb2hex(r) {
  return "#" + r.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function profColor(pct) {
  if (pct == null || isNaN(pct)) return PROF_NULL;
  const s = PROF_STOPS;
  if (pct <= s[0][0]) return s[0][1];
  if (pct >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 0; i < s.length - 1; i++) {
    const [a, ca] = s[i], [b, cb] = s[i + 1];
    if (pct >= a && pct <= b) {
      const t = (pct - a) / (b - a), ra = hex2rgb(ca), rb = hex2rgb(cb);
      return rgb2hex([0, 1, 2].map((k) => ra[k] + t * (rb[k] - ra[k])));
    }
  }
  return PROF_NULL;
}
function profColorExpr(field) {
  const interp = ["interpolate", ["linear"], ["to-number", ["get", field]]];
  for (const [v, c] of PROF_STOPS) {
    interp.push(v, c);
  }
  return ["case", ["==", ["get", field], null], PROF_NULL, interp];
}
function gradeColor(g) {
  return { A: "#15803d", B: "#65a30d", C: "#ca8a04", D: "#ea580c", F: "#b91c1c" }[g] || "#9ca3af";
}
function quantileBreaks(values, n = 9) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return new Array(n).fill(0);
  const out = [];
  for (let i = 1; i < n; i++) {
    const p = i / n;
    const idx = Math.min(v.length - 1, Math.floor(p * v.length));
    out.push(v[idx]);
  }
  return out;
}
function stepExpr(field, breaks, ramp) {
  const exp = ["step", ["coalesce", ["to-number", ["get", field]], -1e9], ramp[0]];
  let prev = -Infinity;
  let ci = 1;
  for (let i = 0; i < breaks.length; i++) {
    const b = breaks[i];
    if (b == null || !Number.isFinite(b)) {
      ci++;
      continue;
    }
    if (b <= prev) {
      ci++;
      continue;
    }
    exp.push(b, ramp[Math.min(ci, ramp.length - 1)]);
    prev = b;
    ci++;
  }
  return exp;
}

// campus.js
import { h } from "https://esm.sh/preact@10.22.0";
import { useEffect } from "https://esm.sh/preact@10.22.0/hooks";
import htm from "https://esm.sh/htm@3.1.1";
var html = htm.bind(h);
var RING_MILES = { "5min": 1.83, "10min": 3.67, "15min": 5.5 };
var KIPP_NORTH = {
  id: "KIPP-MIAMI-NORTH",
  name: "KIPP Miami North",
  coords: [-80.2468097, 25.8672524]
};
function circleRing(lng, lat, miles, n = 64) {
  const R = 3958.8, d = miles / R;
  const lat1 = lat * Math.PI / 180, lng1 = lng * Math.PI / 180;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const brng = i / n * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lng2 = lng1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
    pts.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  return pts;
}
function makeMarkerEl(color, size = 18, border = 2.5) {
  const el = document.createElement("div");
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};
    border:${border}px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:pointer;`;
  return el;
}
async function ensureSchoolDotLayers(map2, data) {
  if (!data?.universalSchools) return;
  if (map2.getSource("all-schools-src")) return;
  const feats = data.universalSchools.features.filter((f) => {
    const p = f.properties;
    return p.status !== "closed" && p.role !== "incubation";
  });
  map2.addSource("all-schools-src", {
    type: "geojson",
    data: { type: "FeatureCollection", features: feats }
  });
  const radiusExpr = [
    "interpolate",
    ["linear"],
    ["to-number", ["coalesce", ["get", "enrollment_2526"], 0]],
    0,
    3,
    200,
    5,
    500,
    7.5,
    1e3,
    10.5,
    2e3,
    14,
    3e3,
    17
  ];
  map2.addLayer({
    id: "school-dots-public",
    type: "circle",
    source: "all-schools-src",
    filter: ["==", ["get", "role"], "district"],
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": "#2563eb",
      // blue-600 (saturated)
      "circle-opacity": 0.82,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff"
    }
  });
  map2.addLayer({
    id: "school-dots-charter",
    type: "circle",
    source: "all-schools-src",
    filter: ["==", ["get", "role"], "charter"],
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": "#f59e0b",
      // amber-500 (distinct from KIPP orange-600)
      "circle-opacity": 0.9,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#78350f"
      // amber-900 ring for visual punch
    }
  });
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  for (const layerId of ["school-dots-public", "school-dots-charter"]) {
    map2.on("mousemove", layerId, (e) => {
      const vis = map2.getLayoutProperty(layerId, "visibility");
      if (!vis || vis === "none") return;
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const enrollNum = parseFloat(p.enrollment_2526);
      const enrollStr = !isNaN(enrollNum) && enrollNum > 0 ? `${Math.round(enrollNum).toLocaleString()} students (2025-26)` : "";
      const countyStr = p.county === "broward" ? "Broward" : "Miami-Dade";
      const typeStr = p.role === "charter" ? "Charter" : "Public";
      popup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;line-height:1.4">
          <strong>${p.name}</strong><br>
          <span style="color:#6b7280">${typeStr} · ${p.city || ""} · ${countyStr}</span>
          ${enrollStr ? `<br><span style="color:#374151">${enrollStr}</span>` : ""}
        </div>`).addTo(map2);
      map2.getCanvas().style.cursor = "pointer";
    });
    map2.on("mouseleave", layerId, () => {
      popup.remove();
      map2.getCanvas().style.cursor = "";
    });
    map2.on("click", layerId, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
    });
  }
}
async function ensureUnderutilizedLayer(map2, data) {
  if (!data?.universalSchools || !data?.schoolCapacity) return;
  if (map2.getSource("underutilized-src")) return;
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
    if (!utilOk && !surpOk) continue;
    const sohCriterion = utilOk && surpOk ? "both" : utilOk ? "utilization" : "surplus";
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
        soh_criterion: sohCriterion
      }
    });
  }
  console.log(`[SOH] ${feats.length} schools eligible (util<=75 OR surplus>=400)`);
  map2.addSource("underutilized-src", {
    type: "geojson",
    data: { type: "FeatureCollection", features: feats }
  });
  const radiusExpr = [
    "interpolate",
    ["linear"],
    ["to-number", ["coalesce", ["get", "available_surplus"], 0]],
    0,
    4,
    200,
    5.5,
    400,
    7,
    800,
    10,
    1500,
    14,
    2500,
    19,
    4e3,
    25
  ];
  const colorExpr = [
    "case",
    [">=", ["to-number", ["get", "utilization_pct"]], 76],
    "#dc2626",
    // red-600
    [">=", ["to-number", ["get", "utilization_pct"]], 50],
    "#eab308",
    // yellow-500
    "#16a34a"
    // green-600
  ];
  map2.addLayer({
    id: "school-dots-underutilized",
    type: "circle",
    source: "underutilized-src",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": colorExpr,
      "circle-opacity": 0.75,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff"
    }
  });
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map2.on("mousemove", "school-dots-underutilized", (e) => {
    const vis = map2.getLayoutProperty("school-dots-underutilized", "visibility");
    if (!vis || vis === "none") return;
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties;
    const util = parseFloat(p.utilization_pct);
    const surplus = parseFloat(p.available_surplus);
    const capVal = parseFloat(p.school_capacity);
    const cofte = parseFloat(p.cofte);
    const crit = p.soh_criterion;
    const critLabel = crit === "both" ? "Both criteria" : crit === "utilization" ? "Utilization ≤ 75%" : "Surplus ≥ 400 seats";
    popup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;line-height:1.4;min-width:220px">
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
      </div>`).addTo(map2);
    map2.getCanvas().style.cursor = "pointer";
  });
  map2.on("mouseleave", "school-dots-underutilized", () => {
    popup.remove();
    map2.getCanvas().style.cursor = "";
  });
  map2.on("click", "school-dots-underutilized", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
  });
}
async function ensurePlpLayer(map2, data) {
  if (!data?.universalSchools || !data?.plpSchools) return;
  if (map2.getSource("plp-src")) return;
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
        plp_charter: !!rec.charter,
        plp_title1: !!rec.title1,
        plp_econ_pct: rec.econ_disadv_pct
      }
    });
  }
  console.log(`[PLP] ${feats.length} schools on FL DOE 2024-25 PLP list`);
  map2.addSource("plp-src", {
    type: "geojson",
    data: { type: "FeatureCollection", features: feats }
  });
  const radiusExpr = [
    "interpolate",
    ["linear"],
    ["to-number", ["coalesce", ["get", "enrollment_2526"], 0]],
    0,
    5,
    200,
    6.5,
    500,
    8.5,
    1e3,
    11,
    2e3,
    14,
    3e3,
    17
  ];
  map2.addLayer({
    id: "school-dots-plp",
    type: "circle",
    source: "plp-src",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": radiusExpr,
      "circle-color": "#fee2e2",
      // red-100 pale fill
      "circle-opacity": 0.85,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#b91c1c"
      // red-700
    }
  });
  map2.addSource("plp-radius", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  map2.addLayer({
    id: "plp-radius-fill",
    type: "fill",
    source: "plp-radius",
    layout: { visibility: "none" },
    paint: { "fill-color": "#dc2626", "fill-opacity": 0.06 }
  });
  map2.addLayer({
    id: "plp-radius-line",
    type: "line",
    source: "plp-radius",
    layout: { visibility: "none" },
    paint: { "line-color": "#b91c1c", "line-width": 1.8, "line-dasharray": [3, 2] }
  });
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map2.on("mousemove", "school-dots-plp", (e) => {
    const vis = map2.getLayoutProperty("school-dots-plp", "visibility");
    if (!vis || vis === "none") return;
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties;
    const enrollNum = parseFloat(p.enrollment_2526);
    const enrollStr = !isNaN(enrollNum) && enrollNum > 0 ? `${Math.round(enrollNum).toLocaleString()} students (2025-26)` : "";
    const countyStr = p.county === "broward" ? "Broward" : "Miami-Dade";
    popup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;line-height:1.4;min-width:220px">
        <strong>${p.name}</strong><br>
        <span style="color:#6b7280">${p.school_type || "District"} · ${countyStr}</span>
        <div style="margin-top:4px;padding:4px 6px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px">
          <div style="font-weight:600;color:#991b1b;font-size:11px">⚠ Persistently Low-Performing</div>
          <div style="color:#b91c1c;font-size:10px">FL DOE 2024-25 list · Grades: '23 ${p.plp_grade_2023 || "—"} · '24 ${p.plp_grade_2024 || "—"} · '25 ${p.plp_grade_2025 || "—"}</div>
        </div>
        ${enrollStr ? `<div style="margin-top:4px;color:#374151">${enrollStr}</div>` : ""}
      </div>`).addTo(map2);
    map2.getCanvas().style.cursor = "pointer";
  });
  map2.on("mouseleave", "school-dots-plp", () => {
    popup.remove();
    map2.getCanvas().style.cursor = "";
  });
  map2.on("click", "school-dots-plp", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
  });
}
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
      data[idx * 4] = 255;
      data[idx * 4 + 1] = 255;
      data[idx * 4 + 2] = 255;
      data[idx * 4 + 3] = a;
    }
  }
  return { width: size, height: size, data };
}
function ensurePerfIcons(map2) {
  const S = 48;
  if (!map2.hasImage("perf-circ")) {
    map2.addImage("perf-circ", makeShapeSdf(S, (cx, s) => {
      cx.beginPath();
      cx.arc(s / 2, s / 2, s * 0.4, 0, 2 * Math.PI);
      cx.fill();
    }), { sdf: true });
  }
  if (!map2.hasImage("perf-tri")) {
    map2.addImage("perf-tri", makeShapeSdf(S, (cx, s) => {
      const m = s * 0.12, h5 = s - 2 * m;
      cx.beginPath();
      cx.moveTo(s / 2, m);
      cx.lineTo(s - m, m + h5);
      cx.lineTo(m, m + h5);
      cx.closePath();
      cx.fill();
    }), { sdf: true });
  }
}
async function ensurePerformanceLayer(map2, data) {
  if (!data?.universalSchools || !data?.schoolPerformance) return;
  if (map2.getSource("perf-src")) return;
  ensurePerfIcons(map2);
  const perf = data.schoolPerformance;
  const feats = [];
  for (const f of data.universalSchools.features) {
    const p = f.properties;
    if (p.status === "closed" || p.role === "incubation") continue;
    const rec = perf[perfKey(p)];
    if (!rec) continue;
    const enroll = p.enrollment_2526 && +p.enrollment_2526 > 0 ? +p.enrollment_2526 : rec.enrollment || 0;
    feats.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: p.id,
        name: p.name,
        role: p.role,
        county: p.county,
        enrollment: enroll,
        ela_math: rec.ela_math,
        ela: rec.ela,
        math: rec.math,
        grade: rec.grade_2025 || ""
      }
    });
  }
  console.log(`[PERF] ${feats.length} schools with performance data`);
  map2.addSource("perf-src", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
  const sizeExpr = [
    "interpolate",
    ["linear"],
    ["to-number", ["coalesce", ["get", "enrollment"], 0]],
    0,
    0.17,
    200,
    0.26,
    500,
    0.36,
    1e3,
    0.5,
    2e3,
    0.66,
    3500,
    0.86
  ];
  map2.addLayer({
    id: "school-dots-perf",
    type: "symbol",
    source: "perf-src",
    layout: {
      visibility: "none",
      "icon-image": ["match", ["get", "role"], "charter", "perf-tri", "perf-circ"],
      "icon-size": sizeExpr,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true
    },
    paint: {
      "icon-color": profColorExpr("ela_math"),
      "icon-opacity": 0.95,
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1.1
    }
  });
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  map2.on("mousemove", "school-dots-perf", (e) => {
    const vis = map2.getLayoutProperty("school-dots-perf", "visibility");
    if (!vis || vis === "none") return;
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties;
    const pf = (v) => v == null || v === "" || isNaN(+v) ? "—" : `${Math.round(+v)}%`;
    const enrollNum = parseFloat(p.enrollment);
    const enrollStr = !isNaN(enrollNum) && enrollNum > 0 ? `${Math.round(enrollNum).toLocaleString()} students` : "";
    const countyStr = p.county === "broward" ? "Broward" : "Miami-Dade";
    const typeStr = p.role === "charter" ? "Charter" : "District";
    const gradeBadge = p.grade ? `<span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:3px;color:#fff;font-weight:700;font-size:10px;background:${gradeColor(p.grade)}">${p.grade}</span>` : "";
    popup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px;line-height:1.45;min-width:210px">
        <div style="display:flex;align-items:center;gap:6px"><strong>${p.name}</strong> ${gradeBadge}</div>
        <span style="color:#6b7280">${typeStr} · ${countyStr}</span>
        <div style="margin-top:4px;display:grid;grid-template-columns:auto auto;gap:1px 10px">
          <span style="color:#374151">ELA: <b>${pf(p.ela)}</b></span>
          <span style="color:#374151">Math: <b>${pf(p.math)}</b></span>
          <span style="color:#374151">ELA+Math: <b>${pf(p.ela_math)}</b></span>
        </div>
        ${enrollStr ? `<div style="margin-top:3px;color:#6b7280">${enrollStr}</div>` : ""}
      </div>`).addTo(map2);
    map2.getCanvas().style.cursor = "pointer";
  });
  map2.on("mouseleave", "school-dots-perf", () => {
    popup.remove();
    map2.getCanvas().style.cursor = "";
  });
  map2.on("click", "school-dots-perf", (e) => {
    const f = e.features?.[0];
    if (!f) return;
    window.__store?.set({ focusCampus: f.properties.id, schoolSearch: "" });
  });
}
async function renderSchoolLayers(state) {
  const map2 = await getMapIdle();
  const { data, ring, focusCampus } = state;
  if (!data) return;
  await ensureSchoolDotLayers(map2, data);
  await ensureUnderutilizedLayer(map2, data);
  await ensurePlpLayer(map2, data);
  await ensurePerformanceLayer(map2, data);
  (window.__schoolMarkers || []).forEach((m) => m.remove());
  window.__schoolMarkers = [];
  const kippEl = makeMarkerEl("#ea580c");
  kippEl.title = KIPP_NORTH.name;
  kippEl.addEventListener("click", () => window.__store?.set({ focusCampus: KIPP_NORTH.id }));
  const kippM = new maplibregl.Marker({ element: kippEl }).setLngLat(KIPP_NORTH.coords).setPopup(new maplibregl.Popup({ offset: 14 }).setText(KIPP_NORTH.name)).addTo(map2);
  window.__schoolMarkers.push(kippM);
  ["campus-rings-fill", "campus-rings-line"].forEach((id) => {
    if (map2.getLayer(id)) map2.removeLayer(id);
  });
  if (map2.getSource("campus-rings")) map2.removeSource("campus-rings");
  if (focusCampus) {
    let lng, lat, schoolName;
    if (focusCampus === KIPP_NORTH.id) {
      [lng, lat] = KIPP_NORTH.coords;
      schoolName = KIPP_NORTH.name;
    } else if (data.universalSchools) {
      const f = data.universalSchools.features.find((s) => s.properties.id === focusCampus);
      if (f) {
        [lng, lat] = f.geometry.coordinates;
        schoolName = f.properties.name;
      }
    }
    if (lng != null) {
      const isPlp = data.plpSchools && data.plpSchools[focusCampus];
      if (map2.getSource("plp-radius")) {
        map2.getSource("plp-radius").setData(isPlp ? {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [circleRing(lng, lat, 5)] }
          }]
        } : { type: "FeatureCollection", features: [] });
      }
      const ringFC = {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [circleRing(lng, lat, RING_MILES[ring])] }
        }]
      };
      map2.addSource("campus-rings", { type: "geojson", data: ringFC });
      map2.addLayer({
        id: "campus-rings-fill",
        type: "fill",
        source: "campus-rings",
        paint: { "fill-color": "#f97316", "fill-opacity": 0.09 }
      });
      map2.addLayer({
        id: "campus-rings-line",
        type: "line",
        source: "campus-rings",
        paint: { "line-color": "#c2410c", "line-width": 1.5, "line-dasharray": [2, 1] }
      });
      if (focusCampus !== KIPP_NORTH.id) {
        const el = makeMarkerEl("#ef4444", 22, 3);
        el.title = schoolName || "";
        const m = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).setPopup(new maplibregl.Popup({ offset: 18 }).setText(schoolName || "")).addTo(map2);
        window.__schoolMarkers.push(m);
      }
      map2.flyTo({ center: [lng, lat], zoom: 12, duration: 700 });
    }
  }
  for (const id of [
    "school-dots-underutilized",
    "school-dots-public",
    "school-dots-charter",
    "school-dots-perf",
    "school-dots-plp",
    "plp-radius-fill",
    "plp-radius-line",
    "campus-rings-fill",
    "campus-rings-line"
  ]) {
    if (map2.getLayer(id)) map2.moveLayer(id);
  }
}
function SchoolPanel({ state, store: store2 }) {
  useEffect(
    () => {
      renderSchoolLayers(state);
    },
    [
      state.data,
      state.ring,
      state.focusCampus,
      state.county,
      state.showCharters,
      state.showPublicSchools,
      state.showUnderutilized,
      state.showPlp,
      state.showPlpRadius
    ]
  );
  const { data, focusCampus } = state;
  if (!data) return null;
  if (focusCampus) {
    return html`<${SchoolDetail} schoolId=${focusCampus} data=${data} store=${store2} state=${state} />`;
  }
  return html`
    <div class="border-b border-ink-100">
      <${UniversalSchoolPicker} data=${data} state=${state} store=${store2} />
      <div class="px-4 pb-3 flex items-center gap-2 flex-wrap">
        <span class="text-xs text-ink-500">Drive-time ring:</span>
        ${["5min", "10min", "15min"].map((r) => html`
          <button onClick=${() => store2.set({ ring: r })}
            class="px-2.5 py-1 text-xs rounded-md ${state.ring === r ? "bg-kipp-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-300"}"
          >${r.replace("min", " min")}</button>
        `)}
      </div>
    </div>
  `;
}
function UniversalSchoolPicker({ data, state, store: store2 }) {
  const allSchools = data.universalSchools?.features || [];
  const activeCount = allSchools.filter((f) => f.properties.status !== "closed").length;
  const q = (state.schoolSearch || "").trim().toLowerCase();
  const matches = !q ? [] : allSchools.filter((s) => {
    const p = s.properties;
    return `${p.name} ${p.city || ""} ${p.school_num || ""}`.toLowerCase().includes(q);
  }).slice(0, 12);
  return html`
    <div class="px-4 pt-3 pb-2">
      <div class="text-[11px] text-ink-500 mb-1.5">
        Search ${activeCount.toLocaleString()} public + charter schools — Broward · Miami-Dade · Orange
      </div>
      <input
        type="search"
        placeholder="School name or city…"
        value=${state.schoolSearch || ""}
        onInput=${(e) => store2.set({ schoolSearch: e.target.value })}
        class="w-full px-2.5 py-1.5 text-sm border border-ink-200 rounded focus:outline-none focus:ring-2 focus:ring-kipp-500"
      />
      ${matches.length ? html`
        <div class="mt-1 border border-ink-100 rounded-md max-h-[220px] overflow-y-auto scrollbar-thin bg-white shadow-sm">
          ${matches.map((s) => {
    const p = s.properties;
    const isClosed = p.status === "closed";
    const isPlp = data.plpSchools && data.plpSchools[p.id];
    const dot = isClosed ? "#d1d5db" : p.role === "charter" ? "#1d4ed8" : p.role === "incubation" ? "#ea580c" : "#64748b";
    return html`
              <div onClick=${() => store2.set({ focusCampus: p.id, schoolSearch: "" })}
                   class="px-3 py-1.5 cursor-pointer hover:bg-kipp-50 border-b border-ink-100 last:border-0 text-xs flex items-center gap-2 ${isClosed ? "opacity-50" : ""}">
                <span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0;display:inline-block"></span>
                <span class="flex-1 truncate">${p.name}</span>
                ${isPlp ? html`<span class="pill bg-red-50 text-red-700 border border-red-200 flex-shrink-0 text-[10px]">PLP</span>` : null}
                ${isClosed ? html`<span class="pill bg-red-50 text-red-600 flex-shrink-0 text-[10px]">closed</span>` : null}
                <span class="text-ink-400 flex-shrink-0">${p.city || ""}</span>
                <span class="pill bg-ink-100 text-ink-600 flex-shrink-0">${p.county === "broward" ? "BRW" : "MDC"}</span>
                ${p.enrollment_2526 && !isClosed ? html`<span class="text-ink-400 font-mono flex-shrink-0">${fmt.int(p.enrollment_2526)}</span>` : null}
              </div>
            `;
  })}
        </div>
      ` : q ? html`<div class="mt-1 text-xs text-ink-400 px-1">No matches.</div>` : null}
    </div>
  `;
}
function SchoolDetail({ schoolId, data, store: store2, state }) {
  const sch = schoolId === KIPP_NORTH.id ? {
    properties: {
      id: KIPP_NORTH.id,
      name: KIPP_NORTH.name,
      county: "miamidade",
      school_type: "Incubation Site",
      address: "3000 NW 110th Street",
      city: "Miami"
    },
    geometry: { coordinates: KIPP_NORTH.coords }
  } : (data.universalSchools?.features || []).find((f) => f.properties.id === schoolId);
  if (!sch) return html`
    <div class="p-4 text-xs text-ink-500">
      School not found. <button onClick=${() => store2.set({ focusCampus: null })} class="text-kipp-600 underline">← Back</button>
    </div>`;
  const p = sch.properties;
  const rings = data.universalRings?.[schoolId]?.rings;
  const cap = data.schoolCapacity?.[schoolId];
  const plp = data.plpSchools?.[schoolId];
  const perf = data.schoolPerformance?.[perfKey(p)];
  const enrollKey = p.enroll_key || (p.school_num ? `${p.county === "miamidade" ? "13" : p.county === "orange" ? "48" : "06"}-${p.school_num}` : null);
  const enroll = enrollKey && data.enrollBySchool ? data.enrollBySchool[enrollKey] : null;
  const enroll5yr = enroll ? (() => {
    const yrs = ["2122", "2223", "2324", "2425", "2526"];
    const totals = yrs.map((y) => enroll.years?.[y]?.total ?? null);
    const first = totals.find((v) => v != null), last = [...totals].reverse().find((v) => v != null);
    return {
      years: enroll.years || {},
      change_5yr_n: first != null && last != null ? last - first : null,
      change_5yr_pct: first ? (last - first) / first : null
    };
  })() : null;
  const ring = state.ring || "5min";
  return html`
    <div class="p-4 space-y-3 border-b border-ink-100">
      <button onClick=${() => store2.set({ focusCampus: null })}
              class="text-xs text-kipp-600 hover:underline">← Back to search</button>
      <div>
        <div class="text-[11px] uppercase tracking-wide text-ink-500">
          ${p.county === "broward" ? "Broward" : "Miami-Dade"} · ${p.school_type || p.role || ""}
        </div>
        <h2 class="text-base font-semibold text-ink-900 leading-tight">${p.name}</h2>
        <div class="text-xs text-ink-500">${[p.address, p.city].filter(Boolean).join(", ")}
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
        <span class="text-xs text-ink-500">Ring:</span>
        ${["5min", "10min", "15min"].map((r) => html`
          <button onClick=${() => store2.set({ ring: r })}
            class="px-2 py-0.5 text-xs rounded ${ring === r ? "bg-kipp-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-300"}"
          >${r.replace("min", " min")}</button>
        `)}
      </div>

      ${perf ? html`<${PerformanceBlock} perf=${perf} />` : null}

      ${enroll5yr ? html`<${EnrollmentChart} enroll=${enroll5yr} />` : null}

      ${cap ? (() => {
    const util = cap.utilization_pct;
    const surplus = cap.available_surplus;
    const utilOk = util != null && util <= 75;
    const surpOk = surplus != null && surplus >= 400;
    const sohEligible = utilOk || surpOk;
    const crit = sohEligible ? utilOk && surpOk ? "Both criteria met" : utilOk ? "Utilization ≤ 75%" : "Surplus ≥ 400 seats" : null;
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
      `;
  })() : null}

      ${rings ? html`
        <table class="data">
          <thead><tr><th>Demographics (ACS)</th><th class="num">5 Min</th><th class="num">10 Min</th><th class="num">15 Min</th></tr></thead>
          <tbody>
            ${[
    ["Population (2025)", "pop_total", fmt.int],
    ["% HHI Below $50k", "pct_hhi_u50", fmt.pct],
    ["% Homes on SNAP", "pct_snap", fmt.pct],
    ["K-4 Grade Pop", "pop_k_4_est", fmt.int],
    ["5-8 Grade Pop", "pop_5_8_est", fmt.int],
    ["9-12 Grade Pop", "pop_9_12_est", fmt.int],
    ["Black Pop % K-8", "pct_black", fmt.pct],
    ["Hispanic Pop % K-8", "pct_hispanic", fmt.pct],
    ["Median HH Income", "hh_median_income_approx", fmt.money]
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
        Drive-time rings: great-circle approx at 22 mph. ACS 5-Yr 2023.${enroll5yr ? " Enrollment: FL DOE Survey 2." : ""}
      </div>
    </div>
  `;
}
function PerformanceBlock({ perf }) {
  const pf = (v) => v == null || isNaN(+v) ? "—" : `${Math.round(+v)}%`;
  const pf1 = (v) => v == null || isNaN(+v) ? "—" : `${(+v).toFixed(1)}%`;
  const SUBJECTS = [
    ["ELA", perf.ela],
    ["Math", perf.math],
    ["Science", perf.science],
    ["Soc. Studies", perf.social_studies]
  ];
  const grades = [["'23", perf.grade_2023], ["'24", perf.grade_2024], ["'25", perf.grade_2025]];
  const rp = perf.race_pct || {};
  const RACE = [
    ["Black", rp.black, "#7e22ce"],
    ["Hispanic", rp.hispanic, "#2563eb"],
    ["White", rp.white, "#9ca3af"],
    ["Asian", rp.asian, "#0891b2"],
    ["Other / 2+", (rp.pacific || 0) + (rp.amind || 0) + (rp.two_plus || 0), "#f59e0b"]
  ].filter((r) => r[1] != null && r[1] > 0);
  const lowTested = perf.pct_tested != null && +perf.pct_tested < 95;
  return html`
    <div class="bg-ink-50 rounded-md p-2.5 space-y-2.5">
      <div class="flex items-baseline justify-between">
        <div class="text-[11px] font-semibold text-ink-700">Performance &amp; Demographics</div>
        <span class="text-[10px] text-ink-500">FL DOE 2024-25</span>
      </div>

      <!-- Letter grade + trend -->
      <div class="flex items-center gap-2.5">
        <div style="width:34px;height:34px;border-radius:6px;background:${gradeColor(perf.grade_2025)};
                    color:#fff;font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${perf.grade_2025 || "—"}
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
      </div>

      <!-- Proficiency by subject (% Level 3+) -->
      <div>
        <div class="text-[10px] text-ink-500 mb-1">Proficiency — % scoring Level 3+</div>
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
        <div><div class="text-[10px] text-ink-500">Econ. Disadv.</div><div class="text-sm font-semibold text-ink-900">${pf1(perf.ed_pct)}</div></div>
        <div><div class="text-[10px] text-ink-500">ELL</div><div class="text-sm font-semibold text-ink-900">${pf1(perf.ell_pct)}</div></div>
        <div title="Per-school ESE not published by FL DOE in a downloadable file (Know Your Schools portal only).">
          <div class="text-[10px] text-ink-500">ESE / SpEd</div>
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
        Proficiency &amp; grades: FL DOE School Grades 2024-25. Race/ELL: FL DOE Membership 2025-26 Survey 2.
        ESE not available per-school from FL DOE downloads.
      </div>
    </div>
  `;
}
function EnrollmentChart({ enroll }) {
  const YEARS = ["2122", "2223", "2324", "2425", "2526"];
  const LABELS = ["'21-'22", "'22-'23", "'23-'24", "'24-'25", "'25-'26"];
  const totals = YEARS.map((y) => enroll.years?.[y]?.total ?? null);
  const valid = totals.filter((v) => v != null);
  if (!valid.length) return null;
  const mx = Math.max(...valid), mn = Math.min(...valid);
  const range = mx - mn || 1;
  const chg = enroll.change_5yr_n;
  const chgPct = enroll.change_5yr_pct;
  const chgCls = chg > 0 ? "text-green-700" : chg < 0 ? "text-red-700" : "text-ink-500";
  return html`
    <div class="bg-ink-50 rounded-md p-2.5">
      <div class="flex items-baseline justify-between mb-1.5">
        <div class="text-[11px] font-medium text-ink-700">Historical Enrollment (FL DOE Survey 2)</div>
        ${chg != null ? html`
          <div class="text-[11px] ${chgCls}">5-yr: ${chg >= 0 ? "+" : ""}${fmt.int(chg)} (${chgPct != null ? (chgPct * 100).toFixed(1) : "?"}%)</div>
        ` : null}
      </div>
      <div style="position:relative;height:60px;display:flex;align-items:flex-end;gap:4px">
        ${totals.map((v, i) => {
    if (v == null) return html`<div style="flex:1"></div>`;
    const h5 = 10 + (v - mn) / range * 46;
    return html`
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
              <div style="font-size:9px;color:#6b7280;line-height:1">${fmt.int(v)}</div>
              <div style="width:100%;height:${h5}px;background:#f97316;border-radius:2px 2px 0 0"></div>
            </div>`;
  })}
      </div>
      <div style="display:flex;gap:4px;margin-top:3px">
        ${LABELS.map((l) => html`<div style="flex:1;font-size:9px;text-align:center;color:#9ca3af">${l}</div>`)}
      </div>
    </div>
  `;
}

// sbd.js
import { h as h2 } from "https://esm.sh/preact@10.22.0";
import { useEffect as useEffect2 } from "https://esm.sh/preact@10.22.0/hooks";
import htm2 from "https://esm.sh/htm@3.1.1";

// suitability.js
var DEFAULT_WEIGHTS = {
  pop_total: 5,
  pop_growth_5yr: 5,
  pct_hhi_u50: 10,
  pct_snap: 10,
  pop_k_4_est: 20,
  pop_5_8_est: 20,
  k_4_growth_5yr: 5,
  "5_8_growth_5yr": 5,
  pct_black: 12,
  pct_hispanic: 8
};
var WEIGHT_LABELS = {
  pop_total: "Population (2025)",
  pop_growth_5yr: "5-Year Growth (2025-2030)",
  pct_hhi_u50: "% HHI Below $50k",
  pct_snap: "% Homes on SNAPS",
  pop_k_4_est: "K-4th Grade Population",
  pop_5_8_est: "5-8th Grade Population",
  k_4_growth_5yr: "K-4th Growth",
  "5_8_growth_5yr": "5-8th Growth",
  pct_black: "Black Population (%) K-8",
  pct_hispanic: "Hispanic Population (%) K-8"
};
var BG_ALIAS = {
  pop_growth_5yr: "pop_total_growth_5yr",
  k_4_growth_5yr: "pop_k_4_est_growth_5yr",
  "5_8_growth_5yr": "pop_5_8_est_growth_5yr"
};
function val(rec, key) {
  if (rec[key] != null) return rec[key];
  const alt = BG_ALIAS[key];
  if (alt && rec[alt] != null) return rec[alt];
  return null;
}
function score(rec, cohortMax, weights = DEFAULT_WEIGHTS, cohortMin = {}) {
  let total = 0;
  const parts = {};
  for (const k of Object.keys(weights)) {
    const maxW = weights[k];
    if (!maxW) {
      parts[k] = 0;
      continue;
    }
    const mx = cohortMax[k] ?? 0;
    const mn = cohortMin[k] ?? 0;
    const v = val(rec, k) ?? 0;
    if (mx <= mn) {
      parts[k] = 0;
      continue;
    }
    const share = Math.max(0, Math.min(1, (v - mn) / (mx - mn)));
    const pts = share * maxW;
    parts[k] = pts;
    total += pts;
  }
  return { total, parts };
}
function rankCohort(cohort, weights = DEFAULT_WEIGHTS) {
  const maxes = {}, mins = {};
  for (const k of Object.keys(weights)) {
    let mn = Infinity, mx = -Infinity;
    for (const [, rec] of cohort) {
      const v = val(rec, k);
      if (v != null) {
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
    }
    maxes[k] = mx === -Infinity ? 0 : mx;
    mins[k] = mn === Infinity ? 0 : mn;
  }
  const scored = cohort.map(([id, rec]) => {
    const s = score(rec, maxes, weights, mins);
    return { id, rec, score: s.total, parts: s.parts };
  });
  const avg = scored.reduce((a, x) => a + x.score, 0) / (scored.length || 1);
  return { maxes, mins, scored, avg };
}

// sbd.js
var html2 = htm2.bind(h2);
var DISTRICT_COLORS = {
  1: "#f97316",
  2: "#0ea5e9",
  3: "#22c55e",
  4: "#a855f7",
  5: "#ef4444",
  6: "#eab308",
  7: "#14b8a6",
  8: "#ec4899",
  9: "#3b82f6"
};
function polygonCentroid(geom) {
  const pts = [];
  const walk = (c) => {
    if (typeof c[0] === "number") pts.push(c);
    else c.forEach(walk);
  };
  walk(geom.coordinates);
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}
function fitBounds(map2, feature) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    } else c.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  map2.fitBounds([[minX, minY], [maxX, maxY]], { padding: 40, duration: 700 });
}
function fillColorExpr() {
  return [
    "case",
    ["==", ["get", "district"], 1],
    DISTRICT_COLORS[1],
    ["==", ["get", "district"], 2],
    DISTRICT_COLORS[2],
    ["==", ["get", "district"], 3],
    DISTRICT_COLORS[3],
    ["==", ["get", "district"], 4],
    DISTRICT_COLORS[4],
    ["==", ["get", "district"], 5],
    DISTRICT_COLORS[5],
    ["==", ["get", "district"], 6],
    DISTRICT_COLORS[6],
    ["==", ["get", "district"], 7],
    DISTRICT_COLORS[7],
    ["==", ["get", "district"], 8],
    DISTRICT_COLORS[8],
    ["==", ["get", "district"], 9],
    DISTRICT_COLORS[9],
    "#ccc"
  ];
}
function buildSbdFC(sbdSrc, countyTag) {
  return {
    type: "FeatureCollection",
    features: sbdSrc.features.map((f) => ({
      type: "Feature",
      properties: { district: Number(f.properties.district), county: countyTag },
      geometry: JSON.parse(JSON.stringify(f.geometry))
    }))
  };
}
function ensureSbdLayer(map2, tag, sbdSrc, focusDistrict, focusCounty) {
  if (!sbdSrc) return;
  const srcId = `sbd-${tag}`;
  const fillId = `sbd-${tag}-fill`;
  const lineId = `sbd-${tag}-line`;
  [fillId, lineId].forEach((id) => {
    if (map2.getLayer(id)) map2.removeLayer(id);
  });
  if (!map2.getSource(srcId)) {
    map2.addSource(srcId, { type: "geojson", data: buildSbdFC(sbdSrc, tag) });
  }
  const isFocusCounty = focusCounty === tag;
  map2.addLayer({
    id: fillId,
    type: "fill",
    source: srcId,
    paint: {
      "fill-color": fillColorExpr(),
      "fill-opacity": [
        "case",
        ["==", ["get", "district"], (isFocusCounty ? focusDistrict : null) || -1],
        0.55,
        0.22
      ]
    }
  });
  map2.addLayer({
    id: lineId,
    type: "line",
    source: srcId,
    paint: { "line-color": "#374151", "line-width": 1.5 }
  });
  if (!map2[`__sbdClick_${tag}`]) {
    map2.on("click", fillId, (e) => {
      const d = e.features[0].properties.district;
      window.__store?.set({
        focusDistrict: Number(d),
        county: tag === "mdc" ? "miamidade" : tag === "org" ? "orange" : "broward"
      });
    });
    map2.on("mouseenter", fillId, () => map2.getCanvas().style.cursor = "pointer");
    map2.on("mouseleave", fillId, () => map2.getCanvas().style.cursor = "");
    map2[`__sbdClick_${tag}`] = true;
  }
}
async function renderSBDLayers(state) {
  const map2 = await getMapIdle();
  const { data, focusDistrict, county, showStepUp } = state;
  if (!data) return;
  (window.__stepupMarkers || []).forEach((m) => m.remove());
  window.__stepupMarkers = [];
  ensureSbdLayer(map2, "brw", data.sbd, focusDistrict, county === "broward" ? "brw" : null);
  ensureSbdLayer(map2, "mdc", data.mdcSbd, focusDistrict, county === "miamidade" ? "mdc" : null);
  ensureSbdLayer(map2, "org", data.orangeSbd, focusDistrict, county === "orange" ? "org" : null);
  (window.__sbdLabelMarkers || []).forEach((m) => m.remove());
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
      window.__sbdLabelMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map2));
    }
  }
  if (showStepUp && data.stepupSchools) {
    for (const f of data.stepupSchools.features) {
      const k8 = f.properties.enroll_k8 || 0;
      const r = Math.max(4, Math.min(24, Math.sqrt(k8) * 0.6));
      const c = f.properties.county;
      const tag = c === "miami-dade" || c === "miamidade" ? "mdc" : "brw";
      const el = document.createElement("div");
      el.dataset.stepupCounty = tag;
      el.style.cssText = `width:${r * 2}px;height:${r * 2}px;border-radius:18%;background:rgba(147,51,234,0.75);
        border:1.5px solid #581c87;pointer-events:auto;cursor:pointer;`;
      el.title = `${f.properties.name} — K-8: ${k8}`;
      const popup = new maplibregl.Popup({ offset: r + 4 }).setHTML(`<div><strong>${f.properties.name}</strong><br>
          ${f.properties.city}, FL ${f.properties.zip}<br>
          K-8: <b>${k8}</b> · Total: ${f.properties.enroll_total || 0}<br>
          Grades: ${f.properties.grade_levels || ""}</div>`);
      const m = new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).setPopup(popup).addTo(map2);
      (window.__stepupMarkers = window.__stepupMarkers || []).push(m);
    }
  }
  if (focusDistrict) {
    const sbdSrc = county === "miamidade" ? data.mdcSbd : data.sbd;
    const feat = sbdSrc?.features.find((f) => Number(f.properties.district) === focusDistrict);
    if (feat) fitBounds(map2, feat);
  }
  moveSchoolsOnTop(map2);
}
function DistrictPanel({ state, store: store2 }) {
  useEffect2(
    () => {
      renderSBDLayers(state);
    },
    [
      state.data,
      state.focusDistrict,
      state.showStepUp,
      state.county,
      state.showBrowardSBD,
      state.showMiamiDadeSBD,
      state.showOrangeSBD
    ]
  );
  const { data, focusDistrict, county } = state;
  if (!data) return null;
  const isMiami = county === "miamidade";
  const isOrange = county === "orange";
  const rollupSrc = isOrange ? data.orangeSbdRollup : isMiami ? data.mdcSbdRollup : data.sbdRollup;
  const stepupRollup = isOrange ? null : isMiami ? data.stepupMdcSbdRollup : data.stepupSbdRollup;
  const charterOps = isOrange ? null : isMiami ? data.charterOperatorsMdc : data.charterOperators;
  const districtIds = isMiami ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5, 6, 7];
  if (!rollupSrc) return null;
  const cohort = Object.entries(rollupSrc).filter(([k]) => k !== "_average");
  const ranked = rankCohort(cohort, state.weights || DEFAULT_WEIGHTS);
  const sortedDist = ranked.scored.slice().sort((a, b) => b.score - a.score);
  return html2`
    <details class="border-b border-ink-100">
      <summary class="px-4 py-2.5 text-xs font-semibold text-ink-700 bg-ink-50 cursor-pointer flex items-center justify-between select-none">
        <span>District Analysis · Charter Ops · Step Up</span>
        <span class="text-ink-400 font-normal">▸</span>
      </summary>

      <!-- County tab selector for sidebar content (map shows whatever layers are toggled) -->
      <div class="px-4 py-2 border-b border-ink-100 flex items-center gap-1">
        <span class="text-[11px] text-ink-500 mr-1">Show data for:</span>
        ${[{ id: "broward", label: "Broward" }, { id: "miamidade", label: "Miami-Dade" }, { id: "orange", label: "Orange / Orlando" }].map((c) => html2`
          <button
            onClick=${() => store2.set({ county: c.id, focusDistrict: null })}
            class="px-2 py-0.5 text-[11px] rounded ${state.county === c.id ? "bg-kipp-600 text-white" : "text-ink-700 hover:bg-ink-100"}"
          >${c.label}</button>
        `)}
      </div>

      ${focusDistrict ? html2`
        <${DistrictDetail}
          district=${focusDistrict} data=${data} store=${store2} state=${state}
          rollupSrc=${rollupSrc} stepupRollup=${stepupRollup} county=${county}
        />
      ` : html2`
        <div class="p-3 space-y-3">

          <!-- Suitability ranking -->
          <table class="data">
            <thead><tr><th>Rank</th><th>District</th><th class="num">Suitability</th></tr></thead>
            <tbody>
              ${sortedDist.map((s, i) => html2`
                <tr onClick=${() => store2.set({ focusDistrict: Number(s.id) })}
                    class="cursor-pointer hover:bg-kipp-50">
                  <td class="num text-ink-500">${i + 1}</td>
                  <td>
                    <span style="display:inline-block;width:8px;height:8px;background:${DISTRICT_COLORS[s.id]};border-radius:2px;margin-right:5px"></span>
                    District ${s.id}
                  </td>
                  <td class="num font-semibold">${fmt.pct(s.score / 100, 1)}</td>
                </tr>
              `)}
            </tbody>
          </table>

          <!-- Demographic comparison table (scrollable) -->
          <div class="overflow-x-auto text-[11px]">
            <${SBDTable} sbdRollup=${rollupSrc} districtIds=${districtIds} />
          </div>

          ${charterOps ? html2`<${CharterOperatorsPanel} data=${charterOps} />` : null}

          ${data.stepupSchools && stepupRollup ? html2`
            <div class="bg-white rounded-md border border-ink-100 overflow-hidden">
              <div class="px-3 py-2 text-xs font-medium text-ink-700 border-b border-ink-100 bg-ink-100/50 flex items-center justify-between">
                <span>Step Up Private Schools (FES/FTC)</span>
                <label class="text-[11px] text-ink-500 flex items-center gap-1 cursor-pointer font-normal">
                  <input type="checkbox" checked=${state.showStepUp}
                         onChange=${(e) => store2.set({ showStepUp: e.target.checked })} />
                  Map
                </label>
              </div>
              <table class="data">
                <thead><tr><th>District</th><th class="num">#</th><th class="num">K-8</th><th class="num">Total</th></tr></thead>
                <tbody>
                  ${districtIds.map((d) => {
    const r = stepupRollup[String(d)] || { n: 0, k8: 0, total: 0 };
    return html2`<tr>
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

          <${DistrictTakeaways} sortedDist=${sortedDist} data=${data} county=${county} />
        </div>
      `}
    </details>
  `;
}
function DistrictDetail({ district, data, store: store2, state, rollupSrc, stepupRollup, county }) {
  const src = rollupSrc || data.sbdRollup;
  const rec = src[String(district)];
  const avg = src._average || {};
  const sbdKey = county === "miamidade" ? "mdc_sbd" : "sbd";
  const stepupSchools = (data.stepupSchools?.features || []).filter((f) => f.properties[sbdKey] === district).sort((a, b) => (b.properties.enroll_total || 0) - (a.properties.enroll_total || 0));
  const rows = [
    ["Population (2025)", "pop_total", fmt.int],
    ["% HHI Below $50k", "pct_hhi_u50", fmt.pct],
    ["% Homes on SNAP", "pct_snap", fmt.pct],
    ["K-4 Grade Pop", "pop_k_4_est", fmt.int],
    ["5-8 Grade Pop", "pop_5_8_est", fmt.int],
    ["9-12 Grade Pop", "pop_9_12_est", fmt.int],
    ["Black Pop % K-8", "pct_black", fmt.pct],
    ["Hispanic Pop % K-8", "pct_hispanic", fmt.pct],
    ["Median HH Income", "hh_median_income_approx", fmt.money],
    ["% Renter HH", "pct_renter", fmt.pct]
  ];
  return html2`
    <div class="p-4 space-y-3">
      <button onClick=${() => store2.set({ focusDistrict: null })}
              class="text-xs text-kipp-600 hover:underline">← All districts</button>
      <div class="flex items-center gap-2">
        <span style="display:inline-block;width:14px;height:14px;background:${DISTRICT_COLORS[district]};border-radius:3px"></span>
        <h2 class="text-base font-semibold text-ink-900">District ${district}</h2>
        <span class="text-xs text-ink-500">${county === "miamidade" ? "Miami-Dade" : "Broward"} SBD</span>
      </div>
      <table class="data">
        <thead><tr><th>Demographic</th><th class="num">D${district}</th><th class="num">Avg</th><th class="num">+/−</th></tr></thead>
        <tbody>
          ${rows.map(([label, k, f]) => {
    const v = rec?.[k], a = avg[k];
    const delta = v != null && a != null ? v - a : null;
    return html2`<tr>
              <td>${label}</td>
              <td class="num">${f(v)}</td>
              <td class="num text-ink-500">${f(a)}</td>
              <td class="num ${delta != null ? delta > 0 ? "text-green-700" : "text-red-700" : ""}">
                ${delta == null ? "—" : k.startsWith("pct") ? fmt.signed(delta) : (delta >= 0 ? "+" : "") + fmt.int(delta)}
              </td>
            </tr>`;
  })}
        </tbody>
      </table>
      <div class="text-[11px] text-ink-500">${rec?.bg_count || 0} Census block groups.</div>

      ${stepupSchools.length ? html2`
        <div class="border border-ink-100 rounded-md overflow-hidden">
          <div class="px-3 py-2 text-xs font-medium text-ink-700 bg-ink-50 border-b border-ink-100">
            Step Up in D${district} · ${stepupSchools.length} schools
          </div>
          <div class="max-h-[260px] overflow-y-auto scrollbar-thin">
            <table class="data">
              <thead><tr><th>School</th><th>Grades</th><th class="num">K-8</th><th class="num">Tot</th></tr></thead>
              <tbody>
                ${stepupSchools.slice(0, 40).map((f) => html2`<tr>
                  <td>${f.properties.name}</td>
                  <td class="text-ink-500">${f.properties.grade_levels || ""}</td>
                  <td class="num">${fmt.int(f.properties.enroll_k8)}</td>
                  <td class="num">${fmt.int(f.properties.enroll_total)}</td>
                </tr>`)}
                ${stepupSchools.length > 40 ? html2`<tr><td colspan="4" class="text-[11px] text-ink-400 italic">…${stepupSchools.length - 40} more</td></tr>` : null}
              </tbody>
            </table>
          </div>
        </div>
      ` : null}
    </div>
  `;
}
function SBDTable({ sbdRollup, districtIds }) {
  const ids = districtIds || [1, 2, 3, 4, 5, 6, 7];
  const avg = sbdRollup._average || {};
  const rows = [
    ["Population", "pop_total", fmt.int],
    ["% HHI<$50k", "pct_hhi_u50", fmt.pct],
    ["% SNAP", "pct_snap", fmt.pct],
    ["K-4 Pop", "pop_k_4_est", fmt.int],
    ["5-8 Pop", "pop_5_8_est", fmt.int],
    ["% Black", "pct_black", fmt.pct],
    ["% Hispanic", "pct_hispanic", fmt.pct],
    ["Med. Income", "hh_median_income_approx", fmt.money]
  ];
  return html2`
    <table class="data">
      <thead>
        <tr>
          <th></th>
          ${ids.map((d) => html2`<th class="num" style="padding:2px 5px">
            <span style="display:inline-block;width:7px;height:7px;background:${DISTRICT_COLORS[d]};border-radius:2px;margin-right:2px;vertical-align:middle"></span>D${d}
          </th>`)}
          <th class="num" style="padding:2px 5px">Avg</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(([label, k, f]) => html2`
          <tr>
            <td style="padding:2px 5px;white-space:nowrap">${label}</td>
            ${ids.map((d) => {
    const r = sbdRollup[String(d)] || {};
    const v = r[k], a = avg[k];
    const cls = v != null && a != null ? v > a ? "text-green-700 bg-green-50" : "text-red-700 bg-red-50" : "";
    return html2`<td class="num ${cls}" style="padding:2px 5px">${f(v)}</td>`;
  })}
            <td class="num text-ink-500" style="padding:2px 5px">${f(avg[k])}</td>
          </tr>`)}
      </tbody>
    </table>
  `;
}
function CharterOperatorsPanel({ data }) {
  const YEARS = ["2122", "2223", "2324", "2425", "2526"];
  const ops = Object.entries(data.operators).sort((a, b) => b[1].enrollment["2526"] - a[1].enrollment["2526"]);
  return html2`
    <div class="border border-ink-100 rounded-md overflow-hidden">
      <div class="px-3 py-2 text-xs font-medium text-ink-700 bg-ink-50 border-b border-ink-100">
        Major Charter Operators
      </div>
      <div class="overflow-x-auto">
        <table class="data">
          <thead><tr>
            <th>Operator</th><th class="num">#</th>
            ${YEARS.map((y) => html2`<th class="num">${"'" + y.slice(0, 2)}</th>`)}
            <th class="num">5yr Δ</th><th class="num">Shr</th>
          </tr></thead>
          <tbody>
            ${ops.map(([op, r]) => html2`
              <tr>
                <td>${op}</td><td class="num">${r.n_schools}</td>
                ${YEARS.map((y) => html2`<td class="num">${fmt.int(r.enrollment[y])}</td>`)}
                <td class="num ${r.change_5yr_n > 0 ? "text-green-700" : r.change_5yr_n < 0 ? "text-red-700" : ""} font-semibold">
                  ${r.change_5yr_n >= 0 ? "+" : ""}${fmt.int(r.change_5yr_n)}
                </td>
                <td class="num">${fmt.pct(r.market_share["2526"])}</td>
              </tr>`)}
            <tr class="font-semibold bg-ink-100/30">
              <td>TOTAL</td><td></td>
              ${YEARS.map((y) => html2`<td class="num">${fmt.int(data.totals[y])}</td>`)}
              <td></td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function DistrictTakeaways({ sortedDist, data, county }) {
  const top = sortedDist[0], bottom = sortedDist[sortedDist.length - 1];
  return html2`
    <details class="border border-ink-100 rounded-md overflow-hidden" open>
      <summary class="px-3 py-2 text-xs font-medium text-ink-700 bg-ink-50 border-b border-ink-100 cursor-pointer">
        Takeaways
      </summary>
      <div class="p-3 space-y-1.5 text-xs leading-relaxed text-ink-700">
        <div><strong>Best suitability:</strong>
          <span class="pill ml-1" style="background:#dcfce7;color:#166534">District ${top.id}</span>
          <span class="text-ink-500">(${fmt.pct(top.score / 100)},
            ${Math.round(top.score - sortedDist[1].score)} pts ahead of D${sortedDist[1].id})</span>
        </div>
        <div><strong>Weakest:</strong>
          <span class="pill ml-1" style="background:#fee2e2;color:#991b1b">District ${bottom.id}</span>
          <span class="text-ink-500">(${fmt.pct(bottom.score / 100)})</span>
        </div>
      </div>
    </details>
  `;
}

// heatmap.js
import { h as h3 } from "https://esm.sh/preact@10.22.0";
import { useEffect as useEffect3 } from "https://esm.sh/preact@10.22.0/hooks";
import htm3 from "https://esm.sh/htm@3.1.1";
var html3 = htm3.bind(h3);
var METRICS = [
  { id: "pop_k_8_est", label: "K-8 Student Pop", ramp: RAMP_ORANGE, kind: "count" },
  { id: "pop_k_4_est", label: "K-4 Student Pop", ramp: RAMP_ORANGE, kind: "count" },
  { id: "pop_5_8_est", label: "5-8 Student Pop", ramp: RAMP_ORANGE, kind: "count" },
  { id: "pct_hhi_u50", label: "% HHI Below $50k", ramp: RAMP_RED, kind: "pct" },
  { id: "pct_snap", label: "% on SNAP", ramp: RAMP_RED, kind: "pct" },
  { id: "pct_black", label: "% Black (K-8 proxy)", ramp: RAMP_PURPLE, kind: "pct" },
  { id: "pct_hispanic", label: "% Hispanic (K-8)", ramp: RAMP_BLUE, kind: "pct" },
  { id: "pct_minority", label: "% Minority (B+H)", ramp: RAMP_GREEN, kind: "pct" },
  { id: "suitability", label: "Suitability Score", ramp: RAMP_ORANGE, kind: "pct" }
];
function joinedBGs(data) {
  const feats = [];
  for (const src of [data.bgBroward, data.bgMiami, data.bgOrange]) {
    if (!src) continue;
    for (const f of src.features) {
      const g = f.properties?.GEOID;
      const rec = data.acs[g];
      if (!rec) continue;
      const merged = { ...f.properties, ...rec };
      merged.pop_k_8_est = (rec.pop_k_4_est || 0) + (rec.pop_5_8_est || 0);
      merged.pct_minority = merged.pop_total > 0 ? ((rec.pop_black_alone_all_ages || 0) + (rec.pop_hispanic_all_ages || 0)) / merged.pop_total : null;
      feats.push({ ...f, properties: merged });
    }
  }
  return { type: "FeatureCollection", features: feats };
}
function addSuitability(fc, weights) {
  const keys = Object.keys(weights);
  const maxes = {}, mins = {};
  for (const k of keys) {
    let mn = Infinity, mx = -Infinity;
    for (const f of fc.features) {
      const v = val(f.properties, k);
      if (v != null) {
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
    }
    maxes[k] = mx === -Infinity ? 0 : mx;
    mins[k] = mn === Infinity ? 0 : mn;
  }
  for (const f of fc.features) {
    f.properties.suitability = score(f.properties, maxes, weights, mins).total;
  }
}
var BG_FC = null;
var CURRENT_LAYER = null;
var CURRENT_BREAKS = null;
async function renderHeatLayers(state) {
  const map2 = await getMapIdle();
  const { data, heatLayer, showHeatMap } = state;
  if (!data) return;
  if (!BG_FC) {
    BG_FC = joinedBGs(data);
    addSuitability(BG_FC, state.weights || DEFAULT_WEIGHTS);
  } else if (heatLayer === "suitability") {
    addSuitability(BG_FC, state.weights || DEFAULT_WEIGHTS);
    if (map2.getSource("bg")) map2.getSource("bg").setData(BG_FC);
  }
  if (!map2.getSource("bg")) {
    map2.addSource("bg", { type: "geojson", data: BG_FC });
  }
  map2.getSource("bg").setData(BG_FC);
  const cfg = METRICS.find((m) => m.id === heatLayer) || METRICS[0];
  const vals = BG_FC.features.map((f) => f.properties[cfg.id]).filter((v) => v != null);
  const breaks = quantileBreaks(vals, 9);
  CURRENT_LAYER = cfg;
  CURRENT_BREAKS = breaks;
  if (!map2.getLayer("bg-heat")) {
    map2.addLayer({
      id: "bg-heat",
      type: "fill",
      source: "bg",
      paint: { "fill-color": stepExpr(cfg.id, breaks, cfg.ramp), "fill-opacity": 0.78 }
    }, map2.getLayer("sbd-fill") ? "sbd-fill" : void 0);
    map2.addLayer({
      id: "bg-outline",
      type: "line",
      source: "bg",
      paint: { "line-color": "#ffffff", "line-width": 0.15 }
    });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map2.on("mousemove", "bg-heat", (e) => {
      if (!map2.getLayoutProperty("bg-heat", "visibility") || map2.getLayoutProperty("bg-heat", "visibility") === "none") return;
      const f = e.features[0], p = f.properties;
      const v = p[CURRENT_LAYER.id];
      const vstr = v == null ? "—" : CURRENT_LAYER.kind === "pct" ? CURRENT_LAYER.id === "suitability" ? parseFloat(v).toFixed(1) + "%" : fmt.pct(parseFloat(v)) : fmt.int(parseFloat(v));
      popup.setLngLat(e.lngLat).setHTML(`<div><strong>BG ${p.GEOID}</strong><br>${CURRENT_LAYER.label}: <b>${vstr}</b><br>
          Pop: ${fmt.int(parseFloat(p.pop_total))} · HHI&lt;$50k: ${fmt.pct(parseFloat(p.pct_hhi_u50))}</div>`).addTo(map2);
      map2.getCanvas().style.cursor = "pointer";
    });
    map2.on("mouseleave", "bg-heat", () => {
      popup.remove();
      map2.getCanvas().style.cursor = "";
    });
  } else {
    map2.setPaintProperty("bg-heat", "fill-color", stepExpr(cfg.id, breaks, cfg.ramp));
  }
  for (const id of [
    "school-dots-underutilized",
    "school-dots-public",
    "school-dots-charter",
    "school-dots-plp",
    "plp-radius-fill",
    "plp-radius-line",
    "campus-rings-fill",
    "campus-rings-line"
  ]) {
    if (map2.getLayer(id)) map2.moveLayer(id);
  }
  if (showHeatMap) updateLegendDOM(cfg, breaks);
}
function updateLegendDOM(cfg, breaks) {
  const el = document.getElementById("heatmap-legend");
  if (!el) return;
  const swatches = cfg.ramp.map((c, i) => {
    const lo = i === 0 ? "min" : formatBreak(breaks[i - 1], cfg.kind);
    const hi = i === cfg.ramp.length - 1 ? "max" : formatBreak(breaks[i], cfg.kind);
    return `<div style="display:flex;align-items:center;gap:6px;line-height:1.3">
      <span style="width:14px;height:9px;background:${c};display:inline-block;border-radius:2px;flex-shrink:0"></span>
      <span style="color:#6b7280">${lo} – ${hi}</span>
    </div>`;
  }).join("");
  el.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${cfg.label}</div>${swatches}`;
}
function formatBreak(v, kind) {
  if (v == null) return "—";
  if (kind === "pct") return (v * 100).toFixed(0) + "%";
  return Math.round(v).toLocaleString();
}
function LayersPanel({ state, store: store2 }) {
  useEffect3(() => {
    if (state.showHeatMap) renderHeatLayers(state);
  }, [state.data, state.heatLayer, state.weights, state.showHeatMap]);
  useEffect3(() => {
    if (state.showHeatMap && CURRENT_LAYER && CURRENT_BREAKS) {
      updateLegendDOM(CURRENT_LAYER, CURRENT_BREAKS);
    }
  }, [state.showHeatMap]);
  const { data } = state;
  if (!data) return null;
  const weights = state.weights || { ...DEFAULT_WEIGHTS };
  const total = Object.values(weights).reduce((a, b) => a + (b || 0), 0);
  return html3`
    <details class="border-b border-ink-100" open>
      <summary class="px-4 py-2.5 text-xs font-semibold text-ink-700 bg-ink-50 cursor-pointer flex items-center justify-between select-none">
        <span>Map Layers</span>
        <span class="text-ink-400 font-normal">▸</span>
      </summary>
      <div class="p-3 space-y-2.5">

        <!-- Heat Map -->
        <div class="space-y-1.5">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showHeatMap}
                   onChange=${(e) => store2.set({ showHeatMap: e.target.checked })} />
            <span class="text-xs font-medium text-ink-700">Demographic Heat Map</span>
          </label>
          ${state.showHeatMap ? html3`
            <div class="flex flex-wrap gap-1 pl-5">
              ${METRICS.map((m) => html3`
                <button
                  onClick=${() => store2.set({ heatLayer: m.id })}
                  class="px-2 py-0.5 text-[11px] rounded ${state.heatLayer === m.id ? "bg-kipp-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}"
                >${m.label}</button>
              `)}
            </div>
            ${state.heatLayer === "suitability" ? html3`
              <div class="pl-5 text-[11px] text-ink-500">Suitability: weighted composite (100-pt scale). Edit weights below.</div>
            ` : null}
          ` : null}
        </div>

        <!-- School Performance bubbles -->
        <div class="space-y-1">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showPerformance}
                   onChange=${(e) => store2.set({ showPerformance: e.target.checked })} />
            <span style="display:inline-flex;gap:2px;align-items:center;flex-shrink:0">
              <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="#16a34a" stroke="#fff"></circle></svg>
              <svg width="12" height="12"><polygon points="6,1 11,11 1,11" fill="#dc2626" stroke="#fff"></polygon></svg>
            </span>
            <span class="text-xs font-medium text-ink-700">School Performance</span>
          </label>
          ${state.showPerformance ? html3`
            <div class="pl-5 text-[10px] text-ink-500 leading-snug">
              Color = % scoring Level 3+ (ELA+Math), <span style="color:#b91c1c;font-weight:600">red</span> → <span style="color:#16a34a;font-weight:600">green</span>.
              Size = enrollment. <b>○</b> district · <b>▲</b> charter. Click a school for full detail.
            </div>
          ` : null}
        </div>

        <!-- Per-county District boundaries -->
        <div class="space-y-1">
          <div class="text-xs font-medium text-ink-700">School Board Districts</div>
          <label class="flex items-center gap-2 cursor-pointer pl-2">
            <input type="checkbox" checked=${state.showBrowardSBD}
                   onChange=${(e) => store2.set({ showBrowardSBD: e.target.checked })} />
            <span class="text-xs text-ink-700">Broward County (D1–D7)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer pl-2">
            <input type="checkbox" checked=${state.showMiamiDadeSBD}
                   onChange=${(e) => store2.set({ showMiamiDadeSBD: e.target.checked })} />
            <span class="text-xs text-ink-700">Miami-Dade County (D1–D9)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer pl-2">
            <input type="checkbox" checked=${state.showOrangeSBD}
                   onChange=${(e) => store2.set({ showOrangeSBD: e.target.checked })} />
            <span class="text-xs text-ink-700">Orange County · Orlando (D1–D7)</span>
          </label>
        </div>

        <!-- District/public schools — BLUE circle -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showPublicSchools}
                 onChange=${(e) => store2.set({ showPublicSchools: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:50%;background:#2563eb;border:1px solid #fff;box-shadow:0 0 0 1px #2563eb;display:inline-block;flex-shrink:0"></span>
          <span class="text-xs text-ink-700">District Schools (Size = Enrollment)</span>
        </label>

        <!-- Charter schools — AMBER circle with dark ring -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showCharters}
                 onChange=${(e) => store2.set({ showCharters: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:50%;background:#f59e0b;border:2px solid #78350f;display:inline-block;flex-shrink:0"></span>
          <span class="text-xs text-ink-700">Charter schools (size = enrollment)</span>
        </label>

        <!-- Step Up private — PURPLE rounded-square -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showStepUp}
                 onChange=${(e) => store2.set({ showStepUp: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:18%;background:#9333ea;border:1.5px solid #581c87;display:inline-block;flex-shrink:0"></span>
          <span class="text-xs text-ink-700">Step Up private schools (size = K-8 enrollment)</span>
        </label>

        <!-- School of Hope eligible facilities (FL DOE FISH capacity) -->
        <div class="space-y-1">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showUnderutilized}
                   onChange=${(e) => store2.set({ showUnderutilized: e.target.checked })} />
            <span style="display:inline-flex;gap:1px;flex-shrink:0">
              <span style="width:9px;height:9px;border-radius:50%;background:#16a34a;border:1px solid #fff"></span>
              <span style="width:9px;height:9px;border-radius:50%;background:#eab308;border:1px solid #fff"></span>
              <span style="width:9px;height:9px;border-radius:50%;background:#dc2626;border:1px solid #fff"></span>
            </span>
            <span class="text-xs text-ink-700">School of Hope eligible facilities</span>
          </label>
          ${state.showUnderutilized ? html3`
            <div class="pl-5 text-[10px] text-ink-500 leading-snug space-y-0.5">
              <div>Eligible if utilization <b>≤ 75%</b> <i>or</i> surplus <b>≥ 400</b> seats (FL statute).</div>
              <div>Size = surplus seats · Color by utilization:
                <span style="color:#16a34a;font-weight:600">green</span> 0–49% ·
                <span style="color:#b08500;font-weight:600">yellow</span> 50–75% ·
                <span style="color:#dc2626;font-weight:600">red</span> 76–100%
              </div>
              <div class="text-ink-400">Source: FL DOE FISH Level of Service 2025-26.</div>
            </div>
          ` : null}
        </div>

        <!-- Persistently Low-Performing (FL DOE 2024-25) -->
        <div class="space-y-1">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked=${state.showPlp}
                   onChange=${(e) => store2.set({ showPlp: e.target.checked })} />
            <span style="width:11px;height:11px;border-radius:50%;background:#fee2e2;border:2.5px solid #b91c1c;display:inline-block;flex-shrink:0"></span>
            <span class="text-xs text-ink-700">Persistently Low-Performing (PLP 24-25)</span>
          </label>
          ${state.showPlp ? html3`
            <div class="pl-5 text-[10px] text-ink-500 leading-snug">
              FL DOE 2024-25 list · 44 schools across Broward, Miami-Dade + Orange.
              Click any PLP school for campus analysis; a 5-mile radius will draw around it.
            </div>
          ` : null}
          <label class="flex items-center gap-2 cursor-pointer pl-5">
            <input type="checkbox" checked=${state.showPlpRadius}
                   onChange=${(e) => store2.set({ showPlpRadius: e.target.checked })} />
            <span class="text-[11px] text-ink-600">5-mile radius around focused PLP school</span>
          </label>
        </div>

        <!-- Suitability weights -->
        <details class="border border-ink-100 rounded-md overflow-hidden">
          <summary class="px-3 py-2 text-[11px] font-medium text-ink-700 bg-ink-50 cursor-pointer">
            Suitability weights · total = ${total.toFixed(0)}
          </summary>
          <div class="p-3 space-y-1">
            ${Object.keys(DEFAULT_WEIGHTS).map((k) => html3`
              <div class="flex items-center gap-2">
                <label class="text-[11px] text-ink-700 flex-1">${WEIGHT_LABELS[k]}</label>
                <input type="number" min="0" max="50" step="1"
                  value=${weights[k] ?? 0}
                  onInput=${(e) => {
    const v = parseFloat(e.target.value) || 0;
    store2.set({ weights: { ...weights, [k]: v } });
  }}
                  class="w-12 px-1.5 py-0.5 text-xs text-right border border-ink-300 rounded"
                />
              </div>
            `)}
            <button class="mt-1 text-[11px] text-kipp-600 hover:underline"
                    onClick=${() => store2.set({ weights: null })}>Reset to defaults</button>
          </div>
        </details>

      </div>
    </details>
  `;
}

// app.js
var html4 = htm4.bind(h4);
var store = createStore({
  data: null,
  county: "broward",
  // drives sidebar district list only
  ring: "5min",
  focusCampus: null,
  focusDistrict: null,
  heatLayer: "pop_k_8_est",
  weights: null,
  showHeatMap: false,
  showPerformance: false,
  // school performance bubbles (proficiency color + sector shape)
  perfMetric: "ela_math",
  // which proficiency drives the bubble color
  showBrowardSBD: true,
  // per-county SBD/boundary map layers
  showMiamiDadeSBD: true,
  showOrangeSBD: true,
  showStepUp: false,
  showCharters: false,
  showPublicSchools: false,
  showUnderutilized: false,
  showPlp: false,
  showPlpRadius: true,
  // when a PLP school is focused, draw 5-mile radius
  schoolSearch: ""
});
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
    "campus-rings-line"
  ]) {
    if (m.getLayer(id)) m.moveLayer(id);
  }
}
var map = null;
var mapReady = new Promise((resolve) => {
  window.__mapResolve = resolve;
});
function initMap() {
  map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      sources: {
        carto: {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
            "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
          ],
          tileSize: 256,
          attribution: "© OpenStreetMap © CARTO"
        }
      },
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      layers: [{ id: "carto", type: "raster", source: "carto" }]
    },
    center: [-81.7, 27.9],
    // statewide view framing all three regions (Miami-Dade → Orange)
    zoom: 6.3,
    attributionControl: true
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }));
  map.on("load", () => {
    window.__map = map;
    window.__mapResolve(map);
  });
}
function getMap() {
  return mapReady;
}
var getMapIdle = getMap;
async function syncLayerVisibility(state) {
  const m = await mapReady;
  ["bg-heat", "bg-outline"].forEach((id) => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", state.showHeatMap ? "visible" : "none");
  });
  const sbdVis = (vis) => vis ? "visible" : "none";
  ["sbd-brw-fill", "sbd-brw-line"].forEach((id) => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(state.showBrowardSBD));
  });
  ["sbd-mdc-fill", "sbd-mdc-line"].forEach((id) => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(state.showMiamiDadeSBD));
  });
  ["sbd-org-fill", "sbd-org-line"].forEach((id) => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(state.showOrangeSBD));
  });
  (window.__sbdLabelMarkers || []).forEach((lm) => {
    const el = lm.getElement();
    const tag = el.dataset.sbdCounty;
    const on = tag === "mdc" ? state.showMiamiDadeSBD : tag === "org" ? state.showOrangeSBD : state.showBrowardSBD;
    el.style.display = on ? "" : "none";
  });
  (window.__stepupMarkers || []).forEach((mk) => {
    mk.getElement().style.display = state.showStepUp ? "" : "none";
  });
  const ringVis = state.focusCampus ? "visible" : "none";
  ["campus-rings-fill", "campus-rings-line"].forEach((id) => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", ringVis);
  });
  if (m.getLayer("school-dots-charter"))
    m.setLayoutProperty("school-dots-charter", "visibility", state.showCharters ? "visible" : "none");
  if (m.getLayer("school-dots-public"))
    m.setLayoutProperty("school-dots-public", "visibility", state.showPublicSchools ? "visible" : "none");
  if (m.getLayer("school-dots-perf"))
    m.setLayoutProperty("school-dots-perf", "visibility", state.showPerformance ? "visible" : "none");
  if (m.getLayer("school-dots-underutilized"))
    m.setLayoutProperty("school-dots-underutilized", "visibility", state.showUnderutilized ? "visible" : "none");
  if (m.getLayer("school-dots-plp"))
    m.setLayoutProperty("school-dots-plp", "visibility", state.showPlp ? "visible" : "none");
  const plpRadiusVis = state.showPlpRadius && state.focusCampus && state.data?.plpSchools?.[state.focusCampus] ? "visible" : "none";
  ["plp-radius-fill", "plp-radius-line"].forEach((id) => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", plpRadiusVis);
  });
  moveSchoolsOnTop(m);
}
function App() {
  const [state, setState] = useState(store.get());
  const isFirstCounty = useRef(true);
  useEffect4(() => store.subscribe(setState), []);
  useEffect4(() => {
    loadAll().then((d) => store.set({ data: d }));
  }, []);
  useEffect4(() => {
    if (!map && document.getElementById("map")) initMap();
  });
  useEffect4(() => {
    if (state.data) syncLayerVisibility(state);
  }, [
    state.data,
    state.showHeatMap,
    state.showBrowardSBD,
    state.showMiamiDadeSBD,
    state.focusCampus,
    state.showCharters,
    state.showPublicSchools,
    state.showUnderutilized,
    state.showPlp,
    state.showPlpRadius,
    state.showStepUp,
    state.showPerformance,
    state.showOrangeSBD
  ]);
  useEffect4(() => {
    if (!state.data) return;
    if (isFirstCounty.current) {
      isFirstCounty.current = false;
      return;
    }
    const center = state.county === "miamidade" ? [-80.35, 25.75] : state.county === "orange" ? [-81.34, 28.51] : [-80.22, 26.15];
    mapReady.then((m) => m.flyTo({ center, zoom: 9.2, duration: 700 }));
  }, [state.county]);
  if (!state.data) {
    return html4`<div class="h-full flex items-center justify-center text-ink-500">
      <div class="text-center">
        <div class="animate-spin w-8 h-8 border-4 border-kipp-500 border-t-transparent rounded-full mx-auto mb-3"></div>
        <div>Loading demographics…</div>
      </div>
    </div>`;
  }
  return html4`
    <div class="h-full flex flex-col">
      ${TopBar({ state, store })}
      <div class="flex-1 flex overflow-hidden">
        <aside class="w-[420px] bg-white border-r border-ink-100 overflow-y-auto scrollbar-thin flex-shrink-0">
          <${SchoolPanel}    state=${state} store=${store} />
          <${LayersPanel}    state=${state} store=${store} />
          <${DistrictPanel}  state=${state} store=${store} />
        </aside>
        <main class="flex-1 relative">
          <div id="map" class="absolute inset-0"></div>
          ${state.showHeatMap ? html4`
            <div id="heatmap-legend"
                 class="absolute bottom-4 left-4 bg-white/95 backdrop-blur px-3 py-2 rounded-md shadow-sm border border-ink-100 text-[11px]">
            </div>` : null}
          ${state.showPerformance ? PerfLegend() : null}
        </main>
      </div>
    </div>
  `;
}
function PerfLegend() {
  const gradient = `linear-gradient(to right, ${PROF_STOPS.map(([v, c]) => `${c} ${v}%`).join(", ")})`;
  return html4`
    <div class="absolute bottom-4 left-4 bg-white/95 backdrop-blur px-3 py-2.5 rounded-md shadow-sm border border-ink-100 text-[11px] w-[210px]">
      <div class="font-semibold text-ink-800 mb-1">School Performance</div>
      <div class="text-ink-500 mb-1">% scoring Level 3+ (ELA+Math)</div>
      <div style="height:9px;border-radius:3px;background:${gradient}"></div>
      <div class="flex justify-between text-ink-400 mt-0.5"><span>0%</span><span>50%</span><span>100%</span></div>
      <div class="flex items-center gap-3 mt-2 pt-2 border-t border-ink-100">
        <span class="flex items-center gap-1">
          <svg width="13" height="13"><circle cx="6.5" cy="6.5" r="5" fill="#94a3b8" stroke="#fff"></circle></svg>
          <span class="text-ink-600">District</span>
        </span>
        <span class="flex items-center gap-1">
          <svg width="13" height="13"><polygon points="6.5,1 12,12 1,12" fill="#94a3b8" stroke="#fff"></polygon></svg>
          <span class="text-ink-600">Charter</span>
        </span>
      </div>
      <div class="text-ink-400 mt-1">Size = enrollment</div>
    </div>
  `;
}
function TopBar({ state, store: store2 }) {
  return html4`
    <header class="flex items-center gap-3 px-5 py-2.5 bg-white border-b border-ink-100 flex-shrink-0">
      <div class="flex items-baseline gap-2">
        <div class="w-6 h-6 rounded bg-kipp-600 text-white text-[11px] font-bold flex items-center justify-center">K</div>
        <div class="text-[15px] font-semibold text-ink-900">KIPP Demographics</div>
        <div class="text-[12px] text-ink-500">Broward · Miami-Dade · Orange Demographics</div>
      </div>
      <div class="ml-auto text-[11px] text-ink-500">ACS 5-Yr 2023 · FL DOE 2025-26</div>
    </header>
  `;
}
document.addEventListener("DOMContentLoaded", () => {
  window.__store = store;
  render(h4(App), document.getElementById("app"));
});
export {
  getMap,
  getMapIdle,
  moveSchoolsOnTop,
  store
};
