// Layers Panel — heat map choropleth + all map layer toggles + suitability weights.
// Rendered as a collapsible section in the unified sidebar.

import { h } from "https://esm.sh/preact@10.22.0";
import { useEffect } from "https://esm.sh/preact@10.22.0/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { getMapIdle } from "./app.js";
import { fmt, quantileBreaks, stepExpr, RAMP_ORANGE, RAMP_BLUE, RAMP_GREEN, RAMP_PURPLE, RAMP_RED } from "./utils.js";
import { DEFAULT_WEIGHTS, score, val, WEIGHT_LABELS } from "./suitability.js";

const html = htm.bind(h);

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

// Build a combined FC of block-groups with ACS joined
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
let CURRENT_LAYER = null;
let CURRENT_BREAKS = null;

// ---------- Map rendering ----------
async function renderHeatLayers(state) {
  const map = await getMapIdle();
  const { data, heatLayer, showHeatMap } = state;
  if (!data) return;

  if (!BG_FC) {
    BG_FC = joinedBGs(data);
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
export function LayersPanel({ state, store }) {
  useEffect(() => {
    if (state.showHeatMap) renderHeatLayers(state);
  }, [state.data, state.heatLayer, state.weights, state.showHeatMap]);

  // Re-run legend update whenever heat map is shown
  useEffect(() => {
    if (state.showHeatMap && CURRENT_LAYER && CURRENT_BREAKS) {
      updateLegendDOM(CURRENT_LAYER, CURRENT_BREAKS);
    }
  }, [state.showHeatMap]);

  const { data } = state;
  if (!data) return null;

  const weights = state.weights || { ...DEFAULT_WEIGHTS };
  const total = Object.values(weights).reduce((a,b) => a+(b||0), 0);

  return html`
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
                   onChange=${e => store.set({ showHeatMap: e.target.checked })} />
            <span class="text-xs font-medium text-ink-700">Demographic Heat Map</span>
          </label>
          ${state.showHeatMap ? html`
            <div class="flex flex-wrap gap-1 pl-5">
              ${METRICS.map(m => html`
                <button
                  onClick=${() => store.set({ heatLayer: m.id })}
                  class="px-2 py-0.5 text-[11px] rounded ${state.heatLayer === m.id ? "bg-kipp-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200"}"
                >${m.label}</button>
              `)}
            </div>
            ${state.heatLayer === "suitability" ? html`
              <div class="pl-5 text-[11px] text-ink-500">Suitability: weighted composite (100-pt scale). Edit weights below.</div>
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
            <span class="text-xs font-medium text-ink-700">School Performance</span>
          </label>
          ${state.showPerformance ? html`
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
                   onChange=${e => store.set({ showBrowardSBD: e.target.checked })} />
            <span class="text-xs text-ink-700">Broward County (D1–D7)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer pl-2">
            <input type="checkbox" checked=${state.showMiamiDadeSBD}
                   onChange=${e => store.set({ showMiamiDadeSBD: e.target.checked })} />
            <span class="text-xs text-ink-700">Miami-Dade County (D1–D9)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer pl-2">
            <input type="checkbox" checked=${state.showOrangeSBD}
                   onChange=${e => store.set({ showOrangeSBD: e.target.checked })} />
            <span class="text-xs text-ink-700">Orange County · Orlando (D1–D7)</span>
          </label>
        </div>

        <!-- District/public schools — BLUE circle -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showPublicSchools}
                 onChange=${e => store.set({ showPublicSchools: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:50%;background:#2563eb;border:1px solid #fff;box-shadow:0 0 0 1px #2563eb;display:inline-block;flex-shrink:0"></span>
          <span class="text-xs text-ink-700">District Schools (Size = Enrollment)</span>
        </label>

        <!-- Charter schools — AMBER circle with dark ring -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showCharters}
                 onChange=${e => store.set({ showCharters: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:50%;background:#f59e0b;border:2px solid #78350f;display:inline-block;flex-shrink:0"></span>
          <span class="text-xs text-ink-700">Charter schools (size = enrollment)</span>
        </label>

        <!-- Step Up private — PURPLE rounded-square -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked=${state.showStepUp}
                 onChange=${e => store.set({ showStepUp: e.target.checked })} />
          <span style="width:11px;height:11px;border-radius:18%;background:#9333ea;border:1.5px solid #581c87;display:inline-block;flex-shrink:0"></span>
          <span class="text-xs text-ink-700">Step Up private schools (size = K-8 enrollment)</span>
        </label>

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
            <span class="text-xs text-ink-700">School of Hope eligible facilities</span>
          </label>
          ${state.showUnderutilized ? html`
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
                   onChange=${e => store.set({ showPlp: e.target.checked })} />
            <span style="width:11px;height:11px;border-radius:50%;background:#fee2e2;border:2.5px solid #b91c1c;display:inline-block;flex-shrink:0"></span>
            <span class="text-xs text-ink-700">Persistently Low-Performing (PLP 24-25)</span>
          </label>
          ${state.showPlp ? html`
            <div class="pl-5 text-[10px] text-ink-500 leading-snug">
              FL DOE 2024-25 list · 44 schools across Broward, Miami-Dade + Orange.
              Click any PLP school for campus analysis; a 5-mile radius will draw around it.
            </div>
          ` : null}
          <label class="flex items-center gap-2 cursor-pointer pl-5">
            <input type="checkbox" checked=${state.showPlpRadius}
                   onChange=${e => store.set({ showPlpRadius: e.target.checked })} />
            <span class="text-[11px] text-ink-600">5-mile radius around focused PLP school</span>
          </label>
        </div>

        <!-- Suitability weights -->
        <details class="border border-ink-100 rounded-md overflow-hidden">
          <summary class="px-3 py-2 text-[11px] font-medium text-ink-700 bg-ink-50 cursor-pointer">
            Suitability weights · total = ${total.toFixed(0)}
          </summary>
          <div class="p-3 space-y-1">
            ${Object.keys(DEFAULT_WEIGHTS).map(k => html`
              <div class="flex items-center gap-2">
                <label class="text-[11px] text-ink-700 flex-1">${WEIGHT_LABELS[k]}</label>
                <input type="number" min="0" max="50" step="1"
                  value=${weights[k] ?? 0}
                  onInput=${e => {
                    const v = parseFloat(e.target.value) || 0;
                    store.set({ weights: { ...weights, [k]: v } });
                  }}
                  class="w-12 px-1.5 py-0.5 text-xs text-right border border-ink-300 rounded"
                />
              </div>
            `)}
            <button class="mt-1 text-[11px] text-kipp-600 hover:underline"
                    onClick=${() => store.set({ weights: null })}>Reset to defaults</button>
          </div>
        </details>

      </div>
    </details>
  `;
}
