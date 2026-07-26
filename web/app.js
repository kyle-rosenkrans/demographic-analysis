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

const REGIONS = [
  { id: "broward",   label: "Broward",     center: [-80.22, 26.15] },
  { id: "miamidade", label: "Miami-Dade",  center: [-80.35, 25.75] },
  { id: "orange",    label: "Orange",      center: [-81.34, 28.51] },
];
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
  }, [state.data, state.showHeatMap, state.showBrowardSBD, state.showMiamiDadeSBD,
      state.focusCampus, state.showCharters, state.showPublicSchools,
      state.showUnderutilized, state.showPlp, state.showPlpRadius, state.showStepUp,
      state.showPerformance, state.showOrangeSBD]);

  // Fly to county center when county changes (skip first render)
  useEffect(() => {
    if (!state.data) return;
    if (isFirstCounty.current) { isFirstCounty.current = false; return; }
    const region = REGIONS.find(r => r.id === state.county) || REGIONS[0];
    mapReady.then(m => m.flyTo({ center: region.center, zoom: 9.2, duration: 700 }));
  }, [state.county]);

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
        ${state.showPerformance ? PerfLegend() : null}
      </div>
    </div>
  `;
}

// Legend for the School Performance layer: proficiency color ramp + shape key.
function PerfLegend() {
  const gradient = `linear-gradient(to right, ${PROF_STOPS.map(([v,c]) => `${c} ${v}%`).join(", ")})`;
  return html`
    <div class="legend perf">
      <div class="lgtitle" style="font-weight:600;margin-bottom:3px">School Performance</div>
      <div style="color:var(--ink-500);margin-bottom:5px">% scoring Level 3+ (ELA+Math)</div>
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
  return html`
    <header class="topbar">
      <div class="brand">
        <div class="mark">K</div>
        <div class="bar"></div>
        <div>
          <div class="eyebrow">KIPP Miami · Growth & Facilities</div>
          <div class="title">Demographic Analysis</div>
        </div>
      </div>
      <div class="segset">
        ${REGIONS.map(r => html`
          <button class="seg ${state.county === r.id ? "on" : ""}"
            onClick=${() => store.set({ county: r.id, focusDistrict: null })}>${r.label}</button>`)}
      </div>
      <button class="ghost" onClick=${() => mapReady.then(m => m.flyTo({ center: [-81.7, 27.9], zoom: 6.3, duration: 800 }))}>Statewide</button>
      <div style="margin-left:auto;display:flex;align-items:center;gap:14px">
        <div class="topmeta">ACS 5-Yr 2023 · FL DOE 2025–26</div>
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
