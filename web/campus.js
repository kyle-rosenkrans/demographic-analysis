// Campus / School panel — universal school picker + detail card.
// Always shows KIPP Miami North anchor. No curated 8-school cohort.

import { h } from "https://esm.sh/preact@10.22.0";
import { useEffect } from "https://esm.sh/preact@10.22.0/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { getMapIdle } from "./app.js";
import { fmt, profColor, profColorExpr, gradeColor, schoolYearLabel, perfYear } from "./utils.js";
import { regionCfg, regionData, perfKeyFor, enrollKeyFor } from "./region.js";

const html = htm.bind(h);

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
export function SchoolPanel({ state, store }) {
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
