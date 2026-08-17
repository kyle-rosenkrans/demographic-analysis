// District Panel — SBD choropleth + per-district detail.
// Rendered as a collapsible section in the unified sidebar.

import { h } from "https://esm.sh/preact@10.22.0";
import { useEffect } from "https://esm.sh/preact@10.22.0/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { getMapIdle, moveSchoolsOnTop } from "./app.js";
import { fmt } from "./utils.js";
import { rankCohort, DEFAULT_WEIGHTS } from "./suitability.js";
import { regionCfg, AREA_TAG } from "./region.js";

const html = htm.bind(h);

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
export function DistrictPanel({ state, store }) {
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
