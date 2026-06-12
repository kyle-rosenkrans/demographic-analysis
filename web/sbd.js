// District Panel — SBD choropleth + per-district detail.
// Rendered as a collapsible section in the unified sidebar.

import { h } from "https://esm.sh/preact@10.22.0";
import { useEffect } from "https://esm.sh/preact@10.22.0/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { getMapIdle, moveSchoolsOnTop } from "./app.js";
import { fmt } from "./utils.js";
import { rankCohort, DEFAULT_WEIGHTS } from "./suitability.js";

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

async function renderSBDLayers(state) {
  const map = await getMapIdle();
  const { data, focusDistrict, county, showStepUp } = state;
  if (!data) return;

  // Clear Step Up markers (re-added below, filtered by per-county flags)
  (window.__stepupMarkers || []).forEach(m => m.remove());
  window.__stepupMarkers = [];

  ensureSbdLayer(map, "brw", data.sbd,    focusDistrict, county === "broward"   ? "brw" : null);
  ensureSbdLayer(map, "mdc", data.mdcSbd, focusDistrict, county === "miamidade" ? "mdc" : null);
  ensureSbdLayer(map, "org", data.orangeSbd, focusDistrict, county === "orange" ? "org" : null);

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

  // Keep schools on top — sbd layers just got re-added
  moveSchoolsOnTop(map);
}

// ---------- DistrictPanel component ----------
export function DistrictPanel({ state, store }) {
  useEffect(() => { renderSBDLayers(state); },
    [state.data, state.focusDistrict, state.showStepUp, state.county,
     state.showBrowardSBD, state.showMiamiDadeSBD, state.showOrangeSBD]);

  const { data, focusDistrict, county } = state;
  if (!data) return null;

  const isMiami = county === "miamidade";
  const isOrange = county === "orange";
  const rollupSrc = isOrange ? data.orangeSbdRollup : isMiami ? data.mdcSbdRollup : data.sbdRollup;
  const stepupRollup = isOrange ? null : isMiami ? data.stepupMdcSbdRollup : data.stepupSbdRollup;
  const charterOps = isOrange ? null : isMiami ? data.charterOperatorsMdc : data.charterOperators;
  const districtIds = isMiami ? [1,2,3,4,5,6,7,8,9] : [1,2,3,4,5,6,7];
  if (!rollupSrc) return null;

  const cohort = Object.entries(rollupSrc).filter(([k]) => k !== "_average");
  const ranked = rankCohort(cohort, state.weights || DEFAULT_WEIGHTS);
  const sortedDist = ranked.scored.slice().sort((a,b) => b.score - a.score);

  return html`
    <details class="border-b border-ink-100">
      <summary class="px-4 py-2.5 text-xs font-semibold text-ink-700 bg-ink-50 cursor-pointer flex items-center justify-between select-none">
        <span>District Analysis · Charter Ops · Step Up</span>
        <span class="text-ink-400 font-normal">▸</span>
      </summary>

      <!-- County tab selector for sidebar content (map shows whatever layers are toggled) -->
      <div class="px-4 py-2 border-b border-ink-100 flex items-center gap-1">
        <span class="text-[11px] text-ink-500 mr-1">Show data for:</span>
        ${[{id:"broward",label:"Broward"},{id:"miamidade",label:"Miami-Dade"},{id:"orange",label:"Orange / Orlando"}].map(c => html`
          <button
            onClick=${() => store.set({ county: c.id, focusDistrict: null })}
            class="px-2 py-0.5 text-[11px] rounded ${state.county === c.id ? "bg-kipp-600 text-white" : "text-ink-700 hover:bg-ink-100"}"
          >${c.label}</button>
        `)}
      </div>

      ${focusDistrict ? html`
        <${DistrictDetail}
          district=${focusDistrict} data=${data} store=${store} state=${state}
          rollupSrc=${rollupSrc} stepupRollup=${stepupRollup} county=${county}
        />
      ` : html`
        <div class="p-3 space-y-3">

          <!-- Suitability ranking -->
          <table class="data">
            <thead><tr><th>Rank</th><th>District</th><th class="num">Suitability</th></tr></thead>
            <tbody>
              ${sortedDist.map((s, i) => html`
                <tr onClick=${() => store.set({ focusDistrict: Number(s.id) })}
                    class="cursor-pointer hover:bg-kipp-50">
                  <td class="num text-ink-500">${i+1}</td>
                  <td>
                    <span style="display:inline-block;width:8px;height:8px;background:${DISTRICT_COLORS[s.id]};border-radius:2px;margin-right:5px"></span>
                    District ${s.id}
                  </td>
                  <td class="num font-semibold">${fmt.pct(s.score/100, 1)}</td>
                </tr>
              `)}
            </tbody>
          </table>

          <!-- Demographic comparison table (scrollable) -->
          <div class="overflow-x-auto text-[11px]">
            <${SBDTable} sbdRollup=${rollupSrc} districtIds=${districtIds} />
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

          <${DistrictTakeaways} sortedDist=${sortedDist} data=${data} county=${county} />
        </div>
      `}
    </details>
  `;
}

function DistrictDetail({ district, data, store, state, rollupSrc, stepupRollup, county }) {
  const src = rollupSrc || data.sbdRollup;
  const rec = src[String(district)];
  const avg = src._average || {};
  const sbdKey = county === "miamidade" ? "mdc_sbd" : "sbd";
  const stepupSchools = (data.stepupSchools?.features || [])
    .filter(f => f.properties[sbdKey] === district)
    .sort((a,b) => (b.properties.enroll_total||0) - (a.properties.enroll_total||0));
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
            Step Up in D${district} · ${stepupSchools.length} schools
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

function SBDTable({ sbdRollup, districtIds }) {
  const ids = districtIds || [1,2,3,4,5,6,7];
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
            <span style="display:inline-block;width:7px;height:7px;background:${DISTRICT_COLORS[d]};border-radius:2px;margin-right:2px;vertical-align:middle"></span>D${d}
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

function DistrictTakeaways({ sortedDist, data, county }) {
  const top = sortedDist[0], bottom = sortedDist[sortedDist.length-1];
  return html`
    <details class="border border-ink-100 rounded-md overflow-hidden" open>
      <summary class="px-3 py-2 text-xs font-medium text-ink-700 bg-ink-50 border-b border-ink-100 cursor-pointer">
        Takeaways
      </summary>
      <div class="p-3 space-y-1.5 text-xs leading-relaxed text-ink-700">
        <div><strong>Best suitability:</strong>
          <span class="pill ml-1" style="background:#dcfce7;color:#166534">District ${top.id}</span>
          <span class="text-ink-500">(${fmt.pct(top.score/100)},
            ${Math.round(top.score - sortedDist[1].score)} pts ahead of D${sortedDist[1].id})</span>
        </div>
        <div><strong>Weakest:</strong>
          <span class="pill ml-1" style="background:#fee2e2;color:#991b1b">District ${bottom.id}</span>
          <span class="text-ink-500">(${fmt.pct(bottom.score/100)})</span>
        </div>
      </div>
    </details>
  `;
}
