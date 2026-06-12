// KIPP Demographics — main app bootstrap. Unified single-panel interface.

import { h, render } from "https://esm.sh/preact@10.22.0";
import { useEffect, useRef, useState } from "https://esm.sh/preact@10.22.0/hooks";
import htm from "https://esm.sh/htm@3.1.1";

import { loadAll, createStore } from "./state.js";
import { PROF_STOPS } from "./utils.js";
import { SchoolPanel } from "./campus.js";
import { DistrictPanel } from "./sbd.js";
import { LayersPanel } from "./heatmap.js";

const html = htm.bind(h);

export const store = createStore({
  data:              null,
  county:            "broward",         // drives sidebar district list only
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
export function moveSchoolsOnTop(m) {
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

// ---------- Map singleton ----------
let map = null;
const mapReady = new Promise(resolve => { window.__mapResolve = resolve; });

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
            "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          ],
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
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }));
  map.on("load", () => { window.__map = map; window.__mapResolve(map); });
}

export function getMap() { return mapReady; }
export const getMapIdle = getMap;

// Sync all layer visibility in one place — called whenever show-flags change.
async function syncLayerVisibility(state) {
  const m = await mapReady;

  // Heat map choropleth
  ["bg-heat", "bg-outline"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", state.showHeatMap ? "visible" : "none");
  });

  // Per-county SBD fill + line
  const sbdVis = (vis) => vis ? "visible" : "none";
  ["sbd-brw-fill", "sbd-brw-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(state.showBrowardSBD));
  });
  ["sbd-mdc-fill", "sbd-mdc-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(state.showMiamiDadeSBD));
  });
  ["sbd-org-fill", "sbd-org-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", sbdVis(state.showOrangeSBD));
  });

  // Per-county District labels (HTML markers tagged with .dataset.sbdCounty)
  (window.__sbdLabelMarkers || []).forEach(lm => {
    const el = lm.getElement();
    const tag = el.dataset.sbdCounty;
    const on = tag === "mdc" ? state.showMiamiDadeSBD : tag === "org" ? state.showOrangeSBD : state.showBrowardSBD;
    el.style.display = on ? "" : "none";
  });

  // Step Up markers — gated only on their own toggle, independent of the SBD layer.
  (window.__stepupMarkers || []).forEach(mk => {
    mk.getElement().style.display = state.showStepUp ? "" : "none";
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

  // Underutilized schools (400+ surplus seats)
  if (m.getLayer("school-dots-underutilized"))
    m.setLayoutProperty("school-dots-underutilized", "visibility", state.showUnderutilized ? "visible" : "none");

  // Persistently Low-Performing (PLP) schools — FL DOE 2024-25 list
  if (m.getLayer("school-dots-plp"))
    m.setLayoutProperty("school-dots-plp", "visibility", state.showPlp ? "visible" : "none");

  // 5-mile radius around focused PLP school (separate from drive-time ring)
  const plpRadiusVis = (state.showPlpRadius && state.focusCampus && state.data?.plpSchools?.[state.focusCampus])
    ? "visible" : "none";
  ["plp-radius-fill", "plp-radius-line"].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", plpRadiusVis);
  });

  // Belt-and-suspenders: pull school/ring/radius layers above SBD + heatmap
  moveSchoolsOnTop(m);
}

// ---------- App shell ----------
function App() {
  const [state, setState] = useState(store.get());
  const isFirstCounty = useRef(true);

  useEffect(() => store.subscribe(setState), []);
  useEffect(() => {
    loadAll().then(d => store.set({ data: d }));
  }, []);
  useEffect(() => {
    if (!map && document.getElementById("map")) initMap();
  });

  // Layer visibility sync
  useEffect(() => {
    if (state.data) syncLayerVisibility(state);
  }, [state.data, state.showHeatMap, state.showBrowardSBD, state.showMiamiDadeSBD,
      state.focusCampus, state.showCharters, state.showPublicSchools,
      state.showUnderutilized, state.showPlp, state.showPlpRadius, state.showStepUp,
      state.showPerformance, state.showOrangeSBD]);

  // Fly to county center when county changes (skip first render)
  useEffect(() => {
    if (!state.data) return;
    if (isFirstCounty.current) { isFirstCounty.current = false; return; }
    const center = state.county === "miamidade" ? [-80.35, 25.75]
      : state.county === "orange" ? [-81.34, 28.51]
      : [-80.22, 26.15];
    mapReady.then(m => m.flyTo({ center, zoom: 9.2, duration: 700 }));
  }, [state.county]);

  if (!state.data) {
    return html`<div class="h-full flex items-center justify-center text-ink-500">
      <div class="text-center">
        <div class="animate-spin w-8 h-8 border-4 border-kipp-500 border-t-transparent rounded-full mx-auto mb-3"></div>
        <div>Loading demographics…</div>
      </div>
    </div>`;
  }

  return html`
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
          ${state.showHeatMap ? html`
            <div id="heatmap-legend"
                 class="absolute bottom-4 left-4 bg-white/95 backdrop-blur px-3 py-2 rounded-md shadow-sm border border-ink-100 text-[11px]">
            </div>` : null}
          ${state.showPerformance ? PerfLegend() : null}
        </main>
      </div>
    </div>
  `;
}

// Legend for the School Performance layer: proficiency color ramp + shape key.
function PerfLegend() {
  const gradient = `linear-gradient(to right, ${PROF_STOPS.map(([v,c]) => `${c} ${v}%`).join(", ")})`;
  return html`
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

function TopBar({ state, store }) {
  return html`
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

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  window.__store = store;
  render(h(App), document.getElementById("app"));
});
