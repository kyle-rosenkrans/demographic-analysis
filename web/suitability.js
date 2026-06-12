// Per-variable weighted suitability, mirroring slide 45 of the MEETING EDITS deck.
// Each component's score = (subject_value / max_value_across_cohort) * max_weight, capped at max_weight.
// Total max weights sum to 100.
//
// Components (default max weights from slide 45):
//  pop_total          5
//  pop_growth_5yr     5    (not yet in our data — defaulted to 0 until projections added)
//  pct_hhi_u50       10
//  pct_snap          10
//  pop_k_4_est       20
//  pop_5_8_est       20
//  k_4_growth         5    (0 until projections)
//  5_8_growth         5    (0 until projections)
//  pct_black         12
//  pct_hispanic       8

export const DEFAULT_WEIGHTS = {
  pop_total: 5,
  pop_growth_5yr: 5,
  pct_hhi_u50: 10,
  pct_snap: 10,
  pop_k_4_est: 20,
  pop_5_8_est: 20,
  k_4_growth_5yr: 5,
  "5_8_growth_5yr": 5,
  pct_black: 12,
  pct_hispanic: 8,
};

export const WEIGHT_LABELS = {
  pop_total: "Population (2025)",
  pop_growth_5yr: "5-Year Growth (2025-2030)",
  pct_hhi_u50: "% HHI Below $50k",
  pct_snap: "% Homes on SNAPS",
  pop_k_4_est: "K-4th Grade Population",
  pop_5_8_est: "5-8th Grade Population",
  k_4_growth_5yr: "K-4th Growth",
  "5_8_growth_5yr": "5-8th Growth",
  pct_black: "Black Population (%) K-8",
  pct_hispanic: "Hispanic Population (%) K-8",
};

// Read a field from a record. The weight-key namespace is the rollup schema;
// BG-level records use a different naming convention for projection fields
// ("pop_total_growth_5yr" vs "pop_growth_5yr"), so map the aliases here.
const BG_ALIAS = {
  pop_growth_5yr:    "pop_total_growth_5yr",
  k_4_growth_5yr:    "pop_k_4_est_growth_5yr",
  "5_8_growth_5yr":  "pop_5_8_est_growth_5yr",
};
export function val(rec, key) {
  if (rec[key] != null) return rec[key];
  const alt = BG_ALIAS[key];
  if (alt && rec[alt] != null) return rec[alt];
  return null;
}

// Compute a suitability score for one record, using min-max normalization within the cohort.
// cohortMin defaults to {} (treated as 0), giving the same result as before for all-positive fields.
// For growth fields where every campus is declining (all negative), min-max still gives relative scores.
export function score(rec, cohortMax, weights = DEFAULT_WEIGHTS, cohortMin = {}) {
  let total = 0;
  const parts = {};
  for (const k of Object.keys(weights)) {
    const maxW = weights[k];
    if (!maxW) { parts[k] = 0; continue; }
    const mx = cohortMax[k] ?? 0;
    const mn = cohortMin[k] ?? 0;
    const v = val(rec, k) ?? 0;
    if (mx <= mn) { parts[k] = 0; continue; }
    const share = Math.max(0, Math.min(1, (v - mn) / (mx - mn)));
    const pts = share * maxW;
    parts[k] = pts;
    total += pts;
  }
  return { total, parts };
}

// Given a cohort (array of [id, rec]), return {maxes, mins, scored: [{id, rec, score, parts}], avg}
export function rankCohort(cohort, weights = DEFAULT_WEIGHTS) {
  const maxes = {}, mins = {};
  for (const k of Object.keys(weights)) {
    let mn = Infinity, mx = -Infinity;
    for (const [,rec] of cohort) {
      const v = val(rec, k);
      if (v != null) {
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
    }
    maxes[k] = mx === -Infinity ? 0 : mx;
    mins[k]  = mn === Infinity  ? 0 : mn;
  }
  const scored = cohort.map(([id, rec]) => {
    const s = score(rec, maxes, weights, mins);
    return { id, rec, score: s.total, parts: s.parts };
  });
  const avg = scored.reduce((a, x) => a + x.score, 0) / (scored.length || 1);
  return { maxes, mins, scored, avg };
}
