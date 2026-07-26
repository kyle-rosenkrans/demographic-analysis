export const fmt = {
  int: (v) => v == null ? "—" : Math.round(v).toLocaleString(),
  pct: (v, d = 1) => v == null ? "—" : (v * 100).toFixed(d) + "%",
  money: (v) => v == null ? "—" : "$" + Math.round(v).toLocaleString(),
  signed: (v, d = 1) => v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + "%",
};

// Color ramps (d3-like) — avoiding a d3 dep.
export const RAMP_ORANGE = ["#fff7ed","#ffedd5","#fed7aa","#fdba74","#fb923c","#f97316","#ea580c","#c2410c","#9a3412"];
export const RAMP_BLUE   = ["#f0f9ff","#e0f2fe","#bae6fd","#7dd3fc","#38bdf8","#0ea5e9","#0284c7","#0369a1","#075985"];
export const RAMP_GREEN  = ["#f0fdf4","#dcfce7","#bbf7d0","#86efac","#4ade80","#22c55e","#16a34a","#15803d","#166534"];
export const RAMP_RED    = ["#fef2f2","#fee2e2","#fecaca","#fca5a5","#f87171","#ef4444","#dc2626","#b91c1c","#991b1b"];
export const RAMP_PURPLE = ["#faf5ff","#f3e8ff","#e9d5ff","#d8b4fe","#c084fc","#a855f7","#9333ea","#7e22ce","#6b21a8"];

// ---- School performance (proficiency) color scale: red → amber → green ----
// Used by the School Performance map layer + the focused-school detail bars so
// the two always agree. pct is "% scoring Level 3+" (0-100).
export const PROF_STOPS = [
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
export function profColor(pct){
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
export function profColorExpr(field){
  const interp = ["interpolate", ["linear"], ["to-number", ["get", field]]];
  for (const [v,c] of PROF_STOPS){ interp.push(v, c); }
  return ["case", ["==", ["get", field], null], PROF_NULL, interp];
}

// Letter-grade → color (A green … F red)
export function gradeColor(g){
  return { A:"#15803d", B:"#65a30d", C:"#ca8a04", D:"#ea580c", F:"#b91c1c" }[g] || "#9ca3af";
}

// FL DOE grade year → school-year label. 2026 -> "2025-26".
export function schoolYearLabel(y){
  return y ? `${y - 1}-${String(y).slice(2)}` : "—";
}

// Latest grade year a performance record actually carries. Records are stamped
// with data_year by etl/24_parse_school_grades.py; a school absent from the
// newest FL DOE release keeps its prior-year vintage, so read it per-record
// rather than assuming the current year everywhere.
export const PERF_LATEST_YEAR_FALLBACK = 2026;
export function perfYear(rec){
  return (rec && rec.data_year) || PERF_LATEST_YEAR_FALLBACK;
}

// Given an array of numeric values compute quantile breaks for N buckets
export function quantileBreaks(values, n = 9) {
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
export function stepExpr(field, breaks, ramp) {
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
