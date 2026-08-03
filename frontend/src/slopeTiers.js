/** Slope steepness tiers for parcel fill colors / visibility (percent grade). */

export const SLOPE_TIERS = [
  {
    id: 'flat',
    label: 'Flat',
    maxMeanPct: 5,
    fillColor: '#2e7d32',
    hint: 'Mean slope under 5% — generally easy to build',
    defaultIncluded: true,
  },
  {
    id: 'gentle',
    label: 'Gentle',
    maxMeanPct: 10,
    fillColor: '#9ccc65',
    hint: 'Mean slope 5–10%',
    defaultIncluded: true,
  },
  {
    id: 'moderate',
    label: 'Moderate',
    maxMeanPct: 15,
    fillColor: '#fdd835',
    hint: 'Mean slope 10–15% — grading gets costly',
    defaultIncluded: true,
  },
  {
    id: 'steep',
    label: 'Steep',
    maxMeanPct: 25,
    fillColor: '#fb8c00',
    hint: 'Mean slope 15–25% — often poor for housing',
    defaultIncluded: true,
  },
  {
    id: 'very_steep',
    label: 'Very steep',
    maxMeanPct: Infinity,
    fillColor: '#c62828',
    hint: 'Mean slope 25%+ — typically unsuitable',
    defaultIncluded: false,
  },
]

export const SLOPE_UNKNOWN_FILL = '#94a3b8'

/** Default percent-grade threshold used for slope_steep_frac. */
export const DEFAULT_SLOPE_STEEP_PCT = 15

export function defaultIncludeSlopeTiers() {
  return Object.fromEntries(
    SLOPE_TIERS.map((tier) => [tier.id, tier.defaultIncluded]),
  )
}

export function slopeTier(parcel) {
  const mean = parcel?.slope_mean_pct
  if (mean == null || Number.isNaN(mean)) return null
  for (const tier of SLOPE_TIERS) {
    if (mean < tier.maxMeanPct) return tier
  }
  return SLOPE_TIERS[SLOPE_TIERS.length - 1]
}

export function slopeFillColor(parcel) {
  return slopeTier(parcel)?.fillColor ?? SLOPE_UNKNOWN_FILL
}

/** Hide when the parcel's slope tier is unchecked. Missing slope stays visible. */
export function parcelExcludedBySlope(parcel, includeSlopeTiers) {
  if (!includeSlopeTiers) return false
  const tier = slopeTier(parcel)
  if (!tier) return false
  return includeSlopeTiers[tier.id] === false
}

export function formatSlopeSummary(parcel, steepPct = DEFAULT_SLOPE_STEEP_PCT) {
  if (parcel?.slope_mean_pct == null) return null
  const mean = parcel.slope_mean_pct.toFixed(1)
  const steep =
    parcel.slope_steep_frac != null
      ? `; ${(parcel.slope_steep_frac * 100).toFixed(0)}% of area ≥ ${steepPct}%`
      : ''
  const tier = slopeTier(parcel)
  const label = tier ? ` · ${tier.label}` : ''
  return `Slope: ${mean}% mean${steep}${label}`
}
